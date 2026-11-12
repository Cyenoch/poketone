import { cellCenterX, cellCenterZ, cellIndex, gridCoord, type NavGrid } from "./grid";
import type { Nav } from "./nav";

export type Blocker =
  | { id: number; kind: "circle"; x: number; z: number; radius: number }
  | { id: number; kind: "cells"; cells: readonly number[] };

/** Routes keep a typical body radius from blockers; bodies test the exact circle or cell square. */
const ROUTE_CLEARANCE = 0.5;
/** Exact circle tests run for bodies up to radius ≈1.6 (margin minus half a cell diagonal). */
const NEAR_MARGIN = 2;

/** Solid round prop (rock, tree, future totem). Returns the id for `removeBlocker`. */
export function addCircleBlocker(nav: Nav, x: number, z: number, radius: number): number {
  const blocker: Blocker = { id: nav.nextBlockerId++, kind: "circle", x, z, radius };
  nav.blockers.push(blocker);
  applyCircle(nav.grid, blocker, 1);
  markFieldsDirty(nav);
  return blocker.id;
}

/** Hard block on a set of cell ids (from `cellAt`), e.g. a wall segment. Returns the id for `removeBlocker`. */
export function addCellBlocker(nav: Nav, cells: readonly number[]): number {
  const blocker: Blocker = { id: nav.nextBlockerId++, kind: "cells", cells: [...cells] };
  nav.blockers.push(blocker);
  applyCells(nav.grid, blocker.cells, 1);
  markFieldsDirty(nav);
  return blocker.id;
}

export function removeBlocker(nav: Nav, id: number): void {
  const index = nav.blockers.findIndex((blocker) => blocker.id === id);
  const blocker = nav.blockers[index];
  if (!blocker) throw new Error(`导航阻挡 ${id} 不存在。`);
  nav.blockers.splice(index, 1);
  if (blocker.kind === "circle") applyCircle(nav.grid, blocker, -1);
  else applyCells(nav.grid, blocker.cells, -1);
  markFieldsDirty(nav);
}

/** Routes clear a typical body's radius, while `hard` remains the exact visible square. */
function applyCells(grid: NavGrid, cells: readonly number[], delta: 1 | -1): void {
  const reach = Math.ceil(ROUTE_CLEARANCE / grid.cell);
  for (const cell of cells) {
    grid.hard[cell]! += delta;
    const cx = (cell % grid.stride) - 1;
    const cz = Math.floor(cell / grid.stride) - 1;
    for (let gz = Math.max(0, cz - reach); gz <= Math.min(grid.size - 1, cz + reach); gz++) {
      for (let gx = Math.max(0, cx - reach); gx <= Math.min(grid.size - 1, cx + reach); gx++) {
        const dx = Math.max(0, Math.abs(gx - cx) * grid.cell - grid.cell / 2);
        const dz = Math.max(0, Math.abs(gz - cz) * grid.cell - grid.cell / 2);
        if (dx * dx + dz * dz < ROUTE_CLEARANCE ** 2) grid.soft[cellIndex(grid, gx, gz)]! += delta;
      }
    }
  }
}

/** Deepest circle/square overlap, shared by movement and final body-fit acceptance. */
export function cellWallOverlap(
  grid: NavGrid,
  x: number,
  z: number,
  radius: number,
): { x: number; z: number; depth: number } | null {
  let contact: { x: number; z: number; depth: number } | null = null;
  const half = grid.cell / 2;
  for (let gz = gridCoord(grid, z - radius); gz <= gridCoord(grid, z + radius); gz++) {
    for (let gx = gridCoord(grid, x - radius); gx <= gridCoord(grid, x + radius); gx++) {
      const cell = cellIndex(grid, gx, gz);
      if (grid.hard[cell] === 0) continue;
      const ox = x - cellCenterX(grid, cell);
      const oz = z - cellCenterZ(grid, cell);
      const dx = ox - Math.max(-half, Math.min(half, ox));
      const dz = oz - Math.max(-half, Math.min(half, oz));
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance >= radius) continue;
      const depth =
        distance > 0 ? radius - distance : radius + half - Math.max(Math.abs(ox), Math.abs(oz));
      if (contact && depth <= contact.depth) continue;
      contact =
        distance > 0
          ? { x: dx / distance, z: dz / distance, depth }
          : Math.abs(ox) >= Math.abs(oz)
            ? { x: ox >= 0 ? 1 : -1, z: 0, depth }
            : { x: 0, z: oz >= 0 ? 1 : -1, depth };
    }
  }
  return contact;
}

/** Reference-counts route coverage and movement reach so overlapping blockers come and go independently. */
function applyCircle(
  grid: NavGrid,
  circle: { x: number; z: number; radius: number },
  delta: 1 | -1,
): void {
  const reach = circle.radius + NEAR_MARGIN;
  const route = (circle.radius + ROUTE_CLEARANCE) ** 2;
  const minX = gridCoord(grid, circle.x - reach);
  const maxX = gridCoord(grid, circle.x + reach);
  const minZ = gridCoord(grid, circle.z - reach);
  const maxZ = gridCoord(grid, circle.z + reach);
  for (let gz = minZ; gz <= maxZ; gz++) {
    for (let gx = minX; gx <= maxX; gx++) {
      const dx = grid.min + gx * grid.cell - circle.x;
      const dz = grid.min + gz * grid.cell - circle.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > reach * reach) continue;
      const cell = cellIndex(grid, gx, gz);
      grid.near[cell]! += delta;
      if (d2 <= route) grid.soft[cell]! += delta;
    }
  }
}

/** Fields restart on their next refresh; pass masks are terrain-only, so blockers never rebuild them. */
function markFieldsDirty(nav: Nav): void {
  for (const layer of nav.layers) if (layer.field) layer.field.dirty = true;
}
