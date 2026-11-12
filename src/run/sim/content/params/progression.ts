import type { StarterId } from "../lines/index";

/** XP to leave level L is XP_STEP × (L + this offset); XP_STEP stays in params/pacing.ts. */
export const XP_LEVEL_OFFSET = 1;

/** Items carried into a new run before the lab's 大背包 bonus. */
export const BACKPACK_BASE = 2;

/**
 * Research points needed to unlock a starter; each kill earns 1 + the lab's research bonus.
 * Pikachu's 2,500 points take about two or three ordinary runs before research upgrades.
 */
export const starterUnlocks: Partial<Record<StarterId, number>> = { pikachu: 2500 };
