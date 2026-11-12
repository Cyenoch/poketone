// Timed triggers: strikes from above (electirizer, sun stone, old rod, lustrous orb), a mark on the
// strongest enemy (silph scope) and a status that spreads (burn heal).

import { find, has, targetable } from "../status";
import { statusEnemy } from "../combat";
import { chance } from "../rng";
import { hypot } from "../math";
import type { Enemy } from "../state/entities";
import { JACKPOT_RADIUS_MULTIPLIER, MARK_SECONDS } from "../content/params/trigger-runtime";
import type { TriggerRule } from "./index";
import { burst, drawEnemies, procDamage, strongest, visible } from "./kit";

/** Counts the timer down; true (and rewinds it by `every`) when it fires. Starts a full period in. */
function due(fx: Record<string, number>, key: string, every: number, dt: number): boolean {
  const timer = (fx[key] ?? every) - dt;
  fx[key] = timer;
  if (timer > 0) return false;
  fx[key] = timer + every;
  return true;
}

export const strike: TriggerRule<"strike"> = {
  hook: "tick",
  run(ctx, player, trigger, key, { dt }) {
    if (!due(player.fx, key, trigger.every, dt)) return;
    const { world } = ctx;
    const seen = visible(world, player, trigger.range);
    if (trigger.target === "self") {
      burst(ctx, player, player.x, player.z, trigger.radius, trigger.look, {
        type: trigger.type,
        dmg: procDamage(player, trigger.dmg),
        status: trigger.status,
        statusChance: trigger.statusChance,
        knock: trigger.knock,
      });
      return;
    }
    const targets =
      trigger.target === "strongest"
        ? [strongest(seen)].filter((e): e is Enemy => e !== undefined)
        : trigger.target === "nearest"
          ? seen
              .map((enemy) => ({ enemy, d: hypot(enemy.x - player.x, enemy.z - player.z) }))
              .sort((a, b) => a.d - b.d)
              .slice(0, trigger.count)
              .map(({ enemy }) => enemy)
          : drawEnemies(world.rng, seen, trigger.count);
    for (const target of targets) {
      const big =
        trigger.jackpot !== undefined && chance(world.rng, trigger.jackpot)
          ? (trigger.jackpotMult ?? 1)
          : 1;
      burst(
        ctx,
        player,
        target.x,
        target.z,
        trigger.radius * (big > 1 ? JACKPOT_RADIUS_MULTIPLIER : 1),
        trigger.look,
        {
          type: trigger.type,
          dmg: procDamage(player, trigger.dmg) * big,
          status: trigger.status,
          statusChance: trigger.statusChance,
          knock: trigger.knock,
        },
      );
    }
  },
};

export const markStrongest: TriggerRule<"markStrongest"> = {
  hook: "tick",
  run(ctx, player, trigger, key, { dt }) {
    if (!due(player.fx, key, trigger.every, dt)) return;
    const target = strongest(visible(ctx.world, player, trigger.range));
    if (target) statusEnemy(ctx, target, "marked", MARK_SECONDS, trigger.bonus, player);
  },
};

export const spreadStatus: TriggerRule<"spreadStatus"> = {
  hook: "tick",
  run(ctx, player, trigger, key, { dt }) {
    if (!due(player.fx, key, trigger.every, dt)) return;
    const carriers = ctx.world.enemies.filter(
      (enemy) =>
        enemy.hp > 0 &&
        targetable(enemy) &&
        has(enemy, trigger.status) &&
        hypot(enemy.x - player.x, enemy.z - player.z) <= trigger.range,
    );
    for (const carrier of carriers) {
      const source = find(carrier, trigger.status)!;
      let passed = 0;
      ctx.grid.query(carrier.x, carrier.z, trigger.radius + 1.4, (other) => {
        if (passed >= trigger.count || other === carrier || other.hp <= 0) return;
        if (has(other, trigger.status)) return;
        if (hypot(other.x - carrier.x, other.z - carrier.z) > trigger.radius) return;
        statusEnemy(ctx, other, trigger.status, source.time, source.power * trigger.share, player);
        passed += 1;
      });
    }
  },
};
