import type { Difficulty } from "../difficulties";
import type { StarterId } from "../lines/index";

/** XP to leave level L is XP_STEP × (L + this offset); XP_STEP stays in params/pacing.ts. */
export const XP_LEVEL_OFFSET = 1;

/** Items carried into a new run before the lab's 大背包 bonus. */
export const BACKPACK_BASE = 2;

/** What a partner needs before it joins; the first three join from the start. */
export type StarterUnlock =
  /** Research points (each kill earns 1 + the lab's research bonus). */
  | { kind: "research"; points: number }
  /** One clear of this difficulty. */
  | { kind: "clear"; difficulty: Difficulty }
  /** Clears with `count` different partners at this difficulty or above. */
  | { kind: "distinctClears"; count: number; difficulty: Difficulty };

/**
 * Pikachu's 2,500 points take about two or three ordinary runs before research upgrades; the
 * rest follow clears and the breadth of the roster.
 */
export const starterUnlocks: Partial<Record<StarterId, StarterUnlock>> = {
  pikachu: { kind: "research", points: 2500 },
  machop: { kind: "clear", difficulty: 0 },
  geodude: { kind: "research", points: 8000 },
  abra: { kind: "distinctClears", count: 4, difficulty: 0 },
  gastly: { kind: "clear", difficulty: 1 },
  dratini: { kind: "distinctClears", count: 3, difficulty: 1 },
};
