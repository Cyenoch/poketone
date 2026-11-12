import { steepnessAt } from "../nav/index";
import { pick, range, type Rng } from "../rng";
import { ARENA_HALF } from "../state/world";
import type { Passage } from "../terrain";
import { onPassage } from "./layout";
import type { Obstacle } from "../state/entities";
import { PAD_RIM } from "./pads";
import { clearOfPuddle } from "./puddles";
import { drySite, type SiteContext } from "./sites";
import type { MapSpec } from "./spec";
import type { Pad, Puddle } from "./types";
import { cos, hypot, sin } from "../math";
import { cellWallOverlap } from "../nav/blockers";
import { sampleDepth } from "../surface";

/** Model height per unit of render scale: the view sizes the GLBs to it, and solid props block shots below it. */
export const PROP_HEIGHT: Record<Obstacle["kind"], number> = {
  tree: 3.1,
  pine: 3.5,
  rock: 1.5,
  bush: 1.2,
  palm: 3.6,
};
/** Props keep out of the spawn clearing. */
const SPAWN_PROPS = 7;
/** Solid props stay off cliff faces so they never plug the ramp beside one. */
const PROP_MAX_STEEPNESS = 0.5;
/**
 * Collision radius per unit of render scale, measured from the shipping GLBs (Blender: 85th-percentile
 * horizontal spread of vertices in the bottom quarter of the model, × render height, × 0.85 so the
 * circle sits just inside the visible base). Trees collide at the trunk only, so the canopy can be
 * brushed under (it dither-fades); pines at their lowest branch tier; bushes are not solid.
 */
const FOOTPRINT: Record<Obstacle["kind"], number> = {
  rock: 0.72,
  tree: 0.3,
  pine: 0.5,
  bush: 0.5,
  palm: 0.3,
};
/** Tries per requested prop before the generator settles for fewer (props are scenery, not a guarantee). */
const TRIES_PER_PROP = 30;

/**
 * Scatters the spec's props (never on pads, their rims, water or the spawn clearing; solid ones never
 * on a passage), then the wall.
 */
export function placeProps(
  context: SiteContext,
  spec: MapSpec,
  pads: readonly Pad[],
  puddles: readonly Puddle[],
  passages: readonly Passage[],
  rng: Rng,
): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const free = (x: number, z: number, radius: number, gap: number) =>
    hypot(x, z) > SPAWN_PROPS &&
    pads.every((pad) => hypot(pad.x - x, pad.z - z) > pad.radius + PAD_RIM + radius) &&
    puddles.every((p) => clearOfPuddle(p, x, z, radius)) &&
    obstacles.every((o) => hypot(o.x - x, o.z - z) > o.radius + radius + gap);
  for (const prop of spec.props) {
    // The beach strip covers far less of the map than the ordinary inland prop sites.
    const attempts = prop.count * TRIES_PER_PROP * (prop.kind === "palm" ? 4 : 1);
    for (let placed = 0, tries = 0; placed < prop.count && tries < attempts; tries++) {
      const x = range(rng, -ARENA_HALF + 3, ARENA_HALF - 3);
      const z = range(rng, -ARENA_HALF + 3, ARENA_HALF - 3);
      const scale = range(rng, prop.scale[0], prop.scale[1]);
      const radius = scale * FOOTPRINT[prop.kind];
      if (prop.kind === "palm") {
        const surface = context.terrain.surface!;
        // Palms occupy the dry beach behind the wash, within eight metres of the sea.
        if (surface.ground !== "sand") continue;
        let nearSea = false;
        let inWash = false;
        for (let side = 0; side < 8; side++) {
          const angle = (side * Math.PI) / 4;
          const dx = cos(angle),
            dz = sin(angle);
          if (sampleDepth(surface.water, x + dx * 8, z + dz * 8) > 0) nearSea = true;
          if (sampleDepth(surface.water, x + dx * 2.5, z + dz * 2.5) > 0) inWash = true;
        }
        if (!nearSea || inWash) continue;
      }
      if (!free(x, z, radius, prop.gap)) continue;
      if (cellWallOverlap(context.nav.grid, x, z, radius)) continue;
      if (prop.solid && steepnessAt(context.nav.grid, x, z) > PROP_MAX_STEEPNESS) continue;
      if (prop.solid && onPassage(passages, x, z, radius)) continue;
      if (!drySite(context, x, z, radius)) continue;
      const rotation = range(rng, 0, Math.PI * 2);
      obstacles.push({ kind: prop.kind, x, z, radius, scale, rotation, solid: prop.solid });
      placed++;
    }
  }
  // Dense, non-colliding wall just outside the playable square.
  for (let i = 0; i < spec.wall.count; i++) {
    const side = i % 4;
    const along = range(rng, -ARENA_HALF - 6, ARENA_HALF + 6);
    const depth = ARENA_HALF + range(rng, 2.5, 9);
    const x = side === 0 ? along : side === 1 ? along : side === 2 ? depth : -depth;
    const z = side === 0 ? depth : side === 1 ? -depth : along;
    obstacles.push({
      kind: pick(rng, spec.wall.kinds),
      x,
      z,
      radius: 0.8,
      scale: range(rng, 0.9, 1.4),
      rotation: range(rng, 0, Math.PI * 2),
      solid: false,
    });
  }
  return obstacles;
}
