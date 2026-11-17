import type { World } from "../state/world";
import type { Site } from "../state/field";
import type { Player } from "../state/entities";
import { SITE } from "../content/params/sites";
import { hypot } from "../math";
import { grantPartner } from "../partners";
import { queueCard } from "../progression";
import { currentStats } from "../stats";
import { DASH_SPEEDUP } from "../content/params/player";
import { announce } from "./shared";

export function interact(world: World, site: Site, player: Player): void {
  if (player.egg) return;
  const egg = site.data.egg ?? {
    species: site.data.species!,
    distance: 0,
    x: player.x,
    z: player.z,
  };
  player.egg = { ...egg, x: player.x, z: player.z };
  delete site.data.egg;
  site.owner = player.id;
  site.state = "spent";
  announce(world, site, "start");
}

export function update(world: World): void {
  for (const player of world.players) {
    const egg = player.egg;
    if (!egg) continue;
    if (!player.alive || player.departed) {
      world.sites.push({
        id: world.nextId++,
        kind: "egg",
        x: player.x,
        z: player.z,
        radius: SITE.radius.egg,
        state: "ready",
        until: 0,
        owner: null,
        data: { progress: 0, uses: 0, enemy: null, lastHurt: 0, egg: { ...egg } },
      });
      player.egg = null;
      continue;
    }
    // The final dash step leaves dashTime below zero; none of that step is walking.
    if (
      player.moving &&
      player.dashTime <= 0 &&
      hypot(player.vx, player.vz) < currentStats(player).speed * DASH_SPEEDUP - 1e-6
    )
      egg.distance += hypot(player.x - egg.x, player.z - egg.z);
    egg.x = player.x;
    egg.z = player.z;
    if (egg.distance < SITE.eggDistance) continue;
    player.egg = null;
    if (!grantPartner(world, player, egg.species, player, "egg")) queueCard(world, player, "chest");
    world.events.push({
      t: "site",
      site: world.nextId++,
      kind: "egg",
      phase: "complete",
      x: player.x,
      z: player.z,
      player: player.id,
    });
  }
}
