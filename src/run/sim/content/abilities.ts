// Player passives: the original four follow Pokébonk 0.8.83 references; new lines use their own
// effects. All numbers are our own tuning, not copied runtime values.

import { modifierText, type EffectDef, type PerStage } from "./effects";
import { resolveTrigger, triggerText, type TriggerDef } from "./triggers";

export { LOW_HP } from "./effects";

export interface AbilityDef<Id extends string = AbilityId> {
  id: Id;
  name: string;
  /** Stage-1 numbers, derived from `effect`; evolving strengthens them. */
  desc: string;
  /** Values per stage (src/run/sim/content/README.md 宝可梦特性). */
  effect: EffectDef<PerStage> & { triggers: readonly TriggerDef[] };
}

function ability<Id extends string>(
  id: Id,
  name: string,
  { modifiers, triggers = [] }: EffectDef<PerStage>,
): AbilityDef<Id> {
  const desc = [
    ...modifiers.map((modifier) => modifierText({ ...modifier, value: modifier.value[0]! })),
    ...triggers.map((trigger) => triggerText(resolveTrigger(trigger, 0))),
  ].join("；");
  return { id, name, desc, effect: { modifiers, triggers } };
}

const abilitiesTable = {
  blaze: ability("blaze", "猛火", {
    modifiers: [
      { stat: "damage", op: "mul", value: [1.1, 1.15, 1.2], when: "fire" },
      { stat: "damage", op: "add", value: [0.4, 0.5, 0.6], when: "lowHp" },
    ],
  }),
  photosynthesis: ability("photosynthesis", "光合作用", {
    modifiers: [
      { stat: "regen", op: "add", value: [1.5, 2, 2.5] },
      { stat: "healing", op: "add", value: [0.15, 0.2, 0.25] },
    ],
    triggers: [{ kind: "healOnHit", type: "grass", heal: [0.004, 0.005, 0.006], perSecond: 5 }],
  }),
  "torrent-shell": ability("torrent-shell", "激流之壳", {
    modifiers: [
      { stat: "armor", op: "add", value: [10, 13, 16] },
      { stat: "shield", op: "add", value: [12, 15, 18] },
      { stat: "damage", op: "add", value: [0.4, 0.5, 0.6], when: "lowHp" },
    ],
  }),
  static: ability("static", "静电", {
    modifiers: [],
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
  "shadow-shroud": ability("shadow-shroud", "幽影", {
    modifiers: [
      { stat: "evasion", op: "add", value: [0.2, 0.24, 0.28] },
      { stat: "statusDamage", op: "add", value: [0.2, 0.35, 0.5] },
    ],
  }),
  "dragon-scale": ability("dragon-scale", "龙鳞", {
    modifiers: [
      { stat: "damage", op: "mul", value: [0.9, 1.15, 1.45], when: "dragon" },
      { stat: "armor", op: "add", value: [3, 6, 10] },
    ],
  }),
  guts: ability("guts", "毅力", {
    modifiers: [
      { stat: "armor", op: "add", value: [20, 24, 28] },
      { stat: "damage", op: "mul", value: [1.08, 1.35, 1.7], when: "physical" },
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
};

export type AbilityId = keyof typeof abilitiesTable;
export const abilities: Record<AbilityId, AbilityDef> = abilitiesTable;
