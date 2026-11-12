import { HEAL_PULSE } from "../content/params/enemy-skills";
// Clefairy's heal pulse: a green ring that mends the enemies around it. Never hurts a player and is
// never a tell (docs/state-machines/simulation.md). Healers pulse together on the world clock, and an enemy
// inside several rings is mended once, by the lowest-id healer covering it.

import { enemies as enemyDefs } from "../content/enemies";
import { attacksBlocked, interrupted } from "../status";
import { TICK, type World } from "../state/world";
import type { Enemy } from "../state/entities";
import { hypot } from "../math";
import type { SkillDef } from "./index";

function pulsing(enemy: Enemy): boolean {
  return (
    enemy.hp > 0 &&
    enemyDefs[enemy.species].skill?.kind === "heal-pulse" &&
    !interrupted(enemy) &&
    !attacksBlocked(enemy)
  );
}

/** From where the healer stood this tick: an earlier healer has already moved by the time a later one pulses. */
const covers = (healer: Enemy, enemy: Enemy) =>
  hypot(enemy.x - healer.px, enemy.z - healer.pz) <= HEAL_PULSE.radius;

function pulse(world: World, healer: Enemy): void {
  world.events.push({
    t: "heal-pulse",
    enemy: healer.id,
    x: healer.px,
    z: healer.pz,
    radius: HEAL_PULSE.radius,
  });
  const earlier = world.enemies.filter(
    (other) => other.id < healer.id && other !== healer && pulsing(other),
  );
  for (const enemy of world.enemies) {
    if (enemy === healer || enemy.boss || enemy.hp <= 0 || enemy.hp >= enemy.maxHp) continue;
    // An earlier healer covering it mends it, unless that healer is the enemy itself.
    if (!covers(healer, enemy) || earlier.some((o) => o !== enemy && covers(o, enemy))) continue;
    const share = HEAL_PULSE.share * (enemy.elite ? HEAL_PULSE.elite : 1);
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * share);
  }
}

export const healPulse: SkillDef = {
  range: HEAL_PULSE.radius,
  partner: { style: "pulse" },
  step(world, enemy, _target, _speed, _dt, every) {
    if (pulsing(enemy) && world.tick % Math.round(every / TICK) === 0) pulse(world, enemy);
    return null;
  },
};
