import type { World } from "../state/world";
import type { Site } from "../state/field";
import type { Player } from "../state/entities";
import { SITE } from "../content/params/sites";
import { announce, begin, channel, spawnAtSite } from "./shared";

export function interact(world: World, site: Site, player: Player): void {
  begin(world, site, player, SITE.fossilChannel - site.data.progress);
}

export function update(world: World, site: Site, dt: number): void {
  if (site.data.enemy !== null) return;
  if (
    site.data.progress < SITE.fossilChannel &&
    !channel(world, site, dt, SITE.fossilChannel, true)
  )
    return;
  if (spawnAtSite(world, site, "aerodactyl")) announce(world, site, "reveal");
}
