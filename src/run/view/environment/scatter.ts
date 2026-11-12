import type { Steps } from "../../../prepare/steps";
import { TERRAIN_HALF, type Terrain } from "../../sim/terrain";
import type { GroundLayers } from "./ground";
import { PAD_RIM, shoreDistance, type GeneratedMap } from "../../sim/mapgen/index";
import { sampleDepth } from "../../sim/surface";
import { latticeHash } from "./noise";

/** Plants keep this far back from a shoreline beyond their own spread, clear of the foam line. */
const SHORE_CLEARANCE = 0.05;

/**
 * Far enough from every puddle for a plant whose leaves spread `reach` metres around its root,
 * measured to the outline the water shader draws, so no blade or petal leans out over the water.
 */
export function aboveWater(map: GeneratedMap, x: number, z: number, reach: number): boolean {
  const clear = reach + SHORE_CLEARANCE;
  if (map.terrain.surface) {
    for (const [dx, dz] of [
      [0, 0],
      [reach, 0],
      [-reach, 0],
      [0, reach],
      [0, -reach],
    ]) {
      if (
        sampleDepth(map.terrain.surface.water, x + dx!, z + dz!) >= 0 ||
        sampleDepth(map.terrain.surface.lava, x + dx!, z + dz!) >= 0
      )
        return false;
    }
  }
  return map.water.puddles.every(
    (p) => Math.hypot(x - p.x, z - p.z) > p.radius + clear || shoreDistance(p, x, z) > clear,
  );
}

/** On a building pad (flat site plus its blended rim): plain lawn, no flowers or tall tufts. */
export function onPad(map: GeneratedMap, x: number, z: number): boolean {
  return map.pads.some((pad) => Math.hypot(x - pad.x, z - pad.z) < pad.radius + PAD_RIM);
}

/** What a plant layer needs to decide where it grows. Deterministic from the run seed. */
export interface PlantPlacement {
  terrain: Terrain;
  layers: GroundLayers;
  /** Water (no plants in it) and building pads (kept as plain lawn). */
  map: GeneratedMap;
  seed: number;
  /** 1 on desktop; lower on phones. */
  density: number;
}

/**
 * One jittered point per grid cell over the whole terrain. `roll(salt)` is a stable random in 0..1 for
 * the current cell, so each layer can draw several independent decisions per point.
 */
/** Steps (`prepare/steps.ts`): yields between bands of rows. */
export function* scatter(
  spacing: number,
  seed: number,
  visit: (x: number, z: number, roll: (salt: number) => number) => void,
): Steps<void> {
  const cells = Math.floor((TERRAIN_HALF * 2) / spacing);
  let ix = 0;
  let iz = 0;
  const roll = (salt: number) => latticeHash(seed ^ salt, ix, iz);
  for (iz = 0; iz < cells; iz++) {
    if (iz % 8 === 7) yield;
    for (ix = 0; ix < cells; ix++) {
      visit(
        -TERRAIN_HALF + (ix + roll(0x1b873593)) * spacing,
        -TERRAIN_HALF + (iz + roll(0x7feb352d)) * spacing,
        roll,
      );
    }
  }
}
