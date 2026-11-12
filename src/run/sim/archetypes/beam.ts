// Beams: a held lane from the chest toward each target, pitched onto its body and clipped by cover.

import { BEAM } from "../content/params/archetypes";
import { CHEST } from "../content/params/combat";
import { coverHit, enemyFeet, enemyHeight } from "../sight";
import type { Area, Enemy } from "../state/entities";
import { acquire, aim, area, chestOf, type ArchetypeDef, type Zone } from "./kit";

function inLane(a: Area, enemy: Enemy): boolean {
  const dx = enemy.x - a.x;
  const dz = enemy.z - a.z;
  const along = dx * a.dirX + dz * a.dirZ;
  if (along < -BEAM.rearReach || along > a.length) return false;
  return Math.abs(dx * a.dirZ - dz * a.dirX) <= a.radius + enemy.radius;
}

export const beamArea: Zone = {
  shape: inLane,
  /** At the beam's height where it crosses the body. */
  reaches(cover, a, ground, enemy) {
    const along = (enemy.x - a.x) * a.dirX + (enemy.z - a.z) * a.dirZ;
    const y = ground + CHEST + a.rise * Math.max(0, along);
    const feet = enemyFeet(cover.map.terrain, enemy);
    return y >= feet - a.radius && y <= feet + enemyHeight(enemy) + a.radius;
  },
  knock: BEAM.knock,
  reach: (a) => a.length,
  track(world, a, ground) {
    a.length = Math.min(
      BEAM.reach,
      coverHit(world, a.x, ground + CHEST, a.z, a.dirX, a.dirZ, a.rise, BEAM.reach),
    );
  },
};

export const beam: ArchetypeDef = {
  heavy: true,
  launch: "edge",
  windup: BEAM.delay,
  cast(ctx, player, def, p) {
    const { world } = ctx;
    const { terrain } = world.map;
    const eye = chestOf(terrain, player);
    const targets = acquire(world, player, p.count, BEAM.range);
    if (targets.length === 0) return false;
    for (const target of targets) {
      const [dx, dz, rise] = aim(terrain, player, eye, target);
      area(world, player, def, p, "beam", {
        dirX: dx,
        dirZ: dz,
        rise,
        length: BEAM.reach,
        radius: p.area / 2,
        delay: BEAM.delay,
        tick: BEAM.tick,
        life: p.dur + BEAM.delay,
        follow: true,
      });
    }
    return true;
  },
};
