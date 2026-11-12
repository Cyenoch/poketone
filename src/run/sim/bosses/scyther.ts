import { enemies as enemyDefs } from "../content/enemies";
import { steerToward } from "../enemies";
import { addHazard, tell } from "../skills/kit";
import { hasWalkableLine } from "../nav/index";
import { predictTarget } from "../enemy-aim";
import { next } from "../rng";
import { attacksBlocked } from "../status";
import { heightAt } from "../terrain";
import type { World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { cos, hypot, sin } from "../math";
import { difficulties } from "../content/difficulties";
import {
  AIR_SLASH,
  AIR_SLASH_DMG,
  BOSS_CHASE_JITTER,
  BOSS_CHASE_MIN,
  BOSS_DASH_RANGE,
  BOSS_DASH_SPEED,
  BOSS_DASH_TIME,
  BOSS_RECOVER,
  BOSS_SLASH_BELOW,
  BOSS_WINDUP,
} from "../content/params/guardian";

/**
 * Scyther: chase, telegraphed dash, and radial Air Slash once below half HP. Below half HP the dash's
 * recovery becomes Air Slash's own wind-up, as long as the recovery it replaces (the rhythm is
 * unchanged): it stands and tells while `attackTimer` counts down to the blades. Like a swarm skill
 * (skills/telegraph.ts), paralysis stops it starting either attack (the dash's wind-up, or Air
 * Slash's: it recovers instead) but lets one already winding up go off. `speed` is its chase speed
 * after paralysis and wet; the dash slows by the same factor.
 */
export function scytherBrain(
  world: World,
  boss: Enemy,
  target: Player,
  speed: number,
  dt: number,
): [number, number, number] {
  boss.phaseTime += dt;
  const dx = target.x - boss.x;
  const dz = target.z - boss.z;
  const distance = hypot(dx, dz) || 1;
  const tele = difficulties[world.difficulty].bossTelegraph;
  switch (boss.phase) {
    case "chase":
      // Only dash along a line it could walk; terrain still stops a dash the target dodges behind.
      if (
        boss.phaseTime > BOSS_CHASE_MIN &&
        !attacksBlocked(boss) &&
        distance < BOSS_DASH_RANGE &&
        hasWalkableLine(
          world.nav,
          enemyDefs[boss.species].mobility,
          boss.x,
          boss.z,
          target.x,
          target.z,
        )
      ) {
        boss.phase = "windup";
        boss.phaseTime = 0;
        boss.attackTimer = 0;
        const aim = predictTarget(world, boss, target, BOSS_WINDUP * tele);
        const lead = hypot(aim.x - boss.x, aim.z - boss.z) || 1;
        boss.dashX = (aim.x - boss.x) / lead;
        boss.dashZ = (aim.z - boss.z) / lead;
        addHazard(world, {
          kind: "dash-warn",
          x: boss.x,
          y: 0,
          z: boss.z,
          life: BOSS_WINDUP * tele,
          radius: boss.radius,
          dirX: boss.dashX,
          dirZ: boss.dashZ,
          length: BOSS_DASH_SPEED * BOSS_DASH_TIME,
        });
        tell(world, boss, "danger", BOSS_WINDUP * tele);
      }
      const heading = steerToward(world, boss, target);
      return [heading.x, heading.z, speed];
    case "windup":
      if (boss.attackTimer > 0) {
        boss.attackTimer -= dt;
        if (boss.attackTimer <= 0) {
          airSlash(world, boss);
          resumeChase(world, boss);
        }
        return [0, 0, 0];
      }
      if (boss.phaseTime > BOSS_WINDUP * tele) {
        boss.phase = "dash";
        boss.phaseTime = 0;
      }
      return [boss.dashX, boss.dashZ, 0];
    case "dash":
      if (boss.phaseTime > BOSS_DASH_TIME) {
        boss.phaseTime = 0;
        if (boss.hp < boss.maxHp * BOSS_SLASH_BELOW && !attacksBlocked(boss)) {
          boss.phase = "windup";
          boss.attackTimer = BOSS_RECOVER * tele;
          tell(world, boss, "danger", boss.attackTimer);
        } else boss.phase = "recover";
      }
      return [boss.dashX, boss.dashZ, BOSS_DASH_SPEED * (speed / boss.speed)];
    // Guardians never burrow.
    case "under":
    case "recover":
      if (boss.phaseTime > BOSS_RECOVER * tele) resumeChase(world, boss);
      return [0, 0, 0];
  }
}

/** Back to the chase, with a random head start on the next dash's minimum chase. */
export function resumeChase(world: World, boss: Enemy): void {
  boss.phase = "chase";
  boss.phaseTime = next(world.rng) * BOSS_CHASE_JITTER;
}

function airSlash(world: World, boss: Enemy): void {
  const count = difficulties[world.difficulty].airSlashBlades;
  const y = heightAt(world.map.terrain, boss.x, boss.z) + AIR_SLASH.height;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    addHazard(world, {
      kind: "slash",
      x: boss.x,
      y,
      z: boss.z,
      vx: cos(angle) * AIR_SLASH.speed,
      vz: sin(angle) * AIR_SLASH.speed,
      life: AIR_SLASH.life,
      radius: AIR_SLASH.radius,
      dmg: boss.dmg * AIR_SLASH_DMG,
      dirX: cos(angle),
      dirZ: sin(angle),
    });
  }
}
