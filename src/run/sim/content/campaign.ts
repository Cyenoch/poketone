import { stageDefs, type StageId } from "./stages/index";
import { TICK, type World } from "../state/world";
import { TOWER, towerPosition, towerRouteStep } from "./params/tower";

export const ROUTE_TIERS = [
  ["forest"],
  ["desert", "coast"],
  ["glacier", "volcano"],
  ["tower"],
] as const;
export type RouteStep = 0 | 1 | 2 | 3;

/** Stable map identity for seed derivation, independent of expedition progress. */
export const STAGE_INDEX = {
  forest: 0,
  desert: 1,
  coast: 2,
  glacier: 3,
  volcano: 4,
  tower: 5,
} as const satisfies Record<StageId, number>;

export const ALL_ROUTES = ROUTE_TIERS[1].flatMap((middle) =>
  ROUTE_TIERS[2].map((late) => ["forest", middle, late, "tower"] as const),
);

/** Only a fresh forest start has an implicit history. */
export function initialRoute(stage: StageId, route?: readonly StageId[]): StageId[] {
  if (route === undefined && stage === "forest") return [stage];
  if (
    !route ||
    route.at(-1) !== stage ||
    !route.every((id, i) => ROUTE_TIERS[i]?.some((allowed) => allowed === id))
  )
    throw new Error(
      `关卡 ${stage} 需要以当前地图结尾的合法路线前缀：${route?.join(" → ") ?? "未提供"}。`,
    );
  return [...route];
}

/** Discrete tier for authored rules such as level caps and guardian attack patterns. */
export function routeStep(world: Pick<World, "mode" | "route">): RouteStep {
  if (world.mode === "tower") return towerRouteStep(world.route.length);
  return (world.route.length - 1) as RouteStep;
}

export function routeFields(route: readonly StageId[]) {
  return route.map((stage, step) => ({ stage, zone: 0, step: step as RouteStep }));
}

export function nextField(world: Pick<World, "zone">): { stage: StageId; zone: number } | null {
  const { exits, leaving } = world.zone;
  const stage = leaving === null ? null : exits[leaving]?.to;
  return stage ? { stage, zone: 0 } : null;
}

/** Accepting the exit passes this floor even while the next map is still loading. */
export function passedTowerFloors(world: Pick<World, "route" | "zone">): number {
  return world.zone.phase === "transitioning" ? world.route.length : world.route.length - 1;
}

export function routeProgress(world: Pick<World, "mode" | "stage" | "zone" | "route">): number {
  const time = world.zone.tick * TICK;
  if (world.mode === "tower") {
    const floor = world.route.length + Math.min(1, time / TOWER.floorSeconds);
    return Math.min(1, towerPosition(floor) / ROUTE_TIERS.length);
  }
  const local = Math.min(1, time / stageDefs[world.stage].duration);
  return (routeStep(world) + local) / ROUTE_TIERS.length;
}
