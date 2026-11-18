import {
  CAP_STARDUST_RATE,
  CHALLENGE_ALPHA,
  DANGER_STARDUST,
  HELD_ITEM_STARDUST,
  LEVEL_CAP,
  RULE_DANGER,
  WEATHER_EVENT_WEIGHT,
} from "../sim/content/params/rules";
import {
  knownRules,
  ruleIds,
  stardustMultiplier,
  totalDanger,
  type RuleId,
} from "../sim/content/rules";
import type { EntryWindow } from "./entry-windows";

export const CHALLENGE_PARAMETERS = {
  levelCap: LEVEL_CAP,
  capStardustRate: CAP_STARDUST_RATE,
  alpha: CHALLENGE_ALPHA,
  itemStardust: HELD_ITEM_STARDUST,
  danger: RULE_DANGER,
  stardustPerDanger: DANGER_STARDUST,
  weatherWeight: WEATHER_EVENT_WEIGHT,
};

export const CHALLENGE_MODEL_LIMITS = [
  "单人解析结果。多人救援、清区复活和离席不在估算内。",
  "比较配对的是开局种子。卡池和野外事件改变后，后续构筑、到达后图的样本和随机消耗可以分叉。",
  "排定与触发只统计已入图样本，后图样本不能按数组下标配对。天气触发指进入预告，生效时长与承伤按存活概率加权，再除以开局样本数。",
  "招式取舍看实际出现和习得；无规则的 eligible 不检查新招式的等级门槛。模型自动融合，不估算为指定招式保留栏位或到站遗忘的策略。",
  "背包、档案库、守卫奖杯和耿鬼交易沿用基础模型的覆盖范围，站点持有道具按正式规则转砂。",
  "体型进入聚合接敌率。精英的逐只远程技能和空间几何未重建，捕获仍按出生类别结算。",
  "逐图守卫耗时与完成等级受各规则下的幸存样本组成影响。星沙是期望值，保留小数。",
] as const;

export interface ChallengeField {
  /** 每个起始样本的期望值，按实际存活质量记账。 */
  cappedXp: number;
  capStardust: number;
  replacedItems: number;
  itemStardust: number;
}

export interface ChallengeResult {
  rules: readonly RuleId[];
  danger: number;
  multiplier: number;
  stardust: number;
  fields: ChallengeField[];
  pressure: { entry: EntryWindow | null; preSummon: EntryWindow | null }[];
}

export function expectedChallengePayout(rules: readonly RuleId[], rawStardust: number) {
  const danger = totalDanger(rules);
  const multiplier = stardustMultiplier(danger);
  return { danger, multiplier, stardust: rawStardust * multiplier };
}

export function parseModelRules(value: string | undefined): readonly RuleId[] | undefined {
  if (value === undefined) return undefined;
  if (value === "none") return [];
  if (value === "all") return ruleIds;
  const rules = value.split(",");
  if (!knownRules(rules))
    throw new RangeError(`无效的 BALANCE_RULES ${value}。可用规则 ${ruleIds.join(",")}。`);
  return rules;
}
