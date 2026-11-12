// Map generation for the pure simulation: terrain, guaranteed flat pads, puddles and props from a
// seed and a spec. See docs/MAPGEN.md.
import {
  addCircleBlocker,
  addCellBlocker,
  cellAt,
  createNav,
  groundBlockedMask,
  routeReach,
  type Nav,
} from "../nav/index";
import { mobilityClasses } from "../content/mobility";
import { createRng } from "../rng";
import { createTerrain, type Terrain } from "../terrain";
import { isPatch, resolveLayout } from "./layout";
import { placePads } from "./pads";
import { placeProps } from "./props";
import { placePuddles } from "./puddles";
import type { SiteContext } from "./sites";
import type { MapSpec } from "./spec";
import { applyStamps } from "./stamps";
import type { GeneratedMap } from "./types";
import { validateMap } from "./validate";
import { buildWaterDepth } from "./water";
import { buildSurface } from "../surface";
import { buildWalls } from "./walls";

export type { MapSpec, PadSpec, PropSpec, PuddleSpec, RampSpec, StampSpec, WallSpec } from "./spec";
export { checkPlayable, stageBodies, type Bodies, type PlayableSpots } from "./playable";
export {
  MapGenError,
  type GeneratedMap,
  type Pad,
  type Puddle,
  type PuddleShape,
  type Water,
  type WaterDepthGrid,
} from "./types";
export { waterDepthAt } from "./water";
export { shoreDistance } from "./puddles";
export { PAD_RIM } from "./pads";
export { PROP_HEIGHT } from "./props";

/** Map generation draws from its own stream, so it never shifts the world's gameplay randomness. */
const MAP_STREAM = 0x6d617067;

/** A generated map and the nav assembled on its final terrain, solid props already registered. */
export interface BuiltMap {
  map: GeneratedMap;
  /** Runtime state, not part of the map contract: the world takes it over. */
  nav: Nav;
}

/**
 * Staged, deterministic pipeline: layout (passages, stamps, floor templates) → value-noise terraces,
 * gentle along passages → stamps/walls → flat pads → puddles → props → validation → nav assembly. Every
 * pad and the minimum puddle count are guaranteed; anything that cannot be met throws an error
 * naming the requirement and the seed. Playability is accepted afterwards on the assembled world
 * (`checkPlayable`), once stations stand too.
 */
export function generateMap(seed: number, spec: MapSpec): BuiltMap {
  const rng = createRng((seed ^ MAP_STREAM) >>> 0);
  const layout = resolveLayout(seed, spec);
  const terrain = createTerrain(seed, spec.terrain, layout.passages);
  applyStamps(terrain, layout.stamps, layout.passages);
  if (layout.floor) terrain.walls = buildWalls(terrain, layout.floor);
  const patches = layout.stamps.filter(isPatch);
  // Static seas/lava and surface patches participate in site selection before pads can be placed in them.
  terrain.surface = buildSurface(terrain, buildWaterDepth(terrain, []), spec.surface, patches);
  const base = siteContext(terrain);
  const pads = placePads(base, spec.pads, layout.passages, rng, seed);
  const puddles = placePuddles(base, spec.puddles, pads, rng, seed);
  const water = { puddles, depth: buildWaterDepth(terrain, puddles) };
  terrain.surface = buildSurface(terrain, water.depth, spec.surface, patches);
  const carved = siteContext(terrain);
  const obstacles = placeProps(carved, spec, pads, puddles, layout.passages, rng);
  validateMap(carved, spec, pads, puddles, obstacles, seed);
  for (const o of obstacles) if (o.solid) addCircleBlocker(carved.nav, o.x, o.z, o.radius);
  return {
    map: { terrain, water, pads, obstacles, passages: layout.passages },
    nav: carved.nav,
  };
}

function siteContext(terrain: Terrain): SiteContext {
  const nav = createNav(terrain);
  const cells: number[] = [];
  const walls = terrain.walls;
  if (walls) {
    for (let gz = 0; gz < nav.grid.size; gz++) {
      for (let gx = 0; gx < nav.grid.size; gx++) {
        const x = nav.grid.min + gx * nav.grid.cell;
        const z = nav.grid.min + gz * nav.grid.cell;
        const i = Math.round((x - walls.origin) * walls.resolution);
        const j = Math.round((z - walls.origin) * walls.resolution);
        if (walls.heights[j * walls.samples + i]! > 0) cells.push(cellAt(nav.grid, x, z));
      }
    }
    addCellBlocker(nav, cells);
  }
  const mask = groundBlockedMask(nav);
  for (const cell of cells) {
    const gx = (cell % nav.grid.stride) - 1;
    const gz = Math.floor(cell / nav.grid.stride) - 1;
    mask.data[gz * mask.width + gx] = 255;
  }
  return {
    terrain,
    nav,
    walls: mask,
    reachable: routeReach(nav, mobilityClasses.ground, [nav.grid.home], false),
  };
}
