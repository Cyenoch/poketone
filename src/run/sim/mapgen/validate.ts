import { steepnessAt } from "../nav/index";
import { heightAt } from "../terrain";
import type { Obstacle } from "../state/entities";
import { PAD_RIM, SPAWN_CLEARING } from "./pads";
import { forEachFootprintSample } from "./puddles";
import { drySite, forEachSample, wallNear, type SiteContext } from "./sites";
import type { MapSpec } from "./spec";
import { MapGenError, type Pad, type Puddle } from "./types";
import { hypot } from "../math";

/** Flattened pads must match their height to within this. */
const PAD_TOLERANCE = 0.001;
/** Samples this close to a puddle outline may fall either side of the waterline. */
const SHORE_TOLERANCE = 0.02;
/** The spawn clearing must stay this gentle. */
const SPAWN_STEEPNESS = 0.3;

/**
 * Re-checks the terrain guarantees on the finished terrain (and its fresh nav) and throws naming the
 * first one broken. Placement already aims for all of them; this is the contract, not a second
 * chance. Reachability is not checked here: it depends on blockers, so `checkPlayable` checks it on
 * the assembled nav.
 */
export function validateMap(
  context: SiteContext,
  spec: MapSpec,
  pads: readonly Pad[],
  puddles: readonly Puddle[],
  obstacles: readonly Obstacle[],
  seed: number,
): void {
  const fail = (what: string) => {
    throw new MapGenError(`地图校验失败（种子 ${seed}）：${what}`);
  };
  for (const padSpec of spec.pads) {
    const found = pads.filter((pad) => pad.tag === padSpec.tag).length;
    if (found !== padSpec.count)
      fail(`「${padSpec.tag}」平台需要 ${padSpec.count} 块，实际 ${found} 块`);
  }
  for (const pad of pads) {
    const name = `「${pad.tag}」平台 (${pad.x.toFixed(1)}, ${pad.z.toFixed(1)})`;
    const maxSlope = spec.pads.find((p) => p.tag === pad.tag)!.maxSlope;
    if (!drySite(context, pad.x, pad.z, pad.radius + PAD_RIM)) fail(`${name} 浸入液体`);
    forEachSample(context.terrain, pad.x, pad.z, pad.radius, (index) => {
      if (Math.abs(context.terrain.heights[index]! - pad.height) > PAD_TOLERANCE)
        fail(`${name} 不平`);
    });
    // Steepness uses neighbours half a cell out, so stay that far inside the flat disc.
    forEachSample(context.terrain, pad.x, pad.z, pad.radius - 0.5, (index) => {
      const { origin, resolution, samples } = context.terrain;
      const x = origin + (index % samples) / resolution;
      const z = origin + Math.floor(index / samples) / resolution;
      if (steepnessAt(context.nav.grid, x, z) > maxSlope) fail(`${name} 坡度超过 ${maxSlope}`);
    });
    if (hypot(pad.x, pad.z) < SPAWN_CLEARING + pad.radius) fail(`${name} 压到了出生空地`);
    if (wallNear(context.walls, pad.x, pad.z, pad.radius + 0.5)) fail(`${name} 有崖壁`);
    for (const o of obstacles) {
      if (o.solid && hypot(o.x - pad.x, o.z - pad.z) < pad.radius + PAD_RIM + o.radius)
        fail(`${name} 上有实体道具`);
    }
    for (const p of puddles) {
      if (hypot(p.x - pad.x, p.z - pad.z) < pad.radius + PAD_RIM + p.radius)
        fail(`${name} 上有水洼`);
    }
  }
  for (const puddle of puddles) {
    const name = `水洼 (${puddle.x.toFixed(1)}, ${puddle.z.toFixed(1)})`;
    if (puddle.surface - heightAt(context.terrain, puddle.x, puddle.z) <= 0)
      fail(`${name} 中心没有水`);
    const { heights } = context.terrain;
    forEachFootprintSample(context.terrain, puddle, (index, d, x, z) => {
      if (wallNear(context.walls, x, z, 0.5)) fail(`${name} 压到崖壁`);
      // Right on the outline the two sides differ by float rounding; anywhere else they must agree.
      if (Math.abs(d) > SHORE_TOLERANCE && puddle.surface > heights[index]! !== d < 0)
        fail(`${name} 的水线不在它的岸线上`);
    });
  }
  const centre = heightAt(context.terrain, 0, 0);
  forEachSample(context.terrain, 0, 0, SPAWN_CLEARING - 2, (index) => {
    const { origin, resolution, samples } = context.terrain;
    const x = origin + (index % samples) / resolution;
    const z = origin + Math.floor(index / samples) / resolution;
    if (steepnessAt(context.nav.grid, x, z) > SPAWN_STEEPNESS)
      fail(`出生空地不平（中心高度 ${centre.toFixed(2)}）`);
  });
}
