// Ultimates (ultimates/index.ts): charge, damage and the invulnerability on firing. Each line's pulse
// timeline (where, when and `mul` per pulse) is in content/ultimates.ts.

/**
 * Charge per second from time alone, and from damage: each hit turns (HP removed / max HP) × the
 * enemy's XP worth into `perXp` charge, drawn from a budget that refills at `room` per second, so a
 * late build can't spam it. Fitted with the balance model to ~60–90 s per use (docs/BALANCE.md 终极技).
 */
export const ULT_CHARGE = { time: 1 / 210, perXp: 0.004, room: 0.01 } as const;
/** Base damage per pulse (× pulse `mul`), growing with level and tier like the reference. */
export const ULT_DMG = { base: 30, perLevel: 0.1, tier: [1, 1.15, 1.3] } as const;
/** Seconds of invulnerability from firing an ultimate. */
export const ULT_INVULNERABLE = 1;

/** Initial aim range in world units. */
export const ULT_AIM_RANGE = 15;
/** Burning spots must be in the cast's line of fire at this height above their ground. */
export const SPOT_LIFT = 0.3;
/** Sky strikes try this many random candidates for one with a line of sight; affects RNG consumption. */
export const STRIKE_TRIES = 6;
/** Pull search reach as a multiple of the pulse radius, and stopping distance in world units. */
export const ULT_PULL = { reach: 1.5, stop: 0.4 } as const;
