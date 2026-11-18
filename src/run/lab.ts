import { atLevel, type Modifier } from "./sim/content/effects";
import type { BondLabId } from "./sim/content/bonds";
import {
  labDefinitions,
  type LabDefinition,
  type LabId,
  type LabLevels,
  type MetaBonuses,
} from "./sim/content/lab";
import { LAB_PRICES, type LabPrice } from "./sim/content/params/economy";
import { powInt } from "./sim/math";
import type { LabBonuses } from "./sim/state/entities";

export const NO_META: MetaBonuses = { research: 0, archive: 0, backpack: 0 };

/** Research data with its computed price and value formatter. */
export interface LabItem extends Omit<LabDefinition, "format"> {
  /** Cost of buying the level after `level` (0-based levels already bought). */
  cost: (level: number) => number;
  /** Total effect at a bonus value, e.g. "+12%". */
  value: (bonus: number) => string;
}

/** A growing price is the reference's `m(base, growth)`: round(first × growth^level); a list is per level. */
const price = (spec: LabPrice) => (level: number) =>
  "first" in spec ? Math.round(spec.first * powInt(spec.growth, level)) : spec[level]!;

const percent = (v: number) => `+${Number((v * 100).toFixed(1))}%`;
const plus = (digits: number) => (v: number) => `+${v.toFixed(digits)}`;
const total = (base: number) => (v: number) => String(base + v);

const allItems: readonly LabItem[] = labDefinitions.map(({ format, ...item }) => ({
  ...item,
  cost: price(item.starter ? LAB_PRICES.bond : LAB_PRICES[item.id as Exclude<LabId, BondLabId>]),
  value:
    format === "percent" ? percent : "digits" in format ? plus(format.digits) : total(format.base),
}));

export const labItems = allItems.filter((item) => item.starter === undefined);
export const bondLabItems = allItems.filter((item) => item.starter !== undefined);
export const labItem = (id: LabId): LabItem => allItems.find((item) => item.id === id)!;

/** Price of the next level, or null when the item is maxed. */
export function nextCost(item: LabItem, level: number): number | null {
  return level < item.max ? item.cost(level) : null;
}

/** General research only. A seat carries its current partner's bond research separately. */
export function labBonuses(levels: LabLevels): LabBonuses {
  const modifiers: Modifier[] = [];
  const rules: LabBonuses["rules"] = {};
  for (const item of labDefinitions) {
    if (item.starter !== undefined) continue;
    const level = levels[item.id] ?? 0;
    if (level === 0) continue;
    const { grants } = item;
    if ("stat" in grants)
      modifiers.push({
        ...grants,
        value: atLevel(grants.op, item.per, level),
        source: { kind: "lab" },
      });
    else if ("rule" in grants) rules[grants.rule] = item.per * level;
  }
  return { modifiers, rules };
}

export function metaBonuses(levels: LabLevels): MetaBonuses {
  const bonuses = { ...NO_META };
  for (const item of labDefinitions)
    if ("meta" in item.grants) bonuses[item.grants.meta] += item.per * (levels[item.id] ?? 0);
  return bonuses;
}
