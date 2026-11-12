// Poise (韧性, docs/BALANCE.md 「韧性」): how much a body resists being moved and staggered. One rule
// for every push and pull — hit knockback, vortex and ultimate pulls, crowd separation — instead of
// boss / elite special cases. Status resistance (`StatusDef.bossScale`) is a separate rule.

import { enemies as enemyDefs, type EnemyDef } from "./content/enemies";
import type { Enemy } from "./state/entities";
import { ELITE_POISE, STAGGER } from "./content/params/combat";

/** Poise of a species as an elite, a guardian or a plain enemy (guardians never move). */
export function poiseOf(def: Pick<EnemyDef, "poise">, elite: boolean, boss: boolean): number {
  if (boss) return 1;
  return elite ? Math.max(def.poise, ELITE_POISE) : def.poise;
}

/** Share of a push or pull this enemy follows: 0 for a guardian, 1 for a featherweight. */
export function yieldTo(enemy: Enemy): number {
  return 1 - poiseOf(enemyDefs[enemy.species], enemy.elite, enemy.boss);
}

/** Held still and interrupted by a stagger (`interrupted` in sim/status.ts reads this). */
export const staggered = (enemy: Enemy) => enemy.stagger > STAGGER.immune;

/** Staggers `enemy` if a hit that moved it `knock` (after poise) is heavy enough and nothing stops it. */
export function staggerFrom(enemy: Enemy, knock: number): void {
  if (knock >= STAGGER.threshold) stagger(enemy);
}

/**
 * Starts a stagger unless the enemy is immune (its last one, or a released attack), charging, or mid
 * lunge; guardians never (poise 1). King's Rock's flinch (畏缩) is this same stagger, without the knock:
 * one timer, one interrupt, one immunity window.
 */
export function stagger(enemy: Enemy): boolean {
  if (enemy.boss || enemy.stagger > 0 || enemy.charge) return false;
  if (enemy.phase === "dash" || enemy.phase === "recover") return false;
  enemy.stagger = STAGGER.time + STAGGER.immune;
  return true;
}
