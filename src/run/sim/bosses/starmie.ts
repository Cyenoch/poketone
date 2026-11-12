import { STARMIE, BOSS_CHASE_MIN } from "../content/params/guardian";
import { difficulties } from "../content/difficulties";
import { steerToward } from "../enemies";
import { ROCKFALL } from "../content/params/enemy-skills";
import { addHazard, enter, tell } from "../skills/kit";
import { attacksBlocked } from "../status";
import { heightAt } from "../terrain";
import { TICK, type World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { cos, hypot, sin } from "../math";
import { resumeChase } from "./scyther";
import { predictTarget } from "../enemy-aim";

const segmentTime = STARMIE.segment / STARMIE.spinSpeed;

/**
 * Starmie: chase → windup (the zigzag) → dash (one per lane, `strikes` lanes left) → recover; bolts
 * fall during `dash` too, on odd attacks of `attackTimer` (`strikes` bolts left), and it chases through
 * them. Paralysis keeps it from starting an attack; a spin or a volley under way goes on.
 */
export function starmieBrain(
  world: World,
  boss: Enemy,
  target: Player,
  speed: number,
  dt: number,
): [number, number, number] {
  boss.phaseTime += dt;
  const tele = difficulties[world.difficulty].bossTelegraph;
  const low = boss.hp < boss.maxHp * STARMIE.below;
  const spinning = boss.attackTimer % 2 === 1;
  switch (boss.phase) {
    case "chase": {
      if (
        boss.phaseTime > BOSS_CHASE_MIN &&
        !attacksBlocked(boss) &&
        hypot(target.x - boss.x, target.z - boss.z) < STARMIE.range
      ) {
        boss.attackTimer += 1;
        if (boss.attackTimer % 2 === 1) spin(world, boss, target, low, tele);
        else {
          enter(boss, "dash");
          boss.strikes = (low ? STARMIE.lowBolts : STARMIE.bolts) - 1;
          bolt(world, boss, target, tele);
        }
      }
      const heading = steerToward(world, boss, target);
      return [heading.x, heading.z, speed];
    }
    case "windup":
      if (boss.phaseTime > STARMIE.spinWindup * tele) enter(boss, "dash");
      return [boss.dashX, boss.dashZ, 0];
    case "dash": {
      if (!spinning) {
        if (boss.phaseTime > STARMIE.boltGap) {
          if (boss.strikes > 0) {
            boss.strikes -= 1;
            boss.phaseTime = 0;
            bolt(world, boss, target, tele);
          } else resumeChase(world, boss);
        }
        const heading = steerToward(world, boss, target);
        return [heading.x, heading.z, speed];
      }
      if (boss.phaseTime > segmentTime) {
        if (boss.strikes === 0) {
          enter(boss, "recover");
          return [0, 0, 0];
        }
        boss.strikes -= 1;
        [boss.dashX, boss.dashZ] = turned(boss.dashX, boss.dashZ, boss.strikes);
        boss.phaseTime = 0;
      }
      return [boss.dashX, boss.dashZ, STARMIE.spinSpeed * (speed / boss.speed)];
    }
    case "under":
    case "recover":
      if (boss.phaseTime > STARMIE.spinRecover * tele) resumeChase(world, boss);
      return [0, 0, 0];
  }
}

/** The next lane's heading: turned `turn` one way or the other by the lanes still to come. */
function turned(x: number, z: number, left: number): [number, number] {
  const angle = left % 2 === 1 ? STARMIE.turn : -STARMIE.turn;
  const c = cos(angle);
  const s = sin(angle);
  return [x * c - z * s, x * s + z * c];
}

/** Marks every lane of the zigzag at once, then winds up. */
function spin(world: World, boss: Enemy, target: Player, low: boolean, tele: number): void {
  const distance = hypot(target.x - boss.x, target.z - boss.z) || 1;
  enter(boss, "windup");
  boss.dashX = (target.x - boss.x) / distance;
  boss.dashZ = (target.z - boss.z) / distance;
  const lanes = low ? STARMIE.lowSegments : STARMIE.segments;
  boss.strikes = lanes - 1;
  const windup = STARMIE.spinWindup * tele;
  let [x, z, dirX, dirZ] = [boss.x, boss.z, boss.dashX, boss.dashZ];
  for (let left = lanes - 1; left >= 0; left--) {
    addHazard(world, {
      kind: "dash-warn",
      x,
      y: 0,
      z,
      life: windup,
      radius: boss.radius,
      dirX,
      dirZ,
      length: STARMIE.segment,
    });
    x += dirX * STARMIE.segment;
    z += dirZ * STARMIE.segment;
    if (left > 0) [dirX, dirZ] = turned(dirX, dirZ, left - 1);
  }
  tell(world, boss, "danger", windup);
}

/** One circle on the target's spot now; it strikes `boltWindup` later. */
function bolt(world: World, boss: Enemy, target: Player, tele: number): void {
  const windup = STARMIE.boltWindup * tele;
  target = predictTarget(world, boss, target, windup);
  addHazard(world, {
    kind: "thunder-bolt",
    x: target.x,
    y: heightAt(world.map.terrain, target.x, target.z),
    z: target.z,
    life: windup + ROCKFALL.residue + TICK,
    radius: STARMIE.boltRadius,
    dmg: boss.dmg * STARMIE.boltDamage,
    caster: boss.id,
  });
  tell(world, boss, "danger", windup);
}
