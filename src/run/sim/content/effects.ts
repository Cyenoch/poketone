// Shapes every stat source is written in (items, abilities, lab, training, level, evolution) and the
// card text derived from them. The fold is `sim/stats.ts`; triggers are `content/triggers.ts`.

import type { AbilityId } from "./abilities";
import { typeNames, type ElementType } from "./elements";
import type { MoveCategory } from "./moves";
import type { ItemId } from "./items";
import type { TriggerDef } from "./triggers";
import { powInt } from "../math";

/** Key order is the stats sheet's order. */
export const statIds = [
  "maxHp",
  "speed",
  "damage",
  "cooldown",
  "area",
  "crit",
  "regen",
  "pickup",
  "xp",
  "armor",
  "thorns",
  "lifesteal",
  /** Multiplier on 星星沙子 earned. */
  "stardust",
  /** Ultimate charge rate (sim/ultimates). */
  "ultCharge",
  /** Raises the rarity odds of upgrade cards (upgrades.ts `rarityOdds`). */
  "luck",
  /** Multiplier on every heal (regen, lifesteal, drain, berries, triggers). */
  "healing",
  /** Max shield HP: taken before HP, refilled after a quiet spell (params/player.ts `SHIELD`). */
  "shield",
  /** Chance to take no damage from a hit. */
  "evasion",
  /** Multiplier on damage taken, after armor. */
  "damageTaken",
  /** A crit's damage multiplier. */
  "critDamage",
  /** Extra shots, strikes or pulses per cast, added to every move's count. */
  "projectiles",
  /** Multiplier on shot speed. */
  "projSpeed",
  /** Multiplier on how long moves' areas and the statuses they inflict last. */
  "duration",
  /** Multiplier on moves' chance to inflict their status. */
  "statusChance",
  /** Multiplier on burn and poison damage per second. */
  "statusDamage",
  /** Dashes that can be chained before the cooldown is needed. */
  "dashCharges",
  /** Multiplier on partners' damage. */
  "partnerDamage",
  /** Multiplier on spawns anchored on this player (director.ts). */
  "spawns",
  /** Multiplier on the chance that a spawn anchored on this player is an elite. */
  "elites",
  /** Multiplier on how often partners attack. */
  "partnerRate",
  /** Multiplier on a partner's rest after 护主. */
  "guardRest",
  /** Extra enemies every shot passes through. */
  "pierce",
] as const;

export type StatId = (typeof statIds)[number];

/** How a stat combines its modifiers: (base + Σadd) × (1 + Σpct) × Πmul ÷ Πdiv + Σextra. */
export type ModifierOp = "add" | "pct" | "mul" | "div" | "extra";

/** Blaze and Torrent Shell's low-HP bonus turns on below this share of max HP. */
export const LOW_HP = 0.4;

/**
 * Conditions a damage modifier can wait on per hit. They never count in the stat: each one folds into
 * its own factor (`PlayerStats.hit`), applied in combat.ts after type effectiveness — a move's type
 * (Blaze, type boosters), its category, an elite or guardian target, a super-effective hit.
 */
export type HitCondition =
  | ElementType
  | MoveCategory
  | "elite"
  | "superEffective"
  /** The target is held: a `control` status or a stagger (Binding Band). */
  | "held"
  /** Once per distinct status on the target, up to `PER_STATUS_CAP` (Full Heal). */
  | "perStatus";

/** Most statuses a `perStatus` modifier counts on one target. */
export const PER_STATUS_CAP = 5;

/**
 * A modifier that only holds some of the time: below `LOW_HP`, while the line can still evolve
 * (Eviolite), or on some hits (`HitCondition`).
 */
export type Condition = "lowHp" | "canEvolve" | HitCondition;

export const playerConditions = ["lowHp", "canEvolve"] as const satisfies readonly Condition[];
export const isHitCondition = (when: Condition): when is HitCondition =>
  !(playerConditions as readonly Condition[]).includes(when);

export type ModifierSource =
  | { kind: "evolution" }
  /** `count` is the player level. */
  | { kind: "level"; count: number }
  | { kind: "item"; item: ItemId; count: number }
  | { kind: "ability"; ability: AbilityId }
  | { kind: "lab" }
  | { kind: "train"; count: number };

/** One change to one stat, as the fold applies it: `value` is the operand (+0.1, ×0.93, ÷1.04). */
export interface Modifier {
  stat: StatId;
  op: ModifierOp;
  value: number;
  when?: Condition;
  source: ModifierSource;
}

/** A modifier as content writes it: `value` per level (items, lab, training) or per stage (abilities). */
export interface ModifierDef<V> {
  stat: StatId;
  op: ModifierOp;
  value: V;
  when?: Condition;
}

/** Indexed by `Player.stage`. */
export type PerStage = readonly number[];

export interface EffectDef<V> {
  modifiers: readonly ModifierDef<V>[];
  /** `Scaled` values step with the source: per stage (abilities) or per level (items). */
  triggers?: readonly TriggerDef[];
}

/** `per` taken `count` times: additive ops sum, `mul` compounds (0.93ⁿ), `div` divides by 1 + per·n. */
export function atLevel(op: ModifierOp, per: number, count: number): number {
  if (op === "mul") return powInt(per, count);
  if (op === "div") return 1 + per * count;
  return per * count;
}

/** Card wording per stat; `percent` stats read their added value as a share (+0.1 → +10%). */
const statWords: Record<StatId, { name: string; percent?: true }> = {
  maxHp: { name: "最大 HP" },
  speed: { name: "移动速度" },
  damage: { name: "伤害", percent: true },
  cooldown: { name: "冷却", percent: true },
  area: { name: "范围", percent: true },
  crit: { name: "会心率", percent: true },
  regen: { name: "每秒回复" },
  pickup: { name: "拾取范围" },
  xp: { name: "经验", percent: true },
  armor: { name: "护甲" },
  thorns: { name: "接触反伤" },
  lifesteal: { name: "吸血", percent: true },
  stardust: { name: "星星沙子", percent: true },
  ultCharge: { name: "终极技充能", percent: true },
  luck: { name: "幸运" },
  healing: { name: "治疗效果", percent: true },
  shield: { name: "护盾" },
  evasion: { name: "闪避", percent: true },
  damageTaken: { name: "受到的伤害", percent: true },
  critDamage: { name: "会心伤害", percent: true },
  projectiles: { name: "弹丸" },
  projSpeed: { name: "弹速", percent: true },
  duration: { name: "持续时间", percent: true },
  statusChance: { name: "异常几率", percent: true },
  statusDamage: { name: "异常伤害", percent: true },
  dashCharges: { name: "冲刺次数" },
  partnerDamage: { name: "同伴伤害", percent: true },
  spawns: { name: "敌人数量", percent: true },
  elites: { name: "精英出现", percent: true },
  partnerRate: { name: "同伴出手速度", percent: true },
  guardRest: { name: "护主间隔", percent: true },
  pierce: { name: "穿透" },
};

const conditionWords = {
  lowHp: `HP 低于 ${LOW_HP * 100}% 时`,
  canEvolve: "还能进化时",
  ...(Object.fromEntries(
    Object.entries(typeNames).map(([type, name]) => [type, `${name}属性`]),
  ) as Record<ElementType, string>),
  physical: "物理招式",
  special: "特殊招式",
  elite: "对精英与首领",
  superEffective: "效果绝佳时",
  held: "对被控制的敌人",
  perStatus: "目标每有一种异常状态，",
} satisfies Record<Condition, string>;

/** Short condition tags for the stats panel (HP<40%, 火属性). */
export const conditionTags: Record<Condition, string> = {
  ...conditionWords,
  lowHp: `HP<${LOW_HP * 100}%`,
  canEvolve: "未完全进化",
  elite: "精英",
  superEffective: "效果绝佳",
  held: "被控制",
  perStatus: "每种异常",
};

const number = (value: number) => String(Number(value.toFixed(1)));
const percent = (share: number) => `${number(share * 100)}%`;
const signed = (value: number, text: (magnitude: number) => string) =>
  `${value < 0 ? "-" : "+"}${text(Math.abs(value))}`;

/** "伤害 +10%", "冷却 -7%", "HP 低于 40% 时伤害 +40%". */
export function modifierText({ stat, op, value, when }: ModifierDef<number>): string {
  const words = statWords[stat];
  const amount =
    op === "add" || op === "extra"
      ? signed(value, words.percent ? percent : number)
      : signed(op === "pct" ? value : op === "mul" ? value - 1 : 1 / value - 1, percent);
  return `${when ? conditionWords[when] : ""}${words.name} ${amount}`;
}
