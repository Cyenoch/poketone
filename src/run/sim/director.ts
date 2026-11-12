import { coopScaling } from "./content/params/coop";
import { teamSize } from "./team";
import { currentStats } from "./stats";
import { difficulties, SWARM_HP, type Difficulty } from "./content/difficulties";
import { enemies as enemyDefs, type EnemyId } from "./content/enemies";
import { fireBeat } from "./beats";
import { updateSpawnPressure } from "./director-pressure";
import { canReach, refreshFlowFields, requestFlowField } from "./nav/index";
import { chance, pick, range } from "./rng";
import { stageDefs } from "./content/stages/index";
import { zoneClock, zoneHealthClock } from "./content/params/zones";
import { landmarkOf, zoneDef, zoneFactors, zoneTime } from "./currentZone";
import { ARENA_HALF, type World } from "./state/world";
import type { Enemy, Player } from "./state/entities";
import { cos, exp, hypot, sin } from "./math";
import { viewClearance } from "./viewFootprint";
import {
  ELITE,
  ELITE_BODY,
  ENEMY_HEALTH,
  GUARDIAN_HP,
  GUARDIAN_HP_CURVE,
  GUARDIAN_REFERENCE_SECONDS,
  GUARDIAN_RING,
  GUARDIAN_SUMMON_DISTANCE,
  HP_CURVE,
  LIVE_CAP,
  RAMPAGE,
  SPAWN_CREDIT_MAX,
  SPAWN_CURVE,
  SPAWN_RING,
  SWARM_GROWTH,
} from "./content/params/pacing";

/** An unreachable spawn spot slides at most this far toward the player looking for walkable ground. */
const SPAWN_SLIDE = 6;
const SPAWN_SEARCH_STEP = 0.5;
/** Random ring rays a ring spawn tries before searching the whole arena. */
const RING_TRIES = 4;
/** Grid spacing (u) of the whole-arena search for an off-screen spot when the rays found none. */
const ARENA_SCAN_STEP = 2;

/**
 * 2^(doublings per minute of rampage), via sim/math's `exp` so every engine agrees. `since` is the
 * second the rampage began (the stage's `duration`), null outside one.
 */
function rampageFactor(time: number, since: number | null, doublings: number): number {
  return since !== null ? exp(((time - since) / 60) * doublings * Math.LN2) : 1;
}

export interface EnemyScaling {
  hp: number;
  dmg: number;
  speed: number;
}

/**
 * Shared growth curves at `time` seconds (HP also feeds partner damage), before enemy-only tuning.
 * `rampageSince` is the second a rampage began, null outside one.
 */
export function enemyScaling(
  time: number,
  difficulty: Difficulty,
  rampageSince: number | null,
): EnemyScaling {
  const m = time / 60;
  const diff = difficulties[difficulty];
  return {
    hp:
      (1 + m * HP_CURVE.perMinute + Math.max(0, m - HP_CURVE.lateFrom) ** 2 * HP_CURVE.late) *
      diff.hp *
      rampageFactor(time, rampageSince, RAMPAGE.hpDoublings),
    dmg:
      (1 + m * SWARM_GROWTH.dmgPerMinute) *
      diff.dmg *
      rampageFactor(time, rampageSince, RAMPAGE.dmgDoublings),
    speed: Math.min(SWARM_GROWTH.speedMax, 1 + SWARM_GROWTH.speedPerMinute * m) * diff.speed,
  };
}

/** Enemy-only HP multiplier; shared growth still supplies the original partner damage curve. */
export function enemyHealthScaling(
  time: number,
  difficulty: Difficulty,
  rampageSince: number | null,
): number {
  const { earlySeconds, earlyGain, lateSeconds, lateGain } = ENEMY_HEALTH;
  const early = Math.min(1, time / earlySeconds) * earlyGain;
  const late =
    Math.min(1, Math.max(0, (time - earlySeconds) / (lateSeconds - earlySeconds))) * lateGain;
  return enemyScaling(time, difficulty, rampageSince).hp * SWARM_HP * (1 + early + late);
}

/** The swarm's multipliers now: the curves at the zone's clock, times the zone's own factors. */
export function zoneScaling(world: World): EnemyScaling {
  const zone = world.zone.index;
  const stage = stageDefs[world.stage];
  const factors = zoneFactors(world);
  const base = enemyScaling(
    zoneClock(stage, zone, zoneTime(world)),
    world.difficulty,
    world.rampage ? zoneClock(stage, zone, stage.duration) : null,
  );
  return {
    hp:
      enemyHealthScaling(
        zoneHealthClock(stage, zone, zoneTime(world)),
        world.difficulty,
        world.rampage ? zoneHealthClock(stage, zone, stage.duration) : null,
      ) *
      factors.hp *
      coopScaling(teamSize(world)).hp,
    dmg: base.dmg * factors.dmg,
    speed: base.speed * factors.speed,
  };
}

/** Guardian durability at the fixed challenge reference, regardless of when it is summoned. */
export function bossHp(species: EnemyId, difficulty: Difficulty): number {
  return (
    enemyDefs[species].hp *
    (1 + (GUARDIAN_REFERENCE_SECONDS / 60) * GUARDIAN_HP_CURVE.perMinute) *
    difficulties[difficulty].hp *
    difficulties[difficulty].guardianHp *
    GUARDIAN_HP
  );
}

export function spawnRate(time: number, difficulty: Difficulty, rampage: boolean): number {
  const m = time / 60;
  const { base, perMinute, late } = SPAWN_CURVE;
  return (
    (base + perMinute * m + late * m * m) *
    difficulties[difficulty].amount *
    (rampage ? RAMPAGE.spawns : 1)
  );
}

/** Living enemies above which the director stops spawning. */
export function liveCap(time: number, difficulty: Difficulty): number {
  return Math.min(
    LIVE_CAP.max,
    (LIVE_CAP.base + LIVE_CAP.perMinute * (time / 60)) *
      (1 + (difficulties[difficulty].amount - 1) * LIVE_CAP.amountWeight),
  );
}

export function nearestPlayer(world: World, x: number, z: number): Player | undefined {
  let best: Player | undefined;
  let bestD = Infinity;
  for (const player of world.players) {
    if (!player.alive) continue;
    const d = (player.x - x) ** 2 + (player.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = player;
    }
  }
  return best;
}

/**
 * The next living player after the last anchor, in `players` order: each spawn, beat and the guardian
 * is placed around a different player in turn, so in co-op no one player draws the whole stage. Solo
 * always returns the one player (or undefined once they are down).
 */
function nextAnchor(world: World): Player | undefined {
  const { players, spawn } = world;
  for (let step = 1; step <= players.length; step++) {
    const index = (spawn.anchor + step) % players.length;
    const player = players[index]!;
    if (!player.alive) continue;
    spawn.anchor = index;
    return player;
  }
  return undefined;
}

function clampArena(value: number): number {
  return Math.max(-ARENA_HALF, Math.min(ARENA_HALF, value));
}

export function spawnEnemy(
  world: World,
  species: EnemyId,
  x: number,
  z: number,
  elite = false,
): Enemy {
  const def = enemyDefs[species];
  const s = zoneScaling(world);
  const factors = zoneFactors(world);
  const boss = species === zoneDef(world).guardian.species;
  const guardian = boss ? enemyScaling(GUARDIAN_REFERENCE_SECONDS, world.difficulty, null) : null;
  const hp = boss
    ? bossHp(species, world.difficulty) * factors.guardianHp * coopScaling(teamSize(world)).bossHp
    : def.hp * s.hp * (elite ? ELITE.hp : 1);
  const enemy: Enemy = {
    id: world.nextId++,
    species,
    x: clampArena(x),
    z: clampArena(z),
    px: x,
    pz: z,
    faceX: 0,
    faceZ: 1,
    hp,
    maxHp: hp,
    speed:
      def.speed * (guardian ? guardian.speed * factors.speed : s.speed) * (elite ? ELITE.speed : 1),
    // The guardian's every hit (contact, dash, Air Slash) reads this one value.
    dmg:
      def.dmg *
      (guardian ? guardian.dmg * factors.dmg : s.dmg) *
      (elite ? ELITE.dmg : 1) *
      (boss ? difficulties[world.difficulty].guardianDmg * factors.guardianDmg : 1),
    radius: def.radius * (elite ? ELITE_BODY : 1),
    scale: elite ? ELITE_BODY : 1,
    xp: def.xp * (elite ? ELITE.xp : 1) * factors.xp * difficulties[world.difficulty].xp,
    elite,
    alpha: false,
    boss,
    knockX: 0,
    knockZ: 0,
    flash: 0,
    statuses: [],
    hardened: 0,
    stagger: 0,
    attackTimer: def.skill ? range(world.rng, 1, def.skill.every) : 0,
    phase: "chase",
    phaseTime: 0,
    strikes: 0,
    dashX: 0,
    dashZ: 0,
    charge: false,
    sightline: false,
  };
  enemy.px = enemy.x;
  enemy.pz = enemy.z;
  world.enemies.push(enemy);
  return enemy;
}

/**
 * A point `min`–`max` from the player. An axis that would leave the arena is mirrored back across the
 * player instead of clamped, so a player at the wall still gets spawns at full distance (the arena is
 * far wider than twice the largest ring, so the mirrored side is always inside).
 */
export function ringPoint(
  world: World,
  player: Player,
  min: number,
  max: number,
): [number, number] {
  const angle = range(world.rng, 0, Math.PI * 2);
  const distance = range(world.rng, min, max);
  const inward = (from: number, offset: number) =>
    Math.abs(from + offset) <= ARENA_HALF ? from + offset : from - offset;
  return [inward(player.x, cos(angle) * distance), inward(player.z, sin(angle) * distance)];
}

interface Spot {
  x: number;
  z: number;
  /** viewClearance: above 1 is off every screen. */
  clearance: number;
}

const hidden = (spot: Spot | null): spot is Spot => spot !== null && spot.clearance > 1;

/**
 * On the ray from `player` through (x, z), the first spot the species can walk to a player from that
 * is off every player's screen (viewFootprint.ts): sliding up to `SPAWN_SLIDE` toward the player
 * first (reachability), then outward to the arena wall. Null when the ray has none.
 */
function raySpot(
  world: World,
  species: EnemyId,
  player: Player,
  x: number,
  z: number,
): Spot | null {
  const { mobility } = enemyDefs[species];
  const distance = hypot(x - player.x, z - player.z);
  const dirX = (x - player.x) / distance;
  const dirZ = (z - player.z) / distance;
  const at = (along: number): Spot | null => {
    const sx = player.x + dirX * along;
    const sz = player.z + dirZ * along;
    if (!canReach(world.nav, mobility, sx, sz)) return null;
    return { x: sx, z: sz, clearance: viewClearance(world, sx, sz) };
  };
  for (let back = 0; back <= Math.min(SPAWN_SLIDE, distance / 2); back += SPAWN_SEARCH_STEP) {
    const spot = at(distance - back);
    if (hidden(spot)) return spot;
  }
  for (let along = distance + SPAWN_SEARCH_STEP; ; along += SPAWN_SEARCH_STEP) {
    if (Math.abs(player.x + dirX * along) > ARENA_HALF) break;
    if (Math.abs(player.z + dirZ * along) > ARENA_HALF) break;
    const spot = at(along);
    if (hidden(spot)) return spot;
  }
  return null;
}

/**
 * The whole arena on a fixed `ARENA_SCAN_STEP` grid, in a stable order: the reachable off-screen
 * point nearest (x, z), or, only when every reachable point is on someone's screen, the least
 * visible one. Null when the species can reach a player from nowhere.
 */
function arenaSpot(world: World, species: EnemyId, x: number, z: number): Spot | null {
  const { mobility } = enemyDefs[species];
  let near: Spot | null = null;
  let nearD = Infinity;
  let leastVisible: Spot | null = null;
  for (let sz = -ARENA_HALF; sz <= ARENA_HALF; sz += ARENA_SCAN_STEP) {
    for (let sx = -ARENA_HALF; sx <= ARENA_HALF; sx += ARENA_SCAN_STEP) {
      if (!canReach(world.nav, mobility, sx, sz)) continue;
      const spot = { x: sx, z: sz, clearance: viewClearance(world, sx, sz) };
      if (spot.clearance > 1) {
        const d = (sx - x) ** 2 + (sz - z) ** 2;
        if (d < nearD) [near, nearD] = [spot, d];
      } else if (!leastVisible || spot.clearance > leastVisible.clearance) leastVisible = spot;
    }
  }
  return near ?? leastVisible;
}

/** A spawn aimed at (x, z): `raySpot`, else the arena's off-screen spot nearest the aim. */
function aimedSpot(
  world: World,
  species: EnemyId,
  player: Player,
  x: number,
  z: number,
): Spot | null {
  return raySpot(world, species, player, x, z) ?? arenaSpot(world, species, x, z);
}

/**
 * A spawn spot on the `min`–`max` ring around the player: the first of `RING_TRIES` random ring rays
 * with an off-screen spot, else the arena's off-screen spot nearest the player.
 */
function ringSpot(
  world: World,
  species: EnemyId,
  player: Player,
  min: number,
  max: number,
): Spot | null {
  for (let attempt = 0; attempt < RING_TRIES; attempt++) {
    const [x, z] = ringPoint(world, player, min, max);
    const spot = raySpot(world, species, player, x, z);
    if (spot) return spot;
  }
  return arenaSpot(world, species, player.x, player.z);
}

/** Spawns at `aimedSpot`; skipped (null) only when the species can reach a player from nowhere. */
export function spawnReachable(
  world: World,
  species: EnemyId,
  player: Player,
  x: number,
  z: number,
  elite = false,
): Enemy | null {
  const spot = aimedSpot(world, species, player, x, z);
  return spot ? spawnEnemy(world, species, spot.x, spot.z, elite) : null;
}

/** Spawns at `ringSpot`; skipped (null) only when the species can reach a player from nowhere. */
export function spawnOnRing(
  world: World,
  species: EnemyId,
  player: Player,
  min: number,
  max: number,
  elite = false,
): Enemy | null {
  const spot = ringSpot(world, species, player, min, max);
  return spot ? spawnEnemy(world, species, spot.x, spot.z, elite) : null;
}

/** The guardian must appear: a map where it can reach no player from anywhere is a broken map. */
function guardianSpot(world: World, species: EnemyId, player: Player): Spot {
  const spot = ringSpot(world, species, player, GUARDIAN_RING.min, GUARDIAN_RING.max);
  if (!spot)
    throw new Error(`guardian ${species} can reach no player from anywhere on ${world.stage}`);
  return spot;
}

/**
 * Brings the zone's guardian: at the landmark, across it from `summoner` (a deliberate on-screen
 * arrival: the player called it), or, with no summoner (the final swarm began first), off-screen
 * around the next anchor like any spawn.
 */
export function summonGuardian(world: World, summoner: Player | null): void {
  const { species, banner } = zoneDef(world).guardian;
  let spot: { x: number; z: number } | null = null;
  if (summoner) {
    const pad = landmarkOf(world);
    const dx = pad.x - summoner.x;
    const dz = pad.z - summoner.z;
    const length = hypot(dx, dz);
    const [ux, uz] = length > 0.01 ? [dx / length, dz / length] : [summoner.faceX, summoner.faceZ];
    const x = pad.x + ux * GUARDIAN_SUMMON_DISTANCE;
    const z = pad.z + uz * GUARDIAN_SUMMON_DISTANCE;
    if (canReach(world.nav, enemyDefs[species].mobility, x, z)) spot = { x, z };
  }
  spot ??= guardianSpot(world, species, summoner ?? nextAnchor(world)!);
  world.bossId = spawnEnemy(world, species, spot.x, spot.z).id;
  world.events.push({ t: "banner", text: banner, tone: "boss", kind: "guardian" });
}

/**
 * Builds the flow field of each walker class the stage's zones field toward the starting players, so
 * the first spawns can test reachability. A class no zone of the stage uses gets no layer.
 */
export function primeEnemyNav(world: World): void {
  for (const zone of stageDefs[world.stage].zones)
    for (const species of [
      zone.guardian.species,
      ...zone.roster.map(([, id]) => id),
      ...zone.beats.flatMap(([, beat]) => ("species" in beat ? [beat.species].flat() : [])),
    ]) {
      const { mobility } = enemyDefs[species];
      if (!mobility.flying) requestFlowField(world.nav, mobility);
    }
  refreshFlowFields(world.nav, world.players, Infinity);
}

/**
 * A swimmer the players left behind can never follow them ashore, and would hold a live-cap slot for
 * good: once it is off every screen and beyond the spawn ring from every living player it swims off
 * (removed, no kill, no loot).
 */
function releaseStrandedSwimmers(world: World): void {
  for (const enemy of world.enemies) {
    if (enemyDefs[enemy.species].mobility.water !== "swim" || enemy.boss) continue;
    const near = world.players.some(
      (player) => player.alive && hypot(player.x - enemy.x, player.z - enemy.z) <= SPAWN_RING.max,
    );
    if (!near && viewClearance(world, enemy.x, enemy.z) > 1) enemy.hp = 0;
  }
}

/** The zone's clock and spawns: nothing runs once its guardian has fallen. */
export function updateDirector(world: World, dt: number): void {
  if (world.zone.phase !== "active") return;
  world.zone.tick += 1;
  const t = zoneTime(world);
  const stage = stageDefs[world.stage];
  const zone = zoneDef(world);
  const factors = zoneFactors(world);
  const clock = zoneClock(stage, world.zone.index, t);
  const early = difficulties[world.difficulty].earlyBy;
  for (const [at, species] of zone.roster) {
    if (t >= at && !world.spawn.pool.includes(species)) world.spawn.pool.push(species);
  }
  if (!world.players.some((player) => player.alive)) return;

  for (const [at, beat] of zone.beats) {
    const key = `${beat.kind}@${at}`;
    if (t < at - early || world.spawn.fired.includes(key)) continue;
    world.spawn.fired.push(key);
    fireBeat(world, beat, nextAnchor(world)!);
  }
  // The final swarm: no zone runs past it without its guardian.
  if (t >= stage.duration && !world.rampage) {
    world.rampage = true;
    world.events.push({ t: "banner", text: stage.rampage.banner, tone: "danger", kind: "rampage" });
    if (world.bossId === null) summonGuardian(world, null);
  }

  releaseStrandedSwimmers(world);
  const diff = difficulties[world.difficulty];
  const team = coopScaling(teamSize(world));
  const cap = liveCap(clock, world.difficulty) * factors.cap * team.cap;
  const living = world.enemies.length;
  const supply = updateSpawnPressure(world, dt);
  world.spawn.credit +=
    dt * spawnRate(clock, world.difficulty, world.rampage) * factors.spawns * team.spawns * supply;
  while (world.spawn.credit >= 1 && living < cap) {
    const target = nextAnchor(world)!;
    // White Flute / Repel: a spawn around this player costs less (more) credit, so more (fewer) come.
    const stats = currentStats(target);
    world.spawn.credit -= 1 / stats.spawns;
    const species = pick(world.rng, world.spawn.pool);
    const elite = chance(world.rng, diff.eliteChance * stats.elites);
    spawnOnRing(world, species, target, SPAWN_RING.min, SPAWN_RING.max, elite);
    if (world.enemies.length >= cap) break;
  }
  world.spawn.credit = Math.min(world.spawn.credit, SPAWN_CREDIT_MAX);
}
