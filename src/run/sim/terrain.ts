import { smoothstep, valueNoise } from "./noise";
import { ARENA_HALF } from "./state/world";
import { hypot } from "./math";
import type { SurfaceGrid } from "./surface";
import type { GridWalls } from "./mapgen/walls";

/**
 * Terraced heightfield shared by the renderer (geometry, shaders, decals) and, later, gameplay.
 * Deterministic from the run seed so every co-op peer builds the same map. Movement stays 2D.
 */
export interface Terrain {
  /** World X/Z of sample (0, 0). */
  origin: number;
  /** Samples per world unit. */
  resolution: number;
  /** Samples per side. */
  samples: number;
  heights: Float32Array;
  /** Height of one terrace. */
  step: number;
  levels: number;
  /** Attached once carving is complete; the bare heightfield has no surface effects yet. */
  surface?: SurfaceGrid;
  /** Static grid occupancy and cover height; carried intact by the shared map assembly. */
  walls?: GridWalls;
}

/** A stage's relief (`MapSpec.terrain`). */
export interface TerrainSpec {
  /** Terrace count; ground spans 0 to `levels × step` before the rolling on top. */
  levels: number;
  /** Height of one terrace. */
  step: number;
  /** World units across the broadest noise octave: larger means wider plateaus. */
  wavelength: number;
  /** Fraction of each terrace band spent on its slope: cliffs near `cliffRamp`, gentle hillsides near `gentleRamp`. */
  cliffRamp: number;
  gentleRamp: number;
  /** Soft rolling on top of the terraces; keep it well under the shader's ink-line slope threshold. */
  undulation: number;
  /** How far toward the top the land climbs at the arena edge, as a share of the full relief. */
  rim: number;
}

/**
 * A band the layout keeps open (docs/MAPGEN.md 布局): terraces inside it are gentle hillsides, props
 * and pads stay off it, and the final acceptance walks its centreline both ways.
 */
export interface Passage {
  /** Centreline, world X/Z; at least two points. */
  points: readonly (readonly [number, number])[];
  width: number;
}

export const TERRAIN_HALF = ARENA_HALF + 14;
const RESOLUTION = 2;
/** Beyond a passage's half width, terraces ease back from gentle to their own ramp over this far. */
const PASSAGE_BLEND = 4;

function rawHeight(spec: TerrainSpec, seed: number, x: number, z: number): number {
  const f = 1 / spec.wavelength;
  let v = valueNoise(seed, x * f, z * f) * 0.62;
  v += valueNoise(seed ^ 0x9e37, x * f * 2.1, z * f * 2.1) * 0.28;
  v += valueNoise(seed ^ 0x51ed, x * f * 4.3, z * f * 4.3) * 0.1;
  // Keep the spawn clearing level and let the land climb toward the wall.
  const spawn = smoothstep(7, 16, hypot(x, z));
  const rim = smoothstep(ARENA_HALF - 6, ARENA_HALF + 6, Math.max(Math.abs(x), Math.abs(z)));
  return Math.min(0.999, Math.max(0, (v - 0.38) * 1.7 * spawn + rim * spec.rim));
}

/** Distance from (x, z) to a polyline. */
export function polylineDistance(
  points: readonly (readonly [number, number])[],
  x: number,
  z: number,
): number {
  let best = Infinity;
  for (let k = 1; k < points.length; k++) {
    const [ax, az] = points[k - 1]!;
    const [bx, bz] = points[k]!;
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}

/** 1 inside any passage band, easing to 0 across `PASSAGE_BLEND` beyond its half width. */
function passageWeight(passages: readonly Passage[], x: number, z: number): number {
  let weight = 0;
  for (const passage of passages) {
    const half = passage.width / 2;
    const d = polylineDistance(passage.points, x, z);
    weight = Math.max(weight, 1 - smoothstep(half, half + PASSAGE_BLEND, d));
  }
  return weight;
}

/** Value-noise terraces, flat at the spawn clearing and gentle along the layout's passages. */
export function createTerrain(
  seed: number,
  spec: TerrainSpec,
  passages: readonly Passage[],
): Terrain {
  const samples = TERRAIN_HALF * 2 * RESOLUTION + 1;
  const heights = new Float32Array(samples * samples);
  const origin = -TERRAIN_HALF;
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const x = origin + i / RESOLUTION;
      const z = origin + j / RESOLUTION;
      const band = rawHeight(spec, seed, x, z) * spec.levels;
      const level = Math.floor(band);
      // Some edges are sheer cliffs, others long walkable hillsides: a slow noise picks the ramp width.
      const gentleness = smoothstep(0.46, 0.54, valueNoise(seed ^ 0x7a3b, x / 15, z / 15));
      let ramp = spec.cliffRamp + (spec.gentleRamp - spec.cliffRamp) * gentleness;
      // The widest ramp (the whole terrace band) along passages, so they never cross a cliff.
      ramp += (1 - ramp) * passageWeight(passages, x, z);
      const roll = (valueNoise(seed ^ 0x2c1f, x / 9, z / 9) - 0.5) * spec.undulation;
      heights[j * samples + i] = (level + smoothstep(1 - ramp, 1, band - level)) * spec.step + roll;
    }
  }
  // One 3×3 box pass rounds off the sample-grid staircase without turning cliffs into ramps.
  blur(heights, samples);
  return { origin, resolution: RESOLUTION, samples, heights, step: spec.step, levels: spec.levels };
}

function blur(heights: Float32Array, samples: number): void {
  const source = heights.slice();
  for (let j = 1; j < samples - 1; j++) {
    for (let i = 1; i < samples - 1; i++) {
      let sum = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const row = (j + dj) * samples + i;
        sum += source[row - 1]! + source[row]! + source[row + 1]!;
      }
      heights[j * samples + i] = sum / 9;
    }
  }
}

/** Bilinear height at a world position; clamps outside the field. */
export function heightAt(terrain: Terrain, x: number, z: number): number {
  const { samples, heights, resolution, origin } = terrain;
  const gx = Math.min(samples - 1.001, Math.max(0, (x - origin) * resolution));
  const gz = Math.min(samples - 1.001, Math.max(0, (z - origin) * resolution));
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const row = j * samples;
  const a = heights[row + i]!;
  const b = heights[row + i + 1]!;
  const c = heights[row + samples + i]!;
  const d = heights[row + samples + i + 1]!;
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
