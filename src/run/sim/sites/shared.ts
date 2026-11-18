import type { EnemyId } from "../content/enemies";
import { enemies } from "../content/enemies";
import { SITE } from "../content/params/sites";
import { BERRY } from "../content/params/economy";
import { mobilityClasses } from "../content/mobility";
import type { ItemId } from "../content/items";
import { enemyBodyScale, spawnEnemy } from "../director";
import { formOf } from "../evolution";
import { cos, hypot, sin } from "../math";
import { bodyFits, cellAt, routeReach, removeBlocker } from "../nav/index";
import type { Enemy, Player } from "../state/entities";
import type { Site } from "../state/field";
import { ARENA_HALF, type World } from "../state/world";
import { refreshStats } from "../stats";
import {
  applyChoice,
  hiddenAbilityAvailable,
  itemEligible,
  replacesHeldItem,
  rollItemChoice,
} from "../upgrades";
import { pickEffects } from "../progression";

export function announce(
  world: World,
  site: Site,
  phase: "wake" | "start" | "reveal" | "complete" | "cancel",
): void {
  world.events.push({
    t: "site",
    site: site.id,
    kind: site.kind,
    phase,
    x: site.x,
    z: site.z,
    ...(site.owner === null ? {} : { player: site.owner }),
  });
}

export function inReach(site: Site, player: Player, reach = SITE.reach): boolean {
  return hypot(site.x - player.x, site.z - player.z) <= site.radius + formOf(player).radius + reach;
}

export function begin(world: World, site: Site, player: Player, delay: number): void {
  site.state = "busy";
  site.owner = player.id;
  site.until = world.time + delay;
  site.data.lastHurt = player.lastHurt;
  announce(world, site, "start");
}

export function finish(world: World, site: Site): void {
  site.state = "spent";
  site.until = 0;
  site.data.enemy = null;
  announce(world, site, "complete");
}

export function unblock(world: World, site: Site): void {
  const blocker = world.nav.blockers.find(
    (entry) =>
      entry.kind === "circle" &&
      entry.x === site.x &&
      entry.z === site.z &&
      entry.radius === site.radius,
  );
  if (blocker) removeBlocker(world.nav, blocker.id);
}

/** Screen-visible site spawns follow their start event; find real terrain/body room beside the site. */
export function spawnAtSite(
  world: World,
  site: Site,
  species: EnemyId,
  elite = true,
  scale = 1,
): Enemy | null {
  const at = siteSpawnPoint(world, site, species, elite, scale);
  if (!at) return null;
  const enemy = spawnEnemy(world, species, at.x, at.z, elite, site.id);
  enemy.radius *= scale;
  enemy.scale *= scale;
  site.data.enemy = enemy.id;
  return enemy;
}

export function siteSpawnPoint(
  world: World,
  site: Site,
  species: EnemyId,
  elite = true,
  scale = 1,
  avoidPlayers = true,
): { x: number; z: number } | null {
  const def = enemies[species];
  const radius = def.radius * enemyBodyScale(elite, world.rules.includes("alpha-elites")) * scale;
  const home = world.map.pads.find((pad) => pad.tag === "spawn");
  const mobility = def.mobility.flying ? mobilityClasses.ground : def.mobility;
  const reachable = routeReach(
    world.nav,
    mobility,
    [cellAt(world.nav.grid, home?.x ?? 0, home?.z ?? 0)],
    false,
  );
  for (let ring = 0; ring < SITE.spawnRings; ring++) {
    const distance = site.radius + radius + SITE.spawnGap + ring * SITE.spawnRingStep;
    for (let k = 0; k < SITE.spawnBearings; k++) {
      const angle = (k / SITE.spawnBearings) * Math.PI * 2;
      const x = site.x + cos(angle) * distance;
      const z = site.z + sin(angle) * distance;
      if (Math.abs(x) > ARENA_HALF - radius || Math.abs(z) > ARENA_HALF - radius) continue;
      if (!bodyFits(world.nav, mobility, x, z, radius)) continue;
      if (!def.mobility.flying && reachable[cellAt(world.nav.grid, x, z)] !== 1) continue;
      if (
        avoidPlayers &&
        world.players.some(
          (player) =>
            player.alive &&
            hypot(player.x - x, player.z - z) < radius + formOf(player).radius + SITE.spawnGap,
        )
      )
        continue;
      return { x, z };
    }
  }
  return null;
}

export function berries(world: World, site: Pick<Site, "x" | "z">, count = 1): void {
  for (let i = 0; i < count; i++)
    world.pickups.push({
      id: world.nextId++,
      kind: "berry",
      x: site.x,
      z: site.z,
      value: BERRY.heal,
      magnet: false,
    });
}

export function rewardItem(world: World, player: Player, item?: ItemId): void {
  const hidden = hiddenAbilityAvailable(world, player);
  const choice = item
    ? itemEligible(player, item, world.partners, false, hidden)
      ? { kind: "item" as const, item }
      : null
    : rollItemChoice(world.rng, player, world.partners, hidden);
  if (!choice) {
    berries(world, player, SITE.rewards.fullBagBerries);
    return;
  }
  if (replacesHeldItem(world.rules, player, choice.item)) {
    applyChoice(player, { kind: "stardust" });
    return;
  }
  applyChoice(player, choice);
  pickEffects(world, player, choice.item);
  refreshStats();
}

/** Called after damage for the tick, so a completion cannot outrun that tick's interrupt. */
export function channel(
  world: World,
  site: Site,
  dt: number,
  seconds: number,
  retain: boolean,
): Player | null {
  const player = world.players.find((entry) => entry.id === site.owner);
  if (
    !player ||
    !player.alive ||
    player.departed ||
    player.lastHurt !== site.data.lastHurt ||
    player.moving ||
    player.dashTime > 0 ||
    player.ult.elapsed >= 0 ||
    player.rescue ||
    !inReach(site, player)
  ) {
    if (!retain) site.data.progress = 0;
    site.state = "ready";
    site.until = 0;
    announce(world, site, "cancel");
    site.owner = null;
    return null;
  }
  site.data.progress = Math.min(seconds, site.data.progress + dt);
  if (site.data.progress < seconds - 1e-9) return null;
  site.data.progress = seconds;
  return player;
}
