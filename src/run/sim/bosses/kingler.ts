import { KINGLER, BOSS_CHASE_MIN } from "../content/params/guardian";
import { enemies as enemyDefs } from "../content/enemies";
import { difficulties } from "../content/difficulties";
import { formOf } from "../evolution";
import { steerToward } from "../enemies";
import { hasWalkableLine } from "../nav/index";
import { aimHeight, lineOfFire } from "../sight";
import { BUBBLE, ROCKFALL } from "../content/params/enemy-skills";
import { addHazard, bodyY, enter, tell } from "../skills/kit";
import { attacksBlocked } from "../status";
import { heightAt } from "../terrain";
import { TICK, type World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { cos, hypot, sin } from "../math";
import { resumeChase } from "./scyther";

/** What the current wind-up is, kept in `attackTimer`. */
const HAMMER = 1;
const BUBBLES = 2;
const RUSH = 3;

/**
 * Kingler: chase → windup (hammer circle, rush lane, or the bubbles' tell on the move) → dash (the
 * rush) → recover. Below half the rush comes first and chains into the hammer; `strikes` counts the
 * rushes left. Paralysis keeps it from starting an attack, a chained rush or the closing hammer.
 */
export function kinglerBrain(
  world: World,
  boss: Enemy,
  target: Player,
  speed: number,
  dt: number,
): [number, number, number] {
  boss.phaseTime += dt;
  const tele = difficulties[world.difficulty].bossTelegraph;
  switch (boss.phase) {
    case "chase": {
      if (boss.phaseTime > BOSS_CHASE_MIN && !attacksBlocked(boss)) {
        const distance = hypot(target.x - boss.x, target.z - boss.z);
        const low = boss.hp < boss.maxHp * KINGLER.below;
        if (low && distance < KINGLER.sideRange && walkable(world, boss, target)) {
          boss.strikes = KINGLER.sideDashes - 1;
          rush(world, boss, target, tele);
        } else if (distance < KINGLER.hammerRange) hammer(world, boss, target, tele);
        else if (distance > KINGLER.bubbleMin && distance < KINGLER.bubbleMax) {
          enter(boss, "windup");
          boss.attackTimer = BUBBLES;
          tell(world, boss, "danger", KINGLER.bubbleWindup * tele);
        }
      }
      const heading = steerToward(world, boss, target);
      return [heading.x, heading.z, speed];
    }
    case "windup":
      if (boss.attackTimer === BUBBLES) {
        if (boss.phaseTime > KINGLER.bubbleWindup * tele) {
          bubbleBeam(world, boss, target);
          resumeChase(world, boss);
        }
        const heading = steerToward(world, boss, target);
        return [heading.x, heading.z, speed];
      }
      if (boss.attackTimer === RUSH) {
        if (boss.phaseTime > KINGLER.sideWindup * tele) enter(boss, "dash");
      } else if (boss.phaseTime > KINGLER.hammerWindup * tele) enter(boss, "recover");
      return [boss.dashX, boss.dashZ, 0];
    case "dash":
      if (boss.phaseTime > KINGLER.sideTime) {
        if (attacksBlocked(boss)) {
          boss.strikes = 0;
          enter(boss, "recover");
        } else if (boss.strikes > 0) {
          boss.strikes -= 1;
          rush(world, boss, target, tele);
        } else hammer(world, boss, target, tele);
        return [0, 0, 0];
      }
      return [
        boss.dashX,
        boss.dashZ,
        (KINGLER.sideLength / KINGLER.sideTime) * (speed / boss.speed),
      ];
    case "under":
    case "recover":
      if (boss.phaseTime > KINGLER.hammerRecover * tele) resumeChase(world, boss);
      return [0, 0, 0];
  }
}

function walkable(world: World, boss: Enemy, target: Player): boolean {
  const { mobility } = enemyDefs[boss.species];
  return hasWalkableLine(world.nav, mobility, boss.x, boss.z, target.x, target.z);
}

function face(boss: Enemy, target: Player): void {
  const dx = target.x - boss.x;
  const dz = target.z - boss.z;
  const distance = hypot(dx, dz);
  if (distance === 0) return;
  boss.dashX = dx / distance;
  boss.dashZ = dz / distance;
}

/** The claw's circle in front of it, on the ground it will strike. */
function hammer(world: World, boss: Enemy, target: Player, tele: number): void {
  face(boss, target);
  enter(boss, "windup");
  boss.attackTimer = HAMMER;
  const windup = KINGLER.hammerWindup * tele;
  const x = boss.x + boss.dashX * KINGLER.hammerOffset;
  const z = boss.z + boss.dashZ * KINGLER.hammerOffset;
  addHazard(world, {
    kind: "crabhammer",
    x,
    y: heightAt(world.map.terrain, x, z),
    z,
    life: windup + ROCKFALL.residue + TICK,
    radius: KINGLER.hammerRadius,
    dmg: boss.dmg * KINGLER.hammerDamage,
    caster: boss.id,
  });
  tell(world, boss, "danger", windup);
}

/** A lane through the target's spot and on past it: the crab rushes across where the player stands. */
function rush(world: World, boss: Enemy, target: Player, tele: number): void {
  face(boss, target);
  enter(boss, "windup");
  boss.attackTimer = RUSH;
  const windup = KINGLER.sideWindup * tele;
  addHazard(world, {
    kind: "dash-warn",
    x: boss.x,
    y: 0,
    z: boss.z,
    life: windup,
    radius: boss.radius,
    dirX: boss.dashX,
    dirZ: boss.dashZ,
    length: KINGLER.sideLength,
  });
  tell(world, boss, "danger", windup);
}

/** Seven slow bubbles fanned at the target, when it has a line onto the target's body. */
function bubbleBeam(world: World, boss: Enemy, target: Player): void {
  const distance = hypot(target.x - boss.x, target.z - boss.z) || 1;
  const y = bodyY(world, boss);
  const goal = aimHeight(heightAt(world.map.terrain, target.x, target.z), formOf(target).height, y);
  if (!lineOfFire(world, boss.x, y, boss.z, target.x, goal, target.z)) return;
  const dx = (target.x - boss.x) / distance;
  const dz = (target.z - boss.z) / distance;
  for (let i = 0; i < KINGLER.bubbles; i++) {
    const angle = (i - (KINGLER.bubbles - 1) / 2) * KINGLER.bubbleSpread;
    const c = cos(angle);
    const s = sin(angle);
    addHazard(world, {
      kind: "bubble",
      x: boss.x,
      y,
      z: boss.z,
      vx: (dx * c - dz * s) * BUBBLE.speed,
      vy: ((goal - y) / distance) * BUBBLE.speed,
      vz: (dx * s + dz * c) * BUBBLE.speed,
      life: BUBBLE.life,
      radius: BUBBLE.radius * KINGLER.bubbleRadius,
      dmg: boss.dmg * KINGLER.bubbleDamage,
    });
  }
}
