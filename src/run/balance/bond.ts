// Partner bond comparison (docs/BALANCE.md「羁绊」): the same routes and seeds with growing bond.
// The model owns the effects (model.ts `RunOptions.bond`); this file owns the arms and the tolerance.
import type { LabLevels } from "../sim/content/lab";
import { labDefinitions } from "../sim/content/lab";
import { labBonuses } from "../lab";
import {
  BOND_CURE_LEVEL,
  BOND_ENDURE_LEVEL,
  BOND_DIFFICULTY_MULTIPLIERS,
  BOND_LAB_MAX,
  BOND_WIN_POINTS,
} from "../sim/content/params/bonds";
import type { StarterId } from "../sim/content/lines/index";
import { ALL_ROUTES } from "../sim/content/campaign";
import { runModel, type RunOptions } from "./model";
import { average } from "./skill";

export const BOND_ARMS = [
  { name: "无", bond: { level: 0, lab: 0 } },
  { name: "Lv2 挺住", bond: { level: BOND_ENDURE_LEVEL, lab: 0 } },
  { name: "Lv4 +自己治好", bond: { level: BOND_CURE_LEVEL, lab: 0 } },
  { name: "Lv5 +节点满级", bond: { level: 5, lab: BOND_LAB_MAX } },
] as const;

/** Lab levels a player carries: none, the CLI's 10-level mid preset, or every general node maxed. */
export const BOND_LABS: Record<"none" | "mid" | "max", LabLevels> = {
  none: {},
  mid: { dmg: 2, hp: 2, armor: 1, regen: 1, spd: 1, xp: 1, gold: 1, magnet: 1 },
  max: Object.fromEntries(
    labDefinitions.filter((item) => item.starter === undefined).map((item) => [item.id, item.max]),
  ),
};

/**
 * Tolerance for a maxed bond over the same lab and no bond (average profile, mean of the four
 * routes): the bond is a modest edge, not a requirement. Analysis hints, not gates. The 挺住 life
 * alone is worth 3–6 points of clear, so the cap is set above the unavoidable edge of one extra
 * save plus the node, and far below what a research tier is worth (10 mid levels: about +20).
 */
export const BOND_TOLERANCE = {
  /** Largest clear-rate gain (absolute) for any one starter. */
  clear: 0.14,
  /** Largest mean clear-rate gain across starters. */
  meanClear: 0.08,
  /** Largest mean gain of the clear supply / incoming ratio across starters. */
  pressure: 1.05,
} as const;

export interface BondArmResult {
  clear: number;
  reachBoss: number;
  /** Mean over minutes and routes of capacity / incoming (the model's pressure index). */
  pressure: number;
  ehp: number;
}

export type BondOptions = Pick<RunOptions, "difficulty" | "lab"> & {
  samples?: number;
  summonSeconds: readonly number[];
  fieldEvents?: boolean;
};

export function bondArm(
  starter: StarterId,
  labLevels: LabLevels,
  bond: { level: number; lab: number },
  options: BondOptions,
): BondArmResult {
  const runs = ALL_ROUTES.map((route) =>
    runModel({
      ...options,
      route,
      starter,
      skill: average,
      lab: labBonuses(labLevels),
      bond,
    }),
  );
  const mean = (value: (run: (typeof runs)[number]) => number) =>
    runs.reduce((sum, run) => sum + value(run), 0) / runs.length;
  const ratio = (run: (typeof runs)[number]) => {
    const rows = run.minutes.filter((m) => m.incoming > 0);
    return rows.reduce((sum, m) => sum + m.capacity / m.incoming, 0) / Math.max(1, rows.length);
  };
  const ehp = (run: (typeof runs)[number]) =>
    run.minutes.reduce((sum, m) => sum + m.ehp, 0) / Math.max(1, run.minutes.length);
  return {
    clear: mean((run) => run.outcome.clear),
    reachBoss: mean((run) => run.outcome.reachBoss),
    pressure: mean(ratio),
    ehp: mean(ehp),
  };
}

/**
 * Expected bond points a run earns (average profile, mean of starters and routes): maps cleared plus
 * the victory bonus, times the difficulty multiplier; flooring costs half a point on average.
 */
export function bondPointsPerRun(starters: readonly StarterId[], options: BondOptions): number {
  const multiplier = BOND_DIFFICULTY_MULTIPLIERS[options.difficulty];
  const points = starters.flatMap((starter) =>
    ALL_ROUTES.map((route) => {
      const run = runModel({ ...options, route, starter, skill: average });
      const zones = run.zoneClears.reduce((sum, zone) => sum + zone.clear, 0);
      return (zones + BOND_WIN_POINTS * run.outcome.clear) * multiplier - 0.5;
    }),
  );
  return points.reduce((sum, value) => sum + value, 0) / points.length;
}

export const bondWithinTolerance = (base: BondArmResult, full: BondArmResult) =>
  full.clear - base.clear <= BOND_TOLERANCE.clear;

/** Starter-mean check; `pairs` are the no-bond and maxed-bond results of each starter. */
export function bondMeanWithinTolerance(
  pairs: readonly (readonly [BondArmResult, BondArmResult])[],
): boolean {
  const mean = (value: (base: BondArmResult, full: BondArmResult) => number) =>
    pairs.reduce((sum, [base, full]) => sum + value(base, full), 0) / pairs.length;
  return (
    mean((base, full) => full.clear - base.clear) <= BOND_TOLERANCE.meanClear &&
    mean((base, full) => full.pressure / base.pressure) <= BOND_TOLERANCE.pressure
  );
}
