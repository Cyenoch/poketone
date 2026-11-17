import { chance, next, type Rng } from "../rng";
import type { MarkerId, ModifierId } from "../state/route";
import { MARKER_WEIGHTS, MODIFIER_WEIGHTS, ROUTE_REWARD } from "./params/route";
import type { StageId } from "./stages/index";

export const routeMarkers = {
  chests: { name: "宝箱", icon: "chest" },
  "elite-nest": { name: "精英巢", icon: "elite" },
  pokecenter: { name: "宝可梦中心", icon: "heal" },
  research: { name: "研究资料", icon: "stardust" },
  "gengar-deal": { name: "耿鬼的交易", icon: "gengar-deal" },
} as const satisfies Record<MarkerId, { name: string; icon: string }>;

export const routeModifiers = {
  "dark-cave": { name: "黑暗洞穴", icon: "dark-cave" },
  fog: { name: "浓雾", icon: "fog" },
  "boss-sighting": { name: "头目出没", icon: "elite" },
} as const satisfies Record<ModifierId, { name: string; icon: string }>;

function draw<Id extends string>(rng: Rng, ids: Id[], weights: Record<Id, number>): Id {
  let r = next(rng) * ids.reduce((sum, id) => sum + weights[id], 0);
  const chosen = ids.find((id) => (r -= weights[id]) < 0);
  if (!chosen) throw new Error("没有可抽取的路线条目。");
  return chosen;
}

export function markerAllowed(marker: MarkerId, stage: StageId): boolean {
  if (stage === "forest") return false;
  if (marker === "gengar-deal")
    return stage === "glacier" || stage === "volcano" || stage === "tower";
  return marker !== "pokecenter" || stage !== "tower";
}

export function rollExitMarkers(rng: Rng, targets: readonly StageId[]): MarkerId[] {
  const result: MarkerId[] = [];
  for (const to of targets) {
    const eligible = (Object.keys(MARKER_WEIGHTS) as MarkerId[]).filter(
      (id) => !result.includes(id) && markerAllowed(id, to),
    );
    result.push(draw(rng, eligible, MARKER_WEIGHTS));
  }
  return result;
}

export function rollRouteModifier(rng: Rng, step: number): ModifierId | null {
  const odds = ROUTE_REWARD.modifierChance[step];
  return odds && chance(rng, odds)
    ? draw(rng, Object.keys(MODIFIER_WEIGHTS) as ModifierId[], MODIFIER_WEIGHTS)
    : null;
}
