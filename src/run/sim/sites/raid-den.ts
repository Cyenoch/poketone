import type { World } from "../state/world";
import type { Site } from "../state/field";
import type { Player } from "../state/entities";
import { SITE } from "../content/params/sites";
import { begin, finish, spawnAtSite } from "./shared";

export function interact(world: World, site: Site, player: Player): void {
  begin(world, site, player, SITE.warning);
}

export function update(world: World, site: Site): void {
  if (world.time < site.until) return;
  if (site.data.enemy !== null) {
    const id = site.data.enemy;
    world.enemies = world.enemies.filter((enemy) => enemy.id !== id);
    world.hazards = world.hazards.filter((hazard) => hazard.caster !== id);
    finish(world, site);
    return;
  }
  const enemy = spawnAtSite(world, site, site.data.species!, true, SITE.raid.scale);
  if (enemy) {
    enemy.hp = enemy.maxHp *= SITE.raid.hp;
    enemy.alpha = true;
    site.until = world.time + SITE.raid.seconds;
  }
}
