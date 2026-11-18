import { ULT_CRISIS as C } from "../content/params/ultimates";
import type { Player } from "../state/entities";
import type { Ctx } from "../combat";
import { escaping } from "../encounters";
import { interrupted } from "../status";
import { CHEST } from "../content/params/combat";
import { sees } from "../sight";
import { heightAt } from "../terrain";
import { TICK } from "../state/world";

export interface CrisisCharge {
  startTick: number;
  spent: number;
  lastTick: number | null;
}

export const surroundCharge = (weight: number) =>
  Math.min(C.maxSurroundPerSecond, Math.max(0, weight - C.threshold) * C.perBody);

/** Shared by the model and host. Only credit that actually fits in the bar opens/spends a window. */
export function crisisCredit(
  state: CrisisCharge,
  tick: number,
  charge: number,
  requested: number,
): number {
  if (requested <= 0 || charge >= 1) return 0;
  if (state.lastTick === null || tick - state.startTick >= Math.round(C.windowSeconds / TICK)) {
    state.startTick = tick;
    state.spent = 0;
  }
  const gain = Math.min(requested, C.cap - state.spent, 1 - charge);
  if (gain > 0) {
    // Clamp: `spent + (cap - spent)` can round past the cap, which the snapshot check rejects.
    state.spent = Math.min(C.cap, state.spent + gain);
    state.lastTick = tick;
  }
  return gain;
}

function eligible(player: Player): boolean {
  return (
    player.alive &&
    !player.departed &&
    player.ult.elapsed < 0 &&
    player.ult.protection <= 0 &&
    player.ult.charge < 1
  );
}

export function creditHostileLoss(player: Player, tick: number, lost: number, maxHp: number): void {
  if (eligible(player))
    player.ult.charge += crisisCredit(
      player.crisis,
      tick,
      player.ult.charge,
      (lost / maxHp) * C.perHpBar,
    );
}

/** Shared-world step only: owners predict motion/casts but not hostile HP or enemy proximity. */
export function chargeSurrounded(ctx: Ctx, player: Player): void {
  const { world } = ctx;
  if (world.tick % Math.round(1 / TICK) !== 0 || !eligible(player)) return;
  const eye = heightAt(world.map.terrain, player.x, player.z) + CHEST;
  let weight = 0;
  ctx.grid.query(player.x, player.z, C.radius, (enemy) => {
    if (
      enemy.hp > 0 &&
      !escaping(world, enemy) &&
      !interrupted(enemy) &&
      (enemy.x - player.x) ** 2 + (enemy.z - player.z) ** 2 <= C.radius ** 2 &&
      sees(world, player.x, eye, player.z, enemy)
    ) {
      weight += enemy.boss ? C.guardianWeight : enemy.elite ? C.eliteWeight : 1;
    }
  });
  player.ult.charge += crisisCredit(
    player.crisis,
    world.tick,
    player.ult.charge,
    surroundCharge(weight),
  );
}
