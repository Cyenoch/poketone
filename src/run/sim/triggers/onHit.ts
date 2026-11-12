// Hit triggers: a status at a chance (grip claw, flame / toxic orb, snowball, awakening, King's Rock's
// flinch), a Bonk! multiplier (stick), an execute (razor fang) and a crit bolt (thunder stone).

import { damageEnemy, inflictBy } from "../combat";
import { stagger } from "../poise";
import { targetable } from "../status";
import { chance } from "../rng";
import { currentStats } from "../stats";
import { hypot } from "../math";
import type { TriggerRule } from "./index";
import { procDamage } from "./kit";

/** Direct hits only: reaction splashes and other procs (`secondary`) never roll on-hit statuses. */
export const inflictOnHit: TriggerRule<"inflictOnHit"> = {
  hook: "hit",
  run(ctx, player, trigger, _key, { hit, enemy, removed }) {
    if (hit.secondary || enemy.hp <= 0) return;
    const stats = currentStats(player);
    if (!chance(ctx.world.rng, trigger.chance * stats.statusChance)) return;
    if (trigger.status === "flinch") stagger(enemy);
    else inflictBy(ctx.world, enemy, trigger.status, removed, player);
  },
};

export const bonk: TriggerRule<"bonk"> = {
  hook: "damage",
  factor(ctx, _player, trigger, { hit }) {
    if (hit.secondary) return 1;
    return chance(ctx.world.rng, trigger.chance) ? trigger.mult : 1;
  },
};

/** Sets HP to 0 inside the hit, so `damageEnemy` credits the kill once, as its own (its death shows it). */
export const execute: TriggerRule<"execute"> = {
  hook: "hit",
  run(_ctx, _player, trigger, _key, { enemy }) {
    if (enemy.boss || enemy.hp <= 0 || enemy.hp >= enemy.maxHp * trigger.below) return;
    enemy.hp = 0;
  },
};

export const critStrike: TriggerRule<"critStrike"> = {
  hook: "hit",
  run(ctx, player, trigger, key, { hit, enemy, crit }) {
    if (!crit || hit.secondary) return;
    const procs = player.procs[key] ?? 0;
    if (procs >= trigger.perSecond) return;
    let target: typeof enemy | undefined;
    let best = trigger.range;
    for (const other of ctx.world.enemies) {
      if (other === enemy || other.hp <= 0 || !targetable(other)) continue;
      const d = hypot(other.x - enemy.x, other.z - enemy.z);
      if (d <= best) [target, best] = [other, d];
    }
    if (!target) return;
    player.procs[key] = procs + 1;
    ctx.world.events.push({
      t: "chain",
      points: [enemy.x, enemy.z, target.x, target.z],
      type: trigger.type,
    });
    damageEnemy(ctx, target, {
      owner: player,
      move: null,
      type: trigger.type,
      dmg: procDamage(player, trigger.dmg),
      crit: 0,
      status: trigger.status,
      statusChance: trigger.statusChance,
      knock: 0,
      fromX: enemy.x,
      fromZ: enemy.z,
      secondary: true,
    });
  },
};
