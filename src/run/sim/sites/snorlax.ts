import type { World } from "../state/world";
import type { Site } from "../state/field";
import type { Player } from "../state/entities";
import { SITE } from "../content/params/sites";
import { begin, spawnAtSite, unblock } from "./shared";

export function interact(world: World, site: Site, player: Player): void {
  begin(world, site, player, SITE.warning);
}

export function update(world: World, site: Site): void {
  if (site.data.enemy !== null || world.time < site.until) return;
  unblock(world, site);
  const enemy = spawnAtSite(world, site, "snorlax");
  if (enemy) enemy.hp = enemy.maxHp *= SITE.snorlaxHp;
}
