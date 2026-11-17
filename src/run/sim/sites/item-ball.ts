import type { World } from "../state/world";
import type { Site } from "../state/field";
import type { Player } from "../state/entities";
import { SITE } from "../content/params/sites";
import { CHEST } from "../content/params/combat";
import { enemies } from "../content/enemies";
import { zoneScaling } from "../director";
import { damagePlayer } from "../hurt";
import { next } from "../rng";
import { chestOf, inCircle } from "../skills/kit";
import { lineOfFire } from "../sight";
import { heightAt } from "../terrain";
import { begin, berries, finish, rewardItem } from "./shared";

export function interact(world: World, site: Site, player: Player): void {
  if (site.data.trap) {
    begin(world, site, player, SITE.balls.warning);
    return;
  }
  site.owner = player.id;
  finish(world, site);
  const roll = next(world.rng);
  if (roll < SITE.rewards.ballItemShare) rewardItem(world, player);
  else if (roll < SITE.rewards.ballItemShare + SITE.rewards.ballBerryShare) berries(world, site);
  else
    world.pickups.push({
      id: world.nextId++,
      kind: "stardust",
      x: site.x,
      z: site.z,
      value: SITE.rewards.ballStardust,
      magnet: false,
    });
}

/** The revealed ball stays at the marked position throughout its warning, then self-destructs. */
export function update(world: World, site: Site): void {
  if (world.time < site.until) return;
  const ground = heightAt(world.map.terrain, site.x, site.z);
  const damage = enemies.voltorb.dmg * zoneScaling(world).dmg * SITE.balls.damage;
  finish(world, site);
  for (const player of world.players)
    if (
      inCircle(world, site.x, site.z, SITE.balls.blastRadius, player, ground) &&
      lineOfFire(world, site.x, ground + CHEST, site.z, player.x, chestOf(world, player), player.z)
    )
      damagePlayer(world, player, damage);
  world.events.push({ t: "death", species: "voltorb", x: site.x, z: site.z, elite: false });
}
