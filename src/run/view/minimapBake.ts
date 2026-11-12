import type { Steps } from "../../prepare/steps";
import { DataTexture, LinearFilter, RGBAFormat, SRGBColorSpace } from "three";
import { sampleSurface } from "../sim/surface";
import { WADE_DEPTH } from "../sim/content/params/environment";
import { groundBlockedMask, type TerrainMask } from "../sim/nav/index";
import { latticeHash, smoothstep, valueNoise } from "../sim/noise";
import { heightAt, TERRAIN_HALF } from "../sim/terrain";
import { ARENA_HALF, type World } from "../sim/state/world";
import { stageThemes } from "./stageThemes";

/** Bake density: enough for the full map at phone and laptop sizes, ~0.5 MP once per run. */
const PX_PER_UNIT = 6;

type Rgb = readonly [number, number, number];

const INK: Rgb = [20, 47, 80];
/** World square the cached terrain data covers: [-BAKE_HALF, BAKE_HALF]. */
export const BAKE_HALF = TERRAIN_HALF;

/**
 * Static terrain only: one CPU bake/upload per run; no canvas or per-frame texture upload. Steps
 * (`prepare/steps.ts`): yields between bands of rows.
 */
export function* bakeMap(world: World): Steps<DataTexture> {
  const size = BAKE_HALF * 2 * PX_PER_UNIT;
  const data = new Uint8ClampedArray(size * size * 4);
  const mask = groundBlockedMask(world.nav);
  for (let j = 0; j < size; j++) {
    if (j % 16 === 0) yield;
    for (let i = 0; i < size; i++) {
      const color = groundColor(world, mask, i, j);
      const offset = (j * size + i) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  const blend = (i: number, j: number, color: Rgb, alpha: number) => {
    const offset = (j * size + i) * 4;
    for (let k = 0; k < 3; k++)
      data[offset + k] = data[offset + k]! * (1 - alpha) + color[k]! * alpha;
  };
  const disc = (x: number, z: number, radius: number, color: Rgb, opacity: number, pad = false) => {
    const loX = Math.max(0, Math.floor((x - radius - 0.2 + BAKE_HALF) * PX_PER_UNIT));
    const hiX = Math.min(size - 1, Math.ceil((x + radius + 0.2 + BAKE_HALF) * PX_PER_UNIT));
    const loZ = Math.max(0, Math.floor((z - radius - 0.2 + BAKE_HALF) * PX_PER_UNIT));
    const hiZ = Math.min(size - 1, Math.ceil((z + radius + 0.2 + BAKE_HALF) * PX_PER_UNIT));
    for (let j = loZ; j <= hiZ; j++)
      for (let i = loX; i <= hiX; i++) {
        const dx = -BAKE_HALF + (i + 0.5) / PX_PER_UNIT - x;
        const dz = -BAKE_HALF + (j + 0.5) / PX_PER_UNIT - z;
        const distance = Math.hypot(dx, dz);
        blend(
          i,
          j,
          color,
          Math.max(0, Math.min(1, (radius - distance) * PX_PER_UNIT + 0.5)) * opacity,
        );
        if (pad && ((Math.atan2(dz, dx) + Math.PI * 2) * radius) % 1.05 < 0.6) {
          const coverage = Math.max(
            0,
            Math.min(1, (0.1 - Math.abs(distance - radius)) * PX_PER_UNIT + 0.5),
          );
          blend(i, j, INK, coverage * 0.3);
        }
      }
  };
  for (const pad of world.map.pads) disc(pad.x, pad.z, pad.radius, [233, 244, 251], 0.4, true);
  for (const prop of world.map.obstacles)
    if (prop.solid)
      disc(
        prop.x,
        prop.z,
        Math.max(0.3, prop.radius * 0.6),
        prop.kind === "rock" ? INK : stageThemes[world.stage].minimap.wall,
        prop.kind === "rock" ? 0.3 : 0.55,
      );
  for (let j = 0; j < size; j++) {
    if (j % 64 === 0) yield;
    for (let i = 0; i < size; i++) {
      const x = Math.abs(-BAKE_HALF + (i + 0.5) / PX_PER_UNIT);
      const z = Math.abs(-BAKE_HALF + (j + 0.5) / PX_PER_UNIT);
      const d =
        Math.max(x, z) > ARENA_HALF
          ? Math.hypot(Math.max(0, x - ARENA_HALF), Math.max(0, z - ARENA_HALF))
          : ARENA_HALF - Math.max(x, z);
      const coverage = Math.max(0, Math.min(1, (0.125 - d) * PX_PER_UNIT + 0.5));
      if (coverage > 0) blend(i, j, [13, 35, 63], coverage * 0.55);
    }
  }
  const texture = new DataTexture(new Uint8Array(data.buffer), size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const scratch: [number, number, number] = [0, 0, 0];

function groundColor(world: World, mask: TerrainMask, i: number, j: number): Rgb {
  const { terrain } = world.map;
  const { land, water, lava, shore, wall, wallLight } = stageThemes[world.stage].minimap;
  const x = -BAKE_HALF + (i + 0.5) / PX_PER_UNIT;
  const z = -BAKE_HALF + (j + 0.5) / PX_PER_UNIT;
  const h = heightAt(terrain, x, z);
  // Soft terrace bands: flat tone per level, blended only across the middle of each rise.
  const t = h / terrain.step;
  const band = Math.floor(t) + smoothstep(0.35, 0.65, t - Math.floor(t));
  const low = Math.max(0, Math.min(land.length - 1, Math.floor(band)));
  const high = Math.min(land.length - 1, low + 1);
  mix(scratch, land[low]!, land[high]!, Math.max(0, Math.min(1, band - low)));
  // Relief lit from the north-west, a slow watercolour wash and a faint paper grain.
  const slope = heightAt(terrain, x + 0.5, z) - heightAt(terrain, x - 0.5, z);
  const slopeZ = heightAt(terrain, x, z + 0.5) - heightAt(terrain, x, z - 0.5);
  const light =
    1 +
    Math.max(-0.22, Math.min(0.22, (slope + slopeZ) * 0.3)) +
    (valueNoise(world.seed ^ 0x57a5, x / 6, z / 6) - 0.5) * 0.1 +
    (latticeHash(7, i, j) - 0.5) * 0.05;
  scale(scratch, light);
  // Cliff ink: the can't-climb mask says where, the smooth height gradient draws the stroke.
  const steep = smoothstep(0.7, 1.4, Math.hypot(slope, slopeZ));
  mix(scratch, scratch, INK, smoothstep(0.05, 0.4, maskAt(mask, x, z)) * steep * 0.85);
  const surface = sampleSurface(terrain.surface, x, z);
  const depth = surface.waterDepth;
  const wet = smoothstep(0, 0.06, depth);
  mix(scratch, scratch, water, wet * 0.6);
  mix(scratch, scratch, shore, wet * (1 - smoothstep(0.03, 0.12, depth)) * 0.45);
  scale(scratch, 1 - 0.3 * smoothstep(WADE_DEPTH, WADE_DEPTH + 0.1, depth));
  mix(scratch, scratch, lava, smoothstep(0, 0.04, surface.lavaDepth));
  // Forest wall beyond the arena: dark canopy with soft crowns.
  const forest = smoothstep(ARENA_HALF - 0.5, ARENA_HALF + 2.5, Math.max(Math.abs(x), Math.abs(z)));
  if (forest > 0) {
    const crowns = valueNoise(world.seed ^ 0x4d4150, x / 2.2, z / 2.2);
    mix(scratch, scratch, wall, forest);
    mix(scratch, scratch, wallLight, forest * smoothstep(0.55, 0.85, crowns) * 0.8);
  }
  return scratch;
}

/** Bilinear can't-climb coverage in 0..1 at a world position (0 outside the mask). */
function maskAt(mask: TerrainMask, x: number, z: number): number {
  const gx = (x - mask.originX) / mask.cellSize;
  const gz = (z - mask.originZ) / mask.cellSize;
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const a = maskCell(mask, i, j);
  const b = maskCell(mask, i + 1, j);
  const c = maskCell(mask, i, j + 1);
  const d = maskCell(mask, i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

function maskCell(mask: TerrainMask, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= mask.width || j >= mask.height) return 0;
  return mask.data[j * mask.width + i]! / 255;
}

function mix(out: [number, number, number], a: Rgb, b: Rgb, t: number): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

function scale(out: [number, number, number], k: number): void {
  // The baked byte buffer clamps to 0..255 on write.
  out[0] *= k;
  out[1] *= k;
  out[2] *= k;
}
