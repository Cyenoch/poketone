import { AERODACTYL, BOSS_CHASE_MIN } from "../content/params/guardian";
import { difficulties } from "../content/difficulties";
import { steerToward } from "../enemies";
import { attacksBlocked } from "../status";
import { addHazard, enter, tell } from "../skills/kit";
import { dropRocks } from "../skills/rockfall";
import type { World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { hypot } from "../math";
import { resumeChase } from "./scyther";
import { predictTarget } from "../enemy-aim";

/**
 * Aerodactyl: chase → windup (band) → dash (the dive) → recover; Rock Slide from the chase. `attackTimer`
 * counts the attacks started (odd: dive, even: slide; below half every attack is the double dive) and
 * `strikes` the dives left in a chain. Paralysis keeps it from starting an attack or a chained dive.
 */
export function aerodactylBrain(
  world: World,
  boss: Enemy,
  target: Player,
  speed: number,
  dt: number,
): [number, number, number] {
  boss.phaseTime += dt;
  const tele = difficulties[world.difficulty].bossTelegraph;
  const low = boss.hp < boss.maxHp * AERODACTYL.below;
  switch (boss.phase) {
    case "chase": {
      if (
        boss.phaseTime > BOSS_CHASE_MIN &&
        !attacksBlocked(boss) &&
        hypot(target.x - boss.x, target.z - boss.z) < AERODACTYL.range
      ) {
        boss.attackTimer += 1;
        if (low || boss.attackTimer % 2 === 1) {
          boss.strikes = low ? AERODACTYL.followupDives : 0;
          dive(world, boss, target, AERODACTYL.windup * tele);
        } else {
          rockSlide(world, boss, target, tele);
          resumeChase(world, boss);
        }
      }
      const heading = steerToward(world, boss, target);
      return [heading.x, heading.z, speed];
    }
    case "windup":
      if (boss.phaseTime > AERODACTYL.windup * tele) enter(boss, "dash");
      return [boss.dashX, boss.dashZ, 0];
    case "dash":
      if (boss.phaseTime > AERODACTYL.time) {
        if (boss.strikes > 0 && !attacksBlocked(boss)) {
          boss.strikes -= 1;
          dive(world, boss, target, AERODACTYL.chainWindup * tele);
          // The chained dive's shorter wind-up ends at the same threshold as the first.
          boss.phaseTime = (AERODACTYL.windup - AERODACTYL.chainWindup) * tele;
          return [boss.dashX, boss.dashZ, 0];
        }
        // Below half the slide falls behind the chain's last dive.
        if (low && !attacksBlocked(boss)) rockSlide(world, boss, target, tele);
        boss.strikes = 0;
        enter(boss, "recover");
        return [0, 0, 0];
      }
      return [boss.dashX, boss.dashZ, (AERODACTYL.length / AERODACTYL.time) * (speed / boss.speed)];
    // Guardians never burrow.
    case "under":
    case "recover":
      if (boss.phaseTime > AERODACTYL.recover * tele) resumeChase(world, boss);
      return [0, 0, 0];
  }
}

/** Locks the band from itself through the target and starts the wind-up. */
function dive(world: World, boss: Enemy, target: Player, windup: number): void {
  target = predictTarget(world, boss, target, windup);
  const dx = target.x - boss.x;
  const dz = target.z - boss.z;
  const distance = hypot(dx, dz) || 1;
  enter(boss, "windup");
  boss.dashX = dx / distance;
  boss.dashZ = dz / distance;
  addHazard(world, {
    kind: "dash-warn",
    x: boss.x,
    y: 0,
    z: boss.z,
    life: windup,
    radius: boss.radius,
    dirX: boss.dashX,
    dirZ: boss.dashZ,
    length: AERODACTYL.length,
  });
  tell(world, boss, "danger", windup);
}

function rockSlide(world: World, boss: Enemy, target: Player, tele: number): void {
  const windup = AERODACTYL.rockWindup * tele;
  target = predictTarget(world, boss, target, windup);
  dropRocks(
    world,
    boss,
    target.x,
    target.z,
    AERODACTYL.rocks,
    AERODACTYL.rockRing,
    AERODACTYL.rockRadius,
    boss.dmg * AERODACTYL.rockDamage,
    windup,
  );
  tell(world, boss, "danger", windup);
}
