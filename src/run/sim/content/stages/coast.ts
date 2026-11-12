import type { StampedeBeat } from "../../beats";
import { firstBeats, laterBeats } from "./beatTemplates";
import { forest } from "./forest";
import type { StageDef, StageZone } from "./index";

/** Zone 1 (热带黄昏): sidelong crabs and the first enemies that fight from the water (docs/state-machines/simulation.md). */
const tropicRoster = [
  [0, "krabby"],
  [0, "spearow"],
  [0, "geodude"],
  [0, "meowth"],
  [30, "poliwag"],
  [45, "sandshrew"],
  [60, "tentacool"],
  [90, "diglett"],
  [105, "omanyte"],
  [120, "psyduck"],
  [150, "kabuto"],
  [180, "voltorb"],
  [210, "exeggcute"],
  [240, "magnemite"],
  [270, "poliwhirl"],
  [300, "golduck"],
  [330, "pidgeotto"],
  [360, "fearow"],
  [390, "graveler"],
  [420, "electrode"],
] as const satisfies StageZone["roster"];

/** Zone 2 (暴风雨之夜): the sea's chargers and gunners, a healer, heavy electric rings. */
const stormRoster = [
  [0, "golduck"],
  [0, "kabuto"],
  [0, "magnemite"],
  [0, "fearow"],
  [20, "seadra"],
  [45, "chansey"],
  [70, "magneton"],
  [95, "lickitung"],
  [120, "seaking"],
  [145, "poliwrath"],
  [170, "dodrio"],
  [195, "tentacool"],
  [220, "electrode"],
  [245, "exeggutor"],
  [270, "golem"],
] as const satisfies StageZone["roster"];

/** Zone 3 (雷暴): fast electric types and the dragon. */
const thunderRoster = [
  [0, "magneton"],
  [0, "poliwrath"],
  [0, "seaking"],
  [0, "staryu"],
  [20, "jolteon"],
  [45, "kabutops"],
  [70, "electabuzz"],
  [95, "omastar"],
  [120, "dragonair"],
  [145, "chansey"],
  [170, "seadra"],
  [195, "lickitung"],
  [220, "electrode"],
  [245, "golduck"],
] as const satisfies StageZone["roster"];

const tauros = {
  kind: "stampede",
  species: "tauros",
  banner: "肯泰罗冲锋！",
} as const satisfies StampedeBeat;

const tropicBeats = firstBeats(
  { kind: "swarm", species: ["krabby"], banner: "大钳蟹群包围！" },
  tauros,
);
const stormBeats = laterBeats(
  { kind: "swarm", species: ["magnemite"], banner: "小磁怪群包围！" },
  { kind: "stampede", species: "dodrio", banner: "嘟嘟利冲锋！" },
);
const thunderBeats = laterBeats(
  { kind: "swarm", species: ["staryu"], banner: "海星星群包围！" },
  { kind: "stampede", species: "jolteon", banner: "雷伊布冲锋！" },
);

const kingler = {
  species: "kingler",
  brain: "kingler",
  banner: "守卫 巨钳蟹 现身",
} as const satisfies StageZone["guardian"];

const gyarados = {
  species: "gyarados",
  brain: "gyarados",
  banner: "守卫 暴鲤龙 现身",
} as const satisfies StageZone["guardian"];

const starmie = {
  species: "starmie",
  brain: "starmie",
  banner: "守卫 宝石海星 现身",
} as const satisfies StageZone["guardian"];

/**
 * 风暴海岸: a broad beach curls around a bay; isolated reef tops break the open sea. Deep water walls
 * in ground walkers; swimmers stay in it and Gyarados crosses both (docs/NAVIGATION.md). Static water
 * level (no tides).
 */
export const coast = {
  id: "coast",
  name: "风暴海岸",
  duration: 600,
  /** Water resists fire; × this keeps Charmander near its forest clear (docs/BALANCE.md「地图强度」). */
  enemyHp: 0.65,
  map: {
    terrain: {
      levels: 1,
      step: 0.45,
      wavelength: 48,
      cliffRamp: 0.9,
      gentleRamp: 1,
      undulation: 0.06,
      rim: 0.1,
    },
    surface: { ground: "sand", shallowSpeed: 0.8, liquids: [{ kind: "water", level: -0.15 }] },
    passages: [
      {
        points: [
          [-30, -28],
          [-4, -28],
          [9, -18],
          [9, 18],
          [-4, 28],
          [-30, 28],
        ],
        width: 8,
      },
      {
        points: [
          [-28, -28],
          [-28, 28],
        ],
        width: 8,
      },
    ],
    stamps: [
      {
        kind: "trench",
        points: [
          [44, -80],
          [44, 80],
        ],
        width: 30,
        depth: 2.8,
        edge: 17,
      },
      {
        kind: "trench",
        points: [
          [45, -18],
          [28, 0],
          [45, 20],
        ],
        width: 14,
        depth: 1.2,
        edge: 10,
      },
      { kind: "mesa", at: [36, -26], jitter: 1, radius: 2.4, height: 3.2, edge: 1.2, ramps: [] },
      { kind: "mesa", at: [38, 25], jitter: 1, radius: 3, height: 3.3, edge: 1.3, ramps: [] },
    ],
    pads: forest.map.pads,
    puddles: { count: [0, 0], depth: 0.42 },
    props: [
      { kind: "palm", count: 10, scale: [0.95, 1.3], solid: true, gap: 3 },
      { kind: "rock", count: 18, scale: [0.8, 1.5], solid: true, gap: 3 },
    ],
    wall: { count: 60, kinds: ["rock"] },
  },
  zones: [
    { roster: tropicRoster, beats: tropicBeats, guardian: kingler, atmosphere: "tropic" },
    { roster: stormRoster, beats: stormBeats, guardian: gyarados, atmosphere: "storm" },
    { roster: thunderRoster, beats: thunderBeats, guardian: starmie, atmosphere: "thunder" },
  ],
  rampage: { banner: "海岸暴走：敌人越来越强" },
  stations: ["hypno", "bill"],
} as const satisfies StageDef<"coast">;
