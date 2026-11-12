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
