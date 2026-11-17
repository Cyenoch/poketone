import type { World } from "../state/world";
import type { Site } from "../state/field";
import type { Player } from "../state/entities";
import { finish } from "./shared";

export function interact(world: World, site: Site, player: Player): void {
  site.owner = player.id;
  world.silphScope = true;
  finish(world, site);
}
