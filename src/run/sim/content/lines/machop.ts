import type { LineDef } from "./index";

export const machop = {
  id: "machop",
  role: "近身连打",
  ability: "guts",
  ultimate: "seismic-barrage",
  kit: ["karate-chop", "low-sweep", "brick-break", "focus-blast"],
  evolutionMoves: ["seismic-toss", "cross-chop"],
  stages: [
    {
      kind: "evolve",
      at: 1,
      form: {
        id: "machop",
        name: "腕力",
        types: ["fighting"],
        hp: 125,
        speed: 3.6,
        radius: 0.36,
        height: 1.0,
        ref: 66,
      },
    },
    {
      kind: "evolve",
      at: 28,
      form: {
        id: "machoke",
        name: "豪力",
        types: ["fighting"],
        hp: 134,
        speed: 3.833,
        radius: 0.421,
        height: 1.17,
        ref: 67,
      },
    },
    {
      kind: "evolve",
      at: 54,
      form: {
        id: "machamp",
        name: "怪力",
        types: ["fighting"],
        hp: 142,
        speed: 4.031,
        radius: 0.428,
        height: 1.189,
        ref: 68,
      },
    },
  ],
} as const satisfies LineDef<"machop", string>;
