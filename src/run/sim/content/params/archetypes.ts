// Player move shapes and fusion parts. Distances are world units, times seconds, angles radians,
// speeds units/s (lob gravity units/s²), damage/status shares dimensionless. Per-move base stats
// remain in content/moves.ts. Execution and geometry algorithms remain in archetypes/*.ts.

/** Plain projectile hit knockback; shared by bolt, barrage, homing and bloom's leaves. */
export const SHOT_KNOCK = 1.2;

/** A body this close to a sector's origin counts even outside its forward angle. */
export const SECTOR_CONTACT_PADDING = 0.6;

/** Shots sit `spread` apart, each nudged by up to ±`jitter`. */
export const BARRAGE = { spread: 0.16, jitter: 0.05, stagger: 0.07 } as const;

/** `reach`: full beam length before terrain clips it; `rearReach`: hit allowance behind its origin. */
export const BEAM = {
  tick: 0.15,
  delay: 0.3,
  range: 16,
  reach: 17,
  rearReach: 0.5,
  knock: 0.4,
} as const;

/** Sizes in world units at area growth 1 (× `Area.scale`), `*Dmg` shares of the cast's hit. */
export const BLOOM = {
  range: 16,
  /** Beam length before cover: short enough that the petal burst at its end lands on screen. */
  reach: 10,
  delay: 0.45,
  /** Beam life per second of `dur`. */
  life: 0.9,
  tick: 0.12,
  beamDmg: 0.15,
  beamChance: 0.15,
  leaves: 14,
  leavesPerCount: 4,
  leavesMax: 12,
  leafDmg: 0.6,
  leafSpeed: 10,
  leafLife: 0.6,
  leafRadius: 0.3,
  leafPierce: 2,
  flower: 2.6,
  flowerDmg: 2.5,
  flowerChance: 0.5,
  rearReach: 0.5,
  beamKnock: 0.4,
  /** Leaves originate in this fraction of the beam; forward bias tilts their sideways heading. */
  leafStart: 0.15,
  leafSpan: 0.85,
  leafForward: 0.25,
} as const;

/** Extra bolts beyond the targets in range fan out by this much each. */
export const BOLT = { fan: 0.22, stagger: 0.05 } as const;

export const BURST = { knock: 1.5 } as const;

/** Candidates considered for each next jump, including already struck bodies. */
export const CHAIN = { range: 10, candidates: 6 } as const;

/** `aimPadding`: how far beyond the hit's reach an enemy may trigger a cast. */
export const CONE = { tick: 0.2, angle: 0.55, aimPadding: 1, knock: 0.4 } as const;

/** Sizes in world units at area growth 1 (× `Area.scale`), `*Dmg` shares of the cast's hit. */
export const FIRESTORM = {
  range: 11,
  /** The vortex lands at most this far out, on the aimed enemy. */
  reach: 6,
  delay: 0.3,
  tick: 0.25,
  vortexDmg: 0.22,
  /** The vortex radius grows by this share over its life (reference 2.4 → 4.0 R). */
  growth: 0.65,
  jetFor: 0.9,
  jetTick: 0.1,
  jetDmg: 0.3,
  jetChance: 0.15,
  jetWidth: 0.6,
  spiralTick: 0.2,
  arms: 3,
  /** Spiral flames land this far beyond the rim, hitting a disc of `spiralRadius`. */
  spiralReach: 1.3,
  spiralRadius: 1.1,
  spiralDmg: 0.25,
  spiralChance: 0.3,
  blast: 2.2,
  blastDmg: 1.8,
  blastChance: 0.8,
  /** Radians/s of the spiral hit pattern. */
  spiralSpin: 4,
  jetKnock: 0.4,
  spiralKnock: 1,
} as const;

/** `turn`: share of the gap to the wanted heading closed per second; `retarget`: search radius when the target dies. */
export const HOMING = { turn: 7, spread: 0.9, retarget: 6, stagger: 0.05 } as const;

/** Seconds in the air (any distance), fall acceleration, aim range, scatter of spare shells, shell radius. */
export const LOB = {
  flight: 0.75,
  gravity: 22,
  range: 13,
  scatter: 1.5,
  shell: 0.25,
  /** Extra lifetime for a shell falling beyond a ledge. */
  fallGrace: 0.5,
} as const;

export const NOVA = { knock: 1.5 } as const;

/** Body radius in flight; the burst uses the move's area. */
export const ORB = { radius: 0.3 } as const;

/** Sizes in world units at area growth 1 (× `Area.scale`), `*Dmg` shares of the cast's hit. */
export const ROD = {
  range: 13,
  min: 3,
  max: 8,
  flight: 0.35,
  height: 3,
  tick: 0.32,
  bolts: 3,
  boltsMax: 4,
  boltDmg: 0.45,
  blast: 2,
  blastDmg: 1.6,
  blastChance: 0.6,
  boltKnock: 0.4,
} as const;

export const SMITE = { range: 13, knock: 1.5 } as const;

/** `aimPadding`: how far beyond the hit's reach an enemy may trigger a cast. */
export const SPIN = { tick: 0.3, aimPadding: 2, knock: 1.2 } as const;

/** Sizes in world units at area growth 1 (× `Area.scale`), `*Dmg` shares of the cast's hit. */
export const SPRINKLER = {
  /** Fires when enemies are this close to the jets' reach. */
  range: 1,
  shell: 1.6,
  shellDmg: 0.6,
  shellKnock: 2.5,
  jets: 2,
  jetsMax: 2,
  /** Radians per second. */
  spin: 4.2,
  jetTick: 0.1,
  jetDmg: 0.2,
  jetWidth: 0.45,
  jetKnock: 1.2,
  splash: 2,
  splashDmg: 0.7,
  splashChance: 1,
} as const;

export const STRIKE = {
  angle: 1.2,
  swing: 0.22,
  stagger: 0.12,
  aimPadding: 1,
  knock: 1.5,
} as const;

/**
 * `pull`: the vortex drags enemies in from this many radii away at `drag` units / s (times the enemy's
 * yield, sim/poise.ts); `burst`: the collapse's share of a tick.
 */
export const VORTEX = {
  tick: 0.3,
  delay: 0.25,
  burst: 1.8,
  range: 11,
  pull: 2,
  drag: 3,
  /** Pulling stops this far from the centre. */
  pullStop: 0.3,
  knock: 0.4,
} as const;

/** Crest height over the ground, band depth (half, along travel), fan between extra waves, knock. */
export const WAVE = { crest: 0.5, depth: 0.5, fan: 0.5, knock: 2 } as const;
