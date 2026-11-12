import type { LineDef } from "./index";

export const bulbasaur = {
  id: "bulbasaur",
  role: "持久治疗",
  ability: "photosynthesis",
  ultimate: "frenzy-plant",
  kit: ["vine-whip", "razor-leaf", "solar-beam", "sleep-powder"],
  evolutionMoves: ["giga-drain", "seed-bomb"],
  stages: [
    {
      kind: "evolve",
      at: 1,
      form: {
        id: "bulbasaur",
        name: "妙蛙种子",
        types: ["grass"],
        hp: 109,
        speed: 3.795,
        radius: 0.36,
        height: 1,
        ref: 1,
      },
    },
    {
      kind: "evolve",
      at: 28,
      form: {
        id: "ivysaur",
        name: "妙蛙草",
        types: ["grass"],
        hp: 126,
        speed: 4.07,
        radius: 0.392,
        height: 1.2,
        ref: 2,
      },
    },
    {
      kind: "evolve",
      at: 53,
      form: {
        id: "venusaur",
        name: "妙蛙花",
        types: ["grass"],
        hp: 145,
        speed: 4.345,
        radius: 0.472,
        height: 1.44,
        ref: 3,
      },
    },
  ],
} as const satisfies LineDef<"bulbasaur", string>;
