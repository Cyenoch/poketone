// Static's zap: counts down, then hits the nearest on-screen enemy in range, retrying every tick while none is.

import { acquire } from "../archetypes/kit";
import { damageEnemy } from "../combat";
import type { TriggerRule } from "./index";

export const zap: TriggerRule<"zap"> = {
  hook: "tick",
  run(ctx, player, trigger, key, { dt }) {
    const timer = (player.fx[key] ?? trigger.seconds) - dt;
    player.fx[key] = timer;
    if (timer > 0) return;
    const [target] = acquire(ctx.world, player, 1, trigger.range);
    if (!target) return;
    player.fx[key] = trigger.seconds;
    ctx.world.events.push({
      t: "chain",
      points: [player.x, player.z, target.x, target.z],
      type: trigger.type,
    });
    damageEnemy(ctx, target, {
      owner: player,
      move: null,
      type: trigger.type,
      dmg: trigger.dmg,
      crit: 0,
      status: trigger.status,
      statusChance: 1,
      knock: 0,
      fromX: player.x,
      fromZ: player.z,
    });
  },
};
