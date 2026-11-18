import type { EnemyId } from "../enemies";

// [累计次数, 该档研究点]；每档只计一次，异色不占必需点数。
export const RESEARCH = {
  ordinary: researchTrack(400),
  elite: {
    seen: [
      [1, 2],
      [5, 2],
    ],
    defeated: [
      [1, 1.5],
      [3, 1.5],
      [10, 1.5],
      [25, 1.5],
    ],
    shiny: [],
  },
  guardian: {
    seen: [[1, 4]],
    defeated: [
      [1, 2],
      [3, 2],
      [6, 2],
    ],
    shiny: [],
  },
} as const;

// Ordinary species: 3 seen points and 7 defeat points, both finished at a per-species kill
// target, so completion never needs the shiny. `bun scripts/research-sample.mjs` projects the
// runs each target takes from simulated per-run kills (aim: 5-10 runs, never above 15).
export function researchTrack(top: number) {
  const seenTop = Math.min(50, top);
  const at = (share: number) => Math.round(top * share);
  return {
    seen: [
      [1, 1],
      [Math.round(seenTop / 5), 1],
      [seenTop, 1],
    ],
    defeated: [
      [1, 1],
      [at(0.1), 1],
      [at(0.25), 1],
      [at(0.5), 1],
      [at(0.75), 1],
      [top, 2],
    ],
    shiny: [[1, 3]],
  } as const;
}

/** Kill target per ordinary species, grouped by target; species kills per run come from the sampler. */
export const DEFEAT_TARGETS: Record<number, readonly EnemyId[]> = {
  16: ["seadra", "seaking", "electabuzz"],
  24: ["jolteon", "wigglytuff"],
  36: ["tentacool", "snorlax"],
  54: ["jynx"],
  80: ["tangela", "kabutops", "lickitung", "dragonair", "vaporeon"],
  120: ["nidorina", "exeggutor", "omastar", "rhydon", "kadabra", "hitmonchan", "flareon"],
  180: [
    "pidgey",
    "metapod",
    "kakuna",
    "butterfree",
    "beedrill",
    "tauros",
    "hitmonlee",
    "kabuto",
    "chansey",
    "poliwrath",
    "slowpoke",
  ],
  270: [
    "weedle",
    "vileplume",
    "electrode",
    "nidorino",
    "haunter",
    "dodrio",
    "rapidash",
    "omanyte",
    "magneton",
    "staryu",
    "grimer",
    "shellder",
    "dratini",
    "dugtrio",
    "ninetales",
  ],
  400: [
    "caterpie",
    "voltorb",
    "pidgeotto",
    "parasect",
    "poliwhirl",
    "primeape",
    "clefairy",
    "weezing",
    "doduo",
    "machop",
    "rhyhorn",
    "onix",
    "krabby",
    "golduck",
    "jigglypuff",
    "seel",
  ],
  600: [
    "oddish",
    "paras",
    "venonat",
    "nidoran-f",
    "nidoran-m",
    "gloom",
    "arbok",
    "venomoth",
    "golem",
    "mankey",
    "magnemite",
    "ponyta",
  ],
  900: [
    "ekans",
    "vulpix",
    "growlithe",
    "raticate",
    "fearow",
    "graveler",
    "poliwag",
    "sandshrew",
    "psyduck",
    "exeggcute",
    "gastly",
    "koffing",
    "meowth",
    "cubone",
  ],
  1400: ["rattata", "spearow", "zubat", "geodude", "diglett"],
};
export const FISHING_RESEARCH = {
  seen: [
    [1, 1],
    [3, 1],
    [6, 1],
  ],
  defeated: [
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
    [6, 1],
    [8, 2],
  ],
  shiny: [[1, 3]],
} as const;
