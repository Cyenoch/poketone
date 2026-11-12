import {
  ERUPTION,
  ZONE_GUARDIAN,
  ZONE_ATTACK,
  ZONE_ACTION as ZA,
  TRAIL,
  SING_SLOW,
  FIRE_PUNCHES,
} from "../sim/content/params/late-zones";
import { HURT_TICKS } from "../sim/content/params/environment";
import { TICK } from "../sim/state/world";
// Analytical balance model: a one-second stock-and-flow over aggregate quantities (living enemies,
// XP, HP, guardian HP) driven by the sim's own formulas. The card draws and captures are sampled: each
// of a fixed set of seeded build samples runs its own stocks through the real `rollChoices` /
// `applyChoice`, and the outcomes are averaged. HP is a distribution (`survival.ts`), everything else
// expected value. Method, assumptions and fitted factors: docs/BALANCE.md.

import { BERRY, LOOT, STARDUST } from "../sim/content/params/economy";
import {
  DASH_COOLDOWN,
  PLAYER_IFRAMES,
  SHIELD,
  EVOLVE_INVULNERABLE,
} from "../sim/content/params/player";
import { difficulties, type Difficulty } from "../sim/content/difficulties";
import { enemies, type EnemyId } from "../sim/content/enemies";
import { moves as moveDefs, type MoveId } from "../sim/content/moves";
import { modelOf, setMeasures, type Ledger } from "./triggers";
import { PER_STATUS_CAP } from "../sim/content/effects";
import { starters, type StarterId } from "../sim/content/lines/index";
import { signatureFusions } from "../sim/content/fusions";
import { typeMultiplier, typeNames, type ElementType } from "../sim/content/elements";
import { statuses, type EnemyStatusId, type StatusDef } from "../sim/content/statuses";
import {
  AIR_SLASH,
  AIR_SLASH_DMG,
  BOSS_CHASE_JITTER,
  BOSS_CHASE_MIN,
  BOSS_DASH_TIME,
  BOSS_RECOVER,
  BOSS_SLASH_BELOW,
  BOSS_WINDUP,
  FISSURE,
  HYDRO_PUMP,
  SHARD,
  STOMP,
  TWISTER,
  GYARADOS,
  KINGLER,
  STARMIE,
  NIDOKING,
  PINSIR,
  AERODACTYL,
  MAROWAK,
  SANDSLASH,
  furyOf,
  type FuryCast,
  type GuardianFury,
} from "../sim/content/params/guardian";
import type { BeatKind } from "../sim/beats";
import {
  ALPHA_HP,
  DIRECTOR_PRESSURE,
  ELITE,
  ELITE_BODY,
  ELITE_WAVE_SIZE,
  GUARDIAN_REFERENCE_SECONDS,
  STAMPEDE_SIZE,
  SWARM_SIZE,
} from "../sim/content/params/pacing";
import { bossHp, enemyHealthScaling, enemyScaling, liveCap, spawnRate } from "../sim/director";
import { advancePressure, pressureSupply, pressureTarget } from "../sim/director-pressure";
import { stageDefs, type StageId, type StageZone } from "../sim/content/stages/index";
import { zoneClock, zoneHealthClock, zoneFactorsFor, zonesOf } from "../sim/content/params/zones";
import { CONTACT_SECONDS, STAGGER, DRAIN_FLOOR } from "../sim/content/params/combat";
import { skills } from "../sim/skills/index";
import {
  ACID,
  EGG,
  AURA,
  HARDEN,
  HEAL_PULSE,
  LANDING,
  BONEMERANG,
  FLAME_TRAIL,
  PECK,
  ROCKFALL,
  PSYBEAM,
  PSYBEAM_HEAVY,
  VINE,
  RADIAL,
  ENEMY_SHOTS,
  BUBBLE,
  SPORE,
  STUN_SPORE,
} from "../sim/content/params/enemy-skills";

import { hazards as shotHazards } from "../sim/skills/shot";

import { guardianBrains, type GuardianBrainId } from "../sim/bosses/index";

import { poiseOf } from "../sim/poise";
import { createRng, next, type Rng } from "../sim/rng";
import { armorFactor, itemRule, playerStats, xpForLevel, type PlayerStats } from "../sim/stats";
import type { Choice, LabBonuses, Partner, Player } from "../sim/state/entities";
import { items as itemDefs } from "../sim/content/items";
import {
  applyChoice,
  itemSlots,
  moveSlots,
  rarityOdds,
  rollChoices,
  rollsPerUpgrade,
} from "../sim/upgrades";
import { rarityPower } from "../sim/content/params/cards";
import { fuseMoves } from "../sim/fusion";
import { evolve, formOf, hazardRadius } from "../sim/evolution";
import { ULT_INVULNERABLE } from "../sim/content/params/ultimates";
import { drainAt } from "../sim/status";
import { createPlayer } from "../sim/world";
import { PARTNER_ATTACK, CAPTURE_CHANCE, GUARD } from "../sim/content/params/partners";
import { partnerSlots, styleOf } from "../sim/partners";

import {
  AIM_DISTANCE,
  blankOutput,
  bonkFactor,
  FIELD_RADIUS,
  MELEE_STEP,
  moveOutput,
  TERRAIN_SIGHT,
  type MoveOutput,
  type Target,
} from "./output";
import type { PickPolicy, SkillProfile } from "./skill";
import {
  aliveOf,
  BINS,
  catchPmf,
  createHp,
  fullShare,
  hitPmf,
  hpShare,
  growHp,
  refund,
  stepHp,
  type DamageEvent,
  type HpState,
  type Save,
} from "./survival";
import { ultCast, ultChargeRate } from "./ultimate";
import { CAMPAIGN_FIELDS } from "../sim/content/campaign";

const STEP = 1;
/** The run is followed this far past the stage end (rampage) before it is called. */
const OVERTIME = 120;
export const BUILD_SAMPLES = 32;
/**
 * Share of spawn credits that become enemies: ring spots with no reachable ground are skipped
 * (fitted: the bot's kills + living fall 1–15% short of the nominal spawn integral).
 */
export const SPAWN_SUCCESS = 0.92;
/**
 * Spawns walk this far before they reach the fight (engaging ~9 m out). They start on the 18–24 ring
 * but are pushed along their ray until off every screen (director.ts `spawnSpot`), which on the run
 * camera puts them 23 m out on average (p10 19, p90 29; front corners up to 36).
 */
const APPROACH = 14;
/** Stampede runners mostly pass through; this share stays and joins the crowd. */
const STAMPEDE_STAY = 0.5;
/**
 * What each beat adds: enemies to the crowd (given the difficulty's amount), elites to the stock, or
 * seconds of falling hazards around the player (`ERUPTION`).
 */
const BEAT_LOAD: Record<
  BeatKind,
  { crowd: (amount: number) => number } | { elites: number } | { hazard: number }
> = {
  alpha: { elites: 1 },
  "elite-wave": { elites: ELITE_WAVE_SIZE },
  swarm: { crowd: (amount) => Math.round(SWARM_SIZE * amount) },
  stampede: { crowd: () => STAMPEDE_SIZE * STAMPEDE_STAY },
  eruption: { hazard: ERUPTION.duration },
};

/**
 * Eruption hits per second on a kiter at `speed`, body `body` wide. A bomb is not aimed at the player:
 * it lands on a spot uniform in its ring, so a straight-running kiter, who is about `speed × windup`
 * along by then (inside the ring), is under it with the share of the ring a circle of the bomb's reach
 * covers. Reading it is `dodge`: the guardian share, as for the guardians' falling circles (big ground
 * circles to steer around mid-fight, not a swarm wind-up to step out of). Its pool is ahead of the
 * kiter only on the strip between the landing point and the ring's outer edge; a crossing costs the
 * ticks spent inside.
 */
function eruptionHits(
  speed: number,
  body: number,
  dodge: number,
): { bombs: number; pools: number } {
  const [inner, outer] = ERUPTION.ring;
  const ring = Math.PI * (outer ** 2 - inner ** 2);
  const missed = 1 - dodge;
  const under = Math.min(1, (Math.PI * (ERUPTION.radius + body) ** 2) / ring);
  const ahead = Math.max(0, outer - speed * ERUPTION.windup) + ERUPTION.pool + body;
  const crossed = Math.min(1, (2 * (ERUPTION.pool + body) * ahead) / ring);
  const ticks = Math.max(1, ((Math.PI / 2) * (ERUPTION.pool + body)) / speed / (HURT_TICKS * TICK));
  return {
    bombs: (missed * under) / ERUPTION.every,
    pools: (missed * crossed * ticks) / ERUPTION.every,
  };
}
/** Enemies one healer's ring covers in a fight (fieldAt). */
const HEAL_REACH = 4;
/** Species whose skill is a volley of spores: no wind-up, so they are dodged as shots, not telegraphs. */
const SPORE_SHOOTERS = (Object.keys(enemies) as EnemyId[]).filter(
  (id) => enemies[id].skill?.kind === "spore",
);
/** Share of output that lands on elites while any are alive (they walk in the crowd). */
const ELITE_SHARE = 0.3;
/** Focused output on the guardian is about half single-target, so the swarm loses half of it. */
const BOSS_TRASH_COST = 0.5;
/** Contact radius of the starting forms; evolved bodies are wider and get touched more. */
const BASE_BODY = starters.charmander.stages[0].form.radius;
/** A held share above this would mean the whole crowd is locked down, which never happens. */
const MAX_CONTROL = 0.8;
/** Paralysis' stutter holds an enemy back about ⅔ of the time (output.ts `controlSeconds`). */
const STUTTER_HOLD = 0.66;

const elementTypes = Object.keys(typeNames) as ElementType[];

/** The enemy side at one moment: pool means and multipliers, and the stage's guardian. */
export interface Field {
  pool: readonly EnemyId[];
  guardian: EnemyId;
  guardianSpeed: number;
  hp: number;
  radius: number;
  dmg: number;
  speed: number;
  xp: number;
  eliteXp: number;
  typeVs: Record<ElementType, number>;
  share: (id: EnemyId) => number;
  /** Species by pool share and the share of a pull each follows (plain enemies; sim/poise.ts). */
  give: { share: number; give: number }[];
  dmgScale: number;
  speedScale: number;
}

export function poolAt(zone: StageZone, time: number): EnemyId[] {
  return zone.roster.filter(([at]) => time >= at).map(([, id]) => id);
}

function typeTable(defend: (type: ElementType) => number): Record<ElementType, number> {
  return Object.fromEntries(elementTypes.map((type) => [type, defend(type)])) as Record<
    ElementType,
    number
  >;
}

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

/** The enemy side `time` seconds into `stage`'s zone `zone` (0-based), from that zone's roster. */
export function fieldAt(
  stage: StageId,
  time: number,
  difficulty: Difficulty,
  rampage: boolean,
  zone = 0,
): Field {
  const stageDef = stageDefs[stage];
  const z = zoneFactorsFor(stageDef, zone);
  const zoneDef = stageDef.zones[zone]!;
  const pool = poolAt(zoneDef, time);
  const clock = zoneClock(stageDef, zone, time);
  const base = enemyScaling(
    clock,
    difficulty,
    rampage ? zoneClock(stageDef, zone, stageDef.duration) : null,
  );
  const s = {
    hp:
      enemyHealthScaling(
        zoneHealthClock(stageDef, zone, time),
        difficulty,
        rampage ? zoneHealthClock(stageDef, zone, stageDef.duration) : null,
      ) * z.hp,
    dmg: base.dmg * z.dmg,
    speed: base.speed * z.speed,
  };
  const defs = pool.map((id) => enemies[id]);
  const effectiveHp = (def: (typeof defs)[number]) =>
    def.hp *
    (def.skill?.kind === "harden"
      ? 1 / (1 - (HARDEN.duration / def.skill.every) * (1 - HARDEN.damage))
      : 1);
  // Healers mend the crowd around them: assumed one pulse inside an enemy's life for those within
  // reach, about HEAL_REACH enemies per healer (a rough share, not fitted).
  const healers = defs.filter((def) => def.skill?.kind === "heal-pulse").length / defs.length;
  const mended = 1 + HEAL_PULSE.share * Math.min(1, healers * HEAL_REACH);
  const hp = mean(defs.map(effectiveHp)) * s.hp * mended;
  return {
    pool,
    guardian: zoneDef.guardian.species,
    guardianSpeed:
      enemies[zoneDef.guardian.species].speed *
      enemyScaling(GUARDIAN_REFERENCE_SECONDS, difficulty, null).speed *
      z.speed,
    hp,
    radius: mean(defs.map((def) => def.radius)),
    dmg: mean(defs.map((def) => def.dmg)) * s.dmg,
    speed: mean(defs.map((def) => def.speed)) * s.speed,
    xp: mean(defs.map((def) => def.xp)) * z.xp * difficulties[difficulty].xp,
    eliteXp: mean(
      defs.map(
        (def) =>
          LOOT.eliteXpCount *
          Math.ceil((def.xp * z.xp * difficulties[difficulty].xp * ELITE.xp) / LOOT.eliteXpCount),
      ),
    ),
    // HP-weighted harmonic mean: the multiplier that converts damage into HP removed from the pool.
    typeVs: typeTable((type) => {
      const total = defs.reduce((sum, def) => sum + effectiveHp(def), 0);
      const needed = defs.reduce(
        (sum, def) => sum + effectiveHp(def) / typeMultiplier(type, def.types),
        0,
      );
      return total / needed;
    }),
    share: (id) => pool.filter((other) => other === id).length / pool.length,
    give: [...new Set(pool)].map((id) => ({
      share: pool.filter((other) => other === id).length / pool.length,
      give: 1 - poiseOf(enemies[id], false, false),
    })),
    dmgScale: s.dmg,
    speedScale: s.speed,
  };
}

/** Share of time a walking partner is in reach of a target: the middle of the profiles' melee uptimes. */
const PARTNER_WALK = 0.7;
/**
 * Hits one guard's shield (护主) takes out of a catch: the touch that called it already started its
 * own i-frames, so the shield adds `shield − PLAYER_IFRAMES` at the i-frame ceiling.
 */
const SHIELDED_HITS = (GUARD.shield - PLAYER_IFRAMES) / PLAYER_IFRAMES;

/**
 * Share of catches that find the party ready: a catch uses every ready partner in turn (each shield's
 * end lets the next touch call the next one), then the party rests `GUARD.every × guardRest`; with
 * catches at `rate` per second a renewal cycle holds one guarded catch and 1 + rate × rest catches.
 */
function guardedShare(rate: number, rest: number): number {
  return 1 / (1 + rate * GUARD.every * rest);
}

/**
 * Damage per second of one partner of `species`, before the owner's damage stats and the time curve
 * (sim/partners.ts `partnerHit`). Shots need a line of fire; tackles and clouds also walk to each
 * new target, which a partner does on its own whatever the player's skill (`PARTNER_WALK`).
 */
export function partnerPower(species: EnemyId, target: Target): number {
  const def = enemies[species];
  const style = styleOf(def);
  const attack = PARTNER_ATTACK[style];
  const targets =
    style === "cloud" || style === "pulse"
      ? Math.max(1, Math.min(target.living, target.density * Math.PI * attack.reach ** 2))
      : 1;
  const uptime = style === "shot" ? TERRAIN_SIGHT : MELEE_STEP * PARTNER_WALK;
  return (def.dmg * ELITE.dmg * attack.dmg * targets * uptime) / attack.every;
}

/** The swarm as the player meets it: only the engaged share of the living enemies is in reach. */
export function targetFor(field: Field, living: number, skill: SkillProfile): Target {
  const engaged = living * skill.engage;
  return {
    density: (skill.clump * engaged) / (Math.PI * FIELD_RADIUS ** 2),
    living: engaged,
    hp: field.hp,
    radius: field.radius,
    typeVs: field.typeVs,
    boss: {
      radius: enemies[field.guardian].radius,
      speed: field.guardianSpeed,
      typeVs: typeTable((type) => typeMultiplier(type, enemies[field.guardian].types, true)),
    },
    melee: skill.melee,
    speed: field.speed,
    give: field.give,
  };
}

// --- Staggers and statuses -------------------------------------------------------------------

/**
 * 僵直 (sim/poise.ts): staggers per second on one engaged enemy that follows `give` of a push: the
 * build's swarm hits whose knock × give reaches the threshold, and King's Rock flinches, spread over
 * the crowd.
 */
export function staggerRate(out: MoveOutput, give: number, engaged: number): number {
  let hits = 0;
  for (const { knock, hits: rate } of out.knocks)
    if (knock * give >= STAGGER.threshold) hits += rate;
  for (const a of out.apply) if (a.status === "flinch") hits += a.swarm;
  return hits / Math.max(1, engaged);
}

/** One stagger holds `STAGGER.time`, then shields for `STAGGER.immune`. */
const STAGGER_CYCLE = STAGGER.time + STAGGER.immune;

/**
 * Share of wind-ups of `windup` seconds a stagger cancels at `rate` (per enemy): staggers come as a
 * renewal process, so the caster is open to one a share 1 / (1 + rate × cycle) of the time, and then
 * one arrives inside the wind-up with probability 1 − e^(−rate × windup).
 */
export function cancelShare(rate: number, windup: number): number {
  return (1 - Math.exp(-rate * windup)) / (1 + rate * STAGGER_CYCLE);
}

/** Share of the time an engaged enemy stands staggered, over the pool's species. */
function staggerShare(out: MoveOutput, target: Target): number {
  return target.give.reduce((sum, { share, give }) => {
    const rate = staggerRate(out, give, target.living);
    return sum + (share * rate * STAGGER.time) / (1 + rate * STAGGER_CYCLE);
  }, 0);
}

/**
 * One occupancy estimate for every status effect: per status, the share of time one engaged enemy
 * (or the guardian) carries it. Applications refresh (uptime 1 − e^(−rate × duration)); a sleeper
 * wakes at the next hit, so its duration is the expected min(duration, next hit). What a status does
 * to attacks follows the sim: sleep, freeze and staggers cancel a wind-up and stop the attack clock
 * (`interrupted`); paralysis only keeps an attack from starting while the clock keeps running
 * (skills/telegraph.ts, bosses/scyther.ts), so it delays the attack by what is left of it; spores
 * reload only while not paralysed or frozen (`attacksBlocked`, skills/spore.ts).
 */
export interface Occupancy {
  /** Share of an engaged enemy's movement held (stops, stutter, slows, staggers): fewer touches. */
  held: number;
  /** Share of time a swarm enemy's attack clock is stopped (sleep, freeze). */
  stopped: number;
  /** Seconds a ready attack waits on average for paralysis to end. */
  delay: number;
  /** Share of time a spore shooter cannot reload (paralysis, freeze). */
  paused: number;
  /** Binding Band's 「被控制」 share and the mean number of statuses on one enemy. */
  controlled: number;
  count: number;
  /** The same on the guardian, and its interruptions per second (it restarts its chase). */
  bossStopped: number;
  bossDelay: number;
  bossInterrupts: number;
  bossControlled: number;
  bossCount: number;
}

function uptime(rate: number, duration: number, wakeRate: number, wakes: boolean): number {
  if (rate <= 0) return 0;
  return 1 - Math.exp(-rate * lasting(duration, wakeRate, wakes));
}

/** How long one application lasts: its duration, or until the next hit wakes the sleeper. */
function lasting(duration: number, wakeRate: number, wakes: boolean): number {
  return wakes && wakeRate > 0 ? (1 - Math.exp(-wakeRate * duration)) / wakeRate : duration;
}

/**
 * Expected wait for a refreshing status (applications at `rate`, each lasting `d`) to end, from a
 * moment drawn at random: uptime × the mean rest of the busy period it is in (applications that land
 * while waiting extend it). A busy period is the gaps shorter than `d` until one is longer, plus `d`;
 * the rest of it at a random moment inside is E[B²] / 2E[B].
 */
function waitOut(rate: number, d: number): number {
  if (rate <= 0 || d <= 0) return 0;
  const p = Math.exp(-rate * d);
  const short = 1 - p;
  // Gaps shorter than d: mean and second moment of an exponential truncated at d.
  const mu = 1 / rate - (d * p) / short;
  const mu2 = (2 / rate ** 2 - p * (d * d + (2 * d) / rate + 2 / rate ** 2)) / short;
  const n = short / p;
  const gaps = n * mu;
  const gaps2 = n * mu2 + 2 * n * n * mu * mu;
  const busy = gaps + d;
  const busy2 = gaps2 + 2 * d * gaps + d * d;
  return short * (busy2 / (2 * busy));
}

export function occupancy(out: MoveOutput, stats: PlayerStats, target: Target): Occupancy {
  const engaged = Math.max(1, target.living);
  const hitRate = out.hits / engaged;
  const rates = new Map<EnemyStatusId, { swarm: number; boss: number }>();
  for (const a of out.apply) {
    if (a.status === "flinch") continue;
    const entry = rates.get(a.status) ?? { swarm: 0, boss: 0 };
    entry.swarm += a.swarm / engaged;
    entry.boss += a.boss;
    rates.set(a.status, entry);
    const builds = (statuses[a.status] as StatusDef).builds;
    if (builds) {
      // Every `count` charges inside one status' life turn into the built status (chill → freeze).
      const into = builds.into as EnemyStatusId;
      const up = rates.get(into) ?? { swarm: 0, boss: 0 };
      up.swarm += a.swarm / engaged / builds.count;
      up.boss += a.boss / builds.count;
      rates.set(into, up);
    }
  }
  const stagger = staggerShare(out, target);
  let free = 1 - stagger;
  let uncontrolled = 1 - stagger;
  let count = stagger;
  let running = 1;
  let reloading = 1;
  let delay = 0;
  let bossRunning = 1;
  let bossDelay = 0;
  let bossInterrupts = 0;
  let bossUncontrolled = 1;
  let bossCount = 0;
  for (const [id, rate] of rates) {
    const def: StatusDef = statuses[id];
    const duration = def.duration * stats.duration;
    const wakes = def.wakeBonus !== undefined;
    const u = uptime(rate.swarm, duration, hitRate, wakes);
    count += u;
    if (def.control) uncontrolled *= 1 - u;
    const move = def.move;
    const hold = !move
      ? 0
      : move.kind === "stop"
        ? 1
        : move.kind === "stutter"
          ? STUTTER_HOLD
          : 1 - move.factor;
    free *= 1 - u * hold;
    if (def.blocksAttacks) reloading *= 1 - u;
    const bossD = lasting(duration * (def.bossScale ?? 1), out.bossHits, wakes);
    const ub = 1 - Math.exp(-rate.boss * bossD);
    bossCount += ub;
    if (def.control) bossUncontrolled *= 1 - ub;
    if (def.interrupts) {
      running *= 1 - u;
      bossRunning *= 1 - ub;
      bossInterrupts += rate.boss * (1 - ub);
    } else if (def.blocksAttacks) {
      delay += waitOut(rate.swarm, lasting(duration, hitRate, wakes));
      bossDelay += waitOut(rate.boss, bossD);
    }
  }
  return {
    held: Math.min(MAX_CONTROL, 1 - free),
    stopped: Math.min(MAX_CONTROL, 1 - running),
    delay,
    paused: Math.min(MAX_CONTROL, 1 - reloading),
    controlled: 1 - uncontrolled,
    count: Math.min(PER_STATUS_CAP, count),
    bossStopped: 1 - bossRunning,
    bossDelay,
    bossInterrupts,
    bossControlled: 1 - bossUncontrolled,
    bossCount: Math.min(PER_STATUS_CAP, bossCount),
  };
}

// --- One build's output ----------------------------------------------------------------------

/** One build's totals against a target, plus each learned move's own output. */
export interface BuildOutput extends MoveOutput {
  stats: PlayerStats;
  /** The direct hits only (moves, Static's zap): what on-hit triggers and Bonk! read. */
  primary: MoveOutput;
  /** Landed hits per second by the type of the move that landed them (kit moves, swarm and guardian). */
  typeHits: Partial<Record<ElementType, number>>;
  /** Burn DPS a guardian keeps under this build's burn applications. */
  bossBurn: number;
  perMove: { move: MoveId; out: MoveOutput }[];
}

const SUMMED = [
  "useful",
  "direct",
  "raw",
  "dealt",
  "single",
  "hits",
  "liveHits",
  "liveDamage",
  "critHits",
  "bossHits",
  "bossDot",
  "survivors",
  "survivorHits",
  "survivorHit",
  "survivorRoom",
  "control",
  "bossBurnRate",
  "targets",
] as const;

function merge(into: MoveOutput, out: MoveOutput): void {
  for (const key of SUMMED) into[key] += out[key];
  into.bossBurnHit = Math.max(into.bossBurnHit, out.bossBurnHit);
  into.knocks.push(...out.knocks);
  for (const a of out.apply) {
    const entry = into.apply.find((b) => b.status === a.status);
    if (entry) {
      entry.swarm += a.swarm;
      entry.boss += a.boss;
    } else into.apply.push({ ...a });
  }
}

function scaleDamage(out: MoveOutput, swarm: number, single: number): void {
  for (const key of ["useful", "direct", "raw", "dealt", "liveDamage"] as const) out[key] *= swarm;
  out.single *= single;
}

/**
 * Razor Fang finishes a non-guardian under `below` of its HP inside the hit (sim/triggers/onHit.ts):
 * every swarm kill needs only the rest of its HP.
 */
function executeLine(stats: PlayerStats): number {
  let below = 0;
  for (const { def } of stats.triggers)
    if (def.kind === "execute") below = Math.max(below, def.below);
  return below;
}

export function buildOutput(player: Player, full: Target): BuildOutput {
  const stats = playerStats(player);
  const below = executeLine(stats);
  const target = below > 0 ? { ...full, hp: full.hp * (1 - below) } : full;
  const bonk = bonkFactor(stats);
  const perMove = player.moves.map((state) => ({
    move: state.id,
    out: moveOutput(state, stats, target, bonk),
  }));
  const primary = blankOutput();
  const secondary = blankOutput();
  for (const { out } of perMove) merge(primary, out);
  for (const { def } of stats.triggers) {
    const model = modelOf(def);
    const output = model.output?.(def, stats, target, player);
    if (output) merge(model.direct ? primary : secondary, output);
  }
  const typeHits: BuildOutput["typeHits"] = {};
  for (const { move, out } of perMove) {
    const { type } = moveDefs[move];
    typeHits[type] = (typeHits[type] ?? 0) + out.hits + out.bossHits;
  }
  const total: BuildOutput = { ...blankOutput(), stats, primary, typeHits, bossBurn: 0, perMove };
  merge(total, primary);
  merge(total, secondary);
  applyScales(total, target, player);
  // An executed kill removes its whole HP: the hits took `1 − below` of it, the fang the rest.
  if (below > 0) {
    total.useful /= 1 - below;
    total.dealt /= 1 - below;
  }
  // Burn refreshes rather than stacks and keeps the strongest hit's DPS.
  total.bossBurn =
    total.bossDot +
    statuses.burn.dotShare *
      stats.statusDamage *
      total.bossBurnHit *
      (1 - Math.exp(-total.bossBurnRate * statuses.burn.duration * stats.duration));
  return total;
}

/**
 * Trigger scales (marks, procs read off the totals): procs' own output first, then factors, then
 * the `held` / `perStatus` damage conditions (Binding Band, Full Heal) from the status occupancy.
 * These factors still apply after the per-target HP cap (Bonk! and Razor Fang do not: above).
 */
function applyScales(total: BuildOutput, target: Target, player: Player): void {
  const scales = total.stats.triggers.flatMap(({ def }) => {
    const scale = modelOf(def).scale?.(def, total, target, player);
    return scale ? [scale] : [];
  });
  for (const s of scales) if (s.add) merge(total, s.add);
  for (const s of scales) scaleDamage(total, s.swarm ?? 1, s.single ?? 1);
  const { held, perStatus } = total.stats.hit;
  if (held === undefined && perStatus === undefined) return;
  const occ = occupancy(total, total.stats, target);
  const factor = (controlled: number, count: number) =>
    (1 + ((held ?? 1) - 1) * controlled) * (1 + ((perStatus ?? 1) - 1) * count);
  const bossFactor = factor(occ.bossControlled, occ.bossCount);
  scaleDamage(total, factor(occ.controlled, occ.count), bossFactor);
  // Native burn and on-hit DoTs inherit the applying hit's conditional damage once.
  total.bossBurnHit *= bossFactor;
  total.bossDot *= bossFactor;
}

/** Share of dropped candy collected: skill at the base radius, the miss shrinking as Magnet grows it. */
export function pickupShare(stats: PlayerStats, skill: SkillProfile): number {
  return 1 - (1 - skill.pickup) * (BASE_PICKUP / stats.pickup);
}
const BASE_PICKUP = playerStats(createPlayer(0, "charmander", 0)).pickup;

/**
 * Share of a landed hit's raw damage that reaches the player: armor and the damage-taken stat.
 * Evasion and Guard Spec thin how often hits land instead (`defenceOf`); the shield soaks per fight.
 */
export function throughShare(stats: PlayerStats): number {
  return armorFactor(stats.armor) * stats.damageTaken;
}

// --- Defence: what the HP process needs from the build ---------------------------------------

export interface Defence {
  /** Share of hits that land: evasion; Guard Spec's return time (null without one). */
  evasion: number;
  block: number | null;
  shield: number;
  overhealShield: boolean;
  /** Lethal saves with limited uses (in spending order), and the per-stage ones among them. */
  charges: { hp: number; chance: number; iframes: number; perStage: boolean }[];
  /** A cooldown save (Focus Band): any death, at its chance (its 20 s cooldown is not modelled). */
  fallback: { hp: number; chance: number; iframes: number } | null;
  /** The sim tries saves in trigger order (`stats.ts`): the cooldown save before the charges. */
  fallbackFirst: boolean;
  /** Sitrus Berry: under `below` of max HP, `heal` of it, then `cooldown` seconds. */
  lifts: { below: number; heal: number; cooldown: number }[];
}

export function defenceOf(stats: PlayerStats): Defence {
  const defence: Defence = {
    evasion: stats.evasion,
    block: null,
    shield: stats.shield,
    overhealShield: false,
    charges: [],
    fallback: null,
    fallbackFirst: false,
    lifts: [],
  };
  for (const { def } of stats.triggers) {
    if (def.kind === "healBelow")
      defence.lifts.push({
        below: def.below,
        heal: def.heal * stats.healing,
        cooldown: def.cooldown,
      });
    if (def.kind === "block") defence.block = Math.min(defence.block ?? Infinity, def.every);
    if (def.kind === "overhealShield") defence.overhealShield = true;
    if (def.kind !== "lethalSave") continue;
    const save = { hp: def.hp, chance: def.chance, iframes: def.iframes };
    if (def.cooldown > 0) {
      defence.fallbackFirst ||= defence.charges.length === 0;
      defence.fallback ??= save;
    } else
      for (let i = 0; i < def.uses; i++)
        defence.charges.push({ ...save, perStage: def.per === "stage" });
  }
  return defence;
}

/** Share of encounters Guard Spec is back for: one per return time, at `rate` encounters a second. */
export function blockShare(every: number | null, rate: number): number {
  return every === null || rate <= 0 ? 0 : 1 / (1 + rate * every);
}

/** Mean rarity power × rolls of one upgrade card at `luck`: what luck buys is better cards later. */
function cardQuality(luck: number): number {
  return rarityOdds(luck).reduce(
    (sum, p, tier) => sum + p * rarityPower[tier]! * rollsPerUpgrade(rarityPower[tier]!),
    0,
  );
}
const PLAIN_CARDS = cardQuality(0);

/**
 * Hits a catch loses to the dash charges beyond the first: they are spent inside one catch, while the
 * steady escape rate stays one per `DASH_COOLDOWN` (charges refill one at a time).
 */
export function spareDashes(stats: PlayerStats, skill: SkillProfile): number {
  return skill.dash * Math.max(0, stats.dashCharges - 1);
}

/**
 * HP a build's defences are worth for the card utility (the run itself steps them through the HP
 * process): the shield at its readiness, saves at what they hand back, per-stage ones also for the
 * stages still to come at half weight.
 */
function defenceHp(stats: PlayerStats, stage: number): number {
  const d = defenceOf(stats);
  const back = (hp: number) => Math.max(0.1, hp) * stats.maxHp;
  let total = d.shield * (d.overhealShield ? 1 : 0.5);
  // Sitrus Berry: about one lift a fight of a minute.
  for (const lift of d.lifts) total += lift.heal * stats.maxHp * Math.min(1, 60 / lift.cooldown);
  for (const c of d.charges)
    total += c.chance * back(c.hp) * (c.perStage ? 1 + (2 - stage) / 2 : 1);
  if (d.fallback) total += d.fallback.chance * back(d.fallback.hp);
  return total;
}

/**
 * Myopic value of a build, used by the `greedy` card policy and item marginal values: log utility
 * over swarm clearing, guardian damage, effective HP, kiting speed, sustain and XP growth.
 */
export function buildValue(player: Player, target: Target, skill: SkillProfile): number {
  const out = buildOutput(player, target);
  const { stats } = out;
  const d = defenceOf(stats);
  // Landed-hit share: evasion, and Guard Spec at about one hit a second.
  const lands = (1 - d.evasion) * (1 - blockShare(d.block, 1 - d.evasion));
  const occ = occupancy(out, stats, target);
  // The reference fight is the swarm: heals off it, with HP spread evenly and full a fifth of the time.
  const regen = healPerSecond(
    out,
    { swarm: 1, boss: 0, eliteRemoved: 0, partners: 0 },
    out.useful / Math.max(1, target.hp),
    { below: (share) => Math.min(1, share), full: 0.2 },
  );
  return (
    Math.log(out.useful + 0.1) +
    0.5 * Math.log(out.single + 0.1) +
    Math.log((stats.maxHp + defenceHp(stats, player.stage)) / throughShare(stats) / lands) +
    Math.log(stats.speed) +
    Math.log(1 + regen / 5) +
    0.5 * Math.log(stats.xp * pickupShare(stats, skill)) +
    // About half the build is still to come at the reference point; luck lifts those cards.
    0.5 * Math.log(cardQuality(stats.luck) / PLAIN_CARDS) +
    // A spare dash takes one hit out of a catch of `burst`, like that much more HP.
    Math.log(skill.burst / Math.max(1, skill.burst - spareDashes(stats, skill))) +
    // Held enemies touch less: contact goes with √(crowd × (1 − held)) (swarmIncoming).
    0.5 * Math.log(1 / (1 - occ.held))
  );
}

/**
 * The card a policy takes: a preferred kind first (by value at the policy's greedy rate, else the
 * first one offered, as the bot does), otherwise the best card by value at the greedy rate, else a
 * random one.
 */
function chooseCard(
  player: Player,
  options: readonly Choice[],
  policy: PickPolicy,
  rng: Rng,
  target: Target,
  skill: SkillProfile,
  partners: readonly Partner[],
): Choice {
  const valued = (pool: readonly Choice[]) => {
    let best = pool[0]!;
    let bestValue = -Infinity;
    for (const option of pool) {
      const trial = previewChoice(player, option, rng, target, skill, policy, partners);
      const value = buildValue(trial, target, skill);
      if (value > bestValue) {
        bestValue = value;
        best = option;
      }
    }
    return best;
  };
  const preferred = options.filter((option) => option.kind === policy.prefer);
  if (preferred.length > 0) return next(rng) < policy.greedy ? valued(preferred) : preferred[0]!;
  if (next(rng) < policy.greedy) return valued(options);
  return options[Math.floor(next(rng) * options.length)]!;
}

/** XP and immediate item levels use the same growth path, before the next offer is rolled. */
function gainXp(player: Player, amount: number, onLevel?: () => void): void {
  player.xp += amount;
  while (player.xp >= player.xpNext) {
    player.xp -= player.xpNext;
    player.level += 1;
    player.xpNext = xpForLevel(player.level);
    evolve(player);
    onLevel?.();
  }
}

function applyPick(player: Player, choice: Choice): number {
  applyChoice(player, choice);
  const levels = choice.kind === "item" ? (itemDefs[choice.item].onPick?.levels ?? 0) : 0;
  for (let i = 0; i < levels; i++) gainXp(player, player.xpNext - player.xp);
  return levels;
}

/**
 * Value the whole pick, including the cards immediate levels grant. Each candidate owns its RNG
 * copy; finite item caps bound chains of level-granting picks without truncating their rewards.
 */
export function previewChoice(
  player: Player,
  choice: Choice,
  rng: Rng,
  target: Target,
  skill: SkillProfile,
  policy: PickPolicy = skill.picks,
  partners: readonly Partner[] = [],
): Player {
  const trial = structuredClone(player);
  const draws = { ...rng };
  let pending = applyPick(trial, choice);
  fuseMoves(trial);
  while (pending > 0) {
    pending -= 1;
    const options = rollChoices(draws, trial, "level", partners);
    pending += applyPick(trial, chooseCard(trial, options, policy, draws, target, skill, partners));
    fuseMoves(trial);
  }
  return trial;
}

// --- Results ---------------------------------------------------------------------------------

export interface Minute {
  t: number;
  level: number;
  moves: number;
  items: number;
  /** Swarm HP removed per second at the current crowd (the stock the run actually carries). */
  useful: number;
  /** Player-only swarm clearing with the crowd at the live cap (no partners, ultimates or splits). */
  capacity: number;
  /** Swarm HP entering per second (spawn rate × spawn items × mean HP), before the cap stops spawns. */
  incoming: number;
  /** capacity / incoming: below 1 even a full crowd cannot be cleared as fast as it spawns. */
  pressure: number;
  /** Adaptive ordinary-spawn multiplier; distinct from the capacity/incoming ratio above. */
  spawnScale: number;
  /** Living enemies (in the fight or walking in) and their share of the live cap. */
  fill: number;
  living: number;
  /** Kills so far (swarm and elites). */
  kills: number;
  /** Guardian DPS with focus and burn. */
  single: number;
  /** Incoming damage per second (after shields, saves aside) and the HP it eats into. */
  inDps: number;
  ehp: number;
  /** Mean HP share of the living, and the probability of still being alive. */
  hp: number;
  alive: number;
  /** Partners (captured alphas and elites) and their damage per second. */
  partners: number;
  partnerDps: number;
  /** Share of the swarm's telegraphed wind-ups a stagger cancels. */
  cancelled: number;
}

/**
 * Guardian exposure observed until a kill or sample termination. Only completed samples contribute
 * to full-fight seconds/cost; incomplete samples must not masquerade as easier, shorter fights.
 */
export interface GuardianFight {
  seconds: number | null;
  cost: number | null;
  completed: number;
  attempted: number;
}

export interface BeatSpike {
  /** Zone (0-based) and the second into it the beat fired. */
  zone: number;
  t: number;
  beat: BeatKind;
  /** Seconds the current build needs to clear the spike's HP on top of the regular flow. */
  clear: number;
}

/** Card exposure of one item or move over the samples (docs/BALANCE.md「选卡暴露」). */
export interface Exposure {
  /** Share of offers it could have been in (a free slot or owned below its cap), shown in, taken. */
  eligible: number;
  offered: number;
  /** Share of samples that own it at the end, and their mean acquisition second. */
  acquired: number;
  at: number;
}

export interface RunModel {
  stage: StageId;
  starter: StarterId;
  difficulty: Difficulty;
  skill: string;
  /** Local summon seconds in route order; independent of the guardian's fixed stats. */
  summonSeconds: readonly number[];
  minutes: Minute[];
  outcome: Outcome;
  /** Guardian HP / guardian DPS with the build at its arrival; the window before rampage. */
  bossTtk: number | null;
  bossWindow: number;
  /** Guardian HP left at the end (share), when it spawned. */
  bossLeft: number | null;
  beats: BeatSpike[];
  /** Mean second each kit move was learned (over samples that learned it) and the share that did. */
  learned: { move: MoveId; t: number; share: number }[];
  /** Mean seconds between ultimate casts (null: fewer than two casts). */
  ultEvery: number | null;
  /** Share of samples that fused at Bill's machine and their mean fusion second. */
  fused: { share: number; t: number };
  /** Kit damage share (raw, swarm + guardian) at the end of the run, for comparison with the bot. */
  damageShare: { move: MoveId; share: number }[];
  /** Mean second the samples reached each level (`levelAt[level]`, over samples that did). */
  levelAt: number[];
  /** Per zone: chance of killing its guardian, and when (clear-weighted; null: none does). */
  zoneClears: {
    stage: StageId;
    zone: number;
    reach: number;
    clear: number;
    t: number | null;
    level: number | null;
  }[];
  /** Per zone: the guardian fight, over the samples that summoned it (null: none did). */
  fights: (GuardianFight | null)[];
  /** Swarm and elite kills on the path while alive (conditional), and the guardian kill chance. */
  kills: { swarm: number; elites: number; guardian: number };
  /** 星星沙子 banked per run (kept on a death too: what was picked up until then, alive-weighted). */
  stardust: number;
  /** Exposure of every item and kit move, from the offers the samples saw. */
  exposure: Map<string, Exposure>;
}

export interface Outcome {
  /** Probability of being alive when the guardian arrives, and of killing it. */
  reachBoss: number;
  clear: number;
  /** When the samples kill the guardian, weighted by their clear chance (null: none does). */
  clearAt: number | null;
  /** First second the survival probability drops below one half. */
  medianDeath: number | null;
  /** Expected run length (death or clear), comparable to the bot's mean survival. */
  meanSurvival: number;
}

export interface RunOptions {
  stage: StageId;
  starter: StarterId;
  difficulty: Difficulty;
  skill: SkillProfile;
  /** Overrides the profile's card policy (build scenarios). */
  picks?: PickPolicy;
  samples?: number;
  /** Lab bonuses the run starts with (none by default). */
  lab?: LabBonuses;
  /** Zones the run crosses (1 to the stage's zone count); each guardian kill but the last opens the next. */
  zones?: number;
  /** All six maps, preserving every sample's build between their fields. */
  campaign?: boolean;
  /** One integer second per field, from 1 through its forced-summon time. Default: reference time. */
  summonSeconds?: readonly number[];
}

/** What one build sample brings this second, at HP share `frac` (low HP turns on Blaze / Torrent). */
interface Means {
  out: BuildOutput;
  occ: Occupancy;
  maxHp: number;
  /** `throughShare`: share of a landed hit's raw damage that gets through. */
  armor: number;
  defence: Defence;
  speed: number;
  xp: number;
  pickup: number;
  thorns: number;
  /** Spawn and elite multipliers (White Flute, Super Lure); partner damage and rate (Lemonade). */
  spawns: number;
  elites: number;
  partnerDamage: number;
  partnerRate: number;
  guardRest: number;
  /** Master Ball and Poké Radar. */
  sureCapture: boolean;
  berries: number;
  /** Hits a catch loses to spare dash charges (`spareDashes`). */
  spareDashes: number;
  /** Contact radius of the current form. */
  radius: number;
}

function measure(player: Player, target: Target, skill: SkillProfile, frac: number): Means {
  player.hp = frac * playerStats(player).maxHp;
  const out = buildOutput(player, target);
  const { stats } = out;
  return {
    out,
    occ: occupancy(out, stats, target),
    maxHp: stats.maxHp,
    armor: throughShare(stats),
    defence: defenceOf(stats),
    speed: stats.speed,
    xp: stats.xp,
    pickup: pickupShare(stats, skill),
    thorns: stats.thorns * stats.damage,
    spawns: stats.spawns,
    elites: stats.elites,
    partnerDamage: stats.partnerDamage,
    partnerRate: stats.partnerRate,
    guardRest: stats.guardRest,
    sureCapture: itemRule(player, "capture") > 0,
    berries: 1 + itemRule(player, "berries"),
    spareDashes: spareDashes(stats, skill),
    radius: formOf(player).radius,
  };
}

// --- Guardian and swarm pressure -------------------------------------------------------------

/**
 * Scyther's attack rhythm: seconds per chase → wind-up → dash → recover cycle. The chase restarts
 * with a random head start of up to `BOSS_CHASE_JITTER` on its minimum (scyther.ts `resumeChase`).
 */
export function bossCycle(difficulty: Difficulty): number {
  return scytherCycle(difficulties[difficulty].bossTelegraph);
}

const scytherCycle = (tele: number) =>
  CHASE_MEAN + (BOSS_WINDUP + BOSS_RECOVER) * tele + BOSS_DASH_TIME;

/** Guardian hits landed per cycle on a player who dodges nothing: the dash and one chase contact. */
const BOSS_HITS_PER_CYCLE = { dash: 1, contact: 1 } as const;

/** One stream of hits on the player: hits per second and damage per hit after armor. */
export interface Hits {
  rate: number;
  dmg: number;
  /** Swarm contact arrives as catches (cornered for several hits); other streams are plain Poisson. */
  clumped?: boolean;
  /** Seconds of poison and of slow each landed hit leaves (late-zone guardians). */
  poison?: number;
  slow?: number;
}

/** Hits one cast of each raised-guardian pattern lands on a player who dodges nothing. */
const FURY_HITS = { rain: 1, barrage: 1, pincer: 1 } as const satisfies Record<FuryCast, number>;

/** One guardian attack cycle (`guardianCycle`). */
interface GuardianCycle {
  cycle: number;
  hits: { perCycle: number; share: number; poison?: number; slow?: number }[];
  /** Seconds a cycle it cannot be hit (under ground, mid-teleport). */
  hidden?: number;
  /** Seconds a cycle behind a shield that lets `factor` of the damage through. */
  shield?: { seconds: number; factor: number };
}

/** The brain of the guardian of this species (the zone it guards, stages/index.ts). */
function brainOf(guardian: EnemyId): GuardianBrainId {
  if (!Object.hasOwn(guardianBrains, guardian))
    throw new Error(`balance model: ${guardian} has no guardian brain`);
  return guardian as GuardianBrainId;
}

/** Each brain owns its phase threshold; the current defaults happen to be the same. */
function guardianLowHealth(guardian: EnemyId): number {
  switch (brainOf(guardian)) {
    case "scyther":
      return BOSS_SLASH_BELOW;
    case "pinsir":
      return PINSIR.below;
    case "nidoking":
      return NIDOKING.below;
    case "sandslash":
      return SANDSLASH.below;
    case "marowak":
      return MAROWAK.below;
    case "aerodactyl":
      return AERODACTYL.below;
    case "kingler":
      return KINGLER.below;
    case "gyarados":
      return GYARADOS.below;
    case "starmie":
      return STARMIE.below;
    default:
      return ZONE_GUARDIAN.below;
  }
}

/** Seconds of chase before a guardian's attack, after its random head start (scyther.ts `resumeChase`). */
const CHASE_MEAN = BOSS_CHASE_MIN - BOSS_CHASE_JITTER / 2;

/**
 * One guardian attack cycle: its seconds (`tele` the tier's `bossTelegraph`) and the hits it lands
 * per cycle on a player who dodges nothing, by stream. `cover` is the share of a radial volley of
 * `count` shots `radius` wide that reaches the kiting player.
 */
function guardianCycle(
  brain: GuardianBrainId,
  tele: number,
  belowHalf: boolean,
  cover: (count: number, radius: number) => number,
  blades: number,
  chaseRate: number,
): GuardianCycle {
  const CHASE = CHASE_MEAN / chaseRate;
  switch (brain) {
    case "haunter-guardian":
    case "muk":
    case "mr-mime":
    case "golbat":
    case "alakazam":
    case "marowak-ghost":
    case "gengar":
    case "dewgong":
    case "cloyster":
    case "lapras":
    case "magmar":
    case "arcanine":
    case "dragonite":
      return zoneGuardianCycle(brain, tele, belowHalf, cover, chaseRate);
    case "scyther":
      return {
        cycle: scytherCycle(tele),
        hits: [
          { perCycle: BOSS_HITS_PER_CYCLE.dash, share: 1 },
          { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 },
          { perCycle: belowHalf ? cover(blades, AIR_SLASH.radius) : 0, share: AIR_SLASH_DMG },
        ],
      };
    case "pinsir": {
      const slams = belowHalf ? PINSIR.chain : 1;
      const cycle = belowHalf
        ? CHASE +
          (PINSIR.windup + (PINSIR.chain - 1) * PINSIR.chainWindup + PINSIR.chainRecover) * tele +
          PINSIR.chain * PINSIR.travel
        : CHASE + (PINSIR.windup + PINSIR.recover) * tele + PINSIR.travel;
      return {
        cycle,
        hits: [
          { perCycle: slams, share: PINSIR.damage },
          { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 },
          {
            perCycle: belowHalf ? slams * cover(SHARD.count, SHARD.radius) : 0,
            share: SHARD.damage,
          },
        ],
      };
    }
    case "nidoking": {
      // Attacks alternate fissure / Toxic Spikes; spikes are thrown without stopping the chase.
      const fissure =
        CHASE +
        (NIDOKING.windup + NIDOKING.recover + (belowHalf ? NIDOKING.stompWindup : 0)) * tele +
        FISSURE.active;
      return {
        cycle: (fissure + CHASE) / 2,
        hits: [
          { perCycle: 0.5, share: FISSURE.damage },
          { perCycle: 0.5, share: ACID.splash },
          { perCycle: belowHalf ? 0.5 : 0, share: STOMP.damage },
          { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 },
        ],
      };
    }
    case "sandslash": {
      // Digs and rolls alternate; below half each break-out throws rock shards (the pit's pull is
      // movement, not modelled).
      const dig = CHASE + (SANDSLASH.digWindup + SANDSLASH.digRecover) * tele;
      const roll =
        CHASE + (SANDSLASH.rollWindup + SANDSLASH.rollRecover) * tele + SANDSLASH.rollTime;
      return {
        cycle: (dig + roll) / 2,
        hits: [
          { perCycle: 0.5, share: SANDSLASH.damage },
          { perCycle: 0.5, share: 1 },
          {
            perCycle: belowHalf ? 0.5 * cover(SANDSLASH.spikes, SHARD.radius) : 0,
            share: SHARD.damage,
          },
          { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 },
        ],
      };
    }
    case "marowak": {
      // A kiting player stays outside the club's reach: every attack is a throw, out and back.
      const flight = (2 * MAROWAK.length) / BONEMERANG.speed;
      return {
        cycle: CHASE + MAROWAK.windup * tele + flight,
        hits: [
          { perCycle: 1, share: MAROWAK.damage },
          { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 },
        ],
      };
    }
    case "aerodactyl": {
      if (belowHalf)
        return {
          cycle:
            CHASE +
            (AERODACTYL.windup + AERODACTYL.chainWindup + AERODACTYL.recover) * tele +
            2 * AERODACTYL.time,
          hits: [
            { perCycle: 2, share: 1 },
            { perCycle: 1, share: AERODACTYL.rockDamage },
            { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 },
          ],
        };
      // Dives and Rock Slides alternate; a slide does not stop its chase.
      const dive = CHASE + (AERODACTYL.windup + AERODACTYL.recover) * tele + AERODACTYL.time;
      return {
        cycle: (dive + CHASE) / 2,
        hits: [
          { perCycle: 0.5, share: 1 },
          { perCycle: 0.5, share: AERODACTYL.rockDamage },
          { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 },
        ],
      };
    }
    case "kingler": {
      // A kiting player sits in Bubble Beam's band: every attack is the fan, a few bubbles land.
      if (belowHalf)
        return {
          cycle:
            CHASE +
            (KINGLER.sideDashes * KINGLER.sideWindup +
              KINGLER.hammerWindup +
              KINGLER.hammerRecover) *
              tele +
            KINGLER.sideDashes * KINGLER.sideTime,
          hits: [
            { perCycle: KINGLER.sideDashes, share: 1 },
            { perCycle: 1, share: KINGLER.hammerDamage },
            { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 },
          ],
        };
      return {
        cycle: CHASE + KINGLER.bubbleWindup * tele,
        hits: [
          {
            perCycle: cover(KINGLER.bubbles, BUBBLE.radius * KINGLER.bubbleRadius),
            share: KINGLER.bubbleDamage,
          },
          { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 },
        ],
      };
    }
    case "gyarados": {
      // Up to two hits from a held beam (the player's i-frames space them).
      const beamHits = Math.ceil(HYDRO_PUMP.active / PLAYER_IFRAMES);
      if (belowHalf)
        return {
          cycle:
            CHASE +
            (GYARADOS.windup +
              (GYARADOS.chain - 1) * GYARADOS.chainWindup +
              GYARADOS.chainRecover) *
              tele +
            GYARADOS.chain * HYDRO_PUMP.active,
          hits: [
            { perCycle: GYARADOS.chain * beamHits, share: HYDRO_PUMP.damage },
            { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 },
          ],
        };
      // Pumps and twisters alternate; the twisters are summoned on the run.
      const pump = CHASE + (GYARADOS.windup + GYARADOS.recover) * tele + HYDRO_PUMP.active;
      return {
        cycle: (pump + CHASE) / 2,
        hits: [
          { perCycle: 0.5 * beamHits, share: HYDRO_PUMP.damage },
          { perCycle: 0.5, share: TWISTER.damage },
          { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 },
        ],
      };
    }
    case "starmie": {
      // Spins and bolt volleys alternate; the volley falls while it keeps chasing.
      const lanes = belowHalf ? STARMIE.lowSegments : STARMIE.segments;
      const bolts = belowHalf ? STARMIE.lowBolts : STARMIE.bolts;
      const spin =
        CHASE +
        (STARMIE.spinWindup + STARMIE.spinRecover) * tele +
        (lanes * STARMIE.segment) / STARMIE.spinSpeed;
      const volley = CHASE + bolts * STARMIE.boltGap;
      return {
        cycle: (spin + volley) / 2,
        hits: [
          { perCycle: 0.5, share: 1 },
          { perCycle: 0.5, share: STARMIE.boltDamage },
          { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 },
        ],
      };
    }
  }
}

type ZoneBrain = Extract<
  GuardianBrainId,
  | "haunter-guardian"
  | "muk"
  | "mr-mime"
  | "golbat"
  | "alakazam"
  | "marowak-ghost"
  | "gengar"
  | "dewgong"
  | "cloyster"
  | "lapras"
  | "magmar"
  | "arcanine"
  | "dragonite"
>;

/**
 * The late-zone guardians (bosses/zone-guardians.ts): each chases exactly `BOSS_CHASE_MIN` (no head
 * start jitter), then winds up × the tier's tell, acts and recovers; instant casts (falls, curses,
 * ghost fires, foresight) go straight back to the chase. A kiting player is hit at most once by a
 * volley aimed at them (i-frames), by a held beam once per i-frame window, and is outside melee rings
 * (Marowak's club, Lapras' mist). Pools left behind cost one tick of burning ground or `ACID.poison`
 * seconds of poison for the player who took the hit that left them.
 */
function zoneGuardianCycle(
  brain: ZoneBrain,
  tele: number,
  belowHalf: boolean,
  cover: (count: number, radius: number) => number,
  chaseRate: number,
): GuardianCycle {
  const Z = ZONE_GUARDIAN;
  const C = BOSS_CHASE_MIN / chaseRate;
  const duration = (a: readonly [number, number, number]) => (a[0] + a[2]) * tele + a[1];
  const contact = { perCycle: BOSS_HITS_PER_CYCLE.contact, share: 1 };
  const beamHits = (active: number) => Math.ceil(active / PLAYER_IFRAMES);
  const burst = (count: number, share: number) =>
    belowHalf ? share * cover(count, Z.shotRadius) : 0;
  // `shadow` (zone-guardians.ts): its first wind-up is capped at one second, chained ones are `chain`.
  const sinks = (count: number) =>
    Math.min(ZA.shadow[0], ZA.shadow[0] * tele) + (count - 1) * Z.chain * tele;
  switch (brain) {
    case "haunter-guardian": {
      // Shadow sneak and Night Shade alternate; Night Shade holds still during its locked warning.
      const sneaks = belowHalf ? Z.shadowSneaks : 1;
      const sneak = C + sinks(sneaks) + ZA.shadow[2] * tele;
      const shade = C + duration(ZA["night-shade"]);
      return {
        cycle: mean([sneak, shade]),
        hits: [
          { perCycle: 0.5 * sneaks, share: Z.landing },
          { perCycle: 0.5 * burst(Z.burstCount, 1), share: Z.burst },
          { perCycle: 0.5, share: Z.shot },
          contact,
        ],
        hidden: 0.5 * sinks(sneaks),
      };
    }
    case "muk": {
      // Sludge slam (a leap onto a locked circle, pool behind) and Sludge Bomb falls alternate; the
      // trail it lays while chasing poisons a player it catches.
      const slam = C + duration(ZA["sludge-slam"]);
      return {
        cycle: mean([slam, C]),
        hits: [
          { perCycle: 0.5, share: Z.landing, poison: ACID.poison },
          { perCycle: 0.5 * burst(Z.burstCount, 1), share: Z.burst, poison: Z.burstPoison },
          { perCycle: 0.5, share: Z.fall, poison: ACID.poison },
          { ...contact, poison: ACID.poison },
        ],
      };
    }
    case "mr-mime": {
      // Light-wall cage (two below half) and Light Screen with one psybeam alternate.
      const cage = C + duration(ZA.cage);
      const screen = C + duration(ZA["light-shield"]);
      return {
        cycle: mean([cage, screen]),
        hits: [
          {
            perCycle: 0.5 * (belowHalf ? ZONE_ATTACK.cage.lowCount : ZONE_ATTACK.cage.count),
            share: Z.cone,
          },
          { perCycle: 0.5, share: Z.beam },
          contact,
        ],
        shield: { seconds: 0.5 * Z.shieldTime, factor: Z.mimeShield },
      };
    }
    case "golbat": {
      // Leech dives (two below half, then four Air Slashes) and the Supersonic cone alternate.
      const dives = belowHalf ? Z.repeatDashes : 1;
      const dive =
        C + (ZA.dive[0] + ZA.dive[2] + (dives - 1) * Z.chain) * tele + dives * ZA.dive[1];
      const sonic = C + duration(ZA.sonic);
      return {
        cycle: mean([dive, sonic]),
        hits: [
          { perCycle: 0.5 * dives, share: 1 },
          { perCycle: 0.5 * burst(Z.sonicBurst, 1), share: Z.burst },
          { perCycle: 0.5, share: Z.cone, slow: Z.slow },
          contact,
        ],
      };
    }
    case "alakazam": {
      // Teleport (below half straight into the psychic fan), psychic fan, Future Sight in turn. Future
      // Sight marks where the player stands; a kiter is hit by one mark at most, whatever the count.
      const fan = C + duration(belowHalf ? ZA["psychic-fan-low"] : ZA["psychic-fan"]);
      const blink = C + ZA.blink[0] + (belowHalf ? fan - C : 0);
      return {
        cycle: mean([blink, fan, C]),
        hits: [
          { perCycle: (belowHalf ? 2 : 1) / 3, share: Z.beam },
          { perCycle: 1 / 3, share: Z.fall },
          contact,
        ],
        hidden: ZA.blink[0] / 3,
      };
    }
    case "marowak-ghost": {
      // Two Shadow Bone throws (out and back through walls) to one set of ghost fires.
      const bones = C + duration(ZA["shadow-bones"]) + (2 * Z.bone) / BONEMERANG.speed;
      return {
        cycle: mean([bones, bones, C]),
        hits: [
          { perCycle: 2 / 3, share: 1 },
          { perCycle: Z.fires / GYARADOS.twisters / 3, share: 1 },
          contact,
        ],
      };
    }
    case "gengar": {
      // Shadow Ball, shadow sneak (three below half, then a burst), Curse in turn.
      const sneaks = belowHalf ? Z.gengarSneaks : 1;
      const ball = C + duration(ZA["shadow-ball"]);
      const sneak =
        C + sinks(sneaks) + (belowHalf ? ZA["gengar-shadow-low"][2] : ZA.shadow[2]) * tele;
      return {
        cycle: mean([ball, sneak, C]),
        hits: [
          { perCycle: 1 / 3, share: Z.shot, poison: ACID.poison },
          { perCycle: sneaks / 3, share: Z.landing },
          { perCycle: burst(Z.burstCount, 1) / 3, share: Z.burst },
          {
            perCycle: (belowHalf ? ZONE_ATTACK.curse.lowCount : ZONE_ATTACK.curse.count) / 3,
            share: Z.cone,
          },
          contact,
        ],
        hidden: sinks(sneaks) / 3,
      };
    }
    case "dewgong": {
      // Belly slides (two below half, then icicle falls) and Ice Beam alternate.
      const slides = belowHalf ? Z.repeatDashes : 1;
      const slide =
        C +
        (ZA.slide[0] + (slides - 1) * Z.chain + (belowHalf ? ZA["slide-low"][2] : ZA.slide[2])) *
          tele +
        slides * ZA.slide[1];
      const beam = C + duration(ZA["dewgong-beam"]);
      return {
        cycle: mean([slide, beam]),
        hits: [
          { perCycle: 0.5 * slides, share: 1 },
          { perCycle: belowHalf ? 0.5 : 0, share: Z.fall },
          { perCycle: 0.5 * beamHits(ZA["dewgong-beam"][1]), share: Z.beam, slow: Z.slow },
          contact,
        ],
      };
    }
    case "cloyster": {
      // Shell (orbiting icicles; below half icicle falls) and the icicle fan alternate.
      const shell = C + duration(ZA.shell);
      const fan = C + ZA["icicle-fan"][0] * tele + ZA["icicle-fan"][2];
      return {
        cycle: mean([shell, fan]),
        hits: [
          { perCycle: 0.5, share: Z.orbit, slow: Z.slow },
          { perCycle: belowHalf ? 0.5 : 0, share: Z.fall },
          { perCycle: 0.5, share: Z.shot, slow: Z.slow },
          contact,
        ],
        shield: { seconds: 0.5 * Z.shieldTime, factor: Z.shellShield },
      };
    }
    case "lapras": {
      // Ice Beam lanes and hail alternate; below half Sing joins every third attack.
      const beam = C + duration(ZA["lapras-beam"]);
      const song = C + duration(ZA.song);
      const turns = belowHalf ? 3 : 2;
      return {
        cycle: mean(belowHalf ? [beam, C, song] : [beam, C]),
        hits: [
          { perCycle: beamHits(ZA["lapras-beam"][1]) / turns, share: Z.beam, slow: Z.slow },
          { perCycle: 1 / turns, share: Z.fall },
          { perCycle: belowHalf ? 1 / turns : 0, share: Z.cone, slow: Z.song },
          contact,
        ],
      };
    }
    case "magmar": {
      // Lava dive (burning pool behind, below half a fire burst) and the flamethrower fan alternate.
      const dive = C + sinks(1) + ZA.shadow[2] * tele;
      const fan = C + duration(ZA["flame-fan"]);
      return {
        cycle: mean([dive, fan]),
        hits: [
          { perCycle: 0.5, share: Z.landing },
          { perCycle: 0.5, share: Z.pool },
          { perCycle: 0.5 * burst(Z.magmarBurst, 1), share: Z.burst },
          { perCycle: 0.5 * beamHits(ZA["flame-fan"][1]), share: Z.beam },
          contact,
        ],
        hidden: 0.5 * sinks(1),
      };
    }
    case "arcanine": {
      // Extreme Speed (three re-aimed dashes; below half a burning trail and Fire Blast) and the
      // fire ring with one opening alternate.
      const dashes =
        C +
        (ZA["extreme-speed"][0] + (Z.extremeDashes - 1) * Z.extremeGap) * tele +
        Z.extremeDashes * ZA["extreme-speed"][1];
      const rush = belowHalf
        ? dashes + duration(ZA["fire-blast"])
        : dashes + ZA["extreme-speed"][2] * tele;
      return {
        cycle: mean([rush, C]),
        hits: [
          { perCycle: 0.5 * Z.extremeDashes, share: 1 },
          { perCycle: belowHalf ? 0.5 : 0, share: Z.pool },
          { perCycle: belowHalf ? 0.5 : 0, share: Z.cone },
          { perCycle: 0.5, share: Z.fall },
          { perCycle: 0.5, share: Z.pool },
          contact,
        ],
      };
    }
    case "dragonite": {
      // Hyper Beam and Draco Meteor alternate; below half the sweeping beam joins every third.
      const beam = C + duration(ZA["hyper-beam"]);
      const sweep = C + duration(ZA["hyper-sweep"]);
      const turns = belowHalf ? 3 : 2;
      return {
        cycle: mean(belowHalf ? [beam, C, sweep] : [beam, C]),
        hits: [
          { perCycle: beamHits(ZA["hyper-beam"][1]) / turns, share: Z.beam },
          { perCycle: 1 / turns, share: Z.fall },
          { perCycle: 1 / turns, share: Z.pool },
          { perCycle: belowHalf ? 1 / turns : 0, share: Z.sweep },
          contact,
        ],
      };
    }
    default:
      return brain satisfies never;
  }
}

/**
 * Share of the build's guardian damage that lands: none while it is hidden (`Enemy.phase` "under"),
 * the shield's factor behind a shield, per attack cycle.
 */
function guardianExposure(
  guardian: EnemyId,
  difficulty: Difficulty,
  belowHalf: boolean,
  fury: GuardianFury | null,
): number {
  const { cycle, hidden, shield } = guardianCycle(
    brainOf(guardian),
    difficulties[difficulty].bossTelegraph,
    belowHalf,
    () => 0,
    difficulties[difficulty].airSlashBlades,
    fury?.chaseRate ?? 1,
  );
  if (hidden === undefined && shield === undefined) return 1;
  const lost = (hidden ?? 0) + (shield ? shield.seconds * (1 - shield.factor) : 0);
  return (cycle - lost) / cycle;
}

/**
 * Guardian hit streams by its brain (bosses/): Scyther's dash and Air Slash, Pinsir's slams and rock
 * shards, Nidoking's fissures, Toxic Spikes and stomp, each with a chase contact a cycle. Sleep and
 * freeze stop it (`stopped` of the time) and interrupt it: it restarts its rhythm from a fresh chase
 * (`interrupts` per second). Paralysis lets the chase clock run but keeps a ready attack from
 * starting until it ends (`delay` seconds a cycle).
 */
export function bossHits(
  guardian: EnemyId,
  difficulty: Difficulty,
  dmgScale: number,
  armor: number,
  dodge: number,
  belowHalf: boolean,
  hazardRadius: number,
  status: { stopped: number; delay: number; interrupts: number } = {
    stopped: 0,
    delay: 0,
    interrupts: 0,
  },
  fury: GuardianFury | null = null,
  fightSeconds = Infinity,
): Hits[] {
  const dmg = enemies[guardian].dmg * dmgScale * difficulties[difficulty].guardianDmg * armor;
  // Volleys spread evenly; at the kiting distance this share of them is wide enough to hit.
  const cover = (count: number, radius: number) =>
    Math.min(1, (count * 2 * (radius + hazardRadius)) / (2 * Math.PI * AIM_DISTANCE));
  const { cycle, hits } = guardianCycle(
    brainOf(guardian),
    difficulties[difficulty].bossTelegraph,
    belowHalf,
    cover,
    difficulties[difficulty].airSlashBlades,
    fury?.chaseRate ?? 1,
  );
  // An interruption lands half way through a cycle on average and throws that half away.
  const restarts = 1 / (1 + (status.interrupts * cycle) / 2);
  const perCycle = ((1 - dodge) * (1 - status.stopped) * restarts) / (cycle + status.delay);
  const streams = hits.map((hit) => ({
    rate: perCycle * hit.perCycle,
    dmg: dmg * hit.share,
    ...(hit.poison ? { poison: hit.poison } : {}),
    ...(hit.slow ? { slow: hit.slow } : {}),
  }));
  if (!fury) return streams;
  // Approximate phase postponement by the residual non-chase part of a native cycle. This omits
  // eligible recovery windows and synchronization between both schedules; measured cadence can
  // differ in either direction. It doesn't reconstruct circles or correlated player dodges.
  const every = fury.every * (belowHalf ? fury.lowEvery : 1);
  const chase =
    (brainOf(guardian) === "lapras" ||
    brainOf(guardian) === "cloyster" ||
    brainOf(guardian) === "arcanine" ||
    brainOf(guardian) === "dragonite"
      ? BOSS_CHASE_MIN
      : CHASE_MEAN) / fury.chaseRate;
  const blocked = Math.max(0, cycle - chase);
  const phaseWait = (blocked * blocked) / (2 * cycle);
  const first = fury.first + phaseWait + status.delay;
  const perCast = mean(fury.casts.map((cast) => FURY_HITS[cast]));
  return [
    ...streams,
    {
      rate:
        fightSeconds < first
          ? 0
          : ((1 - dodge) * (1 - status.stopped) * restarts * perCast) /
            (every + phaseWait + status.delay),
      dmg: dmg * ZONE_GUARDIAN.fall,
    },
  ];
}

/**
 * Contact, spore and poison pressure on the player for the current crowd. `slowed` is seconds of slow
 * a second from outside the swarm (the guardian's slowing hits).
 */
function swarmIncoming(
  field: Field,
  living: number,
  elites: number,
  m: Means,
  skill: SkillProfile,
  slowed = 0,
) {
  const engaged = living * skill.engage;
  // An elite's body is ELITE_BODY × wider, so it counts that many times toward being caught.
  const eliteWeight = elites * skill.engage * ELITE_BODY;
  const ceiling = 1 / PLAYER_IFRAMES;
  const streams = skillStreams(field, engaged, m, skill, slowed);
  // A slowed kiter is caught as if the swarm were that much faster.
  const speed = m.speed * (1 - streams.slowUptime * (1 - statuses.slow.move.factor));
  // A kiter meets only the front of the swarm, which grows with the blob's perimeter: √crowd.
  const crowd = (engaged + eliteWeight) * (1 - m.occ.held);
  // Contact reach is enemy radius + body radius, so a wider form is caught that much more often.
  const body = (field.radius + m.radius) / (field.radius + BASE_BODY);
  const exposure = skill.contact * Math.sqrt(crowd) * (field.speed / speed) * body;
  const caught = ceiling * (1 - Math.exp(-exposure));
  // Each dash escapes one would-be hit, at most one per cooldown.
  let contact = caught - Math.min(skill.dash * caught, 1 / DASH_COOLDOWN);
  const eliteShare = eliteWeight / Math.max(1e-9, engaged + eliteWeight);
  const inSporeRange = Math.min(1, (skill.clump * SPORE.range ** 2) / FIELD_RADIUS ** 2);
  const volleys = SPORE_SHOOTERS.map((id) => ({
    rate:
      (field.share(id) *
        engaged *
        inSporeRange *
        TERRAIN_SIGHT *
        (1 - m.occ.paused) *
        (1 - skill.dodge.spore)) /
      enemies[id].skill!.every,
    dmg: enemies[id].dmg * field.dmgScale * SPORE.dmg,
  }));
  let spores = volleys.reduce((sum, v) => sum + v.rate, 0);
  // One i-frame window covers every source.
  const ranged = streams.hits.reduce((sum, h) => sum + h.rate, 0);
  const total = contact + spores + ranged;
  const squeeze = total > ceiling ? ceiling / total : 1;
  contact *= squeeze;
  spores *= squeeze;
  // Share of the crowd whose touch poisons (Weedle, Zubat).
  const poisonShare =
    field.pool.filter((id) => enemies[id].contact?.status === "poison").length / field.pool.length;
  // A catch among sludge trailers (Grimer) stands in their pools.
  const poisoned =
    contact * poisonShare * CONTACT_SECONDS +
    spores * SPORE.poison +
    streams.poisoned * squeeze +
    contact * streams.trailShare * ACID.poison;
  const hits: Hits[] = [
    { rate: contact * (1 - eliteShare), dmg: field.dmg * m.armor, clumped: true },
    { rate: contact * eliteShare, dmg: field.dmg * ELITE.dmg * m.armor, clumped: true },
    ...volleys.map((v) => ({ rate: v.rate * squeeze, dmg: v.dmg * m.armor })),
    ...streams.hits.map((h) => ({ rate: h.rate * squeeze, dmg: h.dmg * m.armor })),
  ];
  return {
    contact,
    hits,
    poisonUptime: 1 - Math.exp(-poisoned),
    cancelled: streams.cancelled,
  };
}

/**
 * Telegraphed swarm attacks (sim/skills/): each species with a skill in range and sight tries
 * once per `every` while it can start one; the profile's telegraph dodge share misses. Stun spore
 * deals no damage but slows.
 */
function skillStreams(
  field: Field,
  engaged: number,
  m: Means,
  skill: SkillProfile,
  slowed: number,
) {
  const hits: Hits[] = [];
  let poisoned = 0;
  let slowRate = 0;
  /** Seconds of slow a second from hits that leave a fixed slow (Sing, icicles). */
  let slowSeconds = slowed;
  /** Pool share of sludge trailers, whose pools a catch stands in (`swarmIncoming`). */
  let trailShare = 0;
  /** Wind-ups tried and cancelled by staggers per second, for the cancelled share. */
  let tried = 0;
  let cancelled = 0;
  for (const id of new Set(field.pool)) {
    const def = enemies[id];
    // Harden is in the pool's effective HP (`fieldAt`), spores in their own stream (`swarmIncoming`).
    if (!def.skill || def.skill.kind === "harden" || def.skill.kind === "spore") continue;
    const kind = def.skill.kind;
    const reach = skills[kind].range;
    const inRange = Math.min(1, (skill.clump * reach ** 2) / FIELD_RADIUS ** 2);
    const attempts =
      (field.share(id) * engaged * inRange * TERRAIN_SIGHT * (1 - m.occ.stopped)) /
      (def.skill.every + m.occ.delay);
    const give = 1 - poiseOf(def, false, false);
    const cancel = cancelShare(staggerRate(m.out, give, engaged), skills[kind].windup ?? 0);
    tried += attempts;
    cancelled += attempts * cancel;
    const rate = attempts * (1 - cancel) * (1 - skill.dodge.telegraph);
    const dmg = def.dmg * field.dmgScale;
    // Bubbles have no wind-up: dodged like spores, a burst is that many volleys.
    const bubbles = attempts * (1 - skill.dodge.spore);
    switch (kind) {
      case "stun-spore":
        slowRate += rate;
        break;
      case "acid":
        hits.push({ rate, dmg: dmg * ACID.splash });
        poisoned += rate * ACID.poison;
        break;
      case "poison-sting":
        hits.push({ rate, dmg: dmg * ENEMY_SHOTS[kind].damage });
        poisoned += rate * ENEMY_SHOTS[kind].poison;
        break;
      case "ember":
        hits.push({ rate, dmg: dmg * ENEMY_SHOTS[kind].damage });
        break;
      case "discharge":
      case "self-destruct":
        hits.push({ rate, dmg: dmg * RADIAL[kind].damage });
        break;
      case "psybeam":
        hits.push({ rate, dmg: dmg * PSYBEAM.dmg });
        break;
      case "dive":
      case "roll":
      case "flame-charge":
      case "horn-attack":
        hits.push({ rate, dmg });
        break;
      case "poison-fan":
        // The lanes fan wider than a body at range: one of them can hit.
        hits.push({ rate, dmg: dmg * ENEMY_SHOTS[kind].damage });
        poisoned += rate * ENEMY_SHOTS[kind].poison;
        break;
      case "thunder-shock":
        hits.push({ rate, dmg: dmg * ENEMY_SHOTS[kind].damage });
        break;
      case "bubble":
        hits.push({ rate: bubbles, dmg: dmg * BUBBLE.dmg });
        break;
      case "bubble-burst":
        hits.push({ rate: bubbles * BUBBLE.burst, dmg: dmg * BUBBLE.dmg });
        break;
      case "egg-bomb":
      case "egg-barrage":
        // The barrage's side eggs land beside a player who stands still: one blast hits.
        hits.push({ rate, dmg: dmg * EGG.damage });
        break;
      case "vine-bind":
        hits.push({ rate, dmg: dmg * VINE.dmg });
        slowRate += rate;
        break;
      case "burrow":
      case "shadow-sneak":
      case "leap":
      case "leap-heavy":
        hits.push({ rate, dmg: dmg * LANDING[kind].damage });
        break;
      case "aura":
        // `every` is the gas's tick: attempts are its hits while the player stands in a ring.
        hits.push({ rate, dmg: dmg * AURA.dmg });
        poisoned += rate * AURA.poison;
        break;
      case "heal-pulse":
        // Mends the crowd (fieldAt); never hurts.
        break;
      // Desert (docs/state-machines/simulation.md).
      case "double-peck":
      case "triple-peck":
        // Each re-aimed peck is its own dodge; a player who misses the first meets them all.
        hits.push({ rate: rate * PECK[kind].count, dmg });
        break;
      case "take-down":
      case "horn-rush":
      case "razor-dash":
        hits.push({ rate, dmg });
        break;
      case "flame-trail":
        // The charge, then one burning tick for a player who crosses the trail it leaves.
        hits.push({ rate, dmg });
        hits.push({ rate, dmg: dmg * FLAME_TRAIL.damage });
        break;
      case "pay-day":
      case "spike-cannon":
        hits.push({ rate, dmg: dmg * ENEMY_SHOTS[kind].damage });
        break;
      case "bonemerang":
        // The bone comes back along the lane it left by: one of the two legs lands.
        hits.push({ rate, dmg: dmg * BONEMERANG.damage });
        break;
      case "high-jump-kick":
      case "dig":
        hits.push({ rate, dmg: dmg * LANDING[kind].damage });
        break;
      case "rockfall":
        // The circle on the player's spot lands; the others only fence them in.
        hits.push({ rate, dmg: dmg * ROCKFALL.damage });
        break;
      // Coast (docs/state-machines/simulation.md).
      case "aqua-jet":
      case "megahorn":
        hits.push({ rate, dmg });
        break;
      case "psybeam-heavy":
        hits.push({ rate, dmg: dmg * PSYBEAM_HEAVY.dmg });
        break;
      case "water-gun":
      case "pin-missile":
        hits.push({ rate, dmg: dmg * ENEMY_SHOTS[kind].damage });
        break;
      case "discharge-wide":
      case "discharge-quick":
      case "dragon-rage":
        hits.push({ rate, dmg: dmg * RADIAL[kind].damage });
        break;
      // Tower, glacier and volcano (docs/state-machines/simulation.md).
      case "trail": {
        // No attack: Grimer lays a pool every `every` s wherever it walks (at most TRAIL.pools each).
        // A kiter crosses the ones in its path unless it reads them (telegraph dodge); a catch
        // among trailers stands in them (`trailShare`).
        trailShare += field.share(id);
        const pools =
          (field.share(id) *
            engaged *
            Math.min(TRAIL.pools, TRAIL.life / def.skill.every) *
            skill.clump) /
          (Math.PI * FIELD_RADIUS ** 2);
        const reach = TRAIL.radius + m.radius;
        poisoned +=
          pools *
          m.speed *
          2 *
          reach *
          (1 - skill.dodge.telegraph) *
          (ACID.poison + ((Math.PI / 2) * reach) / m.speed);
        break;
      }
      case "teleport":
        // Blinks away from a close player, then one psybeam at full contact damage.
        hits.push({ rate, dmg });
        break;
      case "sing":
      case "sing-wide":
        hits.push({ rate, dmg: dmg * RADIAL[kind].damage });
        slowSeconds += rate * SING_SLOW;
        break;
      case "dragon-pulse":
        hits.push({ rate, dmg: dmg * RADIAL[kind].damage });
        break;
      case "icicle":
        hits.push({ rate, dmg: dmg * ENEMY_SHOTS[kind].damage });
        slowSeconds += rate * shotHazards.icicle.slow;
        break;
      case "flamethrower":
        hits.push({ rate, dmg: dmg * ENEMY_SHOTS[kind].damage });
        break;
      case "ice-beam":
        // Tangela's vine numbers with an ice look: the same slowing beam.
        hits.push({ rate, dmg: dmg * VINE.dmg });
        slowRate += rate;
        break;
      case "belly-slide":
        hits.push({ rate, dmg });
        break;
      case "fire-punch":
        // Each re-aimed punch is its own dodge, as with the pecks.
        hits.push({ rate: rate * FIRE_PUNCHES, dmg });
        break;
      case "melt":
      case "body-slam":
      case "triple-burrow":
        // The triple burrow's circles strike together: one hit at most under the i-frames.
        hits.push({ rate, dmg: dmg * LANDING[kind].damage });
        break;
      case "fire-aura":
        hits.push({ rate, dmg: dmg * AURA.dmg });
        break;
      default:
        // A new skill fails to compile here until it is modelled.
        kind satisfies never;
    }
  }
  // Caught in a cloud: walk out of it slowed, then the slow's own seconds.
  const slowFor =
    statuses.slow.duration + STUN_SPORE.radius / (m.speed * statuses.slow.move.factor);
  return {
    hits,
    poisoned,
    trailShare,
    slowUptime: 1 - Math.exp(-(slowRate * slowFor + slowSeconds)),
    cancelled: tried > 0 ? cancelled / tried : 0,
  };
}

/**
 * The HP process' damage events for this second: Poisson hits (spores, ranged skills, the guardian)
 * and catches, i.e. geometric runs of contact hits with mean `burst`. Evasion and Guard Spec thin how
 * often hits land; a catch loses the hits spare dashes and a ready party's guards (护主) cover; the
 * shield soaks the start of a fight when it had `SHIELD.delay` + half a refill unhurt to recharge.
 */
export function damageEvents(
  hits: readonly Hits[],
  maxHp: number,
  burst: number,
  defence: Defence,
  guard: { partners: number; ready: number },
  dodged: number,
  overflow: number,
): { events: DamageEvent[]; landed: number; meanDps: number } {
  const evaded = 1 - defence.evasion;
  const plain = hits.filter((h) => !h.clumped && h.rate > 0);
  const contact = hits.filter((h) => h.clumped && h.rate > 0);
  const contactRate = contact.reduce((sum, h) => sum + h.rate, 0) * evaded;
  const catchRate = contactRate / Math.max(1, burst);
  const plainRate = plain.reduce((sum, h) => sum + h.rate, 0) * evaded;
  // Guard Spec is back for this share of encounters (a catch, or a lone hit) and takes their first hit.
  const guardBack = blockShare(defence.block, plainRate + catchRate);
  const block = 1 - guardBack;
  const episodes = plainRate * block + catchRate;
  const S = defence.shield;
  const rest = Math.exp(-episodes * (SHIELD.delay + SHIELD.refill / 2));
  const topped =
    S > 0 && defence.overhealShield ? Math.min(1, overflow / (S * Math.max(1e-6, episodes))) : 0;
  const ready = S > 0 ? rest + (1 - rest) * topped : 0;
  const events: DamageEvent[] = [];
  let meanDps = 0;
  const share = (dmg: number) => dmg / maxHp;
  for (const h of plain) {
    const pmf = hitPmf(share(h.dmg));
    if (ready > 0) {
      const soaked = hitPmf(share(Math.max(0, h.dmg - S)));
      for (let k = 0; k <= BINS; k++) pmf[k] = (1 - ready) * pmf[k]! + ready * soaked[k]!;
    }
    const rate = h.rate * evaded * block;
    events.push({ rate, pmf });
    meanDps += rate * (h.dmg - ready * Math.min(S, h.dmg));
  }
  if (catchRate > 0) {
    const hit = contact.reduce((sum, h) => sum + h.rate * h.dmg, 0) / (contactRate / evaded);
    const freeHits = (guarded: number) => dodged + guardBack + guarded;
    const free = [
      { share: 1 - guard.ready, hits: freeHits(0) },
      { share: guard.ready, hits: freeHits(guard.partners * SHIELDED_HITS) },
    ];
    const open = catchPmf(share(hit), burst, free, 0);
    const pmf = open;
    if (ready > 0) {
      const soaked = catchPmf(share(hit), burst, free, share(S));
      for (let k = 0; k <= BINS; k++) pmf[k] = (1 - ready) * open[k]! + ready * soaked[k]!;
    }
    events.push({ rate: catchRate, pmf, catch: true });
    let mean = 0;
    for (let k = 0; k <= BINS; k++) mean += pmf[k]! * k;
    meanDps += (catchRate * mean * maxHp) / BINS;
  }
  return { events, landed: plainRate * block + contactRate - catchRate * guardBack, meanDps };
}

/** The HP process' saves: what each restores and the share of catch deaths it outlasts. */
function savesOf(defence: Defence, maxHp: number, catchHit: number, burst: number) {
  const go = 1 - 1 / Math.max(1, burst);
  const toSave = (s: { hp: number; chance: number; iframes: number }): Save => {
    // After the save, the rest of the catch must last through the i-frames and the restored HP.
    const hitsToKill = Math.max(1, (Math.max(1 / maxHp, s.hp) * maxHp) / Math.max(1e-9, catchHit));
    return {
      hp: s.hp,
      chance: s.chance,
      rescue: 1 - go ** (s.iframes / PLAYER_IFRAMES + hitsToKill),
    };
  };
  return {
    charges: defence.charges.map(toSave),
    fallback: defence.fallback ? toSave(defence.fallback) : null,
    fallbackFirst: defence.fallbackFirst,
  };
}

// --- The run ---------------------------------------------------------------------------------

/** Living elites, oldest first: expected count, HP cost at birth and capture chance. */
interface EliteCohort {
  n: number;
  hp: number;
  chance: number;
  xp: number;
  rawXp: number;
}

/** One build sample's run: its own stocks, build and HP distribution. */
interface Track {
  player: Player;
  rng: Rng;
  /** Captures and the species they bring (kept apart so they do not shift the card rolls). */
  captureRng: Rng;
  learnedAt: Map<MoveId, number>;
  itemAt: Map<string, number>;
  fusedAt: number | undefined;
  approaching: number;
  living: number;
  killed: number;
  eliteKilled: number;
  killRate: number;
  hurtRate: number;
  /** The shared director's smoothed pressure; geometry and recent hits are estimated below. */
  directorPressure: number;
  levelAt: number[];
  hp: HpState;
  frac: number;
  alive: number;
  elites: EliteCohort[];
  chestCredit: number;
  boss: { hp: number; max: number; dmgScale: number } | null;
  bossTtk: number | null;
  partners: EnemyId[];
  ultCharge: number;
  casting: number;
  invulnerable: number;
  ults: number[];
  damage: Map<MoveId, number>;
  rows: Minute[];
  beats: BeatSpike[];
  /** Alive at each second while running (the run's end freezes it). */
  survival: number[];
  reachBoss: number;
  clearAt: number | null;
  clear: number;
  meanSurvival: number;
  stardust: number;
  /** Current zone (0-based), the run second it began, its timeline beats fired so far. */
  zone: number;
  zoneStart: number;
  fired: Set<string>;
  /** Zone second an eruption beat stops dropping bombs (0: none running). */
  eruptionUntil: number;
  /** Run second and alive share at each zone guardian kill. */
  zoneClears: { t: number; alive: number; level: number }[];
  guardianReach: number[];
  /** Per zone: the guardian fight so far (`GuardianFight`). */
  fights: { seconds: number; cost: number; complete: boolean }[];
  done: boolean;
}

function newTrack(i: number, starter: StarterId, lab: LabBonuses | undefined): Track {
  const player = createPlayer(0, starter, 0, lab);
  return {
    player,
    rng: createRng(0x5eed + i * 7919),
    captureRng: createRng(0xca97 + i * 104729),
    learnedAt: new Map(player.moves.map((s) => [s.id, 0])),
    itemAt: new Map(),
    fusedAt: undefined,
    approaching: 0,
    living: 0,
    killed: 0,
    eliteKilled: 0,
    killRate: 0,
    hurtRate: 0,
    directorPressure: 0.5,
    levelAt: [0, 0],
    hp: createHp(),
    frac: 1,
    alive: 1,
    elites: [],
    chestCredit: 0,
    boss: null,
    bossTtk: null,
    partners: [],
    ultCharge: 0,
    casting: 0,
    invulnerable: 0,
    ults: [],
    damage: new Map(),
    rows: [],
    beats: [],
    survival: [],
    reachBoss: 0,
    clearAt: null,
    clear: 0,
    meanSurvival: 0,
    stardust: 0,
    zone: 0,
    zoneStart: 0,
    fired: new Set(),
    eruptionUntil: 0,
    zoneClears: [],
    guardianReach: [],
    fights: [],
    done: false,
  };
}

/** The partners a sample has, as `rollChoices` reads them (their types open boosters). */
function partnerList(track: Track): Partner[] {
  return track.partners.map((species, id) => ({
    id,
    owner: track.player.id,
    species,
    x: 0,
    z: 0,
    px: 0,
    pz: 0,
    faceX: 0,
    faceZ: 1,
    cooldown: 0,
    guard: 0,
  }));
}

interface RunEnv {
  options: RunOptions;
  fields: { stage: StageId; zone: number }[];
  zones: number;
  summonSeconds: readonly number[];
  policy: PickPolicy;
  exposure: Map<string, { eligible: number; offered: number }>;
  offers: number;
}

function growthBefore(player: Player) {
  const stats = playerStats(player);
  return {
    level: player.level,
    stage: player.stage,
    maxHp: stats.maxHp,
    saves: defenceOf(stats).charges,
  };
}

function recordGrowth(track: Track, before: ReturnType<typeof growthBefore>, t: number) {
  const { player } = track;
  for (let level = before.level + 1; level <= player.level; level++) track.levelAt[level] = t;
  if (player.stage > before.stage) {
    track.invulnerable = Math.max(track.invulnerable, EVOLVE_INVULNERABLE);
    refund(track.hp, (u) => before.saves.slice(0, u).filter((c) => c.perStage).length);
  }
  growHp(track.hp, before.maxHp, playerStats(player).maxHp);
  track.frac = hpShare(track.hp);
  player.hp = track.frac * playerStats(player).maxHp;
}

function offer(
  env: RunEnv,
  track: Track,
  source: "level" | "chest",
  target: Target,
  t: number,
  rolled?: Choice[],
) {
  const { player, rng } = track;
  const partners = partnerList(track);
  const options = rolled ?? rollChoices(rng, player, source, partners);
  if (source === "level" && !rolled) countExposure(env, player, options);
  // Chest cards are all upgrades, so "prefer" never applies there.
  const rule = source === "chest" ? { prefer: null, greedy: env.policy.greedy } : env.policy;
  const before = growthBefore(player);
  const levels = applyPick(
    player,
    chooseCard(player, options, rule, rng, target, env.options.skill, partners),
  );
  recordGrowth(track, before, t);
  if (track.fusedAt === undefined && fuseMoves(player)) track.fusedAt = t;
  for (const state of player.moves)
    if (!track.learnedAt.has(state.id)) track.learnedAt.set(state.id, t);
  for (const item of player.items) if (!track.itemAt.has(item.id)) track.itemAt.set(item.id, t);
  return levels;
}

function settleRewards(
  env: RunEnv,
  track: Track,
  target: Target,
  t: number,
  xp: number,
  chests: number,
) {
  const { player, rng } = track;
  const before = growthBefore(player);
  // Elite/guardian loot queues its chest before its XP. Only the front offer is rolled immediately.
  const pending: ("level" | "chest")[] = Array<"chest">(chests).fill("chest");
  let first = chests > 0 ? rollChoices(rng, player, "chest", partnerList(track)) : undefined;
  gainXp(player, xp, () => {
    if (pending.length === 0) {
      first = rollChoices(rng, player, "level", partnerList(track));
      countExposure(env, player, first);
    }
    pending.push("level");
  });
  recordGrowth(track, before, t);
  for (let i = 0; i < pending.length; i++) {
    const extra = offer(env, track, pending[i]!, target, t, i === 0 ? first : undefined);
    for (let n = 0; n < extra; n++) pending.push("level");
  }
}

/** Level-up offers: which items and new moves could have been offered, and which were. */
function countExposure(env: RunEnv, player: Player, options: readonly Choice[]) {
  env.offers += 1;
  const bump = (key: string, field: "eligible" | "offered") => {
    const entry = env.exposure.get(key) ?? { eligible: 0, offered: 0 };
    entry[field] += 1;
    env.exposure.set(key, entry);
  };
  const itemRoom = player.items.length < itemSlots(player);
  for (const key of env.exposure.keys()) {
    const [kind, id] = key.split(":") as ["item" | "move", string];
    const owned =
      kind === "item"
        ? player.items.some((item) => item.id === id)
        : player.moves.some((state) => state.id === id);
    if (kind === "item" ? owned || itemRoom : !owned && player.moves.length < moveSlots(player))
      bump(key, "eligible");
  }
  for (const choice of options) {
    if (choice.kind === "item") bump(`item:${choice.item}`, "offered");
    if (choice.kind === "move") bump(`move:${choice.move}`, "offered");
  }
}

/** How a second's output was split: the swarm's and the guardian's shares, what elites and partners took. */
export interface Split {
  swarm: number;
  boss: number;
  /** Elite HP removed this second, and partner damage on the swarm and elites. */
  eliteRemoved: number;
  partners: number;
}

/**
 * HP healed per second (sim `afterHit` and the heal triggers): lifesteal on the HP the hits removed
 * after the split, guardian, elites and partners included (DoT and overkill heal nothing), each
 * drain move on its own hits, regen and the heal triggers on the ledger.
 */
export function healPerSecond(
  out: BuildOutput,
  split: Split,
  kills: number,
  hp: Pick<Ledger, "below" | "full">,
): number {
  const { stats } = out;
  const drain = out.perMove.reduce(
    (sum, { move, out: one }) =>
      sum + (moveDefs[move].drain ?? 0) * (one.direct * split.swarm + one.single * split.boss),
    0,
  );
  const typeHits: Ledger["typeHits"] = {};
  for (const { move, out: one } of out.perMove) {
    const { type } = moveDefs[move];
    typeHits[type] = (typeHits[type] ?? 0) + one.hits * split.swarm + one.bossHits * split.boss;
  }
  const directShare = out.useful > 0 ? out.direct / out.useful : 0;
  const ledger: Ledger = {
    stats,
    removed:
      out.direct * split.swarm +
      split.eliteRemoved * directShare +
      split.partners +
      out.single * split.boss,
    kills,
    typeHits,
    ...hp,
  };
  let total = (stats.regen + stats.lifesteal * ledger.removed + drain) * stats.healing;
  for (const { def } of stats.triggers) total += modelOf(def).sustain?.(def, ledger) ?? 0;
  return total;
}

/** Advances one sample by one second (`t`: run second). */
function stepTrack(env: RunEnv, track: Track, t: number): void {
  const { options } = env;
  const { difficulty, skill } = options;
  const diff = difficulties[difficulty];
  const { player } = track;
  const fieldIndex = track.zone;
  const { stage: stageId, zone } = env.fields[fieldIndex]!;
  const stage = stageDefs[stageId];
  const { guardian: zoneGuardian, beats } = stage.zones[zone]!;
  const guardian = zoneGuardian.species;
  const zoneDef = zoneFactorsFor(stage, zone);
  const guardianXp = enemies[guardian].xp * zoneDef.xp * diff.xp;
  // Stage time in this zone, and the clock the swarm curves read.
  const tz = t - track.zoneStart;
  const clock = zoneClock(stage, zone, tz);
  const summon = env.summonSeconds[fieldIndex]!;
  const rampage = tz >= stage.duration && (track.boss !== null || tz >= summon);
  const field = fieldAt(stageId, tz, difficulty, rampage, zone);
  const fired = new Set<string>();
  for (const [at, { kind }] of beats) {
    const key = `${kind}@${at}`;
    if (tz >= at - diff.earlyBy && !track.fired.has(key)) {
      track.fired.add(key);
      fired.add(key);
    }
  }
  const eliteEach = field.hp * ELITE.hp;

  // Timeline beats (fired this second): swarms and stampedes join the crowd, elites the elite stock.
  for (const [at, { kind: beat }] of beats) {
    if (!fired.has(`${beat}@${at}`)) continue;
    const now = measure(
      player,
      targetFor(field, Math.max(track.living, 1), skill),
      skill,
      track.frac,
    );
    const load = BEAT_LOAD[beat];
    if ("hazard" in load) {
      track.eruptionUntil = tz + load.hazard;
      continue;
    }
    if ("crowd" in load) {
      const added = load.crowd(diff.amount);
      track.living += added;
      track.beats.push({
        zone: fieldIndex,
        t: tz,
        beat,
        clear: (added * field.hp) / Math.max(0.1, now.out.useful),
      });
    } else {
      const n = load.elites;
      const hp = eliteEach * (beat === "alpha" ? ALPHA_HP : 1);
      const clear = (n * hp) / Math.max(0.1, now.out.raw * ELITE_SHARE);
      track.beats.push({ zone: fieldIndex, t: tz, beat, clear });
      const chance = beat === "alpha" ? CAPTURE_CHANCE.alpha : CAPTURE_CHANCE.elite;
      track.elites.push({ n, hp, chance, xp: field.eliteXp, rawXp: field.xp * ELITE.xp });
    }
  }
  if (tz >= summon && !track.boss) {
    const max = bossHp(guardian, difficulty) * zoneDef.guardianHp;
    track.guardianReach[fieldIndex] = track.alive;
    track.boss = {
      hp: max,
      max,
      dmgScale:
        enemyScaling(GUARDIAN_REFERENCE_SECONDS, difficulty, null).dmg *
        zoneDef.dmg *
        zoneDef.guardianDmg,
    };
  }

  const target = targetFor(field, track.living, skill);
  setMeasures(
    player,
    {
      kills: track.killed + track.eliteKilled,
      killRate: track.killRate,
      hurtRate: track.hurtRate,
      frac: track.frac,
      formSpeed: formOf(player).speed,
    },
    playerStats(player),
  );
  const m = measure(player, target, skill, track.frac);
  const { stats } = m.out;
  const partnerDps =
    track.partners.reduce((sum, species) => sum + partnerPower(species, target), 0) *
    enemyScaling(clock, difficulty, null).hp *
    // The zone's own HP factor, not the stage's `enemyHp`: partner hits do not scale with the map.
    zonesOf(stage)[zone]!.hp *
    stats.damage *
    m.partnerDamage *
    m.partnerRate *
    Math.min(1, target.living);
  const boss = track.boss;
  const bossFocus = boss ? skill.bossFocus : 0;
  const belowHalf = boss !== null && boss.hp < boss.max * guardianLowHealth(guardian);
  // Hidden or shielded stretches of the guardian's cycle take its direct hits (not its burn).
  const fury = furyOf(stage.id, zone);
  const exposure = boss ? guardianExposure(guardian, difficulty, belowHalf, fury) : 1;
  const bossDps = m.out.single * skill.bossFocus * exposure + m.out.bossBurn;
  // The guardian figures (TTK, HP left) are the last zone's.
  if (boss && track.bossTtk === null && fieldIndex === env.zones - 1)
    track.bossTtk = boss.max / Math.max(0.1, bossDps);

  // The guardian's statuses come from the share of the build's output aimed at it.
  const bossStatus = {
    stopped: m.occ.bossStopped * skill.bossFocus,
    delay: m.occ.bossDelay * skill.bossFocus,
    interrupts: m.occ.bossInterrupts * skill.bossFocus,
  };
  const guardianHits = boss
    ? bossHits(
        guardian,
        difficulty,
        boss.dmgScale,
        m.armor,
        skill.dodge.boss,
        belowHalf,
        hazardRadius(player),
        bossStatus,
        fury,
        tz - summon,
      )
    : [];
  if (boss) {
    const fight = (track.fights[fieldIndex] ??= { seconds: 0, cost: 0, complete: false });
    fight.seconds += STEP;
    fight.cost += (guardianHits.reduce((sum, h) => sum + h.rate * h.dmg, 0) * STEP) / m.maxHp;
  }
  const sideEffect = (key: "poison" | "slow") =>
    guardianHits.reduce((sum, h) => sum + h.rate * (h[key] ?? 0), 0);
  const swarm = swarmIncoming(
    field,
    track.living,
    track.elites.reduce((sum, cohort) => sum + cohort.n, 0),
    m,
    skill,
    sideEffect("slow"),
  );
  const erupting = tz < track.eruptionUntil;
  const eruption = erupting ? eruptionHits(m.speed, hazardRadius(player), skill.dodge.boss) : null;
  const hits = [
    ...swarm.hits,
    ...guardianHits,
    ...(eruption
      ? [
          { rate: eruption.bombs, dmg: ERUPTION.dmg * m.armor },
          { rate: eruption.pools, dmg: ERUPTION.dmg * ZONE_GUARDIAN.pool * m.armor },
        ]
      : []),
  ];
  // Poison wears the player down to 1 HP but never finishes them.
  const bossPoison = sideEffect("poison");
  const poisonUptime =
    bossPoison > 0 ? 1 - (1 - swarm.poisonUptime) * Math.exp(-bossPoison) : swarm.poisonUptime;
  const poison = poisonUptime * drainAt(statuses.poison, clock);

  // Output split: guardian first, then elites; the rest clears the swarm. Partners skip the guardian.
  let useful = m.out.useful + swarm.contact * Math.min(m.thorns, field.hp);
  let swarmShare = 1;
  let partnerSwarm = partnerDps;
  if (boss) {
    boss.hp -= bossDps * STEP;
    swarmShare *= 1 - BOSS_TRASH_COST * skill.bossFocus;
  }
  let eliteKills = 0;
  let eliteRemoved = 0;
  let eliteXp = 0,
    eliteWorth = 0;
  if (track.elites.length > 0) {
    const cleared = damageElites(track, (m.out.raw + partnerSwarm) * ELITE_SHARE * STEP, field, m);
    eliteRemoved = cleared.removed;
    eliteKills = cleared.kills;
    eliteXp = cleared.xp;
    eliteWorth = cleared.rawXp;
    swarmShare *= 1 - ELITE_SHARE;
    partnerSwarm *= 1 - ELITE_SHARE;
  }
  useful = useful * swarmShare + partnerSwarm;
  // The ultimate fires as soon as it is full: one cast's damage lands in this second.
  let ultHeal = 0;
  if (track.casting > 0) track.casting -= STEP;
  else if (track.ultCharge >= 1) {
    const cast = ultCast(player, target);
    useful += cast.useful;
    if (boss) boss.hp -= cast.single;
    ultHeal = cast.heal;
    track.casting = cast.duration;
    track.invulnerable = Math.max(track.invulnerable, ULT_INVULNERABLE);
    track.ultCharge = 0;
    track.ults.push(t);
  }
  for (const { move, out } of m.out.perMove) {
    const onBoss = boss ? out.single * skill.bossFocus : 0;
    track.damage.set(
      move,
      (track.damage.get(move) ?? 0) + (out.dealt * swarmShare + onBoss) * STEP,
    );
  }

  const cap = liveCap(clock, difficulty) * zoneDef.cap;
  let spawnScale = 1;
  const opening =
    zone === 0 ? DIRECTOR_PRESSURE.openingSeconds : DIRECTOR_PRESSURE.zoneGraceSeconds;
  if (tz <= opening || boss || rampage) track.directorPressure = 0.5;
  else {
    const bodies =
      track.living +
      track.elites.reduce((sum, cohort) => sum + cohort.n * DIRECTOR_PRESSURE.eliteWeight, 0);
    const density = targetFor(field, bodies, skill).density;
    // Integral of the runtime's 1 − r²/R² kernel over a uniform disc. Actual spatial clusters vary.
    const nearby = Math.min(bodies, (density * Math.PI * DIRECTOR_PRESSURE.radius ** 2) / 2);
    // Expected linearly decaying last-hit signal for a stationary Poisson hit rate over the window.
    const hitsInWindow = track.hurtRate * DIRECTOR_PRESSURE.hitMemory;
    const recentHit = hitsInWindow > 0 ? 1 + Math.expm1(-hitsInWindow) / hitsInWindow : 0;
    const pressure = pressureTarget(nearby, track.frac, recentHit);
    track.directorPressure = advancePressure(track.directorPressure, pressure, STEP);
    spawnScale = pressureSupply(track.directorPressure, tz, zone);
  }
  const spawnsNow =
    spawnRate(clock, difficulty, rampage) * zoneDef.spawns * SPAWN_SUCCESS * m.spawns * spawnScale;
  const spawned = spawnsNow * STEP;
  if (track.living + track.approaching < cap) {
    const elites = spawned * diff.eliteChance * m.elites;
    track.approaching += spawned - elites;
    // Random elites can join too: one more capture chance each, once it is cleared.
    if (elites > 0)
      track.elites.push({
        n: elites,
        hp: eliteEach,
        chance: CAPTURE_CHANCE.elite,
        xp: field.eliteXp,
        rawXp: field.xp * ELITE.xp,
      });
  }
  const arrived = track.approaching * Math.min(1, (field.speed * STEP) / APPROACH);
  track.approaching -= arrived;
  track.living += arrived;
  const kills = Math.min(track.living, (useful * STEP) / field.hp);
  track.living -= kills;
  track.killed += kills;
  track.eliteKilled += eliteKills;
  track.killRate = (kills + eliteKills) / STEP;

  const xp = (kills * field.xp + eliteXp) * m.xp * m.pickup;
  if (track.casting <= 0)
    track.ultCharge +=
      ultChargeRate(
        player,
        kills * field.xp + eliteWorth,
        boss ? bossDps / boss.max : 0,
        guardianXp,
      ) * STEP;
  track.chestCredit += eliteKills * skill.chests;
  // 星星沙子 drops are pickups like candy; what this second earns counts while the sample is alive.
  track.stardust +=
    track.alive *
    (kills * STARDUST.ordinary.chance * STARDUST.ordinary.value + eliteKills * STARDUST.elite) *
    m.pickup *
    stats.stardust;
  const berries = (kills * BERRY.chance * m.berries * BERRY.heal * m.pickup) / STEP;

  const sustain = healPerSecond(
    m.out,
    { swarm: swarmShare, boss: bossFocus, eliteRemoved, partners: partnerSwarm },
    kills + eliteKills,
    {
      below: (share) => {
        let mass = 0;
        for (const layer of track.hp.layers)
          for (let i = 1; i <= BINS && i / BINS < share; i++) mass += layer[i]!;
        return track.alive > 0 ? mass / track.alive : 0;
      },
      full: fullShare(track.hp),
    },
  );
  const full = fullShare(track.hp);
  const heal = sustain + berries + ultHeal / STEP;

  // Ultimate and evolution invulnerability blanks this share of the second's hits.
  const exposed = 1 - Math.min(1, track.invulnerable / STEP);
  track.invulnerable = Math.max(0, track.invulnerable - STEP);
  const caught = hits.filter((h) => h.clumped);
  const catches = caught.reduce((sum, h) => sum + h.rate, 0) / Math.max(1, skill.burst);
  const party = track.partners.length;
  const guard = { partners: party, ready: party > 0 ? guardedShare(catches, m.guardRest) : 0 };
  const exposedHits = hits.map((h) => ({ ...h, rate: h.rate * exposed }));
  const { events, landed, meanDps } = damageEvents(
    exposedHits,
    m.maxHp,
    skill.burst,
    m.defence,
    guard,
    m.spareDashes,
    heal * full,
  );
  track.hurtRate = landed;
  const catchHit =
    caught.reduce((sum, h) => sum + h.rate * h.dmg, 0) /
    Math.max(
      1e-9,
      caught.reduce((sum, h) => sum + h.rate, 0),
    );
  const saves = savesOf(m.defence, m.maxHp, catchHit || m.maxHp, skill.burst);
  stepHp(track.hp, {
    events,
    heal: heal / m.maxHp,
    poison: poison / m.maxHp,
    floor: DRAIN_FLOOR / m.maxHp,
    charges: saves.charges,
    fallback: saves.fallback,
    fallbackFirst: saves.fallbackFirst,
    lifts: m.defence.lifts,
  });
  track.alive = aliveOf(track.hp);
  track.frac = hpShare(track.hp);
  player.hp = track.frac * m.maxHp;
  track.meanSurvival += track.alive * STEP;
  track.survival.push(track.alive);
  if (tz === summon && fieldIndex === env.zones - 1) track.reachBoss = track.alive;

  // Fractional kills can leave a completed chest a rounding bit short.
  const chests = Math.floor(track.chestCredit + 1e-9);
  track.chestCredit = Math.max(0, track.chestCredit - chests);
  settleRewards(env, track, target, t, xp, chests);
  if (boss && boss.hp <= 0) {
    track.fights[fieldIndex]!.complete = true;
    // combat.ts drops six individually rounded candies and one chest; the exit collects all of them.
    const rewardXp = LOOT.eliteXpCount * Math.ceil(guardianXp / LOOT.eliteXpCount);
    settleRewards(env, track, target, t, rewardXp * playerStats(player).xp, 1);
  }

  if (t % 60 === 0) {
    const capacity = measure(player, targetFor(field, cap, skill), skill, track.frac).out.useful;
    const incoming = spawnsNow * field.hp;
    track.rows.push({
      t,
      level: player.level,
      moves: player.moves.length,
      items: player.items.reduce((sum, item) => sum + item.level, 0),
      useful,
      capacity,
      incoming,
      pressure: capacity / incoming,
      spawnScale,
      fill: (track.living + track.approaching) / cap,
      living: track.living + track.approaching,
      kills: track.killed + track.eliteKilled,
      single: bossDps,
      inDps: meanDps + poison,
      ehp: m.maxHp / m.armor,
      hp: track.frac,
      alive: track.alive,
      partners: party,
      partnerDps,
      cancelled: swarm.cancelled,
    });
  }
  if (track.alive < 1e-4) track.done = true;
  if (boss && boss.hp <= 0) {
    track.stardust += track.alive * STARDUST.guardian * stats.stardust;
    track.zoneClears.push({ t, alive: track.alive, level: player.level });
    if (fieldIndex < env.zones - 1) {
      // The next zone: a fresh field and timeline; the build, HP and partners carry over.
      track.zone += 1;
      track.zoneStart = t;
      track.fired.clear();
      track.eruptionUntil = 0;
      track.boss = null;
      track.bossTtk = null;
      track.living = 0;
      track.approaching = 0;
      track.elites = [];
      track.directorPressure = 0.5;
      return;
    }
    track.clearAt = t;
    track.clear = track.alive;
    track.done = true;
  }
}

/**
 * Spend damage oldest first at each cohort's birth cost. The same expected kills consume stock,
 * earn rewards and sample captures; extra alpha HP never buys extra kills or capture probability.
 */
function damageElites(track: Track, damage: number, field: Field, m: Means) {
  let kills = 0;
  let removed = 0,
    xp = 0,
    rawXp = 0;
  while (damage > 0 && track.elites.length > 0) {
    const due = track.elites[0]!;
    const spent = Math.min(damage, due.n * due.hp, due.hp);
    const n = spent / due.hp;
    due.n -= n;
    damage -= spent;
    kills += n;
    removed += spent;
    xp += n * due.xp;
    rawXp += n * due.rawXp;
    if (due.n <= 1e-9) track.elites.shift();
    if (track.partners.length >= partnerSlots(track.player)) continue;
    const odds = m.sureCapture ? 1 : due.chance;
    if (next(track.captureRng) < n * odds)
      track.partners.push(field.pool[Math.floor(next(track.captureRng) * field.pool.length)]!);
  }
  return { kills, removed, xp, rawXp };
}

/** Every item and kit move of `starter`, as exposure keys. */
function exposureKeys(starter: StarterId, items: readonly string[]): string[] {
  const kit = [...starters[starter].kit, ...starters[starter].evolutionMoves];
  return [...items.map((id) => `item:${id}`), ...kit.map((id) => `move:${id}`)];
}

/** The samples' runs, averaged. */
export function runModel(options: RunOptions): RunModel {
  const { starter, difficulty } = options;
  const stage = stageDefs[options.stage];
  const count = options.samples ?? BUILD_SAMPLES;
  const tracks = Array.from({ length: count }, (_, i) => newTrack(i, starter, options.lab));
  const zones = options.campaign ? CAMPAIGN_FIELDS.length : (options.zones ?? 1);
  if (!(Number.isInteger(zones) && zones >= 1 && (options.campaign || zones <= stage.zones.length)))
    throw new RangeError(`runModel: zones ${zones} (1–${stage.zones.length})`);
  const fields = options.campaign
    ? CAMPAIGN_FIELDS
    : Array.from({ length: zones }, (_, zone) => ({ stage: options.stage, zone }));
  const summonSeconds = options.summonSeconds ?? fields.map(() => GUARDIAN_REFERENCE_SECONDS);
  if (
    options.summonSeconds &&
    (summonSeconds.length !== fields.length ||
      summonSeconds.some(
        (time, index) =>
          !Number.isInteger(time) || time < STEP || time > stageDefs[fields[index]!.stage].duration,
      ))
  )
    throw new RangeError(
      `runModel: summonSeconds needs ${fields.length} field times within 1–duration`,
    );
  const env: RunEnv = {
    options,
    fields,
    summonSeconds,
    zones,
    policy: options.picks ?? options.skill.picks,
    exposure: new Map(
      exposureKeys(starter, Object.keys(itemDefs)).map((key) => [key, { eligible: 0, offered: 0 }]),
    ),
    offers: 0,
  };
  const horizon = env.fields.reduce(
    (sum, field) => sum + stageDefs[field.stage].duration + OVERTIME,
    0,
  );
  for (let t = STEP; t <= horizon; t += STEP) {
    let running = false;
    for (const track of tracks) {
      if (track.done) continue;
      // Past its zone's rampage window the sample is called (as the single-zone horizon did).
      if (t - track.zoneStart > stageDefs[env.fields[track.zone]!.stage].duration + OVERTIME) {
        track.done = true;
        continue;
      }
      stepTrack(env, track, t);
      running = true;
    }
    if (!running) break;
  }

  // Averages. A finished sample keeps its last alive (cleared: its clear chance; dead: ~0).
  const steps = Math.max(...tracks.map((tr) => tr.survival.length));
  const survivalAt = (s: number) =>
    mean(tracks.map((tr) => tr.survival[Math.min(s, tr.survival.length - 1)] ?? 1));
  let medianDeath: number | null = null;
  for (let s = 0; s < steps; s++)
    if (survivalAt(s) < 0.5) {
      medianDeath = (s + 1) * STEP;
      break;
    }
  const minutes: Minute[] = [];
  for (let t = 60; t <= horizon; t += 60) {
    const rows = tracks.flatMap((tr) => tr.rows.filter((row) => row.t === t));
    if (rows.length === 0) break;
    const avg = (key: keyof Minute) => mean(rows.map((row) => row[key]));
    const row = Object.fromEntries(
      (Object.keys(rows[0]!) as (keyof Minute)[]).map((key) => [key, avg(key)]),
    ) as unknown as Minute;
    row.alive = survivalAt(t / STEP - 1);
    row.pressure = row.capacity / row.incoming;
    minutes.push(row);
  }
  const cleared = tracks.filter((tr) => tr.clearAt !== null);
  const clearWeight = cleared.reduce((sum, tr) => sum + tr.clear, 0);
  const reached = tracks.filter((tr) => tr.bossTtk !== null);
  const kit = [...starters[starter].kit, ...starters[starter].evolutionMoves];
  const damage = new Map<MoveId, number>();
  for (const tr of tracks)
    for (const [move, value] of tr.damage) damage.set(move, (damage.get(move) ?? 0) + value);
  const total = [...damage.values()].reduce((sum, value) => sum + value, 0) || 1;
  const intervals = tracks.flatMap((tr) => tr.ults.slice(1).map((at, i) => at - tr.ults[i]!));
  const maxLevel = Math.max(...tracks.map((tr) => tr.levelAt.length));
  const levelAt = Array.from({ length: maxLevel }, (_, level) =>
    mean(tracks.flatMap((tr) => (tr.levelAt[level] === undefined ? [] : [tr.levelAt[level]!]))),
  );
  const exposure = new Map<string, Exposure>();
  for (const [key, { eligible, offered }] of env.exposure) {
    const [kind, id] = key.split(":") as ["item" | "move", string];
    const times = tracks.flatMap((tr) => {
      if (kind === "move")
        return tr.learnedAt.has(id as MoveId) ? [tr.learnedAt.get(id as MoveId)!] : [];
      return tr.itemAt.has(id) ? [tr.itemAt.get(id)!] : [];
    });
    exposure.set(key, {
      eligible: eligible / Math.max(1, env.offers),
      offered: offered / Math.max(1, env.offers),
      acquired: times.length / count,
      at: mean(times),
    });
  }
  // Each beat of each zone, averaged over the samples that reached it.
  const spikes = new Map<string, { spike: BeatSpike; clears: number[] }>();
  for (const tr of tracks)
    for (const b of tr.beats) {
      const key = `${b.zone}:${b.beat}@${b.t}`;
      const entry = spikes.get(key) ?? { spike: b, clears: [] };
      entry.clears.push(b.clear);
      spikes.set(key, entry);
    }
  const beats = [...spikes.values()]
    .map(({ spike, clears }) => ({ ...spike, clear: mean(clears) }))
    .sort((a, b) => a.zone - b.zone || a.t - b.t);
  return {
    stage: options.stage,
    starter,
    difficulty,
    skill: options.skill.name,
    minutes,
    outcome: {
      reachBoss: mean(tracks.map((tr) => tr.reachBoss)),
      clear: mean(tracks.map((tr) => tr.clear)),
      clearAt:
        clearWeight > 0
          ? cleared.reduce((sum, tr) => sum + tr.clearAt! * tr.clear, 0) / clearWeight
          : null,
      medianDeath,
      meanSurvival: mean(tracks.map((tr) => tr.meanSurvival)),
    },
    bossTtk: reached.length > 0 ? mean(reached.map((tr) => tr.bossTtk!)) : null,
    summonSeconds: [...summonSeconds],
    bossWindow: stageDefs[env.fields.at(-1)!.stage].duration - summonSeconds.at(-1)!,
    bossLeft:
      reached.length > 0
        ? mean(reached.map((tr) => Math.max(0, tr.boss!.hp) / tr.boss!.max))
        : null,
    beats,
    learned: kit.map((move) => {
      const times = tracks.flatMap((tr) =>
        tr.learnedAt.has(move) ? [tr.learnedAt.get(move)!] : [],
      );
      return { move, t: mean(times), share: times.length / count };
    }),
    damageShare: [...kit, signatureFusions[starter].result].map((move) => ({
      move,
      share: (damage.get(move) ?? 0) / total,
    })),
    ultEvery: intervals.length > 0 ? mean(intervals) : null,
    levelAt,
    fights: Array.from({ length: zones }, (_, z) => {
      const fights = tracks.flatMap((tr) => (tr.fights[z] ? [tr.fights[z]!] : []));
      const completed = fights.filter((fight) => fight.complete);
      return fights.length > 0
        ? {
            seconds: completed.length > 0 ? mean(completed.map((f) => f.seconds)) : null,
            cost: completed.length > 0 ? mean(completed.map((f) => f.cost)) : null,
            completed: completed.length,
            attempted: fights.length,
          }
        : null;
    }),
    zoneClears: Array.from({ length: zones }, (_, z) => {
      const at = tracks.flatMap((tr) => (tr.zoneClears[z] ? [tr.zoneClears[z]!] : []));
      const weight = at.reduce((sum, c) => sum + c.alive, 0);
      return {
        ...env.fields[z]!,
        reach: mean(tracks.map((tr) => tr.guardianReach[z] ?? 0)),
        clear: at.reduce((sum, c) => sum + c.alive, 0) / count,
        t: weight > 0 ? at.reduce((sum, c) => sum + c.t * c.alive, 0) / weight : null,
        level: at.length ? mean(at.map((c) => c.level)) : null,
      };
    }),
    fused: {
      share: tracks.filter((tr) => tr.fusedAt !== undefined).length / count,
      t: mean(tracks.flatMap((tr) => (tr.fusedAt === undefined ? [] : [tr.fusedAt]))),
    },
    kills: {
      swarm: mean(tracks.map((tr) => tr.killed)),
      elites: mean(tracks.map((tr) => tr.eliteKilled)),
      guardian: mean(tracks.map((tr) => tr.clear)),
    },
    stardust: mean(tracks.map((tr) => tr.stardust)),
    exposure,
  };
}
