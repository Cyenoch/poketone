import { ENEMY_DODGE as N } from "./content/params/enemy-ai";
import { enemies } from "./content/enemies";
import { routeProgress } from "./content/campaign";
import { hasWalkableLine, moveWithSlope } from "./nav/index";
import { enemyFeet, enemyHeight, lineOfFire } from "./sight";
import { hypot } from "./math";
import { interrupted, attacksBlocked } from "./status";
import type { Enemy } from "./state/entities";
import type { World } from "./state/world";
import type { EnemyGrid } from "./grid";

interface Threat {
  id: number;
  x: number;
  z: number;
  at: number;
}

function capable(enemy: Enemy): boolean {
  return (
    !!N.species[enemy.species] &&
    enemy.hp > 0 &&
    enemy.phase === "chase" &&
    !enemy.charge &&
    !interrupted(enemy) &&
    !attacksBlocked(enemy)
  );
}

/** Attack-to-enemy broad phase: every third tick, only near the actual attack segment. */
export function dodgeThreats(world: World, grid: EnemyGrid): Map<number, Threat> {
  const threats = new Map<number, Threat>();
  if (world.tick % N.scanTicks !== 0) return threats;
  const offer = (enemy: Enemy, threat: Threat) => {
    if (!capable(enemy) || world.time < (enemy.dodge?.next ?? 0)) return;
    const before = threats.get(enemy.id);
    if (!before || threat.at < before.at) threats.set(enemy.id, threat);
  };
  for (const shot of world.projectiles) {
    if (shot.delay > 0 || shot.life <= 0) continue;
    const speed2 = shot.vx * shot.vx + shot.vz * shot.vz;
    if (speed2 === 0) continue;
    const window = Math.min(N.lookAhead, shot.life);
    const length = Math.sqrt(speed2) * window;
    grid.query(
      shot.x + (shot.vx * window) / 2,
      shot.z + (shot.vz * window) / 2,
      length / 2 + shot.radius + 1.4,
      (enemy) => {
        if (!capable(enemy) || shot.hit.includes(enemy.id)) return;
        const t = ((enemy.x - shot.x) * shot.vx + (enemy.z - shot.z) * shot.vz) / speed2;
        if (t <= 0 || t > window) return;
        const x = shot.x + shot.vx * t,
          z = shot.z + shot.vz * t;
        if (hypot(enemy.x - x, enemy.z - z) > enemy.radius + shot.radius) return;
        const feet = enemyFeet(world.map.terrain, enemy),
          y = shot.y + shot.vy * t;
        if (y < feet - shot.radius || y > feet + enemyHeight(enemy) + shot.radius) return;
        if (!lineOfFire(world, shot.x, shot.y, shot.z, x, y, z)) return;
        // Move perpendicular to the projectile, away from its centre line.
        const speed = Math.sqrt(speed2),
          side = (enemy.x - x) * -shot.vz + (enemy.z - z) * shot.vx;
        const sign = side === 0 ? (enemy.id % 2 ? 1 : -1) : side > 0 ? 1 : -1;
        offer(enemy, {
          id: shot.id,
          x: (-shot.vz / speed) * sign,
          z: (shot.vx / speed) * sign,
          at: t,
        });
      },
    );
  }
  for (const area of world.areas) {
    // Fixed sky-strike warnings are visible and escapable; instant melee gives no reaction window.
    if (area.kind !== "smite" || area.delay <= 0 || area.life <= 0) continue;
    grid.query(area.x, area.z, area.radius + 1.4, (enemy) => {
      const dx = enemy.x - area.x,
        dz = enemy.z - area.z,
        d = hypot(dx, dz);
      if (d > area.radius + enemy.radius) return;
      const sign = enemy.id % 2 ? 1 : -1;
      offer(enemy, { id: area.id, x: d ? dx / d : sign, z: d ? dz / d : 0, at: area.delay });
    });
  }
  return threats;
}

/** Returns a movement override, leaving damage and all collision rules untouched. */
export function dodgeStep(
  world: World,
  enemy: Enemy,
  threats: Map<number, Threat>,
  speed: number,
): [number, number, number] | null {
  const state = enemy.dodge;
  if (!capable(enemy)) {
    if (state) {
      state.until = 0;
      state.threat = 0;
    }
    return null;
  }
  if (state && state.until > world.time) return [state.x, state.z, speed * N.speed];
  if (state && state.next > world.time) return null;
  if (world.tick % N.scanTicks !== 0) return null;
  const threat = threats.get(enemy.id);
  if (!threat) {
    if (state) state.threat = 0;
    return null;
  }
  const quality = N.species[enemy.species]!;
  const progress = routeProgress(world);
  const reaction = (N.reactionEarly + (N.reactionLate - N.reactionEarly) * progress) / quality;
  if (!state || state.threat !== threat.id) {
    enemy.dodge = {
      threat: threat.id,
      ready: world.time + reaction,
      until: 0,
      next: 0,
      x: 0,
      z: 0,
    };
    return null;
  }
  if (world.time < state.ready) return null;
  const { mobility } = enemies[enemy.species];
  for (const sign of [1, -1]) {
    const dx = threat.x * sign,
      dz = threat.z * sign;
    const destination = { x: enemy.x, z: enemy.z, radius: enemy.radius };
    moveWithSlope(world.nav, mobility, destination, dx * N.distance, dz * N.distance);
    if (hypot(destination.x - enemy.x, destination.z - enemy.z) < N.distance * 0.8) continue;
    if (!hasWalkableLine(world.nav, mobility, enemy.x, enemy.z, destination.x, destination.z))
      continue;
    state.x = dx;
    state.z = dz;
    state.until = world.time + Math.min(N.duration, N.distance / Math.max(0.01, speed * N.speed));
    state.next =
      world.time + (N.cooldownEarly + (N.cooldownLate - N.cooldownEarly) * progress) / quality;
    return [dx, dz, speed * N.speed];
  }
  state.threat = 0;
  return null;
}
