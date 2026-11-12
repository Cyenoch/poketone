// The shared burst: the blast an orb or a shell leaves where it ends, a vortex collapses into, and a
// fusion closes with. Not an archetype of its own; the view draws it by the move that made it.

import type { Ctx } from "../combat";
import { moves } from "../content/moves";
import { BURST } from "../content/params/archetypes";
import type { Player, Projectile } from "../state/entities";
import { area, inDisc, onStepOrInSight, type Zone } from "./kit";

export const burstArea: Zone = { shape: inDisc, reaches: onStepOrInSight, knock: BURST.knock };

/** Bursts a shot where it is, once (an orb that struck a body, or ran out; a shell that landed). */
export function explode(ctx: Ctx, owner: Player, shot: Projectile): void {
  if (shot.hit.length > 0) return;
  shot.hit.push(-1);
  const def = moves[shot.move];
  area(ctx.world, owner, def, shot, "burst", {
    x: shot.x,
    z: shot.z,
    radius: shot.area,
    life: 0.3, // Visual linger after the single hit.
  });
}
