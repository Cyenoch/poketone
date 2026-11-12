import { createRng, next, range } from "../rng";
import { polylineDistance, type Passage } from "../terrain";
import type { FloorBlock, MapSpec, RampSpec } from "./spec";
import type { SurfacePatch } from "../surface";
import { cos, sin } from "../math";

/** The layout draws from its own stream, so a map without stamps keeps every other draw where it was. */
const LAYOUT_STREAM = 0x6c61796f;
/** A ramp's passage runs this far past its foot and onto the top it climbs to. */
const RAMP_OVERRUN = 1.5;

/** A ramp placed in the world: its rim point, outward direction and size. */
export interface Ramp {
  x: number;
  z: number;
  dx: number;
  dz: number;
  width: number;
  length: number;
}

export type Stamp =
  | {
      kind: "mesa";
      x: number;
      z: number;
      radius: number;
      height: number;
      edge: number;
      ramps: Ramp[];
    }
  | {
      kind: "ring";
      x: number;
      z: number;
      radius: number;
      thickness: number;
      height: number;
      edge: number;
      /** Two per designed ramp: one down the outside, one down the inside. */
      ramps: Ramp[];
    }
  | {
      kind: "trench";
      points: (readonly [number, number])[];
      width: number;
      depth: number;
      edge: number;
    }
  | SurfacePatch;

/** A surface patch stamp (quicksand, burning ground): flat, it only marks the surface. */
export function isPatch<T extends { kind: string }>(
  stamp: T,
): stamp is Extract<T, { kind: SurfacePatch["kind"] }> {
  return stamp.kind === "quicksand" || stamp.kind === "embers" || stamp.kind === "ice-slick";
}

/** The seed's placement of stamps, floor blocks and every passage that must stay open. */
export interface Layout {
  stamps: Stamp[];
  /** The spec's passages plus one per ramp, in world coordinates. */
  passages: Passage[];
  floor: { id: string; blocks: FloorBlock[] } | undefined;
}

/**
 * Picks an authored floor when present, then places its blocks/passages and the spec's stamps.
 * Stamps move by their jitter; the whole layout takes one of the square's eight symmetries.
 */
export function resolveLayout(seed: number, spec: MapSpec): Layout {
  const rng = createRng((seed ^ LAYOUT_STREAM) >>> 0);
  const turns = Math.floor(next(rng) * 4);
  const mirror = next(rng) < 0.5;
  const place = (x: number, z: number): [number, number] => {
    let [px, pz] = mirror ? [-x, z] : [x, z];
    for (let t = 0; t < turns; t++) [px, pz] = [-pz, px];
    return [px, pz];
  };
  const direction = (angle: number): [number, number] => place(cos(angle), sin(angle));
  const template = spec.templates?.[Math.floor(next(rng) * spec.templates.length)];
  const passages: Passage[] = [...spec.passages, ...(template?.passages ?? [])].map((passage) => ({
    points: passage.points.map(([x, z]) => place(x, z)),
    width: passage.width,
  }));
  const stamps = spec.stamps.map((stamp): Stamp => {
    if (stamp.kind === "trench") {
      const { width, depth, edge } = stamp;
      return {
        kind: "trench",
        points: stamp.points.map(([x, z]) => place(x, z)),
        width,
        depth,
        edge,
      };
    }
    const [ax, az] = stamp.at;
    const [x, z] = place(
      ax + range(rng, -stamp.jitter, stamp.jitter),
      az + range(rng, -stamp.jitter, stamp.jitter),
    );
    if (isPatch(stamp)) return { kind: stamp.kind, x, z, radius: stamp.radius };
    const rim = (ramp: RampSpec, radius: number, sign: 1 | -1): Ramp => {
      const [dx, dz] = direction(ramp.angle);
      return {
        x: x + dx * radius,
        z: z + dz * radius,
        dx: dx * sign,
        dz: dz * sign,
        width: ramp.width,
        length: ramp.length,
      };
    };
    const foot = (ramp: Ramp, past: number): [number, number] => [
      ramp.x + ramp.dx * past,
      ramp.z + ramp.dz * past,
    ];
    if (stamp.kind === "mesa") {
      const ramps = stamp.ramps.map((ramp) => rim(ramp, stamp.radius, 1));
      for (const ramp of ramps) {
        passages.push({
          points: [foot(ramp, ramp.length + RAMP_OVERRUN), foot(ramp, -RAMP_OVERRUN)],
          width: ramp.width,
        });
      }
      const { radius, height, edge } = stamp;
      return { kind: "mesa", x, z, radius, height, edge, ramps };
    }
    const half = stamp.thickness / 2;
    const ramps: Ramp[] = [];
    for (const designed of stamp.ramps) {
      const outside = rim(designed, stamp.radius + half, 1);
      const inside = rim(designed, stamp.radius - half, -1);
      ramps.push(outside, inside);
      passages.push({
        points: [
          foot(outside, outside.length + RAMP_OVERRUN),
          foot(inside, inside.length + RAMP_OVERRUN),
        ],
        width: designed.width,
      });
    }
    const { radius, thickness, height, edge } = stamp;
    return { kind: "ring", x, z, radius, thickness, height, edge, ramps };
  });
  const floor = template && {
    id: template.id,
    blocks: template.blocks.map((block) => ({
      ...block,
      at: place(...block.at),
      size: turns % 2 === 0 ? block.size : ([block.size[1], block.size[0]] as const),
    })),
  };
  return { stamps, passages, floor };
}

/** Whether a circle of `radius` at (x, z) overlaps any passage band. */
export function onPassage(
  passages: readonly Passage[],
  x: number,
  z: number,
  radius: number,
): boolean {
  return passages.some((p) => polylineDistance(p.points, x, z) < p.width / 2 + radius);
}
