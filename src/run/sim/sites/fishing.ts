import type { World } from "../state/world";
import type { Site } from "../state/field";
import type { Player } from "../state/entities";
import { SITE } from "../content/params/sites";
import { next } from "../rng";
import { announce, begin, channel, rewardItem, spawnAtSite } from "./shared";

export function interact(world: World, site: Site, player: Player): void {
  begin(world, site, player, SITE.fishing.channel);
}

export function update(world: World, site: Site, dt: number): void {
  if (site.data.enemy !== null) return;
  // Completion is committed once; lack of body room only delays the already rolled encounter.
  if (site.data.progress < SITE.fishing.channel) {
    const player = channel(world, site, dt, SITE.fishing.channel, false);
    if (!player) return;
    site.data.uses++;
    announce(world, site, "reveal");
    const roll = next(world.rng);
    if (roll < SITE.fishing.fish) site.data.species = "magikarp";
    else if (roll < SITE.fishing.fish + SITE.fishing.item) {
      rewardItem(world, player);
      reset(world, site);
      return;
    } else site.data.species = "gyarados";
  }
  spawnAtSite(world, site, site.data.species!, site.data.species === "gyarados");
}

export function reset(world: World, site: Site): void {
  announce(world, site, "complete");
  site.state = site.data.uses >= SITE.fishing.uses ? "spent" : "ready";
  site.data.progress = 0;
  site.data.enemy = null;
  delete site.data.species;
  site.owner = null;
  site.until = 0;
}
