import { SANDSLASH, BOSS_CHASE_MIN, QUICKSAND_PIT, SHARD } from "../content/params/guardian";
import { enemies as enemyDefs } from "../content/enemies";
import { difficulties } from "../content/difficulties";
import { steerToward } from "../enemies";
import { bodyFits, hasWalkableLine } from "../nav/index";
import { attacksBlocked } from "../status";
import { heightAt } from "../terrain";
import { addHazard, enter, tell } from "../skills/kit";
import { landingHit, landingOf, lockLanding } from "../skills/landing";
import type { World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { cos, hypot, sin } from "../math";
import { resumeChase } from "./scyther";

/**
 * Sandslash: chase → windup (roll lane) or under (dig circle) → dash (the roll) → recover. Digs and
 * rolls alternate, `attackTimer` counting the attacks started (odd: dig); when the turn's attack cannot
 * start (no standable spot, no walkable line) it tries the other. Underground it is untargetable and
 * touches no one, like a swarm burrower. Paralysis keeps it from starting either attack.
 */
export function sandslashBrain(
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
      if (boss.phaseTime > BOSS_CHASE_MIN && !attacksBlocked(boss)) {
        const digTurn = boss.attackTimer % 2 === 0;
        const started = digTurn
          ? dig(world, boss, target, tele) || roll(world, boss, target, tele)
          : roll(world, boss, target, tele) || dig(world, boss, target, tele);
        if (started) boss.attackTimer += 1;
      }
      {
        const heading = steerToward(world, boss, target);
        return [heading.x, heading.z, speed];
      }
    case "under": {
      if (boss.phaseTime <= SANDSLASH.digWindup * tele) return [0, 0, 0];
      const circle = landingOf(world, boss);
      if (circle) {
        boss.x = boss.px = circle.x;
        boss.z = boss.pz = circle.z;
        landingHit(world, circle);
        if (boss.hp < boss.maxHp * SANDSLASH.below) breakOut(world, boss);
      }
      enter(boss, "recover");
      // The dig's longer recovery ends at the roll's threshold.
      boss.phaseTime = (SANDSLASH.rollRecover - SANDSLASH.digRecover) * tele;
      return [0, 0, 0];
    }
    case "windup":
      if (boss.phaseTime > SANDSLASH.rollWindup * tele) enter(boss, "dash");
      return [boss.dashX, boss.dashZ, 0];
    case "dash":
      if (boss.phaseTime > SANDSLASH.rollTime) enter(boss, "recover");
      return [
        boss.dashX,
        boss.dashZ,
        (SANDSLASH.rollLength / SANDSLASH.rollTime) * (speed / boss.speed),
      ];
    case "recover":
      if (boss.phaseTime > SANDSLASH.rollRecover * tele) resumeChase(world, boss);
      return [0, 0, 0];
  }
}

/** Dives under the target's spot when it is in range and its body fits there. */
function dig(world: World, boss: Enemy, target: Player, tele: number): boolean {
  const dx = target.x - boss.x;
  const dz = target.z - boss.z;
  const distance = hypot(dx, dz);
  const { mobility } = enemyDefs[boss.species];
  if (distance > SANDSLASH.range || !bodyFits(world.nav, mobility, target.x, target.z, boss.radius))
    return false;
  enter(boss, "under");
  boss.dashX = dx / (distance || 1);
  boss.dashZ = dz / (distance || 1);
  const windup = SANDSLASH.digWindup * tele;
  lockLanding(
    world,
    boss,
    target.x,
    target.z,
    SANDSLASH.radius,
    boss.dmg * SANDSLASH.damage,
    windup,
  );
  tell(world, boss, "danger", windup);
  return true;
}

/** Marks the lane and winds up a roll along a line it could walk. */
function roll(world: World, boss: Enemy, target: Player, tele: number): boolean {
  const dx = target.x - boss.x;
  const dz = target.z - boss.z;
  const distance = hypot(dx, dz);
  const { mobility } = enemyDefs[boss.species];
  if (
    distance > SANDSLASH.rollRange ||
    distance === 0 ||
    !hasWalkableLine(world.nav, mobility, boss.x, boss.z, target.x, target.z)
  )
    return false;
  enter(boss, "windup");
  boss.dashX = dx / distance;
  boss.dashZ = dz / distance;
  const windup = SANDSLASH.rollWindup * tele;
  addHazard(world, {
    kind: "dash-warn",
    x: boss.x,
    y: 0,
    z: boss.z,
    life: windup,
    radius: boss.radius,
    dirX: boss.dashX,
    dirZ: boss.dashZ,
    length: SANDSLASH.rollLength,
  });
  tell(world, boss, "danger", windup);
  return true;
}

/** Below half HP: rock spikes in every direction and a quicksand pit where it came up. */
function breakOut(world: World, boss: Enemy): void {
  const ground = heightAt(world.map.terrain, boss.x, boss.z);
  for (let i = 0; i < SANDSLASH.spikes; i++) {
    const angle = (i / SANDSLASH.spikes) * Math.PI * 2;
    addHazard(world, {
      kind: "rock-shard",
      x: boss.x,
      y: ground + SHARD.height,
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
  addHazard(world, {
    kind: "quicksand-pit",
    x: boss.x,
    y: ground,
    z: boss.z,
    life: QUICKSAND_PIT.life,
    radius: QUICKSAND_PIT.radius,
  });
}
