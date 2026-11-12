// Expected value of every trigger kind (content/triggers.ts) for the analytical model. A `Record`, so
// a new kind fails to compile until it is modelled here. A model may add a damage source (`output`,
// merged like a move), adjust the build's totals (`scale`: factors and additions read off them), give
// HP back per second (`sustain`), or say what a scaling trigger's measure is in a run (`measure`).

import { statuses, type EnemyStatusId, type StatusDef } from "../sim/content/statuses";
import type { Measure, ResolvedTrigger, TriggerKind } from "../sim/content/triggers";
import { DICE_FACES, diceKey, items } from "../sim/content/items";
import { moves } from "../sim/content/moves";
import { statusSources } from "../sim/upgrades";
import { procDamage } from "../sim/triggers/kit";
import { STREAK_GAP } from "../sim/content/params/combat";
import type { ElementType } from "../sim/content/elements";
import type { PlayerStats } from "../sim/stats";
import type { Player } from "../sim/state/entities";
import type { BuildOutput } from "./model";
import {
  addApply,
  bonkFactor,
  addCohort,
  AIM_DISTANCE,
  blankOutput,
  MAX_DENSITY,
  TERRAIN_SIGHT,
  zapOutput,
  type MoveOutput,
  type Target,
} from "./output";

type Of<K extends TriggerKind> = Extract<ResolvedTrigger, { kind: K }>;

/** Changes to a build's totals: additions read off the unscaled totals, then factors. */
export interface Scale {
  swarm?: number;
  single?: number;
  /** A proc's own output, merged like a secondary damage source. */
  add?: MoveOutput;
}

/**
 * What the build actually did this second once its output was split between the guardian, elites
 * and the swarm: the input of every heal (sim `afterHit` heals from HP removed by hits, not DoT).
 */
export interface Ledger {
  stats: PlayerStats;
  /** HP removed per second by hits on the swarm, elites and the guardian, partners' included. */
  removed: number;
  /** Kills per second (swarm and elites). */
  kills: number;
  /** Landed hits per second by the type of the move that landed them (swarm and guardian). */
  typeHits: Partial<Record<ElementType, number>>;
  /** Share of the living HP mass below a share of max HP, and at full HP. */
  below: (share: number) => number;
  full: number;
}

/** What a run looks like at this point, for scaling triggers' measures. */
export interface MeasureEnv {
  kills: number;
  /** Kills per second now. */
  killRate: number;
  /** Hits landing on the player per second now. */
  hurtRate: number;
  /** HP share. */
  frac: number;
  stats: PlayerStats;
  /** The form's own speed. */
  formSpeed: number;
}

export interface TriggerModel<K extends TriggerKind> {
  /** A damage source of its own; `secondary` unless the sim's hit is a direct one (Static's zap). */
  output?(trigger: Of<K>, stats: PlayerStats, target: Target, player: Player): MoveOutput;
  direct?: true;
  scale?(trigger: Of<K>, out: BuildOutput, target: Target, player: Player): Scale;
  sustain?(trigger: Of<K>, ledger: Ledger): number;
  measure?(trigger: Of<K>, env: MeasureEnv): number;
}

/** Seconds between dashes a kiting player spends (one charge comes back per `DASH_COOLDOWN`). */
const DASH_EVERY = 3;
/** Seconds between ultimates (BALANCE.md 终极技: about 70 s). */
const ULT_EVERY = 70;
/** Share of a fight a kiting player stands still. */
const STILL_SHARE = 0.1;

/**
 * Share of kills that carry a burst's required status when the build applies it: moves that inflict
 * it as they hit keep about half the crowd burning; an item's on-hit chance a smaller share; a status
 * that only builds up (freeze) a small one.
 */
function requiredShare(requires: readonly EnemyStatusId[], player: Player): number {
  const sources = statusSources(player);
  let share = 0;
  for (const status of requires) {
    if (!sources.has(status)) continue;
    const fromMoves = player.moves.some((state) => moves[state.id].status === status);
    const def: StatusDef = statuses[status];
    share = Math.max(share, def.move?.kind === "stop" ? 0.1 : fromMoves ? 0.5 : 0.2);
  }
  return share;
}
/** Touches per second a crowd lands on a kiting player, and the extra enemies a thorns spread reaches. */
const TOUCHES = 0.5;
const SPREAD_TARGETS = 2;

const kills = (out: BuildOutput, target: Target) => out.useful / Math.max(1, target.hp);
/** Swarm enemies an item burst of `radius` reaches around a point (bodies count: sim/triggers/kit.ts). */
const inDisc = (target: Target, radius: number) =>
  Math.min(MAX_DENSITY, target.density) * Math.PI * (radius + target.radius) ** 2;
/** Enemies in a burst centred on one of them (at least the one struck). */
const crowdIn = (target: Target, radius: number) =>
  Math.max(1, Math.min(target.living, inDisc(target, radius)));
/** Other living enemies around a victim within `radius` (the victim itself is not one). */
const neighbours = (target: Target, radius: number) =>
  Math.min(Math.max(0, target.living - 1), inDisc(target, radius));
const measures: Record<Measure, (env: MeasureEnv) => number> = {
  kills: (env) => env.kills,
  // A streak never breaks once kills come faster than one per gap: count a minute of them then.
  streak: (env) => env.killRate * (env.killRate * STREAK_GAP > 1 ? 60 : STREAK_GAP),
  unhurt: (env) => 1 / Math.max(0.05, env.hurtRate),
  speed: (env) => env.stats.speed / env.formSpeed - 1,
  armor: (env) => env.stats.armor,
  missingHp: (env) => 1 - env.frac,
};

/** An area proc of `hit` on `targets` swarm enemies `rate` times a second, with its status. */
function procOutput(
  rate: number,
  targets: number,
  hit: number,
  target: Target,
  status?: { id: EnemyStatusId; chance: number },
  knock = 0,
): MoveOutput {
  const out = blankOutput();
  addCohort(out, target, rate, { targets, dmg: hit, hits: 1 }, status);
  if (knock > 0) out.knocks.push({ knock, hits: out.hits });
  out.targets = targets;
  return out;
}

/** Status on a guardian at `rate` applications a second (refresh: `apply`'s occupancy reads these). */
const bossOnly = (out: MoveOutput, status: EnemyStatusId | undefined, rate: number) => {
  if (status) addApply(out, status, 0, rate);
};

export const triggerModels: { [K in TriggerKind]: TriggerModel<K> } = {
  healOnHit: {
    sustain: (t, l) =>
      Math.min(t.perSecond, l.typeHits[t.type] ?? 0) * t.heal * l.stats.maxHp * l.stats.healing,
  },
  // The contact status rides the thorns hit, which the model counts through `stats.thorns`.
  contactStatus: {},
  zap: {
    output: (t, stats, target) => zapOutput(t, stats, target, bonkFactor(stats)),
    direct: true,
  },
  // Sitrus Berry lifts only the HP under its line: the HP process steps it (model.ts `liftsOf`).
  healBelow: {},
  // Lum Berry heals when not full; heals past full are capped by the HP process itself.
  healEvery: {
    sustain: (t, l) => (t.heal * l.stats.maxHp * l.stats.healing) / t.every,
  },
  healOnKill: {
    sustain: (t, l) => l.kills * t.chance * t.heal * l.stats.maxHp * l.stats.healing,
  },
  inflictOnHit: {
    // Direct hits the target lives through only (sim/triggers/onHit.ts); what an application can
    // still do is on the enemies that outlive the cast.
    scale(t, out) {
      const odds = Math.min(1, t.chance * out.stats.statusChance);
      const { primary } = out;
      const add = blankOutput();
      const onSurvivor =
        primary.survivors > 0 ? 1 - (1 - odds) ** (primary.survivorHits / primary.survivors) : 0;
      addApply(add, t.status, primary.survivors * onSurvivor, primary.bossHits * odds);
      const def: StatusDef | undefined = t.status === "flinch" ? undefined : statuses[t.status];
      if (def?.dotShare) {
        const seconds = def.duration * out.stats.duration;
        const power = def.dotShare * out.stats.statusDamage;
        // Swarm: one DoT (refresh keeps the strongest) per survivor, up to the HP it has left.
        const each = primary.survivors > 0 ? primary.survivorHit / primary.survivors : 0;
        add.useful =
          add.raw =
          add.dealt =
            Math.min(primary.survivorRoom, primary.survivors * onSurvivor * power * seconds * each);
        // The guardian keeps the strongest application refreshed; a burn is the build's one burn.
        const perHit = primary.bossHits > 0 ? primary.single / primary.bossHits : 0;
        if (t.status === "burn") {
          add.bossBurnHit = perHit;
          add.bossBurnRate = primary.bossHits * odds;
        } else add.bossDot = power * perHit * (1 - Math.exp(-primary.bossHits * odds * seconds));
      }
      return { add };
    },
  },
  // Bonk! multiplies each direct hit before the HP cap (output.ts `bonkFactor`); Razor Fang lowers
  // the HP a kill needs (model.ts `buildOutput`).
  bonk: {},
  execute: {},
  critStrike: {
    scale(t, out, target, player) {
      // A direct crit sends a bolt to another enemy in range, if there is one.
      const other = 1 - Math.exp(-neighbours(target, t.range));
      const strikes = Math.min(t.perSecond, out.primary.critHits * other);
      const hit = procDamage(player, t.dmg) * out.stats.damage * target.typeVs[t.type];
      return {
        add: procOutput(strikes, 1, hit, target, { id: t.status, chance: t.statusChance }),
      };
    },
  },
  burstOnKill: {
    scale(t, out, target, player) {
      const bursts =
        kills(out, target) * t.chance * (t.requires ? requiredShare(t.requires, player) : 1);
      const hit = procDamage(player, t.dmg) * out.stats.damage * target.typeVs[t.type];
      const status = t.status ? { id: t.status, chance: t.statusChance } : undefined;
      return { add: procOutput(bursts, neighbours(target, t.radius), hit, target, status) };
    },
    sustain: (t, l) => (t.heal ? l.kills * t.chance * t.heal * l.stats.maxHp * l.stats.healing : 0),
  },
  strike: {
    output(t, stats, target, player) {
      const period = TERRAIN_SIGHT / t.every;
      const jackpot = 1 + (t.jackpot ?? 0) * ((t.jackpotMult ?? 1) - 1);
      const base = procDamage(player, t.dmg) * stats.damage * jackpot;
      const hit = base * target.typeVs[t.type];
      const engaged = Math.min(1, target.living);
      // Where the strikes land (sim/triggers/periodic.ts): on the player, on the strongest (the
      // guardian whenever it is up), on the nearest or on random enemies in range.
      const self = t.target === "self";
      // Never more strikes than enemies in reach; one on the player hits whoever is around it.
      const strikes = self ? 1 : Math.min(t.count, Math.max(1, target.living));
      const targets = self
        ? Math.min(target.living, inDisc(target, t.radius))
        : crowdIn(target, t.radius) * engaged;
      const status = t.status ? { id: t.status, chance: t.statusChance } : undefined;
      const out = procOutput(period * strikes, targets, hit, target, status, t.knock ?? 0);
      const onBoss =
        t.target === "strongest"
          ? 1
          : self
            ? Math.min(1, (t.radius + target.boss.radius) / AIM_DISTANCE)
            : Math.min(1, t.count / (target.living + 1));
      out.single = period * onBoss * base * target.boss.typeVs[t.type];
      out.bossHits = period * onBoss;
      bossOnly(out, t.status, out.bossHits * t.statusChance);
      return out;
    },
  },
  // The guardian is always the strongest: it carries the mark whenever it is there.
  markStrongest: { scale: (t) => ({ single: 1 + t.bonus }) },
  spreadStatus: {
    // Passing a burn on extends its uptime across the crowd: a share of the build's burn again.
    scale: (t, out) => (out.bossBurnHit > 0 ? { swarm: 1 + 0.1 * t.share } : {}),
  },
  contactSpread: {
    scale: (_t, out, target) => ({
      add: procOutput(TOUCHES, SPREAD_TARGETS, out.stats.thorns * out.stats.damage, target),
    }),
  },
  scaling: { measure: (t, env) => measures[t.measure](env) },
  // Uptime: the share of time the buff runs (setMeasures writes it as `:share`; the fold scales by it).
  buff: {
    measure(t, env) {
      const every = {
        hurt: 1 / Math.max(0.05, env.hurtRate * t.chance),
        dash: DASH_EVERY / t.chance,
        ult: ULT_EVERY,
        still: 0,
      }[t.on];
      if (t.on === "still") return STILL_SHARE;
      return Math.min(1, t.seconds / Math.max(every, t.seconds + t.cooldown));
    },
  },
  statusOnHurt: {
    scale(t, _out, target) {
      const add = blankOutput();
      // Its own `seconds`, as that many default-length applications.
      const length = t.seconds / statuses[t.status].duration;
      addApply(add, t.status, (length * crowdIn(target, t.radius)) / Math.max(t.cooldown, 2), 0);
      return { add };
    },
  },
  // Lethal saves, Enigma Berry and Guard Spec act on the HP process (model.ts `defenceOf`).
  lethalSave: {},
  dashBurst: {
    output(t, stats, target, player) {
      const base = (procDamage(player, t.dmg) + (t.armorScale ?? 0) * stats.armor) * stats.damage;
      const hit = base * target.typeVs[t.type];
      const crowd = crowdIn(target, t.radius) * Math.min(1, target.living);
      return procOutput(1 / DASH_EVERY, crowd, hit, target, undefined, t.knock);
    },
  },
  overhealStore: {
    // About half the regen and lifesteal overflows at full HP; the store fires it on one target.
    output(t, stats, target) {
      const flow = 0.5 * (stats.regen + stats.lifesteal * 10) * stats.healing;
      const hit = flow * t.perHp * stats.damage * t.every;
      const out = procOutput(1 / t.every, 1, hit, target);
      out.single = flow * t.perHp * stats.damage;
      out.bossHits = 1 / t.every;
      return out;
    },
  },
  overhealShield: {},
  block: {},
};

export function modelOf<K extends TriggerKind>(trigger: Of<K>): TriggerModel<K> {
  return triggerModels[trigger.kind] as TriggerModel<K>;
}

/**
 * Writes each scaling trigger's measure into `Player.fx` (keys as the sim's), so the fold sizes the
 * modifier as a run at `env` would.
 */
export function setMeasures(player: Player, env: Omit<MeasureEnv, "stats">, stats: PlayerStats) {
  // Loaded Dice: the model's picks roll nothing (world.ts `pickEffects`); give each level a face in
  // turn so a die counts as the mean face.
  for (const owned of player.items)
    if (items[owned.id].onPick?.roll)
      for (let level = 1; level <= owned.level; level++)
        player.fx[diceKey(level)] ??= (level - 1) % DICE_FACES.length;
  for (const { key, def } of stats.triggers) {
    if (def.kind === "scaling") player.fx[key] = modelOf(def).measure!(def, { ...env, stats });
    if (def.kind === "buff") {
      player.fx[key] = 1;
      player.fx[`${key}:share`] = modelOf(def).measure!(def, { ...env, stats });
    }
  }
}
