import type { LineDef } from "./index";

const traits = { normal: ["blaze"], hidden: "solar-power" } as const;

export const charmander = {
  id: "charmander",
  role: "烈焰突击",
  ultimate: "blast-burn",
  kit: ["ember", "fire-spin", "flamethrower", "fire-blast", "sunny-day", "fire-pledge"],
  evolutionMoves: ["lava-plume", "will-o-wisp"],
  megas: [
    {
      stone: "charizardite-x",
      form: {
        id: "charizard-x",
        name: "超级喷火龙Ｘ",
        abilities: { normal: ["tough-claws"] },
        types: ["fire", "dragon"],
        hp: 155,
        speed: 4.4,
        radius: 0.464,
        height: 1.6,
        ref: 6,
      },
      moves: ["flare-blitz", "dragon-rush"],
      modifiers: [{ stat: "armor", op: "add", value: 8 }],
    },
    {
      stone: "charizardite-y",
      form: {
        id: "charizard-y",
        name: "超级喷火龙Ｙ",
        abilities: { normal: ["drought"] },
        types: ["fire", "flying"],
        hp: 151,
        speed: 4.4,
        radius: 0.464,
        height: 1.6,
        ref: 6,
      },
      moves: ["solar-beam", "hurricane"],
      modifiers: [{ stat: "damage", op: "mul", value: 1.35, when: "special" }],
    },
  ],
  stages: [
    {
      kind: "evolve",
      at: 1,
      form: {
        id: "charmander",
        abilities: traits,
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
        abilities: traits,
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
        abilities: traits,
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
} as const satisfies LineDef<"charmander", string, string>;
