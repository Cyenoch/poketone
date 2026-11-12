// Barrages: a fan of shots at the nearest target, each nudged by a seeded jitter.

import { BARRAGE } from "../content/params/archetypes";
import { range } from "../rng";
import { acquire, aim, chestOf, piercing, projectile, rotate, type ArchetypeDef } from "./kit";

export const barrage: ArchetypeDef = {
  cast(ctx, player, def, p) {
    const { world } = ctx;
    const { terrain } = world.map;
    const eye = chestOf(terrain, player);
    const [target] = acquire(world, player, 1);
    if (!target) return false;
    const [dx, dz, rise] = aim(terrain, player, eye, target);
    for (let i = 0; i < p.count; i++) {
      const offset =
        (i - (p.count - 1) / 2) * BARRAGE.spread +
        range(world.rng, -BARRAGE.jitter, BARRAGE.jitter);
      const [rx, rz] = rotate(dx, dz, offset);
      world.projectiles.push(
        projectile(world, player, def, p, [rx, rz, rise], eye, i * BARRAGE.stagger),
      );
    }
    return true;
  },
  shot: piercing,
};
