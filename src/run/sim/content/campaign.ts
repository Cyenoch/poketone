import { stageDefs, type StageId } from "./stages/index";
import type { World } from "../state/world";
import { TICK } from "../state/world";

/** The expedition's six fields, one per map. */
export const STAGE_ROUTE: readonly StageId[] = [
  "forest",
  "desert",
  "coast",
  "glacier",
  "volcano",
  "tower",
];

export const CAMPAIGN_FIELDS = STAGE_ROUTE.flatMap((stage) =>
  stageDefs[stage].zones.map((_, zone) => ({ stage, zone })),
);

export function nextField(
  world: Pick<World, "stage" | "zone">,
): { stage: StageId; zone: number } | null {
  const stage = STAGE_ROUTE[STAGE_ROUTE.indexOf(world.stage) + 1];
  return stage ? { stage, zone: 0 } : null;
}

/** Continuous route progress, with each map occupying one sixth. */
export function routeProgress(world: Pick<World, "stage" | "zone">): number {
  const stage = stageDefs[world.stage];
  const local = Math.min(1, (world.zone.tick * TICK) / stage.duration);
  return (STAGE_ROUTE.indexOf(world.stage) + local) / STAGE_ROUTE.length;
}
