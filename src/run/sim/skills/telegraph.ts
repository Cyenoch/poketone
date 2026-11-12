import { ENEMY_SKILL_RELOAD } from "../content/params/enemy-skills";
// The wind-up every telegraphed skill shares: chase until the cooldown is up and the target is in range
// and in sight, tell, hold still for `windup`, then release (casts) or dash and recover (lunges). The
// skill's own warning hazard shows where it will land before it can hurt.

import { enemies as enemyDefs } from "../content/enemies";
import { hasWalkableLine } from "../nav/index";
import { range } from "../rng";
import { coverHit } from "../sight";
import { STAGGER } from "../content/params/combat";
import { attacksBlocked, interrupted } from "../status";
import type { World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import type { TellSeverity } from "../state/events";
import { hypot } from "../math";
import { predictTarget } from "../enemy-aim";
import { bodyY, enter, mouthY, sightOn, tell } from "./kit";
import type { SkillDef } from "./index";

/** Where a skill that just started aims: the height it leaves from, the point it aims at, the range. */
export interface Aim {
  y: number;
  goal: number;
  distance: number;
}

/** Dash speed and time, then recovery (seconds); the dash slows by the chase's paralysis and wet factor. */
export interface Lunge {
  speed: number;
  time: number;
  recover: number;
  /** Flyers pass over the nav's blockers, so their dive ends at the first rock or ridge in its way. */
  stopsAtCover?: true;
  /**
   * Strikes in a row (连啄): after each dash but the last it re-aims at the target and winds up for
   * `gap` seconds instead of recovering, showing its new lane (`start` again, `phaseTime` advanced so
   * the warning lasts `gap`).
   */
  repeat?: { count: number; gap: number };
}

export interface TelegraphSpec extends Pick<SkillDef, "range" | "partner"> {
  /** Projectile flight adds to the wind-up prediction window. */
  projectileSpeed?: number;
  /** Seconds the enemy holds still before the attack leaves (the dash starts). */
  windup: number;
  /** The tell flashed when the wind-up starts; elites and the guardian always tell red (kit.ts `tell`). */
  tell: TellSeverity;
  /** A ground charge also needs a walkable line to the target. */
  walk?: true;
  /** Adds the wind-up's warning the tick it starts. */
  start?(world: World, enemy: Enemy, aim: Aim): void;
  /** At the end of the wind-up (casts). */
  release?(world: World, enemy: Enemy, target: Player): void;
  /** Dashes along the locked heading after the wind-up instead of releasing (aims from the body). */
  lunge?: Lunge;
}

export function telegraph(spec: TelegraphSpec): SkillDef {
  return {
    range: spec.range,
    partner: spec.partner,
    windup: spec.windup,
    step(world, enemy, target, speed, dt, every) {
      if (interrupted(enemy)) {
        // Sleep cancels a wind-up or lunge; the rhythm starts over on waking.
        enter(enemy, "chase");
        return null;
      }
      enemy.phaseTime += dt;
      switch (enemy.phase) {
        case "chase":
          enemy.attackTimer -= dt;
          if (enemy.attackTimer <= 0 && !attacksBlocked(enemy))
            begin(world, enemy, target, spec, every);
          return null;
        case "windup":
          if (enemy.phaseTime > spec.windup) {
            // The attack has left: no stagger cancels it while its shot or blast resolves.
            enemy.stagger = Math.max(enemy.stagger, STAGGER.released);
            if (spec.lunge) enter(enemy, "dash");
            else {
              spec.release?.(world, enemy, target);
              enter(enemy, "chase");
            }
          }
          return [enemy.dashX, enemy.dashZ, 0];
        case "dash": {
          const lunge = spec.lunge!;
          const dash = lunge.speed * (speed / enemy.speed);
          if (
            enemy.phaseTime > lunge.time ||
            (lunge.stopsAtCover && blocked(world, enemy, dash * dt))
          ) {
            if (lunge.repeat && enemy.strikes > 0) {
              enemy.strikes -= 1;
              restrike(world, enemy, target, spec, lunge.repeat.gap);
              return [enemy.dashX, enemy.dashZ, 0];
            }
            enter(enemy, "recover");
          }
          return [enemy.dashX, enemy.dashZ, dash];
        }
        case "recover":
          if (enemy.phaseTime > spec.lunge!.recover) enter(enemy, "chase");
          return [0, 0, 0];
        case "under":
          // Only burrowers go underground (landing.ts).
          enter(enemy, "chase");
          return null;
      }
    },
  };
}

function blocked(world: World, enemy: Enemy, step: number): boolean {
  const ahead = step + enemy.radius;
  return (
    coverHit(world, enemy.x, bodyY(world, enemy), enemy.z, enemy.dashX, enemy.dashZ, 0, ahead) !==
    Infinity
  );
}

/** Starts the attack when the target is in range and the way is clear; otherwise tries again next tick. */
function begin(world: World, enemy: Enemy, target: Player, spec: TelegraphSpec, every: number) {
  const actualDistance = hypot(target.x - enemy.x, target.z - enemy.z);
  if (actualDistance > spec.range || actualDistance === 0) return;
  target = predictTarget(
    world,
    enemy,
    target,
    spec.windup + (spec.projectileSpeed ? actualDistance / spec.projectileSpeed : 0),
  );
  const dx = target.x - enemy.x,
    dz = target.z - enemy.z;
  const distance = hypot(dx, dz);
  if (distance > spec.range || distance === 0) return;
  const y = spec.lunge ? bodyY(world, enemy) : mouthY(world, enemy);
  const { goal, clear } = sightOn(world, enemy, target, y);
  const walkable =
    !spec.walk ||
    hasWalkableLine(
      world.nav,
      enemyDefs[enemy.species].mobility,
      enemy.x,
      enemy.z,
      target.x,
      target.z,
    );
  if (!clear || !walkable) return;
  enemy.attackTimer = every * range(world.rng, ...ENEMY_SKILL_RELOAD);
  enter(enemy, "windup");
  enemy.dashX = dx / distance;
  enemy.dashZ = dz / distance;
  enemy.strikes = (spec.lunge?.repeat?.count ?? 1) - 1;
  tell(world, enemy, spec.tell, spec.windup);
  spec.start?.(world, enemy, { y, goal, distance });
}

/** A follow-up strike: re-aimed at the target, with a `gap`-second wind-up and no new tell. */
function restrike(world: World, enemy: Enemy, target: Player, spec: TelegraphSpec, gap: number) {
  target = predictTarget(world, enemy, target, gap);
  const dx = target.x - enemy.x;
  const dz = target.z - enemy.z;
  const distance = hypot(dx, dz);
  if (distance > 0) {
    enemy.dashX = dx / distance;
    enemy.dashZ = dz / distance;
  }
  enter(enemy, "windup");
  enemy.phaseTime = spec.windup - gap;
  const y = bodyY(world, enemy);
  spec.start?.(world, enemy, { y, goal: y, distance });
}
