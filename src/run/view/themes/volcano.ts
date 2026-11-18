import { Mesh } from "three";
import type { StageTheme } from "./types";
import { createLavaLook } from "../environment/lava";
import { animateVolcanoAltar, createVolcanoAir, volcanoGround } from "../environment/volcano";
export const volcano: StageTheme = {
  id: "volcano",
  grade: {
    exposure: 1.22,
    green: 0.25,
    shade: [0.82, 0.88, 1.06],
    light: [1.14, 1.0, 0.82],
    curve: 0.75,
  },
  patchTerrain: volcanoGround,
  decorate({ scene, terrain, world, pools, wind }) {
    const lava = createLavaLook(world.map.terrain);
    // This theme's terrain tree contains the bank and its molten surface meshes.
    terrain.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        lava.bind(material);
    });
    const air = createVolcanoAir(world, pools, wind);
    scene.add(air.mesh);
    return {
      patchEnemyMaterial: (material) =>
        lava.bindCreature(material, [0.45, 0.65, 1][world.zone.index]!),
      dispose() {
        air.dispose();
        lava.dispose();
      },
    };
  },
  drift: [
    {
      shape: "mote",
      count: 240,
      color: [0.32, 0.29, 0.28],
      alpha: 0.63,
      size: [0.11, 0.11],
      height: [0.5, 7],
      rise: -1,
      life: 8,
      speed: 0.5,
      carry: 1.5,
      flutter: 1,
      clear: 0.2,
    },
    {
      shape: "mote",
      count: 80,
      color: [1.4, 0.55, 0.12],
      alpha: 1,
      size: [0.088, 0.088],
      height: [0.2, 3],
      rise: 2.5,
      life: 3,
      speed: 0.6,
      carry: 1.5,
      flutter: 2,
      clear: 0.3,
    },
  ],
  loadingArt: "/art/loading-volcano.webp",
  edge: "#ff9a5a",
  haze: {
    color: "#a39a95",
    near: 28,
    far: 82,
  },
  light: {
    sky: "#d9cfc4",
    ground: "#4c4752",
    hemi: 1,
    sun: "#ffd9a0",
    sunIntensity: 3.9,
    sunOffset: [20, 18, 9],
  },
  ground: {
    grass: {
      map: "/art/ground-volcano-basalt.jpg",
      settle: [0.6, 1.5, 1.42, 1.4],
      tile: 4.6,
      detail: "/art/ground-volcano-basalt-detail.png",
      normal: 0.16,
    },
    meadow: {
      map: "/art/ground-volcano-ash.jpg",
      settle: [0.5, 1.3, 1.27, 1.28],
      tile: 5.2,
      detail: "/art/ground-volcano-ash-detail.png",
      normal: 0.1,
    },
    dirt: {
      map: "/art/ground-volcano-basalt.jpg",
      settle: [0.55, 0.92, 0.88, 0.9],
      tile: 3.2,
      detail: "/art/ground-volcano-basalt-detail.png",
      normal: 0.12,
    },
    cliff: {
      map: "/art/ground-volcano-cliff.jpg",
      settle: [0.75, 1.0, 1.0, 1.0],
      tile: 3.0,
      detail: "/art/ground-volcano-cliff-detail.png",
      normal: 0.18,
    },
    wetSoil: [0.04, 0.03, 0.035],
    pebble: [0.12, 0.115, 0.1],
    pondBed: [0.02, 0.02, 0.025],
    sand: null,
    macro: {
      cool: [0.94, 0.96, 1.02],
      warm: [1.04, 1.02, 0.97],
      height: [0.005, 0, -0.008],
    },
    speckle: {
      color: [0.6, 0.52, 0.5],
      strength: 0.2,
      frequency: 7,
    },
    damp: [0.75, 0.77, 0.79],
    occlusion: [0.6, 0.58, 0.64],
    ink: [0.04, 0.03, 0.045],
    lip: [0.1, 0.1, 0.1],
    detailContrast: 1.1,
    blend: 0.36,
    patch: 0.65,
    slope: [0.3, 0.75],
    bankShade: [0.7, 1.05],
    strata: [0.65, 0.06],
  },
  footprints: null,
  vegetation: {
    grass: null,
    flowers: null,
    reeds: null,
    pebbles: {
      density: 1.6,
      size: [0.04, 0.16],
      dark: [0.025, 0.02, 0.025],
      light: [0.2, 0.17, 0.16],
    },
  },
  dressing: [
    {
      model: "/models/props/volcano-vent.glb",
      height: 0.38,
      density: 0.0014,
      placement: "scatter",
      light: 0.065,
    },
    {
      model: "/models/props/volcano-obsidian.glb",
      height: 0.25,
      density: 0.024,
      placement: "scatter",
      light: 0,
    },
    {
      model: "/models/props/volcano-station.glb",
      height: 0.2,
      density: 1,
      placement: "station",
      light: 0,
    },
  ],
  landmark: {
    patchMaterial: animateVolcanoAltar,
    model: "/models/props/volcano-landmark.glb",
    height: 2.1,
    glow: 0xffdca0,
    cores: [],
  },
  architecture: null,
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
      models: ["/models/props/volcano-dead-tree-1.glb", "/models/props/volcano-dead-tree-2.glb"],
      sway: null,
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
      models: [1, 2, 3].map((i) => `/models/props/volcano-rock-${i}.glb`),
      sway: null,
      flat: false,
      tint: 1,
      drawScale: 1,
      castShadow: true,
    },
    bush: {
      models: ["/models/props/volcano-dead-tree-2.glb"],
      sway: [0.1, 1.6],
      flat: true,
      tint: 1,
      drawScale: 1,
      castShadow: false,
    },
  },
  backdrop: {
    rise: 0.14,
    cap: 4,
    hills: 2.5,
    hillSize: 11,
    layers: [
      { kind: "tree", band: [0.5, 8], spacing: 5, cover: 0.4, scale: [1, 1.5] },
      { kind: "rock", band: [0.5, 12], spacing: 4.4, cover: 0.5, scale: [1.3, 2.6], sink: 0.3 },
      {
        kind: "rock",
        band: [3, 30],
        spacing: 7,
        cover: 0.6,
        scale: [2.5, 4],
        stretch: [1.3, 1.5, 0.9],
        sink: 1.2,
        strata: 0.18,
        tint: [0.62, 0.6, 0.66],
      },
    ],
    vents: {
      band: [-10, 12],
      spacing: 7,
      radius: [1.3, 2.8],
      crust: [0.12, 0.05, 0.04],
      hot: [1.6, 0.55, 0.12],
    },
  },
  minimap: {
    land: [
      [117, 112, 111],
      [100, 96, 97],
    ],
    water: [236, 101, 41],
    lava: [255, 163, 38],
    shore: [79, 57, 47],
    wall: [46, 43, 49],
    wallLight: [86, 77, 77],
  },
  clouds: {
    scale: 0.055,
    depth: 0.44,
    coverage: [0.43, 0.72],
  },
  sunlight: {
    color: [1, 0.78, 0.45],
    glow: 0,
    shafts: 0,
    canopy: 0,
  },
};

export const volcanoAtmospheres = {
  "ash-day": {
    haze: {
      color: "#a39a95",
      near: 28,
      far: 82,
    },
    light: {
      sky: "#d9cfc4",
      ground: "#4c4752",
      sun: "#ffe2bc",
      hemi: 1.1,
      sunIntensity: 3.5,
      sunOffset: [20, 20, 9],
    },
  },
  "ember-dusk": {
    haze: {
      color: "#7a5a58",
      near: 22,
      far: 68,
    },
    light: {
      sky: "#c3b5bd",
      ground: "#393544",
      sun: "#ffd5ad",
      hemi: 1,
      sunIntensity: 3,
      sunOffset: [26, 10, 5],
    },
  },
  eruption: {
    haze: {
      color: "#2e2430",
      near: 16,
      far: 54,
    },
    light: {
      sky: "#a49eb8",
      ground: "#302938",
      sun: "#b8b4d8",
      hemi: 1,
      sunIntensity: 2.1,
      sunOffset: [-16, 20, 10],
    },
    sunlight: {
      color: [0.7, 0.8, 1],
      glow: 0,
      shafts: 0,
      canopy: 0,
    },
  },
} satisfies Record<string, import("./types").AtmosphereLook>;
