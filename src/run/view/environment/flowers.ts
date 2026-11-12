import type { VegetationLook } from "../themes/types";
import { glslVec } from "../stageThemes";
import type { Steps } from "../../../prepare/steps";
import { Float32BufferAttribute, InstancedBufferGeometry } from "three";
import { heightAt } from "../../sim/terrain";
import { GroundChannel, MUD_BANK } from "./ground";
import { latticeHash, smoothstep, valueNoise } from "./noise";
import { aboveWater, onPad, scatter, type PlantPlacement } from "./scatter";

/**
 * Index into the shader's shape/colour tables. Nothing cyan or blue (XP candy). Poppies are a small
 * crimson accent: 10–20 cm heads, far below the size and brightness of a red telegraph.
 */
const Kind = { daisy: 0, buttercup: 1, cosmos: 2, poppy: 3, clover: 4 } as const;

/** Damp hollows favour buttercups, the middle terraces daisies, cosmos and poppies, high ground poppies. */
const TERRACE_DENSITY = [1, 0.85, 0.7];
const FLOWER_SPACING = 0.42;
const CLOVER_SPACING = 0.5;

/** Stem quad, six diamond petals and a hexagonal heart (35 vertices, 20 triangles), all in unit space. */
export function flowerGeometry(): InstancedBufferGeometry {
  const positions: number[] = [];
  const parts: number[] = [];
  const index: number[] = [];
  const vertex = (x: number, y: number, z: number, part: number, angle: number, odd: number) => {
    positions.push(x, y, z);
    parts.push(part, angle, odd);
    return positions.length / 3 - 1;
  };
  const stem = [
    vertex(-0.5, 0, 0, 0, 0, 0),
    vertex(0.5, 0, 0, 0, 0, 0),
    vertex(-0.5, 1, 0, 0, 0, 0),
    vertex(0.5, 1, 0, 0, 0, 0),
  ];
  index.push(stem[0]!, stem[1]!, stem[2]!, stem[2]!, stem[1]!, stem[3]!);
  for (let k = 0; k < 6; k++) {
    const angle = (k * Math.PI) / 3;
    // Petal-local (along, 0, across); the shader turns and widens it per kind.
    const base = vertex(0.12, 0, 0, 1, angle, k % 2);
    const left = vertex(0.55, 0, -0.5, 1, angle, k % 2);
    const tip = vertex(1, 0, 0, 1, angle, k % 2);
    const right = vertex(0.55, 0, 0.5, 1, angle, k % 2);
    index.push(base, left, tip, base, tip, right);
  }
  const centre = vertex(0, 0, 0, 2, 0, 0);
  const rim = Array.from({ length: 6 }, (_, k) =>
    vertex(Math.cos((k * Math.PI) / 3) * 0.3, 0, Math.sin((k * Math.PI) / 3) * 0.3, 2, 0, 0),
  );
  rim.forEach((v, k) => index.push(centre, rim[(k + 1) % 6]!, v));
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aPart", new Float32BufferAttribute(parts, 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * Instances: (x, y, z, kind + random). Flowers grow in elongated drifts (anisotropic noise along a
 * per-run axis) on grassy ground only; the kind follows the terrace with a slow regional choice and a
 * little mixing. Clover rosettes carpet the meadow layer.
 */
export function* placeFlowers(
  { terrain, layers, map, seed, density }: PlantPlacement,
  look: NonNullable<VegetationLook["flowers"]>,
): Steps<Float32Array> {
  // Off the water and its mud bank, and off building pads (those stay plain lawn).
  const open = (x: number, z: number) => aboveWater(map, x, z, MUD_BANK) && !onPad(map, x, z);
  const values: number[] = [];
  const axis = latticeHash(seed, 0x2545f491, 7) * Math.PI;
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  yield* scatter(
    FLOWER_SPACING / Math.sqrt(density * look.density),
    seed ^ 0x9b05688c,
    (x, z, roll) => {
      // Only on lush, dry, walkable grass: earth banks (the nav mask) and prop footprints zero the grass layer.
      if (
        layers.sample(GroundChannel.earth, x, z) > 0.25 ||
        layers.sample(GroundChannel.grass, x, z) < 0.15 ||
        !open(x, z)
      )
        return;
      const u = x * ca + z * sa;
      const v = -x * sa + z * ca;
      const drift = smoothstep(
        0.66,
        0.74,
        valueNoise(seed ^ 0x1f83d9ab, u / 10, v / 4) * 0.65 +
          valueNoise(seed ^ 0x5be0cd19, x / 2.6, z / 2.6) * 0.35,
      );
      // Flowers also gather in the shade ring around props and in hollows (the baked occlusion).
      const gather = 0.6 * smoothstep(0.25, 0.55, layers.sample(GroundChannel.occlusion, x, z));
      const y = heightAt(terrain, x, z);
      const terrace = Math.min(2, Math.max(0, Math.floor(y / terrain.step + 0.08)));
      if (roll(1) >= Math.max(drift, gather) * 0.85 * TERRACE_DENSITY[terrace]!) return;
      const palette = look.kinds;
      const choice = roll(2) < 0.12 ? roll(3) : valueNoise(seed ^ 0x6a09e667, x / 17, z / 17);
      const kind = palette[Math.min(palette.length - 1, Math.floor(choice * palette.length))]!;
      values.push(x, y, z, kind + roll(4) * 0.98);
    },
  );
  if (look.clover > 0)
    yield* scatter(
      CLOVER_SPACING / Math.sqrt(density * look.clover),
      seed ^ 0x510e527f,
      (x, z, roll) => {
        if (
          roll(1) >= smoothstep(0.3, 0.8, layers.sample(GroundChannel.meadow, x, z)) * 0.7 ||
          !open(x, z)
        )
          return;
        values.push(x, heightAt(terrain, x, z), z, Kind.clover + roll(2) * 0.98);
      },
    );
  return new Float32Array(values);
}

export const flowerVertex = (look: NonNullable<VegetationLook["flowers"]>) => ({
  attributes: /* glsl */ `
  attribute vec3 aPart; // (0 stem | 1 petal | 2 heart, petal angle, odd petal)
  // Per kind: stem height (m), head radius (m), cup (petal rise per radius; < 0 droops), petal width.
  const vec4 FLOWER_SHAPE[5] = vec4[5](
    vec4(0.22, 0.085, 0.15, 0.36),
    vec4(0.17, 0.065, 0.85, 0.75),
    vec4(0.3, 0.1, 0.1, 0.62),
    vec4(0.24, 0.09, 0.4, 0.85),
    vec4(0.05, 0.085, 0.2, 1.1)
  );
  // Linear RGB: white daisy, buttercup yellow, pink cosmos, crimson poppy; clover is a multiplier on the soil.
  const vec3 FLOWER_PETAL[5] = vec3[5](
    ${look.petals.map(glslVec).join(", ")}
  );
  const vec3 FLOWER_HEART[5] = vec3[5](
    vec3(0.95, 0.62, 0.06), vec3(0.85, 0.5, 0.05), vec3(0.95, 0.75, 0.2), vec3(0.05, 0.04, 0.03), vec3(1.0)
  );
  `,
  body: /* glsl */ `
  int flowerKind = int(aRoot.w);
  float flowerRand = fract(aRoot.w);
  vec4 shape = FLOWER_SHAPE[flowerKind];
  bool clover = flowerKind == 4;
  float size = (0.8 + 0.4 * flowerRand) * foliageFade(aRoot.xyz);
  float stemHeight = shape.x * size;
  float radius = shape.y * size;
  float yaw = flowerRand * 40.0;
  vec3 rest;
  float bendWeight = 1.0;
  if (aPart.x < 0.5) {
    rest = vec3(cos(yaw) * position.x * 0.012 * size, position.y * stemHeight, sin(yaw) * position.x * 0.012 * size);
    bendWeight = position.y;
  } else if (aPart.x < 1.5) {
    // Clover keeps every other petal: three round leaves.
    float shown = clover ? 1.0 - aPart.z : 1.0;
    vec2 dir = vec2(cos(aPart.y + yaw), sin(aPart.y + yaw));
    vec2 xz = (dir * position.x + vec2(-dir.y, dir.x) * position.z * shape.w) * radius * shown;
    rest = vec3(xz.x, stemHeight + shape.z * position.x * radius * shown, xz.y);
  } else {
    float shown = clover ? 0.0 : 1.0;
    rest = vec3(position.x * radius, stemHeight + 0.006 * size, position.z * radius) * shown;
  }
  rest = bendBy(rest, foliageLean(aRoot.xyz, flowerRand, 1.9) * 0.8, bendWeight);
  vec3 transformed = aRoot.xyz + rest;
  vec3 soil = soilColor(aRoot.xz, aRoot.y);
  // Hue drifts slowly by region and cools a touch on high terraces, so drifts of one kind still vary.
  float drift = envNoise(aRoot.xz * 0.05) - 0.5;
  float terrace = aRoot.y / uTerrainRect.w - 1.0;
  vec3 petal = clover
    ? soil * FLOWER_PETAL[4]
    : FLOWER_PETAL[flowerKind] * (vec3(1.0) + drift * vec3(0.1, -0.04, -0.1) + terrace * vec3(-0.03, 0.0, 0.04));
  petal *= 0.9 + 0.2 * flowerRand;
  vFoliageColor = aPart.x < 0.5 ? soil * 1.2 : aPart.x < 1.5 ? mix(petal * 0.78, petal, position.x) : FLOWER_HEART[flowerKind];
  `,
});
