import type { LineDef } from "./index";

export const charmander = {
  id: "charmander",
  role: "烈焰突击",
  ability: "blaze",
  ultimate: "blast-burn",
  kit: ["ember", "fire-spin", "flamethrower", "fire-blast"],
  evolutionMoves: ["lava-plume", "will-o-wisp"],
  stages: [
    {
      kind: "evolve",
      at: 1,
      form: {
        id: "charmander",
        name: "小火龙",
        types: ["fire"],
        hp: 100,
        speed: 3.96,
        radius: 0.36,
        height: 1,
        ref: 4,
      },
    },
    {
      kind: "evolve",
      at: 28,
      form: {
        id: "charmeleon",
        name: "火恐龙",
        types: ["fire"],
        hp: 123,
        speed: 4.18,
        radius: 0.416,
        height: 1.24,
        ref: 5,
      },
    },
    {
      kind: "evolve",
      at: 55,
      form: {
        id: "charizard",
        name: "喷火龙",
        types: ["fire", "flying"],
        hp: 141,
        speed: 4.4,
        radius: 0.464,
        height: 1.6,
        ref: 6,
      },
    },
  ],
} as const satisfies LineDef<"charmander", string>;
