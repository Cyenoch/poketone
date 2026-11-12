import { firstBeats, laterBeats } from "./beatTemplates";
import { forest } from "./forest";
import type { StageDef } from "./index";

/** 火山岛: two lava channels, with three wide causeways and safe ground between them. */
export const volcano = {
  ...forest,
  id: "volcano",
  name: "火山岛",
  enemyHp: 0.6,
  zones: [
    {
      roster: [
        [0, "vulpix"],
        [0, "geodude"],
        [0, "spearow"],
        [0, "diglett"],
        [30, "growlithe"],
        [45, "koffing"],
        [60, "ponyta"],
        [90, "dugtrio"],
        [105, "machop"],
        [120, "ninetales"],
        [150, "graveler"],
        [180, "mankey"],
        [210, "rhyhorn"],
        [240, "onix"],
        [270, "dratini"],
        [300, "rapidash"],
        [330, "primeape"],
        [360, "magnemite"],
        [390, "fearow"],
        [420, "golem"],
        [450, "weezing"],
      ],
      beats: firstBeats(
        { kind: "swarm", species: ["diglett", "vulpix"], banner: "群体来袭" },
        { kind: "stampede", species: "ponyta", banner: "冲锋来袭" },
      ),
      guardian: { species: "magmar", brain: "magmar", banner: "鸭嘴火兽 出现" },
      atmosphere: "ash-day",
    },
    {
      roster: [
        [0, "ninetales"],
        [0, "dugtrio"],
        [0, "rapidash"],
        [0, "rhyhorn"],
        [20, "hitmonchan"],
        [45, "dratini"],
        [70, "flareon"],
        [95, "golem"],
        [120, "rhydon"],
        [145, "dragonair"],
        [170, "magneton"],
        [195, "primeape"],
        [220, "onix"],
        [245, "weezing"],
        [270, "machop"],
        [300, "omastar"],
      ],
      beats: [
        ...laterBeats(
          { kind: "swarm", species: ["ponyta"], banner: "群体来袭" },
          { kind: "stampede", species: "rapidash", banner: "冲锋来袭" },
        ),
        [150, { kind: "eruption" }],
        [360, { kind: "eruption" }],
      ],
      guardian: { species: "arcanine", brain: "arcanine", banner: "风速狗 出现" },
      atmosphere: "ember-dusk",
    },
    {
      roster: [
        [0, "hitmonchan"],
        [0, "flareon"],
        [0, "rhydon"],
        [0, "dragonair"],
        [20, "magneton"],
        [45, "ninetales"],
        [70, "dratini"],
        [95, "golem"],
        [120, "dugtrio"],
        [145, "primeape"],
        [170, "omastar"],
        [195, "onix"],
        [220, "weezing"],
        [245, "rapidash"],
        [270, "rhyhorn"],
        [295, "magnemite"],
      ],
      beats: [
        ...laterBeats(
          { kind: "swarm", species: ["dratini"], banner: "群体来袭" },
          { kind: "stampede", species: "rapidash", banner: "冲锋来袭" },
        ),
        [120, { kind: "eruption" }],
        [330, { kind: "eruption" }],
      ],
      guardian: { species: "dragonite", brain: "dragonite", banner: "快龙 出现" },
      atmosphere: "eruption",
    },
  ],
  map: {
    terrain: {
      levels: 1,
      step: 0.6,
      wavelength: 48,
      cliffRamp: 0.9,
      gentleRamp: 1,
      undulation: 0.04,
      rim: 0.15,
    },
    surface: { ground: "ground", shallowSpeed: 1, liquids: [{ kind: "lava", level: -0.12 }] },
    passages: [
      {
        points: [
          [-32, -24],
          [32, -24],
        ],
        width: 7,
      },
      {
        points: [
          [-32, 0],
          [32, 0],
        ],
        width: 7,
      },
      {
        points: [
          [-32, 24],
          [32, 24],
        ],
        width: 7,
      },
      {
        points: [
          [-32, -24],
          [-32, 24],
        ],
        width: 7,
      },
      {
        points: [
          [32, -24],
          [32, 24],
        ],
        width: 7,
      },
    ],
    stamps: [
      {
        kind: "trench",
        points: [
          [-17, -39],
          [-14, -10],
          [-20, 14],
          [-16, 39],
        ],
        width: 3.5,
        depth: 0.8,
        edge: 2,
      },
      {
        kind: "trench",
        points: [
          [17, -39],
          [21, -8],
          [14, 12],
          [18, 39],
        ],
        width: 3.5,
        depth: 0.8,
        edge: 2,
      },
    ],
    pads: forest.map.pads,
    puddles: { count: [0, 0], depth: 0.42 },
    props: [{ kind: "rock", count: 20, scale: [0.8, 1.5], solid: true, gap: 3 }],
    wall: { count: 75, kinds: ["rock"] },
  },
} as const satisfies StageDef<"volcano">;
