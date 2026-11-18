import type { VegetationLook } from "../themes/types";
import { glslVec } from "../stageThemes";
import type { Steps } from "../../../prepare/steps";
import { Float32BufferAttribute, InstancedBufferGeometry } from "three";
import { heightAt } from "../../sim/terrain";
import { GroundChannel } from "./ground";
import { latticeHash, smoothstep, valueNoise } from "./noise";
import { aboveWater, onPad, scatter, type PlantPlacement } from "./scatter";

const SIDES = 5;
/** Light for the baked facet shade: from above, a little toward the camera's usual south. */
const LIGHT = [0.35, 0.85, 0.4] as const;

/**
 * A faceted chunk (15 triangles), unit radius, flat at the bottom: a ring, a narrower shoulder ring
 * and a cap. Each face carries a baked shade, so it reads as a stone under the ground's own normal.
 */
export function pebbleGeometry(): InstancedBufferGeometry {
  const ring = (y: number, radius: number, salt: number) =>
    Array.from({ length: SIDES }, (_, i) => {
      const a = ((i + latticeHash(salt, i, 0) * 0.5) / SIDES) * Math.PI * 2;
      const r = radius * (0.8 + 0.35 * latticeHash(salt, i, 1));
      return [Math.cos(a) * r, y, Math.sin(a) * r] as const;
    });
  const base = ring(0, 1, 0x510e527f);
  const shoulder = ring(0.45, 0.68, 0x9b05688c);
  const cap = [0.08, 0.62, -0.05] as const;
  const positions: number[] = [];
  const shades: number[] = [];
  type Point = readonly [number, number, number];
  const face = (a: Point, b: Point, c: Point) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ] as const;
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    // Facing either way: the material is double-sided and winding is not checked.
    const lit = Math.abs(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / length;
    for (const corner of [a, b, c]) {
      positions.push(...corner);
      shades.push(0.55 + 0.6 * lit);
    }
  };
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES;
    face(base[i]!, shoulder[i]!, base[j]!);
    face(base[j]!, shoulder[i]!, shoulder[j]!);
    face(shoulder[i]!, cap, shoulder[j]!);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aShade", new Float32BufferAttribute(shades, 1));
  return geometry;
}

/**
 * Instances: (x, y, z, radius). Small stones in loose drifts on walkable ground (never in water,
 * on building pads or on the earth banks), view-only: the sim never sees them.
 */
export function* placePebbles(
  { terrain, layers, map, seed, density }: PlantPlacement,
  look: NonNullable<VegetationLook["pebbles"]>,
): Steps<Float32Array> {
  const values: number[] = [];
  yield* scatter(1 / Math.sqrt(look.density * density), seed ^ 0x1f83d9ab, (x, z, roll) => {
    if (layers.sample(GroundChannel.earth, x, z) >= 0.5) return;
    if (!aboveWater(map, x, z, 0.2) || onPad(map, x, z)) return;
    const drift = smoothstep(0.4, 0.72, valueNoise(seed ^ 0x5be0cd19, x / 4, z / 4));
    if (roll(1) > 0.12 + 0.88 * drift) return;
    const radius = look.size[0] + (look.size[1] - look.size[0]) * roll(2) ** 2;
    values.push(x, heightAt(terrain, x, z) - radius * 0.12, z, radius);
  });
  return new Float32Array(values);
}

/** Stone colour sits between the theme's two tones and the soil under it, shaded per facet. */
export const pebbleVertex = (look: NonNullable<VegetationLook["pebbles"]>) => ({
  attributes: "attribute float aShade;",
  body: /* glsl */ `
  float stoneRand = envHash(aRoot.xz * 5.3);
  float stoneYaw = stoneRand * 6.2832;
  vec3 stone = position * vec3(1.0 + 0.5 * fract(stoneRand * 7.1), 0.75 + 0.5 * fract(stoneRand * 3.7), 1.0);
  stone = vec3(cos(stoneYaw) * stone.x - sin(stoneYaw) * stone.z, stone.y, sin(stoneYaw) * stone.x + cos(stoneYaw) * stone.z);
  vec3 transformed = aRoot.xyz + stone * aRoot.w * foliageFade(aRoot.xyz);
  vec3 tone = mix(${glslVec(look.dark)}, ${glslVec(look.light)}, fract(stoneRand * 11.3));
  vFoliageColor = mix(soilColor(aRoot.xz, aRoot.y), tone, 0.75) * aShade;
  `,
});
