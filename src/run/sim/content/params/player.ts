// The player's base stats and growth rules. Stats stack as
// (base + Σadd) × (1 + Σpct) × Πmul ÷ Πdiv + Σextra (content/effects.ts, src/run/sim/content/README.md「属性怎么算」).
// Formulas stay in stats.ts (playerStats, areaGrowth, armorFactor); world.ts applies START, REVIVE and
// the walk ramps; hurt.ts the hit invulnerability and shield; evolution.ts EVOLVE_INVULNERABLE.

import type { ModifierDef, StatId } from "../effects";

/** A crit's damage multiplier before any item (the `critDamage` stat's base). */
export const CRIT_MULTIPLIER = 2;

/** Each level past the first. */
export const LEVEL: ModifierDef<number> = { stat: "damage", op: "add", value: 0.02 };

/**
 * Every stat before any source; max HP and speed come from the line's starting form. `pickup` and
 * `stardust` belong to the economy (params/economy.ts).
 */
export const BASE: Record<Exclude<StatId, "maxHp" | "speed">, number> = {
  damage: 1,
  cooldown: 1,
  area: 1,
  crit: 0.05,
  regen: 0,
  pickup: 3,
  xp: 1,
  armor: 0,
  thorns: 0,
  lifesteal: 0,
  stardust: 1,
  ultCharge: 1,
  luck: 0,
  healing: 1,
  shield: 0,
  evasion: 0,
  damageTaken: 1,
  critDamage: CRIT_MULTIPLIER,
  projectiles: 0,
  projSpeed: 1,
  duration: 1,
  statusChance: 1,
  statusDamage: 1,
  dashCharges: 1,
  partnerDamage: 1,
  spawns: 1,
  elites: 1,
  partnerRate: 1,
  guardRest: 1,
  pierce: 0,
};

/**
 * Area upgrades and Wide Lens multiply, so a late build would reach 2×+ its base area (the "skills
 * are absurdly big" feedback). Growth saturates instead: every roll still adds, less each time,
 * toward at most 1 + AREA_GROWTH_MAX.
 */
export const AREA_GROWTH_MAX = 0.7;

/** Diminishing armor: damage × ARMOR_HALF / (ARMOR_HALF + armor), so this much armor halves it. */
export const ARMOR_HALF = 40;

/** At the start of a run: seconds of invulnerability, and rerolls before the lab's 刷新. */
export const START = { invulnerable: 1, rerolls: 2 } as const;

/** 开局及跨区时，相邻玩家出生位置的间距（u）。 */
export const PLAYER_SPAWN_SPACING = 2;

/** 活力碎片: one revive at this share of max HP, with this many seconds of invulnerability. */
export const REVIVE = { hp: 0.6, invulnerable: 2.5 } as const;

/** 保命触发器结算后至少保留的 HP；与中毒保底独立。 */
export const LETHAL_SAVE_MIN_HP = 1;

/** Seconds from standing to full walking speed, and from full speed to a stop. */
export const ACCEL_TIME = 0.07;
export const STOP_TIME = 0.05;

/** 冲刺持续秒数、每次充能秒数和对当前移动速度的倍率；权威模拟与本机预测共用。 */
export const DASH_TIME = 0.18;
export const DASH_COOLDOWN = 2.4;
export const DASH_SPEEDUP = 3.4;

/** Seconds of invulnerability after the player takes a hit (or evades one). */
export const PLAYER_IFRAMES = 0.35;

/** The shield (`shield` stat) refills to full over `refill` seconds once `delay` seconds pass unhurt. */
export const SHIELD = { delay: 4, refill: 2 } as const;

/** Seconds of invulnerability while the new form settles in (the view adds hit-stop and a light column). */
export const EVOLVE_INVULNERABLE = 1.2;

/** Hazards use this much less radius than the form's contact body, in world units. */
export const HAZARD_RADIUS_INSET = 0.05;
