import { ENEMY_HAZARD, ENEMY_SKILL_RELOAD, LANDING } from "../content/params/enemy-skills";
// Diglett's and Onix's burrow, Haunter's shadow sneak, the leaps of Mankey, Primeape and Hitmonlee: a circle locked on the
// target's spot, then the body arrives there and hits the circle once. Burrowers wait underground
// (untargetable, `status.ts` `targetable`) and break out of the spot; leapers hold still, then jump to
// it along a walkable line. Pinsir's slams use the same circle and hit (bosses/pinsir.ts).

import { predictTarget } from "../enemy-aim";
import { enemies as enemyDefs } from "../content/enemies";
import { STAGGER } from "../content/params/combat";
import { damagePlayer } from "../hurt";
import { bodyFits, hasWalkableLine } from "../nav/index";
import { range } from "../rng";
import { lineOfFire } from "../sight";
import { attacksBlocked, interrupted } from "../status";
import { heightAt } from "../terrain";
import { ARENA_HALF, TICK, type World } from "../state/world";
import type { Enemy, Hazard, Player } from "../state/entities";
import { hypot } from "../math";
import { activeCaster, addHazard, chestOf, enter, inPatch, tell, type HazardRule } from "./kit";
import type { SkillDef } from "./index";

export type LandingKind = keyof typeof LANDING;

/** Seconds the spent circle stays on the ground as the hit's residue. */
export const LANDING_RESIDUE = 0.3;

/** The body lands at the last live circle; extra simultaneous circles only deal the strike. */
export function landingOf(world: World, enemy: Enemy): Hazard | undefined {
  return world.hazards.findLast(
    (hazard) => hazard.kind === "landing" && hazard.caster === enemy.id && hazard.dmg > 0,
  );
}

/** Marks the circle centred on (x, z) that the caster will hit in `seconds`. */
export function lockLanding(
  world: World,
  enemy: Enemy,
  x: number,
  z: number,
  radius: number,
  dmg: number,
  seconds: number,
): Hazard {
  return addHazard(world, {
    kind: "landing",
    x,
    y: heightAt(world.map.terrain, x, z),
    z,
    // The caster's step lands the hit; this only outlives it by a few ticks.
    life: seconds + 3 * TICK,
    radius,
    dmg,
    caster: enemy.id,
  });
}

/** Every player inside the circle, on its level and in sight of its centre, takes the hit once. */
export function landingHit(world: World, circle: Hazard): void {
  for (const player of world.players)
    if (
      inPatch(world, circle, player, circle.y) &&
      lineOfFire(
        world,
        circle.x,
        circle.y + ENEMY_HAZARD.groundSight,
        circle.z,
        player.x,
        chestOf(world, player),
        player.z,
      )
    )
      damagePlayer(world, player, circle.dmg);
  circle.dmg = 0;
  circle.life = LANDING_RESIDUE;
}

/** Where a body of the species may arrive: inside the arena, and standable for ground walkers. */
export function standable(world: World, enemy: Enemy, x: number, z: number): boolean {
  if (Math.abs(x) > ARENA_HALF || Math.abs(z) > ARENA_HALF) return false;
  const { mobility } = enemyDefs[enemy.species];
  return mobility.flying === true || bodyFits(world.nav, mobility, x, z, enemy.radius);
}

function landing(kind: LandingKind): SkillDef {
  const n = LANDING[kind];
  const under = n.travel === 0;
  const begin = (world: World, enemy: Enemy, target: Player, every: number) => {
    if (hypot(target.x - enemy.x, target.z - enemy.z) > n.range) return;
    target = predictTarget(world, enemy, target, n.windup + n.travel);
    const dx = target.x - enemy.x;
    const dz = target.z - enemy.z;
    const distance = hypot(dx, dz);
    if (distance > n.range || distance === 0 || !standable(world, enemy, target.x, target.z))
      return;
    const { mobility } = enemyDefs[enemy.species];
    // A leap needs a line it could walk, like a charge; a burrower tunnels under anything.
    if (
      !under &&
      !mobility.flying &&
      !hasWalkableLine(world.nav, mobility, enemy.x, enemy.z, target.x, target.z)
    )
      return;
    enemy.attackTimer = every * range(world.rng, ...ENEMY_SKILL_RELOAD);
    enter(enemy, under ? "under" : "windup");
    enemy.dashX = dx / distance;
    enemy.dashZ = dz / distance;
    tell(world, enemy, "normal", n.windup);
    if ("count" in n) {
      for (const side of [-1, 1]) {
        const x = target.x - enemy.dashZ * side * n.side;
        const z = target.z + enemy.dashX * side * n.side;
        if (standable(world, enemy, x, z))
          lockLanding(world, enemy, x, z, n.radius * enemy.scale, enemy.dmg * n.damage, n.windup);
      }
    }
    lockLanding(
      world,
      enemy,
      target.x,
      target.z,
      n.radius * enemy.scale,
      enemy.dmg * n.damage,
      n.windup + n.travel,
    );
  };
  return {
    range: n.range,
    partner: { style: "tackle" },
    windup: n.windup,
    step(world, enemy, target, _speed, dt, every) {
      if (interrupted(enemy)) {
        // Sleep or a stagger cancels it (the circle dies with it); a burrower comes up where it dived.
        enter(enemy, "chase");
        return null;
      }
      enemy.phaseTime += dt;
      switch (enemy.phase) {
        case "chase":
          enemy.attackTimer -= dt;
          if (enemy.attackTimer <= 0 && !attacksBlocked(enemy)) begin(world, enemy, target, every);
          return null;
        case "under": {
          if (enemy.phaseTime <= n.windup) return [enemy.dashX, enemy.dashZ, 0];
          const circle = landingOf(world, enemy);
          if (circle) {
            // Breaks out of the middle of the circle; no interpolated slide from where it dived.
            enemy.x = enemy.px = circle.x;
            enemy.z = enemy.pz = circle.z;
            for (const mark of world.hazards)
              if (mark.kind === "landing" && mark.caster === enemy.id && mark.dmg > 0)
                landingHit(world, mark);
          }
          enter(enemy, "recover");
          return [0, 0, 0];
        }
        case "windup":
          if (enemy.phaseTime > n.windup) {
            // Airborne: no stagger stops the jump once it has left.
            enemy.stagger = Math.max(enemy.stagger, STAGGER.released);
            enter(enemy, "dash");
          }
          return [enemy.dashX, enemy.dashZ, 0];
        case "dash": {
          const circle = landingOf(world, enemy);
          const left = n.travel - enemy.phaseTime;
          if (!circle || left <= 0) {
            if (circle) landingHit(world, circle);
            enter(enemy, "recover");
            return [0, 0, 0];
          }
          const dx = circle.x - enemy.x;
          const dz = circle.z - enemy.z;
          const distance = hypot(dx, dz);
          if (distance === 0) return [enemy.dashX, enemy.dashZ, 0];
          return [dx / distance, dz / distance, distance / Math.max(left, dt)];
        }
        case "recover":
          if (enemy.phaseTime > n.recover) enter(enemy, "chase");
          return [0, 0, 0];
      }
    },
  };
}

export const melt = landing("melt");
export const bodySlam = landing("body-slam");
export const tripleBurrow = landing("triple-burrow");
export const burrow = landing("burrow");
export const shadowSneak = landing("shadow-sneak");
export const leap = landing("leap");
export const leapHeavy = landing("leap-heavy");
export const highJumpKick = landing("high-jump-kick");
export const dig = landing("dig");

export const hazards = {
  landing: {
    update(world, circle) {
      // Before its hit the circle dies with its caster (or when the caster falls asleep).
      if (circle.dmg > 0 && !activeCaster(world, circle)) circle.life = 0;
    },
  },
} satisfies Record<string, HazardRule>;
