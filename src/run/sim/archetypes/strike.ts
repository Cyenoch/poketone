// Strikes: melee lashes, alternating front and back, each one swing on the caster's own step.

import { STRIKE } from "../content/params/archetypes";
import { acquire, aim, area, chestOf, inSector, onStep, type ArchetypeDef, type Zone } from "./kit";

export const strikeArea: Zone = { shape: inSector, reaches: onStep, knock: STRIKE.knock };

export const strike: ArchetypeDef = {
  shortReach: true,
  cast(ctx, player, def, p) {
    const { world } = ctx;
    const { terrain } = world.map;
    const eye = chestOf(terrain, player);
    const [target] = acquire(world, player, 1, p.area + STRIKE.aimPadding);
    if (!target) return false;
    let [dx, dz] = aim(terrain, player, eye, target);
    for (let i = 0; i < p.count; i++) {
      area(world, player, def, p, "strike", {
        dirX: dx,
        dirZ: dz,
        length: p.area,
        angle: STRIKE.angle,
        // Life counts the stagger too, or later lashes expire before they swing.
        life: STRIKE.swing + i * STRIKE.stagger,
        delay: i * STRIKE.stagger,
      });
      [dx, dz] = [-dx, -dz];
    }
    return true;
  },
};
