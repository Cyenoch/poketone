import { starterUnlocked, unlockedDifficulty, type Progress } from "./run/progress";
import { difficulties, type Difficulty } from "./run/sim/content/difficulties";
import { starterOrder, type StarterId } from "./run/sim/content/lines/index";
import type { StageId } from "./run/sim/content/stages/index";

/** The lobby's last pick: a per-browser preference, outside the exported save. */
export interface LobbyPick {
  starter: StarterId;
  difficulty: Difficulty;
  stage: StageId;
}

const KEY = "poketone.lobby.v1";

/** Formal expeditions always begin at the first map. */
export const playableStages: readonly StageId[] = ["forest"];

/** The stored pick as far as it still reads; anything unreadable is simply absent. */
export function loadPick(): Partial<LobbyPick> {
  try {
    return parsePick(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return {};
  }
}

export function parsePick(value: unknown): Partial<LobbyPick> {
  if (typeof value !== "object" || value === null) return {};
  const { starter, difficulty, stage } = value as Record<string, unknown>;
  return {
    starter: starterOrder.includes(starter as StarterId) ? (starter as StarterId) : undefined,
    difficulty:
      typeof difficulty === "number" && difficulties[difficulty]
        ? (difficulty as Difficulty)
        : undefined,
    stage: playableStages.includes(stage as StageId) ? (stage as StageId) : undefined,
  };
}

export function savePick(pick: LobbyPick): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pick));
  } catch {
    // A convenience: an unwritable store keeps the pick for this session only.
  }
}

/** `pick` where the progress allows it: a partner not yet joined falls back to the first one that
 *  has, a difficulty not yet unlocked to 普通, a map no longer offered to the first one. */
export function validPick(progress: Progress, pick: Partial<LobbyPick>): LobbyPick {
  const starter =
    pick.starter && starterUnlocked(progress, pick.starter)
      ? pick.starter
      : starterOrder.find((id) => starterUnlocked(progress, id))!;
  const difficulty =
    pick.difficulty !== undefined && pick.difficulty <= unlockedDifficulty(progress)
      ? pick.difficulty
      : 0;
  const stage = pick.stage && playableStages.includes(pick.stage) ? pick.stage : playableStages[0]!;
  return { starter, difficulty, stage };
}
