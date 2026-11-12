// Balance targets: analysis hints the CLI reads results against, never gates (design doc §6.2,
// docs/BALANCE.md「目标」). Clear rates are per difficulty for the average profile; novice is the
// bot's to measure (`pnpm balance`), so the model's novice figure is shown, not judged.

import type { Difficulty } from "../sim/content/difficulties";

export interface Range {
  min: number;
  max: number;
}

export const TARGETS = {
  /** Average-profile clear rate per difficulty. */
  averageClear: {
    0: { min: 0.75, max: 0.9 },
    1: { min: 0.55, max: 0.75 },
    2: { min: 0.35, max: 0.55 },
  } satisfies Record<Difficulty, Range>,
  /** Normal novice clear, measured by the bot. */
  noviceClear: { min: 0.25, max: 0.35 },
  expertClear: { min: 0.85, max: 1 },
  /** Average-profile second each level is reached (≈, ±20 s), and the level at 8:00. */
  levelAt: { 4: 105, 8: 240, 16: 435 } as Record<number, number>,
  levelSlack: 20,
  levelAt8: { min: 17, max: 18 },
  bossTtk: { min: 0, max: 90 },
  ultEvery: { min: 60, max: 90 },
  /** Move and item budgets relative to the median. */
  budget: { min: 0.6, max: 1.4 },
  fusionSwarm: { min: 1, max: 1.8 },
  fusionGuardian: { min: 0.4, max: 1.5 },
  /** Largest clear-rate gap between starters at one skill. */
  starterSpread: 0.35,
} as const;

export const inRange = (value: number, range: Range) => value >= range.min && value <= range.max;
