// Lobbed shells: a ballistic arc onto the target's ground point, then the shared `burst`. The arc
// clears low ridges a straight shot can't; whatever terrain or solid prop it does meet, it bursts
// there (sight.ts `stopAtCover`). Shells never hit bodies in flight.

import { LOB } from "../content/params/archetypes";
import { range } from "../rng";
import { stopAtCover } from "../sight";
import { targetable } from "../status";
import { heightAt } from "../terrain";
import { TICK, type World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { explode } from "./burst";
import { aimable, chestOf, projectile, type ArchetypeDef } from "./kit";

/**
 * Up to `count` living on-screen enemies in range, nearest first. No line of sight: the arc goes over
 * cover.
 */
function lobTargets(world: World, player: Player, count: number): Enemy[] {
  const { x, z } = player;
  const limit = LOB.range ** 2;
  return world.enemies
    .filter(
      (enemy) =>
        enemy.hp > 0 &&
        targetable(enemy) &&
        (enemy.x - x) ** 2 + (enemy.z - z) ** 2 <= limit &&
        aimable(world, player, enemy),
    )
    .sort((a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2))
    .slice(0, count);
}

/** Where shell `i` lands: its own target, or a scattered spot around one when shells outnumber targets. */
function lobPoint(world: World, targets: readonly Enemy[], i: number): [number, number] {
  const target = targets[i % targets.length]!;
  if (i < targets.length) return [target.x, target.z];
  return [
    target.x + range(world.rng, -LOB.scatter, LOB.scatter),
    target.z + range(world.rng, -LOB.scatter, LOB.scatter),
  ];
}

/**
 * Launch velocity that lands on the ground at (toX, toZ) after `LOB.flight` seconds, solved for the
 * sim's integration (gravity applied each tick before the move).
 */
function lobVelocity(
  world: World,
  x: number,
  y: number,
  z: number,
  toX: number,
  toZ: number,
): [number, number, number] {
  const t = LOB.flight;
  const drop = heightAt(world.map.terrain, toX, toZ) - y;
  return [(toX - x) / t, drop / t + (LOB.gravity * (t + TICK)) / 2, (toZ - z) / t];
}

export const lob: ArchetypeDef = {
  heavy: true,
  launch: "chest",
  cast(ctx, player, def, p) {
    const { world } = ctx;
    const eye = chestOf(world.map.terrain, player);
    const targets = lobTargets(world, player, p.count);
    if (targets.length === 0) return false;
    for (let i = 0; i < p.count; i++) {
      const [tx, tz] = lobPoint(world, targets, i);
      const shot = projectile(world, player, def, p, [0, 0, 0], eye, 0);
      [shot.vx, shot.vy, shot.vz] = lobVelocity(world, player.x, eye, player.z, tx, tz);
      // Outlives the flight so a shell falling past a ledge still lands.
      shot.life = LOB.flight + LOB.fallGrace;
      shot.radius = LOB.shell;
      world.projectiles.push(shot);
    }
    return true;
  },
  shot: {
    steer(_ctx, shot, dt) {
      shot.vy -= LOB.gravity * dt;
    },
    land(ctx, shot, owner) {
      stopAtCover(ctx.world, shot);
      if (shot.life <= 0 && shot.hit.length === 0) explode(ctx, owner, shot);
    },
  },
};
