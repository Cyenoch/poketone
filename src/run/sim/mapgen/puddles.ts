import { steepnessAt } from "../nav/index";
import { smoothstep, valueNoise } from "../noise";
import { chance, next, range, type Rng } from "../rng";
import { heightAt, type Terrain } from "../terrain";
import { ARENA_HALF } from "../state/world";
import { PAD_RIM, SPAWN_CLEARING } from "./pads";
import { forEachSample, reachableAt, wallNear, type SiteContext } from "./sites";
import type { PuddleSpec } from "./spec";
import { MapGenError, type Pad, type Puddle, type PuddleCircle, type PuddleShape } from "./types";
import { cos, hypot, powInt, sin } from "../math";

/** Random sites considered per shape; the lowest one that fits gets it. */
const CANDIDATES = 400;
/** Puddles only go where the ground under their footprint is already gentle and nearly level. */
const SITE_STEEPNESS = 0.35;
const SITE_SPREAD = 0.2;
/** Width of the bank outside the shoreline that eases the cut back into the terrain. */
const BANK = 0.9;
/** Distance inside the shoreline at which the bed bottoms out, at most; small puddles bottom out sooner. */
const SHELF = 1.2;
/** Footprints keep this far from walls: digging the bank steepens the ground next to a cliff. */
const WALL_CLEARANCE = 1;
/** Clear ground kept between two puddles' banks. */
const GAP = 0.6;
/** A shape that fits nowhere is retried this many times, shrunk by `SHRINK` each time, then dropped. */
const RETRIES = 2;
const SHRINK = 0.8;

/**
 * Carves the requested number of puddles into the lowest gentle spots, never on pads, walls or the
 * spawn clearing and never touching each other. Each map gets one feature body (a large pond, a
 * winding stream or a big kidney / crescent) and small ones of every kind; the largest is placed
 * first. The carve puts the waterline exactly on each outline (see `shoreDistance`). Throws if fewer
 * than the minimum fit.
 */
export function placePuddles(
  context: SiteContext,
  spec: PuddleSpec,
  pads: readonly Pad[],
  rng: Rng,
  seed: number,
): Puddle[] {
  const [least, most] = spec.count;
  const feature = featureShape(rng);
  // A large pond already holds a good share of the map's water, so it brings the fewest companions.
  const wanted = feature.large ? least : least + Math.floor(next(rng) * (most - least + 1));
  const shapes = wanted > 0 ? [feature.shape] : [];
  while (shapes.length < wanted) shapes.push(minorShape(rng));
  shapes.sort((a, b) => b.reach - a.reach);
  const puddles: Puddle[] = [];
  for (const designed of shapes) {
    let shape = designed;
    for (let attempt = 0; attempt <= RETRIES; attempt++, shape = scaled(shape, SHRINK)) {
      const site = findSite(context, shape, pads, puddles, rng);
      if (!site) continue;
      puddles.push(carve(context, site.x, site.z, shape, spec.depth));
      break;
    }
  }
  if (puddles.length < least) {
    throw new MapGenError(
      `地图生成失败：需要至少 ${least} 个水洼，${shapes.length} 种轮廓各试 ${CANDIDATES} 个候选点，` +
        `只放下 ${puddles.length} 个（种子 ${seed}）。`,
    );
  }
  return puddles;
}

/**
 * Approximate signed distance (world units) from a point to a puddle's designed shoreline: negative
 * inside. The carve, the water depth grid, the validation, the view and the tests all read it.
 */
export function shoreDistance(
  puddle: Pick<Puddle, "x" | "z" | "shape">,
  x: number,
  z: number,
): number {
  const { lobes, bites, blend, wobble } = puddle.shape;
  const dx = x - puddle.x;
  const dz = z - puddle.z;
  let d = Infinity;
  for (const lobe of lobes) {
    // Polynomial smooth minimum: lobes melt into each other instead of meeting at a crease.
    d = smoothMin(d, hypot(dx - lobe.x, dz - lobe.z) - lobe.r, blend);
  }
  for (const bite of bites) {
    d = -smoothMin(-d, hypot(dx - bite.x, dz - bite.z) - bite.r, blend);
  }
  return (
    d + wobble.amplitude * (2 * valueNoise(wobble.seed, dx / wobble.scale, dz / wobble.scale) - 1)
  );
}

/** Whether a circle of `radius` at (x, z) stays clear of a puddle's carved footprint (outline plus bank). */
export function clearOfPuddle(puddle: Puddle, x: number, z: number, radius: number): boolean {
  return (
    hypot(x - puddle.x, z - puddle.z) > puddle.radius + radius ||
    shoreDistance(puddle, x, z) > BANK + radius
  );
}

/** Calls `visit` for every terrain sample of the carved footprint (outline plus bank) with its shore distance. */
export function forEachFootprintSample(
  terrain: Terrain,
  puddle: Pick<Puddle, "x" | "z" | "shape">,
  visit: (index: number, shore: number, x: number, z: number) => void,
): void {
  const { origin, resolution, samples } = terrain;
  forEachSample(terrain, puddle.x, puddle.z, puddle.shape.reach, (index) => {
    const x = origin + (index % samples) / resolution;
    const z = origin + Math.floor(index / samples) / resolution;
    const d = shoreDistance(puddle, x, z);
    if (d < BANK) visit(index, d, x, z);
  });
}

function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// ---- Shapes ----------------------------------------------------------------------------------------

interface Draft {
  /** The first lobe is the main one; the finished shape is centred on it. */
  lobes: PuddleCircle[];
  bites: PuddleCircle[];
  blend: number;
  amplitude: number;
  scale: number;
}

/** One per map: a large multi-lobed pond, a long winding stream or a big kidney / crescent. */
function featureShape(rng: Rng): { shape: PuddleShape; large: boolean } {
  const roll = next(rng);
  if (roll < 0.34) return { shape: finish(rng, pond(rng, range(rng, 3.6, 4.8))), large: true };
  const shape =
    roll < 0.68
      ? finish(rng, stream(rng, range(rng, 6, 10), range(rng, 0.5, 0.8)))
      : finish(rng, arc(rng, range(rng, 2.2, 3), chance(rng, 0.5)));
  return { shape, large: false };
}

/** The rest: mostly small pools, then lobed clusters, kidneys and crescents, and short rills. */
function minorShape(rng: Rng): PuddleShape {
  const roll = next(rng);
  if (roll < 0.4) return finish(rng, pool(rng, 0.55 + 1.25 * next(rng) ** 2));
  if (roll < 0.62) return finish(rng, cluster(rng, range(rng, 1.4, 2.4)));
  if (roll < 0.85) return finish(rng, arc(rng, range(rng, 1.3, 2.1), chance(rng, 0.4)));
  return finish(rng, stream(rng, range(rng, 3.5, 5.5), range(rng, 0.38, 0.55)));
}

/** A round pool, sometimes with a second lobe making it a peanut or a pear. */
function pool(rng: Rng, size: number): Draft {
  const lobes = [{ x: 0, z: 0, r: size }];
  if (chance(rng, 0.6)) {
    const angle = range(rng, 0, Math.PI * 2);
    const out = size * range(rng, 0.5, 0.9);
    lobes.push({
      x: cos(angle) * out,
      z: sin(angle) * out,
      r: size * range(rng, 0.45, 0.75),
    });
  }
  return { lobes, bites: [], blend: size * 0.5, amplitude: size * 0.1, scale: Math.max(0.8, size) };
}

/** A main lobe ringed by 3–5 smaller ones that stick out: a clover- or splash-like outline. */
function cluster(rng: Rng, size: number): Draft {
  const main = size * range(rng, 0.5, 0.6);
  const lobes = [{ x: 0, z: 0, r: main }];
  const count = 3 + Math.floor(next(rng) * 3);
  const start = range(rng, 0, Math.PI * 2);
  for (let k = 0; k < count; k++) {
    const angle = start + (k / count) * Math.PI * 2 + range(rng, -0.5, 0.5);
    const out = main * range(rng, 0.75, 1.15);
    lobes.push({
      x: cos(angle) * out,
      z: sin(angle) * out,
      r: main * range(rng, 0.4, 0.75),
    });
  }
  return { lobes, bites: [], blend: main * 0.35, amplitude: main * 0.1, scale: 1.1 };
}

/** A large pond: a broad main lobe, 2–4 bays and sometimes a cove bitten out of one side. */
function pond(rng: Rng, size: number): Draft {
  const main = size * range(rng, 0.55, 0.65);
  const lobes = [{ x: 0, z: 0, r: main }];
  const count = 2 + Math.floor(next(rng) * 3);
  const start = range(rng, 0, Math.PI * 2);
  for (let k = 0; k < count; k++) {
    const angle = start + (k / count) * Math.PI * 2 + range(rng, -0.6, 0.6);
    const out = main * range(rng, 0.7, 1.05);
    lobes.push({
      x: cos(angle) * out,
      z: sin(angle) * out,
      r: main * range(rng, 0.45, 0.7),
    });
  }
  const bites: PuddleCircle[] = [];
  if (chance(rng, 0.6)) {
    // Between two bays, far enough out that the centre stays under water.
    const angle = start + ((Math.floor(next(rng) * count) + 0.5) / count) * Math.PI * 2;
    const out = main * range(rng, 1.05, 1.25);
    bites.push({
      x: cos(angle) * out,
      z: sin(angle) * out,
      r: main * range(rng, 0.45, 0.6),
    });
  }
  return { lobes, bites, blend: main * 0.45, amplitude: main * 0.06, scale: 1.5 };
}

/**
 * Lobes strung along an arc around a ring centre: a kidney (short, fat arc with a dent bitten into
 * its inner side) or a crescent (long, thin, tapering arc with its inside cut clean).
 */
function arc(rng: Rng, size: number, crescent: boolean): Draft {
  const r = size * (crescent ? 0.4 : 0.55);
  const ring = r * (crescent ? range(rng, 1.8, 2.3) : range(rng, 1.1, 1.4));
  const span = crescent ? range(rng, 3.2, 4.2) : range(rng, 2.2, 2.9);
  const taper = crescent ? 0.55 : 0.3;
  const half = Math.ceil((span * ring) / (1.4 * r));
  const lobes: PuddleCircle[] = [];
  // t = 0 first: the main lobe sits mid-arc.
  for (const k of [
    0,
    ...Array.from({ length: half * 2 }, (_, i) => (i % 2 ? -1 : 1) * (1 + (i >> 1))),
  ]) {
    const t = k / half;
    const angle = (t * span) / 2;
    lobes.push({
      x: cos(angle) * ring,
      z: sin(angle) * ring,
      r: r * (1 - taper * t * t),
    });
  }
  const bites = crescent
    ? [{ x: 0, z: 0, r: ring - r * 0.55 }]
    : chance(rng, 0.7)
      ? [{ x: -r * 0.2, z: 0, r: ring * 0.75 }]
      : [];
  return { lobes, bites, blend: r * 0.5, amplitude: r * 0.08, scale: 1.2 };
}

/** A winding rill: lobes along a gentle S-curve, swelling and narrowing, tapering at both ends. */
function stream(rng: Rng, length: number, width: number): Draft {
  // Spaced for the narrowest (tapered) lobes, so the ends stay smooth instead of beaded.
  const half = Math.ceil(length / 2 / (width * 0.45));
  const sway = length * range(rng, 0.06, 0.16);
  const bend = range(rng, 0.6, 1.3);
  const phase = range(rng, 0, Math.PI * 2);
  const swell = range(rng, 1.5, 3);
  const swellPhase = range(rng, 0, Math.PI * 2);
  const lobes: PuddleCircle[] = [];
  for (const k of [
    0,
    ...Array.from({ length: half * 2 }, (_, i) => (i % 2 ? -1 : 1) * (1 + (i >> 1))),
  ]) {
    const t = k / half;
    lobes.push({
      x: (t * length) / 2,
      z: sway * sin(t * Math.PI * bend + phase),
      r: width * (0.8 + 0.3 * sin(t * Math.PI * swell + swellPhase)) * (1 - 0.4 * powInt(t, 4)),
    });
  }
  return { lobes, bites: [], blend: width * 0.7, amplitude: width * 0.08, scale: 1.2 };
}

/** Turns a draft to a random heading, centres it on its main lobe and seeds its rim ripple. */
function finish(rng: Rng, draft: Draft): PuddleShape {
  const heading = range(rng, 0, Math.PI * 2);
  const cosHeading = cos(heading);
  const sinHeading = sin(heading);
  const [main] = draft.lobes;
  const place = (c: PuddleCircle): PuddleCircle => ({
    x: (c.x - main!.x) * cosHeading - (c.z - main!.z) * sinHeading,
    z: (c.x - main!.x) * sinHeading + (c.z - main!.z) * cosHeading,
    r: c.r,
  });
  const lobes = draft.lobes.map(place);
  return {
    lobes,
    bites: draft.bites.map(place),
    blend: draft.blend,
    wobble: {
      seed: Math.floor(next(rng) * 0x100000000),
      amplitude: draft.amplitude,
      scale: draft.scale,
    },
    reach: outlineReach(lobes, draft.amplitude) + BANK + 0.3,
  };
}

function outlineReach(lobes: readonly PuddleCircle[], amplitude: number): number {
  return Math.max(...lobes.map((l) => hypot(l.x, l.z) + l.r)) + amplitude;
}

function scaled(shape: PuddleShape, k: number): PuddleShape {
  const circle = (c: PuddleCircle) => ({ x: c.x * k, z: c.z * k, r: c.r * k });
  const lobes = shape.lobes.map(circle);
  const amplitude = shape.wobble.amplitude * k;
  return {
    lobes,
    bites: shape.bites.map(circle),
    blend: shape.blend * k,
    wobble: { ...shape.wobble, amplitude },
    reach: outlineReach(lobes, amplitude) + BANK + 0.3,
  };
}

// ---- Placement -------------------------------------------------------------------------------------

/**
 * The lowest of `CANDIDATES` random sites (relative to the ground around it) where the whole
 * footprint is gentle, nearly level, clear of walls and of other puddles' banks; null if none fits.
 */
function findSite(
  context: SiteContext,
  shape: PuddleShape,
  pads: readonly Pad[],
  puddles: readonly Puddle[],
  rng: Rng,
): { x: number; z: number } | null {
  const { reach } = shape;
  const limit = ARENA_HALF - reach - 2;
  const sites: { x: number; z: number; lowness: number; order: number }[] = [];
  for (let order = 0; order < CANDIDATES; order++) {
    const x = range(rng, -limit, limit);
    const z = range(rng, -limit, limit);
    if (hypot(x, z) < SPAWN_CLEARING + reach) continue;
    if (pads.some((pad) => hypot(pad.x - x, pad.z - z) < pad.radius + PAD_RIM + reach + 1))
      continue;
    if (!reachableAt(context, x, z)) continue;
    const lowness = heightAt(context.terrain, x, z) - ringMean(context, x, z, reach + 2);
    sites.push({ x, z, lowness, order });
  }
  sites.sort((a, b) => a.lowness - b.lowness || a.order - b.order);
  return sites.find((site) => fits(context, { x: site.x, z: site.z, shape }, puddles)) ?? null;
}

function fits(
  context: SiteContext,
  site: Pick<Puddle, "x" | "z" | "shape">,
  puddles: readonly Puddle[],
): boolean {
  const near = puddles.filter(
    (p) => hypot(p.x - site.x, p.z - site.z) < p.radius + site.shape.reach + GAP,
  );
  const { terrain, nav, walls } = context;
  let low = Infinity;
  let high = -Infinity;
  let ok = true;
  forEachSample(terrain, site.x, site.z, site.shape.reach + GAP, (index, distance) => {
    if (!ok) return;
    const x = terrain.origin + (index % terrain.samples) / terrain.resolution;
    const z = terrain.origin + Math.floor(index / terrain.samples) / terrain.resolution;
    const d = shoreDistance(site, x, z);
    // The view draws each puddle on a disc of its reach and keeps whatever lies under any outline,
    // so no puddle's water may sit inside another's disc (it would draw twice). One sample spacing of
    // margin, so a sliver between samples cannot slip through.
    const cell = 1 / terrain.resolution;
    if (distance <= site.shape.reach + cell && near.some((p) => shoreDistance(p, x, z) < cell))
      ok = false;
    if (d < cell && near.some((p) => hypot(x - p.x, z - p.z) < p.radius + cell)) ok = false;
    if (d >= BANK + GAP) return;
    if (near.some((p) => shoreDistance(p, x, z) < BANK)) ok = false;
    if (d >= BANK) return;
    const h = terrain.heights[index]!;
    low = Math.min(low, h);
    high = Math.max(high, h);
    if (high - low > SITE_SPREAD || wallNear(walls, x, z, WALL_CLEARANCE)) ok = false;
    else if (steepnessAt(nav.grid, x, z) > SITE_STEEPNESS) ok = false;
  });
  return ok;
}

function ringMean(context: SiteContext, x: number, z: number, radius: number): number {
  let sum = 0;
  for (let k = 0; k < 12; k++) {
    const angle = (k / 12) * Math.PI * 2;
    sum += heightAt(context.terrain, x + cos(angle) * radius, z + sin(angle) * radius);
  }
  return sum / 12;
}

/**
 * Levels the footprint down to its lowest point, then digs one smooth bowl across it: `depth` below
 * that level `shelf` inside the outline, easing back to the original ground `BANK` outside it. The
 * water plane sits at the cut's height on the outline, so everything inside is wet, everything
 * outside dry, and the waterline falls where the bowl is steepest: the half-metre height grid then
 * traces the outline smoothly instead of wandering across a flat shelf.
 */
function carve(
  context: SiteContext,
  x: number,
  z: number,
  shape: PuddleShape,
  depth: number,
): Puddle {
  const { terrain } = context;
  const puddle: Puddle = { x, z, radius: shape.reach, surface: 0, depth: 0, shape };
  let level = Infinity;
  forEachFootprintSample(terrain, puddle, (index) => {
    level = Math.min(level, terrain.heights[index]!);
  });
  // How far in the outline reaches: a thin rill bottoms out sooner than a broad pond.
  const inmost = -Math.min(...shape.lobes.map((l) => shoreDistance(puddle, x + l.x, z + l.z)));
  const shelf = Math.min(SHELF, inmost * 0.9);
  const cut = (d: number) => depth * (1 - smoothstep(-shelf, BANK, d));
  forEachFootprintSample(terrain, puddle, (index, d) => {
    const original = terrain.heights[index]!;
    const levelled = original + (level - original) * (1 - smoothstep(0, BANK, d));
    terrain.heights[index] = levelled - cut(d);
  });
  puddle.surface = level - cut(0);
  forEachFootprintSample(terrain, puddle, (index) => {
    puddle.depth = Math.max(puddle.depth, puddle.surface - terrain.heights[index]!);
  });
  return puddle;
}
