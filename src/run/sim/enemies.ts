import { enemies as enemyDefs } from "./content/enemies";
import { guardianBrains } from "./bosses/index";
import { furyStep } from "./bosses/fury";
import { furyOf } from "./content/params/guardian";
import { dodgeStep, dodgeThreats } from "./enemy-dodge";
import { zoneDef } from "./currentZone";
import { findPlayer, killEnemy, type Ctx } from "./combat";
import { damagePlayer } from "./hurt";
import { STAMPEDE_SPEEDUP } from "./content/params/pacing";
import { nearestPlayer } from "./director";
import { formOf } from "./evolution";
import { QUICKSAND } from "./content/params/environment";
import { sampleSurface } from "./surface";
import { quicksandPull, settleEnemySurface } from "./surface-effects";
import {
  flowDirection,
  hasWalkableLine,
  moveWithSlope,
  refreshFlowFields,
  type Direction,
} from "./nav/index";
import { enemyMoves } from "./movement";
import { guard } from "./partners";
import { staggered, yieldTo } from "./poise";
import { withinStep } from "./sight";
import { skills } from "./skills/index";
import { afterTouch } from "./triggers/index";
import {
  apply,
  attacksBlocked,
  decay,
  dotRate,
  dotSource,
  interrupted,
  slowed,
  stopped,
  targetable,
} from "./status";
import { heightAt } from "./terrain";
import { ARENA_HALF, type World } from "./state/world";
import type { Enemy, Player } from "./state/entities";
import { hypot } from "./math";
import { CONTACT_SECONDS, KNOCK_DECAY } from "./content/params/combat";
import { PURSUIT_RANGE, STAMPEDE_MIN_PROGRESS } from "./content/params/enemy-motion";

/** Flow-field cells settled per tick across all walker classes (≈0.05 µs each; see docs/NAVIGATION.md). */
const FLOW_BUDGET = 4000;
export function updateEnemies(ctx: Ctx, dt: number): void {
  const { world, grid } = ctx;
  const time = world.time;
  const threats = dodgeThreats(world, grid);
  refreshFlowFields(world.nav, world.players, FLOW_BUDGET);
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0) continue;
    enemy.px = enemy.x;
    enemy.pz = enemy.z;
    enemy.flash = Math.max(0, enemy.flash - dt);
    enemy.hardened = Math.max(0, enemy.hardened - dt);
    const { mobility } = enemyDefs[enemy.species];
    const surface = mobility.flying
      ? null
      : sampleSurface(world.map.terrain.surface, enemy.x, enemy.z);
    // Water is a swimmer's or amphibian's element: it is never wet from it.
    if (surface && !(mobility.water && surface.kind === "water"))
      settleEnemySurface(enemy, surface);

    // DoT and stops act on the tick their status was alive at the start of; slows on what is left.
    const dot = dotRate(enemy);
    const dotBy = dot > 0 ? dotSource(enemy) : -1;
    const held = stopped(enemy) || staggered(enemy);
    decay(enemy, dt);
    if (dot > 0) {
      enemy.hp -= dot * dt;
      if (enemy.hp <= 0) {
        killEnemy(ctx, enemy, dotBy === -1 ? null : findPlayer(world, dotBy));
        continue;
      }
    }

    const target = nearestPlayer(world, enemy.x, enemy.z);
    let speed = slowed(enemy, enemy.speed, time, enemy.id);
    if (held) speed = 0;

    let moveX = 0;
    let moveZ = 0;
    const activeDodge = enemy.dodge && enemy.dodge.until > time;
    if (activeDodge && !held && !attacksBlocked(enemy) && enemy.phase === "chase") {
      moveX = enemy.dodge!.x;
      moveZ = enemy.dodge!.z;
    } else if (enemy.charge) {
      moveX = enemy.dashX;
      moveZ = enemy.dashZ;
    } else if (enemy.boss && target) {
      if (interrupted(enemy)) {
        // Sleep cancels a wind-up or dash; the guardian starts its rhythm over when it wakes.
        enemy.phase = "chase";
        enemy.phaseTime = 0;
        delete enemy.action;
        delete enemy.foresight;
      } else {
        // A raised guardian's chase clock runs faster, so its attacks come sooner (params/guardian.ts).
        const fury = furyOf(world.stage, world.zone.index);
        [moveX, moveZ, speed] = guardianBrains[zoneDef(world).guardian.brain](
          world,
          enemy,
          target,
          speed,
          fury && enemy.phase === "chase" ? dt * fury.chaseRate : dt,
        );
        furyStep(world, enemy, target, dt);
      }
    } else if (target) {
      const def = enemyDefs[enemy.species];
      const step = def.skill
        ? skills[def.skill.kind].step(world, enemy, target, speed, dt, def.skill.every)
        : null;
      if (step) [moveX, moveZ, speed] = step;
      else {
        const heading = steerToward(world, enemy, target);
        if (def.move) enemyMoves[def.move](world, enemy, heading);
        moveX = heading.x;
        moveZ = heading.z;
      }
    }
    if (held && enemy.dodge) {
      enemy.dodge.until = 0;
      enemy.dodge.threat = 0;
    }
    const dodge = held ? null : dodgeStep(world, enemy, threats, speed);
    if (dodge) [moveX, moveZ, speed] = dodge;
    if (moveX !== 0 || moveZ !== 0) {
      enemy.faceX = moveX;
      enemy.faceZ = moveZ;
    }
    let dx = (moveX * speed + enemy.knockX) * dt;
    let dz = (moveZ * speed + enemy.knockZ) * dt;
    // Quicksand drags the swarm too; a guardian is never stuck in its own.
    if (surface?.patch?.kind === "quicksand" && !enemy.boss) {
      const [px, pz] = quicksandPull(surface.patch, enemy.x, enemy.z, QUICKSAND.pull);
      dx += px * dt;
      dz += pz * dt;
    }
    const knockDecay = Math.max(0, 1 - KNOCK_DECAY * dt);
    enemy.knockX *= knockDecay;
    enemy.knockZ *= knockDecay;

    // Overlapping bodies part by poise: the lighter one gives way (two equals split the overlap).
    const give = yieldTo(enemy);
    if (give > 0) {
      grid.query(enemy.x, enemy.z, enemy.radius + 1.4, (other) => {
        if (other === enemy) return;
        const ox = enemy.x - other.x;
        const oz = enemy.z - other.z;
        const minimum = enemy.radius + other.radius;
        const d2 = ox * ox + oz * oz;
        if (d2 >= minimum * minimum || d2 === 0) return;
        const d = Math.sqrt(d2);
        const push = ((minimum - d) / d) * (give / (give + yieldTo(other)));
        dx += ox * push;
        dz += oz * push;
      });
    }
    displace(world, enemy, dx, dz, moveX * speed * dt, moveZ * speed * dt);

    if (enemy.charge && (Math.abs(enemy.x) > ARENA_HALF + 6 || Math.abs(enemy.z) > ARENA_HALF + 6))
      enemy.hp = 0;
    for (const player of world.players) touch(ctx, enemy, player);
    // After the tick's reads, so held, interrupted and contact agree on every tick of a stagger.
    enemy.stagger = Math.max(0, enemy.stagger - dt);
  }
  world.enemies = world.enemies.filter((enemy) => enemy.hp > 0);
}

const heading: Direction = { x: 0, z: 0 };
/** The line test reruns every this many ticks per enemy, staggered by id; the result is cached. */
const SIGHTLINE_TICKS = 4;

/**
 * Unit heading toward the target, shared scratch (read it before the next call). Close enough and
 * with a clear line, straight at the target's current position every tick, so the flow field's
 * refresh lag never shows at melee range; otherwise along the class's flow field, and straight
 * again when the field has no route.
 */
export function steerToward(world: World, enemy: Enemy, target: Player): Direction {
  const { mobility } = enemyDefs[enemy.species];
  const dx = target.x - enemy.x;
  const dz = target.z - enemy.z;
  const distance = hypot(dx, dz);
  // Reading the field every tick keeps it marked as in use, so it stays fresh for when the line breaks.
  const routed = !mobility.flying && flowDirection(world.nav, mobility, enemy.x, enemy.z, heading);
  if (!routed || inPursuit(world, enemy, target, distance)) {
    heading.x = dx / (distance || 1);
    heading.z = dz / (distance || 1);
  }
  return heading;
}

function inPursuit(world: World, enemy: Enemy, target: Player, distance: number): boolean {
  if (distance >= PURSUIT_RANGE) {
    enemy.sightline = false;
    return false;
  }
  if ((world.tick + enemy.id) % SIGHTLINE_TICKS === 0) {
    const { mobility } = enemyDefs[enemy.species];
    enemy.sightline = hasWalkableLine(world.nav, mobility, enemy.x, enemy.z, target.x, target.z);
  }
  return enemy.sightline;
}

/**
 * All enemy displacement (stride, knockback, separation) goes through the shared mover. Stampede
 * runners leave the arena freely, and a runner that terrain stops mid-charge joins the chase.
 */
function displace(
  world: World,
  enemy: Enemy,
  dx: number,
  dz: number,
  strideX: number,
  strideZ: number,
): void {
  if (
    enemy.charge &&
    (Math.abs(enemy.x + dx) > ARENA_HALF || Math.abs(enemy.z + dz) > ARENA_HALF)
  ) {
    enemy.x += dx;
    enemy.z += dz;
    return;
  }
  const startX = enemy.x;
  const startZ = enemy.z;
  moveWithSlope(world.nav, enemyDefs[enemy.species].mobility, enemy, dx, dz);
  const stride = hypot(strideX, strideZ);
  if (!enemy.charge || stride === 0) return;
  const progress = ((enemy.x - startX) * strideX + (enemy.z - startZ) * strideZ) / stride;
  if (progress < stride * STAMPEDE_MIN_PROGRESS) {
    enemy.charge = false;
    enemy.speed /= STAMPEDE_SPEEDUP;
  }
}

function touch(ctx: Ctx, enemy: Enemy, player: Player): void {
  if (!player.alive || interrupted(enemy) || !targetable(enemy)) return;
  const reach = enemy.radius + formOf(player).radius;
  if ((enemy.x - player.x) ** 2 + (enemy.z - player.z) ** 2 > reach * reach) return;
  const { terrain } = ctx.world.map;
  if (!withinStep(terrain, enemy, heightAt(terrain, player.x, player.z))) return;
  if (!damagePlayer(ctx.world, player, enemy.dmg)) return;
  if (!enemy.boss && player.alive) guard(ctx.world, player);
  const { contact } = enemyDefs[enemy.species];
  if (contact) apply(player, contact.status, CONTACT_SECONDS, 0, -1);
  afterTouch(ctx, enemy, player);
}
