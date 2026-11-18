import { coopScaling } from "./content/params/coop";
import { teamSize } from "./team";
import { currentStats } from "./stats";
import { difficulties, SWARM_HP, type Difficulty } from "./content/difficulties";
import { enemies as enemyDefs, type EnemyId } from "./content/enemies";
import { fireBeat } from "./beats";
import { fireFieldEvent } from "./field-events";
import { encounterSpecies, outbreakActive, recordEncounter } from "./encounters";
import { FLYER_HOVER } from "./content/params/combat";
import { FIELD_EVENTS } from "./content/params/field-events";
import { CHALLENGE_ALPHA } from "./content/params/rules";
import { updateSpawnPressure } from "./director-pressure";
import { bodyFits, canReach, refreshFlowFields, requestFlowField } from "./nav/index";
import { chance, range } from "./rng";
import { stageDefs } from "./content/stages/index";
import { routeSpawnFactors } from "./route-rewards";
import {
  clearZone,
  landmarkOf,
  zoneDef,
  zoneFactors,
  zoneGrowthClock,
  zoneTime,
  zoneTimeLimit,
} from "./currentZone";
import { ARENA_HALF, type World } from "./state/world";
import type { Enemy, Player } from "./state/entities";
import { cos, exp, hypot, sin } from "./math";
import { sampleSurface } from "./surface";
import { viewClearance } from "./viewFootprint";
import {
  ALPHA_HP,
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
  const factors = zoneFactors(world);
  const clock = zoneGrowthClock(world);
  const rampageSince = world.rampage
    ? zoneGrowthClock(world, stageDefs[world.stage].duration)
    : null;
  const base = enemyScaling(clock, world.difficulty, rampageSince);
  return {
    hp:
      enemyHealthScaling(clock, world.difficulty, rampageSince) *
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

export function enemyBodyScale(elite: boolean, boosted: boolean): number {
  return elite ? ELITE_BODY * (boosted ? CHALLENGE_ALPHA.body : 1) : 1;
}

function boostedElite(world: World, species: EnemyId, elite: boolean, site: number | null = null) {
  return (
    elite &&
    world.rules.includes("alpha-elites") &&
    (site !== null || species !== zoneDef(world).guardian.species)
  );
}

export function spawnEnemy(
  world: World,
  species: EnemyId,
  x: number,
  z: number,
  rank: boolean | "alpha" = false,
  site: number | null = null,
): Enemy {
  const elite = rank !== false;
  const alpha = rank === "alpha";
  const def = enemyDefs[species];
  const base = site !== null && def.encounter ? def.encounter : def;
  const s = zoneScaling(world);
  const factors = zoneFactors(world);
  const boss = site === null && species === zoneDef(world).guardian.species;
  const guardian = boss ? enemyScaling(GUARDIAN_REFERENCE_SECONDS, world.difficulty, null) : null;
  const boosted = boostedElite(world, species, elite, site);
  const alphaHp = boosted ? CHALLENGE_ALPHA.hp : alpha ? ALPHA_HP : 1;
  const body = enemyBodyScale(elite, boosted);
  const hp = boss
    ? bossHp(species, world.difficulty) * factors.guardianHp * coopScaling(teamSize(world)).bossHp
    : base.hp * s.hp * (elite ? ELITE.hp * routeSpawnFactors(world).eliteHp : 1) * alphaHp;
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
      base.speed *
      (guardian ? guardian.speed * factors.speed : s.speed) *
      (elite ? ELITE.speed : 1),
    // The guardian's every hit (contact, dash, Air Slash) reads this one value.
    dmg:
      base.dmg *
      (guardian ? guardian.dmg * factors.dmg : s.dmg) *
      (elite ? ELITE.dmg : 1) *
      (boss ? difficulties[world.difficulty].guardianDmg * factors.guardianDmg : 1) *
      (boosted ? CHALLENGE_ALPHA.damage : 1),
    radius: def.radius * body,
    scale: body,
    xp:
      base.xp *
      (elite ? ELITE.xp : 1) *
      factors.xp *
      difficulties[world.difficulty].xp *
      (!boss && outbreakActive(world, species) ? FIELD_EVENTS.outbreak.xp : 1),
    elite,
    shiny: false,
    shinyUntil: null,
    escape: null,
    site,
    alpha,
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
  recordEncounter(world, enemy);
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

type SpotAt = (x: number, z: number) => Spot | null;

/** Check every candidate at the final boosted size without changing unboosted arrivals. */
function arrivalCheck(world: World, species: EnemyId, elite = false): SpotAt {
  const def = enemyDefs[species];
  const { mobility } = def;
  const boosted = boostedElite(world, species, elite);
  const scale = enemyBodyScale(elite, boosted);
  const radius = def.radius * scale;
  const height = def.height * scale;
  const limit = ARENA_HALF - radius;
  // Match the airborne range in createRunView.ts. Flyers only collide with the arena bounds.
  const hover = mobility.flying ? FLYER_HOVER * scale : 0;
  const bob = mobility.flying ? 0.15 * scale : 0;
  return (x, z) => {
    if (boosted && (Math.abs(x) > limit || Math.abs(z) > limit)) return null;
    if (!canReach(world.nav, mobility, x, z)) return null;
    if (!boosted) return { x, z, clearance: viewClearance(world, x, z) };
    const water = mobility.water ? sampleSurface(world.map.terrain.surface, x, z).waterDepth : 0;
    const lift = (water > 0 ? water - height * 0.25 : 0) + hover - bob;
    const clearance = viewClearance(world, x, z, radius, height + 2 * bob, lift);
    if (clearance <= 1 || (!mobility.flying && !bodyFits(world.nav, mobility, x, z, radius)))
      return null;
    return { x, z, clearance };
  };
}

/**
 * On the ray from `player` through (x, z), the first spot the species can walk to a player from that
 * is off every player's screen (viewFootprint.ts): sliding up to `SPAWN_SLIDE` toward the player
 * first (reachability), then outward to the arena wall. Null when the ray has none.
 */
function raySpot(at: SpotAt, player: Player, x: number, z: number): Spot | null {
  const distance = hypot(x - player.x, z - player.z);
  const dirX = (x - player.x) / distance;
  const dirZ = (z - player.z) / distance;
  for (let back = 0; back <= Math.min(SPAWN_SLIDE, distance / 2); back += SPAWN_SEARCH_STEP) {
    const spot = at(player.x + dirX * (distance - back), player.z + dirZ * (distance - back));
    if (hidden(spot)) return spot;
  }
  for (let along = distance + SPAWN_SEARCH_STEP; ; along += SPAWN_SEARCH_STEP) {
    const sx = player.x + dirX * along;
    const sz = player.z + dirZ * along;
    if (Math.abs(sx) > ARENA_HALF || Math.abs(sz) > ARENA_HALF) break;
    const spot = at(sx, sz);
    if (hidden(spot)) return spot;
  }
  return null;
}

/**
 * The whole arena on a fixed `ARENA_SCAN_STEP` grid, in a stable order: the reachable off-screen
 * point nearest (x, z), or the least visible candidate as a last resort for the guardian.
 */
function arenaSpot(at: SpotAt, x: number, z: number): Spot | null {
  let near: Spot | null = null;
  let nearD = Infinity;
  let leastVisible: Spot | null = null;
  for (let sz = -ARENA_HALF; sz <= ARENA_HALF; sz += ARENA_SCAN_STEP) {
    for (let sx = -ARENA_HALF; sx <= ARENA_HALF; sx += ARENA_SCAN_STEP) {
      const spot = at(sx, sz);
      if (!spot) continue;
      if (spot.clearance > 1) {
        const d = (sx - x) ** 2 + (sz - z) ** 2;
        if (d < nearD) [near, nearD] = [spot, d];
      } else if (!leastVisible || spot.clearance > leastVisible.clearance) leastVisible = spot;
    }
  }
  return near ?? leastVisible;
}

/**
 * A spawn spot on the `min`–`max` ring around the player: the first of `RING_TRIES` random ring rays
 * with an off-screen spot, else the arena's off-screen spot nearest the player.
 */
function ringSpot(world: World, at: SpotAt, player: Player, min: number, max: number): Spot | null {
  for (let attempt = 0; attempt < RING_TRIES; attempt++) {
    const [x, z] = ringPoint(world, player, min, max);
    const spot = raySpot(at, player, x, z);
    if (spot) return spot;
  }
  return arenaSpot(at, player.x, player.z);
}

/** Ordinary arrivals require a reachable spot outside every player's screen. */
export function spawnReachable(
  world: World,
  species: EnemyId,
  player: Player,
  x: number,
  z: number,
  elite = false,
): Enemy | null {
  const at = arrivalCheck(world, species, elite);
  const spot = raySpot(at, player, x, z) ?? arenaSpot(at, x, z);
  return hidden(spot) ? spawnEnemy(world, species, spot.x, spot.z, elite) : null;
}

/** Ordinary ring arrivals wait if the visible views cover every reachable spot. */
export function spawnOnRing(
  world: World,
  species: EnemyId,
  player: Player,
  min: number,
  max: number,
  rank: boolean | "alpha" = false,
): Enemy | null {
  const spot = ringSpot(world, arrivalCheck(world, species, rank !== false), player, min, max);
  return hidden(spot) ? spawnEnemy(world, species, spot.x, spot.z, rank) : null;
}

/** The guardian must appear: a map where it can reach no player from anywhere is a broken map. */
function guardianSpot(world: World, species: EnemyId, player: Player): Spot {
  const spot = ringSpot(
    world,
    arrivalCheck(world, species),
    player,
    GUARDIAN_RING.min,
    GUARDIAN_RING.max,
  );
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
      ...zone.beats.flatMap(({ beat }) => ("species" in beat ? [beat.species].flat() : [])),
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
  const zone = zoneDef(world);
  const early = difficulties[world.difficulty].earlyBy;
  for (const [at, species] of zone.roster) {
    if (t >= at && !world.spawn.pool.includes(species)) world.spawn.pool.push(species);
  }
  if (!world.players.some((player) => player.alive)) return;

  for (const [index, { at, beat }] of world.zone.schedule.entries()) {
    if (t < at - early || world.spawn.fired.includes(index)) continue;
    world.spawn.fired.push(index);
    const player = nextAnchor(world)!;
    if (beat.kind === "event") fireFieldEvent(world, beat.id, player);
    else fireBeat(world, beat, player);
  }
  const limit = zoneTimeLimit(world);
  if (limit !== null && t >= limit && !world.rampage) {
    if (world.mode === "tower") {
      const pad = landmarkOf(world);
      clearZone(world, pad.x, pad.z);
      return;
    }
    world.rampage = true;
    world.events.push({
      t: "banner",
      text: stageDefs[world.stage].rampage.banner,
      tone: "danger",
      kind: "rampage",
    });
    if (world.bossId === null) summonGuardian(world, null);
  }

  releaseStrandedSwimmers(world);
  const factors = zoneFactors(world);
  const clock = zoneGrowthClock(world, t);
  const diff = difficulties[world.difficulty];
  const team = coopScaling(teamSize(world));
  const cap = liveCap(clock, world.difficulty) * factors.cap * team.cap;
  const living = world.enemies.length;
  const supply = updateSpawnPressure(world, dt);
  world.spawn.credit +=
    dt * spawnRate(clock, world.difficulty, world.rampage) * factors.spawns * team.spawns * supply;
  while (world.spawn.credit >= 1 && living < cap) {
    const target = nextAnchor(world)!;
    const stats = currentStats(target);
    const species = encounterSpecies(world);
    const elite = chance(
      world.rng,
      diff.eliteChance * stats.elites * routeSpawnFactors(world).eliteRate,
    );
    const enemy = spawnOnRing(world, species, target, SPAWN_RING.min, SPAWN_RING.max, elite);
    // Keep the credit for a later tick if the larger body could not arrive.
    if (!enemy && boostedElite(world, species, elite)) break;
    // White Flute / Repel: a spawn around this player costs less (more) credit, so more (fewer) come.
    world.spawn.credit -= 1 / stats.spawns;
    if (world.enemies.length >= cap) break;
  }
  world.spawn.credit = Math.min(world.spawn.credit, SPAWN_CREDIT_MAX);
}
