// Bolts: one straight shot per target in range, nearest first; spare shots fan out from the last aim.

import { BOLT } from "../content/params/archetypes";
import type { Ctx } from "../combat";
import type { MoveDef } from "../content/moves";
import type { Player } from "../state/entities";
import {
  acquire,
  aim,
  chestOf,
  piercing,
  projectile,
  rotate,
  type ArchetypeDef,
  type MoveParams,
} from "./kit";

/** Fires the volley with shot bodies of `radius`; false when nothing is in range. */
export function volley(
  ctx: Ctx,
  player: Player,
  def: MoveDef,
  p: MoveParams,
  radius: number,
): boolean {
  const { world } = ctx;
  const { terrain } = world.map;
  const eye = chestOf(terrain, player);
  const targets = acquire(world, player, p.count);
  if (targets.length === 0) return false;
  for (let i = 0; i < p.count; i++) {
    const target = targets[i % targets.length];
    let [dx, dz, rise] = aim(terrain, player, eye, target);
    if (i >= targets.length) [dx, dz] = rotate(dx, dz, (i - targets.length + 1) * BOLT.fan);
    const shot = projectile(world, player, def, p, [dx, dz, rise], eye, i * BOLT.stagger);
    shot.radius = radius;
    world.projectiles.push(shot);
  }
  return true;
}

export const bolt: ArchetypeDef = {
  cast: (ctx, player, def, p) => volley(ctx, player, def, p, p.area),
  shot: piercing,
};
