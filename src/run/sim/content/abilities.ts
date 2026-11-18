// A form grants one ability in the player's chosen slot. The sim and balance model share these
// operands; continuous HP changes are shares of max HP per second, ranges in world units.
import { modifierText, type EffectDef, type PerStage } from "./effects";
import { resolveTrigger, triggerText, type TriggerDef } from "./triggers";
import type { Player } from "../state/entities";
import type { ElementType } from "./elements";
import { statuses } from "./statuses";

export { LOW_HP } from "./effects";

export const ABILITY_PARAMS = {
  lowHpBonus: [0.4, 0.5, 0.6],
  torrentBonus: [1, 1.4, 1.8],
  chlorophyllSpeed: 1.3,
  chlorophyllCooldown: 0.85,
  solarSpecial: 1.5,
  droughtSeconds: 30,
  solarCost: 0.003,
  rainDishHealing: 0.02,
  sandVeil: 0.2,
  noGuardRange: 1.15,
  noGuardIncoming: 1.15,
  lightningRod: { specialBonus: 0.3, seconds: 6, range: 7 },
  cursedBody: { chance: 0.4, seconds: statuses.disable.duration },
  shedSkinPoisonFactor: 0.7,
  marvelScaleArmor: 18,
  multiscaleIncoming: 0.5,
  steadfastSpeed: 0.3,
} as const;

export interface FormAbilities {
  normal: readonly [AbilityId] | readonly [AbilityId, AbilityId];
  hidden?: AbilityId;
}

export function abilityForSlot(form: FormAbilities, slot: Player["abilitySlot"]): AbilityId {
  return (slot === "hidden" ? form.hidden : form.normal[slot]) ?? form.normal[0];
}

export interface AbilityDef<Id extends string = AbilityId> {
  id: Id;
  name: string;
  /** Starting-stage description used on cards. */
  desc: string;
  /** Effects settled at their source (hazards, weather, conditional regen, etc.). */
  note?: string;
  /** Fraction of direct enemy contact damage prevented at each stage. */
  contactReduction?: PerStage;
  effect: EffectDef<PerStage> & { triggers: readonly TriggerDef[] };
}

/** Current form's stage values, including effects that aren't flat stat modifiers. */
export function abilityText(
  {
    effect,
    note,
    contactReduction,
  }: Pick<AbilityDef<string>, "effect" | "note" | "contactReduction">,
  stage: number,
): string {
  return [
    ...effect.modifiers.map((m) => modifierText({ ...m, value: m.value[stage]! })),
    ...effect.triggers.map((t) => triggerText(resolveTrigger(t, stage))),
    ...(contactReduction ? [`受到的敌人接触伤害 -${percent(contactReduction[stage]!)}`] : []),
    ...(note ? [note] : []),
  ].join("；");
}

function ability<Id extends string>(
  id: Id,
  name: string,
  {
    modifiers = [],
    triggers = [],
    ...details
  }: Partial<EffectDef<PerStage>> & Pick<AbilityDef<Id>, "note" | "contactReduction">,
): AbilityDef<Id> {
  const def = { id, name, effect: { modifiers, triggers }, ...details };
  return { ...def, desc: abilityText(def, 0) };
}

const fixed = (value: number): PerStage => [value, value, value];
const percent = (share: number) => `${Number((share * 100).toFixed(2))}%`;
const p = ABILITY_PARAMS;

function lowHpElement(type: ElementType, bonuses: PerStage): EffectDef<PerStage> {
  return {
    modifiers: [
      {
        stat: "damage",
        op: "mul",
        value: bonuses.map((bonus) => 1 + bonus),
        when: type,
        requires: "lowHp",
      },
    ],
  };
}

const abilitiesTable = {
  "tough-claws": ability("tough-claws", "硬爪", {
    modifiers: [{ stat: "damage", op: "mul", value: fixed(1.3), when: "physical" }],
  }),
  drought: ability("drought", "日照", {
    note: `超级进化与入图时带来 ${p.droughtSeconds} 秒大晴天`,
  }),
  blaze: ability("blaze", "猛火", {
    modifiers: [
      { stat: "damage", op: "mul", value: [1.1, 1.15, 1.2], when: "fire" },
      { stat: "damage", op: "add", value: p.lowHpBonus, when: "lowHp" },
    ],
  }),
  overgrow: ability("overgrow", "茂盛", lowHpElement("grass", p.lowHpBonus)),
  torrent: ability("torrent", "激流", lowHpElement("water", p.torrentBonus)),
  static: ability("static", "静电", {
    triggers: [
      { kind: "contactStatus", type: "electric", status: "paralysis" },
      {
        kind: "zap",
        seconds: [4, 3.5, 3],
        dmg: [12, 15, 18],
        range: 7,
        type: "electric",
        status: "paralysis",
      },
    ],
  }),
  levitate: ability("levitate", "浮游", { note: "不受孢子、毒池和地面落点影响" }),
  "cursed-body": ability("cursed-body", "诅咒之躯", {
    note: `受到攻击时有 ${percent(p.cursedBody.chance)} 几率让攻击者陷入定身法 ${p.cursedBody.seconds} 秒`,
  }),
  "shed-skin": ability("shed-skin", "蜕皮", {
    note: `中毒的持续伤害减少 ${percent(1 - p.shedSkinPoisonFactor)}`,
  }),
  guts: ability("guts", "毅力", {
    modifiers: [
      { stat: "armor", op: "add", value: [30, 40, 50] },
      { stat: "damage", op: "mul", value: [1.12, 1.45, 1.8], when: "physical" },
    ],
  }),
  synchronize: ability("synchronize", "同步", {
    modifiers: [
      { stat: "cooldown", op: "mul", value: [0.94, 0.9, 0.86] },
      { stat: "dashCharges", op: "add", value: [1, 1, 2] },
    ],
  }),
  sturdy: ability("sturdy", "结实", {
    modifiers: [
      { stat: "maxHp", op: "pct", value: [0.1, 0.15, 0.2] },
      { stat: "armor", op: "add", value: [12, 16, 20] },
      { stat: "damage", op: "mul", value: [1.1, 1.2, 1.3], when: "ground" },
    ],
  }),
  chlorophyll: ability("chlorophyll", "叶绿素", {
    modifiers: [
      { stat: "speed", op: "mul", value: fixed(p.chlorophyllSpeed), when: "sun" },
      { stat: "cooldown", op: "mul", value: fixed(p.chlorophyllCooldown), when: "sun" },
    ],
  }),
  "solar-power": ability("solar-power", "太阳之力", {
    modifiers: [
      { stat: "damage", op: "mul", value: fixed(p.solarSpecial), when: "special", requires: "sun" },
    ],
    note: `大晴天时每秒损失 ${percent(p.solarCost)} 最大 HP`,
  }),
  "rain-dish": ability("rain-dish", "雨盘", {
    note: `下雨时每秒回复 ${percent(p.rainDishHealing)} 最大 HP`,
  }),
  "sand-veil": ability("sand-veil", "沙隐", {
    note: `沙暴中有 ${percent(p.sandVeil)} 几率避开攻击`,
  }),
  "no-guard": ability("no-guard", "无防守", {
    modifiers: [{ stat: "damageTaken", op: "mul", value: fixed(p.noGuardIncoming) }],
    note: `本线招式没有前摇，范围 +${percent(p.noGuardRange - 1)}`,
  }),
  "lightning-rod": ability("lightning-rod", "避雷针", {
    modifiers: [
      {
        stat: "damage",
        op: "mul",
        value: fixed(1 + p.lightningRod.specialBonus),
        when: "special",
        requires: "charged",
      },
    ],
    note: `吸引附近的电弹，吸收后的强化持续 ${p.lightningRod.seconds} 秒`,
  }),
  steadfast: ability("steadfast", "不屈之心", {
    modifiers: [{ stat: "speed", op: "mul", value: fixed(1 + p.steadfastSpeed), when: "slowed" }],
  }),
  "marvel-scale": ability("marvel-scale", "神奇鳞片", {
    modifiers: [{ stat: "armor", op: "add", value: fixed(p.marvelScaleArmor), when: "poisoned" }],
  }),
  multiscale: ability("multiscale", "多重鳞片", {
    modifiers: [
      { stat: "damageTaken", op: "mul", value: fixed(p.multiscaleIncoming), when: "fullHp" },
    ],
  }),
  "inner-focus": ability("inner-focus", "精神力", { note: "不会被减速" }),
  "magic-guard": ability("magic-guard", "魔法防守", { note: "不受中毒和天气持续伤害" }),
  "rock-head": ability("rock-head", "坚硬脑袋", { contactReduction: [0.55, 0.7, 0.8] }),
};

export type AbilityId = keyof typeof abilitiesTable;
export const abilities: Record<AbilityId, AbilityDef> = abilitiesTable;

export function contactDamageFactor(ability: AbilityId, stage: number): number {
  return 1 - (abilities[ability].contactReduction?.[stage] ?? 0);
}
