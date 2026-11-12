// The meta currency 星星沙子 (stardust): what a run carries out to the 研究所. Every value here is
// 设计方暂定，待用户确认 (the lead's provisional design; the user only fixed the shape: ordinary enemies
// drop it rarely, elites and the guardian always). Change them here; nothing else hard-codes them.
// The stardust-gain stat (护符金币, 彗星碎片, 研究所「贸易」) multiplies every amount when credited.
// Analysis and the measured income behind these numbers: docs/BALANCE.md「星星沙子」.

import type { LabId } from "../lab";

/**
 * Drops, one pickup carrying the whole value. An ordinary wild enemy rolls `ordinary.chance` on the
 * seeded world RNG; an elite always drops `elite`; the guardian always gives `guardian` and nothing else
 * (no elite drop, no ordinary roll). Its fall ends the run at once, so it is credited on the kill to
 * every player instead of lying on the ground.
 */
export const STARDUST = {
  ordinary: { chance: 0.05, value: 5 },
  elite: 20,
  guardian: 100,
} as const;

/** 树果基础掉率与单颗治疗 HP；掉率受击杀者的 berries 加成，治疗受拾取者的 healing 加成。 */
export const BERRY = { chance: 0.012, heal: 20 } as const;

/** 掉落偏移各轴独立均匀抽样 ±spread（u）；精英/守卫经验分份后逐份向上取整。 */
export const LOOT = {
  chestSpread: 0.3,
  eliteXpCount: 6,
  eliteXpSpread: 1.4,
  eliteStardustSpread: 0.6,
  xpSpread: 0.2,
  stardustSpread: 0.5,
  berrySpread: 0.4,
} as const;

/** 磁吸速度（u/s）与收集距离（u）；普通磁吸近身加速，清区磁吸随距离线性加速。 */
export const PICKUP = {
  speed: 10,
  nearSpeed: 30,
  nearDistance: 6,
  clearSpeed: 20,
  /** 清区速度每增加 1u 距离时增加的 u/s。 */
  clearDistanceSpeed: 5,
  collectDistance: 0.8,
} as const;

/**
 * 引梦貘人 refunds per level of what is forgotten (fusions: per star), the one in-run source besides
 * drops. A max-level move pays 40, under 10% of a normal run.
 */
export const FORGET = { move: 5, item: 4 } as const;

/** A lab price: grows as round(`first` × `growth`^level), or a fixed list, one entry per level. */
export type LabPrice = { first: number; growth: number } | readonly number[];

/**
 * 研究所 prices by item id (content/lab.ts). A bot clearing 普通 banks ≈ 430 (305–570), an early death
 * ≈ 50–330: first levels at 150–250 buy one or two per early run and two or three per clear. Growth
 * rates and the fixed big-ticket prices are unchanged from the 宝可币 economy.
 */
export const LAB_PRICES = {
  dmg: { first: 150, growth: 1.4 },
  hp: { first: 150, growth: 1.4 },
  armor: { first: 180, growth: 1.45 },
  regen: { first: 180, growth: 1.45 },
  crit: { first: 250, growth: 1.5 },
  atkspd: { first: 250, growth: 1.5 },
  area: { first: 250, growth: 1.5 },
  ult: { first: 250, growth: 1.5 },
  spd: { first: 180, growth: 1.45 },
  xp: { first: 180, growth: 1.45 },
  gold: { first: 150, growth: 1.45 },
  magnet: { first: 150, growth: 1.45 },
  luck: { first: 200, growth: 1.45 },
  "slot-move": [1500],
  "slot-vit": [1200, 3000, 6000, 10000],
  choice4: [3000],
  reroll: { first: 180, growth: 1.4 },
  skip: { first: 150, growth: 1.4 },
  banish: { first: 200, growth: 1.4 },
  revive: [5000],
  research: { first: 250, growth: 1.6 },
  party: [3500],
  archive: [600, 1200, 2000, 3000, 4000, 5500],
  bag: [4000],
} as const satisfies Record<LabId, LabPrice>;
