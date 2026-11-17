import type { MarkerId, ModifierId } from "../../state/route";

export const MARKER_WEIGHTS = {
  chests: 3,
  "elite-nest": 2,
  pokecenter: 2,
  research: 2,
  "gengar-deal": 1,
} as const satisfies Record<MarkerId, number>;

export const MODIFIER_WEIGHTS = {
  "dark-cave": 1,
  fog: 1,
  "boss-sighting": 1,
} as const satisfies Record<ModifierId, number>;

export const ROUTE_REWARD = {
  modifierChance: [0, 0.25, 0.4, 0],
  chests: 3,
  nestRate: 2,
  nestChests: 2,
  researchRate: 2,
  sightingRate: 1.6,
  sightingHp: 1.15,
  lightRadius: 9,
  brightRadius: 14,
  tradeHp: 0.85,
} as const;
