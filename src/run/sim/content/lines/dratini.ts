import type { LineDef } from "./index";

export const dratini = {
  id: "dratini",
  role: "蓄势贯穿",
  ability: "dragon-scale",
  ultimate: "draco-meteor",
  kit: ["dragon-breath", "twister", "dragon-pulse", "dragon-rush"],
  evolutionMoves: ["aqua-tail", "hurricane"],
  stages: [
    {
      kind: "evolve",
      at: 1,
      form: {
        id: "dratini",
        name: "迷你龙",
        types: ["dragon"],
        hp: 103,
        speed: 3.9,
        radius: 0.36,
        height: 1.0,
        ref: 147,
      },
    },
    {
      kind: "evolve",
      at: 32,
      form: {
        id: "dragonair",
        name: "哈克龙",
        types: ["dragon"],
        hp: 126,
        speed: 4.242,
        radius: 0.44,
        height: 1.221,
        ref: 148,
      },
    },
    {
      kind: "evolve",
      at: 60,
      form: {
        id: "dragonite",
        name: "快龙",
        types: ["dragon", "flying"],
        hp: 153,
        speed: 4.386,
        radius: 0.379,
        height: 1.051,
        ref: 149,
      },
    },
  ],
} as const satisfies LineDef<"dratini", string>;
