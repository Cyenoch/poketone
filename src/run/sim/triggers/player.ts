// Triggers on what happens to the player: a hit landing (adrenaline orb, smoke ball, adamant orb),
// standing still (metal powder), the ultimate (poké flute), a dash (soda pop, iron ball, shed shell),
// a knockout saved (focus band / sash, revive, rainbow wing: hurt.ts `lethalSave` decides, the burst
// lands here a tick later) and stored overheal (fresh water). Cues are read off player state each tick
// (`lastHurt`, `moving`, `dashTime`, `ult.elapsed`), so hurt.ts never imports combat.

import { damageEnemy, statusEnemy } from "../combat";
import { statuses, type StatusDef } from "../content/statuses";
import { OVERHEAL_KNOCK } from "../content/params/trigger-runtime";
import { chance } from "../rng";
import { currentStats } from "../stats";
import { targetable } from "../status";
import { hypot } from "../math";
import type { Player } from "../state/entities";
import type { BuffCue } from "../content/triggers";
import type { TriggerRule } from "./index";
import { burst, procDamage, visible } from "./kit";

/** Counts a `key` timer down to 0 and returns what is left. */
function countdown(fx: Record<string, number>, key: string, dt: number): number {
  const left = Math.max(0, (fx[key] ?? 0) - dt);
  fx[key] = left;
  return left;
}

/** Whether `cue` happened since this trigger last looked (the first look only takes a baseline). */
function cued(player: Player, cue: Exclude<BuffCue, "still">, key: string): boolean {
  const { fx } = player;
  const now =
    cue === "hurt"
      ? player.lastHurt
      : cue === "dash"
        ? Number(player.dashTime > 0)
        : Number(player.ult.elapsed >= 0);
  const seenKey = `${key}:seen`;
  const seen = fx[seenKey];
  fx[seenKey] = now;
  if (seen === undefined) return false;
  return cue === "hurt" ? now > seen : now === 1 && seen === 0;
}

export const buff: TriggerRule<"buff"> = {
  hook: "tick",
  run(ctx, player, trigger, key, { dt }) {
    const { fx } = player;
    countdown(fx, key, dt);
    const cooling = countdown(fx, `${key}:cd`, dt);
    if (trigger.on === "still") {
      const was = fx[key] ?? 0;
      fx[`${key}:still`] = player.moving ? 0 : (fx[`${key}:still`] ?? 0) + dt;
      fx[key] = fx[`${key}:still`]! >= (trigger.delay ?? 0) ? trigger.seconds : 0;
      if (was === 0 && fx[key] > 0)
        ctx.world.events.push({ t: "buff", player: player.id, on: trigger.on });
      return;
    }
    if (!cued(player, trigger.on, key) || cooling > 0) return;
    if (!chance(ctx.world.rng, trigger.chance)) return;
    fx[key] = trigger.seconds;
    fx[`${key}:cd`] = trigger.cooldown;
    ctx.world.events.push({ t: "buff", player: player.id, on: trigger.on });
    if (trigger.iframes) player.invulnerable = Math.max(player.invulnerable, trigger.iframes);
    if (trigger.resetCooldowns) for (const move of player.moves) move.cooldown = 0;
  },
};

export const statusOnHurt: TriggerRule<"statusOnHurt"> = {
  hook: "tick",
  run(ctx, player, trigger, key, { dt }) {
    const cooling = countdown(player.fx, `${key}:cd`, dt);
    if (!cued(player, "hurt", key) || cooling > 0) return;
    player.fx[`${key}:cd`] = trigger.cooldown;
    const def: StatusDef = statuses[trigger.status];
    ctx.world.events.push({
      t: "item-burst",
      player: player.id,
      look: "wave",
      x: player.x,
      z: player.z,
      radius: trigger.radius,
      dirX: 0,
      dirZ: 1,
      length: 0,
    });
    for (const enemy of ctx.world.enemies) {
      if (
        enemy.hp <= 0 ||
        !targetable(enemy) ||
        hypot(enemy.x - player.x, enemy.z - player.z) > trigger.radius + enemy.radius
      )
        continue;
      const time = trigger.seconds * (enemy.boss ? (def.bossScale ?? 1) : 1);
      statusEnemy(ctx, enemy, trigger.status, time, 0, player);
    }
  },
};

/** The rebirth burst a save asked for (hurt.ts sets `:burst`; the hit itself cannot reach the grid). */
export const lethalSave: TriggerRule<"lethalSave"> = {
  hook: "tick",
  run(ctx, player, trigger, key) {
    if (!player.fx[`${key}:burst`] || !trigger.burst) return;
    player.fx[`${key}:burst`] = 0;
    const b = trigger.burst;
    burst(ctx, player, player.x, player.z, b.radius, b.look, {
      type: b.type,
      dmg: procDamage(player, b.dmg),
      status: b.status,
      statusChance: 1,
      knock: b.knock,
    });
  },
};

export const dashBurst: TriggerRule<"dashBurst"> = {
  hook: "tick",
  run(ctx, player, trigger, key) {
    const dashing = Number(player.dashTime > 0);
    const was = player.fx[`${key}:dashing`] ?? 0;
    player.fx[`${key}:dashing`] = dashing;
    const fires = trigger.at === "start" ? dashing === 1 && was === 0 : dashing === 0 && was === 1;
    if (!fires) return;
    const armor = trigger.armorScale ? trigger.armorScale * currentStats(player).armor : 0;
    burst(ctx, player, player.x, player.z, trigger.radius, trigger.look, {
      type: trigger.type,
      dmg: procDamage(player, trigger.dmg) + armor,
      status: trigger.status,
      statusChance: trigger.statusChance,
      knock: trigger.knock,
    });
  },
};

/** Stored overheal (combat.ts `heal` adds it) shot at the nearest enemy in sight every `every` seconds. */
export const overhealStore: TriggerRule<"overhealStore"> = {
  hook: "tick",
  run(ctx, player, trigger, key, { dt }) {
    const timer = (player.fx[`${key}:t`] ?? trigger.every) - dt;
    player.fx[`${key}:t`] = timer;
    if (timer > 0) return;
    player.fx[`${key}:t`] = timer + trigger.every;
    const stored = player.fx[key] ?? 0;
    if (stored <= 0) return;
    const target = visible(ctx.world, player, trigger.range)
      .map((enemy) => ({ enemy, d: hypot(enemy.x - player.x, enemy.z - player.z) }))
      .sort((a, b) => a.d - b.d)[0]?.enemy;
    if (!target) return;
    player.fx[key] = 0;
    ctx.world.events.push({
      t: "chain",
      points: [player.x, player.z, target.x, target.z],
      type: trigger.type,
    });
    damageEnemy(ctx, target, {
      owner: player,
      move: null,
      type: trigger.type,
      dmg: stored * trigger.perHp,
      crit: 0,
      status: trigger.status,
      statusChance: 1,
      knock: OVERHEAL_KNOCK,
      fromX: player.x,
      fromZ: player.z,
      secondary: true,
    });
  },
};

/** Enigma Berry: read where heals land (combat.ts `heal`), no hook of its own. */
export const overhealShield: TriggerRule<"overhealShield"> = { hook: "heal" };

/** Guard Spec: the guard's return timer (hurt.ts `blocked` spends it). */
export const block: TriggerRule<"block"> = {
  hook: "tick",
  run(_ctx, player, _trigger, key, { dt }) {
    countdown(player.fx, key, dt);
  },
};
