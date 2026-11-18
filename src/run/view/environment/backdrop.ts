import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Frustum,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Material,
  type PerspectiveCamera,
} from "three";
import { heightAt, TERRAIN_HALF, type Terrain } from "../../sim/terrain";
import type { Obstacle } from "../../sim/state/entities";
import { ARENA_HALF } from "../../sim/state/world";
import type { StageTheme } from "../stageThemes";
import type { RunAssets } from "../assets";
import { lambertCopy } from "../materials";
import { inject, patchShader } from "../patchShader";
import { chunkInstances, type ChunkedInstances } from "./chunkedInstances";
import { shadeUnderClouds } from "./clouds";
import { latticeHash, NOISE_GLSL, smoothstep, valueNoise } from "./noise";
import type { WindUniforms } from "./wind";

/**
 * The land past the terrain's edge (docs/MAP-ART.md · 边界外). The camera looks about 29° below the
 * horizon at the top of the screen, so flat ground shows only some 15 m past the arena and a phone's top
 * corners reach the terrain's edge; what lies beyond is only seen as low ground (this skirt) or as
 * something tall standing out there (the layers). Nothing here can come between the camera and the
 * arena: the camera stays inside the terrain square, and every layer grows outside it.
 */

/** The skirt reaches this far from the centre, well into the fog from any allowed camera. */
export const BACKDROP_REACH = 118;
/** The sea floor falls this many metres per metre past the terrain's edge. */
const SEA_SHELF_SLOPE = 0.3;
/** Metres over which the clamped terrain edge settles into the stage's own outline. */
const SETTLE = 7;

/** One kind of scenery standing past the edge, drawn with the stage's own prop models. */
export interface BackdropLayer {
  kind: Obstacle["kind"];
  /** Metres past the terrain's edge where it grows. */
  band: readonly [number, number];
  /** Grid spacing (metres) of the candidate points. */
  spacing: number;
  /** Share of the candidates kept, in low-frequency clusters (1 = every point). */
  cover: number;
  /** Uniform scale range, times `stretch`. */
  scale: readonly [number, number];
  /** Per-axis stretch of the model: wide flat mesas, tall spires. */
  stretch?: readonly [number, number, number];
  /** Metres pushed into the ground, so big rocks read as outcrops rather than boulders. */
  sink?: number;
  /** Multiplies the model colour (distant ranks read deeper). */
  tint?: readonly [number, number, number];
  /** Grows in the sea (stacks) instead of on land. */
  sea?: boolean;
  /** Depth of horizontal rock bands by world height (0..1), so big rocks read as layered mesas. */
  strata?: number;
}

export interface BackdropLook {
  /** The ground past the edge climbs this many metres per metre, up to `cap`. */
  rise: number;
  cap: number;
  /** Rolling hills (or dunes, drifts) on top: amplitude and size in metres. */
  hills: number;
  hillSize: number;
  layers: readonly BackdropLayer[];
  /** Molten vents pooled in the ground out there (the volcano's caldera glow). */
  vents?: {
    band: readonly [number, number];
    spacing: number;
    radius: readonly [number, number];
    crust: readonly [number, number, number];
    hot: readonly [number, number, number];
  };
  /**
   * Free-standing rock arches (the desert's): how wide and their linear sandstone colour. `band` is
   * metres past the terrain edge (negative: on the rim between it and the arena).
   */
  arches?: {
    band: readonly [number, number];
    spacing: number;
    span: readonly [number, number];
    color: readonly [number, number, number];
  };
}

/**
 * Whether there is ground to grow on at (x, z): everywhere on the terrain for a stage with a backdrop;
 * without one (the tower) the floor ends at the arena's wall and past it is the drop.
 */
export function hasGround(theme: StageTheme, x: number, z: number): boolean {
  return theme.backdrop !== undefined || Math.max(Math.abs(x), Math.abs(z)) <= ARENA_HALF;
}

export interface Backdrop {
  meshes: Mesh[];
  update(camera: PerspectiveCamera): void;
  dispose(): void;
}

/** Metres past the terrain square (0 inside it), rounded at the corners. */
function beyondEdge(x: number, z: number): number {
  return Math.hypot(
    Math.max(0, Math.abs(x) - TERRAIN_HALF),
    Math.max(0, Math.abs(z) - TERRAIN_HALF),
  );
}

/** Signed metres past the terrain square: negative on the rim between it and the arena. */
function pastEdge(x: number, z: number): number {
  const inside = Math.max(Math.abs(x), Math.abs(z)) - TERRAIN_HALF;
  return inside > 0 ? beyondEdge(x, z) : inside;
}

const clampToTerrain = (v: number) => Math.max(-TERRAIN_HALF, Math.min(TERRAIN_HALF, v));

/**
 * Height of the land past the edge: the terrain's own edge height, settling within a few metres into
 * an average along the edge (so a lone ridge or shoal at the edge does not run on as a stripe), plus
 * the stage's climb and hills; on a sea edge it falls away as a shelf under the water.
 */
export function backdropHeight(
  terrain: Terrain,
  look: BackdropLook,
  seed: number,
  x: number,
  z: number,
): number {
  const ex = clampToTerrain(x);
  const ez = clampToTerrain(z);
  const edge = heightAt(terrain, ex, ez);
  const beyond = beyondEdge(x, z);
  if (beyond === 0) return edge;
  // Average along the edge (both axes for a corner) over ±9 m.
  let sum = 0;
  let under = 0;
  const sea = terrain.surface?.liquids.find((liquid) => liquid.kind === "water");
  const along = Math.abs(ex) === TERRAIN_HALF ? [0, 1] : [1, 0];
  for (let k = -3; k <= 3; k++) {
    const h = heightAt(
      terrain,
      clampToTerrain(ex + along[0]! * k * 3),
      clampToTerrain(ez + along[1]! * k * 3),
    );
    sum += h;
    if (sea && h < sea.level - 0.05) under++;
  }
  const settled = sum / 7;
  const settle = smoothstep(0, SETTLE, beyond);
  const land =
    edge +
    (settled - edge) * settle +
    Math.min(beyond * look.rise, look.cap) +
    look.hills * settle * (valueNoise(seed ^ 0x5bd1, x / look.hillSize, z / look.hillSize) - 0.35);
  if (!sea) return land;
  const seaShare = smoothstep(0.25, 0.85, under / 7);
  const shelf = Math.min(edge, sea.level - 0.4) - beyond * SEA_SHELF_SLOPE;
  return land + (shelf - land) * seaShare;
}

/**
 * A square ring of ground from just under the terrain's edge out to `BACKDROP_REACH`. Across the seam
 * it uses the terrain's own sample spacing, so its row on the edge runs through the terrain mesh's
 * perimeter vertices (linear between samples in both); then 1 m cells, and 4 m far out.
 */
function skirtGeometry(terrain: Terrain, look: BackdropLook, seed: number): BufferGeometry {
  const near = 70;
  const seam = TERRAIN_HALF + 2;
  const fine = Math.round(seam * terrain.resolution);
  const coords: number[] = [];
  for (let v = -BACKDROP_REACH; v < -near; v += 4) coords.push(v);
  for (let v = -near; v < -seam; v += 1) coords.push(v);
  for (let k = -fine; k <= fine; k++) coords.push(k / terrain.resolution);
  for (let v = seam + 1; v <= near; v += 1) coords.push(v);
  for (let v = near + 4; v <= BACKDROP_REACH; v += 4) coords.push(v);
  // One terrain cell under the edge: enough to close the seam from any view.
  const inner = TERRAIN_HALF - 1 / terrain.resolution;
  const n = coords.length;
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = coords[i]!;
      const z = coords[j]!;
      // Vertices deeper inside belong to no cell.
      if (Math.max(Math.abs(x), Math.abs(z)) < inner) continue;
      // Tucked just under the terrain where they overlap, so its own edge always wins; the same
      // offset everywhere, so the skirt's normals carry no crease along the seam.
      const y = backdropHeight(terrain, look, seed, x, z) - 0.04;
      positions.set([x, y, z], (j * n + i) * 3);
    }
  const indices: number[] = [];
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const outer = Math.max(
        Math.abs(coords[i]!),
        Math.abs(coords[i + 1]!),
        Math.abs(coords[j]!),
        Math.abs(coords[j + 1]!),
      );
      if (outer <= inner) continue;
      const a = j * n + i;
      indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The layer's model at each instance root (x, y, z, scale), turned by a hash of its position and
 * stretched per axis. Unlit by shadows: the shadow map covers only the arena around the player.
 */
function layerMaterial(source: Material, layer: BackdropLayer, flat: boolean, tint: number) {
  const material = lambertCopy(source);
  material.flatShading = flat;
  material.color.multiplyScalar(tint);
  if (layer.tint) material.color.multiply(new Color(...layer.tint));
  const [sx, sy, sz] = (layer.stretch ?? [1, 1, 1]).map((v) => v.toFixed(3));
  const key = `backdrop-${sx},${sy},${sz}`;
  patchShader(material, key, (shader) => {
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>": `#include <common>
attribute vec4 aRoot;
const vec3 BACKDROP_STRETCH = vec3(${sx}, ${sy}, ${sz});
mat2 backdropTurn() {
  float yaw = fract(sin(dot(aRoot.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.28318;
  return mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw));
}`,
      "#include <beginnormal_vertex>": `#include <beginnormal_vertex>
objectNormal = normalize(objectNormal / BACKDROP_STRETCH);
objectNormal.xz = backdropTurn() * objectNormal.xz;`,
      "#include <begin_vertex>": `#include <begin_vertex>
transformed *= BACKDROP_STRETCH;
transformed.xz = backdropTurn() * transformed.xz;
transformed = transformed * aRoot.w + aRoot.xyz;`,
    });
  });
  if (layer.strata) addStrata(material, layer.strata);
  return material;
}

/**
 * Horizontal rock bands by world height, uneven in thickness, darkening the stone by up to `depth`.
 * Patched after any vertex placement, so it bands the stone where it finally stands.
 */
function addStrata(material: Material, depth: number): void {
  const key = `backdrop-strata-${depth.toFixed(3)}`;
  patchShader(material, key, (shader) => {
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>": "#include <common>\nvarying float vStrataY;",
      "#include <project_vertex>":
        "vStrataY = (modelMatrix * vec4(transformed, 1.0)).y;\n#include <project_vertex>",
    });
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>": "#include <common>\nvarying float vStrataY;",
      "#include <color_fragment>": `#include <color_fragment>
        float strata = fract(vStrataY * 0.8 + sin(vStrataY * 0.37) * 0.6);
        diffuseColor.rgb *= 1.0 - ${depth.toFixed(3)} * (smoothstep(0.55, 0.62, strata) - 0.35 * smoothstep(0.9, 0.97, strata));`,
    });
  });
}

/**
 * Irregular low-poly pools lying on the skirt, glowing from the core out: one unlit draw, its molten
 * cells drifting on the shared wind clock. They need no light of their own; the fog still covers them.
 */
function createVents(
  terrain: Terrain,
  look: BackdropLook,
  vents: NonNullable<BackdropLook["vents"]>,
  seed: number,
  wind: WindUniforms,
): Mesh<BufferGeometry, MeshBasicMaterial> {
  const positions: number[] = [];
  const cores: number[] = [];
  const half = TERRAIN_HALF + vents.band[1];
  const cells = Math.ceil((half * 2) / vents.spacing);
  const salt = seed ^ 0x7e11;
  const sides = 14;
  // From the hot core out: the pool's edge, the crest of its crust lip, the lip's foot on the ground.
  // aCore runs 1 (core) to 0 (crest) and below (the cooled outer slope).
  const rings = [
    { out: 0, lift: 0.04, core: 0.32 },
    { out: 0.6, lift: 0.4, core: 0 },
    { out: 1.6, lift: -0.05, core: -0.7 },
  ];
  for (let iz = 0; iz < cells; iz++)
    for (let ix = 0; ix < cells; ix++) {
      const cx = -half + (ix + latticeHash(salt, ix, iz)) * vents.spacing;
      const cz = -half + (iz + latticeHash(salt ^ 0x9e37, ix, iz)) * vents.spacing;
      const radius =
        vents.radius[0] + (vents.radius[1] - vents.radius[0]) * latticeHash(salt ^ 0x51ed, ix, iz);
      // Flat, so free to lie on the rim, but clear of the arena and its border.
      const past = pastEdge(cx, cz);
      const outer = radius * 1.3 + rings.at(-1)!.out;
      if (past - outer < vents.band[0] || past > vents.band[1]) continue;
      if (past + TERRAIN_HALF - ARENA_HALF - outer < 2) continue;
      // An irregular outline: two lobes of noise round the rim, a random squash and turn.
      const squash = 0.55 + 0.4 * latticeHash(salt ^ 0x2468, ix, iz);
      const yaw = latticeHash(salt ^ 0x1357, ix, iz) * Math.PI;
      const lobes = Array.from({ length: sides }, (_, k) => {
        const angle = (k / sides) * Math.PI * 2;
        const wobble =
          0.75 +
          0.3 * Math.sin(angle * 2 + latticeHash(salt ^ 0x8642, ix, iz) * 6.3) +
          0.2 * latticeHash(salt ^ (k * 131), ix, iz);
        return [angle, wobble] as const;
      });
      const point = (angle: number, r: number, lift: number) => {
        const lx = Math.cos(angle) * r;
        const lz = Math.sin(angle) * r * squash;
        const x = cx + lx * Math.cos(yaw) - lz * Math.sin(yaw);
        const z = cz + lx * Math.sin(yaw) + lz * Math.cos(yaw);
        return [x, backdropHeight(terrain, look, seed, x, z) + lift, z] as const;
      };
      const loops = rings.map(({ out, lift }) =>
        lobes.map(([angle, wobble]) => point(angle, radius * wobble + out, lift)),
      );
      const centre = point(0, 0, 0.04);
      for (let k = 0; k < sides; k++) {
        const next = (k + 1) % sides;
        positions.push(...centre, ...loops[0]![next]!, ...loops[0]![k]!);
        cores.push(1, rings[0]!.core, rings[0]!.core);
        for (let r = 0; r + 1 < rings.length; r++) {
          const a = loops[r]![k]!,
            b = loops[r]![next]!,
            c = loops[r + 1]![next]!,
            d = loops[r + 1]![k]!;
          const ca = rings[r]!.core,
            cb = rings[r + 1]!.core;
          positions.push(...a, ...b, ...c, ...a, ...c, ...d);
          cores.push(ca, ca, cb, ca, cb, cb);
        }
      }
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aCore", new Float32BufferAttribute(cores, 1));
  const material = new MeshBasicMaterial();
  const key = "backdrop-vents";
  const glsl = (v: readonly number[]) => `vec3(${v.map((c) => c.toFixed(3)).join(", ")})`;
  patchShader(material, key, (shader) => {
    shader.uniforms.uWindTime = wind.uWindTime;
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>":
        "#include <common>\nattribute float aCore;\nvarying float vCore;\nvarying vec2 vVent;",
      "#include <begin_vertex>": "#include <begin_vertex>\nvCore = aCore;\nvVent = position.xz;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>": `#include <common>\nuniform float uWindTime;\nvarying float vCore;\nvarying vec2 vVent;\n${NOISE_GLSL}`,
      "#include <color_fragment>": `#include <color_fragment>
        float cells = envNoise(vVent * 0.9 + vec2(uWindTime * 0.05, -uWindTime * 0.03)) * 0.6 + envNoise(vVent * 2.6 - uWindTime * 0.08) * 0.4;
        // The pool brightens toward the core; its edge breaks up with the moving cells, glows on up the
        // inner face of the lip and dies on the crest. The outer slope cools to a darker crust.
        float heat = smoothstep(0.0, 0.75, vCore + (cells - 0.5) * 0.25) * (0.55 + 0.45 * cells) + smoothstep(0.62, 0.8, cells) * 0.35 * step(0.25, vCore);
        vec3 crust = ${glsl(vents.crust)} * mix(0.55, 1.25, smoothstep(-0.7, 0.0, vCore));
        diffuseColor.rgb = mix(crust, ${glsl(vents.hot)}, clamp(heat, 0.0, 1.2));`,
    });
  });
  return new Mesh(geometry, material);
}

const ARCH_SECTION = 6;
const archThick = (span: number) => 1.4 + span * 0.12;
const archDeep = (span: number) => 1.8 + span * 0.15;
/** How far an arch reaches across its line, toward the arena, from its centre. */
const archReach = (span: number, turn: number) =>
  archDeep(span) * 0.6 + Math.abs(Math.sin(turn)) * (span / 2 + archThick(span)) + 0.5;

/**
 * Rock arches: a rough rectangular section swept round a half ellipse, legs sunk into the skirt,
 * flat-shaded with sandstone strata. One merged draw; each arch stays wholly outside the arena.
 */
function createArches(
  terrain: Terrain,
  look: BackdropLook,
  arches: NonNullable<BackdropLook["arches"]>,
  seed: number,
): Mesh<BufferGeometry, MeshLambertMaterial> {
  const positions: number[] = [];
  const salt = seed ^ 0xa4c5;
  const steps = 10;
  // Slots along each edge, short of the corners; each kept slot stands a hashed distance out.
  const reach = TERRAIN_HALF - 6;
  const slots = Math.floor((reach * 2) / arches.spacing);
  for (let side = 0; side < 4; side++)
    for (let slot = 0; slot < slots; slot++) {
      if (latticeHash(salt ^ 0x77, side, slot) > 0.85) continue;
      const u = -reach + (slot + latticeHash(salt, side, slot)) * arches.spacing;
      const past =
        arches.band[0] + (arches.band[1] - arches.band[0]) * latticeHash(salt ^ 0x9e37, side, slot);
      const out = (side % 2 === 0 ? -1 : 1) * (TERRAIN_HALF + past);
      const cx = side < 2 ? u : out;
      const cz = side < 2 ? out : u;
      const roll = latticeHash(salt ^ 0x51ed, side, slot);
      let span = arches.span[0] + (arches.span[1] - arches.span[0]) * roll;
      let rise = span * (0.55 + 0.3 * latticeHash(salt ^ 0x3c6e, side, slot));
      // Running along the edge, the opening faces the arena; a little turn keeps it natural.
      const turn = (latticeHash(salt ^ 0x1234, side, slot) - 0.5) * 0.5;
      const yaw = (side < 2 ? 0 : Math.PI / 2) + turn;
      // Clear of the arena, and no taller than that clearance: on the near rim an arch shrinks to
      // stay under the gameplay camera's line of sight to the arena's edge.
      const clear = past + TERRAIN_HALF - ARENA_HALF - archReach(span, turn);
      if (clear < 3) continue;
      const shrink = Math.min(1, clear / rise);
      span *= shrink;
      rise *= shrink;
      const thick = archThick(span);
      const deep = archDeep(span);
      const ground =
        Math.min(
          backdropHeight(
            terrain,
            look,
            seed,
            cx - Math.cos(yaw) * span * 0.5,
            cz - Math.sin(yaw) * span * 0.5,
          ),
          backdropHeight(
            terrain,
            look,
            seed,
            cx + Math.cos(yaw) * span * 0.5,
            cz + Math.sin(yaw) * span * 0.5,
          ),
        ) - 1.5;
      // Rings of four corners along the sweep; the ends drop below the ground.
      const rings: (readonly [number, number, number])[][] = [];
      for (let k = 0; k <= steps; k++) {
        const angle = Math.PI * (1 - k / steps);
        const ex = Math.cos(angle) * span * 0.5;
        const ey = Math.sin(angle) * rise;
        const radial = Math.hypot(Math.cos(angle) / span, Math.sin(angle) / rise);
        const nx = Math.cos(angle) / span / radial,
          ny = Math.sin(angle) / rise / radial;
        const lift = k === 0 || k === steps ? -1.5 : 0;
        // Thicker at the feet, a rough jitter per ring.
        const t =
          thick *
          (1 + 0.5 * (1 - Math.sin(angle))) *
          (0.85 + 0.3 * latticeHash(salt ^ k, side, slot));
        // A rough six-sided section: every corner pushed in or out, so the stone breaks into facets.
        const ring = Array.from({ length: ARCH_SECTION }, (_, j) => {
          const around = ((j + 0.5) / ARCH_SECTION) * Math.PI * 2;
          const rough = 0.75 + 0.45 * latticeHash(salt ^ (k * 13 + j + 3), side, slot);
          const r = Math.cos(around) * rough;
          const d = Math.sin(around) * rough;
          const ax = ex + nx * r * t * 0.5;
          const ay = ey + ny * r * t * 0.5 + lift;
          const az = d * deep * 0.5;
          return [
            cx + Math.cos(yaw) * ax - Math.sin(yaw) * az,
            ground + ay,
            cz + Math.sin(yaw) * ax + Math.cos(yaw) * az,
          ] as const;
        });
        rings.push(ring);
      }
      for (let k = 0; k < steps; k++)
        for (let f = 0; f < ARCH_SECTION; f++) {
          const a = rings[k]![f]!,
            b = rings[k]![(f + 1) % ARCH_SECTION]!,
            c = rings[k + 1]![(f + 1) % ARCH_SECTION]!,
            d = rings[k + 1]![f]!;
          positions.push(...a, ...c, ...b, ...a, ...d, ...c);
        }
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = new MeshLambertMaterial({
    color: new Color(...arches.color),
    flatShading: true,
    side: DoubleSide,
  });
  addStrata(material, 0.28);
  return new Mesh(geometry, material);
}

interface Layer {
  mesh: Mesh<InstancedBufferGeometry, MeshLambertMaterial>;
  instances: ChunkedInstances;
}

/**
 * The skirt (drawn with the terrain's own material, so ground, sand or snow runs on without a seam)
 * and the stage's scenery layers past the edge: one instanced draw per layer and model, culled by
 * chunk to the frustum.
 */
export function createBackdrop(
  terrain: Terrain,
  look: BackdropLook,
  seed: number,
  assets: RunAssets,
  props: Record<Obstacle["kind"], { flat: boolean; tint: number }>,
  ground: Material,
  wind: WindUniforms,
): Backdrop {
  const skirt = new Mesh(skirtGeometry(terrain, look, seed), ground);
  skirt.receiveShadow = true;
  const vents = look.vents ? createVents(terrain, look, look.vents, seed, wind) : null;
  const arches = look.arches ? createArches(terrain, look, look.arches, seed) : null;
  if (arches) shadeUnderClouds(arches.material, wind);
  const sea = terrain.surface?.liquids.find((liquid) => liquid.kind === "water");
  const layers: Layer[] = [];
  for (const [index, layer] of look.layers.entries()) {
    const sources = assets.props[layer.kind];
    const values: number[][] = sources.map(() => []);
    const half = TERRAIN_HALF + layer.band[1];
    const cells = Math.ceil((half * 2) / layer.spacing);
    const salt = seed ^ (0x2c1b + index * 7919);
    // Widest horizontal reach of each model at scale 1, stretched.
    const spread = Math.max(layer.stretch?.[0] ?? 1, layer.stretch?.[2] ?? 1);
    const reach = sources.map(
      (source) => Math.max(...source.profile.worst) * source.height * spread,
    );
    for (let iz = 0; iz < cells; iz++)
      for (let ix = 0; ix < cells; ix++) {
        const x = -half + (ix + latticeHash(salt, ix, iz)) * layer.spacing;
        const z = -half + (iz + latticeHash(salt ^ 0x9e37, ix, iz)) * layer.spacing;
        const beyond = beyondEdge(x, z);
        if (beyond < layer.band[0] || beyond > layer.band[1]) continue;
        if (layer.cover < 1 && valueNoise(salt, x / 9, z / 9) > layer.cover) continue;
        const y = backdropHeight(terrain, look, seed, x, z);
        const wet = sea !== undefined && y < sea.level + 0.1;
        if (wet !== (layer.sea ?? false)) continue;
        const roll = latticeHash(salt ^ 0x51ed, ix, iz);
        const variant = Math.floor(latticeHash(salt ^ 0x3c6e, ix, iz) * sources.length);
        const scale = layer.scale[0] + (layer.scale[1] - layer.scale[0]) * roll;
        // The whole silhouette stays outside the terrain, not only its root: the camera never leaves
        // the terrain, so nothing here can come between it and the arena.
        if (beyond < reach[variant]! * scale + 0.5) continue;
        values[variant]!.push(x, y - (layer.sink ?? 0), z, scale);
      }
    const stretchY = layer.stretch?.[1] ?? 1;
    for (const [variant, source] of sources.entries()) {
      if (values[variant]!.length === 0) continue;
      const top = source.height * layer.scale[1] * stretchY;
      const instances = chunkInstances(
        new Float32Array(values[variant]!),
        half,
        top,
        8,
        reach[variant]! * layer.scale[1],
      );
      const geometry = new InstancedBufferGeometry();
      geometry.index = source.geometry.index;
      for (const [name, attribute] of Object.entries(source.geometry.attributes))
        geometry.setAttribute(name, attribute);
      geometry.setAttribute("aRoot", instances.attribute);
      geometry.instanceCount = 0;
      const material = layerMaterial(
        source.material,
        layer,
        props[layer.kind].flat,
        props[layer.kind].tint,
      );
      shadeUnderClouds(material, wind);
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      layers.push({ mesh, instances });
    }
  }
  const frustum = new Frustum();
  const viewProjection = new Matrix4();
  return {
    meshes: [
      skirt,
      ...(vents ? [vents] : []),
      ...(arches ? [arches] : []),
      ...layers.map((layer) => layer.mesh),
    ],
    update(camera) {
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      for (const { mesh, instances } of layers) {
        mesh.geometry.instanceCount = instances.update(frustum, camera.position, camera.far);
        mesh.visible = mesh.geometry.instanceCount > 0;
      }
    },
    dispose() {
      skirt.geometry.dispose();
      vents?.geometry.dispose();
      vents?.material.dispose();
      arches?.geometry.dispose();
      arches?.material.dispose();
      for (const { mesh } of layers) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}
