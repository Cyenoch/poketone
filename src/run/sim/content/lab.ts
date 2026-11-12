// Research definitions. Prices live in params/economy.ts; pricing, formatting and bonus folds stay in run/lab.ts.
import type { ModifierOp, StatId } from "./effects";
import type { RunRule } from "../state/entities";
import { BASE_CHOICES, BASE_ITEM_SLOTS, MAX_ITEM_SLOTS, BASE_MOVE_SLOTS } from "./params/cards";
import { BASE_PARTNER_SLOTS } from "./params/partners";
import { START } from "./params/player";
import { BACKPACK_BASE } from "./params/progression";

/** Lab (研究所) items from openspec/specs/combat-builds/spec.md, ids as in the reference `lab.json`. */
export type LabId =
  | "dmg"
  | "hp"
  | "armor"
  | "regen"
  | "crit"
  | "atkspd"
  | "area"
  | "ult"
  | "spd"
  | "xp"
  | "gold"
  | "magnet"
  | "luck"
  | "slot-move"
  | "slot-vit"
  | "choice4"
  | "reroll"
  | "skip"
  | "banish"
  | "revive"
  | "research"
  | "party"
  | "archive"
  | "bag";

export type LabLevels = Partial<Record<LabId, number>>;

/** Lab totals the save uses outside the sim (unlock progress, archive and backpack sizes). */
export interface MetaBonuses {
  /** 研究: unlock-challenge progress per kill over 1 (+0.25 = ×1.25). */
  research: number;
  /** 档案库 slots. */
  archive: number;
  /** 大背包: backpack slots over `BACKPACK_BASE`. */
  backpack: number;
}

/** Pure research data: `per` is added per bought level; stat operations follow content/effects.ts. */
export interface LabDefinition {
  id: LabId;
  name: string;
  stat: string;
  max: number;
  grants: { stat: StatId; op: ModifierOp } | { rule: RunRule } | { meta: keyof MetaBonuses };
  per: number;
  /** Percentage, fixed-decimal bonus, or total including the unresearched base. */
  format: "percent" | { digits: number } | { base: number };
}

export const labDefinitions: readonly LabDefinition[] = [
  {
    id: "dmg",
    name: "训练",
    stat: "伤害",
    max: 8,
    grants: { stat: "damage", op: "add" },
    per: 0.04,
    format: "percent",
  },
  {
    id: "hp",
    name: "韧性",
    stat: "HP",
    max: 8,
    grants: { stat: "maxHp", op: "add" },
    per: 8,
    format: { digits: 0 },
  },
  {
    id: "armor",
    name: "护壳",
    stat: "护甲",
    max: 6,
    grants: { stat: "armor", op: "add" },
    per: 2,
    format: { digits: 0 },
  },
  {
    id: "regen",
    name: "吃剩的东西",
    stat: "再生",
    max: 5,
    grants: { stat: "regen", op: "add" },
    per: 0.2,
    format: { digits: 1 },
  },
  {
    id: "crit",
    name: "精准",
    stat: "暴击",
    max: 5,
    grants: { stat: "crit", op: "add" },
    per: 0.01,
    format: "percent",
  },
  {
    id: "atkspd",
    name: "迅捷",
    stat: "攻速",
    max: 5,
    grants: { stat: "cooldown", op: "div" },
    per: 0.02,
    format: "percent",
  },
  {
    id: "area",
    name: "扩张",
    stat: "范围",
    max: 5,
    grants: { stat: "area", op: "add" },
    per: 0.03,
    format: "percent",
  },
  {
    id: "ult",
    name: "协调",
    stat: "充能",
    max: 5,
    grants: { stat: "ultCharge", op: "add" },
    per: 0.04,
    format: "percent",
  },
  {
    id: "spd",
    name: "敏捷",
    stat: "移速",
    max: 6,
    grants: { stat: "speed", op: "pct" },
    per: 0.025,
    format: "percent",
  },
  {
    id: "xp",
    name: "钻研",
    stat: "经验",
    max: 6,
    grants: { stat: "xp", op: "add" },
    per: 0.05,
    format: "percent",
  },
  {
    id: "gold",
    name: "贸易",
    stat: "星星沙子",
    max: 6,
    grants: { stat: "stardust", op: "add" },
    per: 0.08,
    format: "percent",
  },
  {
    id: "magnet",
    name: "磁力",
    stat: "拾取",
    max: 5,
    grants: { stat: "pickup", op: "extra" },
    per: 0.6,
    format: { digits: 1 },
  },
  {
    id: "luck",
    name: "财运",
    stat: "幸运",
    max: 6,
    grants: { stat: "luck", op: "add" },
    per: 5,
    format: { digits: 0 },
  },
  {
    id: "slot-move",
    name: "第 4 个招式",
    stat: "招式栏",
    max: 1,
    grants: { rule: "moveSlots" },
    per: 1,
    format: { base: BASE_MOVE_SLOTS },
  },
  {
    id: "slot-vit",
    name: "维生素栏位",
    stat: "道具栏",
    max: MAX_ITEM_SLOTS - BASE_ITEM_SLOTS,
    grants: { rule: "itemSlots" },
    per: 1,
    format: { base: BASE_ITEM_SLOTS },
  },
  {
    id: "choice4",
    name: "第四个选项",
    stat: "选项",
    max: 1,
    grants: { rule: "choices" },
    per: 1,
    format: { base: BASE_CHOICES },
  },
  {
    id: "reroll",
    name: "刷新",
    stat: "每局",
    max: 6,
    grants: { rule: "rerolls" },
    per: 1,
    format: { base: START.rerolls },
  },
  {
    id: "skip",
    name: "跳过",
    stat: "每局",
    max: 6,
    grants: { rule: "skips" },
    per: 1,
    format: { base: 0 },
  },
  {
    id: "banish",
    name: "放逐",
    stat: "每局",
    max: 6,
    grants: { rule: "banishes" },
    per: 1,
    format: { base: 0 },
  },
  {
    id: "revive",
    name: "活力碎片",
    stat: "复活",
    max: 1,
    grants: { rule: "revives" },
    per: 1,
    format: { base: 0 },
  },
  {
    id: "research",
    name: "研究",
    stat: "进度",
    max: 4,
    grants: { meta: "research" },
    per: 0.25,
    format: "percent",
  },
  {
    id: "party",
    name: "支援队伍",
    stat: "同伴",
    max: 1,
    grants: { rule: "partners" },
    per: 1,
    format: { base: BASE_PARTNER_SLOTS },
  },
  {
    id: "archive",
    name: "档案库",
    stat: "档案",
    max: 6,
    grants: { meta: "archive" },
    per: 1,
    format: { base: 0 },
  },
  {
    id: "bag",
    name: "大背包",
    stat: "背包",
    max: 1,
    grants: { meta: "backpack" },
    per: 1,
    format: { base: BACKPACK_BASE },
  },
];
