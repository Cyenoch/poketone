import { cellIndex, gridCoord, routeBlocked, routeStep } from "./grid";
import { layerFor, type Nav } from "./nav";
import type { MobilityProfile } from "./profiles";
import { WALKABLE } from "./walkable";
import { hypot } from "../math";
import { cellWallOverlap } from "./blockers";

/**
 * Cells (padded layout) a walker can reach from any of `from` (`toward` false), or that can reach
 * one of them (`toward` true), by the routes' own rule: terrain pass mask, blockers, no cut corners.
 * Blocked cells are never entered. Uses its own buffers and never touches flow-field state.
 */
export function routeReach(
  nav: Nav,
  profile: MobilityProfile,
  from: readonly number[],
  toward: boolean,
): Uint8Array {
  const { grid } = nav;
  const { pass } = layerFor(nav, profile);
  const seen = new Uint8Array(pass.length);
  const queue: number[] = [];
  for (const cell of from) {
    if (seen[cell] === 1 || routeBlocked(grid, cell)) continue;
    seen[cell] = 1;
    queue.push(cell);
  }
  while (queue.length > 0) {
    const cell = queue.pop()!;
    for (let d = 0; d < 8; d++) {
      const other = toward ? cell - grid.offset[d]! : cell + grid.offset[d]!;
      if (seen[other] === 1) continue;
      if (!routeStep(grid, pass, toward ? other : cell, d, false)) continue;
      if (toward && routeBlocked(grid, other)) continue;
      seen[other] = 1;
      queue.push(other);
    }
  }
  return seen;
}

/**
 * Whether a body of `radius` can stand at (x, z): terrain samples under it are walkable for the
 * class, and its whole circle overlaps neither a blocked cell's square nor a circle blocker.
 */
export function bodyFits(
  nav: Nav,
  profile: MobilityProfile,
  x: number,
  z: number,
  radius: number,
): boolean {
  const { grid } = nav;
  const { kinds } = layerFor(nav, profile);
  if (cellWallOverlap(grid, x, z, radius)) return false;
  for (const blocker of nav.blockers) {
    if (blocker.kind === "circle" && hypot(blocker.x - x, blocker.z - z) < blocker.radius + radius)
      return false;
  }
  for (let gz = gridCoord(grid, z - radius); gz <= gridCoord(grid, z + radius); gz++) {
    for (let gx = gridCoord(grid, x - radius); gx <= gridCoord(grid, x + radius); gx++) {
      const dx = grid.min + gx * grid.cell - x;
      const dz = grid.min + gz * grid.cell - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      const cell = cellIndex(grid, gx, gz);
      if (kinds[cell] !== WALKABLE) return false;
    }
  }
  return true;
}
