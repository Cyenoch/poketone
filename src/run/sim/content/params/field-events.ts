/** Shared inputs for field simulation and the analytical event budget. */
export const FIELD_EVENTS = {
  window: [260, 340] as const,
  beatSpread: 20,
  hordeCount: 5,
  outbreak: { seconds: 60, weight: 4, xp: 1.5, shiny: 4 },
};

export const WEATHER = { forecast: 5, seconds: 75, chip: 0.015, guardianChip: 0.5 };

export const SHINY = {
  chance: 1 / 400,
  hp: 3,
  escape: 25,
  stardust: 100,
  /** Edge sampling and bounded A* attempts, performed once per escaping encounter. */
  edgeStep: 8,
  pathTries: 8,
};
