import type { Terrain } from "../terrain";
import { forEachFootprintSample } from "./puddles";
import type { Puddle, Water, WaterDepthGrid } from "./types";

/** Stored where no puddle reaches; any negative value reads as dry. */
const DRY = -1;

/** Water depth per terrain sample: how far the deepest covering water plane sits above the ground. */
export function buildWaterDepth(terrain: Terrain, puddles: readonly Puddle[]): WaterDepthGrid {
  const values = new Float32Array(terrain.heights.length).fill(DRY);
  for (const puddle of puddles) {
    forEachFootprintSample(terrain, puddle, (index) => {
      values[index] = Math.max(values[index]!, puddle.surface - terrain.heights[index]!);
    });
  }
  return {
    origin: terrain.origin,
    resolution: terrain.resolution,
    samples: terrain.samples,
    values,
  };
}

/**
 * Water depth at a world point (bilinear between samples, the same surface-minus-ground the renderer
 * draws); ≤ 0 is dry. Puddles are shallow and walkable for every ground unit.
 */
export function waterDepthAt(water: Water, x: number, z: number): number {
  const { samples, values, resolution, origin } = water.depth;
  const gx = Math.min(samples - 1.001, Math.max(0, (x - origin) * resolution));
  const gz = Math.min(samples - 1.001, Math.max(0, (z - origin) * resolution));
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const row = j * samples;
  const a = values[row + i]!;
  const b = values[row + i + 1]!;
  const c = values[row + samples + i]!;
  const d = values[row + samples + i + 1]!;
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
