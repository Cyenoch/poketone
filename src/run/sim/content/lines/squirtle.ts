import type { LineDef } from "./index";

export const squirtle = {
  id: "squirtle",
  role: "坚壳防御",
  ability: "torrent-shell",
  ultimate: "hydro-cannon",
  kit: ["water-gun", "bubble", "hydro-pump", "rapid-spin"],
  evolutionMoves: ["surf", "whirlpool"],
  stages: [
    {
      kind: "evolve",
      at: 1,
      form: {
        id: "squirtle",
        name: "杰尼龟",
        types: ["water"],
        hp: 95,
        speed: 3.685,
        radius: 0.36,
        height: 1,
        ref: 7,
      },
    },
    {
      kind: "evolve",
      at: 28,
      form: {
        id: "wartortle",
        name: "卡咪龟",
        types: ["water"],
        hp: 110,
        speed: 3.96,
        radius: 0.432,
        height: 1.2,
        ref: 8,
      },
    },
    {
      kind: "evolve",
      at: 55,
      form: {
        id: "blastoise",
        name: "水箭龟",
        types: ["water"],
        hp: 127,
        speed: 4.29,
        radius: 0.48,
        height: 1.48,
        ref: 9,
      },
    },
  ],
} as const satisfies LineDef<"squirtle", string>;
