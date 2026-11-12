// Scaling modifiers (metronome, bicycle, thick club, rage candy bar, reaper cloth, cell battery): the
// tick writes the measure into `Player.fx[key]`; the fold (stats.ts) turns it into a modifier, so the
// stat lags the measure by one tick.

import { formOf } from "../evolution";
import { currentStats } from "../stats";
import type { TriggerRule } from "./index";
import { STREAK_GAP } from "../content/params/combat";

export const scaling: TriggerRule<"scaling"> = {
  hook: "tick",
  run(ctx, player, trigger, key) {
    const { fx } = player;
    const time = ctx.world.time;
    switch (trigger.measure) {
      case "kills":
        fx[key] = player.kills;
        return;
      case "streak": {
        const seen = fx[`${key}:kills`] ?? player.kills;
        if (player.kills > seen) {
          fx[key] = (fx[key] ?? 0) + player.kills - seen;
          fx[`${key}:at`] = time;
        } else if (time - (fx[`${key}:at`] ?? time) > STREAK_GAP) fx[key] = 0;
        fx[`${key}:kills`] = player.kills;
        return;
      }
      case "unhurt":
        fx[key] = time - player.lastHurt;
        return;
      case "speed":
        fx[key] = currentStats(player).speed / formOf(player).speed - 1;
        return;
      case "armor":
        fx[key] = currentStats(player).armor;
        return;
      case "missingHp":
        fx[key] = 1 - player.hp / currentStats(player).maxHp;
        return;
    }
  },
};
