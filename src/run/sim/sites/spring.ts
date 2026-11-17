import type { World } from "../state/world";
import type { Site } from "../state/field";
import type { Player } from "../state/entities";
import { currentStats } from "../stats";
import { present } from "../team";
import { finish } from "./shared";

export function interact(world: World, site: Site, player: Player): void {
  site.owner = player.id;
  finish(world, site);
  for (const recipient of present(world)) {
    if (!recipient.alive) continue;
    recipient.hp = currentStats(recipient).maxHp;
    world.events.push({ t: "heal", player: recipient.id, share: 1 });
  }
}
