import type { MobilityProfile } from "../nav/profiles";

/**
 * The movement classes in play (docs/NAVIGATION.md). Every starter and walking enemy is `ground`;
 * `swim` lives in the sea (slopes under water never stop it), `amphibious` walks like ground but
 * wades any depth.
 * Measured on seeds 1–8: hillside slope cores reach 0.89 at p99 (0.93 max), terrace cliff faces
 * 0.95 at p5 (1.07 median). `climb` 0.92 keeps hillsides walkable and faces unclimbable; `drop`
 * 1.05 lets ground units walk down the gentler ~40% of faces, while sheer ones block both ways.
 */
export const mobilityClasses = {
  ground: { climb: 0.92, drop: 1.05 },
  flying: { climb: Infinity, drop: Infinity, flying: true },
  swim: { climb: Infinity, drop: Infinity, water: "swim" },
  amphibious: { climb: 0.92, drop: 1.05, water: "both" },
} as const satisfies Record<string, MobilityProfile>;
