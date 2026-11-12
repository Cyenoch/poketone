/**
 * Why something is unavailable, as one short line for a Tooltip. Derived from the same data the
 * gates use (progress, lab costs), so the reason can never disagree with the lock.
 */
import { nextCost, type LabItem } from "./lab";
import { unlockedDifficulty, type Progress } from "./progress";
import { starterUnlocks } from "./sim/content/params/progression";
import { difficulties, type Difficulty } from "./sim/content/difficulties";
import { moves } from "./sim/content/moves";
import type { StarterId } from "./sim/content/lines/index";
import type { FusionPart } from "./sim/fusion";
import { MAX_MOVE_LEVEL } from "./sim/content/params/cards";

export function difficultyLock(progress: Progress, difficulty: Difficulty): string | null {
  if (difficulty <= unlockedDifficulty(progress)) return null;
  return `${difficulties[difficulty - 1]!.name}通关后解锁`;
}

export function starterLock(progress: Progress, starter: StarterId): string | null {
  const need = starterUnlocks[starter];
  if (need === undefined || progress.research >= need) return null;
  return `累计击倒 ${Math.floor(progress.research)} / ${need} 后加入`;
}

export function labLock(item: LabItem, level: number, stardust: number): string | null {
  const cost = nextCost(item, level);
  if (cost === null) return "已满级";
  return stardust < cost ? `还差 ${cost - stardust} 星星沙子` : null;
}

/** Hypno: the last move held cannot be forgotten. */
export function forgetLock(kind: "move" | "item", movesHeld: number): string | null {
  return kind === "move" && movesHeld <= 1 ? "只剩一个招式时不能忘记" : null;
}

/** Bill's machine: what is still missing before the pair can fuse. */
export function fusionLock(parts: readonly FusionPart[]): string | null {
  const missing = parts
    .filter((part) => !part.owned || part.level < MAX_MOVE_LEVEL)
    .map((part) =>
      part.owned
        ? `${moves[part.id].name} Lv.${part.level}/${MAX_MOVE_LEVEL}`
        : `${moves[part.id].name} 未学会`,
    );
  return missing.length ? `还差：${missing.join("、")}` : null;
}
