import { towerBeats } from "./beatTemplates";
import type { FloorBlock, FloorTemplate, MapSpec } from "../../mapgen/spec";
import { forest } from "./forest";
import type { StageDef, StageZone } from "./index";

const wall = (x: number, z: number, width: number, depth: number): FloorBlock => ({
  kind: "wall",
  at: [x, z],
  size: [width, depth],
  height: 3,
});
const pillar = ([x, z]: readonly [number, number]): FloorBlock => ({
  kind: "pillar",
  at: [x, z],
  size: [1.5, 1.5],
  height: 4,
});
const tombstone = ([x, z]: readonly [number, number]): FloorBlock => ({
  kind: "tombstone",
  at: [x, z],
  size: [1.5, 0.5],
  height: 1.5,
});

const boundary = [
  wall(-43.5, 0, 1, 88),
  wall(43.5, 0, 1, 88),
  wall(0, -43.5, 88, 1),
  wall(0, 43.5, 88, 1),
];
const passages: FloorTemplate["passages"] = [
  {
    points: [
      [-39, 0],
      [39, 0],
    ],
    width: 8,
  },
  {
    points: [
      [0, -39],
      [0, 39],
    ],
    width: 8,
  },
];

/** Ordinary map inputs selected by the stage's floor slots. */
export const towerFloors = [
  {
    id: "colonnade",
    passages: [
      ...passages,
      {
        points: [
          [0, 0],
          [0, 15],
          [32, 15],
        ],
        width: 6,
      },
    ],
    blocks: [
      ...boundary,
      wall(-20, -10, 18, 1),
      wall(20, 10, 18, 1),
      wall(-10, 24, 1, 12),
      wall(10, -24, 1, 12),
      ...(
        [
          [-25, 14],
          [-17, 14],
          [-25, 22],
          [-17, 22],
          [17, -14],
          [25, -14],
          [17, -22],
          [25, -22],
        ] as const
      ).map(pillar),
      ...(
        [
          [-27, -21],
          [-21, -21],
          [-15, -21],
          [15, 23],
          [21, 23],
          [27, 23],
        ] as const
      ).map(tombstone),
    ],
  },
  {
    id: "memorial",
    passages: [
      ...passages,
      {
        points: [
          [0, 0],
          [0, -16],
          [32, -16],
        ],
        width: 6,
      },
    ],
    blocks: [
      ...boundary,
      wall(-22, 10, 20, 1),
      wall(22, -10, 20, 1),
      wall(-10, -24, 1, 14),
      wall(10, 24, 1, 14),
      ...(
        [
          [-20, -14],
          [-28, -14],
          [20, 14],
          [28, 14],
        ] as const
      ).map(pillar),
      ...(
        [
          [-18, 19],
          [-24, 19],
          [-30, 19],
          [-18, 25],
          [-24, 25],
          [-30, 25],
          [18, -21],
          [24, -21],
          [30, -21],
        ] as const
      ).map(tombstone),
    ],
  },
] as const satisfies readonly FloorTemplate[];

const map = {
  terrain: { ...forest.map.terrain, levels: 0, undulation: 0, rim: 0 },
  surface: forest.map.surface,
  passages: [],
  stamps: [],
  pads: forest.map.pads,
  puddles: { count: [0, 0], depth: 0.42 },
  props: [],
  wall: { count: 0, kinds: ["rock"] },
} as const satisfies MapSpec;

const floor = (template: FloorTemplate, content: StageZone) => ({
  ...content,
  map: { ...map, templates: [template] },
});

const zones = [
  floor(towerFloors[0], {
    roster: [
      [0, "gastly"],
      [0, "zubat"],
      [0, "cubone"],
      [0, "oddish"],
      [15, "rattata"],
      [30, "ekans"],
      [45, "venonat"],
      [60, "koffing"],
      [75, "paras"],
      [90, "meowth"],
      [105, "gloom"],
      [120, "raticate"],
      [135, "venomoth"],
    ],
    beats: towerBeats(
      { kind: "swarm", species: ["gastly"], banner: "群体来袭" },
      { kind: "stampede", species: "rattata", banner: "冲锋来袭" },
    ),
    guardian: { species: "haunter-guardian", brain: "haunter-guardian", banner: "鬼斯通 出现" },
    atmosphere: "tower-hall",
  }),
  floor(towerFloors[1], {
    roster: [
      [0, "gastly"],
      [0, "cubone"],
      [0, "koffing"],
      [0, "zubat"],
      [15, "grimer"],
      [30, "ekans"],
      [45, "venonat"],
      [60, "haunter"],
      [75, "parasect"],
      [90, "arbok"],
      [105, "venomoth"],
      [120, "weezing"],
      [135, "raticate"],
    ],
    beats: towerBeats(
      { kind: "swarm", species: ["gastly", "zubat"], banner: "群体来袭" },
      { kind: "stampede", species: "raticate", banner: "冲锋来袭" },
    ),
    guardian: { species: "muk", brain: "muk", banner: "臭臭泥 出现" },
    atmosphere: "tower-hall",
  }),
  floor(towerFloors[0], {
    roster: [
      [0, "haunter"],
      [0, "gastly"],
      [0, "grimer"],
      [0, "zubat"],
      [15, "jigglypuff"],
      [30, "koffing"],
      [45, "arbok"],
      [60, "exeggcute"],
      [75, "venomoth"],
      [90, "clefairy"],
      [105, "weezing"],
      [120, "vileplume"],
      [135, "psyduck"],
    ],
    beats: towerBeats(
      { kind: "swarm", species: ["gastly"], banner: "群体来袭" },
      { kind: "stampede", species: "raticate", banner: "冲锋来袭" },
    ),
    guardian: { species: "mr-mime", brain: "mr-mime", banner: "魔墙人偶 出现" },
    atmosphere: "tower-mist",
  }),
  floor(towerFloors[1], {
    roster: [
      [0, "gastly"],
      [0, "weezing"],
      [0, "grimer"],
      [0, "venonat"],
      [15, "jigglypuff"],
      [30, "venomoth"],
      [45, "cubone"],
      [60, "raticate"],
      [75, "arbok"],
      [90, "vileplume"],
      [105, "tangela"],
      [120, "parasect"],
      [135, "exeggutor"],
    ],
    beats: towerBeats(
      { kind: "swarm", species: ["zubat"], banner: "群体来袭" },
      { kind: "stampede", species: "cubone", banner: "冲锋来袭" },
    ),
    guardian: { species: "golbat", brain: "golbat", banner: "大嘴蝠 出现" },
    atmosphere: "tower-dark",
  }),
  floor(towerFloors[0], {
    roster: [
      [0, "gastly"],
      [0, "jigglypuff"],
      [0, "clefairy"],
      [0, "exeggcute"],
      [15, "kadabra"],
      [30, "haunter"],
      [45, "chansey"],
      [60, "grimer"],
      [75, "exeggutor"],
      [90, "golduck"],
      [105, "weezing"],
      [120, "wigglytuff"],
      [135, "venomoth"],
    ],
    beats: towerBeats(
      { kind: "swarm", species: ["gastly"], banner: "群体来袭" },
      { kind: "stampede", species: "clefairy", banner: "冲锋来袭" },
    ),
    guardian: { species: "alakazam", brain: "alakazam", banner: "胡地 出现" },
    atmosphere: "tower-hall",
  }),
  floor(towerFloors[1], {
    roster: [
      [0, "cubone"],
      [0, "haunter"],
      [0, "weezing"],
      [0, "zubat"],
      [15, "grimer"],
      [30, "kadabra"],
      [45, "wigglytuff"],
      [60, "arbok"],
      [75, "gastly"],
      [90, "chansey"],
      [105, "tangela"],
      [120, "vileplume"],
      [135, "exeggutor"],
    ],
    beats: towerBeats(
      { kind: "swarm", species: ["cubone"], banner: "群体来袭" },
      { kind: "stampede", species: "raticate", banner: "冲锋来袭" },
    ),
    guardian: { species: "marowak-ghost", brain: "marowak-ghost", banner: "嘎啦嘎啦之影 出现" },
    atmosphere: "tower-dark",
  }),
  floor(towerFloors[0], {
    roster: [
      [0, "haunter"],
      [0, "weezing"],
      [0, "grimer"],
      [0, "kadabra"],
      [15, "jynx"],
      [30, "wigglytuff"],
      [45, "gastly"],
      [60, "chansey"],
      [75, "exeggutor"],
      [90, "venomoth"],
      [105, "arbok"],
      [120, "golduck"],
      [135, "cubone"],
    ],
    beats: towerBeats(
      { kind: "swarm", species: ["gastly", "zubat"], banner: "群体来袭" },
      { kind: "stampede", species: "raticate", banner: "冲锋来袭" },
    ),
    guardian: { species: "gengar", brain: "gengar", banner: "耿鬼 出现" },
    atmosphere: "tower-roof",
  }),
] as const;

/** Every floor uses the ordinary zone preparation/commit; the last cleared floor wins. */
export const tower = {
  ...forest,
  id: "tower",
  name: "紫苑塔",
  duration: 300,
  zones,
  map: zones[0].map,
} as const satisfies StageDef<"tower">;
