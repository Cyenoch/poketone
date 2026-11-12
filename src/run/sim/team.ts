import type { Player, PlayerId } from "./state/entities";
import type { World } from "./state/world";

/** Players still in the run; a guest who left no longer scales the stage. */
export function teamSize(world: World): number {
  let size = 0;
  for (const player of world.players) if (!player.departed) size++;
  return size;
}

/** Players who share rewards and pressure; a departed guest is gone, not downed. */
export function present(world: World): Player[] {
  return world.players.filter((player) => !player.departed);
}

/** A guest left a co-op run for good: their body leaves the field, no revive or rescue returns it. */
export function departPlayer(world: World, id: PlayerId): void {
  const player = world.players[id]!;
  if (player.departed) return;
  player.departed = true;
  player.alive = false;
  player.hp = 0;
  player.revives = 0;
  player.rescue = null;
  player.dialog = null;
  player.pending = [];
  player.inputX = player.inputZ = 0;
  player.moving = false;
  for (const other of world.players) if (other.rescue?.target === id) other.rescue = null;
  world.partners = world.partners.filter((partner) => partner.owner !== id);
  world.projectiles = world.projectiles.filter((shot) => shot.owner !== id);
  world.areas = world.areas.filter((area) => area.owner !== id);
}
