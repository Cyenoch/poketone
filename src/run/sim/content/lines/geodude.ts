import type { LineDef } from "./index";

export const geodude = {
  id: "geodude",
  role: "重装岩崩",
  ability: "sturdy",
  ultimate: "rockslide-quake",
  kit: ["rock-throw", "rollout", "magnitude", "rock-slide"],
  evolutionMoves: ["earthquake", "stone-edge"],
  stages: [
    {
      kind: "evolve",
      at: 1,
      form: {
        id: "geodude",
        name: "小拳石",
        types: ["rock", "ground"],
        hp: 135,
        speed: 3.4,
        radius: 0.36,
        height: 1.0,
        ref: 74,
      },
    },
    {
      kind: "evolve",
      at: 28,
      form: {
        id: "graveler",
        name: "隆隆石",
        types: ["rock", "ground"],
        hp: 158,
        speed: 3.911,
        radius: 0.453,
        height: 1.257,
        ref: 75,
      },
    },
    {
      kind: "evolve",
      at: 54,
      form: {
        id: "golem",
        name: "隆隆岩",
        types: ["rock", "ground"],
        hp: 191,
        speed: 4.164,
        radius: 0.492,
        height: 1.368,
        ref: 76,
      },
    },
  ],
} as const satisfies LineDef<"geodude", string>;
