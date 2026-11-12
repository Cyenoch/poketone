import type { Obstacle } from "../state/entities";
import type { Passage, TerrainSpec } from "../terrain";
import type { SurfacePatch, SurfaceSpec } from "../surface";

type Point = readonly [number, number];

/** Authored rectangles rasterised once to the navigation grid, before any sites are picked. */
export interface FloorBlock {
  kind: "wall" | "pillar" | "tombstone";
  at: Point;
  size: Point;
  height: number;
}

/** A floor is layout data for the normal map pipeline, not a separate generator. */
export interface FloorTemplate {
  id: string;
  passages: readonly Passage[];
  blocks: readonly FloorBlock[];
}

/** A gentle way up a raised stamp's edge: `angle` (radians from +X toward +Z) names the side. */
export interface RampSpec {
  angle: number;
  /** Walkable width; the ramp's sides drop as steeply as the stamp's edge. */
  width: number;
  /** Horizontal run from the rim to the foot. Its steepest grade is 1.5 × height / length. */
  length: number;
}

/**
 * A large landform added on top of the terraces (docs/MAPGEN.md 图章). `at` is the design position;
 * each seed moves it by up to `jitter` on both axes, then the whole layout takes one of the square's
 * eight rotations / mirrors.
 */
export type StampSpec =
  | {
      /** A raised disc: flat top, an `edge`-wide cliff, ramps down to the ground. */
      kind: "mesa";
      at: Point;
      jitter: number;
      radius: number;
      height: number;
      edge: number;
      ramps: readonly RampSpec[];
    }
  | {
      /** A raised ring around `at`; each ramp crosses it, down both sides. */
      kind: "ring";
      at: Point;
      jitter: number;
      radius: number;
      thickness: number;
      height: number;
      edge: number;
      ramps: readonly RampSpec[];
    }
  | {
      /** A sunken channel along a polyline; passages cross it on causeways at ground level. */
      kind: "trench";
      points: readonly Point[];
      width: number;
      depth: number;
      edge: number;
    }
  | {
      /** A flat surface patch (sim/surface.ts `SurfacePatch`): no landform; pads and props keep off it. */
      kind: SurfacePatch["kind"];
      at: Point;
      jitter: number;
      radius: number;
    };

/** A flat site the map must contain, e.g. for a future building. */
export interface PadSpec {
  tag: string;
  /** Flat radius; a blended rim of `PAD_RIM` world units joins it to the terrain around it. */
  radius: number;
  count: number;
  /** Steepest ground allowed inside the pad. */
  maxSlope: number;
}

export interface PuddleSpec {
  /** Inclusive range; the generator throws if it cannot place the minimum. */
  count: readonly [number, number];
  /** Deepest the bowl is cut below the levelled ground; the water is a little shallower than that. */
  depth: number;
}

export interface PropSpec {
  kind: Obstacle["kind"];
  count: number;
  /** Render scale range; the collision radius is derived from it per kind (see `FOOTPRINT` in props.ts). */
  scale: readonly [number, number];
  solid: boolean;
  /** Minimum clearance to other props, beyond both radii. */
  gap: number;
}

/** Decorative, non-colliding props just outside the playable square. */
export interface WallSpec {
  count: number;
  /** Each wall prop's kind is picked uniformly from this list (repeat a kind to weight it). */
  kinds: readonly [Obstacle["kind"], ...Obstacle["kind"][]];
}

/** Everything a map must contain; `generateMap` guarantees it or throws naming what failed. */
export interface MapSpec {
  terrain: TerrainSpec;
  surface: SurfaceSpec;
  /** Pick one authored floor with the layout stream; transform its passages and blocks together. */
  templates?: readonly FloorTemplate[];
  /** Bands kept open from the start (design coordinates, moved with the layout); stamp ramps add their own. */
  passages: readonly Passage[];
  stamps: readonly StampSpec[];
  pads: readonly PadSpec[];
  puddles: PuddleSpec;
  props: readonly PropSpec[];
  wall: WallSpec;
}
