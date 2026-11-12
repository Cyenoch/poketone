import { QUICKSAND, ICE_SHORE } from "./content/params/environment";
import type { WaterDepthGrid } from "./mapgen/types";
import type { Terrain } from "./terrain";
import { atan2, sin, cos } from "./math";

export type SurfaceKind = "ground" | "ice" | "sand" | "water" | "lava" | SurfacePatch["kind"];

/**
 * A flat ground patch a map stamp places (docs/state-machines/simulation.md): quicksand slows ground bodies and
 * pulls them to its centre, burning ground (`embers`) hurts players standing on it. Liquids cover it.
 */
export interface SurfacePatch {
  kind: "quicksand" | "embers" | "ice-slick";
  x: number;
  z: number;
  radius: number;
}

export function iceShorePhase(patch: Pick<SurfacePatch, "x" | "z">): number {
  return patch.x * 0.17 + patch.z * 0.31;
}

export function iceShoreRadius(patch: SurfacePatch, angle: number): number {
  const phase = iceShorePhase(patch);
  return (
    patch.radius *
    (ICE_SHORE.base +
      ICE_SHORE.bay * sin(angle * 3 + phase) +
      ICE_SHORE.inlet * cos(angle * 5 - phase) +
      ICE_SHORE.skew * sin(angle * 2 + phase * 0.7))
  );
}

/** Static planes share the final heightfield; puddles contribute to the same water depth grid. */
export interface LiquidPlane {
  kind: "water" | "lava";
  level: number;
}

export interface SurfaceSpec {
  /** Sand and ice grow nothing (the view's ground layers); no rule reads them yet. */
  ground: "ground" | "ice" | "sand";
  /** Applies only while in water; the forest keeps its original movement. */
  shallowSpeed: number;
  liquids: readonly LiquidPlane[];
}

export interface SurfaceGrid {
  ground: SurfaceSpec["ground"];
  shallowSpeed: number;
  liquids: readonly LiquidPlane[];
  water: WaterDepthGrid;
  lava: WaterDepthGrid;
  patches: readonly SurfacePatch[];
}

export interface SurfaceSample {
  kind: SurfaceKind;
  waterDepth: number;
  lavaDepth: number;
  speed: number;
  /** The patch underfoot when nothing liquid covers it. */
  patch: SurfacePatch | null;
}

export function sampleDepth(grid: WaterDepthGrid, x: number, z: number): number {
  const { samples, values, resolution, origin } = grid;
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

/** One surface query for movement, statuses, hazards and map rendering. Uncarved terrain is dry. */
export function sampleSurface(
  surface: SurfaceGrid | undefined,
  x: number,
  z: number,
): SurfaceSample {
  if (!surface) return { kind: "ground", waterDepth: 0, lavaDepth: 0, speed: 1, patch: null };
  const waterDepth = Math.max(0, sampleDepth(surface.water, x, z));
  const lavaDepth = Math.max(0, sampleDepth(surface.lava, x, z));
  if (lavaDepth > 0 || waterDepth > 0)
    return {
      kind: lavaDepth > 0 ? "lava" : "water",
      waterDepth,
      lavaDepth,
      speed: waterDepth > 0 ? surface.shallowSpeed : 1,
      patch: null,
    };
  const patch = patchAt(surface.patches, x, z);
  return {
    kind: patch ? patch.kind : surface.ground,
    waterDepth,
    lavaDepth,
    speed: patch?.kind === "quicksand" ? QUICKSAND.speed : 1,
    patch,
  };
}

function patchAt(patches: readonly SurfacePatch[], x: number, z: number): SurfacePatch | null {
  for (const patch of patches) {
    const dx = x - patch.x,
      dz = z - patch.z;
    if (dx ** 2 + dz ** 2 > patch.radius ** 2) continue;
    const radius = patch.kind === "ice-slick" ? iceShoreRadius(patch, atan2(dz, dx)) : patch.radius;
    if (dx ** 2 + dz ** 2 <= radius ** 2) return patch;
  }
  return null;
}

/** Called after all carving: the water grid is the very same object retained in map.water. */
export function buildSurface(
  terrain: Terrain,
  water: WaterDepthGrid,
  spec: SurfaceSpec,
  patches: readonly SurfacePatch[],
): SurfaceGrid {
  const lava = { ...water, values: new Float32Array(water.values.length).fill(-1) };
  for (const plane of spec.liquids) {
    const depths = plane.kind === "water" ? water.values : lava.values;
    for (let i = 0; i < depths.length; i++)
      depths[i] = Math.max(depths[i]!, plane.level - terrain.heights[i]!);
  }
  return { ...spec, water, lava, patches };
}
