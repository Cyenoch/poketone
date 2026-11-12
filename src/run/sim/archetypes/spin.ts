// Spins: a disc around the caster, ticking while an enemy is close.

import { SPIN } from "../content/params/archetypes";
import { acquire, area, inDisc, onStepOrInSight, type ArchetypeDef, type Zone } from "./kit";

export const spinArea: Zone = { shape: inDisc, reaches: onStepOrInSight, knock: SPIN.knock };

export const spin: ArchetypeDef = {
  shortReach: true,
  cast(ctx, player, def, p) {
    const { world } = ctx;
    if (acquire(world, player, 1, p.area + SPIN.aimPadding).length === 0) return false;
    area(world, player, def, p, "spin", { tick: SPIN.tick, follow: true });
    return true;
  },
};
