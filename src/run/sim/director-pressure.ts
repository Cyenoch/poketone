import { present } from "./team";
import { DIRECTOR_PRESSURE as P } from "./content/params/pacing";
import { zoneTime } from "./currentZone";
import { exp } from "./math";
import type { World } from "./state/world";
import { currentStats } from "./stats";

/** A recent hit matters more when little HP remains; low HP alone is not permanent relief. */
export function pressureTarget(nearby: number, health: number, recentHit: number): number {
  return Math.min(1, Math.max(nearby / P.bodies, recentHit * (1 - health / 2)));
}

/** Exponential response keeps simulation ticks and the model's longer steps on the same curve. */
export function advancePressure(value: number, target: number, dt: number): number {
  const seconds = target > value ? P.riseSeconds : P.fallSeconds;
  return target + (value - target) * exp(-dt / seconds);
}

/** Opening/entry protection fades into bounded supply; the midpoint is always neutral. */
export function pressureSupply(pressure: number, time: number, zone: number): number {
  const start = zone === 0 ? P.openingSeconds : P.zoneGraceSeconds;
  const blend = Math.max(0, Math.min(1, (time - start) / P.blendSeconds));
  const shift = pressure - 0.5;
  const adjustment = shift < 0 ? -2 * shift * (P.maxSupply - 1) : 2 * shift * (P.minSupply - 1);
  return 1 + adjustment * blend;
}

/** Host/shared simulation owns this state; a camera or an owner-player update cannot change it. */
export function updateSpawnPressure(world: World, dt: number): number {
  const time = zoneTime(world);
  const opening = world.zone.index === 0 ? P.openingSeconds : P.zoneGraceSeconds;
  if (time <= opening || world.bossId !== null || world.rampage) {
    world.spawn.pressure = 0.5;
    return 1;
  }
  let target = 0;
  for (const player of present(world)) {
    if (!player.alive) {
      target = 1;
      break;
    }
    let nearby = 0;
    for (const enemy of world.enemies) {
      if (enemy.hp <= 0) continue;
      const distance2 = (enemy.x - player.x) ** 2 + (enemy.z - player.z) ** 2;
      nearby +=
        Math.max(0, 1 - distance2 / (P.radius * P.radius)) * (enemy.elite ? P.eliteWeight : 1);
    }
    const health = Math.min(1, player.hp / currentStats(player).maxHp);
    const recentHit = Math.max(0, 1 - (world.time - player.lastHurt) / P.hitMemory);
    target = Math.max(target, pressureTarget(nearby, health, recentHit));
  }
  world.spawn.pressure = advancePressure(world.spawn.pressure, target, dt);
  return pressureSupply(world.spawn.pressure, time, world.zone.index);
}
