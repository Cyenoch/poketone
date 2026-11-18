import { unlocks, unlockIds, type UnlockDef } from "./sim/content/unlocks";
import { researchOf, researchedCount } from "./research";
import { starterUnlocked, unlockedDifficulty, type Progress } from "./progress";
import { difficulties } from "./sim/content/difficulties";
import { starterOrder, starters } from "./sim/content/lines/index";

export function runUnlocks(previous: Progress, progress: Progress): string | null {
  const notes: string[] = [];
  const after = unlockedDifficulty(progress);
  if (after > unlockedDifficulty(previous)) notes.push(`解锁难度「${difficulties[after].name}」`);
  for (const id of starterOrder) {
    if (!starterUnlocked(previous, id) && starterUnlocked(progress, id))
      notes.push(`${starters[id].stages[0].form.name} 加入`);
  }
  return notes.length > 0 ? notes.join(" · ") : null;
}

export function unlockStatus(progress: Progress) {
  const count = researchedCount(progress.dex);
  const met = (requires: UnlockDef["requires"]) => {
    if ("research" in requires) return researchOf(progress.dex, requires.research).done;
    if ("researched" in requires) return count >= requires.researched;
    if ("badges" in requires) return progress.badges.length >= requires.badges;
    return progress.clears[requires.clears] > 0;
  };
  return unlockIds.map((id) => ({
    ...unlocks[id],
    unlocked: progress.unlocks.includes(id),
    met: met(unlocks[id].requires),
  }));
}
