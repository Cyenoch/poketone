// Trainer support in the analytical model (docs/BALANCE.md「训练师」): each assist item enters as its
// average benefit over the cooldown, as if the item were thrown the moment it is ready, so the
// timed buffs become duty-weighted stats. Players choose their moment, so the item is worth
// somewhat more than this average at the guardian; the model keeps the unbiased average.
import { TRAINER } from "../sim/content/params/trainers";
import { statuses } from "../sim/content/statuses";
import { trainerKits, type TrainerId } from "../sim/content/trainers";
import type { PlayerStats } from "../sim/stats";

/** Share of the time a buff of `seconds` is up when thrown on every cooldown. */
const duty = (seconds: number) => Math.min(1, seconds / TRAINER.cooldown);

/** Folds the trainer's item and numeric passive into the stats of one measurement. */
export function applyTrainer(stats: PlayerStats, trainer: TrainerId): void {
  const { assist, passive } = trainerKits[trainer];
  if (assist === "xSpeed") {
    const up = duty(TRAINER.xSpeed.seconds);
    stats.speed *= 1 + (TRAINER.xSpeed.movement - 1) * up;
    stats.cooldown /= 1 + (TRAINER.xSpeed.attackRate - 1) * up;
  } else if (assist === "direHit") {
    stats.crit += duty(TRAINER.direHit.seconds) * (1 - Math.min(1, stats.crit));
  } else if (assist === "superPotion") {
    // Co-op teammates in reach are healed too; the single-player model counts only the owner.
    stats.regen += (stats.maxHp * TRAINER.superPotion.hp) / TRAINER.cooldown;
  }
  if (passive === "caretaker") {
    stats.partnerDamage *= TRAINER.caretaker.damage;
    stats.partnerRate /= TRAINER.caretaker.interval;
  }
}

/**
 * 万灵药: share of the poison drain it removes. The immunity window is fully covered, and the cure
 * ends the running episode (half a poison duration left on average). Slow and the other statuses are
 * not in the player's HP model and are left out.
 */
export function assistPoisonCover(trainer: TrainerId): number {
  if (trainerKits[trainer].assist !== "fullHeal") return 0;
  return Math.min(1, (TRAINER.fullHeal.seconds + statuses.poison.duration / 2) / TRAINER.cooldown);
}
