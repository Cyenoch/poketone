// Shared pieces of the item triggers: proc damage, target picks and the area burst. Like the
// archetype kit, this only calls combat inside functions (sim/triggers/index.ts on load order).

import { chestOf } from "../archetypes/kit";
import { damageEnemy, type Ctx, type Hit } from "../combat";
import type { UltLook } from "../state/events";
import type { Enemy, Player } from "../state/entities";
import type { World } from "../state/world";
import { next, type Rng } from "../rng";
import { sees } from "../sight";
import { targetable } from "../status";
import { hypot } from "../math";
import { PROC_LEVEL_GROWTH } from "../content/params/combat";

export function procDamage(player: Player, base: number): number {
  return base * (1 + PROC_LEVEL_GROWTH * (player.level - 1));
}

/** Living enemies within `range` of the player that it can see, in `world.enemies` order. */
export function visible(world: World, player: Player, range: number): Enemy[] {
  const eye = chestOf(world.map.terrain, player);
  return world.enemies.filter(
    (enemy) =>
      enemy.hp > 0 &&
      targetable(enemy) &&
      hypot(enemy.x - player.x, enemy.z - player.z) <= range &&
      sees(world, player.x, eye, player.z, enemy),
  );
}

/** The enemy with the most HP (the first one on a tie). */
export function strongest(enemies: readonly Enemy[]): Enemy | undefined {
  let best: Enemy | undefined;
  for (const enemy of enemies) if (!best || enemy.hp > best.hp) best = enemy;
  return best;
}

/** `count` distinct enemies drawn from `enemies` with the world's rng. */
export function drawEnemies(rng: Rng, enemies: readonly Enemy[], count: number): Enemy[] {
  const pool = [...enemies];
  const out: Enemy[] = [];
  while (out.length < count && pool.length > 0)
    out.push(pool.splice(Math.floor(next(rng) * pool.length), 1)[0]!);
  return out;
}

export type BurstHit = Pick<Hit, "type" | "dmg" | "status" | "statusChance"> & { knock?: number };

/** An item burst at (x, z): every living enemy within `radius` of it (its body counted) takes `hit`. */
export function burst(
  ctx: Ctx,
  player: Player,
  x: number,
  z: number,
  radius: number,
  look: UltLook,
  hit: BurstHit,
): void {
  ctx.world.events.push({
    t: "item-burst",
    player: player.id,
    look,
    x,
    z,
    radius,
    dirX: 0,
    dirZ: 1,
    length: 0,
  });
  const struck: Enemy[] = [];
  ctx.grid.query(x, z, radius + 1.4, (enemy) => {
    if (enemy.hp > 0 && hypot(enemy.x - x, enemy.z - z) <= radius + enemy.radius)
      struck.push(enemy);
  });
  for (const enemy of struck)
    damageEnemy(ctx, enemy, {
      owner: player,
      move: null,
      crit: 0,
      knock: hit.knock ?? 0,
      fromX: x,
      fromZ: z,
      secondary: true,
      type: hit.type,
      dmg: hit.dmg,
      status: hit.status,
      statusChance: hit.statusChance,
    });
}
