// Ids are the Pokébonk 0.8.83 keys the entries were modelled on (see src/run/sim/content/README.md); numbers
// are our own tuning, not copied runtime values.

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
};

export type AbilityId = keyof typeof abilitiesTable;
export const abilities: Record<AbilityId, AbilityDef> = abilitiesTable;
