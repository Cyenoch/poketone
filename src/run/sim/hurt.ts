// A hit on a player. Nothing it imports reaches the skill registry, so the enemy skill modules can deal
// damage without importing combat.ts (combat → partners → skills/index would close a load-order loop).

import { chance } from "./rng";
import { armorFactor, currentStats } from "./stats";
import type { ItemId } from "./content/items";
import type { Player } from "./state/entities";
import type { World } from "./state/world";
import { LETHAL_SAVE_MIN_HP, PLAYER_IFRAMES, SHIELD } from "./content/params/player";

/**
 * Player damage: i-frames and dashes ignore it, evasion may void it, then armor and the damage-taken
 * stat scale it and the shield soaks it before HP. Both co-op and solo players use this path.
 */
export function damagePlayer(world: World, player: Player, raw: number): boolean {
  if (!player.alive || player.invulnerable > 0 || player.dashTime > 0) return false;
  const stats = currentStats(player);
  if (blocked(player) || (stats.evasion > 0 && chance(world.rng, stats.evasion))) {
    player.invulnerable = PLAYER_IFRAMES;
    world.events.push({ t: "evade", player: player.id });
    return false;
  }
  const amount = raw * armorFactor(stats.armor) * stats.damageTaken;
  const soaked = Math.min(player.shield, amount);
  player.shield -= soaked;
  player.hp -= amount - soaked;
  player.invulnerable = PLAYER_IFRAMES;
  player.hurt = 0.25;
  player.lastHurt = world.time;
  world.events.push({ t: "player-hit", player: player.id, amount });
  if (player.hp <= 0 && !lethalSave(world, player)) {
    player.hp = 0;
    player.alive = false;
    player.dialog = null;
    player.rescue = null;
    // A cast in progress ends with its caster, so a revive doesn't resume half an ultimate.
    player.ult.elapsed = -1;
    if (world.players.length > 1) {
      player.choosing = false;
      if (player.revives === 0) world.events.push({ t: "down", player: player.id });
    }
  }
  return true;
}

/** A ready `block` trigger (Guard Spec) takes the hit whole and starts its return timer. */
function blocked(player: Player): boolean {
  for (const { key, def } of currentStats(player).triggers) {
    if (def.kind !== "block" || (player.fx[key] ?? 0) > 0) continue;
    player.fx[key] = def.every;
    return true;
  }
  return false;
}

/**
 * A knockout the player's `lethalSave` triggers turn away, first one that can in list order: HP to
 * `hp` of max (1 HP at 0), i-frames, a burst queued for the next tick (`triggers/player.ts`). Uses
 * count per run or per evolution stage in `Player.fx`; a cooldown keeps the time of the last save.
 */
function lethalSave(world: World, player: Player): boolean {
  const stats = currentStats(player);
  for (const { key, def } of stats.triggers) {
    if (def.kind !== "lethalSave") continue;
    const usesKey = def.per === "stage" ? `${key}:stage${player.stage}` : `${key}:used`;
    const used = player.fx[usesKey] ?? 0;
    const last = player.fx[`${key}:at`];
    if (used >= def.uses || (last !== undefined && world.time - last < def.cooldown)) continue;
    if (!chance(world.rng, def.chance)) continue;
    player.fx[usesKey] = used + 1;
    player.fx[`${key}:at`] = world.time;
    player.hp = Math.max(LETHAL_SAVE_MIN_HP, stats.maxHp * def.hp);
    player.invulnerable = Math.max(player.invulnerable, def.iframes);
    if (def.burst) player.fx[`${key}:burst`] = 1;
    world.events.push(
      def.hp >= 0.3
        ? {
            t: "revive",
            player: player.id,
            item: key.slice("item:".length, key.indexOf("#")) as ItemId,
          }
        : { t: "heal", player: player.id, share: player.hp / stats.maxHp },
    );
    return true;
  }
  return false;
}

/** Refills the shield after `SHIELD.delay` unhurt seconds; never above the stat (it can drop with items). */
export function updateShield(world: World, player: Player, dt: number): void {
  const max = currentStats(player).shield;
  if (world.time - player.lastHurt >= SHIELD.delay)
    player.shield = Math.min(max, player.shield + (max / SHIELD.refill) * dt);
  else player.shield = Math.min(max, player.shield);
}
