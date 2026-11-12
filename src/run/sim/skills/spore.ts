import { ENEMY_SKILL_RELOAD, SPORE, BUBBLE } from "../content/params/enemy-skills";
// Oddish's spores and Poliwag's bubbles: no wind-up, so nothing to tell; the slow shots are themselves
// the warning. Poliwhirl fires its bubbles in a short burst.

import { formOf } from "../evolution";
import { predictTarget } from "../enemy-aim";
import { range } from "../rng";
import { aimHeight, lineOfFire } from "../sight";
import { attacksBlocked } from "../status";
import { heightAt } from "../terrain";
import type { World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { cos, hypot, sin } from "../math";
import { addHazard, bodyY, enter, type HazardRule } from "./kit";
import type { SkillDef } from "./index";

type SlowShot = typeof SPORE | typeof BUBBLE;

/** One volley at the target (a fan for elites), or nothing without a line onto its body. */
function volley(world: World, enemy: Enemy, target: Player, kind: "spore" | "bubble"): boolean {
  const shot: SlowShot = kind === "spore" ? SPORE : BUBBLE;
  const distanceNow = hypot(target.x - enemy.x, target.z - enemy.z);
  if (distanceNow > shot.range) return false;
  target = predictTarget(world, enemy, target, distanceNow / shot.speed);
  const distance = hypot(target.x - enemy.x, target.z - enemy.z) || 1;
  if (distance > shot.range) return false;
  // Like the player's auto-aim, a shooter holds fire until it has a line onto the target's body.
  const { terrain } = world.map;
  const y = bodyY(world, enemy);
  const goal = aimHeight(heightAt(terrain, target.x, target.z), formOf(target).height, y);
  if (!lineOfFire(world, enemy.x, y, enemy.z, target.x, goal, target.z)) return false;
  const dx = (target.x - enemy.x) / distance;
  const dz = (target.z - enemy.z) / distance;
  const vy = ((goal - y) / distance) * shot.speed;
  const shots = enemy.elite ? shot.elite : 1;
  for (let i = 0; i < shots; i++) {
    const angle = (i - (shots - 1) / 2) * shot.spread;
    const c = cos(angle);
    const s = sin(angle);
    addHazard(world, {
      kind,
      x: enemy.x,
      y,
      z: enemy.z,
      vx: (dx * c - dz * s) * shot.speed,
      vy,
      vz: (dx * s + dz * c) * shot.speed,
      life: shot.life,
      radius: shot.radius,
      dmg: enemy.dmg * shot.dmg,
    });
  }
  return true;
}

/** Paralysis pauses the reload (and a burst); sleep does not stop a volley. */
function slowShots(kind: "spore" | "bubble", burst: number): SkillDef {
  const shot: SlowShot = kind === "spore" ? SPORE : BUBBLE;
  return {
    range: shot.range,
    partner: { style: "shot" },
    step(world, enemy, target, _speed, dt, every) {
      if (attacksBlocked(enemy)) return null;
      if (enemy.phase === "windup") {
        // The burst's later volleys, `gap` apart, each aimed afresh.
        const before = enemy.phaseTime;
        enemy.phaseTime += dt;
        for (let k = 1; k < burst; k++) {
          const at = k * BUBBLE.gap;
          if (before < at && enemy.phaseTime >= at) volley(world, enemy, target, kind);
        }
        if (enemy.phaseTime >= (burst - 1) * BUBBLE.gap) enter(enemy, "chase");
        return null;
      }
      enemy.attackTimer -= dt;
      if (enemy.attackTimer > 0 || !volley(world, enemy, target, kind)) return null;
      enemy.attackTimer = every * range(world.rng, ...ENEMY_SKILL_RELOAD);
      if (burst > 1) enter(enemy, "windup");
      return null;
    },
  };
}

export const spore = slowShots("spore", 1);
export const bubble = slowShots("bubble", 1);
export const bubbleBurst = slowShots("bubble", BUBBLE.burst);

export const hazards = {
  spore: { poison: SPORE.poison },
  bubble: {},
} satisfies Record<string, HazardRule>;
