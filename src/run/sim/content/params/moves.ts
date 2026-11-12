// Caps on a move's derived numbers (attacks.ts moveParams) and a newly learned move's first cooldown.
// Per-move numbers (dmg, cd, area, count…) are in content/moves.ts; shapes in params/archetypes.ts.

/** Seconds: a non-fusion move never recasts faster than `minCd`, a fusion than `fusionMinCd` (reference 0.6). */
export const MOVE_LIMITS = { minCd: 0.15, fusionMinCd: 0.6, maxStatusChance: 0.95 } as const;

/** A newly learned move's first cast comes this many seconds after it is learned. */
export const NEW_MOVE_COOLDOWN = 0.4;

/** Seconds until another auto-cast attempt when no target was in range. */
export const MOVE_RETRY = 0.2;

/** Default auto-aim range in world units; specific move shapes may override it. */
export const TARGET_RANGE = 15;
/** Fraction of the half-screen: player casts only acquire enemies this far inside the screen. */
export const AIM_INSET = 0.08;
