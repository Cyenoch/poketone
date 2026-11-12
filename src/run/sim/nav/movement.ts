import { ARENA_HALF } from "../state/world";
import { cellAt, cellIndex, sampleField, type NavGrid } from "./grid";
import { cellWallOverlap } from "./blockers";
import { layerFor, type Nav } from "./nav";
import { terrainStep, type MobilityProfile, type NavLayer } from "./profiles";
import { WALKABLE } from "./walkable";
import { cos, sin } from "../math";
import { sampleSurface } from "../surface";

export interface Body {
  x: number;
  z: number;
  /** Collision radius against solid circles; defaults to 0.5. */
  radius?: number;
}

/** Longest sub-step: half a cell, narrower than any cliff face, wall cell or rock (plus body radius). */
const MAX_STEP = 0.25;
/** Projection passes per sub-step; the extra passes settle convex corners such as a cliff lip meeting a rock. */
const SLIDE_PASSES = 3;
const DEFAULT_RADIUS = 0.5;
/** Corner-nudge angles (radians) tried in order when a sub-step cannot slide at all. */
const NUDGE_TURNS = [Math.PI / 8, Math.PI / 4];
/** A body less than this deep (cells) past a wall line only grazes it: it may always back out. */
const GRAZE = -0.25;
/** Wall recovery leaves the body this far (in cells) outside the wall edge. */
const SKIN = 0.02;

/** Unit normal of the latest blocking surface (scratch; its sign does not matter to the projection). */
const normal = { x: 0, z: 0 };
/** Whether the latest block was a terrain wall edge (scratch, set by `blocked`). */
let wallContact = false;

function clampArena(value: number): number {
  return Math.max(-ARENA_HALF, Math.min(ARENA_HALF, value));
}

/**
 * The one way bodies move: move-and-slide. The displacement is split into sub-steps of at most
 * `MAX_STEP`; a blocked sub-step loses only its component into the obstacle (a wall of the class's
 * terrain classification, a pit it could not leave, a cell blocker, a solid circle, the arena
 * edge) and keeps gliding along it. Flyers only stay inside the arena.
 */
export function moveWithSlope(
  nav: Nav,
  profile: MobilityProfile,
  body: Body,
  dx: number,
  dz: number,
  radius = body.radius ?? DEFAULT_RADIUS,
): void {
  if (profile.flying) {
    body.x = clampArena(body.x + dx);
    body.z = clampArena(body.z + dz);
    return;
  }
  const layer = layerFor(nav, profile);
  const surface = sampleSurface(nav.grid.surface, body.x, body.z);
  // Water slows waders only; swimmers and amphibians move through it at full speed.
  const speed = profile.water && surface.kind === "water" ? 1 : surface.speed;
  dx *= speed;
  dz *= speed;
  travel(nav, layer, body, radius, dx, dz);
  if (nav.grid.near[cellAt(nav.grid, body.x, body.z)]! > 0) depenetrate(nav, layer, body, radius);
}

/** Sub-steps a displacement of any length so dashes and shoves cannot tunnel. */
function travel(
  nav: Nav,
  layer: NavLayer,
  body: Body,
  radius: number,
  dx: number,
  dz: number,
): void {
  const steps = Math.ceil(Math.sqrt(dx * dx + dz * dz) / MAX_STEP);
  for (let i = 0; i < steps; i++) slide(nav, layer, body, radius, dx / steps, dz / steps);
}

function slide(
  nav: Nav,
  layer: NavLayer,
  body: Body,
  radius: number,
  mx: number,
  mz: number,
): void {
  if (project(nav, layer, body, radius, mx, mz)) return;
  // Corner nudge: still stuck (a convex corner, a staircase edge), so try the input turned a little
  // toward the side it was already sliding to, at the turned step's cos-scaled length. Pushing
  // straight into a wall has no side and stays put instead of drifting.
  const side = Math.sign(normal.x * mz - normal.z * mx);
  if (side === 0) return;
  for (const turn of NUDGE_TURNS) {
    const cosTurn = cos(turn);
    const sinTurn = sin(turn * side);
    const nx = (mx * cosTurn - mz * sinTurn) * cosTurn;
    const nz = (mx * sinTurn + mz * cosTurn) * cosTurn;
    if (project(nav, layer, body, radius, nx, nz)) return;
  }
}

/** Move-and-slide passes for one sub-step; true once the body moved. */
function project(
  nav: Nav,
  layer: NavLayer,
  body: Body,
  radius: number,
  mx: number,
  mz: number,
): boolean {
  for (let pass = 0; pass < SLIDE_PASSES; pass++) {
    if (mx * mx + mz * mz < 1e-12) return false;
    wallContact = false;
    if (!blocked(nav, layer, body, radius, mx, mz)) {
      body.x += mx;
      body.z += mz;
      return true;
    }
    if (wallContact && pushOut(nav, layer, body, radius, mx, mz)) return true;
    const into = mx * normal.x + mz * normal.z;
    mx -= normal.x * into;
    mz -= normal.z * into;
  }
  return false;
}

/**
 * Move-then-recover against a terrain wall: take the step, push the end point back out along the
 * wall-distance gradient by its overlap, and keep the result if that path is clear. The along-wall
 * motion survives a bumpy (staircase) edge that plain projection keeps re-hitting.
 */
function pushOut(
  nav: Nav,
  layer: NavLayer,
  body: Body,
  radius: number,
  mx: number,
  mz: number,
): boolean {
  const { grid } = nav;
  let x = body.x + mx;
  let z = body.z + mz;
  for (let i = 0; i < 2; i++) {
    const depth = sampleField(grid, layer.wallDistance, x, z);
    if (depth >= 0) break;
    if (!fieldNormal(grid, layer.wallDistance, x, z)) return false;
    const out = (SKIN - depth) * grid.cell;
    x += normal.x * out;
    z += normal.z * out;
  }
  const dx = x - body.x;
  const dz = z - body.z;
  // Recovery may only shorten the step, never fling the body, and the corrected step must be legal.
  if (dx * dx + dz * dz > mx * mx + mz * mz) return false;
  if (blocked(nav, layer, body, radius, dx, dz)) return false;
  body.x = x;
  body.z = z;
  return true;
}

/** Records the blocking normal; `unnormalised` vectors (the step itself, as a last resort) are scaled to unit length. */
function setNormal(x: number, z: number, unnormalised = false): true {
  const length = unnormalised ? Math.sqrt(x * x + z * z) : 1;
  normal.x = x / length;
  normal.z = z / length;
  return true;
}

/** Whether the step is blocked; when it is, `normal` holds the blocking surface's normal. */
function blocked(
  nav: Nav,
  layer: NavLayer,
  body: Body,
  radius: number,
  mx: number,
  mz: number,
): boolean {
  const { grid } = nav;
  const x1 = body.x + mx;
  const z1 = body.z + mz;
  if (Math.abs(x1) > ARENA_HALF) return setNormal(1, 0);
  if (Math.abs(z1) > ARENA_HALF) return setNormal(0, 1);
  const start = cellAt(grid, body.x, body.z);
  const end = cellAt(grid, x1, z1);
  // A cell blocker installed under a body must still let that body walk out.
  const contact = grid.hard[start] === 0 ? cellWallOverlap(grid, x1, z1, radius) : null;
  if (contact) {
    const previous = cellWallOverlap(grid, body.x, body.z, radius);
    // A body already overlapping a wall can back out; new overlap stops at the visible edge.
    if (!previous || contact.depth > previous.depth + 1e-9) return setNormal(contact.x, contact.z);
  }
  if (grid.near[end]! > 0 && hitsCircle(nav, body, radius, x1, z1)) return true;
  // One smooth field draws the wall line, so the slid step runs along the same edge that stopped it
  // instead of catching on the next stair of cells. Any body past that line stands on the face (where
  // the line cuts a walkable corner cell too, or it could not leave it); the cell it steps into
  // decides the wall kind, as routes judge it, so a body never refuses a step its flow field takes.
  const depth = sampleField(grid, layer.wallDistance, body.x, body.z);
  const nextDepth = sampleField(grid, layer.wallDistance, x1, z1);
  const fromWall = depth < 0;
  const toWall = nextDepth < 0;
  const pit = layer.homeward[start] === 1 && layer.homeward[end] === 0;
  // Walkable to walkable is always allowed: the classification already decided.
  if (!fromWall && !toWall && !pit) return false;
  if (!pit && depth > GRAZE && nextDepth > depth) return false;
  const rise =
    sampleField(grid, grid.height, x1, z1) - sampleField(grid, grid.height, body.x, body.z);
  const toKind = toWall ? wallKind(grid, layer.kinds, end, x1, z1) : WALKABLE;
  if (!pit && terrainStep(rise, fromWall, toKind)) return false;
  // Walking into a wall slides along its edge; on a face or at a pit rim, along the terrain.
  if (!fromWall && toWall && fieldNormal(grid, layer.wallDistance, x1, z1)) {
    wallContact = true;
    return true;
  }
  return fieldNormal(grid, grid.height, x1, z1) || setNormal(mx, mz, true);
}

/**
 * The kind of wall a point inside the wall line belongs to: its own cell's, as routes judge it (a
 * one-way cell stays one-way beside a sheer one). Where the smooth line cuts a staircase corner the
 * point's cell is still walkable, and the strictest wall cell around the point holds the line.
 */
function wallKind(grid: NavGrid, kinds: Uint8Array, cell: number, x: number, z: number): number {
  if (kinds[cell] !== WALKABLE) return kinds[cell]!;
  const u = Math.min(grid.size - 1, Math.max(0, (x - grid.min) / grid.cell));
  const v = Math.min(grid.size - 1, Math.max(0, (z - grid.min) / grid.cell));
  const at = cellIndex(
    grid,
    Math.min(grid.size - 2, Math.floor(u)),
    Math.min(grid.size - 2, Math.floor(v)),
  );
  return Math.max(
    kinds[at]!,
    kinds[at + 1]!,
    kinds[at + grid.stride]!,
    kinds[at + grid.stride + 1]!,
  );
}

/**
 * Solid circles block only steps that move deeper into them, so an overlapping body can always
 * leave. The normal is taken at the body's current position: a step along that tangent always
 * moves outward, so the slide never stalls on the curve.
 */
function hitsCircle(nav: Nav, body: Body, radius: number, x1: number, z1: number): boolean {
  for (const blocker of nav.blockers) {
    if (blocker.kind !== "circle") continue;
    const reach = blocker.radius + radius;
    const d2 = (x1 - blocker.x) ** 2 + (z1 - blocker.z) ** 2;
    if (d2 >= reach * reach) continue;
    const ox = body.x - blocker.x;
    const oz = body.z - blocker.z;
    const o2 = ox * ox + oz * oz;
    if (d2 >= o2) continue;
    const o = Math.sqrt(o2);
    return o > 0 ? setNormal(ox / o, oz / o) : setNormal(1, 0);
  }
  return false;
}

/** Horizontal gradient direction of a bilinear field at a point; false where the field is flat. */
function fieldNormal(grid: NavGrid, field: Float32Array, x: number, z: number): boolean {
  const e = grid.cell / 2;
  const gx = sampleField(grid, field, x + e, z) - sampleField(grid, field, x - e, z);
  const gz = sampleField(grid, field, x, z + e) - sampleField(grid, field, x, z - e);
  const g = Math.sqrt(gx * gx + gz * gz);
  if (g <= 1e-9) return false;
  return setNormal(gx / g, gz / g);
}

/** Pushes a body out of circles it already overlaps (spawned, shoved or walled in), through the same slide. */
function depenetrate(nav: Nav, layer: NavLayer, body: Body, radius: number): void {
  for (const blocker of nav.blockers) {
    if (blocker.kind !== "circle") continue;
    const dx = body.x - blocker.x;
    const dz = body.z - blocker.z;
    const reach = blocker.radius + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= reach * reach) continue;
    if (d2 === 0) {
      travel(nav, layer, body, radius, reach, 0);
      continue;
    }
    const d = Math.sqrt(d2);
    const push = (reach - d) / d;
    travel(nav, layer, body, radius, dx * push, dz * push);
  }
}
