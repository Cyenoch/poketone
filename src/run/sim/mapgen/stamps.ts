import { smoothstep } from "../noise";
import { polylineDistance, type Passage, type Terrain } from "../terrain";
import { isPatch, type Ramp, type Stamp } from "./layout";
import { hypot } from "../math";

/**
 * Adds every stamp's landform to the terraces in place. Stamp profiles are smooth over their `edge`
 * (at least two samples wide), so they need no blur of their own; a trench never cuts a passage.
 */
export function applyStamps(
  terrain: Terrain,
  stamps: readonly Stamp[],
  passages: readonly Passage[],
): void {
  const { origin, resolution, samples, heights } = terrain;
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const x = origin + i / resolution;
      const z = origin + j / resolution;
      let lift = 0;
      for (const stamp of stamps) lift += stampHeight(stamp, passages, x, z);
      heights[j * samples + i] = heights[j * samples + i]! + lift;
    }
  }
}

function stampHeight(stamp: Stamp, passages: readonly Passage[], x: number, z: number): number {
  // Surface patches lie flat on the terrain (buildSurface).
  if (isPatch(stamp)) return 0;
  if (stamp.kind === "trench") {
    const inside =
      1 - smoothstep(0, stamp.edge, polylineDistance(stamp.points, x, z) - stamp.width / 2);
    if (inside === 0) return 0;
    let causeway = 0;
    for (const passage of passages) {
      const half = passage.width / 2;
      const d = polylineDistance(passage.points, x, z);
      causeway = Math.max(causeway, 1 - smoothstep(half, half + stamp.edge, d));
    }
    return -stamp.depth * inside * (1 - causeway);
  }
  const centre = hypot(x - stamp.x, z - stamp.z);
  const outline =
    stamp.kind === "mesa"
      ? centre - stamp.radius
      : Math.abs(centre - stamp.radius) - stamp.thickness / 2;
  let raised = 1 - smoothstep(0, stamp.edge, outline);
  for (const ramp of stamp.ramps) raised = Math.max(raised, rampHeight(ramp, stamp.edge, x, z));
  return stamp.height * raised;
}

/** 1 at the rim easing to 0 at the foot, across `width`, its sides as steep as the stamp's edge. */
function rampHeight(ramp: Ramp, edge: number, x: number, z: number): number {
  const u = (x - ramp.x) * ramp.dx + (z - ramp.z) * ramp.dz;
  // Behind the rim the stamp's own body holds the height; the strip must not reach its far side.
  if (u < -edge) return 0;
  const v = Math.abs((z - ramp.z) * ramp.dx - (x - ramp.x) * ramp.dz);
  const half = ramp.width / 2;
  return (1 - smoothstep(0, ramp.length, Math.max(0, u))) * (1 - smoothstep(half, half + edge, v));
}
