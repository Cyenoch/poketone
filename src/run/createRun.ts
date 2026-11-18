import { settlementDex } from "./sim/encounters";
import type { MultiplayerRun } from "../network/run";
import { challengePayout, seatOutcome } from "./sim/challenge-result";
import { snapshotWorld } from "./sim/snapshot";
import type { RuleId } from "./sim/content/rules";
import type { ActionInput, GameplayAction } from "../platform/input";
import { Matrix4, Texture, type Material, type Object3D, type WebGLRenderer } from "three";
import type { AppRenderer } from "../rendering/app-renderer";
import type { GpuRunHud } from "../ui/gpu/run-hud";
import type { UiInsets } from "../ui/gpu/viewport";
import { isWeatherMove, moves, weatherMoves, type MoveId } from "./sim/content/moves";
import {
  megaStones,
  starters,
  stageForm,
  type FormId,
  type Stage,
  type StarterId,
} from "./sim/content/lines/index";
import type { Difficulty } from "./sim/content/difficulties";
import type { ElementType } from "./sim/content/elements";
import { items, type ItemId } from "./sim/content/items";
import { enemies as enemyDefs } from "./sim/content/enemies";
import { formOf } from "./sim/evolution";
import { moveParams } from "./sim/attacks";
import { activeWeather } from "./sim/content/weather";
import { ULT_WINDUP } from "./sim/content/params/ultimates";
import { siteHere } from "./sim/sites/index";
import type { RunDex, SiteKind, WeatherId } from "./sim/state/field";
import { sites as siteDefs } from "./sim/content/sites";
import { archetypes } from "./sim/archetypes/index";
import { playerStats, statBreakdown, type StatBreakdown } from "./sim/stats";
import { TICK, type World } from "./sim/state/world";
import { stageDefs } from "./sim/content/stages/index";
import { nextField, passedTowerFloors, routeStep } from "./sim/content/campaign";
import type { ZoneExit } from "./sim/state/route";
import type { Command } from "./sim/state/commands";
import type {
  LabBonuses,
  MoveState,
  PendingChoice,
  Player,
  PlayerId,
  StationKind,
} from "./sim/state/entities";
import type { RunEvent } from "./sim/state/events";
import { itemSlots, moveSlots } from "./sim/upgrades";
import { fusionStatus, type FusionPart } from "./sim/fusion";
import { rescueTarget } from "./sim/rescue";
import { trainers, trainerTier, type TrainerId } from "../trainers";
import {
  deployCall,
  ultimateCall,
  assistCall,
  RELEASE as ULT_RELEASE_CUE,
  type TrainerCue,
} from "./trainer-cues";
import { DEPLOYMENT_MS } from "./view/deployment";
import { EVOLVE_SWAP_MS } from "./view/bodyGlow";
import { COOP } from "./sim/content/params/coop";
import { DASH_COOLDOWN } from "./sim/content/params/player";
import { forgetRefund, forgettableItem, stationHere } from "./sim/stations";
import { nearestExit, zoneDef, zoneTime, zoneTimeLimit } from "./sim/currentZone";
import { canLeave, enterZone, prepareZone, tradeAction, zoneAction } from "./sim/zones";
import {
  cardShown,
  createWorldFromSeeds,
  isFrozen,
  manualCards,
  stepWorld,
  type Loadout,
} from "./sim/world";
import { bindModelStore, loadRunAssets, type RunAssets } from "./view/assets";
import { afterFrame, drive, type Steps } from "../prepare/steps";
import { bakeMap } from "./view/minimapBake";
import type { StageId } from "./sim/content/stages/index";
import { getAudio, RUN_SOUNDS, type SfxName } from "../audio/engine";
import { playFieldEvent, syncFieldAmbience } from "../audio/field-events";
import { createBoundaryWall, type BoundaryWall } from "./view/boundaryWall";
import { stageThemes } from "./view/stageThemes";
import { createDebugOverlay, type DebugOverlay } from "./view/debug/layers";
import { applyWorldOutput, createGrade } from "./view/grade";
import { createHealthBars, type HealthBars } from "./view/healthBars";
import { createMinimap, type Minimap } from "./view/minimap";
import { cameraForward, cameraRight, turnYaw } from "./cameraYaw";
import { createCompassBar, type CompassBar } from "./view/compassBar";
import { debugLayers, layerLegend, type DebugLayer } from "./dev/layers";
import { createDevReadout } from "./dev/readout";
import { createRunLog } from "./dev/runLog";
import { createRunView, type RunView } from "./view/createRunView";
import type { AssistItem } from "./sim/content/trainers";

export const RUN_NOTICE_MS = { info: 900, danger: 2600, reward: 2600 };
const dangerLabels = {
  alpha: "头目出现",
  "elite-wave": "精英群",
  swarm: "群体包围",
  stampede: "冲锋群",
  eruption: "火山喷发",
  weather: "天气变化",
  horde: "群体遭遇",
  outbreak: "大量出现",
};

/** What the build panel shows: the stat breakdown and the run's tallies at the moment it opens. */
export interface PlayerSheet {
  sheet: StatBreakdown;
  time: number;
  kills: number;
  stardust: number;
  /** `damage`: dealt by the move this run; `cd`: its cooldown in seconds after stats. */
  moves: { id: MoveId; level: number; damage: number; cd: number }[];
  items: { id: ItemId; level: number }[];
}

/** A teammate's line under the vitals: their slot (P1–P4), form, level and HP. */
export interface TeamMate {
  slot: PlayerId;
  form: FormId;
  shiny: boolean;
  level: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface RunSnapshot {
  floor?: number;
  trainer: TrainerId;
  assistReady: number;
  abilitySlot: Player["abilitySlot"];
  rules: readonly RuleId[];
  stage: StageId;
  routeStep: number;
  exit: ZoneExit | null;
  time: number;
  hp: number;
  maxHp: number;
  /** Shield left and its max (the `shield` stat; 0: no shield, nothing shown). */
  shield: number;
  shieldMax: number;
  level: number;
  xp: number;
  xpNext: number;
  kills: number;
  /** `ready`: 0 just cast → 1 ready; `cd`: the cooldown in seconds (the HUD sweeps between
   *  snapshots with it). A move waiting for a target is ready. */
  moves: { id: MoveId; level: number; ready: number; cd: number }[];
  items: { id: ItemId; level: number }[];
  /** The next dash charge's return, 0 → 1. */
  dash: number;
  /** Charges ready and their max (the `dashCharges` stat). */
  dashes: number;
  dashMax: number;
  /** The guardian in the fight: its name, HP and max HP. */
  boss: { name: string; type: ElementType; hp: number; max: number } | null;
  pending: PendingChoice | null;
  pendingCount: number;
  rescueProgress: number | null;
  siteProgress: number | null;
  /** `seconds`: the active weather's full length (cast weather is shorter than field weather). */
  weather: {
    id: WeatherId;
    phase: "forecast" | "active";
    remaining: number;
    seconds: number;
  } | null;
  /** The level the front level-up card is for: one card per level, so later ones queue behind it. */
  cardLevel: number;
  /** Evolution stage index, for ability cards. */
  evolution: number;
  rerolls: number;
  skips: number;
  banishes: number;
  moveSlots: number;
  itemSlots: number;
  /** 星星沙子 earned this run so far (not the 研究所 balance). */
  stardust: number;
  /** Ultimate charge 0 → 1; `casting` while one plays out. */
  ult: number;
  /** Simulation seconds of this seat's last actual crisis credit; compare with `time`. */
  ultCrisisAt: number | null;
  casting: boolean;
  ultWindup: number;
  ultProtection: number;
  form: FormId;
  shiny: boolean;
  rampage: boolean;
  /** The zone (0-based of `count`), its seconds so far and the second its final swarm starts. */
  zone: {
    index: number;
    count: number;
    phase: World["zone"]["phase"];
    time: number;
    finalSwarm: number | null;
  };
  outcome: World["outcome"];
  tmCase: boolean;
  dialog: StationView | null;
  /** What interacting does where the player stands (shows the prompt), when no dialog is open. */
  prompt: InteractPrompt | null;
  /** The other players still in the run, by slot; empty solo. */
  team: TeamMate[];
}

/** A station's prompt, the landmark's summon, or the exit the fallen guardian opened. */
export type InteractPrompt =
  | StationKind
  | SiteKind
  | "summon"
  | "leave"
  | "choices"
  | "rescue"
  | "trade"
  | "trade-accept"
  | "trade-wait";

function interactPrompt(
  world: World,
  player: World["players"][number],
  isSeatPresent?: (id: number) => boolean,
): InteractPrompt | null {
  if (!player.alive || player.dialog) return null;
  if (player.rescue || rescueTarget(world, player)) return "rescue";
  // Match the command's rescue → zone → field site → choices → station order.
  const action = zoneAction(world, player);
  if (action === "summon" || (action === "leave" && canLeave(world, isSeatPresent))) return action;
  const site = siteHere(world, player);
  if (site) return site.kind;
  if (manualCards(world, player) && player.pending.length > 0) return "choices";
  const station = stationHere(world, player);
  return station ? station.kind : tradeAction(world, player, isSeatPresent);
}

/** What an open station dialog shows; refunds already include the stardust-gain stat. */
export type StationView =
  | {
      id: number;
      kind: "hypno";
      /** 星星沙子 earned this run so far, so the refund reads against it. */
      stardust: number;
      moves: { id: MoveId; level: number; refund: number }[];
      items: { id: ItemId; level: number; refund: number }[];
    }
  | { id: number; kind: "bill"; move: MoveId; parts: FusionPart[]; ready: boolean };

function stationView(world: World, playerId: PlayerId): StationView | null {
  const player = world.players[playerId]!;
  const dialog = player.dialog;
  const station = dialog && world.stations.find((s) => s.id === dialog.station);
  if (!dialog || !station) return null;
  if (station.kind === "bill") return { id: dialog.id, kind: "bill", ...fusionStatus(player) };
  const gain = playerStats(player).stardust;
  return {
    id: dialog.id,
    kind: "hypno",
    stardust: Math.floor(player.stardust),
    moves: player.moves.map((m) => ({
      id: m.id,
      level: m.level,
      refund: Math.floor(forgetRefund(player, m, "move") * gain),
    })),
    items: player.items.filter(forgettableItem).map((item) => ({
      ...item,
      refund: Math.floor(forgetRefund(player, item, "item") * gain),
    })),
  };
}

export interface RunResult {
  /** Floors actually passed in a tower run. Absent for expeditions. */
  floor?: number;
  /** Maps cleared, including the current one once its exit opens. */
  zones: number;
  danger: number;
  outcome: "victory" | "defeat";
  starter: StarterId;
  difficulty: Difficulty;
  time: number;
  level: number;
  kills: number;
  dex: RunDex;
  /** 星星沙子 this run carries out (stardust gain already applied), banked once by `recordRun`. */
  stardust: number;
  moves: { id: MoveId; level: number; damage: number }[];
  /** Items held at the end, the backpack's candidates. */
  items: ItemId[];
}

export function resultFor(world: World, seat: PlayerId): RunResult {
  const player = world.players[seat]!;
  const outcome = seatOutcome(world, player);
  if (outcome === "playing") throw new Error(`席位 ${seat + 1} 尚未结算。`);
  return {
    outcome,
    zones: world.route.length - Number(world.zone.phase === "active"),
    ...(world.mode === "tower" ? { floor: passedTowerFloors(world) } : {}),
    starter: player.starter,
    difficulty: world.difficulty,
    time: world.time,
    level: player.level,
    kills: player.kills,
    dex: settlementDex(player),
    ...challengePayout(world, player),
    moves: player.moves.map(({ id, level, damage }) => ({ id, level, damage })),
    // Backpack candidates: mega stones come only from this run's guardian trophy.
    items: player.items.map((item) => item.id).filter((id) => !megaStones.has(id)),
  };
}

/** A guest leaving between frames needs the same authoritative result as at the team's end. */
export function bindCoopSettlement(
  network: MultiplayerRun,
  world: World,
  report: (result: RunResult) => void,
) {
  if (network.host) {
    network.session.departureTerminal = () => {
      network.restoreHost(world);
      const snapshot = snapshotWorld(world);
      if (snapshot.outcome === "playing") snapshot.outcome = "defeat";
      snapshot.events = [];
      return { t: "terminal", map: world.map, snapshot, events: world.players.map(() => []) };
    };
  } else {
    network.session.onQuitConfirmed = () => {
      // A terminal from a later field need not warm a scene the player is leaving.
      const next = network.takeMap();
      if (!next) network.apply(world, 0);
      report({ ...resultFor(next ?? world, network.player), outcome: "defeat" });
    };
  }
}

export interface RunCallbacks {
  /** App-owned modal input, including its exit transition. */
  inputBlocked(): boolean;
  /** Commits local start data before the prepared world can advance; refusal must throw. */
  onReady(): void;
  onDeployment(active: boolean): void;
  onError(error: Error): void;
  onSnapshot(snapshot: RunSnapshot): void;
  onBanner(text: string, tone: "info" | "danger" | "reward", ageMs: number): void;
  /** "toggle" from the pause key; "pause" when focus is lost (never unpauses). */
  onPauseRequest(mode: "toggle" | "pause"): void;
  onStatsRequest(): void;
  onMapChange(open: boolean): void;
  /** The next zone readies (true, with the map it enters) under the loading cover, then is ready
   *  to play (false). */
  onZoneLoading(loading: boolean, stage?: StageId): void;
  /** How far the current load (the run's or a zone's) is, 0–1, from its real steps. */
  onLoadProgress?(fraction: number): void;
  /** The map the run's load enters, once its world exists (a rejoin's may be past the room's). */
  onLoadStage?(stage: StageId): void;
  onEnd(result: RunResult): void;
}

/** A command from this machine's UI: `RunHandle.send` stamps the local player on it. */
export type LocalCommand = Command extends infer C
  ? C extends { player: PlayerId }
    ? Omit<C, "player">
    : C
  : never;

export interface RunHandle {
  bindInput(input: ActionInput): void;
  sampleInput(move: readonly [number, number], turn: number): void;
  action(action: GameplayAction): void;
  readonly mapOpen: boolean;
  send(command: LocalCommand): void;
  /** Touch camera turn while a rotate button is held: -1 left, 1 right, 0 stop. */
  setTurn(direction: -1 | 0 | 1): void;
  keyDown(code: string, repeat: boolean): boolean;
  cancelInput(): void;
  blur(): void;
  toggleMap(): void;
  resizeUi(width: number, height: number, scale: number, safe: UiInsets): void;
  afterUiLayout(): void;
  mapHit(x: number, y: number): boolean;
  mapActivate(x: number, y: number): void;
  setPaused(paused: boolean): void;
  setSound(enabled: boolean): void;
  setDevMode(enabled: boolean): void;
  setPauseOnBlur(enabled: boolean): void;
  setAutoOpenCards(enabled: boolean): void;
  /** The local player's build, read when the build panel opens (not part of the 10 Hz snapshot). */
  stats(): PlayerSheet;
  dispose(): void;
}

/** Wind-up tells further than this (m, about the screen's half-width) play no sound. */
const TELL_EARSHOT = 14;
/** The heal ring is clearly out by this many ms after its pulse (view/vfx/zoneSkills.ts `mendRing`). */
const HEAL_KEY_MS = 120;
const ASSIST_SOUND: Record<AssistItem, SfxName> = {
  xSpeed: "assist-x-speed",
  superPotion: "assist-super-potion",
  direHit: "assist-dire-hit",
  fullHeal: "assist-full-heal",
};
const MAX_STEPS_PER_FRAME = 5;
/** After a natural end the view plays on this long (the faint, the guardian's fall) before the
 *  result is reported; the sim is already ended and input is ignored. */
const END_HOLD_MS = 800;
/** A chest opens the card dialog; its cards deal in over roughly 180-500 ms, where the chime lands. */
const CHEST_KEY_MS = 360;
/** Candy level in dB: a single pickup sits low, a chain of this many swells to `full`. */
const CANDY_DB = { start: -12, full: -3 };
const CANDY_CHAIN_STEPS = 14;
/** Hits of these elements sound like their element; the rest use the plain hit. */
const HIT_SOUND: Partial<Record<ElementType, SfxName>> = {
  fire: "hit-fire",
  water: "hit-water",
  grass: "hit-grass",
  electric: "hit-electric",
  ghost: "hit-ghost",
  poison: "hit-poison",
  dragon: "hit-dragon",
  fighting: "hit-fighting",
  psychic: "hit-psychic",
  rock: "hit-rock",
  ground: "hit-ground",
};
const CAST_SOUND: Partial<Record<ElementType, SfxName>> = {
  fire: "cast-fire",
  water: "cast-water",
  grass: "cast-grass",
  electric: "cast-electric",
  ghost: "cast-ghost",
  poison: "cast-poison",
  dragon: "cast-dragon",
  // Hurricane is the only flying cast: a gust, like the dragon's.
  flying: "cast-dragon",
  fighting: "cast-fighting",
  psychic: "cast-psychic",
  rock: "cast-rock",
  ground: "cast-ground",
};

/** Weather and pledge casts have their own sound instead of their element's generic cast. */
const MOVE_CAST_SOUND: Partial<Record<MoveId, SfxName>> = {
  "sunny-day": "cast-sunny-day",
  "rain-dance": "cast-rain-dance",
  sandstorm: "cast-sandstorm",
  "grass-pledge": "cast-grass-pledge",
  "fire-pledge": "cast-fire-pledge",
  "water-pledge": "cast-water-pledge",
  "flare-blitz": "flare-blitz",
};
/** A formed combo's cue by result. */
const PLEDGE_FIELD_SOUND = {
  "sea-of-fire": "field-sea-of-fire",
  rainbow: "field-rainbow",
  swamp: "field-swamp",
} as const satisfies Record<Extract<RunEvent, { t: "pledge" }>["result"], SfxName>;
/** A formation older than the cue (late network delivery) is old news: it stays silent. */
const PLEDGE_CUE_WINDOW_MS = 600;

/** The stage the evolve event reached needs a trade (a confirmed swap or a spent linking cord). */
function isTradeEvolution(starter: StarterId, stage: Stage): boolean {
  const reached = starters[starter].stages[stage]!;
  return reached.kind === "evolve" && reached.needs === "trade";
}

/** A move's slot reading: waiting for a target is ready (its 0.2 s retry is not a cooldown). */
function moveReadiness(move: MoveState, cd: number): { ready: number; cd: number } {
  return { ready: move.waiting ? 1 : 1 - Math.max(0, move.cooldown) / cd, cd };
}

function snapshot(
  world: World,
  playerId: PlayerId,
  seatLooks: readonly boolean[],
  isSeatPresent?: (id: number) => boolean,
): RunSnapshot {
  const player = world.players[playerId]!;
  const stats = playerStats(player, activeWeather(world));
  const boss = world.enemies.find((enemy) => enemy.id === world.bossId);
  const channel = world.sites.find(
    (site) =>
      site.owner === playerId &&
      site.state === "busy" &&
      typeof siteDefs[site.kind].interact === "object",
  );
  const channelRule = channel && siteDefs[channel.kind].interact;
  return {
    time: world.time,
    rules: world.rules,
    hp: player.hp,
    maxHp: stats.maxHp,
    shield: player.shield,
    shieldMax: stats.shield,
    level: player.level,
    xp: player.xp,
    xpNext: player.xpNext,
    kills: player.kills,
    moves: player.moves.map((move) => ({
      id: move.id,
      level: move.level,
      ...moveReadiness(move, moveParams(move, stats, activeWeather(world)).cd),
    })),
    items: player.items.map((item) => ({ ...item })),
    trainer: player.trainer,
    assistReady: player.assistReady,
    dash: 1 - player.dashCooldown / DASH_COOLDOWN,
    dashes: player.dashes,
    dashMax: stats.dashCharges,
    boss: boss
      ? {
          name: enemyDefs[boss.species].name,
          type: enemyDefs[boss.species].types[0]!,
          hp: Math.max(0, boss.hp),
          max: boss.maxHp,
        }
      : null,
    pending: cardShown(player) ? player.pending[0]! : null,
    pendingCount: player.pending.length,
    rescueProgress: player.rescue ? player.rescue.elapsed / COOP.rescueSeconds : null,
    siteProgress:
      channel && typeof channelRule === "object"
        ? Math.min(1, channel.data.progress / channelRule.channel)
        : null,
    weather:
      world.weather && world.time < world.weather.until
        ? {
            id: world.weather.id,
            phase: world.time < world.weather.from ? "forecast" : "active",
            remaining: Math.max(
              0,
              (world.time < world.weather.from ? world.weather.from : world.weather.until) -
                world.time,
            ),
            seconds: world.weather.until - world.weather.from,
          }
        : null,
    evolution: player.stage,
    cardLevel: player.level + 1 - player.pending.filter((card) => card.source === "level").length,
    rerolls: player.rerolls,
    skips: player.skips,
    banishes: player.banishes,
    moveSlots: moveSlots(player),
    itemSlots: itemSlots(player),
    stardust: Math.floor(player.stardust),
    ult: player.ult.charge,
    ultCrisisAt: player.crisis.lastTick === null ? null : player.crisis.lastTick * TICK,
    casting: player.ult.elapsed >= 0,
    ultWindup: player.ult.elapsed < 0 ? 0 : Math.max(0, ULT_WINDUP - player.ult.elapsed),
    ultProtection: player.ult.protection,
    form: formOf(player).id,
    abilitySlot: player.abilitySlot,
    shiny: seatLooks[playerId]!,
    rampage: world.rampage,
    zone: {
      index: world.zone.index,
      count: stageDefs[world.stage].zones.length,
      phase: world.zone.phase,
      time: zoneTime(world),
      finalSwarm: zoneTimeLimit(world),
    },
    stage: world.stage,
    routeStep: routeStep(world),
    ...(world.mode === "tower" ? { floor: world.route.length } : {}),
    exit: nearestExit(world, player),
    outcome: seatOutcome(world, player),
    tmCase: player.tmCase,
    dialog: stationView(world, playerId),
    prompt: interactPrompt(world, player, isSeatPresent),
    team: world.players
      .filter((mate) => mate.id !== playerId && !mate.departed)
      .map((mate) => ({
        slot: mate.id,
        form: formOf(mate).id,
        shiny: seatLooks[mate.id]!,
        level: mate.level,
        hp: Math.max(0, mate.hp),
        maxHp: playerStats(mate, activeWeather(world)).maxHp,
        alive: mate.alive,
      })),
  };
}

/**
 * Owns one run: assets, world, simulation and local input. It is the app renderer's world client:
 * the app's loop advances it and draws it under the UI; it never owns the canvas, loop or size.
 */
export function createRun(
  app: AppRenderer,
  hud: GpuRunHud,
  config: {
    mode: World["mode"];
    /** The lobby starts a fresh run in the forest. */
    stage: StageId;
    route?: readonly StageId[];
    rules: readonly RuleId[];
    starter: StarterId;
    shiny: boolean;
    trainer: TrainerId;
    difficulty: Difficulty;
    lab: LabBonuses;
    bond: number;
    bondLab: number;
    loadout: Loadout;
    sound: boolean;
    /** Developer mode: hitboxes, nav mask, flow arrows and a stats panel. */
    devMode: boolean;
    /** Solo: pause when the window loses focus. */
    pauseOnBlur: boolean;
    /** Solo: level-up cards open at once; off, they wait for the interact key. */
    autoOpenCards: boolean;
    multiplayer?: MultiplayerRun;
  },
  callbacks: RunCallbacks,
): RunHandle {
  const network = config.multiplayer;
  const PLAYER: PlayerId = network?.player ?? 0;
  const seatLooks = network?.config.players.map((seat) => seat.shiny) ?? [config.shiny];
  if (network) network.onError = fail;
  let renderer = app.renderer;
  const grade = createGrade();

  /** Made in the build's first step, a frame after the run screen's commit; nothing reads it before. */
  let world!: World;
  const abort = new AbortController();
  const queue: Command[] = [];
  let actions: ActionInput;
  const stick = { x: 0, z: 0 };
  let assets: RunAssets | undefined;
  let view: RunView | undefined;
  let boundary: BoundaryWall | undefined;
  let debug: DebugOverlay | undefined;
  let healthBars: HealthBars | undefined;
  let minimap: Minimap | undefined;
  let compass: CompassBar | undefined;
  /** Only the pause menu pauses the simulation; the full map stays interactive. */
  let menuPaused = false;
  let mapOpen = false;
  let devMode = config.devMode;
  let pauseOnBlur = config.pauseOnBlur;
  const layers = new Set<DebugLayer>();
  let panel = devMode ? makeReadout() : undefined;
  function makeReadout() {
    return createDevReadout(app.stats, PLAYER, (text) =>
      hud.setDevReadout(`${text}\n${layerLegend(layers)}\nF8 dev   0 clear layers`),
    );
  }
  function syncDebug() {
    debug?.dispose();
    debug = undefined;
    if (devMode && layers.size && view) {
      debug = createDebugOverlay(
        world,
        PLAYER,
        layers,
        (x, z) => view!.debugHeight(x, z),
        hud.stage,
        (x, y, z) => view!.project(x, y, z, width, height),
      );
      view.scene.add(debug.root);
    }
    canvasStale = true;
  }
  const runLog = import.meta.env.DEV
    ? createRunLog({
        stage: config.stage,
        starter: config.starter,
        difficulty: config.difficulty,
        lab: config.lab,
        loadout: config.loadout,
      })
    : undefined;
  let disposed = false;
  let failed = false;
  let accumulator = 0;
  let snapshotTimer = 0;
  let lastSnapshot = "";
  let lastPending: PendingChoice | null = null;
  let lastDialog: World["players"][number]["dialog"] = null;
  let ended = false;
  /**
   * A frozen world (pause, card, station, stats, full map) draws the same picture every frame, so
   * it asks for no redraw. It asks again on events, a camera move, a resize or restore, and as soon
   * as the world runs again.
   */
  let canvasStale = true;
  let wasFrozen = false;
  const drawnCamera = new Matrix4();
  let width = 1;
  let height = 1;
  /** Camera yaw around the player; Q/E rotate it and movement input follows the view. */
  let yaw = 0;
  let touchTurn = 0;
  const audio = getAudio();
  audio.setEnabled(config.sound);
  /** Real-time end of the current hit-stop; only the newest stop decides when time resumes. */
  let hitStopUntil = 0;
  let hitStopScale = 1;
  let candyChain = 0;
  let lastCandy = 0;

  /** The world camera follows the UI host's one resize (CSS pixels); the app owns the canvas. */
  function setViewSize(cssWidth: number, cssHeight: number): void {
    width = Math.max(1, cssWidth);
    height = Math.max(1, cssHeight);
    canvasStale = true;
    if (view) {
      view.camera.aspect = width / height;
      view.camera.updateProjectionMatrix();
    }
  }
  // Released while the old context is lost, before three replaces its managers (docs/LESSONS.md).
  const unregisterResident = app.resident({
    release() {
      syncFieldAmbience(audio, world, false);
      view?.releaseUploads();
      assets?.releaseUploads();
      minimap?.releaseUploads();
      compass?.releaseUploads();
      // A lost context pauses the run (readiness design D2), as losing focus does: the pause window
      // is up when the picture returns, instead of play resuming under the player's thumbs. An
      // ended run (its hold, its result) is left alone.
      // Co-op never pauses for one player: the shared world keeps running for the others.
      if (network) cancelInput();
      else if (started && !ended && world.outcome === "playing") callbacks.onPauseRequest("pause");
    },
    restore() {
      renderer = app.renderer;
      minimap?.restore();
      compass?.restore();
      canvasStale = true;
    },
  });
  let releaseWorld = () => {};
  let stopWaiting = () => {};
  /** The end hold still to play, in drawn frames' time: a context loss or hidden page pauses it. */
  let holdLeftMs = Infinity;
  let reported = false;
  /** Drawn and ready; before it nothing settles (a run still loading has no result). */
  let started = false;
  /** The next zone's field and pictures are being readied: no tick runs until they are. */
  let changingZone = false;
  let committed = false;
  let deploymentDone = Boolean(network?.session.restored);
  let deployment: { elapsed: number; done: () => void; cue?: TrainerCue } | undefined;
  let nextDialogue = 45;
  let dialogueIndex = 0;
  const trainerFor = (player: PlayerId): TrainerId => world.players[player]!.trainer;
  /** The cue fields that name who speaks: their trainer, partner type and seat. */
  const speaker = (player: PlayerId) => ({
    trainer: trainerFor(player),
    type: formOf(world.players[player]!).types[0]!,
    local: player === PLAYER,
    seat: network ? player : null,
  });
  function speak(text: string, ageMs = 0): void {
    if (world.time < nextDialogue || menuPaused || mapOpen || callbacks.inputBlocked()) return;
    if (hud.trainers.show({ kind: "dialogue", text, ...speaker(PLAYER) }, ageMs))
      nextDialogue = world.time + 35;
  }

  /** Screen-space input (x right, z down) rotated into world space by the camera yaw. */
  function moveInput(): [number, number] {
    const x = stick.x;
    const z = stick.z;
    // Screen x follows the camera's right, screen z (down) its back.
    const [rx, rz] = cameraRight(yaw);
    const [fx, fz] = cameraForward(yaw);
    return [x * rx - z * fx, x * rz - z * fz];
  }

  /** The full map is a view over a running world: movement and actions keep working under it. */
  function setFullMap(open: boolean): void {
    if (open === mapOpen || !minimap) return;
    if (open && (menuPaused || isFrozen(world) || world.outcome !== "playing")) return;
    mapOpen = open;
    if (open) syncFieldAmbience(audio, world, false);
    minimap.setFullMap(open);
    callbacks.onMapChange(open);
  }

  const cancelInput = () => {
    actions?.cancel();
    touchTurn = 0;
    stick.x = stick.z = 0;
    for (let i = queue.length - 1; i >= 0; i--)
      if (["move", "view", "dash", "ult", "assist", "interact"].includes(queue[i]!.t))
        queue.splice(i, 1);
    if (network && !network.host && started && !disposed)
      network.submit([{ t: "move", player: PLAYER, x: 0, z: 0 }]);
  };
  if (network)
    network.resetInput = () => {
      cancelInput();
      network.submit(queue.splice(0));
      accumulator = 0;
    };
  /** Pausing is single-player only; in co-op the menu is a window over the running world. */
  function queuePause(paused: boolean) {
    if (!network) queue.push({ t: "pause", paused });
  }

  function fail(error: Error) {
    if (disposed || failed) return;
    failed = true;
    syncFieldAmbience(audio, world, false);
    deployment?.done();
    deployment = undefined;
    hud.trainers.clear();
    cancelInput();
    queue.length = 0;
    if (network && !network.session.state.error) network.session.fail(error);
    callbacks.onError(error);
  }

  const keyDown = (code: string, repeat: boolean): boolean => {
    // Nothing to steer until the run is drawn and ready.
    if (!started || failed) return false;
    // Dev keys: ` pages the readout, F9 saves the run log (over a modal window the host keeps its
    // keys; `window.__poketoneRunLog.download()` saves it there).
    if (code === "Backquote" && panel) {
      if (!repeat) panel.nextPage();
      return true;
    }
    if (devMode && (code === "Digit0" || /^Digit[1-8]$/.test(code))) {
      if (!repeat) {
        const layer = debugLayers[Number(code.slice(-1)) - 1];
        if (!layer) layers.clear();
        else if (layers.has(layer)) layers.delete(layer);
        else layers.add(layer);
        syncDebug();
      }
      return true;
    }
    if (code === "F9" && runLog) {
      if (!repeat) runLog.download();
      return true;
    }
    return false;
  };
  function action(action: GameplayAction) {
    if (!started || failed || callbacks.inputBlocked()) return;
    if (mapOpen && (action === "map" || action === "back" || action === "pause")) {
      setFullMap(false);
      if (action !== "pause") return;
    }
    if (action === "map") setFullMap(true);
    else if (action === "stats" && !menuPaused && !isFrozen(world)) callbacks.onStatsRequest();
    else if (
      action === "pause" &&
      !cardShown(world.players[PLAYER]!) &&
      !world.players[PLAYER]?.dialog
    )
      callbacks.onPauseRequest("toggle");
    else if (["dash", "ult", "assist", "interact"].includes(action) && !isFrozen(world))
      queue.push({ t: action as "dash" | "ult" | "assist" | "interact", player: PLAYER });
  }
  const blur = () => {
    cancelInput();
    if (pauseOnBlur && !network && started && world.outcome === "playing")
      callbacks.onPauseRequest("pause");
  };

  /** Freeze-frame for heavy impacts (Sakurai / Vlambeer "sleep"). */
  function hitStop(seconds: number, scale: number): void {
    const until = performance.now() + seconds * 1000;
    if (until <= hitStopUntil) return;
    hitStopUntil = until;
    hitStopScale = scale;
  }

  function flashHurt(): void {
    hud.flinch();
  }

  /**
   * The one wind-up sound a batch plays: a red one within earshot wins over blue ones, so a swarm's
   * blue tells never cover the attack that matters (the threat-first idea of Overwatch's mix).
   */
  function loudestTell(events: RunEvent[]): SfxName | null {
    const self = world.players[PLAYER]!;
    let sound: SfxName | null = null;
    for (const event of events) {
      if (event.t !== "tell" || sound === "tell-danger") continue;
      const enemy = world.enemies.find((e) => e.id === event.enemy);
      if (!enemy || Math.hypot(enemy.x - self.x, enemy.z - self.z) >= TELL_EARSHOT) continue;
      sound = event.severity === "danger" ? "tell-danger" : "tell";
    }
    return sound;
  }

  /** One feedback bundle per event, scaled by importance tier (docs/GAME-FEEL.md). */
  function drain(events: RunEvent[]): void {
    const fieldVisible = app.available && !menuPaused && !mapOpen && !callbacks.inputBlocked();
    const fieldSounds = new Set<SfxName>();
    // The weather this player's own cast just set brings the cast sound; its onset cue would double it.
    const castWeathers = new Set<WeatherId>(
      events.flatMap((e) =>
        e.t === "cast" && e.player === PLAYER && isWeatherMove(e.move)
          ? [weatherMoves[e.move].weather]
          : [],
      ),
    );
    if (fieldVisible)
      for (const event of events)
        if (
          (event.t === "weather" && !(event.phase === "start" && castWeathers.has(event.id))) ||
          event.t === "site" ||
          event.t === "shiny" ||
          event.t === "shiny-caught"
        ) {
          const sound = playFieldEvent(
            audio,
            event,
            world,
            PLAYER,
            network?.eventAgeMs(event) ?? 0,
          );
          if (sound) fieldSounds.add(sound);
        }
    const hatching = events.some(
      (event) =>
        event.t === "site" &&
        event.kind === "egg" &&
        event.phase === "complete" &&
        event.player === PLAYER,
    );
    // A big moment brings its own sound; the generic boss or level cue would stack on top of it.
    const hasOwnSound = events.some(
      (e) => (e.t === "death" && e.elite) || (e.t === "capture" && e.player === PLAYER),
    );
    const evolving = events.some((e) => e.t === "evolve" && e.player === PLAYER);
    // These impacts already include a cartoon crumble; a generic kill pop would double the hit.
    const stoneHits = new Set(
      events.flatMap((e) =>
        (e.t === "hit" || e.t === "contact") && (e.type === "rock" || e.type === "ground")
          ? [`${e.x},${e.z}`]
          : [],
      ),
    );
    const hasRockContact = events.some(
      (e) => ((e.t === "hit" && !e.confirmedContact) || e.t === "contact") && e.type === "rock",
    );
    const tell = loudestTell(events);
    if (tell && !fieldSounds.has("tell-voltorb")) audio.sfx(tell);
    const dangers = new Map<keyof typeof dangerLabels, { text: string; ageMs: number }>();
    const notify = (event: RunEvent, text: string, tone: "info" | "danger" | "reward") => {
      callbacks.onBanner(text, tone, network?.eventAgeMs(event) ?? 0);
    };
    for (const event of events) {
      switch (event.t) {
        case "banner":
          if (
            event.tone === "boss" &&
            !hasOwnSound &&
            event.kind !== "capture" &&
            (event.kind !== "fusion" || event.player === PLAYER)
          )
            audio.sfx("boss");
          else if (event.tone === "danger" && event.kind !== "weather") audio.sfx("danger");
          switch (event.kind) {
            case "fusion":
              if (event.player !== PLAYER) break;
              notify(event, event.text, "reward");
              break;
            case "clear":
              notify(event, event.text, "reward");
              speak(trainers[trainerFor(PLAYER)].clear, network?.eventAgeMs(event) ?? 0);
              break;
            case "alpha":
            case "elite-wave":
            case "swarm":
            case "stampede":
            case "horde":
            case "outbreak":
            case "eruption": {
              const ageMs = network?.eventAgeMs(event) ?? 0;
              if (ageMs < RUN_NOTICE_MS.danger)
                dangers.set(event.kind, { text: event.text, ageMs });
              break;
            }
            case "zone":
              notify(event, event.text, "info");
              break;
            case "weather":
              if (fieldVisible) notify(event, event.text, "danger");
              break;
          }
          break;
        case "shiny":
          if (fieldVisible) notify(event, `异色 ${enemyDefs[event.species].name}！`, "reward");
          break;
        case "evade":
          // The local player's dodge floats over them, like their own hits do.
          if (event.player !== PLAYER) break;
          // A dodge or block is a near miss: the soft dash whoosh, never a combat beep.
          audio.sfx("dash");
          if (view) {
            const dodger = world.players.find((player) => player.id === event.player);
            if (dodger) hud.numbers.spawnEvade(dodger.x, dodger.z);
          }
          break;
        case "hit":
          // Only this player's damage floats; a partner's numbers belong on their screen.
          if (view && event.by === PLAYER)
            hud.numbers.spawn(event.x, event.z, event.amount, event.crit, event.weak, event.enemy);
          if (event.confirmedContact) break;
          {
            const hit = HIT_SOUND[event.type] ?? "hit";
            const stone = event.type === "rock" || event.type === "ground";
            audio.sfx(event.crit && !stone ? "crit" : hit, {
              pitch: event.weak ? 0.8 : 1,
              gainDb: stone && event.crit ? 1.5 : 0,
              fallback: event.crit && !stone ? hit : undefined,
            });
          }
          break;
        case "reaction": {
          const point = view?.project(event.x, 1.3, event.z, width, height);
          if (point && point[0] >= 0 && point[0] <= width && point[1] >= 0 && point[1] <= height)
            hud.numbers.spawnReaction(event.x, event.z, event.reaction);
          audio.sfx("reaction");
          break;
        }
        case "contact":
          audio.sfx(HIT_SOUND[event.type] ?? "hit");
          break;
        case "projectile-feedback":
          // Misses still thud. A confirmed hit supplies its own weak/crit weight instead; the
          // family cooldown merges the other landings in the volley.
          if (
            event.move === "rock-throw" &&
            event.ended &&
            !hasRockContact &&
            (event.reason === "burst" || event.reason === "terrain")
          )
            audio.sfx("hit-rock");
          break;
        case "status-built":
          if (event.status === "freeze") audio.sfx("freeze");
          break;
        case "heal":
          // A heal is a reward, so it shares the berry chime; only the healed player hears it.
          if (event.player === PLAYER) audio.sfx("berry");
          break;
        case "heal-pulse": {
          // An enemy healer's breath, heard within a tell's earshot; it swells as the ring grows.
          const self = world.players[PLAYER]!;
          if (Math.hypot(event.x - self.x, event.z - self.z) < TELL_EARSHOT)
            audio.sfx("enemy-heal", { keyMs: HEAL_KEY_MS });
          break;
        }
        case "item-burst":
          // The reaction cooldown merges a burst of item procs into one sound.
          audio.sfx("reaction");
          break;
        case "death":
          if (event.elite) {
            audio.sfx("elite-kill");
            const guardian = event.species === zoneDef(world).guardian.species;
            hitStop(guardian ? 0.35 : 0.09, guardian ? 0.15 : 0.05);
          } else if (!stoneHits.has(`${event.x},${event.z}`)) {
            audio.sfx("kill");
          }
          break;
        case "route":
          if (event.kind === "exit") audio.sfx("exit-pick");
          else if (event.player === PLAYER && event.kind === "deal") audio.sfx("gengar-deal");
          else if (event.player === PLAYER && event.kind === "trophy") audio.sfx("trophy");
          break;
        case "pickup":
          if (event.kind === "xp") {
            const now = performance.now();
            candyChain = now - lastCandy < 450 ? candyChain + 1 : 0;
            lastCandy = now;
            // A lone candy is soft; a chain swells to full level as it climbs in pitch.
            const step = Math.min(candyChain, CANDY_CHAIN_STEPS);
            audio.sfx("candy", {
              pitch: 1 + step * 0.05,
              gainDb:
                CANDY_DB.start + (CANDY_DB.full - CANDY_DB.start) * (step / CANDY_CHAIN_STEPS),
            });
          } else if (event.kind === "stardust") {
            // No asset of its own yet: the candy chime, raised a little above a candy chain's start.
            audio.sfx("candy", { pitch: 1.2, gainDb: CANDY_DB.full });
          } else {
            if (event.kind === "chest") audio.sfx("chest", { keyMs: CHEST_KEY_MS });
            else audio.sfx("berry");
          }
          break;
        case "evolve":
          if (event.player !== PLAYER) break;
          // Heavy beat without a pause: a short freeze, the banner and the new model.
          hitStop(0.3, 0.05);
          audio.sfx(
            isTradeEvolution(world.players[PLAYER]!.starter, event.stage)
              ? "trade-evolve"
              : "evolve",
            { keyMs: EVOLVE_SWAP_MS },
          );
          notify(event, evolveBanner(world.players[PLAYER]!.starter, event.stage), "reward");
          speak(trainers[trainerFor(PLAYER)].evolve, network?.eventAgeMs(event) ?? 0);
          break;
        case "mega":
          if (event.player !== PLAYER) break;
          // Freezes like evolving; the sound waits for the shell to break (after the view's frame).
          hitStop(0.3, 0.05);
          notify(event, `超级进化！${formOf(world.players[PLAYER]!).name}`, "reward");
          speak(trainers[trainerFor(PLAYER)].evolve, network?.eventAgeMs(event) ?? 0);
          break;
        case "ult":
          hud.trainers.show(
            {
              kind: "ultimate",
              text:
                event.player === PLAYER
                  ? trainers[trainerFor(event.player)].ultimate
                  : ultimateCall(event.line, event.stage),
              ...speaker(event.player),
            },
            network?.eventAgeMs(event) ?? 0,
          );
          break;
        case "assist":
          // Its sound starts where the throw is drawn popping (`view.assistPops`, below).
          hud.trainers.show(
            { kind: "assist", text: assistCall(event.item), ...speaker(event.player) },
            network?.eventAgeMs(event) ?? 0,
          );
          break;
        case "ult-release":
          if ((network?.eventAgeMs(event) ?? 0) >= ULT_RELEASE_CUE.late) break;
          hud.trainers.release(
            network ? event.player : null,
            event.player === PLAYER,
            network?.eventAgeMs(event) ?? 0,
          );
          if (event.player !== PLAYER) break;
          hitStop(0.12, 0.1);
          audio.sfx("ult");
          break;
        // Feedback about one player (sound, banner, hit-stop, hurt flash) is for that player only.
        case "level":
          if (event.player === PLAYER && !evolving) audio.sfx("level");
          break;
        case "dash":
          if (event.player === PLAYER) audio.sfx("dash");
          break;
        case "capture":
          if (event.player !== PLAYER) break;
          notify(
            event,
            `${event.source === "egg" ? "孵化" : "捕获"} ${enemyDefs[event.species].name}！`,
            "reward",
          );
          if (!hatching) audio.sfx("capture");
          hitStop(0.15, 0.1);
          break;
        case "revive":
          if (event.player !== PLAYER) break;
          notify(
            event,
            event.item ? `${items[event.item].name}！` : event.team ? "重新归队！" : "活力碎片！",
            "reward",
          );
          audio.sfx("revive");
          speak(trainers[trainerFor(PLAYER)].revive, network?.eventAgeMs(event) ?? 0);
          hitStop(0.3, 0.1);
          break;
        case "bond-endure":
          if (event.player === PLAYER) notify(event, "挺住！", "reward");
          break;
        case "bond-cure":
          if (event.player === PLAYER) notify(event, "自己治好！", "reward");
          break;
        case "down": {
          // Reliable playback can arrive after a team revive or departure.
          const downed = world.players[event.player]!;
          if (event.player === PLAYER || downed.alive || downed.departed) break;
          const name = stageForm(downed.starter, downed.stage).name;
          notify(event, `P${event.player + 1} ${name} 倒地`, "danger");
          break;
        }
        case "player-hit":
          if (event.player !== PLAYER) break;
          audio.sfx("hurt");
          flashHurt();
          break;
        case "pledge": {
          const ageMs = network?.eventAgeMs(event) ?? 0;
          if (ageMs < PLEDGE_CUE_WINDOW_MS)
            audio.sfx(PLEDGE_FIELD_SOUND[event.result], {
              keyMs: -ageMs,
              maxMs: PLEDGE_CUE_WINDOW_MS - ageMs,
            });
          break;
        }
        case "cast": {
          if (event.player !== PLAYER) break;
          const move = moves[event.move];
          const name = MOVE_CAST_SOUND[event.move] ?? CAST_SOUND[move.type];
          if (!name || !archetypes[move.archetype].heavy) break;
          // The sound follows the shot or strike, not the cast.
          audio.sfx(name, { keyMs: event.windup * 1000 });
          break;
        }
        case "buff":
          // A buff that answers a hit is a small reward: the berry chime, raised so it reads apart
          // from a heal. Buffs cued by the player's own action (standing still, dashing, the
          // ultimate) fire too often or already have their sound, so they only show.
          if (event.player === PLAYER && event.on === "hurt") audio.sfx("berry", { pitch: 1.15 });
          break;
        case "peer": {
          const name = stageForm(
            world.players[event.player]!.starter,
            world.players[event.player]!.stage,
          ).name;
          if (event.state === "online") notify(event, `${name} 已重连`, "info");
          else
            notify(event, event.state === "left" ? `${name} 离开了对局` : `${name} 断线`, "danger");
          break;
        }
        case "partner-guard":
          // The partner blocks for its owner: a near miss, so the evade's soft whoosh.
          if (world.partners.find((partner) => partner.id === event.partner)?.owner === PLAYER)
            audio.sfx("dash");
          break;
        default:
          break;
      }
    }
    if (dangers.size) {
      const newestAge = Math.min(...[...dangers.values()].map((entry) => entry.ageMs));
      // A late reliable batch can contain several generations; only combine the newest 100 ms.
      const entries = [...dangers].filter(([, entry]) => entry.ageMs <= newestAge + 100);
      callbacks.onBanner(
        entries.length === 1
          ? entries[0]![1].text
          : entries.map(([kind]) => dangerLabels[kind]).join(" · "),
        "danger",
        Math.max(...entries.map(([, entry]) => entry.ageMs)),
      );
    }
  }

  /** One app frame: input, fixed-step simulation, view interpolation and HUD data. True when the
   *  world's picture changed. */
  let advancedAt = performance.now();
  if (network?.host)
    // A hidden host page stops drawing frames; guest traffic keeps the shared world running.
    network.onPacket = () => {
      const now = performance.now();
      if (started && now - advancedAt > 100) advance(now - advancedAt);
    };
  function advance(deltaMs: number): boolean {
    advancedAt = performance.now();
    if (disposed || failed || !view || changingZone) return false;
    if (deployment) {
      if (callbacks.inputBlocked()) return false;
      // The cut-in's clock starts with the first frame the player can see, not under the cover.
      if (deployment.cue) hud.trainers.show(deployment.cue);
      deployment.cue = undefined;
      deployment.elapsed = Math.min(DEPLOYMENT_MS, deployment.elapsed + Math.min(deltaMs, 100));
      view.setDeployment(deployment.elapsed);
      view.frame(1, 0, [], yaw);
      if (deployment.elapsed >= DEPLOYMENT_MS) {
        const done = deployment.done;
        deployment = undefined;
        deploymentDone = true;
        view.setDeployment(null);
        done();
      }
      return true;
    }
    if (!started) return canvasStale;
    if (network?.host) network.restoreHost(world);
    if (network?.suspended) {
      syncFieldAmbience(audio, world, false);
      cancelInput();
      network.submit(queue.splice(0));
      accumulator = 0;
      const incoming = network.takeMap();
      if (incoming) void changeZone(incoming);
      return false;
    }
    const dt = Math.min(Math.max(deltaMs / 1000, 0), 0.1);
    const blocked = callbacks.inputBlocked();
    if (blocked) {
      touchTurn = 0;
      stick.x = stick.z = 0;
    }
    const turn = touchTurn;
    const running = world.outcome === "playing";
    if (!isFrozen(world) && running && turn !== 0) {
      yaw = turnYaw(yaw, turn, dt);
      queue.push({ t: "view", player: PLAYER, yaw });
    }
    const [mx, mz] = blocked ? [0, 0] : moveInput();
    queue.push({ t: "move", player: PLAYER, x: mx, z: mz });
    const simStart = performance.now();
    const stopped = simStart < hitStopUntil;
    const simDt = stopped ? dt * hitStopScale : dt;
    const takeCommands = () => (network ? network.submit(queue.splice(0)) : queue.splice(0));
    if (network && !network.host) {
      takeCommands();
      network.apply(world, dt);
      accumulator = 0;
    } else if (!running) {
      // An ended run takes no more input.
      queue.length = 0;
      accumulator = 0;
    } else if (isFrozen(world)) {
      if (network) network.step(world, takeCommands());
      else stepWorld(world, takeCommands());
      accumulator = 0;
    } else {
      accumulator += simDt;
      let steps = 0;
      while (accumulator >= TICK && steps < MAX_STEPS_PER_FRAME) {
        const commands = steps === 0 ? takeCommands() : [];
        if (network) network.step(world, commands);
        else stepWorld(world, commands);
        accumulator -= TICK;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
    }
    const simMs = performance.now() - simStart;
    const events = world.events.splice(0);
    const sharedEvents = events.slice();
    if (network?.host) events.push(...network.takeEvents());
    runLog?.observe(world, events);
    drain(events);
    if (!isFrozen(world) && world.outcome === "playing" && world.time >= nextDialogue) {
      const lines = trainers[trainerFor(PLAYER)].lines[trainerTier(world.players[PLAYER]!.bond)];
      speak(lines[dialogueIndex++ % lines.length]!);
      nextDialogue = world.time + 55;
    }
    network?.publish(
      world,
      sharedEvents,
      dt,
      (world.outcome !== "playing" && !ended) || world.zone.phase === "transitioning",
    );
    const incomingMap = network?.takeMap();
    if (incomingMap || (world.zone.phase === "transitioning" && (!network || network.host))) {
      void changeZone(incomingMap);
      return false;
    }
    const remotePlayerSpeeds = network?.host ? network.presentHost(world) : undefined;
    if (ended && holdLeftMs > 0) {
      holdLeftMs -= deltaMs;
      if (holdLeftMs <= 0) report(resultFor(world, PLAYER));
    }
    // An ended run plays its end out, then holds its last picture under the result window, as a
    // paused one does.
    const frozen = isFrozen(world) || (world.outcome !== "playing" && holdLeftMs <= 0);
    const alpha = frozen ? 1 : network && !network.host ? network.alpha() : accumulator / TICK;
    const viewStart = performance.now();
    const subjectId = view.frame(alpha, frozen ? 0 : simDt, events, yaw, remotePlayerSpeeds);
    if (view.megaShatters.includes(PLAYER)) audio.sfx("mega-evolve");
    // Heard by the thrower and by whoever the sim says it reached, hitting on the drawn pop.
    for (const pop of view.assistPops)
      if (pop.player === PLAYER || pop.to.includes(PLAYER))
        audio.sfx(ASSIST_SOUND[pop.item], { keyMs: -pop.late * 1000 });
    const self = world.players[PLAYER]!;
    const subject = world.players[subjectId]!;
    const viewYaw = subject === self ? yaw : subject.viewYaw;
    boundary?.update(subject.x, subject.z, frozen ? 0 : dt);
    debug?.update(world);
    healthBars?.update(world, PLAYER, frozen ? 0 : simDt, {
      camera: view.camera,
      enemies: view.drawn.enemies,
      players: view.drawn.players,
      events,
    });
    minimap?.update(world, alpha, viewYaw, frozen ? 0 : dt, subjectId);
    compass?.update(world, alpha, viewYaw, frozen ? 0 : dt, subjectId);
    hud.updateIndicators(world, PLAYER, view.camera, alpha, dt);
    const viewMs = performance.now() - viewStart;
    const still = view.camera.matrixWorld.equals(drawnCamera);
    const changed = !frozen || !wasFrozen || canvasStale || events.length > 0 || !still;
    wasFrozen = frozen;
    panel?.frame(dt, simMs, viewMs, world);
    hud.numbers.update(dt, (x, y, z) => view!.project(x, y, z, width, height));

    snapshotTimer -= dt;
    const pending = cardShown(self) ? self.pending[0]! : null;
    const playing = world.outcome === "playing";
    // After the run ends, one last snapshot (below, before `ended` flips) is enough for the HUD.
    if (
      (snapshotTimer <= 0 && playing) ||
      pending !== lastPending ||
      self.dialog !== lastDialog ||
      (!playing && !ended)
    ) {
      snapshotTimer = 0.1;
      lastPending = pending;
      lastDialog = self.dialog;
      const snap = snapshot(world, PLAYER, seatLooks, network?.isSeatPresent);
      // A paused world (open window) yields the same snapshot every 0.1 s; republishing it would
      // re-run the HUD and keep the UI canvas redrawing for nothing.
      const key = JSON.stringify(snap);
      if (key !== lastSnapshot) {
        lastSnapshot = key;
        callbacks.onSnapshot(snap);
      }
      // The guardian is the only boss on the world; its fight has its own track.
      if (playing) audio.music.play(snap.boss ? "boss" : "run");
    }
    syncFieldAmbience(
      audio,
      world,
      app.available && !callbacks.inputBlocked() && !menuPaused && !mapOpen && !isFrozen(world),
    );
    settle();
    return changed;
  }

  /** Draws into the bound world target (the app renderer binds it and restores the canvas). */
  function draw(target: WebGLRenderer): void {
    if (!view) return;
    target.setClearColor(view.background, 1);
    target.clear(true, true, true);
    applyWorldOutput(view.scene);
    target.render(view.scene, view.camera);
    drawnCamera.copy(view.camera.matrixWorld);
    canvasStale = false;
  }

  /**
   * The end event, once: music stops and the sting plays at once (timed to the end, not to the
   * window). A natural end reports the result after the hold; a forfeit (`hold: false`, the player
   * is leaving) reports it now, whether or not frames run.
   */
  function settle(hold = true): void {
    if (world.outcome === "playing") return;
    if (!ended) {
      ended = true;
      syncFieldAmbience(audio, world, false);
      audio.music.play(null);
      // The guardian's fall freezes the screen for 0.35 s; the victory sting lands after the freeze,
      // not on the elite-kill sound (whose tail still overlaps its start).
      const won = seatOutcome(world, world.players[PLAYER]!) === "victory";
      audio.sfx(won ? "victory" : "defeat", {
        keyMs: won ? 350 : 250,
      });
      holdLeftMs = hold ? END_HOLD_MS : 0;
    }
    if (!hold) {
      holdLeftMs = 0;
      report(resultFor(world, PLAYER));
    }
  }

  function report(result: RunResult): void {
    if (reported || disposed) return;
    reported = true;
    callbacks.onEnd(result);
  }

  // Every player's forms load with the run (loadRunAssets), so evolving never waits on the network.
  // The lobby holds this stage's shared set and the line across runs (`prefetch.select`), so the
  // next run reuses them.
  bindModelStore(app);
  // The run's own hold on its sound, decoded while it builds; the boss track decodes in the
  // background during the run, long before the guardian (8:30).
  const runSounds = audio.acquire(RUN_SOUNDS, "critical");
  // The rotation's next run track; the music player holds it from the start on (and frees it
  // when the rotation turns), so this hold ends there.
  const runTrack = audio.acquire([`music:${audio.music.runTrack()}`], "critical");
  const bossTrack = audio.acquire(["music:boss"], "background");
  // Awaited when the run gets ready; a failure before that must not surface as unhandled.
  for (const held of [runSounds, runTrack, bossTrack]) held.result.catch(() => {});
  void build();

  /**
   * The run's construction under the loading cover (readiness design §3.2), in steps driven a
   * budget per frame (`prepare/steps.ts`): world, assets, view, minimap bake, then the warm. No step
   * is a frame-long task; a dispose between steps abandons the rest.
   */
  async function build(): Promise<void> {
    try {
      // Off the run screen's commit and its frame: the sim's world generation is a task of its own.
      await afterFrame();
      if (disposed) return;
      world =
        network && !network.host
          ? await network.initial()
          : createWorldFromSeeds(
              {
                stage: config.stage,
                mode: network?.config.mode ?? config.mode,
                rules: network?.config.rules ?? config.rules,
                unlocks: network?.config.unlocks ?? config.loadout.unlocks,
                route: network?.config.route ?? config.route,
                difficulty: config.difficulty,
                players: network?.config.players ?? [
                  {
                    starter: config.starter,
                    trainer: config.trainer,
                    shiny: config.shiny,
                    lab: config.lab,
                    bond: config.bond,
                    bondLab: config.bondLab,
                    ...config.loadout,
                  },
                ],
              },
              () => crypto.getRandomValues(new Uint32Array(1))[0]!,
            );
      if (disposed) return;
      if (network) bindCoopSettlement(network, world, report);
      callbacks.onLoadStage?.(world.stage);
      callbacks.onLoadProgress?.(0.05);
      network?.loading(world);
      if (network?.host) network.publishMap(world);
      // Dev-only handle for browser checks (fast-forward to the boss, force outcomes). Stripped from builds.
      // The run log stays on the window after the run, for an export from the result screen.
      if (import.meta.env.DEV)
        Object.assign(window, { __poketoneWorld: world, __poketoneRunLog: runLog });
      const loaded = await loadRunAssets(world, abort.signal, assetProgress, seatLooks);
      if (disposed) return loaded.dispose();
      assets = loaded;
      healthBars = createHealthBars();
      if (!(await buildScene(loaded))) return;
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    await start();
  }

  /**
   * Everything drawn from the world's current map: the run view, its boundary wall, the minimap and
   * compass, the dev overlay. False when the run was disposed on the way.
   */
  /** Asset files are the load's first 60%; view, map, warm and uploads the rest. */
  function assetProgress(settled: number, total: number): void {
    if (!disposed) callbacks.onLoadProgress?.(0.05 + (0.55 * settled) / total);
  }

  async function buildScene(loaded: RunAssets): Promise<boolean> {
    const built = await drive(
      createRunView(world, loaded, PLAYER, app.surface.display.coarsePointer),
      { live: () => !disposed },
    );
    if (disposed) {
      built.dispose();
      return false;
    }
    view = built;
    callbacks.onLoadProgress?.(0.7);
    boundary = createBoundaryWall(world.map.terrain, stageThemes[world.stage].edge);
    view.scene.add(boundary.mesh, grade.vignette, healthBars!.mesh);
    const base = await drive(bakeMap(world), { live: () => !disposed });
    if (disposed) {
      base.dispose();
      return false;
    }
    minimap = createMinimap(hud.stage, hud.mapSlot, world, PLAYER, base);
    callbacks.onLoadProgress?.(0.75);
    compass = createCompassBar(hud.stage, hud.compassSlot, world, PLAYER);
    const viewport = hud.stage.viewport;
    resizeUi(viewport.width * viewport.scale, viewport.height * viewport.scale, viewport.scale, {
      top: viewport.safeArea.top * viewport.scale,
      right: viewport.safeArea.right * viewport.scale,
      bottom: viewport.safeArea.bottom * viewport.scale,
      left: viewport.safeArea.left * viewport.scale,
    });
    syncDebug();
    setViewSize(width, height);
    return true;
  }

  /** Frees what `buildScene` made (the health bars and grade outlive it). */
  function disposeScene(): void {
    hud.numbers.clear();
    debug?.dispose();
    minimap?.dispose();
    compass?.dispose();
    boundary?.dispose();
    view?.dispose();
    debug = minimap = compass = boundary = view = undefined;
  }

  /**
   * The team left a zone (the world holds `transitioning`): under the loading cover the next zone's
   * field is assembled and committed between ticks, its pictures are built and warmed, and only then
   * does the next tick run, so nothing plays on a half-made field and no fight is made up afterwards.
   */
  async function changeZone(incoming?: World): Promise<void> {
    if (changingZone) return;
    changingZone = true;
    syncFieldAmbience(audio, world, false);
    hud.trainers.clear();
    callbacks.onZoneLoading(true, incoming?.stage ?? nextField(world)?.stage ?? world.stage);
    callbacks.onLoadProgress?.(0);
    try {
      await afterFrame();
      if (disposed) return;
      const next = incoming ? null : prepareZone(world);
      const previousStage = world.stage;
      // The old pictures go before the new are built: both would mount the same player rigs.
      if (app.available && view) app.retainWorldPrograms(view.scene);
      disposeScene();
      if (incoming) {
        network?.loading(incoming);
        Object.assign(world, incoming);
      } else {
        enterZone(world, next!);
        network?.loading(world);
        if (network?.host) network.publishMap(world);
      }
      if (world.stage !== previousStage) {
        assets?.dispose();
        assets = await loadRunAssets(world, abort.signal, assetProgress, seatLooks);
        if (disposed) return assets.dispose();
      }
      if (!(await buildScene(assets!))) return;
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    await start();
  }

  /**
   * The run warm (readiness design §3.2) and readiness, in a context that can draw: programs compile
   * in parallel first (KHR_parallel_shader_compile), then one real draw of everything the run can
   * show, every pre-mounted form and a shadow render included. Its programs are then pinned, so
   * evolving, the guardian and the next run compile nothing. A loss on the way waits for the restore.
   */
  async function start(): Promise<void> {
    if (disposed || failed || !view) return;
    if (!app.available) {
      stopWaiting = app.subscribe(() => {
        if (!app.available) return;
        stopWaiting();
        void start();
      });
      return;
    }
    const generation = app.generation;
    const current = () => !disposed && !failed && app.available && app.generation === generation;
    try {
      view.warmSet(true);
      applyWorldOutput(view.scene);
      await app.inWorldTarget(() => renderer.compileAsync(view!.scene, view!.camera));
      if (disposed) return;
      callbacks.onLoadProgress?.(0.85);
      if (app.generation !== generation || !app.available) return void start();
      // First uploads one texture a step, so the warm draw is not also every upload at once.
      // A dispose stops them; a loss stops them too, and the restore starts the warm over.
      await drive(uploadSteps(view.scene), { live: current });
      app.inWorldTarget(() => draw(renderer));
      view.warmSet(false);
      app.retainWorldPrograms(view.scene);
      if (!changingZone) await Promise.all([runSounds.result, runTrack.result, hud.trainers.ready]);
      if (!current()) return void start();
      callbacks.onLoadProgress?.(1);
      if (!changingZone && !committed) {
        callbacks.onReady();
        committed = true;
        if (disposed || failed) return;
        callbacks.onSnapshot(snapshot(world, PLAYER, seatLooks, network?.isSeatPresent));
        releaseWorld = app.setWorld({ advance, draw });
      }
      // Teammates are waited for before the deployment, so the cover lifts once, onto it.
      await network?.ready();
      if (!current()) return void start();
      if (!changingZone && !deploymentDone) {
        const cue = {
          kind: "deploy" as const,
          text: deployCall(formOf(world.players[PLAYER]!).name),
          ...speaker(PLAYER),
        };
        // The line's glyphs are resident before the clock starts: it never opens with a gap.
        await hud.trainers.prepare(cue);
        if (!current()) return void start();
        callbacks.onDeployment(true);
        view.setDeployment(0);
        view.frame(1, 0, [], yaw);
        await new Promise<void>((done) => {
          deployment = { elapsed: 0, done, cue };
        });
        if (disposed || failed) return;
        callbacks.onDeployment(false);
      }
      if (!current()) return void start();
      // Ready means audible: the run's sounds and its track decoded (asked for at the run's start).
      if (changingZone) {
        // The next zone: ticking starts from its first tick, with nothing owed from the wait.
        changingZone = false;
        accumulator = 0;
        canvasStale = true;
        callbacks.onLoadProgress?.(1);
        callbacks.onZoneLoading(false);
        return;
      }
      started = true;
      if (!network && !config.autoOpenCards)
        queue.push({ t: "cardMode", player: PLAYER, manual: true });
      audio.music.play("run");
      runTrack.release();
    } catch (error) {
      if (disposed) return;
      // A loss mid-warm: the restore starts it again.
      if (!current()) return void start();
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Steps: uploads every texture `root`'s materials sample, one per step (shared ones once). */
  function* uploadSteps(root: Object3D): Steps<void> {
    const seen = new Set<Texture>();
    const textures: Texture[] = [];
    const collect = (value: unknown) => {
      // Render-target textures are drawn into, never uploaded.
      if (value instanceof Texture && !value.isRenderTargetTexture && !seen.has(value)) {
        seen.add(value);
        textures.push(value);
      }
    };
    root.traverse((object) => {
      const { material } = object as { material?: Material | Material[] };
      for (const each of material ? [material].flat() : []) {
        for (const value of Object.values(each)) collect(value);
        const { uniforms } = each as { uniforms?: Record<string, { value: unknown }> };
        for (const uniform of Object.values(uniforms ?? {})) collect(uniform.value);
      }
    });
    for (const [i, texture] of textures.entries()) {
      renderer.initTexture(texture);
      callbacks.onLoadProgress?.(0.85 + (0.12 * (i + 1)) / textures.length);
      yield;
    }
  }

  function resizeUi(cssWidth: number, cssHeight: number, scale: number, safe: UiInsets): void {
    setViewSize(cssWidth, cssHeight);
    minimap?.resize(cssWidth, cssHeight, scale, safe);
    compass?.resize(width, height, scale, safe);
  }

  return {
    bindInput(input) {
      actions = input;
    },
    sampleInput(move, turn) {
      [stick.x, stick.z] = move;
      touchTurn = turn;
    },
    action,
    get mapOpen() {
      return mapOpen;
    },
    send(command) {
      if (failed || disposed) return;
      if (
        command.t === "dash" ||
        command.t === "ult" ||
        command.t === "assist" ||
        command.t === "interact"
      ) {
        actions.press(command.t);
        return;
      }
      if (command.t === "forfeit") {
        // Applied now, not on the next frame: leaving must settle even while no frame runs (a
        // lost context). A run still loading has no result to settle; its owner just leaves.
        if (!started || disposed) return;
        if (network && !network.host) {
          network.quit();
          return;
        }
        stepWorld(world, [command]);
        network?.publish(world, world.events, 0, true);
        runLog?.forfeit(world);
        settle(false);
        return;
      }
      if (command.t === "pause") queuePause(command.paused);
      else queue.push({ ...command, player: PLAYER });
    },
    setTurn(direction) {
      actions.turn(direction);
    },
    keyDown,
    cancelInput,
    blur,
    toggleMap: () => setFullMap(!mapOpen),
    resizeUi,
    afterUiLayout() {
      minimap?.afterLayout();
      compass?.afterLayout();
    },
    mapHit: (x, y) => minimap?.hit(x, y) != null,
    mapActivate(x, y) {
      const hit = minimap?.hit(x, y);
      if (hit) setFullMap(hit === "mini" ? !mapOpen : false);
    },
    stats(): PlayerSheet {
      const player = world.players[PLAYER]!;
      const stats = playerStats(player, activeWeather(world));
      return {
        sheet: statBreakdown(player, activeWeather(world)),
        time: world.time,
        kills: player.kills,
        stardust: Math.floor(player.stardust),
        moves: player.moves.map((move) => ({
          id: move.id,
          level: move.level,
          damage: move.damage,
          cd: moveParams(move, stats, activeWeather(world)).cd,
        })),
        items: player.items.map((item) => ({ ...item })),
      };
    },
    setPauseOnBlur(enabled) {
      pauseOnBlur = enabled;
    },
    setAutoOpenCards(enabled) {
      if (!network) queue.push({ t: "cardMode", player: PLAYER, manual: !enabled });
    },
    setDevMode(enabled) {
      if (devMode === enabled) return;
      devMode = enabled;
      panel = enabled ? makeReadout() : undefined;
      if (!enabled) hud.setDevReadout("");
      syncDebug();
    },
    setSound(enabled) {
      audio.setEnabled(enabled);
    },
    setPaused(paused) {
      menuPaused = paused;
      if (paused) syncFieldAmbience(audio, world, false);
      audio.music.setPaused(paused);
      if (paused) setFullMap(false);
      queuePause(paused);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      deployment?.done();
      deployment = undefined;
      hud.trainers.clear();
      if (import.meta.env.DEV) Reflect.deleteProperty(window, "__poketoneWorld");
      abort.abort();
      if (network && network.onError === fail) {
        network.session.departureTerminal = undefined;
        network.session.onQuitConfirmed = undefined;
        network.onError = () => {};
        network.resetInput = () => {};
        network.onPacket = () => {};
      }
      stopWaiting();
      for (const held of [runSounds, runTrack, bossTrack]) held.release();
      // Programs first used during the run (effects, the guardian's moves) carry over to the next.
      if (started && view && app.available) app.retainWorldPrograms(view.scene);
      releaseWorld();
      unregisterResident();
      syncFieldAmbience(audio, world, false);
      audio.music.setPaused(false);
      disposeScene();
      healthBars?.dispose();
      grade.dispose();
      assets?.dispose();
    },
  };
}

/** 「成熟！」 marks a mature stage; other stages announce 「进化！」. */
function evolveBanner(line: StarterId, stage: number): string {
  const kind = starters[line].stages[stage]!.kind === "mature" ? "成熟" : "进化";
  return `${kind}！${stageForm(line, stage).name}`;
}
