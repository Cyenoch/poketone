import { NIDOKING, BOSS_CHASE_MIN, FISSURE, STOMP } from "../content/params/guardian";
import { difficulties } from "../content/difficulties";
import { steerToward } from "../enemies";
import { coverHit } from "../sight";
import { attacksBlocked } from "../status";
import { heightAt } from "../terrain";
import { lobAcid } from "../skills/acid";
import { ACID } from "../content/params/enemy-skills";
import { addHazard, enter, mouthY, tell } from "../skills/kit";
import { TICK, type World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { atan2, cos, hypot, sin } from "../math";
import { resumeChase } from "./scyther";

/**
 * Nidoking: chase → windup (fissure lines) → dash (the lines are live; below half HP the stomp winds
 * up and lands here) → recover; Toxic Spikes from the chase. It reads back what the first two zones
 * taught: lanes, landing circles and poison pools. `attackTimer` counts the attacks it has started
 * (odd: fissure, even: spikes). Paralysis keeps it from starting either attack or the stomp.
 */
export function nidokingBrain(
  world: World,
  boss: Enemy,
  target: Player,
  speed: number,
  dt: number,
): [number, number, number] {
  const before = boss.phaseTime;
  boss.phaseTime += dt;
  const tele = difficulties[world.difficulty].bossTelegraph;
  switch (boss.phase) {
    case "chase": {
      if (
        boss.phaseTime > BOSS_CHASE_MIN &&
        !attacksBlocked(boss) &&
        hypot(target.x - boss.x, target.z - boss.z) < NIDOKING.range
      ) {
        boss.attackTimer += 1;
        if (boss.attackTimer % 2 === 0) {
          toxicSpikes(world, boss, target);
          resumeChase(world, boss);
        } else fissure(world, boss, target, NIDOKING.windup * tele);
      }
      const heading = steerToward(world, boss, target);
      return [heading.x, heading.z, speed];
    }
    case "windup":
      if (boss.phaseTime > NIDOKING.windup * tele) enter(boss, "dash");
      return [boss.dashX, boss.dashZ, 0];
    case "dash":
      // The lines have cracked: below half HP the stomp winds up the moment they close.
      if (
        before <= FISSURE.active &&
        boss.phaseTime > FISSURE.active &&
        boss.hp < boss.maxHp * NIDOKING.below &&
        !attacksBlocked(boss)
      )
        stomp(world, boss, NIDOKING.stompWindup * tele);
      if (boss.phaseTime > FISSURE.active && !stomping(world, boss)) enter(boss, "recover");
      return [0, 0, 0];
    // Guardians never burrow.
    case "under":
    case "recover":
      if (boss.phaseTime > NIDOKING.recover * tele) resumeChase(world, boss);
      return [0, 0, 0];
  }
}

/** Fissure lines fanned around the heading to the target, each cut short where cover stops it. */
function fissure(world: World, boss: Enemy, target: Player, windup: number): void {
  const dx = target.x - boss.x;
  const dz = target.z - boss.z;
  const distance = hypot(dx, dz) || 1;
  enter(boss, "windup");
  boss.dashX = dx / distance;
  boss.dashZ = dz / distance;
  const count = boss.hp < boss.maxHp * NIDOKING.below ? NIDOKING.linesBelow : NIDOKING.lines;
  const y = heightAt(world.map.terrain, boss.x, boss.z) + FISSURE.height;
  const heading = atan2(boss.dashZ, boss.dashX);
  for (let i = 0; i < count; i++) {
    const angle = heading + (i - (count - 1) / 2) * FISSURE.spread;
    const dirX = cos(angle);
    const dirZ = sin(angle);
    addHazard(world, {
      kind: "fissure",
      x: boss.x,
      y,
      z: boss.z,
      // Integrated later in the tick that starts the wind-up.
      life: windup + FISSURE.active + TICK,
      radius: FISSURE.width,
      dmg: boss.dmg * FISSURE.damage,
      dirX,
      dirZ,
      length: Math.min(
        FISSURE.length,
        coverHit(world, boss.x, y, boss.z, dirX, dirZ, 0, FISSURE.length),
      ),
      caster: boss.id,
    });
  }
  tell(world, boss, "danger", windup);
}

function stomp(world: World, boss: Enemy, windup: number): void {
  addHazard(world, {
    kind: "stomp",
    x: boss.x,
    y: heightAt(world.map.terrain, boss.x, boss.z),
    z: boss.z,
    life: windup + STOMP.active + TICK,
    radius: STOMP.radius,
    dmg: boss.dmg * STOMP.damage,
    caster: boss.id,
  });
  tell(world, boss, "danger", windup);
}

/** The stomp still to land (its rule spends `dmg` on the hit). */
function stomping(world: World, boss: Enemy): boolean {
  return world.hazards.some(
    (hazard) => hazard.kind === "stomp" && hazard.caster === boss.id && hazard.dmg > 0,
  );
}

/** Acid globs on the target and on a ring around it, thrown without stopping. */
function toxicSpikes(world: World, boss: Enemy, target: Player): void {
  const y = mouthY(world, boss);
  const dmg = boss.dmg * ACID.splash;
  const base = atan2(target.z - boss.z, target.x - boss.x);
  lobAcid(world, boss.x, y, boss.z, target.x, target.z, dmg);
  for (let i = 1; i < NIDOKING.spikes; i++) {
    const angle = base + (i / (NIDOKING.spikes - 1)) * Math.PI * 2;
    lobAcid(
      world,
      boss.x,
      y,
      boss.z,
      target.x + cos(angle) * NIDOKING.spikeRing,
      target.z + sin(angle) * NIDOKING.spikeRing,
      dmg,
    );
  }
  tell(world, boss, "danger", ACID.flight);
}
