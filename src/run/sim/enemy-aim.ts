import { ENEMY_AIM } from "./content/params/enemy-ai";
import { routeProgress } from "./content/campaign";
import { mobilityClasses } from "./content/mobility";
import { formOf } from "./evolution";
import { hypot } from "./math";
import { moveWithSlope } from "./nav/index";
import { currentStats } from "./stats";
import type { Enemy, Player } from "./state/entities";
import type { World } from "./state/world";

/** Observed velocity only; cap dash extrapolation and slide the real body along reachable ground. */
export function predictTarget(world: World, enemy: Enemy, target: Player, seconds: number): Player {
  const velocity = hypot(target.vx, target.vz);
  if (velocity === 0 || !target.alive || target.rescue) return target;
  const n = ENEMY_AIM;
  const quality = n.species[enemy.species] ?? (enemy.boss ? n.guardian : n.ordinary);
  const time =
    Math.min(n.maxSeconds, seconds) *
    quality *
    (n.early + (n.late - n.early) * routeProgress(world));
  const distance = Math.min(n.maxDistance, Math.min(velocity, currentStats(target).speed) * time);
  const point = { x: target.x, z: target.z, radius: formOf(target).radius };
  moveWithSlope(
    world.nav,
    mobilityClasses.ground,
    point,
    (target.vx / velocity) * distance,
    (target.vz / velocity) * distance,
  );
  return { ...target, x: point.x, z: point.z };
}
