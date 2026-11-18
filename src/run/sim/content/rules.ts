import { DANGER_STARDUST, RULE_DANGER } from "./params/rules";

export type RuleId = keyof typeof RULE_DANGER;
export const rules = {
  nuzlocke: { name: "Nuzlocke", effect: "倒下后不能复活或被救援" },
  "level-cap": { name: "等级上限", effect: "达到本图等级上限后，经验转为星星沙子" },
  "no-items": { name: "禁止携带道具", effect: "不带入背包，持有道具奖励换为星星沙子" },
  "mono-type": { name: "单属性", effect: "新招式限当前形态的属性" },
  "alpha-elites": { name: "头目化", effect: "精英获得头目的体力、伤害与体型强化" },
  "wild-weather": { name: "异常天气", effect: "天气事件的抽取权重翻倍" },
} as const satisfies Record<RuleId, { name: string; effect: string }>;

export const ruleIds = Object.keys(rules) as RuleId[];

export function knownRules(value: unknown): value is RuleId[] {
  return (
    Array.isArray(value) &&
    value.length <= ruleIds.length &&
    Array.from(value).every((id: unknown) => typeof id === "string" && Object.hasOwn(rules, id)) &&
    new Set(value).size === value.length
  );
}

export function totalDanger(selected: readonly RuleId[]): number {
  return selected.reduce((sum, id) => sum + RULE_DANGER[id], 0);
}

export function stardustMultiplier(danger: number): number {
  return 1 + DANGER_STARDUST * danger;
}
