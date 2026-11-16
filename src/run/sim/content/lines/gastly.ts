import type { LineDef } from "./index";

export const gastly = {
  id: "gastly",
  role: "诅咒游击",
  ability: "shadow-shroud",
  ultimate: "phantom-night",
  kit: ["shadow-ball", "smog", "hex", "sludge-bomb"],
  evolutionMoves: ["night-shade", "dream-eater"],
  stages: [
    {
      kind: "evolve",
      at: 1,
      form: {
        id: "gastly",
        name: "鬼斯",
        types: ["ghost", "poison"],
        hp: 90,
        speed: 4.2,
        radius: 0.36,
        height: 1.0,
        ref: 92,
      },
    },
    {
      kind: "evolve",
      at: 28,
      form: {
        id: "haunter",
        name: "鬼斯通",
        types: ["ghost", "poison"],
        hp: 110,
        speed: 4.384,
        radius: 0.379,
        height: 1.053,
        ref: 93,
      },
    },
    {
      kind: "evolve",
      at: 54,
      form: {
        id: "gengar",
        name: "耿鬼",
        types: ["ghost", "poison"],
        hp: 127,
        speed: 4.548,
        radius: 0.373,
        height: 1.036,
        ref: 94,
      },
    },
  ],
} as const satisfies LineDef<"gastly", string>;
