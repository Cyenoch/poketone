import { DIR_LENGTH, cellAt, cellCenterX, cellCenterZ, routeStep } from "./grid";
import { CellHeap } from "./heap";
import { hasWalkableLine } from "./line";
import { layerFor, type Nav } from "./nav";
import type { MobilityProfile } from "./profiles";

/** Buffers reused by every query; `seen` stamps replace clearing them between searches. */
export interface PathSearch {
  g: Float32Array;
  parent: Int32Array;
  seen: Uint32Array;
  stamp: number;
  heap: CellHeap;
  chain: Int32Array;
}

function createSearch(cells: number): PathSearch {
  return {
    g: new Float32Array(cells),
    parent: new Int32Array(cells),
    seen: new Uint32Array(cells),
    stamp: 0,
    heap: new CellHeap(cells),
    chain: new Int32Array(cells),
  };
}

/**
 * Point-to-point route on the flow-field grid (octile A*, same uphill/downhill and blocker rules),
 * string-pulled with line-of-sight checks. Writes waypoints as `x0, z0, x1, z1, …` into `out`,
 * excluding the start and ending exactly at the goal. False when no route exists; that search
 * explores the start's whole reachable region (≈31k cells worst case).
 */
export function findPath(
  nav: Nav,
  profile: MobilityProfile,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  out: number[],
): boolean {
  out.length = 0;
  if (profile.flying) {
    out.push(toX, toZ);
    return true;
  }
  const { grid } = nav;
  const { pass } = layerFor(nav, profile);
  const search = (nav.search ??= createSearch(grid.stride * grid.stride));
  const { g, parent, seen, heap } = search;
  const start = cellAt(grid, fromX, fromZ);
  const goal = cellAt(grid, toX, toZ);
  const goalX = goal % grid.stride;
  const goalZ = Math.floor(goal / grid.stride);
  const estimate = (cell: number) => {
    const dx = Math.abs((cell % grid.stride) - goalX);
    const dz = Math.abs(Math.floor(cell / grid.stride) - goalZ);
    return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
  };
  const stamp = ++search.stamp;
  heap.clear();
  seen[start] = stamp;
  g[start] = 0;
  parent[start] = -1;
  heap.push(start, estimate(start));
  while (heap.size > 0) {
    const cell = heap.pop();
    if (cell === goal) {
      smooth(nav, profile, search, goal, fromX, fromZ, toX, toZ, out);
      return true;
    }
    for (let d = 0; d < 8; d++) {
      const next = cell + grid.offset[d]!;
      if (!routeStep(grid, pass, cell, d, next === goal)) continue;
      const cost = g[cell]! + DIR_LENGTH[d]!;
      if (seen[next] === stamp && cost >= g[next]!) continue;
      seen[next] = stamp;
      g[next] = cost;
      parent[next] = cell;
      heap.push(next, cost + estimate(next));
    }
  }
  return false;
}

/** Greedy string pulling: from each anchor, jump to the farthest later cell still in walkable line. */
function smooth(
  nav: Nav,
  profile: MobilityProfile,
  search: PathSearch,
  goal: number,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  out: number[],
): void {
  const { chain, parent } = search;
  let length = 0;
  for (let cell = goal; cell >= 0; cell = parent[cell]!) length++;
  for (let cell = goal, k = length - 1; cell >= 0; cell = parent[cell]!, k--) chain[k] = cell;
  const last = length - 1;
  if (last === 0) {
    out.push(toX, toZ);
    return;
  }
  const pointX = (k: number) => (k === last ? toX : cellCenterX(nav.grid, chain[k]!));
  const pointZ = (k: number) => (k === last ? toZ : cellCenterZ(nav.grid, chain[k]!));
  let anchorX = fromX;
  let anchorZ = fromZ;
  for (let at = 0; at < last;) {
    let reach = at + 1;
    while (
      reach < last &&
      hasWalkableLine(nav, profile, anchorX, anchorZ, pointX(reach + 1), pointZ(reach + 1))
    )
      reach++;
    anchorX = pointX(reach);
    anchorZ = pointZ(reach);
    out.push(anchorX, anchorZ);
    at = reach;
  }
}
