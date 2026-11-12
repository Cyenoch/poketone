import { BucketQueue, DIAGONAL_COST, ORTHOGONAL_COST } from "./buckets";
import {
  DIAGONAL_X,
  DIAGONAL_Z,
  cellAt,
  cellCenterX,
  cellCenterZ,
  cellIndex,
  routeStep,
  type NavGrid,
} from "./grid";
import { layerFor, type Nav } from "./nav";
import type { MobilityProfile, NavLayer } from "./profiles";
import { WALKABLE } from "./walkable";

/**
 * Multi-source Dijkstra integration field toward every living target, one per walker class.
 * Agents read the published `cost`; a new search integrates into `work` a budget of cells per
 * tick and swaps in when it drains, so readers never see a half-built field.
 */
export interface FlowField {
  /** Path cost to the nearest target in fifths of a cell (`ORTHOGONAL_COST` per step); Infinity where no path exists. */
  cost: Float32Array;
  work: Float32Array;
  /** Blockers changed after the latest search started. */
  dirty: boolean;
  /** Target cells the latest search started from. */
  seeds: number[];
  /** Target cells `cost` was integrated from; null until the first search publishes (all Infinity). */
  published: number[] | null;
  /** Clock of the latest direction query; fields nobody reads stop refreshing. */
  demand: number;
}

/** Field searches run one at a time to completion, so a single queue serves every layer. */
export interface FlowSearch {
  queue: BucketQueue;
  layer: NavLayer | null;
  /** Cells the running search has settled so far (stale queue entries not counted). */
  settled: number;
}

export interface FlowTarget {
  x: number;
  z: number;
  alive: boolean;
}

export interface Direction {
  x: number;
  z: number;
}

const O = ORTHOGONAL_COST;
const D = DIAGONAL_COST;
/** Integer cost per direction, in the grid's neighbour order. */
const STEP_COST = [O, O, O, O, D, D, D, D] as const;

/** Ensures the profile has a field and marks it as read this tick. */
export function requestFlowField(nav: Nav, profile: MobilityProfile): NavLayer {
  const layer = layerFor(nav, profile);
  layer.field ??= newField(nav);
  layer.field.demand = nav.clock;
  return layer;
}

function newField(nav: Nav): FlowField {
  const cells = nav.grid.stride * nav.grid.stride;
  return {
    cost: new Float32Array(cells).fill(Infinity),
    work: new Float32Array(cells),
    dirty: false,
    seeds: [],
    published: null,
    demand: 0,
  };
}

function flowSearch(nav: Nav): FlowSearch {
  return (nav.flow ??= {
    queue: new BucketQueue(nav.grid.stride * nav.grid.stride),
    layer: null,
    settled: 0,
  });
}

/**
 * Advances flow fields by at most `budget` settled cells in total. A field is stale when its
 * targets changed cell or blockers changed, and is only refreshed if something read it since the
 * last refresh; stale fields are served round-robin, each search running to completion.
 */
export function refreshFlowFields(nav: Nav, targets: readonly FlowTarget[], budget: number): void {
  nav.clock += 1;
  const cells = nav.targets;
  cells.length = 0;
  for (const target of targets) if (target.alive) cells.push(cellAt(nav.grid, target.x, target.z));
  if (cells.length === 0) return;
  const search = flowSearch(nav);
  let remaining = budget;
  while (remaining > 0) {
    if (!search.layer) {
      const layer = nextStaleLayer(nav, cells);
      if (!layer) return;
      startSearch(nav.grid, search, layer, cells);
    }
    remaining -= integrate(nav, search, remaining);
  }
}

function nextStaleLayer(nav: Nav, cells: readonly number[]): NavLayer | null {
  const count = nav.layers.length;
  for (let k = 0; k < count; k++) {
    const index = (nav.cursor + k) % count;
    const field = nav.layers[index]!.field;
    if (!field || field.demand < nav.clock - 1 || (!field.dirty && sameCells(field.seeds, cells)))
      continue;
    nav.cursor = (index + 1) % count;
    return nav.layers[index]!;
  }
  return null;
}

function sameCells(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function startSearch(
  grid: NavGrid,
  search: FlowSearch,
  layer: NavLayer,
  cells: readonly number[],
): void {
  const field = layer.field!;
  field.work.fill(Infinity);
  search.queue.clear();
  search.layer = layer;
  search.settled = 0;
  field.seeds.length = 0;
  for (const cell of cells) {
    field.seeds.push(cell);
    for (const seed of new Set([cell, standingCell(grid, layer, cell)])) {
      field.work[seed] = 0;
      search.queue.push(seed, 0);
    }
  }
  field.dirty = false;
}

/**
 * Where this walker class can stand for a target at `cell`: the cell itself when the class can walk
 * there and home from it, else the nearest such cell (first Chebyshev ring that has one, nearest in
 * it, stable order). A player can stand where the class's terrain kinds say wall (a steep patch, a
 * closed gap); seeding only that cell would give no walker a path. The cell itself when the whole
 * arena has none.
 */
function standingCell(grid: NavGrid, layer: NavLayer, cell: number): number {
  const { kinds, homeward } = layer;
  const standable = (c: number) => kinds[c] === WALKABLE && homeward[c] === 1;
  if (standable(cell)) return cell;
  const gx = (cell % grid.stride) - 1;
  const gz = Math.floor(cell / grid.stride) - 1;
  for (let r = 1; r < grid.size; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let z = Math.max(0, gz - r); z <= Math.min(grid.size - 1, gz + r); z++) {
      for (let x = Math.max(0, gx - r); x <= Math.min(grid.size - 1, gx + r); x++) {
        if (Math.max(Math.abs(x - gx), Math.abs(z - gz)) !== r) continue;
        const c = cellIndex(grid, x, z);
        const d = (x - gx) ** 2 + (z - gz) ** 2;
        if (d < bestD && standable(c)) [best, bestD] = [c, d];
      }
    }
    if (best >= 0) return best;
  }
  return cell;
}

/** Settles up to `budget` cells of the running search; publishes the field when it drains. Returns cells settled. */
function integrate(nav: Nav, search: FlowSearch, budget: number): number {
  const { grid } = nav;
  const { offset, hard, soft } = grid;
  const layer = search.layer!;
  const field = layer.field!;
  const { pass } = layer;
  const cost = field.work;
  const { queue } = search;
  let settled = 0;
  while (queue.size > 0 && settled < budget) {
    const cell = queue.pop();
    const base = queue.level;
    if (cost[cell] !== base) continue;
    settled++;
    // Only a target may be entered while blocked, so blocked non-targets expand nothing.
    if (base > 0 && hard[cell]! + soft[cell]! > 0) continue;
    // Hot loop: `routeStep` inlined, walking edges backwards (who can step into this cell?).
    for (let d = 0; d < 8; d++) {
      const from = cell - offset[d]!;
      if ((pass[from]! & (1 << d)) === 0) continue;
      if (d >= 4) {
        const sideX = from + offset[DIAGONAL_X[d]!]!;
        const sideZ = from + offset[DIAGONAL_Z[d]!]!;
        if (hard[sideX]! + soft[sideX]! + hard[sideZ]! + soft[sideZ]! > 0) continue;
      }
      const total = base + STEP_COST[d]!;
      if (total < cost[from]!) {
        cost[from] = total;
        queue.push(from, total);
      }
    }
  }
  search.settled += settled;
  if (queue.size === 0) {
    field.work = field.cost;
    field.cost = cost;
    field.published = [...field.seeds];
    search.layer = null;
  }
  return settled;
}

/** A field's scheduling facts without its buffers: what a world snapshot keeps (docs/state-machines/simulation.md). */
export type FieldFacts = Pick<FlowField, "dirty" | "seeds" | "published" | "demand">;

/** The search in progress: its layer's index and the cells it has settled. */
export interface RunningSearch {
  layer: number;
  settled: number;
}

/**
 * Rebuilds `nav.layers[i]`'s field from `fields[i]`: every published cost integrated in full from
 * its seeds, then the running search replayed to the same settled prefix, so work, queue order and
 * level match the original. Installs the given scheduling facts and touches nothing else.
 */
export function restoreFields(
  nav: Nav,
  fields: readonly (FieldFacts | null)[],
  running: RunningSearch | null,
): void {
  fields.forEach((facts, i) => {
    if (!facts) return;
    const layer = nav.layers[i]!;
    layer.field = newField(nav);
    if (!facts.published) return;
    const search = flowSearch(nav);
    startSearch(nav.grid, search, layer, facts.published);
    integrate(nav, search, Infinity);
  });
  if (running) {
    const layer = nav.layers[running.layer];
    const facts = fields[running.layer];
    if (!layer || !facts) throw new Error(`流场续算指向不存在的层 ${running.layer}。`);
    const search = flowSearch(nav);
    startSearch(nav.grid, search, layer, facts.seeds);
    integrate(nav, search, running.settled);
    if (search.layer !== layer || search.settled !== running.settled)
      throw new Error(`流场续算在第 ${running.layer} 层结算 ${running.settled} 格前就已完成。`);
  }
  fields.forEach((facts, i) => {
    if (!facts) return;
    const field = nav.layers[i]!.field!;
    field.dirty = facts.dirty;
    field.seeds = [...facts.seeds];
    field.published = facts.published && [...facts.published];
    field.demand = facts.demand;
  });
}

/**
 * Unit direction toward the centre of the next cell on the way to the nearest reachable target,
 * written to `out`. False when the field has no path from here or the position is already in a
 * target cell.
 */
export function flowDirection(
  nav: Nav,
  profile: MobilityProfile,
  x: number,
  z: number,
  out: Direction,
): boolean {
  const layer = requestFlowField(nav, profile);
  const { cost } = layer.field!;
  const { grid } = nav;
  const cell = cellAt(grid, x, z);
  const here = cost[cell]!;
  if (here === 0 || here === Infinity) return false;
  let best = -1;
  let bestCost = Infinity;
  for (let d = 0; d < 8; d++) {
    const next = cost[cell + grid.offset[d]!]!;
    if (next === Infinity || !routeStep(grid, layer.pass, cell, d, next === 0)) continue;
    const total = next + STEP_COST[d]!;
    if (total < bestCost) {
      bestCost = total;
      best = d;
    }
  }
  if (best < 0) return false;
  // Aim at the next cell's centre rather than along the bare grid direction, so a body that drifted
  // toward an edge (a cliff beside a ramp, say) is pulled back onto the route instead of grinding on it.
  const dx = cellCenterX(grid, cell + grid.offset[best]!) - x;
  const dz = cellCenterZ(grid, cell + grid.offset[best]!) - z;
  const length = Math.sqrt(dx * dx + dz * dz);
  out.x = dx / length;
  out.z = dz / length;
  return true;
}

/**
 * Whether the profile's published field has a path from this position to a target. Does not mark
 * the field as read, so a class with no living units keeps its last field instead of refreshing.
 */
export function canReach(nav: Nav, profile: MobilityProfile, x: number, z: number): boolean {
  if (profile.flying) return true;
  const field = layerFor(nav, profile).field;
  return field !== null && field.cost[cellAt(nav.grid, x, z)]! < Infinity;
}
