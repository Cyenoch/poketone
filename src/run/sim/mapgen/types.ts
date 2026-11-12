import type { Passage, Terrain } from "../terrain";
import type { Obstacle } from "../state/entities";

/** A seed whose terrain cannot satisfy the map spec; the caller draws another seed. */
export class MapGenError extends Error {}

/** A guaranteed flat site, flattened to `height` within `radius`. */
export interface Pad {
  x: number;
  z: number;
  radius: number;
  height: number;
  tag: string;
}

export interface PuddleCircle {
  x: number;
  z: number;
  r: number;
}

/** A puddle's designed outline around its centre; `shoreDistance` turns it into a signed distance. */
export interface PuddleShape {
  /** Circles (relative to the centre) smoothly merged into one body; the first sits on the centre. */
  lobes: PuddleCircle[];
  /** Circles smoothly cut out of that body: coves, kidney dents, the inside of a crescent. */
  bites: PuddleCircle[];
  /** Smooth-union width where lobes meet (and bites cut). */
  blend: number;
  /** Seeded value noise rippling the rim by up to `amplitude` metres, its bumps about `scale` metres apart. */
  wobble: { seed: number; amplitude: number; scale: number };
  /** Outline plus its bank: the carve never reaches further from the centre. */
  reach: number;
}

/** A shallow depression carved into the terrain; the waterline is the outline of `shape`. */
export interface Puddle {
  /** Centre of the main lobe; always under water. */
  x: number;
  z: number;
  /** Reach of the carved footprint (shoreline plus bank) from the centre; dry ground beyond. */
  radius: number;
  /** World y of the water plane. */
  surface: number;
  /** Deepest water. */
  depth: number;
  shape: PuddleShape;
}

/** Water depth per terrain sample (same layout as `Terrain`); ≤ 0 is dry. */
export interface WaterDepthGrid {
  origin: number;
  resolution: number;
  samples: number;
  values: Float32Array;
}

export interface Water {
  puddles: Puddle[];
  depth: WaterDepthGrid;
}

/** The one serialisable map contract: everything generation decided, nothing runtime. */
export interface GeneratedMap {
  terrain: Terrain;
  obstacles: Obstacle[];
  water: Water;
  pads: Pad[];
  /** Bands the layout keeps open, world coordinates; the acceptance walks them. */
  passages: Passage[];
}
