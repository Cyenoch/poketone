import { PINSIR, BOSS_CHASE_MIN, SHARD } from "../content/params/guardian";
import { enemies as enemyDefs } from "../content/enemies";
import { difficulties } from "../content/difficulties";
import { steerToward } from "../enemies";
import { hasWalkableLine } from "../nav/index";
import { attacksBlocked } from "../status";
import { heightAt } from "../terrain";
import { addHazard, enter, tell } from "../skills/kit";
import { landingHit, landingOf, lockLanding } from "../skills/landing";
import type { World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { atan2, cos, hypot, sin } from "../math";
import { resumeChase } from "./scyther";

/**
 * Pinsir: chase → windup (circle) → dash (the jump) → recover. Scyther's guardians dodge a lane;
 * this one asks the player to leave a circle. Like every guardian, paralysis keeps it from starting a
 * slam (a chain ends early) but lets one already winding up land. `attackTimer` counts the slams left
 * in the chain after the current one; the wind-up and recovery of a chain step start with a head start
 * on `phaseTime`, so one threshold serves both lengths.
 */
export function pinsirBrain(
  world: World,
  boss: Enemy,
  target: Player,
  speed: number,
  dt: number,
): [number, number, number] {
  boss.phaseTime += dt;
  const tele = difficulties[world.difficulty].bossTelegraph;
  switch (boss.phase) {
    case "chase":
      if (
        boss.phaseTime > BOSS_CHASE_MIN &&
        !attacksBlocked(boss) &&
        canSlam(world, boss, target)
      ) {
        boss.attackTimer = boss.hp < boss.maxHp * PINSIR.below ? PINSIR.chain - 1 : 0;
        slam(world, boss, target, PINSIR.windup * tele);
        boss.phaseTime = 0;
      }
      {
        const heading = steerToward(world, boss, target);
        return [heading.x, heading.z, speed];
      }
    case "windup":
      if (boss.phaseTime > PINSIR.windup * tele) enter(boss, "dash");
      return [boss.dashX, boss.dashZ, 0];
    case "dash": {
      const circle = landingOf(world, boss);
      const left = PINSIR.travel - boss.phaseTime;
      if (circle && left > 0) {
        const dx = circle.x - boss.x;
        const dz = circle.z - boss.z;
        const distance = hypot(dx, dz);
        return distance === 0
          ? [boss.dashX, boss.dashZ, 0]
          : [dx / distance, dz / distance, distance / Math.max(left, dt)];
      }
      // A chain only starts below half HP, and nothing mends a guardian.
      const chained = boss.hp < boss.maxHp * PINSIR.below;
      if (circle) {
        landingHit(world, circle);
        if (chained) shards(world, boss);
      }
      if (boss.attackTimer > 0 && !attacksBlocked(boss) && canSlam(world, boss, target)) {
        boss.attackTimer -= 1;
        slam(world, boss, target, PINSIR.chainWindup * tele);
        // The chain step's shorter wind-up ends at the same threshold as the first.
        boss.phaseTime = (PINSIR.windup - PINSIR.chainWindup) * tele;
      } else {
        enter(boss, "recover");
        if (chained) boss.phaseTime = (PINSIR.recover - PINSIR.chainRecover) * tele;
        boss.attackTimer = 0;
      }
      return [0, 0, 0];
    }
    // Guardians never burrow.
    case "under":
    case "recover":
      if (boss.phaseTime > PINSIR.recover * tele) resumeChase(world, boss);
      return [0, 0, 0];
  }
}

function canSlam(world: World, boss: Enemy, target: Player): boolean {
  return (
    hypot(target.x - boss.x, target.z - boss.z) < PINSIR.range &&
    hasWalkableLine(world.nav, enemyDefs[boss.species].mobility, boss.x, boss.z, target.x, target.z)
  );
}

/** Locks the target's spot and starts the wind-up of one slam. */
function slam(world: World, boss: Enemy, target: Player, windup: number): void {
  const dx = target.x - boss.x;
  const dz = target.z - boss.z;
  const distance = hypot(dx, dz) || 1;
  boss.phase = "windup";
  boss.dashX = dx / distance;
  boss.dashZ = dz / distance;
  lockLanding(
    world,
    boss,
    target.x,
    target.z,
    PINSIR.radius,
    boss.dmg * PINSIR.damage,
    windup + PINSIR.travel,
  );
  tell(world, boss, "danger", windup);
}

/** Rock shards flung from the landing, diagonal to the jump so the one it came along stays clear. */
function shards(world: World, boss: Enemy): void {
  const y = heightAt(world.map.terrain, boss.x, boss.z) + SHARD.height;
  const base = atan2(boss.dashZ, boss.dashX) + Math.PI / SHARD.count;
  for (let i = 0; i < SHARD.count; i++) {
    const angle = base + (i / SHARD.count) * Math.PI * 2;
    addHazard(world, {
      kind: "rock-shard",
      x: boss.x,
      y,
      z: boss.z,
      vx: cos(angle) * SHARD.speed,
      vz: sin(angle) * SHARD.speed,
      life: SHARD.life,
      radius: SHARD.radius,
      dmg: boss.dmg * SHARD.damage,
      dirX: cos(angle),
      dirZ: sin(angle),
    });
  }
}
