// Stage pacing: how fast the player levels and how the swarm grows, spawns and rampages over a run.
// Formulas that read these stay in stats.ts (xpForLevel) and director.ts (enemyScaling, bossHp,
// spawnRate, liveCap). Minutes m =
// seconds / 60. Tuned with the balance model (docs/BALANCE.md「节奏」).

/**
 * XP to go from level L to L + 1 is XP_STEP × (L + 1), so reaching level L takes 5 (L − 1)(L + 2) in
 * all. Fitted with the balance model and the bot (docs/BALANCE.md 「节奏」): XP income grows with the
 * spawn curve, so a straight line already slows the early levels most. Moving it also moves
 * evolution (lines/*) and the signature gates (cards.ts).
 */
export const XP_STEP = 10;

/**
 * Swarm HP multiplier over minutes m: 1 + `perMinute` × m + `late` × (m − `lateFrom`)² past `lateFrom`,
 * then × the difficulty's `hp`. Fitted with the balance model to the player's power at each minute.
 */
export const HP_CURVE = { perMinute: 0.15, lateFrom: 1.5, late: 0.06 };

/**
 * Enemy-only durability, above HP_CURVE: +earlyGain by earlySeconds, then +lateGain by
 * lateSeconds. Partners still use HP_CURVE alone. Seconds follow the zone's HP clock.
 */
export const ENEMY_HEALTH = {
  earlySeconds: 120,
  earlyGain: 0.2,
  lateSeconds: 480,
  lateGain: 0.15,
};
/** 头目 alone receives this factor above a same-species elite; rewards and damage do not change. */
export const ALPHA_HP = 1.5;
/** Independent guardian adjustment; does not receive ENEMY_HEALTH or ALPHA_HP. */
export const GUARDIAN_HP = 1.3;
/** Fixed calibration second for guardian HP, damage and speed; never a summon requirement. */
export const GUARDIAN_REFERENCE_SECONDS = 510;

/**
 * Swarm damage multiplier 1 + `dmgPerMinute` × m and speed multiplier min(`speedMax`, 1 +
 * `speedPerMinute` × m), each then × the difficulty's `dmg` / `speed`.
 */
export const SWARM_GROWTH = { dmgPerMinute: 0.13, speedPerMinute: 0.02, speedMax: 1.3 };

/**
 * The guardian's own HP multiplier at GUARDIAN_REFERENCE_SECONDS, independent of summon time.
 * Damage and speed use SWARM_GROWTH at the same reference; map/difficulty/team apply separately.
 */
export const GUARDIAN_HP_CURVE = { perMinute: 0.3 };

/** Spawn credits per second (one credit = one enemy): `base` + `perMinute` × m + `late` × m², × `amount`. */
export const SPAWN_CURVE = { base: 1.1, perMinute: 0.3, late: 0.035 };

/**
 * Living enemies above which the director stops spawning:
 * min(`max`, (`base` + `perMinute` × m) × (1 + (amount − 1) × `amountWeight`)).
 */
export const LIVE_CAP = { max: 280, base: 60, perMinute: 16, amountWeight: 0.5 };

/** Unspent spawn credit carried between ticks is capped here, so a full field doesn't bank a burst. */
export const SPAWN_CREDIT_MAX = 8;

/**
 * Ordinary reinforcements only. Nearby bodies contribute 1 − distance²/radius²; elites weigh more.
 * Recent hits decay over hitMemory seconds, weighted from half at full HP to full at zero HP.
 * Pressure is smoothed (seconds), then moves spawn supply within the stated bounds. It never
 * changes enemy stats, the live cap, timeline beats, guardian fights or rampages.
 */
export const DIRECTOR_PRESSURE = {
  radius: 10,
  bodies: 12,
  eliteWeight: 2,
  hitMemory: 8,
  riseSeconds: 2,
  fallSeconds: 8,
  minSupply: 0.75,
  maxSupply: 1.15,
  openingSeconds: 60,
  zoneGraceSeconds: 20,
  blendSeconds: 30,
} as const;

/** Swarm spawns land this far (u) from their anchor player; the guardian on its own ring. */
export const SPAWN_RING = { min: 18, max: 24 } as const;
export const GUARDIAN_RING = { min: 16, max: 18 } as const;
/** Summoned guardian's distance (u) from the landmark, away from the summoning player. */
export const GUARDIAN_SUMMON_DISTANCE = 3;
/** Stampede positions: lateral spacing and depth between three staggered rows (u). */
export const STAMPEDE_FORMATION = { lateral: 1.3, rows: 3, depth: 1.5 } as const;

/**
 * Past the stage's `duration` with the guardian alive: swarm HP and damage double this many times a
 * minute, and spawn credits come `spawns` × as fast.
 */
export const RAMPAGE = { hpDoublings: 2, dmgDoublings: 1, spawns: 2 } as const;

/** Elite (alpha, elite-wave and random elite) multipliers over the species' scaled stats. */
export const ELITE = { hp: 8, dmg: 1.6, speed: 0.85, xp: 12 } as const;
/** An elite's body (radius and model scale) is this many times its species'. */
export const ELITE_BODY = 1.9;

/**
 * Timeline beats (beats.ts): swarm ring size before the difficulty's `amount`; stampede runners;
 * elites per elite wave.
 */
export const SWARM_SIZE = 26;
export const STAMPEDE_SIZE = 18;
export const ELITE_WAVE_SIZE = 3;
/** Stampede runners run this much faster until they leave the arena or terrain stops them. */
export const STAMPEDE_SPEEDUP = 2.2;

/**
 * Beat spawn distances (u) from their anchor player: an alpha and each elite-wave elite on a ring, a
 * swarm evenly round a circle, a stampede herd starting this far behind (rows 1.5 apart).
 */
export const BEAT_RINGS = {
  alpha: { min: 15, max: 18 },
  eliteWave: { min: 16, max: 20 },
  swarm: 13,
  stampede: 22,
} as const;
