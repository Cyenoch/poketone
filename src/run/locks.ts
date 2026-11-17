/**
 * Why something is unavailable, as one short line for a Tooltip. Derived from the same data the
 * gates use (progress, lab costs), so the reason can never disagree with the lock.
 */
import { nextCost, type LabItem } from "./lab";
import {
  starterUnlocked,
  starterUnlockProgress,
  unlockedDifficulty,
  type Progress,
} from "./progress";
import { starterUnlocks } from "./sim/content/params/progression";
import { difficulties, type Difficulty } from "./sim/content/difficulties";
import { moves } from "./sim/content/moves";
import type { StarterId } from "./sim/content/lines/index";
import type { FusionPart } from "./sim/fusion";
import { MAX_MOVE_LEVEL } from "./sim/content/params/cards";
import { trainerUnlocked, XIAQING_UNLOCK_KILLS, type TrainerId } from "../trainers";

export function trainerLock(progress: Progress, trainer: TrainerId): string | null {
  if (trainerUnlocked(progress, trainer)) return null;
  return `累计击败 ${progress.kills.toLocaleString("en-US")} / ${XIAQING_UNLOCK_KILLS.toLocaleString("en-US")} 解锁`;
}

export function difficultyLock(progress: Progress, difficulty: Difficulty): string | null {
  if (difficulty <= unlockedDifficulty(progress)) return null;
  return `${difficulties[difficulty - 1]!.name}通关后解锁`;
}

export function starterLock(progress: Progress, starter: StarterId): string | null {
  const unlock = starterUnlocks[starter];
  if (!unlock || starterUnlocked(progress, starter)) return null;
  const { have, need } = starterUnlockProgress(progress, unlock);
  const count = (n: number) => Math.floor(n).toLocaleString("en-US");
  switch (unlock.kind) {
    case "research":
      return `累计击倒 ${count(have)} / ${count(need)}`;
    case "clear":
      return `通关${difficulties[unlock.difficulty].name}`;
    case "distinctClears":
      return `不同伙伴通关${unlock.difficulty > 0 ? difficulties[unlock.difficulty].name : ""} ${have} / ${need}`;
  }
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
