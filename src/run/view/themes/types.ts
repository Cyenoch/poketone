import type { Terrain } from "../../sim/terrain";
import type { StageId } from "../../sim/content/stages/index";
import type { Obstacle } from "../../sim/state/entities";
import type { World } from "../../sim/state/world";
import type { Material, MeshLambertMaterial, Object3D, Scene, Vector3 } from "three";
import type { GroundPools } from "../environment/dressing";
import type { WindUniforms } from "../environment/wind";
import type { TerrainUniforms } from "../terrain";
export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];
/** 0–255 sRGB, for CPU bakes. */
export type Rgb = readonly [number, number, number];

export interface PropLook {
  models: readonly string[];
  /** Wind response: [lean at the top in metres, flutter rate]; null stays put. */
  sway: readonly [number, number] | null;
  /** Shade per facet (screen-space normals): hand-built leaf clumps read as clusters, not balls. */
  flat: boolean;
  /** Multiplier on the model's baked colour. */
  tint: number;
  /** Drawn size over the obstacle's scale (the collision footprint is sized from the scale alone). */
  drawScale: number;
  castShadow: boolean;
  patchMaterial?: (material: MeshLambertMaterial, height: number) => void;
}

/** Scene additions share the view's wind clock and never write to simulation state. */
export interface ThemeDecorationContext {
  scene: Scene;
  terrain: Object3D;
  uniforms: TerrainUniforms;
  wind: WindUniforms;
  pools: GroundPools;
  world: Readonly<World>;
}

export interface ThemeDecoration {
  /** Runs before enemy cloud shading; may bind resources owned by this decoration. */
  patchEnemyMaterial?(material: MeshLambertMaterial): void;
  /** Called after camera/occlusion and dressing updates, including paused frames. */
  update?(cameraTarget: Readonly<Vector3>): void;
  dispose(): void;
}

/** One ground texture and how it is settled: (saturation, linear RGB tint), see `settle` in ground.ts. */
export interface GroundLayerLook {
  map: string;
  settle: Vec4;
  tile: number;
  detail: string;
  normal: number;
}

export interface GroundLook {
  /** Linear multipliers; these shape material identity without changing lighting. */
  macro: { cool: Vec3; warm: Vec3; height: Vec3 };
  speckle: { color: Vec3; strength: number; frequency: number };
  occlusion: Vec3;
  damp: Vec3;
  ink: Vec3;
  lip: Vec3;
  detailContrast: number;
  /** Width of material crossfades in baked layer units; larger gives calmer patches. */
  blend: number;
  /** Coverage of the baked material patch on otherwise bare ground. */
  patch: number;
  /** Steep-face blend, bottom/top shade, and strata spacing in world metres. */
  slope: readonly [number, number];
  bankShade: readonly [number, number];
  strata: readonly [number, number];
  grass: GroundLayerLook;
  meadow: GroundLayerLook;
  /** Top-down earth for the gentler unwalkable banks. */
  dirt: GroundLayerLook;
  /** Side-on earth strata for sheer banks. */
  cliff: GroundLayerLook;
  /** Pond banks (linear albedo): wet soil, a few pebbles, the bed under the water. */
  wetSoil: Vec3;
  pebble: Vec3;
  pondBed: Vec3;
  /** Walkable ground drawn as procedural sand instead of the grass layers; null keeps the grass. */
  sand: SandLook | null;
}

/** Procedural beach / dune sand (terrain.ts), linear albedo. */
export interface SandLook {
  /** Sun-dried sand, the damp band toward the sea, and sand a wash has just soaked. */
  dry: Vec3;
  damp: Vec3;
  wet: Vec3;
  /** Contrast of the fine grain (the dirt map's detail, tiled small). */
  grain: number;
  /** Wind ripples: wavelength in metres, contrast. */
  ripple: readonly [number, number];
  /** Chance that a 1.7 m cell holds a shell or pebble, and the shell colour (pebbles use `pebble`). */
  shells: number;
  shell: Vec3;
}

/** Puddle water bands, linear colour (environment/water.ts). */
export interface WaterLook {
  edge: Vec3;
  shallow: Vec3;
  mid: Vec3;
  deep: Vec3;
  vein: Vec3;
  foam: Vec3;
  sky: Vec3;
}

export interface FootprintLook {
  /** Display-space indentation and raised lip colours. */
  ink: Vec3;
  rim: Vec3;
  strength: number;
  lifetime: number;
  softness: number;
}

export interface VegetationLook {
  grass: { density: number; kind: "lawn" | "dry"; root: Vec3; tip: Vec3; weeds: Vec3 } | null;
  flowers: {
    density: number;
    kinds: readonly (0 | 1 | 2 | 3)[];
    clover: number;
    petals: readonly Vec3[];
  } | null;
  reeds: { density: number; green: Vec3; straw: Vec3 } | null;
}
export interface DressingLook {
  model: string;
  height: number;
  density: number;
  placement: "scatter" | "shore" | "wall" | "station";
  /** A small local ground light; zero for ordinary scenery. */
  light: number;
  /** Explicit candidates still pass the shared clearance checks and light-pool cap. */
  sites?: (world: Readonly<World>) => Iterable<readonly [number, number]>;
  /** Additional filter for scattered scenery; shared clearance always runs first. */
  site?: (world: Readonly<World>, x: number, z: number) => boolean;
  patchMaterial?: (
    material: import("three").MeshLambertMaterial,
    world: import("../../sim/state/world").World,
  ) => void;
  /** Sparse visible pools, selected near the camera instead of capped during map scatter. */
  groundGlow?: (world: import("../../sim/state/world").World) => number;
}
export interface ArchitectureLook {
  slab: number;
  joint: number;
  wall: number;
  cap: number;
  /** Fraction of placed candle groups lit on this floor. */
  candles: readonly number[];
}
export interface StageTheme {
  id: StageId;
  /** Extra terrain-material patch for this stage's own surface detail. */
  patchTerrain?: (material: Material, terrain: Terrain) => void;
  decorate?: (context: ThemeDecorationContext) => ThemeDecoration | undefined;
  zoneAtmosphere?: (index: number) => AtmosphereLook;
  /** Scene background and fog. Fog mixes in after the grade (grade.ts), so this is the graded haze. */
  haze: { color: string; near: number; far: number };
  light: {
    sky: string;
    ground: string;
    hemi: number;
    sun: string;
    sunIntensity: number;
    /** Sun position relative to the view centre; its direction sets the shadow length. */
    sunOffset: Vec3;
  };
  ground: GroundLook;
  clouds: { scale: number; depth: number; coverage: readonly [number, number] };
  sunlight: { color: Vec3; glow: number; shafts: number; canopy: number };
  footprints: FootprintLook | null;
  vegetation: VegetationLook;
  dressing: readonly DressingLook[];
  landmark: {
    model: string;
    height: number;
    glow: number;
    cores: readonly Vec3[];
    runes?: boolean;
    emissiveBody?: boolean;
    columnOffset?: Vec3;
    patchMaterial?: (
      material: import("three").MeshLambertMaterial,
      wind: import("../environment/wind").WindUniforms,
    ) => void;
  };
  architecture: ArchitectureLook | null;
  water: WaterLook;
  props: Record<Obstacle["kind"], PropLook>;
  /** Painted-map palette (DESIGN.md · 小地图): terrace bands low to high, water, the wall beyond the arena. */
  minimap: { land: readonly Rgb[]; water: Rgb; lava: Rgb; shore: Rgb; wall: Rgb; wallLight: Rgb };
  /** Full-bleed painting behind the run's loading screen (docs/ART-PROMPTS.md). */
  loadingArt: string;
}

export type AtmosphereLook = Pick<StageTheme, "haze" | "light"> &
  Partial<Pick<StageTheme, "clouds" | "sunlight" | "vegetation" | "architecture" | "patchTerrain">>;
