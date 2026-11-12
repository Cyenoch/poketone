// Combat rules shared by every species and item: poise and stagger (poise.ts), contact and puddles
// (enemies.ts), the poison floor (status.ts) and trigger scaling (triggers/kit.ts, triggers/scaling.ts).
// Per-species poise is EnemyDef.poise (content/enemies.ts); status numbers are in content/statuses.ts.

/** Elites stand at least this firm, whatever their species. */
export const ELITE_POISE = 0.7;

/**
 * 僵直: a hit that moves an enemy at least `threshold` (knock × yield) cancels its wind-up and holds it
 * still for `time` seconds; then it cannot be staggered for `immune` seconds, so a multi-hit area
 * cannot lock it down. Attacks already under way (a lunge's dash and recovery, a stampede's charge, a
 * cast for `released` seconds while its shot or blast resolves: sim/skills/telegraph.ts sets the timer)
 * keep going; guardians never yield, so they are never staggered.
 */
export const STAGGER = { threshold: 1, time: 0.35, immune: 2, released: 0.1 } as const;

/** 敌人击退速度每秒衰减系数；每 tick 乘 max(0, 1 - KNOCK_DECAY × dt)。 */
export const KNOCK_DECAY = 9;

/** Seconds of `EnemyDef.contact`'s status a touch inflicts. */
export const CONTACT_SECONDS = 3;

/** Seconds a ground enemy stays wet after leaving a puddle. */
export const PUDDLE_WET = 2;

/** Drains (player poison) wear a player down to this HP and never finish them. */
export const DRAIN_FLOOR = 1;

/** A streak ends this many seconds after its last kill. */
export const STREAK_GAP = 2;

/** Proc damage grows with the player's level like ultimates' (+8% a level), so it keeps up with HP. */
export const PROC_LEVEL_GROWTH = 0.08;

/** Player shots and sight lines leave from this height above the ground. */
export const CHEST = 0.7;

/** Melee, close areas and contact only reach enemies standing within this height (under one terrace). */
export const REACH_STEP = 1.2;

/** How high flyers hover, × their scale. The view draws them at the same height (single source). */
export const FLYER_HOVER = 0.9;

/** A line may dip this far into the surface before terrain counts as in the way. */
export const GRAZE = 0.15;
