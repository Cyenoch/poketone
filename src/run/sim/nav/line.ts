import { EAST, NORTH, SOUTH, WEST, cellIndex, routeStep, type NavGrid } from "./grid";
import { layerFor, type Nav } from "./nav";
import type { MobilityProfile } from "./profiles";

/** Diagonal direction index for a step of (sx, sz). */
const DIAGONAL = (sx: number, sz: number) => (sx > 0 ? (sz > 0 ? 4 : 5) : sz > 0 ? 6 : 7);

/** Continuous grid coordinate where cell g spans [g, g + 1), clamped to the arena. */
function toGrid(grid: NavGrid, value: number): number {
  return Math.min(grid.size - 0.000001, Math.max(0, (value - grid.min) / grid.cell + 0.5));
}

/**
 * True when the profile can walk the straight segment under the same rules as flow fields and A*:
 * every cell boundary the segment crosses is checked in walking direction (so uphill and downhill
 * differ), blockers are avoided, and an exact corner crossing needs both L-shaped detours clear.
 */
export function hasWalkableLine(
  nav: Nav,
  profile: MobilityProfile,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  if (profile.flying) return true;
  const { grid } = nav;
  const { pass } = layerFor(nav, profile);
  const ua = toGrid(grid, ax);
  const va = toGrid(grid, az);
  const ub = toGrid(grid, bx);
  const vb = toGrid(grid, bz);
  const gx = Math.floor(ua);
  const gz = Math.floor(va);
  let stepsX = Math.abs(Math.floor(ub) - gx);
  let stepsZ = Math.abs(Math.floor(vb) - gz);
  const sx = ub > ua ? 1 : -1;
  const sz = vb > va ? 1 : -1;
  const deltaX = stepsX > 0 ? 1 / Math.abs(ub - ua) : Infinity;
  const deltaZ = stepsZ > 0 ? 1 / Math.abs(vb - va) : Infinity;
  let nextX = stepsX > 0 ? (sx > 0 ? gx + 1 - ua : ua - gx) * deltaX : Infinity;
  let nextZ = stepsZ > 0 ? (sz > 0 ? gz + 1 - va : va - gz) * deltaZ : Infinity;
  let cell = cellIndex(grid, gx, gz);
  while (stepsX > 0 || stepsZ > 0) {
    let d: number;
    if (stepsZ === 0 || (stepsX > 0 && nextX < nextZ)) {
      d = sx > 0 ? EAST : WEST;
      nextX += deltaX;
      stepsX--;
    } else if (stepsX === 0 || nextZ < nextX) {
      d = sz > 0 ? SOUTH : NORTH;
      nextZ += deltaZ;
      stepsZ--;
    } else {
      d = DIAGONAL(sx, sz);
      nextX += deltaX;
      nextZ += deltaZ;
      stepsX--;
      stepsZ--;
    }
    if (!routeStep(grid, pass, cell, d, stepsX === 0 && stepsZ === 0)) return false;
    cell += grid.offset[d]!;
  }
  return true;
}
