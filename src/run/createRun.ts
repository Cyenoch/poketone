import type { MultiplayerRun } from "../network/run";
import type { ActionInput, GameplayAction } from "../platform/input";
import { Matrix4, Texture, type Material, type Object3D, type WebGLRenderer } from "three";
import type { AppRenderer } from "../rendering/app-renderer";
import type { GpuRunHud } from "../ui/gpu/run-hud";
import type { UiInsets } from "../ui/gpu/viewport";
import { moves, type MoveId } from "./sim/content/moves";
import { starters, stageForm, type FormId, type StarterId } from "./sim/content/lines/index";
import type { Difficulty } from "./sim/content/difficulties";
import type { ElementType } from "./sim/content/elements";
import { items, type ItemId } from "./sim/content/items";
import { enemies as enemyDefs } from "./sim/content/enemies";
import { formOf } from "./sim/evolution";
import { moveParams } from "./sim/attacks";
import { archetypes } from "./sim/archetypes/index";
import { playerStats, statBreakdown, type StatBreakdown } from "./sim/stats";
import { TICK, type World } from "./sim/state/world";
import { stageDefs } from "./sim/content/stages/index";
import type { Command } from "./sim/state/commands";
import type {
  LabBonuses,
  MoveState,
  PendingChoice,
  PlayerId,
  StationKind,
} from "./sim/state/entities";
import type { RunEvent } from "./sim/state/events";
import { itemSlots, moveSlots } from "./sim/upgrades";
import { fusionStatus, type FusionPart } from "./sim/fusion";
import { rescueTarget } from "./sim/rescue";
import { COOP } from "./sim/content/params/coop";
import { DASH_COOLDOWN } from "./sim/content/params/player";
import { forgetRefund, stationHere } from "./sim/stations";
import { zoneDef, zoneTime } from "./sim/currentZone";
import { canLeave, enterZone, landmarkAction, prepareZone } from "./sim/zones";
import { cardShown, createWorldFromSeeds, isFrozen, stepWorld, type Loadout } from "./sim/world";
import { bindModelStore, loadRunAssets, type RunAssets } from "./view/assets";
import { afterFrame, drive, type Steps } from "../prepare/steps";
import { bakeMap } from "./view/minimapBake";
import type { StageId } from "./sim/content/stages/index";
import { getAudio, RUN_SOUNDS, type SfxName } from "../audio/engine";
import { createBoundaryWall, type BoundaryWall } from "./view/boundaryWall";
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

export const RUN_NOTICE_MS = { info: 900, danger: 2600, reward: 2600 };
const dangerLabels = {
  alpha: "头目出现",
  "elite-wave": "精英群",
  swarm: "群体包围",
  stampede: "冲锋群",
  eruption: "火山喷发",
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
  level: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface RunSnapshot {
  stage: StageId;
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
  boss: { name: string; hp: number; max: number } | null;
  pending: PendingChoice | null;
  pendingCount: number;
  rescueProgress: number | null;
  /** The level the front level-up card is for: one card per level, so later ones queue behind it. */
  cardLevel: number;
  rerolls: number;
  skips: number;
  banishes: number;
  moveSlots: number;
  itemSlots: number;
  /** 星星沙子 earned this run so far (not the 研究所 balance). */
  stardust: number;
  /** Ultimate charge 0 → 1; `casting` while one plays out. */
  ult: number;
  casting: boolean;
  form: FormId;
  rampage: boolean;
  /** The zone (0-based of `count`), its seconds so far and the second its final swarm starts. */
  zone: {
    index: number;
    count: number;
    phase: World["zone"]["phase"];
    time: number;
    finalSwarm: number;
  };
  outcome: World["outcome"];
  tmCase: boolean;
  dialog: StationView | null;
  /** What interacting does where the player stands (shows the prompt), when no dialog is open. */
  prompt: InteractPrompt | null;
  /** The other players still in the run, by slot; empty solo. */
  team: TeamMate[];
}

/** A station's prompt, or the zone landmark's: summon its guardian, or leave once it has fallen. */
export type InteractPrompt = StationKind | "summon" | "leave" | "choices" | "rescue";

function interactPrompt(world: World, player: World["players"][number]): InteractPrompt | null {
  if (!player.alive || player.dialog) return null;
  if (player.rescue || rescueTarget(world, player)) return "rescue";
  if (world.players.length > 1) {
    const landmark = landmarkAction(world, player);
    if (landmark && (landmark !== "leave" || canLeave(world))) return landmark;
    if (player.pending.length > 0) return "choices";
  }
  const station = stationHere(world, player);
  if (station) return station.kind;
  const action = landmarkAction(world, player);
  // Leaving waits for every card and dialog; until then the exit shows no prompt.
  return action === "leave" && !canLeave(world) ? null : action;
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
      refund: Math.floor(forgetRefund(m, "move") * gain),
    })),
    items: player.items.map((item) => ({
      ...item,
      refund: Math.floor(forgetRefund(item, "item") * gain),
    })),
  };
}

export interface RunResult {
  outcome: "victory" | "defeat";
  starter: StarterId;
  difficulty: Difficulty;
  time: number;
  level: number;
  kills: number;
  /** 星星沙子 this run carries out (stardust gain already applied), banked once by `recordRun`. */
  stardust: number;
  moves: { id: MoveId; level: number; damage: number }[];
  /** Items held at the end, the backpack's candidates. */
  items: ItemId[];
}

export interface RunCallbacks {
  /** App-owned modal input, including its exit transition. */
  inputBlocked(): boolean;
  /** Commits local start data before the prepared world can advance; refusal must throw. */
  onReady(): void;
  onError(error: Error): void;
  onSnapshot(snapshot: RunSnapshot): void;
  onBanner(text: string, tone: "info" | "danger" | "reward", ageMs: number): void;
  /** "toggle" from the pause key; "pause" when focus is lost (never unpauses). */
  onPauseRequest(mode: "toggle" | "pause"): void;
  onStatsRequest(): void;
  onMapChange(open: boolean): void;
  /** The next zone readies (true) under the loading cover, then is ready to play (false). */
  onZoneLoading(loading: boolean): void;
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
  /** The local player's build, read when the build panel opens (not part of the 10 Hz snapshot). */
  stats(): PlayerSheet;
  dispose(): void;
}

/** Wind-up tells further than this (m, about the screen's half-width) play no sound. */
const TELL_EARSHOT = 14;
/** The heal ring is clearly out by this many ms after its pulse (view/vfx/zoneSkills.ts `mendRing`). */
const HEAL_KEY_MS = 120;
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
};
const CAST_SOUND: Partial<Record<ElementType, SfxName>> = {
  fire: "cast-fire",
  water: "cast-water",
  grass: "cast-grass",
  electric: "cast-electric",
};

/** A move's slot reading: waiting for a target is ready (its 0.2 s retry is not a cooldown). */
function moveReadiness(move: MoveState, cd: number): { ready: number; cd: number } {
  return { ready: move.waiting ? 1 : 1 - Math.max(0, move.cooldown) / cd, cd };
}

function snapshot(world: World, playerId: PlayerId): RunSnapshot {
  const player = world.players[playerId]!;
  const stats = playerStats(player);
  const boss = world.enemies.find((enemy) => enemy.id === world.bossId);
  return {
    time: world.time,
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
      ...moveReadiness(move, moveParams(move, stats).cd),
    })),
    items: player.items.map((item) => ({ ...item })),
    dash: 1 - player.dashCooldown / DASH_COOLDOWN,
    dashes: player.dashes,
    dashMax: stats.dashCharges,
    boss: boss
      ? { name: enemyDefs[boss.species].name, hp: Math.max(0, boss.hp), max: boss.maxHp }
      : null,
    pending: cardShown(player) ? player.pending[0]! : null,
    pendingCount: player.pending.length,
    rescueProgress: player.rescue ? player.rescue.elapsed / COOP.rescueSeconds : null,
    cardLevel: player.level + 1 - player.pending.filter((card) => card.source === "level").length,
    rerolls: player.rerolls,
    skips: player.skips,
    banishes: player.banishes,
    moveSlots: moveSlots(player),
    itemSlots: itemSlots(player),
    stardust: Math.floor(player.stardust),
    ult: player.ult.charge,
    casting: player.ult.elapsed >= 0,
    form: formOf(player).id,
    rampage: world.rampage,
    zone: {
      index: world.zone.index,
      count: stageDefs[world.stage].zones.length,
      phase: world.zone.phase,
      time: zoneTime(world),
      finalSwarm: stageDefs[world.stage].duration,
    },
    stage: world.stage,
    outcome: world.outcome,
    tmCase: player.tmCase,
    dialog: stationView(world, playerId),
    prompt: interactPrompt(world, player),
    team: world.players
      .filter((mate) => mate.id !== playerId && !mate.departed)
      .map((mate) => ({
        slot: mate.id,
        form: formOf(mate).id,
        level: mate.level,
        hp: Math.max(0, mate.hp),
        maxHp: playerStats(mate).maxHp,
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
    /** The initial map; formal lobby starts the six-map route at forest. */
    stage: StageId;
    starter: StarterId;
    difficulty: Difficulty;
    lab: LabBonuses;
    loadout: Loadout;
    sound: boolean;
    /** Developer mode: hitboxes, nav mask, flow arrows and a stats panel. */
    devMode: boolean;
    multiplayer?: MultiplayerRun;
  },
  callbacks: RunCallbacks,
): RunHandle {
  const network = config.multiplayer;
  const PLAYER: PlayerId = network?.player ?? 0;
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
    minimap.setFullMap(open);
    callbacks.onMapChange(open);
  }

  const cancelInput = () => {
    actions?.cancel();
    touchTurn = 0;
    stick.x = stick.z = 0;
    for (let i = queue.length - 1; i >= 0; i--)
      if (["move", "view", "dash", "ult", "interact"].includes(queue[i]!.t)) queue.splice(i, 1);
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
    else if (["dash", "ult", "interact"].includes(action) && !isFrozen(world))
      queue.push({ t: action as "dash" | "ult" | "interact", player: PLAYER });
  }
  const blur = () => {
    cancelInput();
    if (!network && started && world.outcome === "playing") callbacks.onPauseRequest("pause");
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
    // A big moment brings its own sound; the generic boss or level cue would stack on top of it.
    const hasOwnSound = events.some(
      (e) => (e.t === "death" && e.elite) || (e.t === "capture" && e.player === PLAYER),
    );
    const evolving = events.some((e) => e.t === "evolve" && e.player === PLAYER);
    const tell = loudestTell(events);
    if (tell) audio.sfx(tell);
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
          else if (event.tone === "danger") audio.sfx("danger");
          switch (event.kind) {
            case "fusion":
              if (event.player !== PLAYER) break;
              notify(event, event.text, "reward");
              break;
            case "clear":
              notify(event, event.text, "reward");
              break;
            case "alpha":
            case "elite-wave":
            case "swarm":
            case "stampede":
            case "eruption": {
              const ageMs = network?.eventAgeMs(event) ?? 0;
              if (ageMs < RUN_NOTICE_MS.danger)
                dangers.set(event.kind, { text: event.text, ageMs });
              break;
            }
            case "zone":
              notify(event, event.text, "info");
              break;
          }
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
            hud.numbers.spawn(event.x, event.z, event.amount, event.crit, event.weak);
          if (event.confirmedContact) break;
          {
            const hit = HIT_SOUND[event.type] ?? "hit";
            audio.sfx(event.crit ? "crit" : hit, {
              pitch: event.weak ? 0.8 : 1,
              fallback: event.crit ? hit : undefined,
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
          } else {
            audio.sfx("kill");
          }
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
          // The light column opens after the 0.3 s freeze, about 90 ms into its life.
          audio.sfx("evolve", { keyMs: 390 });
          notify(event, evolveBanner(world.players[PLAYER]!.starter, event.stage), "reward");
          break;
        case "ult":
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
          notify(event, `捕获 ${enemyDefs[event.species].name}！`, "reward");
          audio.sfx("capture");
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
          hitStop(0.3, 0.1);
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
        case "cast": {
          if (event.player !== PLAYER) break;
          const move = moves[event.move];
          const name = CAST_SOUND[move.type];
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
    if (network?.host) network.restoreHost(world);
    if (network?.suspended) {
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
      if (holdLeftMs <= 0) report();
    }
    // An ended run plays its end out, then holds its last picture under the result window, as a
    // paused one does.
    const frozen = isFrozen(world) || (world.outcome !== "playing" && holdLeftMs <= 0);
    const alpha = frozen ? 1 : network && !network.host ? network.alpha() : accumulator / TICK;
    const viewStart = performance.now();
    view.frame(alpha, frozen ? 0 : simDt, events, yaw, remotePlayerSpeeds);
    const self = world.players[PLAYER]!;
    boundary?.update(self.x, self.z, frozen ? 0 : dt);
    debug?.update(world);
    healthBars?.update(world, alpha, frozen ? 0 : simDt);
    minimap?.update(world, alpha, yaw, frozen ? 0 : dt);
    compass?.update(world, alpha, yaw, frozen ? 0 : dt);
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
      const snap = snapshot(world, PLAYER);
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
      audio.music.play(null);
      // The guardian's fall freezes the screen for 0.35 s; the victory sting lands after the freeze,
      // not on the elite-kill sound (whose tail still overlaps its start).
      audio.sfx(world.outcome === "victory" ? "victory" : "defeat", {
        keyMs: world.outcome === "victory" ? 350 : 250,
      });
      holdLeftMs = hold ? END_HOLD_MS : 0;
    }
    if (!hold) {
      holdLeftMs = 0;
      report();
    }
  }

  function report(outcome = world.outcome): void {
    if (reported || disposed) return;
    reported = true;
    if (outcome !== "playing") {
      const player = world.players[PLAYER]!;
      callbacks.onEnd({
        outcome,
        starter: config.starter,
        difficulty: config.difficulty,
        time: world.time,
        level: player.level,
        kills: player.kills,
        stardust: Math.floor(player.stardust),
        moves: player.moves.map((move) => ({
          id: move.id,
          level: move.level,
          damage: move.damage,
        })),
        items: player.items.map((item) => item.id),
      });
    }
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
                difficulty: config.difficulty,
                players: network?.config.players ?? [
                  { starter: config.starter, lab: config.lab, ...config.loadout },
                ],
              },
              () => crypto.getRandomValues(new Uint32Array(1))[0]!,
            );
      if (disposed) return;
      network?.loading(world);
      if (network?.host) network.publishMap(world);
      // Dev-only handle for browser checks (fast-forward to the boss, force outcomes). Stripped from builds.
      // The run log stays on the window after the run, for an export from the result screen.
      if (import.meta.env.DEV)
        Object.assign(window, { __poketoneWorld: world, __poketoneRunLog: runLog });
      const loaded = await loadRunAssets(world, abort.signal);
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
    boundary = createBoundaryWall(world.map.terrain);
    view.scene.add(boundary.mesh, grade.vignette, healthBars!.mesh);
    const base = await drive(bakeMap(world), { live: () => !disposed });
    if (disposed) {
      base.dispose();
      return false;
    }
    minimap = createMinimap(hud.stage, hud.mapSlot, world, PLAYER, base);
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
    callbacks.onZoneLoading(true);
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
        if (network?.host) network.publishMap(world);
      }
      if (world.stage !== previousStage) {
        assets?.dispose();
        assets = await loadRunAssets(world, abort.signal);
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
      if (app.generation !== generation || !app.available) return void start();
      // First uploads one texture a step, so the warm draw is not also every upload at once.
      // A dispose stops them; a loss stops them too, and the restore starts the warm over.
      await drive(uploadSteps(view.scene), { live: current });
      app.inWorldTarget(() => draw(renderer));
      view.warmSet(false);
      app.retainWorldPrograms(view.scene);
      if (!changingZone) await Promise.all([runSounds.result, runTrack.result]);
      if (!current()) return void start();
      await network?.ready();
      if (!current()) return void start();
      // Ready means audible: the run's sounds and its track decoded (asked for at the run's start).
      if (changingZone) {
        // The next zone: ticking starts from its first tick, with nothing owed from the wait.
        changingZone = false;
        accumulator = 0;
        canvasStale = true;
        callbacks.onZoneLoading(false);
        return;
      }
      callbacks.onReady();
      if (!current()) return;
      releaseWorld = app.setWorld({ advance, draw });
      started = true;
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
    for (const texture of textures) {
      renderer.initTexture(texture);
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
      if (command.t === "dash" || command.t === "ult" || command.t === "interact") {
        actions.press(command.t);
        return;
      }
      if (command.t === "forfeit") {
        // Applied now, not on the next frame: leaving must settle even while no frame runs (a
        // lost context). A run still loading has no result to settle; its owner just leaves.
        if (!started || disposed) return;
        if (network && !network.host) {
          network.quit();
          report("defeat");
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
      const stats = playerStats(player);
      return {
        sheet: statBreakdown(player),
        time: world.time,
        kills: player.kills,
        stardust: Math.floor(player.stardust),
        moves: player.moves.map((move) => ({
          id: move.id,
          level: move.level,
          damage: move.damage,
          cd: moveParams(move, stats).cd,
        })),
        items: player.items.map((item) => ({ ...item })),
      };
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
      audio.music.setPaused(paused);
      if (paused) setFullMap(false);
      queuePause(paused);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (import.meta.env.DEV) Reflect.deleteProperty(window, "__poketoneWorld");
      abort.abort();
      if (network && network.onError === fail) {
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
