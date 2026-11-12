// Waves: a wide band that rolls out along the ground and shoves what it washes over. Each lane of
// the band is a straight run from the cast line at crest height, so a ridge or a solid prop on that
// lane shelters the enemy behind it while the rest of the wave rolls on.

import { WAVE } from "../content/params/archetypes";
import { damageEnemy } from "../combat";
import type { EnemyGrid } from "../grid";
import { lineOfFire } from "../sight";
import { heightAt } from "../terrain";
import type { Enemy, Projectile } from "../state/entities";
import type { World } from "../state/world";
import { acquire, aim, chestOf, hitFrom, projectile, rotate, type ArchetypeDef } from "./kit";
import { hypot } from "../math";

/** Rides the shot on the ground and returns the enemies its band reaches this tick (each once). */
export function wash(world: World, grid: EnemyGrid, shot: Projectile): Enemy[] {
  const { terrain } = world.map;
  shot.y = heightAt(terrain, shot.x, shot.z) + WAVE.crest;
  const speed = hypot(shot.vx, shot.vz) || 1;
  const dirX = shot.vx / speed;
  const dirZ = shot.vz / speed;
  const travelled = speed * (shot.dur - shot.life);
  const struck: Enemy[] = [];
  grid.query(shot.x, shot.z, shot.radius + 1.4, (enemy) => {
    if (enemy.hp <= 0 || shot.hit.includes(enemy.id)) return;
    const ox = enemy.x - shot.x;
    const oz = enemy.z - shot.z;
    const along = ox * dirX + oz * dirZ;
    if (Math.abs(along) > WAVE.depth + enemy.radius) return;
    if (Math.abs(ox * dirZ - oz * dirX) > shot.radius + enemy.radius) return;
    const back = travelled + along;
    const sx = enemy.x - dirX * back;
    const sz = enemy.z - dirZ * back;
    const from = heightAt(terrain, sx, sz) + WAVE.crest;
    const to = heightAt(terrain, enemy.x, enemy.z) + WAVE.crest;
    if (!lineOfFire(world, sx, from, sz, enemy.x, to, enemy.z)) return;
    shot.hit.push(enemy.id);
    struck.push(enemy);
  });
  return struck;
}

export const wave: ArchetypeDef = {
  heavy: true,
  cast(ctx, player, def, p) {
    const { world } = ctx;
    const { terrain } = world.map;
    const eye = chestOf(terrain, player);
    const [target] = acquire(world, player, 1, p.speed * p.dur);
    if (!target) return false;
    const [dx, dz] = aim(terrain, player, eye, target);
    const crest = heightAt(terrain, player.x, player.z) + WAVE.crest;
    for (let i = 0; i < p.count; i++) {
      const [rx, rz] = rotate(dx, dz, (i - (p.count - 1) / 2) * WAVE.fan);
      world.projectiles.push(projectile(world, player, def, p, [rx, rz, 0], crest, 0));
    }
    return true;
  },
  shot: {
    land(ctx, shot, owner, def) {
      // Knocked along the wave's travel, not away from its centre.
      for (const enemy of wash(ctx.world, ctx.grid, shot))
        damageEnemy(
          ctx,
          enemy,
          hitFrom(owner, def, shot, enemy.x - shot.vx, enemy.z - shot.vz, WAVE.knock),
        );
    },
  },
};
