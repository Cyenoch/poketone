// A hit on a player. Nothing it imports reaches the skill registry, so the enemy skill modules can deal
// damage without importing combat.ts (combat → partners → skills/index would close a load-order loop).

import { chance } from "./rng";
import { ABILITY_PARAMS } from "./content/abilities";
import type { ElementType } from "./content/elements";
import { activeWeather, weatherMultiplier } from "./content/weather";
import { armorFactor, currentAbility, currentStats, type PlayerStats } from "./stats";
import type { ItemId } from "./content/items";
import { formOf } from "./evolution";
import { hypot3 } from "./math";
import { aimHeight, lineOfFire } from "./sight";
import { apply } from "./status";
import { heightAt } from "./terrain";
import type { Enemy, Hazard, Player } from "./state/entities";
import type { World } from "./state/world";
import { LETHAL_SAVE_MIN_HP, PLAYER_IFRAMES, SHIELD } from "./content/params/player";

/** Grounds a hit by its field shape, not by the attack element (e.g. a flying bone is not a pool). */
const groundHazards: ReadonlySet<Hazard["kind"]> = new Set([
  "spore",
  "stun-spore",
  "acid-pool",
  "landing",
  "rockfall",
  "burning-trail",
]);

export function ignoresGroundHazard(player: Player, kind: Hazard["kind"]): boolean {
  return groundHazards.has(kind) && currentAbility(player) === "levitate";
}

function electricShot(hazard: Hazard): boolean {
  return (
    hazard.element === "electric" &&
    (hazard.kind === "thunder-shock" || hazard.kind === "boss-shot")
  );
}

/** Redirect only moving electric projectiles. Existing terrain and body collisions still decide where they land. */
export function steerLightningRod(world: World, hazard: Hazard): void {
  if (!electricShot(hazard)) return;
  let nearest = ABILITY_PARAMS.lightningRod.range ** 2;
  let aim: { dx: number; dy: number; dz: number } | undefined;
  for (const player of world.players) {
    if (!player.alive || player.departed || currentAbility(player) !== "lightning-rod") continue;
    const dx = player.x - hazard.x,
      dz = player.z - hazard.z;
    const y = aimHeight(
      heightAt(world.map.terrain, player.x, player.z),
      formOf(player).height,
      hazard.y,
    );
    const dy = y - hazard.y;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (
      d2 > nearest ||
      (aim && d2 === nearest) ||
      !lineOfFire(world, hazard.x, hazard.y, hazard.z, player.x, y, player.z)
    )
      continue;
    nearest = d2;
    aim = { dx, dy, dz };
  }
  if (!aim || nearest === 0) return;
  const scale = hypot3(hazard.vx, hazard.vy, hazard.vz) / Math.sqrt(nearest);
  hazard.vx = aim.dx * scale;
  hazard.vy = aim.dy * scale;
  hazard.vz = aim.dz * scale;
}

/** Called at actual collision; never grant the boost if cover or another body intercepted first. */
export function absorbLightningRod(player: Player, hazard: Hazard): boolean {
  if (!electricShot(hazard) || currentAbility(player) !== "lightning-rod") return false;
  player.lightningRodTime = ABILITY_PARAMS.lightningRod.seconds;
  return true;
}

/**
 * Player damage: i-frames and dashes ignore it, evasion may void it, then armor and the damage-taken
 * stat scale it and the shield soaks it before HP. Both co-op and solo players use this path.
 */
export function damagePlayer(
  world: World,
  player: Player,
  raw: number,
  type: ElementType = "normal",
  attacker?: Enemy,
): boolean {
  if (!player.alive || player.ult.protection > 0 || player.invulnerable > 0 || player.dashTime > 0)
    return false;
  const stats = currentStats(player, activeWeather(world));
  if (blocked(player, stats) || (stats.evasion > 0 && chance(world.rng, stats.evasion))) {
    player.invulnerable = PLAYER_IFRAMES;
    world.events.push({ t: "evade", player: player.id });
    return false;
  }
  const amount =
    raw * weatherMultiplier(world, type) * armorFactor(stats.armor) * stats.damageTaken;
  const soaked = Math.min(player.shield, amount);
  player.shield -= soaked;
  player.hp -= amount - soaked;
  player.invulnerable = PLAYER_IFRAMES;
  player.hurt = 0.25;
  player.lastHurt = world.time;
  world.events.push({ t: "player-hit", player: player.id, amount });
  if (
    attacker &&
    attacker.hp > 0 &&
    currentAbility(player) === "cursed-body" &&
    chance(world.rng, ABILITY_PARAMS.cursedBody.chance)
  )
    apply(attacker, "disable", ABILITY_PARAMS.cursedBody.seconds, 0, player.id);
  settleKnockout(world, player);
  return true;
}

/** Weather bypasses mitigation and never interrupts a channel or grants hit i-frames. */
export function weatherDamagePlayer(world: World, player: Player, amount: number): void {
  if (
    !player.alive ||
    player.ult.protection > 0 ||
    amount <= 0 ||
    currentAbility(player) === "magic-guard"
  )
    return;
  player.hp -= amount;
  settleKnockout(world, player);
}

/** `seconds` is the sunny part of this shared simulation step (forecasts and overwrites cost nothing). */
export function applySolarCost(world: World, player: Player, seconds: number): void {
  if (currentAbility(player) === "solar-power")
    weatherDamagePlayer(
      world,
      player,
      currentStats(player).maxHp * ABILITY_PARAMS.solarCost * seconds,
    );
}

function settleKnockout(world: World, player: Player): void {
  if (player.hp <= 0 && player.bondEndure) {
    player.bondEndure = false;
    player.hp = LETHAL_SAVE_MIN_HP;
    player.invulnerable = Math.max(player.invulnerable, PLAYER_IFRAMES);
    world.events.push({ t: "bond-endure", player: player.id });
  } else if (player.hp <= 0 && !lethalSave(world, player)) {
    player.hp = 0;
    player.alive = false;
    player.dialog = null;
    player.rescue = null;
    // A cast in progress ends with its caster, so a revive doesn't resume half an ultimate.
    player.ult.elapsed = -1;
    if (world.players.length > 1) {
      player.choosing = false;
      if (player.revives === 0 || world.rules.includes("nuzlocke"))
        world.events.push({ t: "down", player: player.id });
    }
  }
}

/** A ready `block` trigger (Guard Spec) takes the hit whole and starts its return timer. */
function blocked(player: Player, stats: PlayerStats): boolean {
  for (const { key, def } of stats.triggers) {
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
    const isRevive = def.hp >= 0.3;
    if (isRevive && world.rules.includes("nuzlocke")) continue;
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
      isRevive
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
