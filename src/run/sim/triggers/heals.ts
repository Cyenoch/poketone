// Rule-based heals (sitrus berry, lum berry, berry juice): a share of max HP when a rule holds.

import { healOwner, type Ctx } from "../combat";
import { chance } from "../rng";
import { currentStats } from "../stats";
import type { Player } from "../state/entities";
import type { TriggerRule } from "./index";

/** Heals `share` of max HP, with the heal cue on the player. */
function healShare(ctx: Ctx, player: Player, share: number): void {
  healOwner(ctx, player, currentStats(player).maxHp * share);
  ctx.world.events.push({ t: "heal", player: player.id, share });
}

/** Below `below` of max HP: heal `heal`, then wait `cooldown` seconds (sitrus berry). */
export const healBelow: TriggerRule<"healBelow"> = {
  hook: "tick",
  run(ctx, player, trigger, key, { dt }) {
    const wait = (player.fx[key] ?? 0) - dt;
    player.fx[key] = Math.max(0, wait);
    if (wait > 0 || player.hp >= currentStats(player).maxHp * trigger.below) return;
    healShare(ctx, player, trigger.heal);
    player.fx[key] = trigger.cooldown;
  },
};

/** Every `every` seconds, if HP is not full: heal `heal`; a full check waits for the next period (lum berry). */
export const healEvery: TriggerRule<"healEvery"> = {
  hook: "tick",
  run(ctx, player, trigger, key, { dt }) {
    const timer = (player.fx[key] ?? trigger.every) - dt;
    player.fx[key] = timer;
    if (timer > 0) return;
    player.fx[key] = timer + trigger.every;
    if (player.hp < currentStats(player).maxHp) healShare(ctx, player, trigger.heal);
  },
};

/** A kill heals `heal` of max HP at `chance` (berry juice). */
export const healOnKill: TriggerRule<"healOnKill"> = {
  hook: "kill",
  run(ctx, player, trigger) {
    if (chance(ctx.world.rng, trigger.chance)) healShare(ctx, player, trigger.heal);
  },
};
