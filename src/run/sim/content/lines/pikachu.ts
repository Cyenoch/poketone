import type { LineDef } from "./index";

export const pikachu = {
  id: "pikachu",
  role: "迅捷游击",
  ability: "static",
  ultimate: "volt-tackle",
  kit: ["thunder-shock", "electro-ball", "thunderbolt", "thunder"],
  evolutionMoves: ["discharge", "shock-wave"],
  stages: [
    {
      kind: "evolve",
      at: 1,
      form: {
        id: "pikachu",
        name: "皮卡丘",
        types: ["electric"],
        hp: 96,
        speed: 4.4,
        radius: 0.36,
        height: 1,
        ref: 25,
      },
    },
    { kind: "mature", at: 28 },
    {
      kind: "evolve",
      at: 54,
      form: {
        id: "raichu",
        name: "雷丘",
        types: ["electric"],
        hp: 125,
        speed: 4.62,
        radius: 0.432,
        height: 1.24,
        ref: 26,
      },
    },
  ],
} as const satisfies LineDef<"pikachu", string>;
