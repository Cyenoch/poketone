import type { Steps } from "../../../prepare/steps";
import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RedFormat,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
  type Texture,
} from "three";
import { TERRAIN_HALF, type Terrain } from "../../sim/terrain";
import { mobilityClasses } from "../../sim/content/mobility";
import { shoreDistance, type Water } from "../../sim/mapgen/index";
import type { TerrainMask } from "../../sim/nav/index";
import type { Obstacle } from "../../sim/state/entities";
import { glslVec, type GroundLook, type SandLook } from "../stageThemes";
import { smoothstep, valueNoise } from "./noise";

/**
 * Surface layers baked once per run on the heightmap grid, read by the terrain shader (what the ground
 * looks like), the foliage shaders (root colour) and the foliage placement on the CPU (where plants grow).
 */
export interface GroundLayers {
  /** RGBA8: r meadow (clover & flowers), g earth (ground walkers cannot go here), b grass density, a occlusion. */
  texture: DataTexture;
  /** Half-float R: metres from the nearest puddle's designed outline (`shoreDistance`), negative under water. */
  shore: DataTexture;
  /** RGBA8: canopy cover, bank-top distance mask, bank-foot mask, material patch. */
  structure: DataTexture;
  /** (origin, texels per metre, 1 / texels per side) of `shore`. */
  shoreRect: Vector3;
  /** Bilinear layer value at a world point, 0..1. */
  sample(channel: GroundChannel, x: number, z: number): number;
}

export const GroundChannel = { meadow: 0, earth: 1, grass: 2, occlusion: 3 } as const;
export type GroundChannel = (typeof GroundChannel)[keyof typeof GroundChannel];

/** Blocked fraction at a world point (bilinear), or null outside the mask. */
function blockedAt(mask: TerrainMask, x: number, z: number): number | null {
  const gx = (x - mask.originX) / mask.cellSize;
  const gz = (z - mask.originZ) / mask.cellSize;
  if (gx < 0 || gz < 0 || gx > mask.width - 1 || gz > mask.height - 1) return null;
  const i = Math.min(mask.width - 2, Math.floor(gx));
  const j = Math.min(mask.height - 2, Math.floor(gz));
  const fx = gx - i;
  const fz = gz - j;
  const at = (a: number, b: number) => mask.data[b * mask.width + a]! / 255;
  const a = at(i, j);
  const b = at(i + 1, j);
  const c = at(i, j + 1);
  const d = at(i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export interface GroundTextures {
  grass: Texture;
  meadow: Texture;
  /** Top-down earth for the gentler unwalkable banks. */
  dirt: Texture;
  /** Side-on earth strata for sheer banks. */
  cliff: Texture;
  grassDetail: Texture;
  meadowDetail: Texture;
  dirtDetail: Texture;
  cliffDetail: Texture;
}

export interface GroundUniforms {
  uGroundLayers: { value: Texture };
  uGroundStructure: { value: Texture };
  uGrassDetail: { value: Texture };
  uMeadowDetail: { value: Texture };
  uDirtDetail: { value: Texture };
  uCliffDetail: { value: Texture };
  uGroundShore: { value: Texture };
  uGroundShoreRect: { value: Vector3 };
  uGrassMap: { value: Texture };
  uMeadowMap: { value: Texture };
  uDirtMap: { value: Texture };
  uCliffMap: { value: Texture };
}

export function createGroundUniforms(
  layers: GroundLayers,
  textures: GroundTextures,
): GroundUniforms {
  return {
    uGroundLayers: { value: layers.texture },
    uGroundStructure: { value: layers.structure },
    uGrassDetail: { value: textures.grassDetail },
    uMeadowDetail: { value: textures.meadowDetail },
    uDirtDetail: { value: textures.dirtDetail },
    uCliffDetail: { value: textures.cliffDetail },
    uGroundShore: { value: layers.shore },
    uGroundShoreRect: { value: layers.shoreRect },
    uGrassMap: { value: textures.grass },
    uMeadowMap: { value: textures.meadow },
    uDirtMap: { value: textures.dirt },
    uCliffMap: { value: textures.cliff },
  };
}

/** Shore-distance texels per metre: four times the height grid, so a waterline draws as a smooth curve. */
const SHORE_TEXELS = 4;
/** Stored shore distance is clamped to this range (metres); beyond it nothing on screen changes. */
const SHORE_RANGE = [-4, 2] as const;
/** Widest the wet soil strip above a waterline gets; flowers keep this far back from the water. */
export const MUD_BANK = 0.4;

/**
 * Signed distance to the nearest puddle outline on a fine grid over the terrain (half floats, so it
 * filters in WebGL 2 core). The terrain paints its banks from it, plant roots darken by it and the
 * water surface cuts and bands itself by it. Only texels near a puddle are computed; the rest read dry.
 */
function bakeShore(water: Water): { texture: DataTexture; rect: Vector3 } {
  const size = TERRAIN_HALF * 2 * SHORE_TEXELS + 1;
  const origin = -TERRAIN_HALF;
  const distances = new Float32Array(size * size).fill(SHORE_RANGE[1]);
  for (const puddle of water.puddles) {
    const i0 = Math.max(0, Math.floor((puddle.x - puddle.radius - origin) * SHORE_TEXELS));
    const i1 = Math.min(size - 1, Math.ceil((puddle.x + puddle.radius - origin) * SHORE_TEXELS));
    const j0 = Math.max(0, Math.floor((puddle.z - puddle.radius - origin) * SHORE_TEXELS));
    const j1 = Math.min(size - 1, Math.ceil((puddle.z + puddle.radius - origin) * SHORE_TEXELS));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = shoreDistance(puddle, origin + i / SHORE_TEXELS, origin + j / SHORE_TEXELS);
        const k = j * size + i;
        distances[k] = Math.min(distances[k]!, Math.max(SHORE_RANGE[0], d));
      }
    }
  }
  const texture = new DataTexture(
    Uint16Array.from(distances, (d) => DataUtils.toHalfFloat(d)),
    size,
    size,
    RedFormat,
    HalfFloatType,
  );
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, rect: new Vector3(origin, SHORE_TEXELS, 1 / size) };
}

/** Separable box blur on a square grid, edges clamped. */
function boxBlur(source: Float32Array, n: number, radius: number): Float32Array {
  const pass = (input: Float32Array, horizontal: boolean) => {
    const output = new Float32Array(input.length);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const a = Math.min(n - 1, Math.max(0, (horizontal ? i : j) + k));
          sum += input[horizontal ? j * n + a : a * n + i]!;
        }
        output[j * n + i] = sum / (radius * 2 + 1);
      }
    }
    return output;
  };
  return pass(pass(source, true), false);
}

/** Radii (in prop scale) kept clear of plants, then thinned, then softly occluded around each prop. */
const footprints: Record<Obstacle["kind"], { clear: number; sparse: number; shade: number }> = {
  rock: { clear: 1.05, sparse: 1.5, shade: 1.6 },
  tree: { clear: 0.5, sparse: 1.1, shade: 1.9 },
  palm: { clear: 0.4, sparse: 0.8, shade: 1.2 },
  pine: { clear: 0.45, sparse: 1, shade: 1.6 },
  bush: { clear: 0.6, sparse: 0.8, shade: 1.25 },
};

/**
 * `blocked` (`groundBlockedMask(nav)`) decides earth exactly where ground walkers cannot go, so what the player sees and what
 * the rules allow never disagree. Outside the playable square (no rules there) earth uses the same
 * test as the mask, terrain slope above the ground class's climb limit, so the rim has no seam.
 */
/** Steps (`prepare/steps.ts`): yields between bands of rows. */
export function* bakeGroundLayers(
  terrain: Terrain,
  obstacles: readonly Obstacle[],
  blocked: TerrainMask,
  water: Water,
  seed: number,
): Steps<GroundLayers> {
  const { samples: n, heights, resolution, origin, step } = terrain;
  const surroundings = boxBlur(heights, n, 3);
  const meadow = new Float32Array(n * n);
  const earth = new Float32Array(n * n);
  const grass = new Float32Array(n * n);
  const occlusion = new Float32Array(n * n);
  const canopy = new Float32Array(n * n);
  const h = (i: number, j: number) =>
    heights[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))]!;
  for (let j = 0; j < n; j++) {
    if (j % 16 === 0) yield;
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = origin + i / resolution;
      const z = origin + j / resolution;
      const slope =
        (Math.hypot(h(i + 1, j) - h(i - 1, j), h(i, j + 1) - h(i, j - 1)) * resolution) / 2;
      earth[k] = blockedAt(blocked, x, z) ?? (slope > mobilityClasses.ground.climb ? 1 : 0);
      const open = 1 - earth[k]!;
      occlusion[k] = smoothstep(0.03, 0.35, (surroundings[k]! - heights[k]!) / step);
      meadow[k] =
        smoothstep(
          0.5,
          0.66,
          valueNoise(seed ^ 0x5b6c, x / 11, z / 11) * 0.7 +
            valueNoise(seed ^ 0x7d8e, x / 3.3, z / 3.3) * 0.3,
        ) * open;
      const clumping = 0.45 + 0.55 * valueNoise(seed ^ 0x9fa0, x / 5, z / 5);
      // Lusher in hollows, thinner on the steeper walkable slopes.
      grass[k] = Math.min(
        1,
        open *
          ((1 - 0.5 * smoothstep(0.35, 0.65, slope)) * (1 - 0.5 * meadow[k]!) * clumping +
            0.35 * occlusion[k]!),
      );
    }
  }

  for (const obstacle of obstacles) {
    const print = footprints[obstacle.kind];
    const tree = obstacle.kind === "tree" || obstacle.kind === "pine";
    const reach = (tree ? 4 : print.shade) * obstacle.scale;
    const i0 = Math.max(0, Math.floor((obstacle.x - reach - origin) * resolution));
    const i1 = Math.min(n - 1, Math.ceil((obstacle.x + reach - origin) * resolution));
    const j0 = Math.max(0, Math.floor((obstacle.z - reach - origin) * resolution));
    const j1 = Math.min(n - 1, Math.ceil((obstacle.z + reach - origin) * resolution));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i;
        const d =
          Math.hypot(origin + i / resolution - obstacle.x, origin + j / resolution - obstacle.z) /
          obstacle.scale;
        if (tree) canopy[k] = Math.max(canopy[k]!, 1 - smoothstep(1, 4, d));
        grass[k] = grass[k]! * smoothstep(print.clear, print.sparse, d);
        meadow[k] = meadow[k]! * smoothstep(print.clear, print.sparse, d);
        // Contact shade: the prop's foot sits in the grass instead of on a bare disc.
        occlusion[k] = Math.max(
          occlusion[k]!,
          0.8 * (1 - smoothstep(print.clear * 0.8, print.shade, d)),
        );
      }
    }
  }

  // The sim's water depth grid shares the heightmap layout: under the plane is wet, and so is a damp
  // band a few centimetres above it. Nothing grows in either.
  const wet = water.depth.values.map((depth) => smoothstep(-0.12, 0, depth));
  for (let k = 0; k < n * n; k++) {
    const surface = terrain.surface;
    const barren =
      (surface !== undefined && surface.ground !== "ground") || (surface?.liquids.length ?? 0) > 0;
    const cover = barren ? 0 : 1 - wet[k]!;
    grass[k] = grass[k]! * cover;
    meadow[k] = meadow[k]! * cover;
  }

  const channels = [meadow, earth, grass, occlusion];
  const data = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    for (let c = 0; c < 4; c++) data[k * 4 + c] = Math.round(channels[c]![k]! * 255);
  }
  const layersTexture = (pixels: Uint8Array) => {
    const texture = new DataTexture(pixels, n, n, RGBAFormat, UnsignedByteType);
    texture.magFilter = texture.minFilter = LinearFilter;
    texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  };

  // World-distance banks, baked once rather than re-reading eight heights in every fragment.
  const structure = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const y = h(i, j);
      let drop = 0,
        rise = 0;
      const radius = Math.ceil(resolution * 0.75);
      for (const [dx, dz] of [
        [radius, 0],
        [-radius, 0],
        [0, radius],
        [0, -radius],
      ]) {
        const d = h(i + dx!, j + dz!) - y;
        drop = Math.max(drop, -d);
        rise = Math.max(rise, d);
      }
      structure[k * 4] = Math.round(canopy[k]! * 255);
      structure[k * 4 + 1] = Math.round(
        smoothstep(0.04, 0.55, drop) * (1 - smoothstep(0.03, 0.3, rise)) * 255,
      );
      structure[k * 4 + 2] = Math.round(
        smoothstep(0.04, 0.55, rise) * (1 - smoothstep(0.03, 0.3, drop)) * 255,
      );
      structure[k * 4 + 3] = Math.round(
        smoothstep(
          0.4,
          0.7,
          valueNoise(seed ^ 0x7632, (origin + i / resolution) / 9, (origin + j / resolution) / 9),
        ) * 255,
      );
    }
  const shore = bakeShore(water);
  return {
    texture: layersTexture(data),
    structure: layersTexture(structure),
    shore: shore.texture,
    shoreRect: shore.rect,
    sample(channel, x, z) {
      const values = channels[channel]!;
      const gx = Math.min(n - 1.001, Math.max(0, (x - origin) * resolution));
      const gz = Math.min(n - 1.001, Math.max(0, (z - origin) * resolution));
      const i = Math.floor(gx);
      const j = Math.floor(gz);
      const fx = gx - i;
      const fz = gz - j;
      const a = values[j * n + i]!;
      const b = values[j * n + i + 1]!;
      const c = values[(j + 1) * n + i]!;
      const d = values[(j + 1) * n + i + 1]!;
      return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    },
  };
}

/** Distance to the nearest waterline, for the terrain, plant roots and the water surface. */
export const SHORE_GLSL = /* glsl */ `
#ifndef ENV_SHORE
#define ENV_SHORE
uniform sampler2D uGroundShore;
uniform vec3 uGroundShoreRect; // (origin, texels per metre, 1 / texels per side)
const float MUD_BANK = ${MUD_BANK.toFixed(2)};
/** Metres from the nearest puddle's waterline; negative under water. Explicit LOD: vertex-safe. */
float groundShore(vec2 xz) {
  return textureLod(uGroundShore, ((xz - uGroundShoreRect.x) * uGroundShoreRect.y + 0.5) * uGroundShoreRect.z, 0.0).r;
}
#endif
`;

/**
 * Procedural sand for walkable ground (defines GROUND_SAND): a tone from dry to damp, the dirt map's
 * detail tiled small as grain, warped wind ripples that fade before they shimmer, and a sparse scatter
 * of shells and pebbles. `damp` 0..1 comes from the caller (distance to the sea). Fragment only (it
 * takes derivatives); requires `groundGlsl` earlier.
 */
export const sandGlsl = (sand: SandLook) => /* glsl */ `
#define GROUND_SAND
const vec3 SAND_DRY = ${glslVec(sand.dry)};
const vec3 SAND_DAMP = ${glslVec(sand.damp)};
const vec3 SAND_WET = ${glslVec(sand.wet)};
const vec3 SAND_SHELL = ${glslVec(sand.shell)};
const float SAND_GRAIN = ${sand.grain.toFixed(3)};
const float SAND_RIPPLE_LENGTH = ${sand.ripple[0].toFixed(3)};
const float SAND_RIPPLE = ${sand.ripple[1].toFixed(3)};
const float SAND_SHELLS = ${sand.shells.toFixed(3)};
const float SAND_GRAIN_TILE = 1.3;
/** Sand at p: \`dx\`/\`dy\` are the world-position derivatives, \`damp\` 0 dry .. 1 damp. */
vec3 sandAlbedo(vec2 p, vec2 dx, vec2 dy, float damp) {
  float macro = envNoise(p * 0.06) * 0.6 + envNoise(p * 0.21 + 4.0) * 0.4;
  vec3 c = mix(SAND_DRY, SAND_DAMP, damp) * mix(0.92, 1.06, macro);
  vec3 dirt = textureGrad(uDirtMap, p / SAND_GRAIN_TILE, dx / SAND_GRAIN_TILE, dy / SAND_GRAIN_TILE).rgb;
  float grain = groundLuma(dirt) / max(groundLuma(meanColor(uDirtMap)), 1e-3) - 1.0;
  c *= 1.0 + clamp(grain, -0.7, 0.7) * SAND_GRAIN;
  // Ripples: a sawtooth (gentle windward slope, sharp lee) along a warped direction, in patches; they
  // fade out where a ripple gets narrower than a few pixels.
  vec2 warp = vec2(envNoise(p * 0.3), envNoise(p * 0.3 + 9.1)) - 0.5;
  float phase = (dot(p + warp * 2.4, vec2(0.8, 0.6)) + envNoise(p * 0.8) * 0.35) / SAND_RIPPLE_LENGTH;
  float r = fract(phase);
  float profile = smoothstep(0.0, 0.75, r) * (1.0 - smoothstep(0.78, 1.0, r));
  float fade = 1.0 - smoothstep(0.12, 0.3, fwidth(phase));
  float patches = smoothstep(0.3, 0.65, envNoise(p * 0.13 + 2.0));
  c *= 1.0 + (profile - 0.5) * SAND_RIPPLE * fade * patches * (1.0 - 0.6 * damp);
  // Shells (a ribbed fan, pale coral) and pebbles (grey ovals), one chance per cell.
  const float cell = 1.7;
  vec2 id = floor(p / cell);
  vec2 centre = (id + 0.25 + 0.5 * vec2(envHash(id + 3.1), envHash(id + 7.7))) * cell;
  float angle = envHash(id + 1.9) * 6.2832;
  vec2 d = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * (p - centre);
  float size = mix(0.045, 0.085, envHash(id + 5.3));
  float pebble = step(envHash(id + 2.2), 0.4);
  vec2 shape = d / (size * mix(vec2(0.85, 1.0), vec2(1.0, 0.72), pebble));
  // The shell's hinge end is narrower: a fan, not an egg.
  shape.x *= mix(1.0 + 0.45 * smoothstep(-1.0, 1.0, -shape.y), 1.0, pebble);
  float radius = length(shape);
  float edge = max(fwidth(radius), 1e-3);
  float cover = (1.0 - smoothstep(1.0 - edge, 1.0 + edge, radius)) * step(1.0 - SAND_SHELLS, envHash(id));
  float rib = 0.88 + 0.12 * cos(atan(shape.x, shape.y + 1.2) * 18.0);
  vec3 piece = mix(SAND_SHELL * rib, PEBBLE * 1.6, pebble) * mix(1.08, 0.78, smoothstep(0.2, 1.0, radius));
  // A small contact shade beside each piece so it sits on the sand.
  float shade = (1.0 - smoothstep(0.9, 1.5, length(shape - vec2(0.25, -0.3)))) * (1.0 - cover) * step(1.0 - SAND_SHELLS, envHash(id));
  c *= 1.0 - 0.18 * shade;
  return mix(c, piece * mix(1.0, 0.75, damp), cover);
}
`;

/**
 * Walkable ground colour, shared by the terrain (full detail) and foliage roots (texture means) so a
 * plant's base always matches the ground it stands on; plus the earth constants for unwalkable banks.
 * Requires TERRAIN_GLSL and NOISE_GLSL earlier in the shader. The palette is the stage theme's.
 */
export const groundGlsl = (look: GroundLook) => /* glsl */ `
${SHORE_GLSL}
#ifndef ENV_GROUND
#define ENV_GROUND
uniform sampler2D uGroundLayers;
uniform sampler2D uGroundStructure;
uniform sampler2D uGrassMap;
uniform sampler2D uMeadowMap;
uniform sampler2D uDirtMap;
uniform sampler2D uCliffMap;
const float GRASS_TILE = ${look.grass.tile.toFixed(3)};
const float MEADOW_TILE = ${look.meadow.tile.toFixed(3)};
const float DIRT_TILE = ${look.dirt.tile.toFixed(3)};
const float CLIFF_TILE = ${look.cliff.tile.toFixed(3)};
// Each layer is settled (saturation, then a linear RGB tint) to the theme's mid-tone.
const vec4 GRASS_SETTLE = ${glslVec(look.grass.settle)};
const vec4 MEADOW_SETTLE = ${glslVec(look.meadow.settle)};
const vec4 DIRT_SETTLE = ${glslVec(look.dirt.settle)};
const vec4 CLIFF_SETTLE = ${glslVec(look.cliff.settle)};
// Pond banks: wet soil (the dirt map only adds its grain), a few pebbles, and the bed under the water.
const vec3 WET_SOIL = ${glslVec(look.wetSoil)};
const vec3 PEBBLE = ${glslVec(look.pebble)};
const vec3 POND_BED = ${glslVec(look.pondBed)};
const vec3 GROUND_INK = ${glslVec(look.ink)};
const vec3 GROUND_LIP = ${glslVec(look.lip)};
const vec3 GROUND_SPECKLE = ${glslVec(look.speckle.color)};
const float SPECKLE_STRENGTH = ${look.speckle.strength.toFixed(3)};
const float SPECKLE_FREQUENCY = ${look.speckle.frequency.toFixed(3)};
const float DETAIL_CONTRAST = ${look.detailContrast.toFixed(3)};
const vec2 BANK_SLOPE = ${glslVec(look.slope)};
const vec2 BANK_SHADE = ${glslVec(look.bankShade)};
const vec2 BANK_STRATA = ${glslVec(look.strata)};

vec4 groundLayers(vec2 xz) {
  // Explicit LOD: also read from vertex shaders and inside branches.
  return textureLod(uGroundLayers, terrainUv(xz), 0.0);
}
vec3 meanColor(sampler2D map) {
  return textureLod(map, vec2(0.5), 12.0).rgb;
}
float groundLuma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}
vec3 settle(vec3 c, vec4 how) {
  return mix(vec3(groundLuma(c)), c, how.x) * how.yzw;
}
/** Turf grows darker and cooler toward a waterline, across the mud bank and a little past it. */
vec3 groundDamp(float shore) {
  return mix(vec3(1.0), ${glslVec(look.damp)}, 1.0 - smoothstep(0.0, MUD_BANK + 1.2, shore));
}
/** Baked occlusion as a cool blue-green shade (not grey), deepest at prop feet and bank bottoms. */
vec3 groundOcclusion(float a) {
  return mix(vec3(1.0), ${glslVec(look.occlusion)}, a);
}
/** Layer edges follow the overlay's own detail (pebbles, clover) instead of a smooth airbrush. */
float layerWeight(float w, vec3 detail, vec3 mean) {
  return smoothstep(${(0.5 - look.blend).toFixed(3)}, ${(0.5 + look.blend).toFixed(3)}, w + (groundLuma(detail) - groundLuma(mean)) * 3.0);
}
vec3 groundAlbedo(vec4 layers, vec3 grass, vec3 meadow, vec3 meadowMean) {
  vec3 color = settle(grass, GRASS_SETTLE);
  color = mix(color, settle(meadow, MEADOW_SETTLE), layerWeight(layers.r, meadow, meadowMean));
  // Dense grass shades the soil it grows from; from afar this alone reads as thicker turf.
  return color * (1.0 - 0.16 * layers.b);
}
/**
 * Slow lush/dry drift so wide fields never read as one carpet, and a faint hue shift per terrace
 * (warmer up high, cooler in hollows) that keeps luminance: height reads through light, not bleach.
 */
vec3 groundMacro(vec2 xz, float terraces) {
  float n = envNoise(xz * 0.045) * 0.6 + envNoise(xz * 0.13 + 5.2) * 0.4;
  vec3 lushDry = mix(${glslVec(look.macro.cool)}, ${glslVec(look.macro.warm)}, smoothstep(0.15, 0.85, n));
  return lushDry * (vec3(1.0) + (terraces - 1.0) * ${glslVec(look.macro.height)});
}
/** What a plant root sees: the averaged soil colour at a world point (for vertex shaders). */
vec3 soilColor(vec2 xz, float y) {
  vec4 layers = groundLayers(xz);
  vec3 meadowMean = meanColor(uMeadowMap);
  vec3 soil = groundAlbedo(layers, meanColor(uGrassMap), meadowMean, meadowMean);
  return soil * groundMacro(xz, y / uTerrainRect.w) * groundOcclusion(layers.a) * groundDamp(groundShore(xz));
}
#endif
`;
