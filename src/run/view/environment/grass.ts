import type { VegetationLook } from "../themes/types";
import { glslVec } from "../stageThemes";
import type { Steps } from "../../../prepare/steps";
import { Float32BufferAttribute, InstancedBufferGeometry } from "three";
import { heightAt } from "../../sim/terrain";
import { GroundChannel } from "./ground";
import { latticeHash, smoothstep, valueNoise } from "./noise";
import { aboveWater, onPad, scatter, type PlantPlacement } from "./scatter";

const BLADES = 8;
/** Widest a clump fans out from its root (tall tufts included). */
const CLUMP_REACH = 0.45;

/**
 * Eight broad, pointed blades (32 vertices, 16 triangles). A narrow root and wide shoulder fill the
 * lawn without spending three triangles per blade; the tip still bends independently of the base.
 */
export function grassGeometry(): InstancedBufferGeometry {
  const positions: number[] = [];
  const blades: number[] = [];
  const index: number[] = [];
  const profile = [
    [0, 0],
    [-0.5, 0.4],
    [0.5, 0.4],
    [0, 1],
  ] as const;
  for (let b = 0; b < BLADES; b++) {
    const r = (k: number) => latticeHash(0x6a09e667, b, k);
    const around = (b / BLADES + r(0) * 0.15) * Math.PI * 2;
    const reach = 0.05 + 0.17 * r(1);
    const flat = r(2) * Math.PI;
    const height = 0.21 + 0.1 * r(3);
    const width = 0.15;
    // Each blade leans a little outward so the clump fans open.
    const lean = 0.25 * height;
    const base = positions.length / 3;
    for (const [across, t] of profile) {
      positions.push(
        Math.cos(around) * (reach + lean * t * t) + Math.cos(flat) * across * width,
        t * height,
        Math.sin(around) * (reach + lean * t * t) + Math.sin(flat) * across * width,
      );
      blades.push(r(4), t);
    }
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aBlade", new Float32BufferAttribute(blades, 2));
  geometry.setIndex(index);
  return geometry;
}

/**
 * Instances: (x, y, z, scale). `clumps`: per square metre where the baked grass layer is full (the
 * stage theme's lawn); density follows that layer, and tall tufts gather in drifts and hollows.
 */
export function* placeGrass(
  { terrain, layers, map, seed, density }: PlantPlacement,
  look: NonNullable<VegetationLook["grass"]>,
): Steps<Float32Array> {
  const values: number[] = [];
  const clumps = look.density;
  if (clumps <= 0) return new Float32Array();
  yield* scatter(1 / Math.sqrt(clumps * density), seed ^ 0x3c6ef372, (x, z, roll) => {
    // Never on a cell ground walkers cannot use (the earth layer is the nav mask), never in water.
    if (layers.sample(GroundChannel.earth, x, z) >= 0.5) return;
    if (!aboveWater(map, x, z, CLUMP_REACH) || onPad(map, x, z)) return;
    const grass = layers.sample(GroundChannel.grass, x, z);
    if (
      look.kind === "lawn"
        ? roll(1) >= grass
        : roll(1) > smoothstep(0.56, 0.78, valueNoise(seed, x / 5, z / 5))
    )
      return;
    // Tall tufts gather away from the cleared foundations.
    const tall = Math.min(
      1,
      smoothstep(0.6, 0.8, valueNoise(seed ^ 0xa54ff53a, x / 6, z / 6)) +
        0.6 * layers.sample(GroundChannel.occlusion, x, z),
    );
    const scale = (0.75 + 0.35 * roll(2)) * (0.7 + 0.3 * grass) * (1 + 0.5 * tall);
    values.push(x, heightAt(terrain, x, z), z, scale);
  });
  return new Float32Array(values);
}

/**
 * Blade colour runs from the soil under the root to a sunlit tip; tall tufts go straw-gold at the top.
 * Slow noise patches vary the lawn's height and hue, and blades bent hard by a passing swell show a
 * paler sheen, so gusts read as waves rolling across the field (the same swell that moves the clouds).
 */
export const grassVertex = (look: NonNullable<VegetationLook["grass"]>) => ({
  attributes: "attribute vec2 aBlade; // (blade random, 0 root .. 1 tip)",
  body: /* glsl */ `
  float grassRand = envHash(aRoot.xz * 3.7);
  float grassYaw = grassRand * 6.2832;
  float grassPatch = envNoise(aRoot.xz * 0.21 + 3.1);
  vec3 blade = vec3(
    cos(grassYaw) * position.x - sin(grassYaw) * position.z,
    position.y * (0.85 + 0.3 * grassPatch),
    sin(grassYaw) * position.x + cos(grassYaw) * position.z
  ) * aRoot.w * foliageFade(aRoot.xyz);
  vec2 away = aRoot.xz - uFoliagePusher.xz;
  float footDistance = length(away);
  float footBend = (1.0 - smoothstep(0.075, 0.3, footDistance))
    * (1.0 - smoothstep(0.6, 1.2, abs(uFoliagePusher.y - aRoot.y)));
  vec2 grassLean = windLean(aRoot.xz, grassRand + aBlade.x, 2.6) * 0.9
    + away / max(footDistance, 1e-3) * footBend * 0.3;
  blade = bendBy(blade, grassLean, aBlade.y);
  vec3 transformed = aRoot.xyz + blade;
  vec3 soil = soilColor(aRoot.xz, aRoot.y);
  float tall = smoothstep(1.1, 1.5, aRoot.w);
  // Tips: sunlit yellow-olive in warm patches, fresher green in cool ones.
  vec3 tipTint = mix(vec3(1.45, 1.6, 1.35), vec3(1.78, 1.66, 1.02), grassPatch);
  vec3 tip = mix(soil * tipTint + vec3(0.03, 0.05, 0.0), soil * vec3(1.75, 1.6, 1.15) + vec3(0.06, 0.05, 0.0), tall);
  float sheen = smoothstep(0.75, 1.5, length(grassLean)) * aBlade.y * aBlade.y;
  tip += soil * vec3(0.55, 0.5, 0.25) * sheen;
  vFoliageColor = mix(soil * 0.55, tip, aBlade.y) * (0.8 + 0.4 * fract(aBlade.x * 13.1 + grassRand));
  vFoliageColor = ${look.kind === "dry" ? `mix(${glslVec(look.root)}, ${glslVec(look.tip)}, aBlade.y)` : `vFoliageColor * mix(${glslVec(look.root)}, ${glslVec(look.tip)}, aBlade.y)`};
  // About a quarter of the clumps are deep blue-green weeds: the dark tufts that break up the lawn.
  vFoliageColor *= mix(vec3(1.0), ${glslVec(look.weeds)}, step(0.74, fract(grassRand * 7.31)));
  `,
});
