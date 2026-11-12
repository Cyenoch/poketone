import type { VegetationLook } from "../themes/types";
import { glslVec } from "../stageThemes";
import type { Steps } from "../../../prepare/steps";
import { Float32BufferAttribute, InstancedBufferGeometry } from "three";
import { shoreDistance } from "../../sim/mapgen/index";
import { heightAt } from "../../sim/terrain";
import { latticeHash, valueNoise } from "./noise";
import { onPad, scatter, type PlantPlacement } from "./scatter";

const BLADES = 5;
/** Candidate roots along the shore are this far apart on desktop. */
const SPACING = 0.32;
/** Reeds root from just in the water to just up the bank. */
const ROOTED = [-0.35, 0.12] as const;

/** One clump: five tall, narrow, slightly splayed blades (35 vertices, 25 triangles), height 1. */
export function reedGeometry(): InstancedBufferGeometry {
  const positions: number[] = [];
  const blades: number[] = [];
  const index: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const r = (k: number) => latticeHash(0x3c6ef372, b, k);
    const around = (b / BLADES + r(0) * 0.2) * Math.PI * 2;
    const reach = 0.02 + 0.05 * r(1);
    const height = 0.65 + 0.35 * r(2);
    const lean = 0.18 * height * r(3);
    const base = positions.length / 3;
    // A tapered strip of three segments, facing a random way.
    const flat = r(4) * Math.PI;
    for (const [t, width] of [
      [0, 0.08],
      [0.35, 0.07],
      [0.7, 0.045],
      [1, 0],
    ] as const) {
      for (const side of t === 1 ? [0] : [-0.5, 0.5]) {
        positions.push(
          Math.cos(around) * (reach + lean * t * t) + Math.cos(flat) * side * width,
          t * height,
          Math.sin(around) * (reach + lean * t * t) + Math.sin(flat) * side * width,
        );
        blades.push(r(5), t);
      }
    }
    for (let s = 0; s < 2; s++) {
      const v = base + s * 2;
      index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    }
    index.push(base + 4, base + 5, base + 6);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aBlade", new Float32BufferAttribute(blades, 2));
  geometry.setIndex(index);
  return geometry;
}

/**
 * Instances: (x, y, z, scale). A few stands of reeds per pond: only along the stretches of shore a
 * slow noise picks, rooted in the shallows or at the foot of the bank, never on building pads.
 */
export function* placeReeds({ terrain, map, seed, density }: PlantPlacement): Steps<Float32Array> {
  const values: number[] = [];
  const { puddles } = map.water;
  yield* scatter(SPACING / Math.sqrt(density), seed ^ 0x1f83d9ab, (x, z, roll) => {
    const puddle = puddles.find((p) => Math.hypot(x - p.x, z - p.z) < p.radius);
    if (!puddle) return;
    const d = shoreDistance(puddle, x, z);
    if (d < ROOTED[0] || d > ROOTED[1]) return;
    const stand = valueNoise(seed ^ 0x2a7e151, x / 1.8, z / 1.8);
    if (roll(1) >= (stand - 0.66) * 4 || onPad(map, x, z)) return;
    values.push(x, heightAt(terrain, x, z), z, 0.6 + 0.4 * roll(2));
  });
  return new Float32Array(values);
}

/** Root colour from the soil (darkened), olive-green blades, about a third of them straw-tipped. */
export const reedVertex = (look: NonNullable<VegetationLook["reeds"]>) => ({
  attributes: "attribute vec2 aBlade; // (blade random, 0 root .. 1 tip)",
  body: /* glsl */ `
  float reedRand = envHash(aRoot.xz * 5.3);
  float reedYaw = reedRand * 6.2832;
  vec3 blade = vec3(
    cos(reedYaw) * position.x - sin(reedYaw) * position.z,
    position.y,
    sin(reedYaw) * position.x + cos(reedYaw) * position.z
  ) * aRoot.w * foliageFade(aRoot.xyz);
  blade = bendBy(blade, foliageLean(aRoot.xyz, reedRand + aBlade.x, 1.8) * 0.55, aBlade.y);
  vec3 transformed = aRoot.xyz + blade;
  vec3 soil = soilColor(aRoot.xz, aRoot.y);
  vec3 tip = mix(${glslVec(look.green)}, ${glslVec(look.straw)}, step(0.66, fract(aBlade.x * 7.7 + reedRand)));
  vFoliageColor = mix(soil * 0.5, tip, smoothstep(0.0, 0.6, aBlade.y)) * (0.85 + 0.3 * aBlade.x);
  `,
});
