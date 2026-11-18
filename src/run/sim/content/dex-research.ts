import type { EnemyId } from "./enemies";
import { stageDefs } from "./stages/index";
import { RESEARCH, DEFEAT_TARGETS, FISHING_RESEARCH, researchTrack } from "./params/research";

const zones = Object.values(stageDefs).flatMap((stage) => stage.zones);
const guardians = new Set(zones.map((zone) => zone.guardian.species));
const ordinary = new Set(zones.flatMap((zone) => zone.roster.map(([, id]) => id)));
export function researchClass(species: EnemyId): keyof typeof RESEARCH {
  if (guardians.has(species)) return "guardian";
  return species === "magikarp" || ordinary.has(species) ? "ordinary" : "elite";
}

const defeatTargets = new Map<EnemyId, number>(
  Object.entries(DEFEAT_TARGETS).flatMap(([top, ids]) =>
    ids.map((id) => [id, Number(top)] as const),
  ),
);
export function researchTasks(species: EnemyId) {
  if (species === "magikarp") return FISHING_RESEARCH;
  const top = defeatTargets.get(species);
  if (top !== undefined) return researchTrack(top);
  return RESEARCH[researchClass(species)];
}
