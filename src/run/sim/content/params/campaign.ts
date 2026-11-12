import type { StageId } from "../stages/index";

/** Seconds per field; one continuous field per map, including the tower. */
export const FIELD_SECONDS = { outdoor: 600, tower: 600 } as const;

/** HP-clock floors keep new-map bodies near the preceding field's late-game durability. */
export const CAMPAIGN_HP_CLOCK: Record<StageId, number> = {
  forest: 0,
  desert: 480,
  coast: 480,
  glacier: 480,
  volcano: 480,
  tower: 480,
};

/** Fixed route baselines, independent of a player's equipment or elapsed loading time. */
export const CAMPAIGN_GROWTH: Record<
  StageId,
  { hp: number; dmg: number; xp: number; guardian: number }
> = {
  forest: { hp: 0.8, dmg: 0.6, xp: 1, guardian: 0.24 },
  desert: { hp: 1.2, dmg: 0.8, xp: 1.1, guardian: 0.65 },
  coast: { hp: 2, dmg: 0.9, xp: 1.2, guardian: 1.6 },
  glacier: { hp: 3, dmg: 1, xp: 1.3, guardian: 2.2 },
  volcano: { hp: 4.5, dmg: 1.1, xp: 1.4, guardian: 3 },
  tower: { hp: 6.5, dmg: 1.1, xp: 1.5, guardian: 3.5 },
};
