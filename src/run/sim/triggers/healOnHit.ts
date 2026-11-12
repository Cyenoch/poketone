// Photosynthesis: a hit of the trigger's type heals a share of max HP, capped per second.

import { heal } from "../combat";
import { currentStats } from "../stats";
import type { TriggerRule } from "./index";

export const healOnHit: TriggerRule<"healOnHit"> = {
  hook: "hit",
  run(_ctx, player, trigger, key, { hit }) {
    const procs = player.procs[key] ?? 0;
    if (hit.type !== trigger.type || procs >= trigger.perSecond) return;
    player.procs[key] = procs + 1;
    heal(player, currentStats(player).maxHp * trigger.heal);
  },
};
