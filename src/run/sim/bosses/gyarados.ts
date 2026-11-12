import { GYARADOS, BOSS_CHASE_MIN, HYDRO_PUMP, TWISTER } from "../content/params/guardian";
import { difficulties } from "../content/difficulties";
import { steerToward } from "../enemies";
import { coverHit, enemyFeet } from "../sight";
import { addHazard, chestOf, enter, tell } from "../skills/kit";
import { attacksBlocked } from "../status";
import { heightAt } from "../terrain";
import { TICK, type World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { hypot } from "../math";
import { resumeChase } from "./scyther";

/**
 * Gyarados: chase → windup (band) → dash (the beam is live; it holds still) → recover. `attackTimer`
 * counts the attacks started (odd: pump, even: twister) and `strikes` the pumps left in a chain.
 * Paralysis keeps it from starting an attack or a chained pump.
 */
export function gyaradosBrain(
  world: World,
  boss: Enemy,
  target: Player,
  speed: number,
  dt: number,
): [number, number, number] {
  boss.phaseTime += dt;
  const tele = difficulties[world.difficulty].bossTelegraph;
  const low = boss.hp < boss.maxHp * GYARADOS.below;
  switch (boss.phase) {
    case "chase": {
      if (
        boss.phaseTime > BOSS_CHASE_MIN &&
        !attacksBlocked(boss) &&
        hypot(target.x - boss.x, target.z - boss.z) < GYARADOS.range
      ) {
        boss.attackTimer += 1;
        const twisterTurn = !low && boss.attackTimer % 2 === 0 && !twistersOut(world, boss);
        if (twisterTurn) {
          twister(world, boss, target);
          resumeChase(world, boss);
        } else {
          boss.strikes = low ? GYARADOS.chain - 1 : 0;
          pump(world, boss, target, GYARADOS.windup * tele);
        }
      }
      const heading = steerToward(world, boss, target);
      return [heading.x, heading.z, speed];
    }
    case "windup":
      if (boss.phaseTime > GYARADOS.windup * tele) enter(boss, "dash");
      return [boss.dashX, boss.dashZ, 0];
    case "dash":
      if (boss.phaseTime > HYDRO_PUMP.active) {
        if (boss.strikes > 0 && !attacksBlocked(boss)) {
          boss.strikes -= 1;
          pump(world, boss, target, GYARADOS.chainWindup * tele);
          // The chained pump's shorter wind-up ends at the same threshold as the first.
          boss.phaseTime = (GYARADOS.windup - GYARADOS.chainWindup) * tele;
          return [boss.dashX, boss.dashZ, 0];
        }
        boss.strikes = 0;
        enter(boss, "recover");
      }
      return [boss.dashX, boss.dashZ, 0];
    // Below half (every attack a chain) it rests longer.
    case "under":
    case "recover":
      if (boss.phaseTime > (low ? GYARADOS.chainRecover : GYARADOS.recover) * tele)
        resumeChase(world, boss);
      return [0, 0, 0];
  }
}

function twistersOut(world: World, boss: Enemy): boolean {
  return world.hazards.some((hazard) => hazard.kind === "twister" && hazard.caster === boss.id);
}

/** Locks the band toward the target, cut short at the first cover. */
function pump(world: World, boss: Enemy, target: Player, windup: number): void {
  const dx = target.x - boss.x;
  const dz = target.z - boss.z;
  const distance = hypot(dx, dz) || 1;
  enter(boss, "windup");
  boss.dashX = dx / distance;
  boss.dashZ = dz / distance;
  const y = enemyFeet(world.map.terrain, boss) + HYDRO_PUMP.height;
  const rise = (chestOf(world, target) - y) / distance;
  addHazard(world, {
    kind: "hydro-pump",
    x: boss.x,
    y,
    z: boss.z,
    life: windup + HYDRO_PUMP.active + TICK,
    radius: HYDRO_PUMP.width,
    dmg: boss.dmg * HYDRO_PUMP.damage,
    dirX: boss.dashX,
    dirZ: boss.dashZ,
    rise,
    length: Math.min(
      HYDRO_PUMP.length,
      coverHit(world, boss.x, y, boss.z, boss.dashX, boss.dashZ, rise, HYDRO_PUMP.length),
    ),
    caster: boss.id,
  });
  tell(world, boss, "danger", windup);
}

/** Two whirlpools either side of it, across the line to the target. */
function twister(world: World, boss: Enemy, target: Player): void {
  const distance = hypot(target.x - boss.x, target.z - boss.z) || 1;
  const sideX = -(target.z - boss.z) / distance;
  const sideZ = (target.x - boss.x) / distance;
  for (let i = 0; i < GYARADOS.twisters; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const x = boss.x + sideX * side * GYARADOS.twisterSide;
    const z = boss.z + sideZ * side * GYARADOS.twisterSide;
    addHazard(world, {
      kind: "twister",
      x,
      y: heightAt(world.map.terrain, x, z),
      z,
      life: TWISTER.life,
      radius: TWISTER.radius,
      dmg: boss.dmg * TWISTER.damage,
      caster: boss.id,
    });
  }
  tell(world, boss, "danger", TWISTER.arm);
}
