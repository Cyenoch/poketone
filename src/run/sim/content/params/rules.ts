import { ALPHA_HP } from "./pacing";
import { SITE } from "./sites";

export const RULE_DANGER = {
  nuzlocke: 3,
  "level-cap": 2,
  "no-items": 3,
  "mono-type": 2,
  "alpha-elites": 2,
  "wild-weather": 1,
} as const;

export const LEVEL_CAP = [22, 42, 60, 76] as const;
export const CAP_STARDUST_RATE = 0.005;
export const DANGER_STARDUST = 0.1;
export const CHALLENGE_ALPHA = { hp: ALPHA_HP, damage: 1.15, body: 1.1 } as const;
export const WEATHER_EVENT_WEIGHT = 2;
export const HELD_ITEM_STARDUST = SITE.rewards.ballStardust;
