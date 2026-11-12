import type { StampedeBeat } from "../../beats";
import { firstBeats, laterBeats } from "./beatTemplates";
import type { StageDef, StageZone } from "./index";

/** Zone 1 (热霾): the forest's swarm and early desert species; Cubone's bonemerang is the new read (docs/state-machines/simulation.md). */
const heatRoster = [
  [0, "rattata"],
  [0, "spearow"],
  [0, "sandshrew"],
  [0, "ekans"],
  [30, "diglett"],
  [45, "nidoran-m"],
  [60, "doduo"],
  [90, "zubat"],
  [105, "nidoran-f"],
  [120, "meowth"],
  [150, "vulpix"],
  [180, "geodude"],
  [210, "ponyta"],
  [240, "growlithe"],
  [270, "cubone"],
  [300, "mankey"],
  [330, "raticate"],
  [360, "arbok"],
  [390, "fearow"],
  [420, "graveler"],
  [450, "exeggcute"],
] as const satisfies StageZone["roster"];

/** Zone 2 (日落): fighters and heavy chargers. */
const sunsetRoster = [
  [0, "raticate"],
  [0, "fearow"],
  [0, "graveler"],
  [0, "doduo"],
  [20, "machop"],
  [45, "ponyta"],
  [70, "hitmonlee"],
  [95, "cubone"],
  [120, "rhyhorn"],
  [145, "primeape"],
  [170, "arbok"],
  [195, "dodrio"],
  [220, "onix"],
  [245, "exeggcute"],
  [270, "golem"],
  [300, "nidorino"],
] as const satisfies StageZone["roster"];

/** Zone 3 (沙暴之夜): fossils and fire; Rhydon's rockfall is the new read. */
const stormRoster = [
  [0, "dodrio"],
  [0, "golem"],
  [0, "rhyhorn"],
  [0, "hitmonlee"],
  [20, "rapidash"],
  [45, "tauros"],
  [70, "kabutops"],
  [95, "omastar"],
  [120, "onix"],
  [145, "primeape"],
  [170, "rhydon"],
  [195, "nidorino"],
  [220, "magnemite"],
  [245, "fearow"],
] as const satisfies StageZone["roster"];

const tauros = {
  kind: "stampede",
  species: "tauros",
  banner: "肯泰罗冲锋！",
} as const satisfies StampedeBeat;

const heatBeats = firstBeats(
  { kind: "swarm", species: ["sandshrew", "rattata"], banner: "穿山鼠群包围！" },
  tauros,
);
const sunsetBeats = laterBeats(
  { kind: "swarm", species: ["machop"], banner: "腕力群包围！" },
  tauros,
);
const stormBeats = laterBeats(
  { kind: "swarm", species: ["sandshrew", "diglett"], banner: "穿山鼠群包围！" },
  { kind: "stampede", species: "rapidash", banner: "烈焰马冲锋！" },
);

const sandslash = {
  species: "sandslash",
  brain: "sandslash",
  banner: "守卫 穿山王 现身",
} as const satisfies StageZone["guardian"];

const marowak = {
  species: "marowak",
  brain: "marowak",
  banner: "守卫 嘎啦嘎啦 现身",
} as const satisfies StageZone["guardian"];

const aerodactyl = {
  species: "aerodactyl",
  brain: "aerodactyl",
  banner: "守卫 化石翼龙 现身",
} as const satisfies StageZone["guardian"];

/**
 * 岩石沙漠: an open basin inside a ring mound crossed by four ramps, two offset mesas in the basin, one
 * in a corner beyond the ring, and a trench across the outer band with a causeway. Quicksand and
 * burning ground lie in the basin as surface patches (docs/state-machines/simulation.md). Not offered to players
 * yet (the map picker lists it).
 */
export const desert = {
  id: "desert",
  name: "岩石沙漠",
  duration: 600,
  /**
   * Ground / rock resist fire and shrug off electric; × this keeps Charmander and Pikachu near their
   * forest clear (docs/BALANCE.md「地图强度」).
   */
  enemyHp: 0.8,
  map: {
    surface: { ground: "sand", shallowSpeed: 1, liquids: [] },
    terrain: {
      levels: 2,
      step: 1.2,
      wavelength: 36,
      cliffRamp: 0.25,
      gentleRamp: 0.9,
      undulation: 0.3,
      rim: 0.5,
    },
    // Around the outer band, over the trench.
    passages: [
      {
        points: [
          [12, -36.1],
          [20.5, -32],
          [27.8, -25.9],
        ],
        width: 4,
      },
    ],
    // Mesa ramps run along the basin, never toward the ring's inner wall.
    stamps: [
      {
        kind: "ring",
        at: [0, 0],
        jitter: 0,
        radius: 31,
        thickness: 3,
        height: 1.8,
        edge: 0.8,
        ramps: [0.3, 1.6, 3.4, 5].map((angle) => ({ angle, width: 4.5, length: 5 })),
      },
      {
        kind: "mesa",
        at: [15, -11],
        jitter: 2,
        radius: 4.5,
        height: 2.2,
        edge: 0.8,
        ramps: [
          { angle: 1.6, width: 4.5, length: 6.5 },
          { angle: 3.3, width: 4.5, length: 6.5 },
        ],
      },
      {
        kind: "mesa",
        at: [-13, 14],
        jitter: 2,
        radius: 4,
        height: 1.8,
        edge: 0.8,
        ramps: [
          { angle: 0, width: 4.5, length: 5.5 },
          { angle: 4.7, width: 4.5, length: 5.5 },
        ],
      },
      {
        kind: "mesa",
        at: [-35, -35],
        jitter: 1.5,
        radius: 4.5,
        height: 1.6,
        edge: 0.8,
        ramps: [{ angle: 0.785, width: 4.5, length: 5 }],
      },
      {
        kind: "trench",
        points: [
          [18.6, -29],
          [23, -35.8],
        ],
        width: 2,
        depth: 1.4,
        edge: 0.7,
      },
      // Surface patches last: their jitter draws come after every landform's.
      { kind: "quicksand", at: [-6, -19], jitter: 2, radius: 3 },
      { kind: "quicksand", at: [21, 9], jitter: 2, radius: 2.6 },
      { kind: "embers", at: [-23, -3], jitter: 2, radius: 2.2 },
      { kind: "embers", at: [3, 23], jitter: 2, radius: 2.2 },
    ],
    // Building pads take the stations; the landmark pad is the guardian's altar and, once it falls, the exit.
    pads: [
      { tag: "building", radius: 4, count: 2, maxSlope: 0.05 },
      { tag: "landmark", radius: 4, count: 1, maxSlope: 0.05 },
    ],
    puddles: { count: [1, 2], depth: 0.42 },
    props: [
      { kind: "rock", count: 22, scale: [0.9, 1.8], solid: true, gap: 3 },
      { kind: "bush", count: 16, scale: [0.5, 0.9], solid: false, gap: 1 },
    ],
    wall: { count: 100, kinds: ["rock"] },
  },
  zones: [
    { roster: heatRoster, beats: heatBeats, guardian: sandslash, atmosphere: "heat" },
    { roster: sunsetRoster, beats: sunsetBeats, guardian: marowak, atmosphere: "sunset" },
    { roster: stormRoster, beats: stormBeats, guardian: aerodactyl, atmosphere: "sandstorm" },
  ],
  rampage: { banner: "沙漠暴走：敌人越来越强" },
  stations: ["hypno", "bill"],
} as const satisfies StageDef<"desert">;
