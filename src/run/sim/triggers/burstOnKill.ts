// Kill bursts (fire / ice / leaf stone, griseous orb): the victim bursts into an area hit. Kills a
// burst makes do not burst again (no chain reactions through a crowd).

import { heal } from "../combat";
import { chance } from "../rng";
import { currentStats } from "../stats";
import { has } from "../status";
import type { TriggerRule } from "./index";
import { burst, procDamage } from "./kit";

let bursting = false;

export const burstOnKill: TriggerRule<"burstOnKill"> = {
  hook: "kill",
  run(ctx, player, trigger, _key, { enemy }) {
    if (bursting) return;
    if (trigger.requires && !trigger.requires.some((id) => has(enemy, id))) return;
    if (!chance(ctx.world.rng, trigger.chance)) return;
    bursting = true;
    try {
      burst(ctx, player, enemy.x, enemy.z, trigger.radius, trigger.look, {
        type: trigger.type,
        dmg: procDamage(player, trigger.dmg),
        status: trigger.status,
        statusChance: trigger.statusChance,
      });
    } finally {
      bursting = false;
    }
    if (trigger.heal) {
      const share = trigger.heal;
      heal(player, currentStats(player).maxHp * share);
      ctx.world.events.push({ t: "heal", player: player.id, share });
    }
  },
};
