import { DEFAULT_TRAINER, type TrainerId } from "./content/trainers";
import { decayAssistBuffs, activateAssist } from "./trainers";
import type { UnlockId } from "./content/unlocks";
import { megaStones, starters, type StarterId } from "./content/lines/index";
import { present, teamSize } from "./team";
import { moves } from "./content/moves";
import type { RuleId } from "./content/rules";
import type { Difficulty } from "./content/difficulties";
import { items, type ItemId } from "./content/items";
import { stageDefs, type StageId } from "./content/stages/index";
import { initialRoute } from "./content/campaign";
import { bondLabModifier } from "./content/bonds";
import { BOND_CURE_LEVEL, BOND_ENDURE_LEVEL, BOND_LAB_LEVEL } from "./content/params/bonds";
import { towerMap } from "./content/tower-map";
import { updateAreas, updateMoves, updateProjectiles } from "./attacks";
import { heal, type Ctx } from "./combat";
import { nearestPlayer, primeEnemyNav, updateDirector } from "./director";
import { updateEnemies } from "./enemies";
import { updateHazards } from "./hazards";
import { gainXp, manualCards, nextCard, pickEffects, queueCard, rollDice } from "./progression";
export { manualCards } from "./progression";
import { cancelRouteDeal, collectRoutePickup, pickRouteReward } from "./route-rewards";
import { fuseMoves } from "./fusion";
import { EnemyGrid } from "./grid";
import { checkPlayable, generateMap, MapGenError, stageBodies } from "./mapgen/index";
import { createRng, mixSeed, type Rng } from "./rng";
import { cureBondStatus, decay, drainRate } from "./status";
import { DRAIN_FLOOR } from "./content/params/combat";
import {
  currentAbility,
  currentStats,
  earnStardust,
  NO_LAB,
  playerStats,
  refreshStats,
  xpForLevel,
} from "./stats";
import { chargeSurrounded, creditHostileLoss } from "./ultimates/crisis";
import { fireUltimate, newUltState, updateUltimate } from "./ultimates/index";
import { updatePartners } from "./partners";
import { updateShield } from "./hurt";
import { activeWeather } from "./content/weather";
import { fire } from "./triggers/index";
import { forget, interact, placeStations } from "./stations";
import { STATION_REACH } from "./content/params/stations";
import { SITE } from "./content/params/sites";
import { sites as siteDefs } from "./content/sites";
import {
  expireTrades,
  fieldRng,
  sweepClearedField,
  interactInZone,
  interactTrade,
  withFieldSeed,
  zoneSeed,
} from "./zones";
import {
  applyChoice,
  banishKey,
  megaMoveToLearn,
  newMoveState,
  offerKey,
  rollRewardChoices,
} from "./upgrades";
import { TICK, type World } from "./state/world";
import type { Command } from "./state/commands";
import type { LabBonuses, Pickup, Player } from "./state/entities";
import { scheduleField } from "./field-events";
import { tryMegaEvolution } from "./evolution";
import { setDrought, updateWeather } from "./weather";
import { updateEncounters } from "./encounters";
import { interactSite, placeSites, updateSites } from "./sites/index";
import { hypot } from "./math";
import { PLAYER_SPAWN_SPACING, REVIVE, START } from "./content/params/player";
import { PICKUP } from "./content/params/economy";
import { COOP_SCALING, coopScaling } from "./content/params/coop";
import { revivePlayer, startRescue, updateRescues } from "./rescue";
import { applyMovementCommand, movePlayer, rechargeDash } from "./player-movement";

/**
 * A peer's meta-progression as plain data (the sim never reads the save): 档案库 items never offered,
 * 背包 items owned from the start at level 1. Omitted means none.
 */
export interface Loadout {
  unlocks?: readonly UnlockId[];
  archive?: readonly ItemId[];
  backpack?: readonly ItemId[];
}

export interface RunConfig {
  /** Shared content uses the host’s unlocks; each seat carries its own in its loadout. */
  unlocks?: readonly UnlockId[];
  mode: World["mode"];
  rules: readonly RuleId[];
  stage: StageId;
  /** Non-forest fixtures and tools provide the entered-map prefix explicitly. */
  route?: readonly StageId[];
  seed: number;
  difficulty: Difficulty;
  /** Each peer's lab bonuses, bond and loadout travel with the config; omitted means none. */
  players: readonly ({
    trainer: TrainerId;
    starter: StarterId;
    shiny: boolean;
    lab?: LabBonuses;
  } & Loadout &
    BondSetup)[];
}

interface BondSetup {
  bond?: number;
  /** Bought levels of the selected partner's node. */
  bondLab?: number;
}

/** Shared scratch grid; stepWorld is synchronous, so two worlds never use it at once. */
const grid = new EnemyGrid();

export function createPlayer(
  id: number,
  starter: StarterId,
  x: number,
  lab: LabBonuses = NO_LAB,
  loadout?: Loadout & BondSetup & { trainer: TrainerId; rng: Rng },
): Player {
  const def = starters[starter];
  const { bond = 0, bondLab = 0 } = loadout ?? {};
  const carriedStone = loadout?.backpack?.find((id) => megaStones.has(id));
  if (carriedStone) throw new Error(`${items[carriedStone].name} 只能从本局的守卫奖杯获得。`);
  const player: Player = {
    id,
    trainer: loadout ? loadout.trainer : DEFAULT_TRAINER,
    assistReady: 0,
    assistBuffs: {},
    starter,
    x,
    z: 0,
    px: x,
    pz: 0,
    faceX: 0,
    faceZ: 1,
    viewYaw: 0,
    moving: false,
    inputX: 0,
    inputZ: 0,
    vx: 0,
    vz: 0,
    stage: 0,
    mega: null,
    abilitySlot: 0,
    lightningRodTime: 0,
    hp: 0, // max HP, set below once the carried items are on
    shield: 0,
    lastHurt: 0,
    alive: true,
    choosing: true,
    rescue: null,
    tradeRequest: null,
    level: 1,
    xp: 0,
    xpNext: xpForLevel(1),
    invulnerable: START.invulnerable,
    cardHold: 0,
    dashCooldown: 0,
    dashes: 1,
    dashTime: 0,
    dashX: 0,
    dashZ: 1,
    statuses: [],
    hurt: 0,
    moves: [newMoveState(def.kit[0])],
    // Carried items start at level 1; the backpack (at most 3, lab.ts BACKPACK_BASE + 大背包) fits the base slots.
    items: (loadout?.backpack ?? []).map((id) => ({ id, level: 1 })),
    pending: [],
    rerolls: START.rerolls + (lab.rules.rerolls ?? 0),
    skips: lab.rules.skips ?? 0,
    banishes: lab.rules.banishes ?? 0,
    // Archived items are banished for the whole run: the same rule keeps them out of every card.
    banished: (loadout?.archive ?? []).map(offerKey.item),
    revives: lab.rules.revives ?? 0,
    stardust: 0,
    lab:
      bond >= BOND_LAB_LEVEL && bondLab > 0
        ? { ...lab, modifiers: [...lab.modifiers, bondLabModifier(starter, bondLab)] }
        : lab,
    bond,
    bondEndure: bond >= BOND_ENDURE_LEVEL,
    bondCure: bond >= BOND_CURE_LEVEL,
    training: { dmg: 0, hp: 0, speed: 0, area: 0, cd: 0 },
    tradeHp: 1,
    ult: newUltState(),
    crisis: { startTick: 0, spent: 0, lastTick: null },
    tmCase: false,
    dialog: null,
    kills: 0,
    dex: {},
    egg: null,
    fx: {},
    procs: {},
    procWindow: 0,
  };
  if (loadout)
    for (const { id, level } of player.items)
      if (items[id].onPick?.roll) rollDice(loadout.rng, player, level);
  // Carried items arrive filled after their rolled modifiers are known.
  const stats = playerStats(player);
  player.hp = stats.maxHp;
  player.shield = stats.shield;
  player.dashes = stats.dashCharges;
  return player;
}

/** About 0.3% of seeds cannot fit the map spec; this many misses in a row means the spec is broken. */
const SEED_ATTEMPTS = 8;

/** Draws seeds until one generates a valid map (docs/MAPGEN.md); any other error is rethrown. */
export function createWorldFromSeeds(
  config: Omit<RunConfig, "seed">,
  drawSeed: () => number,
): World {
  for (let attempt = 1; ; attempt++) {
    try {
      return createWorld({ ...config, seed: drawSeed() });
    } catch (error) {
      if (!(error instanceof MapGenError) || attempt >= SEED_ATTEMPTS) throw error;
    }
  }
}

export function createWorld(config: RunConfig): World {
  if (config.players.length === 0) throw new Error("至少需要一名玩家。");
  if (config.players.length > COOP_SCALING.length) throw new Error("最多支持四名玩家。");
  if (config.mode === "tower") {
    const stage = towerMap(config.seed, 1);
    return withFieldSeed(mixSeed(config.seed, 1), (draw) =>
      buildWorld({ ...config, stage }, [stage], draw, fieldRng(draw)),
    );
  }
  const route = initialRoute(config.stage, config.route);
  if (config.stage === "forest")
    return buildWorld(config, route, config.seed, createRng(config.seed));
  return withFieldSeed(zoneSeed(config.seed, config.stage), (draw) =>
    buildWorld(config, route, draw, fieldRng(draw)),
  );
}

function buildWorld(config: RunConfig, route: StageId[], draw: number, rng: Rng): World {
  const built = generateMap(draw, stageDefs[config.stage].map);
  const world: World = {
    mode: config.mode,
    stage: config.stage,
    route,
    marker: null,
    modifier: null,
    seed: config.seed,
    rng,
    difficulty: config.difficulty,
    rules: [...config.rules],
    unlocks: [...(config.unlocks ?? config.players[0]!.unlocks ?? [])],
    playerUnlocks: config.players.map((entry) => [...(entry.unlocks ?? [])]),
    time: 0,
    tick: 0,
    paused: false,
    outcome: "playing",
    nextId: 1,
    players: [],
    partners: [],
    enemies: [],
    projectiles: [],
    areas: [],
    hazards: [],
    pickups: [],
    map: built.map,
    nav: built.nav,
    stations: [],
    sites: [],
    eventsUsed: [],
    weather: null,
    weatherSetAt: 0,
    pledgeHits: [],
    rainbowUntil: 0,
    silphScope: false,
    spawn: {
      credit: 0,
      pressure: 0.5,
      pool: [],
      fired: [],
      anchor: -1,
      outbreak: null,
      shinySpawned: false,
    },
    bossId: null,
    zone: { index: 0, tick: 0, phase: "active", exits: [], leaving: null, schedule: [] },
    rampage: false,
    events: [],
  };
  furnishMap(world, config.players.length);
  world.players = config.players.map((entry, index) =>
    createPlayer(index, entry.starter, spawnX(index, config.players.length), entry.lab, {
      ...entry,
      backpack: world.rules.includes("no-items") ? [] : entry.backpack,
      rng: world.rng,
    }),
  );
  for (const player of world.players) player.choosing = world.players.length === 1;
  scheduleField(world);
  primeEnemyNav(world);
  return world;
}

/** Players start side by side across the spawn clearing, PLAYER_SPAWN_SPACING apart, on z = 0. */
export function spawnX(index: number, players: number): number {
  return (index - (players - 1) / 2) * PLAYER_SPAWN_SPACING;
}

/**
 * Places the stage's stations on the installed map, then accepts it on the final nav (props and
 * stations blocking) for `players` spawns; throws a `MapGenError` when it is not playable.
 */
export function furnishMap(world: World, players: number): void {
  world.stations = placeStations(world);
  world.sites = placeSites(world);
  checkPlayable(
    world.nav,
    {
      spawns: Array.from({ length: players }, (_, index) => ({ x: spawnX(index, players), z: 0 })),
      landmarks: world.map.pads.filter((pad) => pad.tag === "landmark"),
      stations: world.stations.map(({ x, z, radius }) => ({ x, z, radius, reach: STATION_REACH })),
      sites: world.sites.map(({ kind, x, z, radius }) => ({
        x,
        z,
        radius,
        reach: siteDefs[kind].interact === "pickup" ? SITE.pickup : SITE.reach,
      })),
      passages: world.map.passages,
    },
    stageBodies(stageDefs[world.stage]),
    `关卡 ${world.stage}，种子 ${world.seed}`,
  );
}

/**
 * Solo choices/stations freeze the clock. Co-op choices and stations are personal;
 * only an explicit pause, reconnect pause or field transition freezes the team.
 */
export function isFrozen(world: World): boolean {
  return (
    world.paused ||
    world.zone.phase === "transitioning" ||
    (world.players.length === 1 &&
      world.players.some((player) => cardShown(player) || player.dialog))
  );
}

/** Solo opens automatically after evolution; co-op opens only by the player's request. */
export function cardShown(player: Player): boolean {
  return player.alive && player.choosing && player.pending.length > 0 && player.cardHold <= 0;
}

export function applyCommand(
  world: World,
  command: Command,
  isSeatPresent?: (id: number) => boolean,
): void {
  switch (command.t) {
    case "pause":
      world.paused = command.paused;
      return;
    case "forfeit":
      if (world.outcome === "playing") world.outcome = "defeat";
      return;
  }
  // Commands are the network boundary: one naming a player who isn't in this run is dropped.
  const player = world.players.find((candidate) => candidate.id === command.player);
  if (!player) return;
  // Even downed peers update held directions; the guest only sends changes.
  if (command.t === "move" || command.t === "view") {
    applyMovementCommand(player, command, isFrozen(world));
    return;
  }
  if (!player.alive) return;
  if (
    (player.pending[0]?.source === "ability" || player.pending[0]?.source === "mega-move") &&
    (command.t === "reroll" || command.t === "skip" || command.t === "banish")
  )
    return;
  if (
    player.pending[0]?.offer?.kind === "deal" &&
    (command.t === "reroll" ||
      command.t === "banish" ||
      command.t === "skip" ||
      (command.t === "choices" && !command.open))
  )
    return;

  switch (command.t) {
    case "assist":
      if (world.outcome === "playing" && !isFrozen(world)) activateAssist(world, player);
      return;
    case "ult":
      if (!isFrozen(world)) {
        player.rescue = null;
        fireUltimate(world, player);
      }
      return;
    case "dash":
      if (applyMovementCommand(player, command, isFrozen(world)))
        world.events.push({ t: "dash", player: player.id });
      return;
    case "cardMode":
      if (world.players.length > 1) return;
      if (command.manual) player.manualCards = true;
      else delete player.manualCards;
      player.choosing = player.pending[0]?.offer?.kind === "deal" || !command.manual;
      return;
    case "choices":
      if (!manualCards(world, player)) return;
      player.choosing = command.open && player.pending.length > 0 && !player.dialog;
      if (player.choosing) player.rescue = null;
      return;
    case "pick": {
      const pending = player.pending[0];
      if (pending?.id !== command.card) return;
      const choice = pending.options[command.index];
      if (!choice || !pickRouteReward(world, player, pending, choice)) return;
      world.events.push({
        t: "card",
        player: player.id,
        card: pending.id,
        action: "pick",
        index: command.index,
      });
      applyChoice(player, choice);
      if (choice.kind === "item") {
        pickEffects(world, player, choice.item);
        if (megaStones.has(choice.item)) settleMega(world, player);
      }
      nextCard(world, player);
      return;
    }
    case "skip": {
      if (player.pending[0]?.id !== command.card) return;
      if (player.skips <= 0) return;
      player.skips -= 1;
      world.events.push({ t: "card", player: player.id, card: command.card, action: "skip" });
      nextCard(world, player);
      return;
    }
    case "banish": {
      const pending = player.pending[0];
      if (pending?.id !== command.card || player.banishes <= 0) return;
      const choice = pending.options[command.index];
      const key = choice && banishKey(choice);
      if (!key) return;
      player.banishes -= 1;
      player.banished.push(key);
      world.events.push({
        t: "card",
        player: player.id,
        card: pending.id,
        action: "banish",
        index: command.index,
      });

      // New options are a new card: a pick still in flight for the old one must not land on them.
      pending.id = world.nextId++;
      pending.options = rollRewardChoices(world, player, pending);
      return;
    }
    case "forget":
      // A queued card was rolled against the current kit; changing the kit under it would leave stale options.
      if (
        player.dialog?.id !== command.dialog ||
        stationOf(world, player)?.kind !== "hypno" ||
        player.pending.length > 0 ||
        // Network boundary: a peer's malformed command must not crash the host's step.
        typeof command.target !== "object"
      )
        return;
      forget(player, command.target);
      return;
    case "fuse": {
      const station = stationOf(world, player);
      if (
        player.dialog?.id !== command.dialog ||
        station?.kind !== "bill" ||
        station.used.includes(player.id) ||
        player.pending.length > 0
      )
        return;
      if (!fuseMoves(player)) return;
      station.used.push(player.id);
      player.dialog = null;
      world.events.push({
        t: "banner",
        text: `融合完成！${moves[player.moves.find((m) => moves[m.id].fusion)!.id].name}`,
        tone: "boss",
        kind: "fusion",
        player: player.id,
      });
      return;
    }
    case "leave":
      if (player.pending[0]?.id === command.dialog && cancelRouteDeal(world, player)) return;
      if (player.dialog?.id === command.dialog) player.dialog = null;
      return;
    case "interact":
      if (isFrozen(world)) return;
      if (player.rescue) {
        player.rescue = null;
        return;
      }
      if (startRescue(world, player)) return;
      if (interactInZone(world, player, isSeatPresent)) return;
      if (interactSite(world, player)) return;
      if (manualCards(world, player) && player.pending.length > 0 && !player.dialog) {
        player.choosing = true;
        return;
      }
      interact(world, player);
      if (!player.dialog) interactTrade(world, player, isSeatPresent);
      return;
    case "reroll": {
      const pending = player.pending[0];
      if (pending?.id !== command.card || player.rerolls <= 0) return;
      player.rerolls -= 1;
      world.events.push({ t: "card", player: player.id, card: pending.id, action: "reroll" });
      pending.id = world.nextId++;
      pending.options = rollRewardChoices(world, player, pending);
      return;
    }
  }
}

function stationOf(world: World, player: Player) {
  return world.stations.find((station) => station.id === player.dialog?.station);
}

function revive(world: World, player: Player): void {
  player.revives -= 1;
  revivePlayer(world, player, REVIVE.hp, REVIVE.invulnerable, "personal");
}

export function stepWorld(world: World, commands: readonly Command[]): void {
  step(world, commands, false);
}

/** Multiplayer host advances shared life and its own attacks; guests own their motion and casts. */
export function stepSharedWorld(
  world: World,
  commands: readonly Command[],
  isSeatPresent?: (id: number) => boolean,
): void {
  step(world, commands, true, isSeatPresent);
}

function step(
  world: World,
  commands: readonly Command[],
  shared: boolean,
  isSeatPresent?: (id: number) => boolean,
): void {
  for (const command of commands) applyCommand(world, command, isSeatPresent);
  if (world.outcome !== "playing" || isFrozen(world)) return;

  const dt = TICK;
  world.time += dt;
  world.tick += 1;
  refreshStats();
  grid.rebuild(world.enemies);
  const ctx: Ctx = { world, grid, ...(shared ? { attackOwner: 0 } : {}) };

  for (const player of world.players) updatePlayer(ctx, player, dt);
  updateDirector(world, dt);
  updateWeather(ctx, dt);
  updateEncounters(ctx, dt);
  grid.rebuild(world.enemies);
  updateEnemies(ctx, dt);
  grid.rebuild(world.enemies);
  updateProjectiles(ctx, dt);
  updateAreas(ctx, dt);
  updatePartners(ctx, dt);
  const remotePositions = shared ? world.players.slice(1).map(({ x, z }) => ({ x, z })) : [];
  updateHazards(world, dt);
  // Enemies and hazards apply statuses after players act; settle them before publishing the tick.
  for (const player of world.players) cureBondStatus(world, player);
  // Terrain/hazard health effects stay shared; remote owners already applied their displacement.
  if (shared)
    world.players
      .slice(1)
      .forEach((player, index) => Object.assign(player, remotePositions[index]));
  updatePickups(world, dt);
  updateSites(ctx, dt);
  // After pickups: a level-up this tick queues its card first, and the station waits for it.

  for (const player of world.players)
    if (!player.alive && player.revives > 0 && !world.rules.includes("nuzlocke"))
      revive(world, player);
  updateRescues(world, dt);
  expireTrades(world);
  // A guardian falling on the tick the last player does still loses the run.
  if (world.players.every((player) => !player.alive)) world.outcome = "defeat";
  else sweepClearedField(world);
  for (const player of world.players) {
    decayAssistBuffs(player, dt);
    player.ult.protection = Math.max(0, Math.round((player.ult.protection - dt) / TICK) * TICK);
  }
}

function settleMega(world: World, player: Player): void {
  if (tryMegaEvolution(world, player) && currentAbility(player) === "drought") setDrought(world);
}

function updatePlayer(ctx: Ctx, player: Player, dt: number): void {
  const owned = ctx.attackOwner === undefined || ctx.attackOwner === player.id;
  if (owned) {
    player.px = player.x;
    player.pz = player.z;
  }
  if (!player.alive) return;
  if (player.cardHold > 0) {
    player.cardHold = Math.max(0, player.cardHold - dt);
    if (player.cardHold === 0) {
      if (!player.mega) settleMega(ctx.world, player);
      else if (megaMoveToLearn(player)) queueCard(ctx.world, player, "mega-move");
    }
  }
  const stats = currentStats(player, activeWeather(ctx.world));
  player.lightningRodTime = Math.max(0, player.lightningRodTime - dt);
  player.invulnerable = Math.max(0, player.invulnerable - dt);
  player.hurt = Math.max(0, player.hurt - dt);
  // Drains act on the tick their status was alive at the start of; the slow on what is left.
  const drain = drainRate(player, ctx.world.time);
  decay(player, dt);
  if (owned) rechargeDash(player, stats.dashCharges, dt);
  player.procWindow += dt;
  if (player.procWindow >= 1) {
    player.procWindow -= 1;
    player.procs = {};
  }

  if (owned) movePlayer(ctx.world, player, stats.speed, dt);

  if (stats.regen > 0) heal(player, stats.regen * dt);
  updateShield(ctx.world, player, dt);
  // Poison wears you down but never finishes you, matching the series' field rule.
  if (drain > 0 && player.ult.protection <= 0) {
    const before = player.hp;
    player.hp = Math.max(DRAIN_FLOOR, before - drain * dt);
    creditHostileLoss(player, ctx.world.tick, before - player.hp, stats.maxHp);
  }
  chargeSurrounded(ctx, player);
  if (player.rescue || !owned) return;
  updateMoves(ctx, player, dt);
  fire(ctx, player, "tick", { dt });
  updateUltimate(ctx, player, dt);
}

/** Owner-side kinematics and existing attack runners, without advancing the shared world. */
export function stepOwnedPlayer(ctx: Ctx, player: Player): void {
  if (ctx.world.outcome !== "playing" || isFrozen(ctx.world)) return;
  refreshStats();
  if (player.alive && !player.rescue) {
    updateMoves(ctx, player, TICK);
    fire(ctx, player, "tick", { dt: TICK });
    updateUltimate(ctx, player, TICK);
  }
  updateProjectiles(ctx, TICK);
  updateAreas(ctx, TICK);
}

function pickupRecipient(world: World, pickup: Pickup): Player | undefined {
  return pickup.kind === "trophy"
    ? world.players.find((player) => player.id === pickup.owner && !player.departed)
    : nearestPlayer(world, pickup.x, pickup.z);
}

function updatePickups(world: World, dt: number): void {
  const kept = [];
  for (const pickup of world.pickups) {
    const player = pickupRecipient(world, pickup);
    if (!player || !player.alive) {
      if (player || pickup.kind !== "trophy") kept.push(pickup);
      continue;
    }
    const dx = player.x - pickup.x;
    const dz = player.z - pickup.z;
    const distance = hypot(dx, dz);
    const stats = currentStats(player, activeWeather(world));
    if (pickup.kind !== "chest" && distance < stats.pickup) pickup.magnet = true;
    if (pickup.magnet && distance > 0.01) {
      // Clear rewards visibly converge even from the far edge; never credit them before arrival.
      const speed =
        world.zone.phase === "cleared"
          ? PICKUP.clearSpeed + distance * PICKUP.clearDistanceSpeed
          : PICKUP.speed + PICKUP.nearSpeed * Math.max(0, 1 - distance / PICKUP.nearDistance);
      const step = Math.min(distance, speed * dt);
      pickup.x += (dx / distance) * step;
      pickup.z += (dz / distance) * step;
    }
    if (distance > PICKUP.collectDistance) {
      kept.push(pickup);
      continue;
    }
    collectPickup(world, pickup, player);
  }
  world.pickups = kept;
  // Keep the field readable and bounded: fold stray candies together.
  if (world.pickups.length > 260) mergeCandies(world);
}

/** One reward path for ordinary collection and drops still travelling when the team leaves. */
function collectPickup(world: World, pickup: Pickup, player: Player): void {
  if (collectRoutePickup(world, pickup, player)) return;
  world.events.push({ t: "pickup", kind: pickup.kind });
  switch (pickup.kind) {
    case "xp":
      for (const recipient of present(world))
        gainXp(
          world,
          recipient,
          pickup.value *
            currentStats(recipient, activeWeather(world)).xp *
            coopScaling(teamSize(world)).xp,
        );
      break;
    case "berry":
      heal(player, pickup.value);
      break;
    case "stardust":
      for (const recipient of present(world)) earnStardust(recipient, pickup.value);
      break;
    case "chest":
      for (const recipient of present(world))
        queueCard(world, recipient, "chest", pickup.minRarity);
      break;
  }
}

/** Explicit departure settles remaining drops once; absorption never blocks a zone transition. */
export function collectRemainingPickups(world: World): void {
  for (const pickup of world.pickups) {
    const player = pickupRecipient(world, pickup);
    if (player) collectPickup(world, pickup, player);
  }
  world.pickups = [];
}

function mergeCandies(world: World): void {
  const candies = world.pickups.filter((pickup) => pickup.kind === "xp" && !pickup.magnet);
  const [keeper] = candies;
  if (!keeper) return;
  for (const candy of candies.slice(1, 80)) {
    keeper.value += candy.value;
    candy.value = 0;
  }
  world.pickups = world.pickups.filter((pickup) => pickup.value > 0);
}
