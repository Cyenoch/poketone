import type { World } from "../state/world";
import type { Site } from "../state/field";
import type { Player } from "../state/entities";
import { SITE } from "../content/params/sites";
import { begin, spawnAtSite } from "./shared";

export function interact(world: World, site: Site, player: Player): void {
  begin(world, site, player, SITE.honeyDelay);
}

export function update(world: World, site: Site): void {
  if (site.data.enemy !== null || world.time < site.until) return;
  spawnAtSite(world, site, site.data.species!);
}
