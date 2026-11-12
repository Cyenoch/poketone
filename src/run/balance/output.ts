// Per-move output in closed form: what one move deals per second against the swarm and against a
// lone guardian, from the same parameters the sim casts with (`moveParams`, the archetype modules, combat rules).

import { moveParams } from "../sim/attacks";
import {
  BARRAGE,
  BEAM,
  BLOOM,
  BOLT,
  CONE,
  FIRESTORM,
  SHOT_KNOCK,
  LOB,
  ORB,
  ROD,
  SPIN,
  SPRINKLER,
  STRIKE,
  VORTEX,
  WAVE,
} from "../sim/content/params/archetypes";
import { burstArea } from "../sim/archetypes/burst";
import { archetypes } from "../sim/archetypes/index";

import { beamArea } from "../sim/archetypes/beam";

import { coneArea } from "../sim/archetypes/cone";

import { type MoveParams } from "../sim/archetypes/kit";

import { smiteArea } from "../sim/archetypes/smite";
import { novaArea } from "../sim/archetypes/nova";

import { spinArea } from "../sim/archetypes/spin";

import { strikeArea } from "../sim/archetypes/strike";

import { vortexArea } from "../sim/archetypes/vortex";

import { moves, type Archetype, type MoveDef } from "../sim/content/moves";
import type { Resolved, TriggerDef } from "../sim/content/triggers";
import type { ElementType } from "../sim/content/elements";
import { reactions } from "../sim/content/reactions";
import { statuses, type EnemyStatusId, type StatusDef } from "../sim/content/statuses";
import type { PlayerStats } from "../sim/stats";
import { TICK } from "../sim/state/world";
import type { MoveState } from "../sim/state/entities";

/** Enemies are spread over a disc this wide around the player (targeting reaches 15). */
export const FIELD_RADIUS = 12;
/** Densest packing a crowd reaches (enemies per unit²; bodies are ~0.5 in radius). */
export const MAX_DENSITY = 0.7;
/** Typical distance to the aimed target, where a fan of shots can miss a lone target. */
export const AIM_DISTANCE = 6;
/** Share of casts with a line of fire on a target (docs/BALANCE.md: 91–99% visible within 15 m). */
export const TERRAIN_SIGHT = 0.95;
/** Share of close enemies not stopped by the melee height step (0–14% blocked at 3.4 m). */
export const MELEE_STEP = 0.92;
/** Share of ground enemies standing wet from puddles: the only solo source of 感电. */
export const PUDDLE_WET = 0.05;
/** Paralysis' stutter holds an enemy back about ⅔ of the time. */
const STUTTER_CONTROL = 0.66;

/** Enemy-seconds of control per application: a stop for its duration, a stutter ≈ ⅔, a slow its loss. */
export function controlSeconds(id: EnemyStatusId): number {
  const def: StatusDef = statuses[id];
  if (!def.move) return 0;
  const { move } = def;
  const share =
    move.kind === "stop" ? 1 : move.kind === "stutter" ? STUTTER_CONTROL : 1 - move.factor;
  return def.duration * share;
}

/** What the moves are hitting: the swarm around the player and the guardian. */
export interface Target {
  /** Enemies per unit² near the player. */
  density: number;
  /** Engaged enemies (inside the field); below 1 a move often has nothing to aim at. */
  living: number;
  /** Mean trash HP and body radius. */
  hp: number;
  radius: number;
  /** HP-weighted type multiplier of the current pool, per attacking type. */
  typeVs: Readonly<Record<ElementType, number>>;
  boss: { radius: number; speed: number; typeVs: Readonly<Record<ElementType, number>> };
  /** Swarm walking speed: what carries new enemies into a standing or following area. */
  speed: number;
  /** Share of time a short-reach move has an enemy inside its reach (skill). */
  melee: number;
  /** The swarm's species by pool share and the share of a pull each follows (sim/poise.ts). */
  give: readonly { share: number; give: number }[];
}

/** Applications per second of one status: across the engaged swarm (on enemies that live through the
 * hit) and on the guardian. "flinch" is a stagger (King's Rock). */
export interface Applied {
  status: EnemyStatusId | "flinch";
  swarm: number;
  boss: number;
}

export interface MoveOutput {
  /** HP removed from the swarm per second (overkill on each target discarded, DoT included). */
  useful: number;
  /** HP removed from the swarm per second by the hits themselves (no DoT): what lifesteal reads. */
  direct: number;
  /** Swarm damage per second without the per-target HP cap: what lands on an elite in the crowd. */
  raw: number;
  /** Swarm damage per second as the sim books it: a target soaks at most its HP plus one hit. */
  dealt: number;
  /** Damage per second on a lone guardian inside the move's reach. */
  single: number;
  /** Swarm hits per second that land (a dead target takes no more). */
  hits: number;
  /** Of those, the hits a target lives through (on-hit statuses roll only on these). */
  liveHits: number;
  liveDamage: number;
  /**
   * Targets per second that live through the whole cast, their hits, mean hit and the HP they have
   * left: what a status applied on them can still do (a DoT on an enemy dying in the cast never ticks).
   */
  survivors: number;
  survivorHits: number;
  survivorHit: number;
  survivorRoom: number;
  /** Swarm hits per second that crit (Thunder Stone looks for a neighbour in the crowd). */
  critHits: number;
  /** DoT per second on the guardian beside `single` (it heals nothing). */
  bossDot: number;
  /** Hits per second on the guardian. */
  bossHits: number;
  /** Status applications per second. */
  apply: Applied[];
  /** Enemy-seconds of control applied per second (a budget figure; contact reads `apply`). */
  control: number;
  /** Burn-capable damage per hit on the guardian, and burn applications per second on it. */
  bossBurnHit: number;
  bossBurnRate: number;
  /** Swarm targets per cast (enemies struck at least once). */
  targets: number;
  /** Swarm hits per second by the knockback they carry (stagger, sim/poise.ts). */
  knocks: { knock: number; hits: number }[];
}

export const blankOutput = (): MoveOutput => ({
  useful: 0,
  direct: 0,
  raw: 0,
  dealt: 0,
  single: 0,
  hits: 0,
  liveHits: 0,
  liveDamage: 0,
  survivors: 0,
  survivorHits: 0,
  survivorHit: 0,
  survivorRoom: 0,
  critHits: 0,
  bossDot: 0,
  bossHits: 0,
  apply: [],
  control: 0,
  bossBurnHit: 0,
  bossBurnRate: 0,
  targets: 0,
  knocks: [],
});

/**
 * Adds the swarm side of `targets` enemies each taking `hits` hits of `dmg` total (plus `dot` DoT)
 * per second at `rate`: the per-target HP cap, the hits that never land on a dead target, the lethal
 * hit, and the applications of `status` at `chance` per surviving hit.
 */
export function addCohort(
  out: MoveOutput,
  target: Target,
  rate: number,
  c: { targets: number; dmg: number; hits: number; dot?: number; crit?: number },
  status?: { id: EnemyStatusId | "flinch"; chance: number },
): void {
  if (c.targets <= 0 || c.hits <= 0) return;
  const { hp } = target;
  const dot = c.dot ?? 0;
  const each = c.dmg / c.hits;
  const lethal = c.dmg >= hp;
  const landed = lethal ? Math.min(c.hits, Math.max(1, hp / each + 0.5)) : c.hits;
  const live = lethal ? landed - 1 : c.hits;
  const n = rate * c.targets;
  out.useful += n * Math.min(hp, c.dmg + dot);
  out.direct += n * Math.min(hp, c.dmg);
  out.raw += n * (c.dmg + dot);
  out.dealt += n * Math.min(c.dmg + dot, hp + each);
  out.hits += n * landed;
  out.liveHits += n * live;
  out.liveDamage += n * live * each;
  out.critHits += n * landed * (c.crit ?? 0);
  if (!lethal) {
    out.survivors += n;
    out.survivorHits += n * c.hits;
    out.survivorHit += n * each;
    out.survivorRoom += n * Math.max(0, hp - c.dmg - dot);
  }
  if (status && status.chance > 0)
    addApply(out, status.id, n * (1 - (1 - Math.min(1, status.chance)) ** live), 0);
}

export function addApply(
  out: MoveOutput,
  status: EnemyStatusId | "flinch",
  swarm: number,
  boss: number,
): void {
  const entry = out.apply.find((a) => a.status === status);
  if (entry) {
    entry.swarm += swarm;
    entry.boss += boss;
  } else out.apply.push({ status, swarm, boss });
  out.control += swarm * (status === "flinch" ? 0 : controlSeconds(status));
}

/** Ticks a lingering area deals, replaying the sim's timers (life, delay, tick) at 30 Hz. */
export function areaTicks(life: number, delay: number, tick: number): number {
  let ticks = 0;
  let timer = 0;
  for (let left = life, wait = delay; ;) {
    left -= TICK;
    if (wait > 0) wait -= TICK;
    else if ((timer -= TICK) <= 0) {
      timer += tick;
      ticks += 1;
    }
    if (left <= 0) return ticks;
  }
}

/** Seconds between casts: the cooldown rounded up to whole ticks. */
export function castPeriod(cd: number): number {
  return Math.ceil(cd / TICK - 1e-9) * TICK;
}

/** One element of a cast: `copies` volleys, each `ticks` hits of `scale` × dmg on its targets. */
interface Volley {
  copies: number;
  ticks: number;
  scale: number;
  /** Swarm targets a volley collects at this density. */
  crowd: (density: number) => number;
  /** Share of volleys that land on a lone guardian, and of their ticks it stays inside for. */
  onBoss: number;
  bossTicks: number;
  /** Knockback of each hit (the sim zone's or shot's `knock`). */
  knock: number;
  /**
   * Distinct enemies the copies can reach at this density when they keep striking the same ground
   * (sprinkler jets, rod bolts): copies past it hit the same enemies again.
   */
  pool?: (density: number) => number;
  /** Its targets are other enemies than the other volleys' (spiral flames outside the rim). */
  apart?: true;
}

const clampTargets = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/**
 * Share of a fan's shots (offsets in radians from the aim, each nudged uniformly by up to ±`jitter`)
 * whose sideways miss stays inside `reach`.
 */
function fanShare(offsets: readonly number[], reach: number, jitter = 0): number {
  if (offsets.length === 0) return 1;
  const half = reach / AIM_DISTANCE;
  const share = (offset: number) =>
    jitter === 0
      ? Number(Math.abs(offset) <= half)
      : Math.max(0, Math.min(offset + jitter, half) - Math.max(offset - jitter, -half)) /
        (2 * jitter);
  return offsets.reduce((sum, offset) => sum + share(offset), 0) / offsets.length;
}

/**
 * Swarm targets a pulling area collects at density `d`: everyone inside `radius`, plus those within
 * `VORTEX.pull` radii that the drag (`VORTEX.drag` × yield) brings in during `life` seconds. One that
 * arrives at τ takes the ticks left after it (1 − τ / life); `burst` counts everyone in by the end.
 */
function pulledCrowd(target: Target, radius: number, life: number, burst: boolean) {
  const c = radius + target.radius;
  // The sim pulls bodies whose centre is within `pull` radii, so the far edge sits one body short of it.
  const far = Math.max(0, VORTEX.pull * radius - c);
  return (d: number) => {
    let area = 0;
    for (const { share, give } of target.give) {
      const travel = VORTEX.drag * give * life;
      const reach = Math.min(far, travel);
      area +=
        share *
        (burst
          ? Math.PI * (c + reach) ** 2
          : Math.PI * c * c +
            (travel > 0
              ? 2 *
                Math.PI *
                (c * reach +
                  reach ** 2 / 2 -
                  (c * reach ** 2) / 2 / travel -
                  reach ** 3 / 3 / travel)
              : 0));
    }
    return Math.max(1, d * area);
  };
}

/** Share of a lingering area's life a chasing guardian stays inside. */
function stick(reach: number, life: number, target: Target): number {
  return Math.min(1, (reach + target.boss.radius) / Math.max(0.01, target.boss.speed * life));
}

/** One cast as every archetype's model reads it. */
interface Cast {
  p: MoveParams;
  target: Target;
  /** Trash and guardian body radius. */
  rE: number;
  rB: number;
  /** Whole shots per cast. */
  n: number;
  /** Fusions: part sizes grow with the move's area like the sim (`Area.scale`). */
  scale: number;
  /** Swarm targets inside a disc of `radius`. */
  disc: (radius: number) => (d: number) => number;
  /** Swarm targets a standing or following area of `radius` reaches over `life` seconds. */
  reached: (radius: number, life: number) => (d: number) => number;
}

/** Shots beyond the targets in range fan out; on a lone guardian only the near ones connect. */
function straight({ p, rE, rB, n, disc }: Cast, body: number, bursts: boolean): Volley[] {
  const fan = [0, ...Array.from({ length: n - 1 }, (_, i) => (i + 1) * BOLT.fan)];
  const line = p.speed * p.dur * 2 * (body + rE);
  return [
    {
      copies: p.count,
      ticks: 1,
      scale: 1,
      crowd: bursts ? disc(p.area) : (d) => clampTargets(d * line, 1, 1 + p.pierce),
      onBoss: fanShare(fan, rB + body),
      bossTicks: 1,
      // An orb's target takes the burst it sets off.
      knock: bursts ? burstArea.knock : SHOT_KNOCK,
    },
  ];
}

/** Steered shots connect with their own target; a lone guardian takes every one. */
const steered = ({ p }: Cast): Volley[] => [
  {
    copies: p.count,
    ticks: 1,
    scale: 1,
    crowd: () => 1,
    onBoss: 1,
    bossTicks: 1,
    knock: SHOT_KNOCK,
  },
];

/** Per archetype, the volleys of one cast (sim/archetypes/index.ts mirrors this record). */
const volleyModels: Record<Archetype, (cast: Cast) => Volley[]> = {
  bolt: (c) => straight(c, c.p.area, false),
  orb: (c) => straight(c, ORB.radius, true),
  barrage({ p, rE, rB, n }) {
    const fan = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * BARRAGE.spread);
    const line = p.speed * p.dur * 2 * (p.area + rE);
    const { jitter } = BARRAGE;
    const aimed = fanShare(fan, rE + p.area, jitter);
    return [
      {
        copies: p.count,
        ticks: 1,
        scale: 1,
        crowd: (d) => clampTargets(d * line, aimed, 1 + p.pierce),
        onBoss: fanShare(fan, rB + p.area, jitter),
        bossTicks: 1,
        knock: SHOT_KNOCK,
      },
    ];
  },
  vortex({ p, target }) {
    const ticks = areaTicks(p.dur + VORTEX.delay, VORTEX.delay, VORTEX.tick);
    // The pull drags the light share of the crowd in from `pull` × radius; the guardian never moves.
    const stay = stick(p.area, p.dur, target);
    return [
      {
        copies: p.count,
        ticks,
        scale: 1,
        crowd: pulledCrowd(target, p.area, p.dur, false),
        onBoss: 1 / p.count,
        bossTicks: ticks * stay,
        knock: vortexArea.knock,
      },
      {
        copies: p.count,
        ticks: 1,
        scale: VORTEX.burst,
        crowd: pulledCrowd(target, p.area, p.dur, true),
        onBoss: 1 / p.count,
        bossTicks: stay,
        knock: burstArea.knock,
      },
    ];
  },
  smite: ({ p, target, disc }) => [
    {
      copies: p.count,
      ticks: 1,
      scale: 1,
      crowd: disc(p.area),
      onBoss: 1 / p.count,
      bossTicks: stick(p.area, p.dur, target),
      knock: smiteArea.knock,
    },
  ],
  cone({ p, target, rE }) {
    const ticks = areaTicks(p.dur, 0, CONE.tick);
    const sector = CONE.angle;
    return [
      {
        copies: 1,
        ticks,
        scale: 1,
        crowd: (d) => Math.max(1, d * sector * (p.area + rE) ** 2),
        onBoss: 1,
        bossTicks: ticks * stick(p.area, p.dur, target),
        knock: coneArea.knock,
      },
    ];
  },
  strike({ p, rE, n }) {
    const sector = STRIKE.angle;
    // Lashes alternate front and back, so a lone guardian takes every other one.
    return [
      {
        copies: p.count,
        ticks: 1,
        scale: 1,
        crowd: (d) => Math.max(1, d * sector * (p.area + rE) ** 2),
        onBoss: Math.ceil(n / 2) / n,
        bossTicks: 1,
        knock: strikeArea.knock,
      },
    ];
  },
  beam({ p, target, rE }) {
    const ticks = areaTicks(p.dur + BEAM.delay, BEAM.delay, BEAM.tick);
    const strip = FIELD_RADIUS * (p.area + 2 * rE);
    return [
      {
        copies: p.count,
        ticks,
        scale: 1,
        crowd: (d) => Math.max(1, d * strip),
        onBoss: 1 / p.count,
        bossTicks: ticks * stick(p.area / 2, p.dur + BEAM.delay, target),
        knock: beamArea.knock,
      },
    ];
  },
  spin({ p, disc }) {
    const ticks = areaTicks(p.dur, 0, SPIN.tick);
    return [
      {
        copies: 1,
        ticks,
        scale: 1,
        crowd: disc(p.area),
        onBoss: 1,
        bossTicks: ticks,
        knock: spinArea.knock,
      },
    ];
  },
  chain: ({ p }) => [
    {
      copies: 1,
      ticks: 1,
      scale: 1,
      // Each jump needs another enemy within `area` of the last one struck.
      crowd: (d) => 1 + p.count * Math.min(1, d * Math.PI * p.area ** 2),
      onBoss: 1,
      bossTicks: 1,
      knock: 0,
    },
  ],
  nova: ({ p, disc }) => [
    {
      copies: 1,
      ticks: 1,
      scale: 1,
      crowd: disc(p.area),
      onBoss: 1,
      bossTicks: 1,
      knock: novaArea.knock,
    },
  ],
  homing: steered,
  drain: steered,
  // The shell bursts where the guardian stood when it was thrown.
  lob: ({ p, target, disc }) => [
    {
      copies: p.count,
      ticks: 1,
      scale: 1,
      crowd: disc(p.area),
      onBoss: 1,
      bossTicks: stick(p.area, LOB.flight, target),
      knock: burstArea.knock,
    },
  ],
  wave({ p, rE, rB, n }) {
    const fan = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * WAVE.fan);
    const swept = 2 * (p.area + rE) * p.speed * p.dur;
    return [
      {
        copies: p.count,
        ticks: 1,
        scale: 1,
        crowd: (d) => Math.max(1, d * swept),
        onBoss: fanShare(fan, rB + p.area),
        bossTicks: 1,
        knock: WAVE.knock,
      },
    ];
  },
  bloom({ p, target, rE, rB, scale, disc }) {
    const f = BLOOM;
    const life = f.delay + f.life * p.dur;
    const ticks = areaTicks(life, f.delay, f.tick);
    const leaf = f.leafRadius * scale;
    // Leaves start along the beam (`reach` long) and fly sideways through the crowd; a lone
    // guardian on the beam is in the path of the share starting within its body.
    const leafLine = f.leafSpeed * f.leafLife * 2 * (leaf + rE);
    return [
      {
        copies: 1,
        ticks,
        scale: f.beamDmg,
        crowd: (d) => Math.max(1, d * f.reach * (p.area + 2 * rE)),
        onBoss: 1,
        bossTicks: ticks * stick(p.area / 2, life, target),
        knock: BLOOM.beamKnock,
      },
      {
        copies: f.leaves + Math.min(f.leavesMax, f.leavesPerCount * Math.floor(p.count)),
        ticks: 1,
        scale: f.leafDmg,
        crowd: (d) => clampTargets(d * leafLine, 0, 1 + f.leafPierce),
        onBoss: Math.min(1, (2 * (rB + leaf)) / (BLOOM.leafSpan * f.reach)),
        bossTicks: 1,
        knock: SHOT_KNOCK,
      },
      // The petals burst where the beam ends, past a guardian it was aimed at.
      {
        copies: 1,
        ticks: 1,
        scale: f.flowerDmg,
        crowd: disc(f.flower * scale),
        onBoss: 0,
        bossTicks: 0,
        knock: burstArea.knock,
      },
    ];
  },
  firestorm({ p, target, rE, scale }) {
    const f = FIRESTORM;
    const life = f.delay + p.dur;
    const ticks = areaTicks(life, f.delay, f.tick);
    const mean = p.area * (1 + f.growth / 2);
    const spirals = Math.floor((life - f.jetFor) / f.spiralTick) + 1;
    const jetTicks = Math.round(f.jetFor / f.jetTick);
    const blast = f.blast * scale;
    return [
      {
        copies: 1,
        ticks,
        scale: f.vortexDmg,
        crowd: pulledCrowd(target, mean, p.dur, false),
        onBoss: 1,
        bossTicks: ticks * stick(mean, p.dur, target),
        knock: 0,
      },
      {
        copies: 1,
        ticks: jetTicks,
        scale: f.jetDmg,
        crowd: (d) => Math.max(1, d * f.reach * 2 * (f.jetWidth * scale + rE)),
        onBoss: 1,
        bossTicks: jetTicks,
        knock: FIRESTORM.jetKnock,
      },
      // Spiral flames land outside the rim, mostly on what the pull has not reached yet.
      {
        copies: spirals * f.arms,
        ticks: 1,
        scale: f.spiralDmg,
        crowd: (d) => d * Math.PI * (f.spiralRadius * scale + rE) ** 2,
        apart: true,
        onBoss: 0,
        bossTicks: 0,
        knock: FIRESTORM.spiralKnock,
      },
      {
        copies: 1,
        ticks: 1,
        scale: f.blastDmg,
        // The pull has packed the light share of the crowd into the vortex.
        crowd: pulledCrowd(target, mean, p.dur, true),
        onBoss: 1,
        bossTicks: stick(blast, life, target),
        knock: burstArea.knock,
      },
    ];
  },
  sprinkler({ p, rE, rB, scale, disc, reached }) {
    const f = SPRINKLER;
    const jets = f.jets + Math.min(f.jetsMax, Math.floor(p.count));
    const ticks = Math.round(p.dur / f.jetTick);
    const half = f.jetWidth * scale;
    // Each tick a jet strikes what stands in its lane right now; the lanes sweep the whole disc.
    const reachesBoss = p.area + rB >= AIM_DISTANCE;
    return [
      {
        copies: 1,
        ticks: 1,
        scale: f.shellDmg,
        crowd: disc(f.shell * scale),
        onBoss: 0,
        bossTicks: 0,
        knock: f.shellKnock,
      },
      {
        copies: jets * ticks,
        ticks: 1,
        scale: f.jetDmg,
        crowd: (d) => d * p.area * 2 * (half + rE),
        pool: reached(p.area, p.dur),
        onBoss: reachesBoss ? Math.min(1, (2 * (half + rB)) / (2 * Math.PI * AIM_DISTANCE)) : 0,
        bossTicks: 1,
        knock: f.jetKnock,
      },
      {
        copies: 1,
        ticks: 1,
        scale: f.splashDmg,
        crowd: disc(f.splash * scale),
        onBoss: 0,
        bossTicks: 0,
        knock: burstArea.knock,
      },
    ];
  },
  rod({ p, target, rE, scale, disc, reached }) {
    const f = ROD;
    const life = f.flight + p.dur;
    const strikes = areaTicks(life, f.flight, f.tick);
    const bolts = f.bolts + Math.min(f.boltsMax, Math.floor(p.count));
    return [
      {
        copies: strikes,
        ticks: 1,
        scale: f.boltDmg,
        crowd: (d) => clampTargets(d * Math.PI * (p.area + rE) ** 2, 1, bolts),
        pool: reached(p.area, p.dur),
        onBoss: 1,
        bossTicks: stick(p.area, p.dur, target),
        knock: ROD.boltKnock,
      },
      {
        copies: 1,
        ticks: 1,
        scale: f.blastDmg,
        crowd: disc(f.blast * scale),
        onBoss: 1,
        bossTicks: stick(f.blast * scale, life, target),
        knock: burstArea.knock,
      },
    ];
  },
};

function volleys(def: MoveDef, p: MoveParams, target: Target): Volley[] {
  const rE = target.radius;
  const disc = (radius: number) => (d: number) => Math.max(1, d * Math.PI * (radius + rE) ** 2);
  // Enemies a standing (rod) or following (sprinkler) area reaches over its life: those inside it,
  // plus those the swarm's walk carries across it, at the swarm's speed relative to it.
  const reached = (radius: number, life: number) => (d: number) =>
    disc(radius)(d) + d * 2 * (radius + rE) * target.speed * life;
  return volleyModels[def.archetype]({
    p,
    target,
    rE,
    rB: target.boss.radius,
    n: Math.max(1, Math.round(p.count)),
    scale: p.area / def.area,
    disc,
    reached,
  });
}

/** Expected damage multiplier from crits for a total crit chance and the crit multiplier. */
export function critFactor(chance: number, multiplier: number): number {
  return 1 + Math.min(1, chance) * (multiplier - 1);
}

/** Share of the guardian's or an elite's HP in the swarm's damage the elite bonus sees (elites are few). */
const ELITE_SHARE = 0.05;

/**
 * The owner's damage factor for a move against the swarm and the guardian: the damage stat, the
 * move's type and category factors, the elite factor (all of the guardian, a small share of the
 * swarm) and the super-effective factor on the share of the pool weak to the move.
 */
function damageFactors(def: MoveDef, stats: PlayerStats, target: Target): [number, number] {
  const { hit } = stats;
  const base = stats.damage * (hit[def.type] ?? 1) * (hit[def.category] ?? 1);
  const elite = hit.elite ?? 1;
  const strong = hit.superEffective ?? 1;
  const weakShare = (vs: number) => Math.max(0, Math.min(1, (vs - 1) / 0.4));
  const swarm =
    base *
    (1 + ELITE_SHARE * (elite - 1)) *
    (1 + weakShare(target.typeVs[def.type]) * (strong - 1));
  const boss = base * elite * (1 + weakShare(target.boss.typeVs[def.type]) * (strong - 1));
  return [swarm, boss];
}

/** Swarm and guardian output of one learned move under the player's current stats. */
/**
 * `bonk` is Bonk!'s expected factor on each direct hit (sim/triggers/onHit.ts), applied before the
 * per-target HP cap like a crit.
 */
export function moveOutput(
  state: MoveState,
  stats: PlayerStats,
  target: Target,
  bonk = 1,
): MoveOutput {
  const def = moves[state.id];
  const p = moveParams(state, stats);
  const short = archetypes[def.archetype].shortReach;
  const reachable = TERRAIN_SIGHT * (short ? MELEE_STEP * target.melee : 1);
  // The guardian is always there to aim at; the swarm only when someone is in range.
  const bossRate = reachable / castPeriod(p.cd);
  const rate = bossRate * Math.min(1, target.living);
  const [swarmFactor, bossFactor] = damageFactors(def, stats, target);
  const crits = critFactor(p.crit + stats.crit, stats.critDamage);
  const base = p.dmg * swarmFactor * crits * bonk;
  const bossBase = p.dmg * bossFactor * crits * bonk;
  const shock =
    def.type === "electric"
      ? PUDDLE_WET *
        (reactions.shock.bonus +
          reactions.shock.effect.share *
            Math.min(
              reactions.shock.effect.limit,
              target.density * Math.PI * reactions.shock.effect.radius ** 2,
            ))
      : 0;
  const hit = base * target.typeVs[def.type] * (1 + shock);
  const bossHit = bossBase * target.boss.typeVs[def.type];
  const chance = def.status ? p.statusChance : 0;
  const crit = Math.min(1, p.crit + stats.crit);
  const out = blankOutput();
  out.bossBurnHit = def.status === "burn" ? bossHit : 0;
  const burnPerHit =
    def.status === "burn"
      ? statuses.burn.dotShare * stats.statusDamage * statuses.burn.duration * stats.duration * hit
      : 0;
  const density = Math.min(MAX_DENSITY, target.density);
  // Distinct swarm enemies each volley strikes per cast, never more than are engaged.
  const available = Math.max(1, target.living);
  const struck = volleys(def, p, target).map((v) => {
    const reached = v.copies * v.crowd(density);
    const n = Math.min(reached, v.pool?.(density) ?? Infinity, available);
    return { v, n, ticks: n > 0 ? (v.ticks * reached) / n : 0 };
  });
  // The volleys of one cast strike nested cohorts of the same enemies (the vortex's ticks, then its
  // burst on everyone pulled in): each enemy has one HP budget for the whole cast.
  const shared = struck.filter((s) => !s.v.apart && s.n > 0).sort((x, y) => x.n - y.n);
  const cohorts = [
    ...shared.map((s, i) => ({ width: s.n - (i > 0 ? shared[i - 1]!.n : 0), on: shared.slice(i) })),
    ...struck.filter((s) => s.v.apart && s.n > 0).map((s) => ({ width: s.n, on: [s] })),
  ];
  for (const { width, on } of cohorts) {
    const hits = on.reduce((sum, s) => sum + s.ticks, 0);
    const dmg = on.reduce((sum, s) => sum + s.ticks * s.v.scale * hit, 0);
    const applied = 1 - (1 - chance) ** hits;
    const strongest = Math.max(...on.map((s) => s.v.scale));
    addCohort(
      out,
      target,
      rate,
      { targets: width, dmg, hits, dot: burnPerHit * strongest * applied, crit },
      def.status ? { id: def.status, chance } : undefined,
    );
  }
  const reachedHits = struck.reduce((sum, s) => sum + rate * s.n * s.ticks, 0);
  const landedShare = reachedHits > 0 ? out.hits / reachedHits : 0;
  for (const s of struck)
    out.knocks.push({ knock: s.v.knock, hits: rate * s.n * s.ticks * landedShare });
  for (const { v } of struck) {
    const onBoss = bossRate * v.copies * v.onBoss * v.bossTicks;
    out.single += onBoss * v.scale * bossHit;
    out.bossHits += onBoss;
    out.bossBurnRate += onBoss * chance;
    if (def.status) addApply(out, def.status, 0, onBoss * chance);
  }
  out.targets = Math.max(0, ...struck.map((s) => s.n));
  return out;
}

/** Bonk!'s expected factor on a direct hit (sim/triggers/onHit.ts: never on secondary hits). */
export function bonkFactor(stats: PlayerStats): number {
  let factor = 1;
  for (const { def } of stats.triggers)
    if (def.kind === "bonk") factor *= 1 + def.chance * (def.mult - 1);
  return factor;
}

/** A zap trigger (Static): the nearest enemy every few seconds, with its status. */
export function zapOutput(
  zap: Resolved<Extract<TriggerDef, { kind: "zap" }>>,
  stats: PlayerStats,
  target: Target,
  bonk = 1,
): MoveOutput {
  const bossRate = TERRAIN_SIGHT / zap.seconds;
  const rate = bossRate * Math.min(1, target.living);
  const base = zap.dmg * stats.damage * critFactor(stats.crit, stats.critDamage) * bonk;
  const hit = base * target.typeVs[zap.type];
  const out = blankOutput();
  addCohort(out, target, rate, { targets: 1, dmg: hit, hits: 1, crit: Math.min(1, stats.crit) });
  addApply(out, zap.status, rate, 0);
  out.single = bossRate * base * target.boss.typeVs[zap.type];
  out.bossHits = bossRate;
  out.targets = 1;
  return out;
}
