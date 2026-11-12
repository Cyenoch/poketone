// Level-up and chest cards: slots, how often each kind of card comes up, rarity odds, item tiers and how
// much one upgrade roll adds. The rolling itself stays in upgrades.ts (rollChoices, rarityOdds,
// itemTierOdds, statValue, applyChoice). Rarity tiers: 0 普通, 1 稀有, 2 史诗, 3 传说.

import type { Rarity, TrainStat } from "../../state/entities";

/** Slots before lab unlocks (研究所: 第 4 个招式, 维生素栏位), and cards per level-up before 第四个选项. */
export const BASE_MOVE_SLOTS = 3;
export const BASE_ITEM_SLOTS = 5;
export const MAX_ITEM_SLOTS = 9;
export const BASE_CHOICES = 3;

/**
 * P(普通, 稀有, 史诗, 传说) with no luck; sums to 1. One table for both draws: an upgrade card's rarity,
 * and a new item's tier (then faded by ITEM_GATES). Luck reweights it (upgrades.ts rarityOdds).
 */
export const RARITY_ODDS = [0.6, 0.27, 0.1, 0.03] as const;

/** Luck points per unit and each tier's reweighting coefficients; formula stays in rarityOdds. */
export const LUCK_SCALING = {
  unit: 100,
  rareDivisor: 2,
  /** Nonnegative integer powers, evaluated with deterministic powInt. */
  epicExponent: 2,
  legendaryExponent: 3,
} as const;

/** Minimum upgrade rarity by reward source; chests guarantee 稀有 or better. */
export const MIN_UPGRADE_RARITY = { level: 0, chest: 1 } as const satisfies Record<
  "level" | "chest",
  Rarity
>;

/** An upgrade card's roll power per rarity (× UPGRADE_ROLL); 史诗 and up roll three stats, not two. */
export const rarityPower = [1, 1.3, 1.6, 2] as const;

/** Upgrade stat picks: cards at or above `extraFrom` power pick `extra`, otherwise `base`. */
export const UPGRADE_PICKS = { extraFrom: 1.6, base: 2, extra: 3 } as const;

/**
 * Level-up card weights: upgrade an owned move, learn a signature (kit) move past its level gate, learn
 * the current stage's evolution move, level an owned item, a new item (per ITEM_DRAWS candidate).
 */
export const choiceWeights = {
  upgrade: 3,
  signature: 6,
  evolution: 7,
  ownedItem: 1.6,
  newItem: 1.1,
} as const;

/**
 * Level from which each kit move is offered (kit[0] is known from the start). The third opens at the
 * first evolution, where it competes with the first evolution move for the third slot; the fourth
 * between the two evolutions (lines/*, docs/BALANCE.md「三个区域」).
 */
export const SIGNATURE_GATES = [1, 2, 28, 40] as const;

/**
 * New-item candidates per level-up roll, each weighted `choiceWeights.newItem`; a chosen one rolls a
 * tier, then an item of that tier. 11 keeps the card mix of the 11-item pool (one candidate per item):
 * the model's average clear fell 91% → 62% (charmander) with 3, as fewer survival items came up.
 */
export const ITEM_DRAWS = 11;

/**
 * Player levels over which 史诗 and 传说 items fade into the new-item roll (linear, like the
 * reference's `nw` gates): none before the first level, their full `rarityOdds` share from the second.
 */
export const ITEM_GATES: Partial<Record<Rarity, readonly [number, number]>> = {
  2: [4, 10],
  3: [8, 16],
};

/** A type booster whose type the player hits with is this many times as likely in its tier. */
export const BOOSTER_WEIGHT = 4;

/** Default item cap; Max Ether extends items with this cap or higher. */
export const BASE_ITEM_LEVEL_CAP = 5;

/**
 * One upgrade roll at a card's rarity power p (rarityPower): `dmg` × p damage bonus,
 * min(`cdMax`, `cdPerPower` × p) cooldown reduction (× (1 − value)), and `area` / `speed` / `dur` /
 * `crit` / `status` × p bonuses. Count uses the high value from `countHighFrom`; pierce rounds power
 * with `pierceMin` as its floor. Formulas stay in statValue.
 */
export const UPGRADE_ROLL = {
  dmg: 0.15,
  cdPerPower: 0.05,
  cdMax: 0.18,
  area: 0.08,
  speed: 0.14,
  dur: 0.1,
  crit: 0.05,
  status: 0.15,
  countHighFrom: 2,
  countBase: 1,
  countHigh: 2,
  pierceMin: 1,
} as const;

/** Every upgrade adds this much damage on top of its rolls. */
export const UPGRADE_BASE_DMG = 0.05;

/** Highest move level from upgrade cards (also the fusion requirement: both parts at this level). */
export const MAX_MOVE_LEVEL = 8;
/** Fusions climb ★1 → ★5 with upgrade cards (reference). */
export const MAX_FUSION_STARS = 5;
/**
 * 招式学习器盒 (reference `tm-case`, max 1): +2 move levels, +1 fusion star. Offered only in chests, on one
 * card in `chance` × (1 + luck / 100); ~7 chests a run on 普通 make it show up in about four runs of ten.
 */
export const TM_CASE = { moveLevels: 2, stars: 1, chance: 0.08 } as const;

/** Per 训练 card (offered only when nothing else is left): a small boost for the rest of the run. */
export const TRAIN: Record<TrainStat, number> = {
  dmg: 0.03,
  hp: 5,
  speed: 0.03,
  area: 0.03,
  cd: 0.03,
};

/** Training pool order is also the seeded draw order. */
export const trainStats: readonly TrainStat[] = ["dmg", "hp", "speed", "area", "cd"];
