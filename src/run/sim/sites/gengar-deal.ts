import { queueCard } from "../progression";
import type { Player } from "../state/entities";
import type { Site } from "../state/field";
import type { World } from "../state/world";

export function interact(world: World, site: Site, player: Player): void {
  queueCard(world, player, "chest", undefined, { kind: "deal", site: site.id });
  player.choosing = true;
}
