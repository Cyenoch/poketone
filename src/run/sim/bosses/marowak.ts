import { MAROWAK, BOSS_CHASE_MIN, STOMP } from "../content/params/guardian";
import { difficulties } from "../content/difficulties";
import { steerToward } from "../enemies";
import { attacksBlocked } from "../status";
import { heightAt } from "../terrain";
import { boneLane, bonesOut, throwBone } from "../skills/boomerang";
import { addHazard, enter, tell } from "../skills/kit";
import { TICK, type World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { atan2, cos, hypot, sin } from "../math";
import { resumeChase } from "./scyther";

/** What the current wind-up / recovery is, kept in `attackTimer`. */
const THROW = 1;
const CLUB = 2;
const RING = 3;

/**
 * Marowak: chase → windup (bone lanes or the club's circle) → dash (bones in flight: it walks after
 * the target but throws nothing until every bone is back) → chase; the club goes windup → recover.
 * Paralysis keeps it from starting an attack or the ring after a club.
 */
export function marowakBrain(
  world: World,
  boss: Enemy,
  target: Player,
  speed: number,
  dt: number,
): [number, number, number] {
  boss.phaseTime += dt;
  const tele = difficulties[world.difficulty].bossTelegraph;
  const low = boss.hp < boss.maxHp * MAROWAK.below;
  switch (boss.phase) {
    case "chase": {
      const distance = hypot(target.x - boss.x, target.z - boss.z);
      if (
        boss.phaseTime > BOSS_CHASE_MIN &&
        !attacksBlocked(boss) &&
        !bonesOut(world, boss) &&
        distance < MAROWAK.range
      ) {
        if (distance < MAROWAK.clubRange) club(world, boss, MAROWAK.clubWindup * tele);
        else lanes(world, boss, target, low, MAROWAK.windup * tele);
      }
      const heading = steerToward(world, boss, target);
      return [heading.x, heading.z, speed];
    }
    case "windup":
      if (boss.attackTimer === THROW) {
        if (boss.phaseTime > MAROWAK.windup * tele) {
          for (const angle of throwAngles(low))
            throwBone(world, boss, ...turned(boss, angle), MAROWAK.length, bonesDmg(boss));
          enter(boss, "dash");
        }
      } else if (boss.phaseTime > MAROWAK.clubWindup * tele + STOMP.active) {
        enter(boss, "recover");
        if (low && !attacksBlocked(boss)) {
          boss.attackTimer = RING;
          for (let i = 0; i < MAROWAK.ringBones; i++) {
            const angle = (i / MAROWAK.ringBones) * Math.PI * 2;
            throwBone(world, boss, cos(angle), sin(angle), MAROWAK.ringLength, bonesDmg(boss));
          }
        }
      }
      return [boss.dashX, boss.dashZ, 0];
    case "dash": {
      // Bones in flight: it keeps walking, and the bones come back to where it is.
      if (!bonesOut(world, boss)) resumeChase(world, boss);
      const heading = steerToward(world, boss, target);
      return [heading.x, heading.z, speed];
    }
    case "recover": {
      if (boss.attackTimer === RING && bonesOut(world, boss)) boss.phaseTime = 0;
      const rest = boss.attackTimer === RING ? MAROWAK.ringRecover : MAROWAK.clubRecover;
      if (boss.phaseTime > rest * tele) resumeChase(world, boss);
      return [0, 0, 0];
    }
    // Guardians never burrow.
    case "under":
      resumeChase(world, boss);
      return [0, 0, 0];
  }
}

const bonesDmg = (boss: Enemy) => boss.dmg * MAROWAK.damage;
const throwAngles = (low: boolean) => (low ? [-MAROWAK.spread, MAROWAK.spread] : [0]);

/** The locked heading turned by `angle` radians. */
function turned(boss: Enemy, angle: number): [number, number] {
  const heading = atan2(boss.dashZ, boss.dashX) + angle;
  return [cos(heading), sin(heading)];
}

function lanes(world: World, boss: Enemy, target: Player, low: boolean, windup: number): void {
  const dx = target.x - boss.x;
  const dz = target.z - boss.z;
  const distance = hypot(dx, dz) || 1;
  enter(boss, "windup");
  boss.attackTimer = THROW;
  boss.dashX = dx / distance;
  boss.dashZ = dz / distance;
  for (const angle of throwAngles(low))
    boneLane(world, boss, ...turned(boss, angle), MAROWAK.length, windup);
  tell(world, boss, "danger", windup);
}

/** The club's circle is Nidoking's stomp rule at Marowak's radius. */
function club(world: World, boss: Enemy, windup: number): void {
  enter(boss, "windup");
  boss.attackTimer = CLUB;
  addHazard(world, {
    kind: "stomp",
    x: boss.x,
    y: heightAt(world.map.terrain, boss.x, boss.z),
    z: boss.z,
    life: windup + STOMP.active + TICK,
    radius: MAROWAK.clubRadius,
    dmg: boss.dmg * MAROWAK.clubDamage,
    caster: boss.id,
  });
  tell(world, boss, "danger", windup);
}
