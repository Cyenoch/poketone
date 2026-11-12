import type { StampedeBeat, SwarmBeat } from "../../beats";
import { laterBeats } from "./beatTemplates";
import type { StageDef, StageZone } from "./index";

/** The forest's swarm (rung twice) and stampede beats. */
const bugs = {
  kind: "swarm",
  species: ["caterpie", "weedle"],
  banner: "虫群包围！",
} as const satisfies SwarmBeat;
const rattata = {
  kind: "stampede",
  species: "rattata",
  banner: "小拉达冲锋！",
} as const satisfies StampedeBeat;

const roster = [
  [0, "caterpie"],
  [0, "rattata"],
  [45, "metapod"],
  [60, "weedle"],
  [75, "kakuna"],
  [90, "spearow"],
  [105, "nidoran-f"],
  [120, "pidgey"],
  [135, "nidoran-m"],
  [165, "voltorb"],
  [180, "oddish"],
  [195, "vulpix"],
  [210, "ekans"],
  [225, "growlithe"],
  [255, "butterfree"],
  [270, "zubat"],
  [285, "beedrill"],
  [300, "raticate"],
  [315, "pidgeotto"],
  [330, "paras"],
  [345, "gloom"],
  [375, "arbok"],
  [390, "venonat"],
  [390, "parasect"],
  [405, "venomoth"],
  [420, "fearow"],
  [435, "vileplume"],
  [450, "geodude"],
  [465, "graveler"],
  [480, "electrode"],
  [495, "golem"],
] as const satisfies StageZone["roster"];

const beats = [
  [150, { kind: "alpha" }],
  [235, bugs],
  [330, { kind: "alpha" }],
  [330, { kind: "elite-wave" }],
  [390, rattata],
  [450, { kind: "elite-wave" }],
  [480, { kind: "alpha" }],
  [520, bugs],
] as const satisfies StageZone["beats"];

const guardian = {
  species: "scyther",
  brain: "scyther",
  banner: "守卫 飞天螳螂 现身",
} as const satisfies StageZone["guardian"];

/** Zone 2 (黄昏): leave the landing circle — burrowers, leapers and the water side's bubbles (docs/state-machines/simulation.md). */
const duskRoster = [
  [0, "raticate"],
  [0, "pidgeotto"],
  [0, "gloom"],
  [0, "nidorina"],
  [20, "poliwag"],
  [45, "diglett"],
  [70, "mankey"],
  [95, "sandshrew"],
  [120, "psyduck"],
  [145, "nidorino"],
  [170, "magnemite"],
  [195, "parasect"],
  [220, "poliwhirl"],
  [245, "exeggcute"],
  [270, "graveler"],
  [295, "primeape"],
  [320, "fearow"],
  [345, "vileplume"],
  [370, "electrode"],
] as const satisfies StageZone["roster"];

/** Zone 3 (月夜): targets to take out first — moving smog and the healer. */
const nightRoster = [
  [0, "nidorino"],
  [0, "golem"],
  [0, "venomoth"],
  [0, "gastly"],
  [20, "koffing"],
  [45, "clefairy"],
  [70, "arbok"],
  [95, "tangela"],
  [120, "haunter"],
  [145, "primeape"],
  [170, "weezing"],
  [195, "vileplume"],
  [220, "exeggutor"],
  [245, "poliwhirl"],
  [270, "fearow"],
  [295, "electrode"],
  [320, "magnemite"],
] as const satisfies StageZone["roster"];

/** Zones 2–3 beat earlier than zone 1 (beatTemplates.ts). */
const duskBeats = laterBeats(
  { kind: "swarm", species: ["poliwag", "nidorina"], banner: "蝌蚪群包围！" },
  { kind: "stampede", species: "mankey", banner: "猴怪冲锋！" },
  { kind: "swarm", species: ["poliwag", "sandshrew"], banner: "蝌蚪群包围！" },
);
const nightBeats = laterBeats(
  { kind: "swarm", species: ["gastly"], banner: "鬼斯包围！" },
  { kind: "stampede", species: "nidorino", banner: "尼多力诺冲锋！" },
);

const pinsir = {
  species: "pinsir",
  brain: "pinsir",
  banner: "守卫 凯罗斯 现身",
} as const satisfies StageZone["guardian"];

const nidoking = {
  species: "nidoking",
  brain: "nidoking",
  banner: "守卫 尼多王 现身",
} as const satisfies StageZone["guardian"];

/** 青翠森林: the first map (Pokébonk's `forest` region as the yardstick; roster and timing are our own). */
export const forest = {
  id: "forest",
  name: "青翠森林",
  duration: 600,
  map: {
    surface: { ground: "ground", shallowSpeed: 1, liquids: [] },
    terrain: {
      levels: 3,
      step: 1.5,
      wavelength: 26,
      cliffRamp: 0.08,
      gentleRamp: 0.85,
      undulation: 0.22,
      rim: 0.45,
    },
    // The forest's layout is its terraces alone: no stamps, no reserved passages.
    passages: [],
    stamps: [],
    // Building pads take the stations; the landmark pad is the guardian's altar and, once it falls, the exit.
    pads: [
      { tag: "building", radius: 4, count: 2, maxSlope: 0.05 },
      { tag: "landmark", radius: 4, count: 1, maxSlope: 0.05 },
    ],
    puddles: { count: [5, 7], depth: 0.42 },
    props: [
      { kind: "rock", count: 14, scale: [0.9, 1.6], solid: true, gap: 4 },
      { kind: "tree", count: 12, scale: [0.7, 0.9], solid: true, gap: 5 },
      { kind: "pine", count: 8, scale: [0.6, 0.8], solid: true, gap: 5 },
      { kind: "bush", count: 34, scale: [0.6, 1], solid: false, gap: 1 },
    ],
    wall: { count: 120, kinds: ["tree", "pine", "pine"] },
  },
  zones: [
    { roster, beats, guardian, atmosphere: "afternoon" },
    // Each later zone has its own roster, earlier beats and guardian (docs/state-machines/simulation.md).
    { roster: duskRoster, beats: duskBeats, guardian: pinsir, atmosphere: "dusk" },
    { roster: nightRoster, beats: nightBeats, guardian: nidoking, atmosphere: "night" },
  ],
  rampage: { banner: "森林暴走：敌人越来越强" },
  stations: ["hypno", "bill"],
} as const satisfies StageDef<"forest">;
