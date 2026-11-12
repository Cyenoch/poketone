import type { World } from "../../sim/state/world";

/** Shrubs shelter under palms and reefs; the exposed beach stays open. */
export function coastShrubSite(world: Readonly<World>, x: number, z: number): boolean {
  return world.map.obstacles.some(
    (o) =>
      (o.kind === "rock" || o.kind === "palm") && Math.hypot(o.x - x, o.z - z) < o.radius + 2.8,
  );
}
