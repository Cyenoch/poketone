import { cellIndex, type NavGrid } from "./grid";
import { SWIM_DEPTH, WADE_DEPTH } from "../content/params/environment";
import type { MobilityProfile } from "./profiles";

/** Per-cell terrain kind for one walker class. */
export const WALKABLE = 0;
/** Too steep to climb, gentle enough to walk down: a one-way face. */
export const ONE_WAY = 1;
/** Too steep either way. */
export const SHEER = 2;

/** Wall specks below this many cells (4 m² at 0.5 u) are walkable; walkable pockets below it are walls. */
export const MIN_REGION = 16;
/** How far (in cells) a face cell looks for the face's steepest point when deciding one-way vs sheer. */
const FACE_REACH = 3;
/** Half-width (in cells) of the window whose majority decides one-way vs sheer: 4.5 m sections. */
const SEGMENT_REACH = 4;

/**
 * Classifies the playable cells once per walker class, so walkability reads as whole walls and
 * whole fields instead of near-threshold specks:
 * 1. cells steeper than `climb` are walls;
 * 2. wall components smaller than `MIN_REGION` (8-connected) become walkable;
 * 3. a 3×3 closing joins walls one cell apart, so faces have continuous edges (never to the arena edge);
 * 4. walkable pockets smaller than `MIN_REGION` (4-connected) become walls;
 * 5. a wall cell is `ONE_WAY` when most wall cells within `SEGMENT_REACH` sit on a face whose
 *    steepest point (within `FACE_REACH`) is at most `drop`, otherwise `SHEER`. Judging by the face
 *    core means a gentle lip never opens a way down a sheer drop; the majority vote keeps each cliff
 *    section several metres long instead of flickering between one-way and sheer.
 * Water then overrides the slope verdict (`waterBlocks`). Returns kinds in the grid's padded layout;
 * the border stays `SHEER`.
 */
export function classifyTerrain(grid: NavGrid, profile: MobilityProfile): Uint8Array {
  const { climb, drop } = profile;
  const { size } = grid;
  const steep = new Float32Array(size * size);
  const wall = new Uint8Array(size * size);
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const s = grid.steepness[cellIndex(grid, gx, gz)]!;
      steep[gz * size + gx] = s;
      wall[gz * size + gx] = s > climb ? 1 : 0;
    }
  }
  const regions = createRegionScratch(size);
  forEachRegion(wall, size, 1, true, regions, (members, count) => {
    if (count < MIN_REGION) for (let k = 0; k < count; k++) wall[members[k]!] = 0;
  });
  close(wall, size);
  bridgeCorners(wall, steep, size);
  forEachRegion(wall, size, 0, false, regions, (members, count) => {
    if (count < MIN_REGION) for (let k = 0; k < count; k++) wall[members[k]!] = 1;
  });
  const face = faceSteepness(wall, steep, size);
  const walls = boxSums(wall, size, () => 1);
  const gentle = boxSums(wall, size, (i) => (face[i]! <= drop ? 1 : 0));
  const kinds = new Uint8Array(grid.stride * grid.stride).fill(SHEER);
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const i = gz * size + gx;
      const cell = cellIndex(grid, gx, gz);
      // Surface barriers are applied after slope cleanup: even a one-cell deep-water strip blocks.
      const kind = waterBlocks(profile, grid.waterDepth[cell]!)
        ? SHEER
        : wall[i] === 0
          ? WALKABLE
          : gentle[i]! * 2 >= walls[i]!
            ? ONE_WAY
            : SHEER;
      kinds[cell] = kind;
    }
  }
  return kinds;
}

/**
 * The one water rule: deep water walls in a ground walker, a swimmer is walled in by everything
 * shallower than `SWIM_DEPTH` (land and the wading fringe alike), an amphibian by neither.
 */
function waterBlocks(profile: MobilityProfile, depth: number): boolean {
  if (profile.water === "both") return false;
  return profile.water === "swim" ? depth < SWIM_DEPTH : depth > WADE_DEPTH;
}

/** Per wall cell, the sum of `weight` over wall cells in the (2·SEGMENT_REACH + 1)² window around it. */
function boxSums(wall: Uint8Array, size: number, weight: (i: number) => number): Int32Array {
  const side = size + 1;
  const table = new Int32Array(side * side);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = z * size + x;
      const value = wall[i] === 1 ? weight(i) : 0;
      table[(z + 1) * side + x + 1] =
        value + table[z * side + x + 1]! + table[(z + 1) * side + x]! - table[z * side + x]!;
    }
  }
  const sums = new Int32Array(wall.length);
  for (let z = 0; z < size; z++) {
    const z0 = Math.max(0, z - SEGMENT_REACH);
    const z1 = Math.min(size, z + SEGMENT_REACH + 1);
    for (let x = 0; x < size; x++) {
      const x0 = Math.max(0, x - SEGMENT_REACH);
      const x1 = Math.min(size, x + SEGMENT_REACH + 1);
      sums[z * size + x] =
        table[z1 * side + x1]! -
        table[z0 * side + x1]! -
        table[z1 * side + x0]! +
        table[z0 * side + x0]!;
    }
  }
  return sums;
}

interface RegionScratch {
  stack: Int32Array;
  members: Int32Array;
}

function createRegionScratch(size: number): RegionScratch {
  return { stack: new Int32Array(size * size), members: new Int32Array(size * size) };
}

/**
 * Calls `visit` once per connected component of `value` cells (in scan order, so deterministic),
 * with the component's cells in `members[0..count)`. The mask may be edited inside `visit`.
 */
function forEachRegion(
  mask: Uint8Array,
  size: number,
  value: 0 | 1,
  eightWay: boolean,
  scratch: RegionScratch,
  visit: (members: Int32Array, count: number) => void,
): void {
  const seen = new Uint8Array(mask.length);
  const { stack, members } = scratch;
  for (let start = 0; start < mask.length; start++) {
    if (seen[start] === 1 || mask[start] !== value) continue;
    let top = 0;
    let count = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const cell = stack[--top]!;
      members[count++] = cell;
      const x = cell % size;
      const z = (cell - x) / size;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dz === 0) || (!eightWay && dx !== 0 && dz !== 0)) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
          const next = nz * size + nx;
          if (seen[next] === 1 || mask[next] !== value) continue;
          seen[next] = 1;
          stack[top++] = next;
        }
      }
    }
    visit(members, count);
  }
}

/**
 * 3×3 closing (dilate, then erode), only ever adding walls. Outside the arena counts as open
 * ground, so a cliff ending near the edge never gets extended to it and seal the strip between them.
 */
/**
 * Wall cells that touch only at a corner leave a one-point pinch between two open cells, which the
 * mover and the router read differently (a body may slip through or snag on it). Fill the steeper of
 * the two open cells so the wall runs edge to edge; repeat until no such corner is left.
 */
function bridgeCorners(wall: Uint8Array, steep: Float32Array, size: number): void {
  for (let changed = true; changed;) {
    changed = false;
    for (let z = 0; z < size - 1; z++) {
      for (let x = 0; x < size - 1; x++) {
        const a = z * size + x;
        const b = a + 1;
        const c = a + size;
        const d = c + 1;
        let fill = -1;
        if (wall[a] === 1 && wall[d] === 1 && wall[b] === 0 && wall[c] === 0)
          fill = steep[b]! >= steep[c]! ? b : c;
        else if (wall[b] === 1 && wall[c] === 1 && wall[a] === 0 && wall[d] === 0)
          fill = steep[a]! >= steep[d]! ? a : d;
        if (fill < 0) continue;
        wall[fill] = 1;
        changed = true;
      }
    }
  }
}

function close(wall: Uint8Array, size: number): void {
  const grown = new Uint8Array(wall.length);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let any = 0;
      for (let dz = -1; dz <= 1 && any === 0; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= 0 && nz >= 0 && nx < size && nz < size && wall[nz * size + nx] === 1) {
            any = 1;
            break;
          }
        }
      }
      grown[z * size + x] = any;
    }
  }
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let all = 1;
      for (let dz = -1; dz <= 1 && all === 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= size || nz >= size || grown[nz * size + nx] === 0) {
            all = 0;
            break;
          }
        }
      }
      if (all === 1) wall[z * size + x] = 1;
    }
  }
}

/** For each wall cell, the steepest wall cell within `FACE_REACH` (separable square max filter). */
function faceSteepness(wall: Uint8Array, steep: Float32Array, size: number): Float32Array {
  const rows = new Float32Array(wall.length);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let max = 0;
      for (let dx = -FACE_REACH; dx <= FACE_REACH; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= size) continue;
        const i = z * size + nx;
        if (wall[i] === 1 && steep[i]! > max) max = steep[i]!;
      }
      rows[z * size + x] = max;
    }
  }
  const face = new Float32Array(wall.length);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let max = 0;
      for (let dz = -FACE_REACH; dz <= FACE_REACH; dz++) {
        const nz = z + dz;
        if (nz < 0 || nz >= size) continue;
        const v = rows[nz * size + x]!;
        if (v > max) max = v;
      }
      face[z * size + x] = max;
    }
  }
  return face;
}
