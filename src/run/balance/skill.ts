// Player skill as explicit parameter sets, so the model reports a band instead of baking one
// behaviour into its coefficients. Rationale and how to refit each profile: docs/BALANCE.md.

/** How level-up and chest cards are chosen. */
export interface PickPolicy {
  /** Take any card of this kind when offered (the bot always takes a new move). */
  prefer: "move" | "item" | null;
  /** Otherwise the best card by the model's value with this probability, else a random one. */
  greedy: number;
}

export interface SkillProfile {
  name: string;
  /** Contact exposure: hits/s ≈ i-frame ceiling × (1 − e^(−contact × √crowd × speed ratio)). */
  contact: number;
  /**
   * Share of dodgeable hazards avoided: oddish spores; guardian dash and Air Slash; the swarm's
   * telegraphed dives, rolls, acid, stun spore and psybeam (shorter warnings than a slow spore).
   */
  dodge: { spore: number; boss: number; telegraph: number };
  /** Share of dropped candy collected at the base pickup radius (Magnet closes the gap). */
  pickup: number;
  /** Share of elite chests opened. */
  chests: number;
  /** Share of time a short-reach move (strike, cone, spin) has an enemy inside its reach. */
  melee: number;
  /** Share of the living enemies inside the fight (a kiter who outruns the swarm leaves some behind). */
  engage: number;
  /** Crowd compaction: local density = clump × living / field area (kiting clumps the swarm). */
  clump: number;
  /** Mean contact hits per catch (being cornered): deaths come from catches longer than HP allows. */
  burst: number;
  /** Share of would-be contact hits a dash escapes (at most one per dash cooldown). */
  dash: number;
  /** Share of output that lands on the guardian while it is up (the rest hits nearer trash). */
  bossFocus: number;
  picks: PickPolicy;
}

/**
 * Fitted to the balance bot (`pnpm balance 0 8`, docs/BALANCE.md "校准"): a lower bound on human
 * play. It flees more than it fights, never reads the guardian's dash line, picks new moves blindly.
 */
export const novice: SkillProfile = {
  name: "novice",
  engage: 0.5,
  clump: 0.4,
  contact: 0.006,
  burst: 10,
  dodge: { spore: 0.98, boss: 0.55, telegraph: 0.96 },
  dash: 0.25,
  pickup: 0.6,
  chests: 0.8,
  melee: 0.55,
  bossFocus: 0.55,
  picks: { prefer: "move", greedy: 0 },
};

/**
 * Placeholder one step up from the bot: fights a little more, reads the dash line, picks cards by
 * value about half the time. Refit from playtests and telemetry (docs/BALANCE.md).
 */
export const average: SkillProfile = {
  name: "average",
  engage: 0.55,
  clump: 0.5,
  contact: 0.005,
  burst: 7,
  dodge: { spore: 0.99, boss: 0.7, telegraph: 0.97 },
  dash: 0.4,
  pickup: 0.7,
  chests: 0.9,
  melee: 0.65,
  bossFocus: 0.65,
  picks: { prefer: null, greedy: 0.5 },
};

/** Headroom estimate: a strong player on the same numbers. Normal should still ask something here. */
export const expert: SkillProfile = {
  name: "expert",
  engage: 0.65,
  clump: 0.7,
  contact: 0.0035,
  burst: 4,
  dodge: { spore: 0.995, boss: 0.85, telegraph: 0.985 },
  dash: 0.6,
  pickup: 0.85,
  chests: 1,
  melee: 0.8,
  bossFocus: 0.85,
  picks: { prefer: null, greedy: 1 },
};

export const profiles = [novice, average, expert] as const;

/** Named build archetypes, played with the `average` skill as scenarios. */
export const scenarios: readonly { name: string; picks: PickPolicy }[] = [
  { name: "moves first", picks: { prefer: "move", greedy: 1 } },
  { name: "items first", picks: { prefer: "item", greedy: 1 } },
  { name: "best value", picks: { prefer: null, greedy: 1 } },
];
