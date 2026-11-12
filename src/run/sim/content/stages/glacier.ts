import { firstBeats, laterBeats } from "./beatTemplates";
import { forest } from "./forest";
import type { StageDef } from "./index";

/** 天空冰川: ice lakes, finite crevasses and eight-metre connecting bands. */
export const glacier = {
  ...forest,
  id: "glacier",
  name: "天空冰川",
  enemyHp: 0.75,
  zones: [
    {
      roster: [
        [0, "zubat"],
        [0, "geodude"],
        [0, "seel"],
        [0, "poliwag"],
        [30, "shellder"],
        [45, "psyduck"],
        [60, "clefairy"],
        [90, "sandshrew"],
        [105, "slowpoke"],
        [120, "jigglypuff"],
        [150, "onix"],
        [180, "poliwhirl"],
        [210, "staryu"],
        [240, "graveler"],
        [270, "magnemite"],
        [300, "golduck"],
        [330, "fearow"],
        [360, "exeggcute"],
        [390, "chansey"],
        [420, "poliwrath"],
        [450, "golem"],
      ],
      beats: firstBeats(
        { kind: "swarm", species: ["seel", "zubat"], banner: "群体来袭" },
        { kind: "stampede", species: "seel", banner: "冲锋来袭" },
      ),
      guardian: { species: "dewgong", brain: "dewgong", banner: "白海狮 出现" },
      atmosphere: "glacier-clear",
    },
    {
      roster: [
        [0, "seel"],
        [0, "shellder"],
        [0, "slowpoke"],
        [0, "jigglypuff"],
        [20, "kadabra"],
        [45, "jynx"],
        [70, "vaporeon"],
        [95, "dratini"],
        [120, "onix"],
        [145, "golduck"],
        [170, "snorlax"],
        [195, "chansey"],
        [220, "magneton"],
        [245, "poliwrath"],
        [270, "golem"],
        [300, "staryu"],
      ],
      beats: laterBeats(
        { kind: "swarm", species: ["zubat"], banner: "群体来袭" },
        { kind: "stampede", species: "seel", banner: "冲锋来袭" },
        { kind: "swarm", species: ["seel"], banner: "海狮群来袭" },
      ),
      guardian: { species: "cloyster", brain: "cloyster", banner: "刺甲贝 出现" },
      atmosphere: "glacier-aurora",
    },
    {
      roster: [
        [0, "snorlax"],
        [0, "kadabra"],
        [0, "jynx"],
        [0, "vaporeon"],
        [20, "dratini"],
        [45, "dragonair"],
        [70, "wigglytuff"],
        [95, "magneton"],
        [120, "onix"],
        [145, "chansey"],
        [170, "golduck"],
        [195, "golem"],
        [220, "poliwrath"],
        [245, "shellder"],
        [270, "seel"],
        [295, "clefairy"],
      ],
      beats: laterBeats(
        { kind: "swarm", species: ["dratini"], banner: "群体来袭" },
        { kind: "stampede", species: "seel", banner: "冲锋来袭" },
      ),
      guardian: { species: "lapras", brain: "lapras", banner: "拉普拉斯 出现" },
      atmosphere: "glacier-blizzard",
    },
  ],
  map: {
    terrain: {
      levels: 2,
      step: 0.8,
      wavelength: 48,
      cliffRamp: 0.8,
      gentleRamp: 1,
      undulation: 0.08,
      rim: 0.25,
    },
    surface: { ground: "ice", shallowSpeed: 1, liquids: [] },
    passages: [
      {
        points: [
          [-32, -24],
          [32, -24],
        ],
        width: 8,
      },
      {
        points: [
          [-32, 0],
          [32, 0],
        ],
        width: 8,
      },
      {
        points: [
          [-32, 24],
          [32, 24],
        ],
        width: 8,
      },
      {
        points: [
          [-32, -24],
          [-32, 24],
        ],
        width: 8,
      },
      {
        points: [
          [32, -24],
          [32, 24],
        ],
        width: 8,
      },
    ],
    stamps: [
      { kind: "ice-slick", at: [-4, -12], jitter: 0, radius: 4 },
      { kind: "ice-slick", at: [4, 12], jitter: 0, radius: 4 },
      { kind: "ice-slick", at: [-25, 32], jitter: 0, radius: 3 },
      {
        kind: "trench",
        points: [
          [-18, -33],
          [-12, -9],
          [-15, 12],
        ],
        width: 2,
        depth: 4,
        edge: 0.8,
      },
      {
        kind: "trench",
        points: [
          [16, -14],
          [22, 8],
          [15, 34],
        ],
        width: 2.5,
        depth: 4,
        edge: 0.8,
      },
      {
        kind: "trench",
        points: [
          [-26, 18],
          [-6, 12],
        ],
        width: 2,
        depth: 3.5,
        edge: 0.8,
      },
    ],
    pads: forest.map.pads,
    puddles: { count: [0, 0], depth: 0.42 },
    props: [{ kind: "rock", count: 18, scale: [0.7, 1.4], solid: true, gap: 3 }],
    wall: { count: 70, kinds: ["rock"] },
  },
} as const satisfies StageDef<"glacier">;
