import type { StageTheme } from "./types";
import {
  createTowerAtmosphere,
  towerCandleMaterial,
  towerOfferings,
  towerRubble,
  towerStonework,
  towerVigil,
  towerWindowLight,
} from "../environment/tower";
import { createTowerCutaway } from "../towerCutaway";
import { Color, Mesh } from "three";
import { createTowerExterior } from "../environment/towerExterior";
/** A CSS colour as an RGB triple for shader literals. */
function colorTriple(css: string): [number, number, number] {
  const c = new Color(css);
  return [c.r, c.g, c.b];
}
export const tower: StageTheme = {
  id: "tower",
  grade: {
    exposure: 1.2,
    green: 0.25,
    shade: [0.92, 0.94, 1.02],
    light: [1.08, 1.01, 0.9],
    curve: 0.65,
  },
  zoneAtmosphere: towerFloorAtmosphere,
  decorate({ scene, terrain, world, wind, light }) {
    const cutaway = createTowerCutaway(terrain, world);
    const atmosphere = createTowerAtmosphere(world, wind);
    const stonework = terrain instanceof Mesh ? towerStonework(terrain, world.map.terrain) : null;
    const vigil =
      world.zone.index === 3 && terrain instanceof Mesh
        ? towerVigil(terrain.material, world)
        : null;
    scene.add(atmosphere.mesh);
    const exterior =
      terrain instanceof Mesh
        ? createTowerExterior(
            terrain.material,
            wind,
            scene.fog?.color ?? new Color(tower.haze.color),
          )
        : null;
    if (exterior) scene.add(...exterior.meshes);
    const windows =
      terrain instanceof Mesh
        ? towerWindowLight(terrain, world, light.sunOffset, colorTriple(light.sun))
        : null;
    const rubble = towerRubble(world);
    if (windows) scene.add(windows.mesh);
    scene.add(rubble.mesh);
    return {
      update() {
        cutaway.update();
        vigil?.();
      },
      dispose() {
        atmosphere.dispose();
        stonework?.dispose();
        exterior?.dispose();
        windows?.dispose();
        rubble.dispose();
      },
    };
  },
  drift: [
    {
      shape: "sheet",
      count: 20,
      color: [0.55, 0.52, 0.66],
      alpha: 0.17,
      size: [3.0, 8.0],
      height: [0.05, 0.1],
      rise: 0,
      life: 10,
      speed: 0.1,
      carry: 0.6,
      flutter: 0,
      clear: 0.15,
    },
    {
      shape: "mote",
      count: 120,
      color: [0.62, 0.72, 1],
      alpha: 0.84,
      size: [0.11, 0.11],
      height: [0.3, 2.5],
      rise: 0.8,
      life: 6,
      speed: 0.15,
      carry: 0.4,
      flutter: 0.8,
      clear: 0.15,
    },
  ],
  loadingArt: "/art/loading-tower.webp",
  edge: "#f0c6ff",
  haze: {
    color: "#aaa1b7",
    near: 28,
    far: 82,
  },
  light: {
    sky: "#cfc5dc",
    ground: "#4a3f3c",
    hemi: 1,
    sun: "#fbe9d6",
    sunIntensity: 3,
    sunOffset: [20, 18, 9],
  },
  ground: {
    grass: {
      map: "/art/ground-tower-stone.jpg",
      settle: [0.4, 1.14, 1.02, 0.86],
      tile: 3.6,
      detail: "/art/ground-tower-stone-detail.png",
      normal: 0.16,
    },
    meadow: {
      map: "/art/ground-tower-stone.jpg",
      settle: [0.4, 1.14, 1.02, 0.86],
      tile: 4.4,
      detail: "/art/ground-tower-stone-detail.png",
      normal: 0.16,
    },
    dirt: {
      map: "/art/ground-tower-stone.jpg",
      settle: [0.6, 0.9, 0.88, 0.92],
      tile: 3.2,
      detail: "/art/ground-tower-stone-detail.png",
      normal: 0.16,
    },
    cliff: {
      map: "/art/ground-tower-stone.jpg",
      settle: [0.6, 0.88, 0.86, 0.92],
      tile: 2.6,
      detail: "/art/ground-tower-stone-detail.png",
      normal: 0.2,
    },
    wetSoil: [0.05, 0.04, 0.024],
    pebble: [0.12, 0.115, 0.1],
    pondBed: [0.04, 0.07, 0.055],
    sand: null,
    macro: {
      cool: [0.94, 0.96, 1.02],
      warm: [1.04, 1.02, 0.97],
      height: [0.005, 0, -0.008],
    },
    speckle: {
      color: [0.85, 0.87, 0.9],
      strength: 0.12,
      frequency: 7,
    },
    damp: [0.75, 0.77, 0.79],
    occlusion: [0.66, 0.68, 0.75],
    ink: [0.12, 0.12, 0.15],
    lip: [0.1, 0.1, 0.1],
    detailContrast: 1.0,
    blend: 0.28,
    patch: 1,
    slope: [0.3, 0.75],
    bankShade: [0.7, 1.05],
    strata: [0.55, 0],
  },
  footprints: null,
  vegetation: {
    grass: {
      density: 0.45,
      kind: "dry",
      root: [0.07, 0.11, 0.07],
      tip: [0.25, 0.36, 0.2],
      weeds: [0.7, 0.85, 0.8],
    },
    flowers: null,
    reeds: null,
    pebbles: {
      density: 0.7,
      size: [0.04, 0.12],
      dark: [0.12, 0.11, 0.15],
      light: [0.36, 0.34, 0.4],
    },
  },
  dressing: [
    {
      model: "/models/props/tower-candles.glb",
      sites: (world) => towerOfferings(world.map.terrain, world.seed),
      patchMaterial: towerCandleMaterial,
      height: 0.48,
      density: 0.0012,
      placement: "scatter",
      light: 0.26,
    },
    {
      model: "/models/props/tower-incense.glb",
      height: 0.5,
      density: 0.0005,
      placement: "scatter",
      light: 0,
    },
    {
      model: "/models/props/tower-petals.glb",
      height: 0.025,
      density: 0.008,
      placement: "scatter",
      light: 0,
    },
    {
      model: "/models/props/tower-rubble.glb",
      height: 0.15,
      density: 0.012,
      placement: "scatter",
      light: 0,
    },
    {
      model: "/models/props/tower-station.glb",
      height: 0.2,
      density: 1,
      placement: "station",
      light: 0,
    },
  ],
  landmark: {
    model: "/models/props/tower-landmark.glb",
    height: 3.2,
    glow: 0xece1b8,
    cores: [
      [-1.57, 2.03, -1.16],
      [1.57, 2.03, -1.16],
    ],
  },
  architecture: {
    slab: 1.5,
    joint: 0.035,
    wall: 0xa08a90,
    cap: 0x8c7d84,
    candles: [1, 1, 1, 0.5, 0.35, 0.35, 0.6],
  },
  water: {
    edge: [0.035, 0.08, 0.065],
    shallow: [0.17, 0.38, 0.33],
    mid: [0.09, 0.32, 0.33],
    deep: [0.03, 0.15, 0.2],
    vein: [0.62, 0.86, 0.74],
    foam: [0.8, 0.87, 0.82],
    sky: [0.62, 0.82, 0.92],
  },
  props: {
    palm: {
      models: ["/models/props/palm.glb"],
      sway: [0.32, 0.8],
      flat: true,
      tint: 1,
      drawScale: 1,
      castShadow: true,
    },
    tree: {
      models: ["/models/props/tree.glb"],
      sway: [0.22, 1.1],
      flat: true,
      tint: 1,
      drawScale: 1.1,
      castShadow: true,
    },
    pine: {
      models: ["/models/props/pine.glb"],
      sway: [0.16, 0.9],
      flat: false,
      tint: 1.45,
      drawScale: 1.1,
      castShadow: true,
    },
    rock: {
      models: [1, 2, 3].map((i) => `/models/props/tower-rock-${i}.glb`),
      sway: null,
      flat: false,
      tint: 1,
      drawScale: 1,
      castShadow: true,
    },
    bush: {
      models: ["/models/props/tower-rubble.glb"],
      sway: [0.1, 1.6],
      flat: true,
      tint: 1,
      drawScale: 1,
      castShadow: false,
    },
  },
  minimap: {
    land: [[171, 158, 185]],
    water: [104, 146, 140],
    lava: [236, 101, 41],
    shore: [78, 117, 112],
    wall: [76, 62, 94],
    wallLight: [120, 103, 139],
  },
  clouds: {
    scale: 0.055,
    depth: 0,
    coverage: [0.43, 0.72],
  },
  sunlight: {
    color: [1, 0.78, 0.45],
    glow: 0,
    shafts: 0,
    canopy: 0,
  },
};

export const towerAtmospheres = {
  "tower-hall": {
    haze: {
      color: "#5c566a",
      near: 30,
      far: 80,
    },
    light: {
      sky: "#d6d0e2",
      ground: "#393443",
      sun: "#f1e6ff",
      hemi: 1.05,
      sunIntensity: 2.6,
      sunOffset: [20, 18, 9],
    },
    sunlight: {
      color: [0.7, 0.8, 1],
      glow: 0,
      shafts: 0,
      canopy: 0,
    },
  },
  "tower-mist": {
    haze: {
      color: "#6a6478",
      near: 18,
      far: 60,
    },
    light: {
      sky: "#c5c1d4",
      ground: "#373447",
      sun: "#ddd6f3",
      hemi: 0.9,
      sunIntensity: 2.1,
      sunOffset: [20, 18, 9],
    },
    sunlight: {
      color: [0.7, 0.8, 1],
      glow: 0,
      shafts: 0,
      canopy: 0,
    },
  },
  "tower-dark": {
    haze: {
      color: "#494556",
      near: 18,
      far: 60,
    },
    light: {
      sky: "#aaa5bf",
      ground: "#302c3c",
      sun: "#c9c1e8",
      hemi: 0.85,
      sunIntensity: 1.65,
      sunOffset: [20, 18, 9],
    },
    sunlight: {
      color: [0.7, 0.8, 1],
      glow: 0,
      shafts: 0,
      canopy: 0,
    },
  },
  "tower-roof": {
    haze: {
      color: "#3b445e",
      near: 22,
      far: 72,
    },
    light: {
      sky: "#91a8d2",
      ground: "#292f43",
      sun: "#b4c8ff",
      hemi: 0.9,
      sunIntensity: 2.3,
      sunOffset: [-16, 20, 10],
    },
    sunlight: { color: [0.7, 0.78, 1], glow: 0.045, shafts: 0.07, canopy: 0 },
  },
} satisfies Record<string, import("./types").AtmosphereLook>;

/** The fourth floor shares mist content, but its extinguished vigil has its own lighting. */
export function towerFloorAtmosphere(index: number) {
  if (index === 4)
    return {
      ...towerAtmospheres["tower-hall"],
      light: {
        ...towerAtmospheres["tower-hall"].light,
        sky: "#e4e8ed",
        sun: "#f4f4eb",
        sunIntensity: 3,
      },
    };
  if (index === 5)
    return {
      ...towerAtmospheres["tower-dark"],
      light: {
        ...towerAtmospheres["tower-dark"].light,
        sky: "#c4b8cf",
        sun: "#efb5bc",
        sunIntensity: 2.1,
      },
    };
  if (index === 3)
    return {
      ...towerAtmospheres["tower-mist"],
      light: towerAtmospheres["tower-hall"].light,
    };
  return towerAtmospheres[index === 6 ? "tower-roof" : index === 2 ? "tower-mist" : "tower-hall"];
}
