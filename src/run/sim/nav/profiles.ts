import { mobilityClasses } from "../content/mobility";
import { DIAGONAL_X, DIAGONAL_Z, DIR_X, DIR_Z, cellIndex, type NavGrid } from "./grid";
import { ONE_WAY, WALKABLE, classifyTerrain } from "./walkable";
import type { FlowField } from "./flow";
import { layerFor, type Nav } from "./nav";

/**
 * How a class of units copes with terrain. Slopes are rise per unit of horizontal travel; terrain
 * steepness is the gradient magnitude (rise per unit along the fall line), so a cliff face stays
 * a face whichever way a step approaches it.
 */
export interface MobilityProfile {
  /** Ground steeper than this is a wall (after the classification cleans up specks and pockets). */
  climb: number;
  /** A wall whose face never gets steeper than this can be walked down; above `climb`, so downhill is easier. */
  drop: number;
  /** Passes over terrain and solid props; never builds a nav layer. */
  flying?: boolean;
  /**
   * How water bounds it (nav/walkable.ts): absent, water deeper than `WADE_DEPTH` is a wall; `swim`,
   * only water at least `SWIM_DEPTH` deep is walkable; `both` (amphibious), water bounds nothing.
   */
  water?: "swim" | "both";
}

/** One walker class: its terrain classification and pass mask plus, once an enemy asks, its flow field. */
export interface NavLayer {
  profile: MobilityProfile;
  /** `WALKABLE`, `ONE_WAY` or `SHEER` per cell (padded layout), computed once from the terrain. */
  kinds: Uint8Array;
  /**
   * Signed distance in cells to the wall edge (+ on walkable cells, − inside walls), sampled
   * bilinearly. Its zero line is the wall bodies collide with and its gradient the normal they slide
   * along; it stays smooth across one-cell strips and staircase diagonals.
   */
  wallDistance: Float32Array;
  /** Bit `d` set when terrain lets this class step from the cell in direction `d` (blockers checked separately). */
  pass: Uint8Array;
  /** 1 where the class can walk back to the grid's home cell; movement never leaves this set once in it. */
  homeward: Uint8Array;
  field: FlowField | null;
}

export function sameProfile(a: MobilityProfile, b: MobilityProfile): boolean {
  return (
    a.climb === b.climb &&
    a.drop === b.drop &&
    Boolean(a.flying) === Boolean(b.flying) &&
    a.water === b.water
  );
}

/**
 * The single terrain rule for routes and bodies, on the classified cells:
 * - from a wall cell (shoved onto a face), any step that does not gain height, so nobody is stuck;
 * - between walkable cells, always — the classification already decided, no per-step grade veto;
 * - onto a wall only down a `ONE_WAY` face; `SHEER` walls block both ways.
 */
export function terrainStep(rise: number, fromWall: boolean, toKind: number): boolean {
  if (fromWall) return rise <= 0;
  if (toKind === WALKABLE) return true;
  return toKind === ONE_WAY && rise < 0;
}

export function createLayer(grid: NavGrid, profile: MobilityProfile): NavLayer {
  const kinds = classifyTerrain(grid, profile);
  // A swimmer is never out of water (the mover keeps it in its homeward sea), so a shore cell gives
  // it no steps: no route, field or spawn ever starts on land.
  const stranded = profile.water === "swim";
  const pass = new Uint8Array(grid.stride * grid.stride);
  const { size, height, offset } = grid;
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const cell = cellIndex(grid, gx, gz);
      const fromWall = kinds[cell] !== WALKABLE;
      if (fromWall && stranded) continue;
      let bits = 0;
      for (let d = 0; d < 4; d++) {
        const nx = gx + DIR_X[d]!;
        const nz = gz + DIR_Z[d]!;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        const next = cell + offset[d]!;
        if (terrainStep(height[next]! - height[cell]!, fromWall, kinds[next]!)) bits |= 1 << d;
      }
      pass[cell] = bits;
    }
  }
  const homeward = pruneTraps(grid, pass, homeCell(grid, kinds));
  addDiagonals(grid, pass);
  const wallDistance = signedWallDistance(grid, kinds);
  return { profile, kinds, wallDistance, pass, homeward, field: null };
}

function signedWallDistance(grid: NavGrid, kinds: Uint8Array): Float32Array {
  const toWall = chamfer(grid.stride, (cell) => kinds[cell] !== WALKABLE);
  const toFloor = chamfer(grid.stride, (cell) => kinds[cell] === WALKABLE);
  const out = new Float32Array(kinds.length);
  for (let cell = 0; cell < kinds.length; cell++)
    out[cell] = kinds[cell] === WALKABLE ? toWall[cell]! - 0.5 : 0.5 - toFloor[cell]!;
  return out;
}

/** Two-pass chamfer distance (1 orthogonal, √2 diagonal) on an n × n grid to the nearest source cell. */
function chamfer(n: number, isSource: (cell: number) => boolean): Float32Array {
  const d = new Float32Array(n * n);
  for (let cell = 0; cell < d.length; cell++) d[cell] = isSource(cell) ? 0 : Infinity;
  const relax = (cell: number, from: number, cost: number) => {
    const via = d[from]! + cost;
    if (via < d[cell]!) d[cell] = via;
  };
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const cell = z * n + x;
      if (x > 0) relax(cell, cell - 1, 1);
      if (z > 0) {
        relax(cell, cell - n, 1);
        if (x > 0) relax(cell, cell - n - 1, Math.SQRT2);
        if (x < n - 1) relax(cell, cell - n + 1, Math.SQRT2);
      }
    }
  }
  for (let z = n - 1; z >= 0; z--) {
    for (let x = n - 1; x >= 0; x--) {
      const cell = z * n + x;
      if (x < n - 1) relax(cell, cell + 1, 1);
      if (z < n - 1) {
        relax(cell, cell + n, 1);
        if (x < n - 1) relax(cell, cell + n + 1, Math.SQRT2);
        if (x > 0) relax(cell, cell + n - 1, Math.SQRT2);
      }
    }
  }
  return d;
}

/**
 * Where the class's walkers belong: the arena centre (the spawn clearing) when it can stand there,
 * else the first cell of its largest 4-connected walkable region (a swimmer's open sea).
 */
function homeCell(grid: NavGrid, kinds: Uint8Array): number {
  if (kinds[grid.home] === WALKABLE) return grid.home;
  const seen = new Uint8Array(kinds.length);
  let best = grid.home;
  let bestCount = 0;
  for (let start = 0; start < kinds.length; start++) {
    if (seen[start] === 1 || kinds[start] !== WALKABLE) continue;
    seen[start] = 1;
    const queue = [start];
    let count = 0;
    while (queue.length > 0) {
      const cell = queue.pop()!;
      count++;
      for (let d = 0; d < 4; d++) {
        const next = cell + grid.offset[d]!;
        if (seen[next] === 1 || kinds[next] !== WALKABLE) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    if (count > bestCount) [best, bestCount] = [start, count];
  }
  return best;
}

/**
 * Clears orthogonal steps from cells that can walk to `home` into cells that cannot, and returns that
 * set. Paths home never pass through such cells, so the set is unchanged by the pruning and nobody
 * inside it can leave it: one-way slopes never strand a walker in a pit.
 */
function pruneTraps(grid: NavGrid, pass: Uint8Array, home: number): Uint8Array {
  const { offset } = grid;
  const homeward = new Uint8Array(pass.length);
  const queue = [home];
  homeward[home] = 1;
  while (queue.length > 0) {
    const cell = queue.pop()!;
    for (let d = 0; d < 4; d++) {
      const from = cell - offset[d]!;
      if (homeward[from] === 0 && (pass[from]! & (1 << d)) !== 0) {
        homeward[from] = 1;
        queue.push(from);
      }
    }
  }
  for (let cell = 0; cell < pass.length; cell++) {
    if (homeward[cell] === 0) continue;
    for (let d = 0; d < 4; d++) if (homeward[cell + offset[d]!] === 0) pass[cell]! &= ~(1 << d);
  }
  return homeward;
}

/** A diagonal is walkable only if both L-shaped detours are, so routes never cut a corner. */
function addDiagonals(grid: NavGrid, pass: Uint8Array): void {
  const { size, offset } = grid;
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const cell = cellIndex(grid, gx, gz);
      let bits = pass[cell]!;
      for (let d = 4; d < 8; d++) {
        const sx = DIAGONAL_X[d]!;
        const sz = DIAGONAL_Z[d]!;
        const viaX = (bits & (1 << sx)) !== 0 && (pass[cell + offset[sx]!]! & (1 << sz)) !== 0;
        const viaZ = (bits & (1 << sz)) !== 0 && (pass[cell + offset[sz]!]! & (1 << sx)) !== 0;
        if (viaX && viaZ) bits |= 1 << d;
      }
      pass[cell] = bits;
    }
  }
}

/** Terrain walkability for a renderer or tool: per playable cell, row-major from (min, min). */
export interface TerrainMask {
  /**
   * The ground class's cleaned classification: 0 walkable, 255 wall (cannot be climbed). One-way
   * faces, which can still be walked down, are 255 too. Terrain only: props and dynamic blockers
   * are not in the mask. Movement and routes use exactly these cells.
   */
  data: Uint8Array;
  width: number;
  height: number;
  /** World X / Z of the centre of cell (0, 0); cell (i, j) is centred at origin + (i, j) × cellSize. */
  originX: number;
  originZ: number;
  cellSize: number;
}

/** Where ground units cannot climb up, for painting it (bare earth on faces, one-way ones included). */
export function groundBlockedMask(nav: Nav): TerrainMask {
  const { grid } = nav;
  const { size } = grid;
  const { kinds } = layerFor(nav, mobilityClasses.ground);
  const data = new Uint8Array(size * size);
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      if (kinds[cellIndex(grid, gx, gz)] !== WALKABLE) data[gz * size + gx] = 255;
    }
  }
  return {
    data,
    width: size,
    height: size,
    originX: grid.min,
    originZ: grid.min,
    cellSize: grid.cell,
  };
}
