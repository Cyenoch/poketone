import { cellAt, steepnessAt, type Nav, type TerrainMask } from "../nav/index";
import type { Terrain } from "../terrain";
import { sampleSurface } from "../surface";

/** Read-only view of one terrain for site checks: its nav grid, ground walls and reachability. */
export interface SiteContext {
  terrain: Terrain;
  nav: Nav;
  walls: TerrainMask;
  /**
   * Padded nav cells reachable from spawn with static walls, before props/stations: a site filter
   * only. The final guarantee is `checkPlayable` on the assembled nav.
   */
  reachable: Uint8Array;
}

/** Calls `visit` for every terrain sample within `radius` of (x, z) with its index and distance. */
export function forEachSample(
  terrain: Terrain,
  x: number,
  z: number,
  radius: number,
  visit: (index: number, distance: number) => void,
): void {
  const { origin, resolution, samples } = terrain;
  const i0 = Math.max(0, Math.ceil((x - radius - origin) * resolution));
  const i1 = Math.min(samples - 1, Math.floor((x + radius - origin) * resolution));
  const j0 = Math.max(0, Math.ceil((z - radius - origin) * resolution));
  const j1 = Math.min(samples - 1, Math.floor((z + radius - origin) * resolution));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = origin + i / resolution - x;
      const dz = origin + j / resolution - z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance <= radius) visit(j * samples + i, distance);
    }
  }
}

/** Whether a ground wall cell lies within `radius` of (x, z). */
export function wallNear(walls: TerrainMask, x: number, z: number, radius: number): boolean {
  const reach = Math.ceil(radius / walls.cellSize);
  const ci = Math.round((x - walls.originX) / walls.cellSize);
  const cj = Math.round((z - walls.originZ) / walls.cellSize);
  for (let j = cj - reach; j <= cj + reach; j++) {
    for (let i = ci - reach; i <= ci + reach; i++) {
      if (i < 0 || j < 0 || i >= walls.width || j >= walls.height) continue;
      const dx = walls.originX + i * walls.cellSize - x;
      const dz = walls.originZ + j * walls.cellSize - z;
      if (dx * dx + dz * dz <= radius * radius && walls.data[j * walls.width + i] !== 0)
        return true;
    }
  }
  return false;
}

/** Steepest terrain and height spread over the samples within `radius` of (x, z). */
export function relief(context: SiteContext, x: number, z: number, radius: number) {
  let steepest = 0;
  let low = Infinity;
  let high = -Infinity;
  forEachSample(context.terrain, x, z, radius, (index) => {
    const { origin, resolution, samples, heights } = context.terrain;
    const sx = origin + (index % samples) / resolution;
    const sz = origin + Math.floor(index / samples) / resolution;
    steepest = Math.max(steepest, steepnessAt(context.nav.grid, sx, sz));
    low = Math.min(low, heights[index]!);
    high = Math.max(high, heights[index]!);
  });
  return { steepest, spread: high - low };
}

export function reachableAt(context: SiteContext, x: number, z: number): boolean {
  return context.reachable[cellAt(context.nav.grid, x, z)] === 1;
}

/** Sites must keep their entire footprint clear of static liquids (walkable lava too) and surface patches. */
export function drySite(context: SiteContext, x: number, z: number, radius: number): boolean {
  let dry = true;
  forEachSample(context.terrain, x, z, radius, (index) => {
    if (!dry) return;
    const { origin, resolution, samples } = context.terrain;
    const surface = sampleSurface(
      context.terrain.surface,
      origin + (index % samples) / resolution,
      origin + Math.floor(index / samples) / resolution,
    );
    if (surface.kind === "water" || surface.kind === "lava" || surface.patch) dry = false;
  });
  return dry;
}
