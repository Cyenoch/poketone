import { COOP } from "./content/params/coop";
import { hypot } from "./math";
import { playerStats } from "./stats";
import type { Player } from "./state/entities";
import type { World } from "./state/world";

/** Stable nearest downed teammate; personal revives take priority. */
export function rescueTarget(world: World, rescuer: Player): Player | undefined {
  if (!rescuer.alive || rescuer.dialog || rescuer.choosing) return;
  let target: Player | undefined;
  let distance: number = COOP.rescueReach;
  for (const player of world.players) {
    if (player.alive || player.departed || player.revives > 0 || player.id === rescuer.id) continue;
    const d = hypot(player.x - rescuer.x, player.z - rescuer.z);
    if (d <= distance) {
      target = player;
      distance = d;
    }
  }
  return target;
}

/** R/tap starts a channel; movement, dash, ultimate or another tap cancels it. A hit does not. */
export function startRescue(world: World, player: Player): boolean {
  const target = rescueTarget(world, player);
  if (!target) return false;
  if (player.inputX !== 0 || player.inputZ !== 0) return true;
  player.rescue = { target: target.id, elapsed: 0 };
  player.vx = player.vz = player.dashTime = 0;
  player.moving = false;
  player.ult.elapsed = -1;
  return true;
}

export function revivePlayer(
  world: World,
  player: Player,
  hp: number,
  invulnerable: number,
  source: "personal" | "team",
): void {
  player.alive = true;
  player.hp = playerStats(player).maxHp * hp;
  player.invulnerable = invulnerable;
  player.statuses = [];
  player.rescue = null;
  if (world.players.length > 1) {
    player.vx = player.vz = player.dashTime = 0;
    player.moving = false;
  }
  world.events.push(
    source === "team"
      ? { t: "revive", player: player.id, team: true }
      : { t: "revive", player: player.id },
  );
}

/** After damage and personal revives: the rescuer falling or the target leaving reach ends the channel. */
export function updateRescues(world: World, dt: number): void {
  for (const player of world.players) {
    const rescue = player.rescue;
    if (!rescue) continue;
    const target = world.players.find((candidate) => candidate.id === rescue.target);
    if (
      !player.alive ||
      !target ||
      target.alive ||
      hypot(player.x - target.x, player.z - target.z) > COOP.rescueReach
    ) {
      player.rescue = null;
      continue;
    }
    rescue.elapsed += dt;
    if (rescue.elapsed < COOP.rescueSeconds) continue;
    revivePlayer(world, target, COOP.reviveHp, COOP.invulnerable, "team");
    player.rescue = null;
  }
}
