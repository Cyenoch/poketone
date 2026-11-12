/**
 * One-line meanings for terms a player may not know, shown on demand in a Tooltip (DESIGN.md ›
 * Tooltip). One place, so the lab, the card screen and the stats panel say the same thing.
 */
import { CRIT_MULTIPLIER } from "./sim/content/params/player";

/** Stats whose label alone does not say what they do (`StatKey`); the rest need no tip. */
export const statTerms: Partial<Record<string, string>> = {
  armor: "按比例减少受到的伤害",
  lifesteal: "造成伤害时按比例回复生命",
  thorns: "被敌人碰到时反弹的伤害",
  crit: `打出会心（${CRIT_MULTIPLIER} 倍伤害）的几率`,
  cooldown: "越低出招越快",
  ultCharge: "终极技外环的充能速度",
  pickup: "自动吸取经验与星星沙子的距离",
  luck: "提高高稀有度升级卡的几率",
};

/** Card-screen actions whose rule is not in their name; skip says what it does. */
export const actionTerms = {
  reroll: "次数每局有限，研究所「刷新」可加",
  skip: "",
  banish: "把一张卡移出本局卡池",
} as const;

/** Lab system upgrades (LabId) whose name alone does not say what they do. */
export const labTerms: Partial<Record<string, string>> = {
  "slot-move": "冒险中最多可学 4 个招式",
  "slot-vit": "冒险中可多带道具",
  choice4: "升级时多一张卡可选",
  reroll: "每局多一次重抽：换一组新的卡",
  skip: "每局多一次跳过：这次不选，直接继续",
  banish: `每局多一次放逐：${actionTerms.banish}`,
  revive: "倒下时原地复活一次",
  research: "解锁伙伴的击倒进度加快",
  party: "多一个位置，让收服的精英敌人并肩作战",
  archive: "指定的道具不会在冒险中出现",
  bag: "背包可多带一件道具进入冒险",
};
