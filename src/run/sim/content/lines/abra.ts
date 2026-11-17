import type { LineDef } from "./index";

export const abra = {
  id: "abra",
  role: "念力控场",
  ability: "synchronize",
  ultimate: "psychic-field",
  kit: ["confusion", "hypnosis", "psybeam", "psychic"],
  evolutionMoves: ["future-sight", "psyshock"],
  stages: [
    {
      kind: "evolve",
      at: 1,
      form: {
        id: "abra",
        name: "凯西",
        types: ["psychic"],
        hp: 85,
        speed: 4.4,
        radius: 0.36,
        height: 1.0,
        ref: 63,
      },
    },
    {
      kind: "evolve",
      at: 28,
      form: {
        id: "kadabra",
        name: "勇基拉",
        types: ["psychic"],
        hp: 108,
        speed: 4.573,
        radius: 0.395,
        height: 1.096,
        ref: 64,
      },
    },
    {
      kind: "evolve",
      at: 54,
      form: {
        id: "alakazam",
        name: "胡地",
        types: ["psychic"],
        hp: 126,
        speed: 4.728,
        radius: 0.409,
        height: 1.136,
        ref: 65,
      },
    },
  ],
} as const satisfies LineDef<"abra", string>;
