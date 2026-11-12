// Homing and drain shots: a fan, one shot per target in range, then steered toward their target every
// tick. They still fly in 3D, so terrain and solid props stop them like any shot (sight.ts
// `stopAtCover`). Drain shots fly the same; their heal comes from `MoveDef.drain` on the hit.

import { HOMING } from "../content/params/archetypes";
import type { EnemyGrid } from "../grid";
import { enemyFeet, enemyHeight } from "../sight";
import { targetable } from "../status";
import type { Enemy, Projectile } from "../state/entities";
import type { World } from "../state/world";
import { acquire, aim, chestOf, pierce, projectile, rotate, type ArchetypeDef } from "./kit";
import { hypot3 } from "../math";

function retarget(grid: EnemyGrid, shot: Projectile): Enemy | undefined {
  let best: Enemy | undefined;
  let bestD = HOMING.retarget ** 2;
  grid.query(shot.x, shot.z, HOMING.retarget, (enemy) => {
    if (enemy.hp <= 0 || shot.hit.includes(enemy.id)) return;
    const d = (enemy.x - shot.x) ** 2 + (enemy.z - shot.z) ** 2;
    if (d < bestD) [best, bestD] = [enemy, d];
  });
  return best;
}

/** Turns the shot toward the middle of its target's body at constant speed. */
export function steer(world: World, grid: EnemyGrid, shot: Projectile, dt: number): void {
  let target = world.enemies.find(
    (enemy) => enemy.id === shot.target && enemy.hp > 0 && targetable(enemy),
  );
  if (!target) {
    target = retarget(grid, shot);
    shot.target = target?.id ?? -1;
    if (!target) return;
  }
  const dx = target.x - shot.x;
  const dy = enemyFeet(world.map.terrain, target) + enemyHeight(target) / 2 - shot.y;
  const dz = target.z - shot.z;
  const distance = hypot3(dx, dy, dz) || 1;
  const speed = hypot3(shot.vx, shot.vy, shot.vz);
  const k = Math.min(1, dt * HOMING.turn);
  const vx = shot.vx + ((dx / distance) * speed - shot.vx) * k;
  const vy = shot.vy + ((dy / distance) * speed - shot.vy) * k;
  const vz = shot.vz + ((dz / distance) * speed - shot.vz) * k;
  const scale = speed / (hypot3(vx, vy, vz) || 1);
  shot.vx = vx * scale;
  shot.vy = vy * scale;
  shot.vz = vz * scale;
}

export const homing: ArchetypeDef = {
  cast(ctx, player, def, p) {
    const { world } = ctx;
    const { terrain } = world.map;
    const eye = chestOf(terrain, player);
    const targets = acquire(world, player, p.count);
    if (targets.length === 0) return false;
    for (let i = 0; i < p.count; i++) {
      const target = targets[i % targets.length]!;
      const [dx, dz, rise] = aim(terrain, player, eye, target);
      const [rx, rz] = rotate(dx, dz, (i - (p.count - 1) / 2) * HOMING.spread);
      const shot = projectile(world, player, def, p, [rx, rz, rise], eye, i * HOMING.stagger);
      shot.target = target.id;
      world.projectiles.push(shot);
    }
    return true;
  },
  shot: {
    steer: (ctx, shot, dt) => steer(ctx.world, ctx.grid, shot, dt),
    land: pierce,
  },
};
