import { smoothstep } from "../noise";
import { range, type Rng } from "../rng";
import { ARENA_HALF } from "../state/world";
import type { Passage } from "../terrain";
import { onPassage } from "./layout";
import { drySite, forEachSample, reachableAt, relief, wallNear, type SiteContext } from "./sites";
import type { PadSpec } from "./spec";
import { MapGenError, type Pad } from "./types";
import { hypot } from "../math";

/** Width of the blended rim joining a pad to the terrain around it. */
export const PAD_RIM = 3;
/** Pads and puddles keep this far from the level spawn clearing at the arena centre. */
export const SPAWN_CLEARING = 8;
/** Candidate sites tried per requested pad before giving up. */
const TRIES_PER_PAD = 300;
/** A pad site must already be gentle and nearly level, so the flattened rim stays easy to walk. */
const SITE_STEEPNESS = 0.45;
const SITE_SPREAD = 0.8;

/**
 * Picks every requested pad on the base terrain (gentle, level enough, no walls, reachable from
 * spawn, off every passage, apart from each other) and flattens it in place. Throws naming the pad
 * spec it could not satisfy.
 */
export function placePads(
  context: SiteContext,
  specs: readonly PadSpec[],
  passages: readonly Passage[],
  rng: Rng,
  seed: number,
): Pad[] {
  const pads: Pad[] = [];
  for (const spec of specs) {
    const outer = spec.radius + PAD_RIM;
    let placed = 0;
    let tries = 0;
    for (; placed < spec.count && tries < TRIES_PER_PAD * spec.count; tries++) {
      const limit = ARENA_HALF - outer - 1;
      const x = range(rng, -limit, limit);
      const z = range(rng, -limit, limit);
      if (hypot(x, z) < SPAWN_CLEARING + outer) continue;
      if (pads.some((pad) => hypot(pad.x - x, pad.z - z) < pad.radius + PAD_RIM + outer)) continue;
      // The blended rim may run onto a passage (it stays gentle); the flat disc may not.
      if (onPassage(passages, x, z, spec.radius)) continue;
      if (!reachableAt(context, x, z) || wallNear(context.walls, x, z, outer + 0.5)) continue;
      const site = relief(context, x, z, outer);
      if (site.steepest > SITE_STEEPNESS || site.spread > SITE_SPREAD) continue;
      if (!drySite(context, x, z, outer)) continue;
      pads.push({
        x,
        z,
        radius: spec.radius,
        height: meanHeight(context, x, z, spec.radius),
        tag: spec.tag,
      });
      placed++;
    }
    if (placed < spec.count) {
      throw new MapGenError(
        `地图生成失败：需要 ${spec.count} 块「${spec.tag}」平台（半径 ${spec.radius}，最大坡度 ${spec.maxSlope}），` +
          `${tries} 次尝试只找到 ${placed} 块合适的平地（种子 ${seed}）。`,
      );
    }
  }
  for (const pad of pads) flatten(context, pad);
  return pads;
}

function meanHeight(context: SiteContext, x: number, z: number, radius: number): number {
  let sum = 0;
  let count = 0;
  forEachSample(context.terrain, x, z, radius, (index) => {
    sum += context.terrain.heights[index]!;
    count++;
  });
  return sum / count;
}

/** Exactly level inside the radius, easing back to the original terrain across the rim. */
function flatten(context: SiteContext, pad: Pad): void {
  const { heights } = context.terrain;
  forEachSample(context.terrain, pad.x, pad.z, pad.radius + PAD_RIM, (index, distance) => {
    const weight = 1 - smoothstep(pad.radius, pad.radius + PAD_RIM, distance);
    heights[index] = heights[index]! + (pad.height - heights[index]!) * weight;
  });
}
