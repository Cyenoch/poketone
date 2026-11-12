// Orbs: fired like bolts with a small body; the first body they touch, or the end of their flight,
// sets off a `burst` of the move's area.

import { ORB } from "../content/params/archetypes";
import { stopAtCover } from "../sight";
import { volley } from "./bolt";
import { explode } from "./burst";
import { touching, type ArchetypeDef } from "./kit";

export const orb: ArchetypeDef = {
  cast: (ctx, player, def, p) => volley(ctx, player, def, p, ORB.radius),
  shot: {
    land(ctx, shot, owner) {
      if (!stopAtCover(ctx.world, shot))
        touching(ctx, shot, () => {
          explode(ctx, owner, shot);
          shot.life = 0;
        });
      if (shot.life <= 0 && shot.hit.length === 0) explode(ctx, owner, shot);
    },
  },
};
