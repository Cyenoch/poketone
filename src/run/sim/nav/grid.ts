import type { Terrain } from "../terrain";
import { ARENA_HALF } from "../state/world";
import { sampleSurface, type SurfaceGrid } from "../surface";

/**
 * Neighbour order shared by every nav routine: four orthogonal steps (bits 0–3), then four
 * diagonals (bits 4–7). Indices double as bit positions in the per-profile pass masks.
 */
export const DIR_X = [1, -1, 0, 0, 1, 1, -1, -1] as const;
export const DIR_Z = [0, 0, 1, -1, 1, -1, 1, -1] as const;
export const DIR_LENGTH = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2] as const;
export const EAST = 0;
export const WEST = 1;
export const SOUTH = 2;
export const NORTH = 3;
/** For diagonal `d`, the orthogonal steps whose L-shaped paths make it up. */
export const DIAGONAL_X = [0, 0, 0, 0, EAST, EAST, WEST, WEST] as const;
export const DIAGONAL_Z = [0, 0, 0, 0, SOUTH, NORTH, SOUTH, NORTH] as const;

/**
 * Cells sit on terrain samples (0.5 u apart) and cover the playable square, padded by a one-cell
 * wall so neighbour lookups never leave the arrays. Indices are `(gz + 1) * stride + gx + 1`.
 */
export interface NavGrid {
  /** Playable cells per side. */
  size: number;
  /** Row length including the wall border. */
  stride: number;
  /** World units per cell. */
  cell: number;
  /** World coordinate of the first playable cell centre on both axes. */
  min: number;
  /** Arena-centre cell (the level spawn clearing); every walkable cell must be able to walk back here. */
  home: number;
  /** Index delta per direction. */
  offset: Int32Array;
  height: Float32Array;
  /** Terrain steepness per cell: gradient magnitude by central differences (rise per unit along the fall line). */
  steepness: Float32Array;
  waterDepth: Float32Array;
  surface: SurfaceGrid | undefined;
  /** Cell-set blockers covering the cell: no body or route may enter. */
  hard: Uint16Array;
  /** Circle blockers covering the cell (inflated by route clearance): routes avoid it, bodies test the exact circle. */
  soft: Uint16Array;
  /** Circle blockers within body reach: movement runs exact circle tests only here. */
  near: Uint16Array;
}

export function createNavGrid(terrain: Terrain): NavGrid {
  const first = (-ARENA_HALF - terrain.origin) * terrain.resolution;
  const size = ARENA_HALF * 2 * terrain.resolution + 1;
  if (!Number.isInteger(first) || first < 1 || first + size + 1 > terrain.samples) {
    throw new Error(
      `导航网格需要与竞技场对齐且留有边距的地形采样：起点 ${first}，采样 ${terrain.samples}。`,
    );
  }
  const stride = size + 2;
  const cells = stride * stride;
  const cell = 1 / terrain.resolution;
  const sample = (gx: number, gz: number) =>
    terrain.heights[(gz + first) * terrain.samples + gx + first]!;
  const height = new Float32Array(cells);
  const steepness = new Float32Array(cells);
  const waterDepth = new Float32Array(cells);
  for (let gz = -1; gz <= size; gz++) {
    for (let gx = -1; gx <= size; gx++) {
      const index = (gz + 1) * stride + gx + 1;
      height[index] = sample(gx, gz);
      if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
      const slopeX = (sample(gx + 1, gz) - sample(gx - 1, gz)) / (2 * cell);
      const slopeZ = (sample(gx, gz + 1) - sample(gx, gz - 1)) / (2 * cell);
      steepness[index] = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);
      waterDepth[index] = sampleSurface(
        terrain.surface,
        -ARENA_HALF + gx * cell,
        -ARENA_HALF + gz * cell,
      ).waterDepth;
    }
  }
  // `size` is odd, so the arena centre is a cell centre.
  const center = (size - 1) / 2;
  const offset = new Int32Array(8);
  for (let d = 0; d < 8; d++) offset[d] = DIR_Z[d]! * stride + DIR_X[d]!;
  return {
    size,
    stride,
    cell,
    min: -ARENA_HALF,
    home: (center + 1) * stride + center + 1,
    offset,
    height,
    steepness,
    waterDepth,
    surface: terrain.surface,
    hard: new Uint16Array(cells),
    soft: new Uint16Array(cells),
    near: new Uint16Array(cells),
  };
}

/** Playable cell coordinate of a world position on one axis, clamped to the arena. */
export function gridCoord(grid: NavGrid, value: number): number {
  return Math.min(grid.size - 1, Math.max(0, Math.floor((value - grid.min) / grid.cell + 0.5)));
}

export function cellIndex(grid: NavGrid, gx: number, gz: number): number {
  return (gz + 1) * grid.stride + gx + 1;
}

/** Cell id of a world position, clamped to the arena. Ids are what cell blockers take. */
export function cellAt(grid: NavGrid, x: number, z: number): number {
  return cellIndex(grid, gridCoord(grid, x), gridCoord(grid, z));
}

export function cellCenterX(grid: NavGrid, cell: number): number {
  return grid.min + ((cell % grid.stride) - 1) * grid.cell;
}

export function cellCenterZ(grid: NavGrid, cell: number): number {
  return grid.min + (Math.floor(cell / grid.stride) - 1) * grid.cell;
}

/** Bilinear sample of a per-cell field at a world position, clamped to the arena. */
export function sampleField(grid: NavGrid, field: Float32Array, x: number, z: number): number {
  const u = Math.min(grid.size - 1, Math.max(0, (x - grid.min) / grid.cell));
  const v = Math.min(grid.size - 1, Math.max(0, (z - grid.min) / grid.cell));
  const i = Math.min(grid.size - 2, Math.floor(u));
  const j = Math.min(grid.size - 2, Math.floor(v));
  const fx = u - i;
  const fz = v - j;
  const at = (j + 1) * grid.stride + i + 1;
  const a = field[at]!;
  const b = field[at + 1]!;
  const c = field[at + grid.stride]!;
  const d = field[at + grid.stride + 1]!;
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Terrain steepness at a world position (bilinear between cell centres). */
export function steepnessAt(grid: NavGrid, x: number, z: number): number {
  return sampleField(grid, grid.steepness, x, z);
}

export function routeBlocked(grid: NavGrid, cell: number): boolean {
  return grid.hard[cell]! + grid.soft[cell]! > 0;
}

/**
 * Whether a route may step from `cell` in direction `d` given a terrain pass mask. Entering a
 * blocked cell is allowed only when it is the goal (a target hugging a rock stays reachable);
 * diagonals also need both side cells clear so routes never cut a blocker's corner.
 */
export function routeStep(
  grid: NavGrid,
  pass: Uint8Array,
  cell: number,
  d: number,
  intoGoal: boolean,
): boolean {
  if ((pass[cell]! & (1 << d)) === 0) return false;
  if (!intoGoal && routeBlocked(grid, cell + grid.offset[d]!)) return false;
  if (d < 4) return true;
  return (
    !routeBlocked(grid, cell + grid.offset[DIAGONAL_X[d]!]!) &&
    !routeBlocked(grid, cell + grid.offset[DIAGONAL_Z[d]!]!)
  );
}
