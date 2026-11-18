// Cones: a held fan from the caster toward the nearest target, ticking on what it sees.

import { moves } from "../content/moves";
import { CONE } from "../content/params/archetypes";
import {
  acquire,
  aim,
  area,
  chestOf,
  inSector,
  inSight,
  type ArchetypeDef,
  type Zone,
} from "./kit";

export const coneArea: Zone = {
  shape: inSector,
  reaches: inSight,
  knock: CONE.knock,
  track(world, a, _ground, owner) {
    if (!a.move || !moves[a.move].track) return;
    const [target] = acquire(world, owner, 1, a.length + CONE.aimPadding);
    if (target)
      [a.dirX, a.dirZ] = aim(world.map.terrain, owner, chestOf(world.map.terrain, owner), target);
  },
};

export const cone: ArchetypeDef = {
  shortReach: true,
  cast(ctx, player, def, p) {
    const { world } = ctx;
    const { terrain } = world.map;
    const eye = chestOf(terrain, player);
    const [target] = acquire(world, player, 1, p.area + CONE.aimPadding);
    if (!target) return false;
    const [dx, dz] = aim(terrain, player, eye, target);
    area(world, player, def, p, "cone", {
      dirX: dx,
      dirZ: dz,
      length: p.area,
      angle: CONE.angle,
      tick: CONE.tick,
      follow: true,
    });
    return true;
  },
};
