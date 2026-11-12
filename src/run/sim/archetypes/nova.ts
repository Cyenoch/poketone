// Novas: one hit on everything within `area` of the caster.

import { acquire, area, inDisc, onStepOrInSight, type ArchetypeDef, type Zone } from "./kit";
import { hypot } from "../math";
import { NOVA } from "../content/params/archetypes";

/** Seconds of visual linger after the single hit. */
const NOVA_LIFE = 0.3;

export const novaArea: Zone = { shape: inDisc, reaches: onStepOrInSight, knock: NOVA.knock };

export const nova: ArchetypeDef = {
  shortReach: true,
  heavy: true,
  cast(ctx, player, def, p) {
    const { world } = ctx;
    // Same reach as the hit: the enemy's body, not its centre, has to be inside the radius.
    const [near] = acquire(world, player, 1, p.area + 1.5);
    if (!near || hypot(near.x - player.x, near.z - player.z) > p.area + near.radius) return false;
    area(world, player, def, p, "nova", { life: NOVA_LIFE });
    return true;
  },
};
