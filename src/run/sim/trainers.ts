import { trainerKits } from "./content/trainers";
import { TRAINER } from "./content/params/trainers";
import { heal } from "./combat";
import { currentStats, refreshStats } from "./stats";
import type { Player } from "./state/entities";
import { TICK, type World } from "./state/world";

/** Seconds until the item is back, on the sim's tick grid: accumulated seconds can drift just
 *  below the ready tick, so both times are rounded to ticks. Zero when it can be thrown. */
export const assistLeft = (time: number, ready: number) =>
  Math.max(0, Math.round(ready / TICK) - Math.round(time / TICK)) * TICK;

/** Settled by the shared simulation. The command carries no item or target list. */
export function activateAssist(world: World, player: Player): void {
  if (assistLeft(world.time, player.assistReady) > 0) return;
  const item = trainerKits[player.trainer].assist;
  player.assistReady = world.time + TRAINER.cooldown;
  const to: Player["id"][] = [];
  for (const target of world.players) {
    if (
      !target.alive ||
      (target.x - player.x) ** 2 + (target.z - player.z) ** 2 > TRAINER.radius ** 2
    )
      continue;
    if (item === "superPotion") heal(target, currentStats(target).maxHp * TRAINER.superPotion.hp);
    else {
      if (item === "fullHeal") target.statuses.length = 0;
      target.assistBuffs[item] = TRAINER[item].seconds;
    }
    to.push(target.id);
  }
  refreshStats();
  world.events.push({ t: "assist", player: player.id, item, x: player.x, z: player.z, to });
}

export function decayAssistBuffs(player: Player, dt: number): void {
  for (const id of ["xSpeed", "direHit", "fullHeal"] as const) {
    const left = player.assistBuffs[id];
    if (left === undefined) continue;
    const next = Math.round((left - dt) / TICK) * TICK;
    if (next > 0) player.assistBuffs[id] = next;
    else {
      delete player.assistBuffs[id];
      refreshStats();
    }
  }
}
