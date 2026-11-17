/** Seconds per field; one continuous field per map, including the tower. */
export const FIELD_SECONDS = { outdoor: 600, tower: 600 } as const;

/** Reach of the exit a fallen guardian opens, and the rings searched for walkable ground around its fall. */
export const EXIT_RADIUS = 2.4;
export const EXIT_SEARCH = { rings: 12, step: 1, branchRadius: 6, extraChance: 0.25 } as const;

/** Seconds added to swarm and partner growth after entering each map. */
export const ROUTE_ENTRY_CLOCK = [0, 480, 480, 480] as const;

/** Seconds to blend in the map's entry clock. */
export const ENTRY_RAMP_SECONDS = 8;

/** Fixed route baselines, independent of a player's equipment or elapsed loading time. */
export const ROUTE_GROWTH = [
  { hp: 0.8, dmg: 0.6, xp: 1, guardian: 0.24 },
  { hp: 1.13, dmg: 0.75, xp: 1, guardian: 0.78 },
  { hp: 2.475, dmg: 0.9, xp: 1.65, guardian: 1.725 },
  { hp: 6.5, dmg: 1.1, xp: 1.5, guardian: 3.5 },
] as const;
