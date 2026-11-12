import { starters, type StarterId } from "./content/lines/index";
import { present, teamSize } from "./team";
import { moves } from "./content/moves";
import type { Difficulty } from "./content/difficulties";
import { DICE_FACES, diceKey, items, type ItemId } from "./content/items";
import { stageDefs, type StageId } from "./content/stages/index";
import { updateAreas, updateMoves, updateProjectiles } from "./attacks";
import { heal, type Ctx } from "./combat";
import { nearestPlayer, primeEnemyNav, updateDirector } from "./director";
import { updateEnemies } from "./enemies";
import { updateHazards } from "./hazards";
import { evolveInWorld } from "./evolution";
import { fuseMoves } from "./fusion";
import { EnemyGrid } from "./grid";
import { checkPlayable, generateMap, MapGenError, stageBodies } from "./mapgen/index";
import { createRng, next, type Rng } from "./rng";
import { decay, drainRate } from "./status";
import { DRAIN_FLOOR } from "./content/params/combat";
import { currentStats, earnStardust, NO_LAB, playerStats, refreshStats, xpForLevel } from "./stats";
import { fireUltimate, newUltState, updateUltimate } from "./ultimates/index";
import { updatePartners } from "./partners";
import { updateShield } from "./hurt";
import { fire } from "./triggers/index";
import { forget, interact, placeStations } from "./stations";
import { STATION_REACH } from "./content/params/stations";
import { sweepClearedField, interactAtLandmark } from "./zones";
import { applyChoice, banishKey, newMoveState, offerKey, rollChoices } from "./upgrades";
import { TICK, type World } from "./state/world";
import type { Command } from "./state/commands";
import type { LabBonuses, PendingChoice, Pickup, Player } from "./state/entities";
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
  archive?: readonly ItemId[];
  backpack?: readonly ItemId[];
}

export interface RunConfig {
  stage: StageId;
  seed: number;
  difficulty: Difficulty;
  /** Each peer's lab bonuses and loadout travel with the config; omitted means none. */
  players: readonly ({ starter: StarterId; lab?: LabBonuses } & Loadout)[];
}

/** Shared scratch grid; stepWorld is synchronous, so two worlds never use it at once. */
const grid = new EnemyGrid();

export function createPlayer(
  id: number,
  starter: StarterId,
  x: number,
  lab: LabBonuses = NO_LAB,
  loadout?: Loadout & { rng: Rng },
): Player {
  const def = starters[starter];
  const player: Player = {
    id,
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
    hp: 0, // max HP, set below once the carried items are on
    shield: 0,
    lastHurt: 0,
    alive: true,
    choosing: true,
    rescue: null,
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
    lab,
    training: { dmg: 0, hp: 0, speed: 0, area: 0, cd: 0 },
    ult: newUltState(),
    tmCase: false,
    dialog: null,
    kills: 0,
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
  const built = generateMap(config.seed, stageDefs[config.stage].map);
  const world: World = {
    stage: config.stage,
    seed: config.seed,
    rng: createRng(config.seed),
    difficulty: config.difficulty,
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
    spawn: { credit: 0, pressure: 0.5, pool: [], fired: [], anchor: -1 },
    bossId: null,
    zone: { index: 0, tick: 0, phase: "active" },
    rampage: false,
    events: [],
  };
  furnishMap(world, config.players.length);
  world.players = config.players.map((entry, index) =>
    createPlayer(index, entry.starter, spawnX(index, config.players.length), entry.lab, {
      ...entry,
      rng: world.rng,
    }),
  );
  for (const player of world.players) player.choosing = world.players.length === 1;
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
  checkPlayable(
    world.nav,
    {
      spawns: Array.from({ length: players }, (_, index) => ({ x: spawnX(index, players), z: 0 })),
      landmarks: world.map.pads.filter((pad) => pad.tag === "landmark"),
      stations: world.stations.map(({ x, z, radius }) => ({ x, z, radius, reach: STATION_REACH })),
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

export function applyCommand(world: World, command: Command): void {
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

  switch (command.t) {
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
    case "choices":
      if (world.players.length === 1) return;
      player.choosing = command.open && player.pending.length > 0 && !player.dialog;
      if (player.choosing) player.rescue = null;
      return;
    case "pick": {
      const pending = player.pending[0];
      if (pending?.id !== command.card) return;
      const choice = pending.options[command.index];
      if (!choice) return;
      world.events.push({
        t: "card",
        player: player.id,
        card: pending.id,
        action: "pick",
        index: command.index,
      });
      applyChoice(player, choice);
      if (choice.kind === "item") pickEffects(world, player, choice.item);
      nextCard(world, player);
      return;
    }
    case "skip": {
      if (player.pending[0]?.id !== command.card || player.skips <= 0) return;
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
      pending.options = rollChoices(world.rng, player, pending.source, world.partners);
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
      if (player.dialog?.id === command.dialog) player.dialog = null;
      return;
    case "interact":
      if (isFrozen(world)) return;
      if (player.rescue) {
        player.rescue = null;
        return;
      }
      if (startRescue(world, player)) return;
      if (world.players.length > 1 && interactAtLandmark(world, player)) return;
      if (world.players.length > 1 && player.pending.length > 0 && !player.dialog) {
        player.choosing = true;
        return;
      }
      if (!interactAtLandmark(world, player)) interact(world, player);
      return;
    case "reroll": {
      const pending = player.pending[0];
      if (pending?.id !== command.card || player.rerolls <= 0) return;
      player.rerolls -= 1;
      world.events.push({ t: "card", player: player.id, card: pending.id, action: "reroll" });
      pending.id = world.nextId++;
      pending.options = rollChoices(world.rng, player, pending.source, world.partners);
      return;
    }
  }
}

function stationOf(world: World, player: Player) {
  return world.stations.find((station) => station.id === player.dialog?.station);
}

/** Drops the answered front card and rolls the next one against the kit as it is now. */
function nextCard(world: World, player: Player): void {
  player.pending.shift();
  const front = player.pending[0];
  if (!front && world.players.length > 1) player.choosing = false;
  if (front) front.options = rollChoices(world.rng, player, front.source, world.partners);
}

function revive(world: World, player: Player): void {
  player.revives -= 1;
  revivePlayer(world, player, REVIVE.hp, REVIVE.invulnerable, "personal");
}

export function stepWorld(world: World, commands: readonly Command[]): void {
  step(world, commands, false);
}

/** Multiplayer host advances shared life and its own attacks; guests own their motion and casts. */
export function stepSharedWorld(world: World, commands: readonly Command[]): void {
  step(world, commands, true);
}

function step(world: World, commands: readonly Command[], shared: boolean): void {
  for (const command of commands) applyCommand(world, command);
  if (world.outcome !== "playing" || isFrozen(world)) return;

  const dt = TICK;
  world.time += dt;
  world.tick += 1;
  refreshStats();
  grid.rebuild(world.enemies);
  const ctx: Ctx = { world, grid, ...(shared ? { attackOwner: 0 } : {}) };

  for (const player of world.players) updatePlayer(ctx, player, dt);
  updateDirector(world, dt);
  grid.rebuild(world.enemies);
  updateEnemies(ctx, dt);
  grid.rebuild(world.enemies);
  updateProjectiles(ctx, dt);
  updateAreas(ctx, dt);
  updatePartners(ctx, dt);
  const remotePositions = shared ? world.players.slice(1).map(({ x, z }) => ({ x, z })) : [];
  updateHazards(world, dt);
  // Terrain/hazard health effects stay shared; remote owners already applied their displacement.
  if (shared)
    world.players
      .slice(1)
      .forEach((player, index) => Object.assign(player, remotePositions[index]));
  updatePickups(world, dt);
  // After pickups: a level-up this tick queues its card first, and the station waits for it.

  for (const player of world.players)
    if (!player.alive && player.revives > 0) revive(world, player);
  updateRescues(world, dt);
  // A guardian falling on the tick the last player does still loses the run.
  if (world.players.every((player) => !player.alive)) world.outcome = "defeat";
  else sweepClearedField(world);
}

function updatePlayer(ctx: Ctx, player: Player, dt: number): void {
  const owned = ctx.attackOwner === undefined || ctx.attackOwner === player.id;
  if (owned) {
    player.px = player.x;
    player.pz = player.z;
  }
  if (!player.alive) return;
  const stats = currentStats(player);
  player.invulnerable = Math.max(0, player.invulnerable - dt);
  player.cardHold = Math.max(0, player.cardHold - dt);
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
  if (drain > 0) player.hp = Math.max(DRAIN_FLOOR, player.hp - drain * dt);
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

function updatePickups(world: World, dt: number): void {
  const kept = [];
  for (const pickup of world.pickups) {
    const player = nearestPlayer(world, pickup.x, pickup.z);
    if (!player) return;
    const dx = player.x - pickup.x;
    const dz = player.z - pickup.z;
    const distance = hypot(dx, dz);
    const stats = currentStats(player);
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
  world.events.push({ t: "pickup", kind: pickup.kind });
  switch (pickup.kind) {
    case "xp":
      for (const recipient of present(world))
        gainXp(
          world,
          recipient,
          pickup.value * currentStats(recipient).xp * coopScaling(teamSize(world)).xp,
        );
      break;
    case "berry":
      heal(player, pickup.value);
      break;
    case "stardust":
      for (const recipient of present(world)) earnStardust(recipient, pickup.value);
      break;
    case "chest":
      for (const recipient of present(world)) queueCard(world, recipient, "chest");
      break;
  }
}

/** Explicit departure settles remaining drops once; absorption never blocks a zone transition. */
export function collectRemainingPickups(world: World): void {
  for (const pickup of world.pickups)
    collectPickup(world, pickup, nearestPlayer(world, pickup.x, pickup.z)!);
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

/** Only the front card is rolled: one queued behind it would be rolled against an outdated kit. */
function queueCard(world: World, player: Player, source: PendingChoice["source"]): void {
  const front = player.pending.length === 0;
  player.pending.push({
    id: world.nextId++,
    source,
    options: front ? rollChoices(world.rng, player, source, world.partners) : [],
  });
}

/**
 * An item level's immediate effects (`ItemDef.onPick`): whole player levels (Rare Candy; their cards
 * queue behind the one being answered) and a die roll stored for the fold (Loaded Dice).
 */
function pickEffects(world: World, player: Player, id: ItemId): void {
  const { onPick } = items[id];
  if (!onPick) return;
  if (onPick.roll) {
    const level = player.items.find((item) => item.id === id)!.level;
    rollDice(world.rng, player, level);
  }
  for (let i = 0; i < (onPick.levels ?? 0); i++) gainXp(world, player, player.xpNext - player.xp);
}

function rollDice(rng: Rng, player: Player, level: number): void {
  player.fx[diceKey(level)] = Math.floor(next(rng) * DICE_FACES.length);
}

function gainXp(world: World, player: Player, amount: number): void {
  player.xp += amount;
  while (player.xp >= player.xpNext) {
    player.xp -= player.xpNext;
    player.level += 1;
    player.xpNext = xpForLevel(player.level);
    // Before the card is rolled, so a new stage's evolution move is already in the pool.
    evolveInWorld(world, player);
    if (!player.alive) player.hp = 0;
    if (world.players.length > 1) player.cardHold = 0;
    // Level and stage feed the stats: later pickups this tick (berries, candy) read the new ones.
    refreshStats();
    queueCard(world, player, "level");
    world.events.push({ t: "level", player: player.id, level: player.level });
  }
}
