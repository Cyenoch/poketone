// Element reactions: a hit of `trigger` type on an enemy carrying `primed`. Checked in key order and
// the first match wins; reaction follow-up hits never react again. Display names: run/labels.ts.

import type { ElementType } from "./elements";
import type { EnemyStatusId } from "./statuses";

export type ReactionEffect =
  /** Up to `limit` neighbours within `radius` take `share` of the hit. */
  | { kind: "splash"; share: number; radius: number; limit: number }
  /** Like splash, and the primed status' remaining damage (power × seconds left) adds to the hit and to each neighbour's share. */
  | { kind: "detonate"; share: number; radius: number; limit: number }
  /** Every neighbour within `radius` catches the primed status at its power, for `time` seconds. */
  | { kind: "spread"; radius: number; time: number };

export interface ReactionDef {
  primed: EnemyStatusId;
  trigger: ElementType;
  /** The reaction ends the primed status. */
  consume: boolean;
  /** Extra damage on the triggering hit, as a share of it. */
  bonus: number;
  effect: ReactionEffect;
}

const table = {
  shock: {
    primed: "wet",
    trigger: "electric",
    consume: true,
    bonus: 0.6,
    effect: { kind: "splash", share: 0.5, radius: 3.5, limit: 3 },
  },
  steam: {
    primed: "burn",
    trigger: "water",
    consume: true,
    bonus: 0,
    effect: { kind: "detonate", share: 0.8, radius: 2.8, limit: 8 },
  },
  wildfire: {
    primed: "burn",
    trigger: "grass",
    consume: false,
    bonus: 0.25,
    effect: { kind: "spread", radius: 2.8, time: 3 },
  },
} as const satisfies Record<string, ReactionDef>;

export type ReactionId = keyof typeof table;
export const reactions = table;
export const reactionIds = Object.keys(table) as ReactionId[];
