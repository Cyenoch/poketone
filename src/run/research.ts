import type { Progress } from "./progress";
import type { EnemyId } from "./sim/content/enemies";
import { researchTasks } from "./sim/content/dex-research";

export function researchOf(dex: Progress["dex"], species: EnemyId) {
  const entry = dex[species];
  const tiers = researchTasks(species);
  const tasks = (["seen", "defeated", "shiny"] as const).flatMap((kind) => {
    const count = entry?.[kind] ?? 0;
    return tiers[kind].map(([target, points]) => ({
      kind,
      target,
      count,
      points,
      earned: count >= target,
    }));
  });
  const max = 10 as const;
  const points = Math.min(
    max,
    tasks.reduce((sum, t) => sum + (t.earned ? t.points : 0), 0),
  );
  return { points, max, done: points === max, seen: (entry?.seen ?? 0) > 0, tasks };
}

export function researchedCount(dex: Progress["dex"]): number {
  return (Object.keys(dex) as EnemyId[]).filter((id) => researchOf(dex, id).done).length;
}
