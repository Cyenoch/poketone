import { totalDanger } from "./content/rules";
import { DANGER_STARDUST } from "./content/params/rules";
import type { Player } from "./state/entities";
import type { World } from "./state/world";

export function seatOutcome(world: World, player: Player, outcome = world.outcome) {
  return outcome === "victory" && !player.alive && world.rules.includes("nuzlocke")
    ? "defeat"
    : outcome;
}

export function challengePayout(world: World, player: Player) {
  const danger = totalDanger(world.rules);
  const bonus = player.stardust * danger * DANGER_STARDUST;
  return { danger, stardust: Math.floor(player.stardust + bonus) };
}
