import type { Command } from "./state/commands";
import type { Player } from "./state/entities";
import type { World } from "./state/world";
import { hypot, exp } from "./math";
import {
  ACCEL_TIME,
  STOP_TIME,
  DASH_TIME,
  DASH_COOLDOWN,
  DASH_SPEEDUP,
} from "./content/params/player";
import { ICE_MOMENTUM } from "./content/params/environment";
import { formOf } from "./evolution";
import { mobilityClasses } from "./content/mobility";
import { moveWithSlope } from "./nav/index";
import { onIce } from "./skills/trail";
import { slowed } from "./status";

/** Shared by authoritative commands and the guest's private movement prediction. */
export function applyMovementCommand(player: Player, command: Command, frozen: boolean): boolean {
  switch (command.t) {
    case "move": {
      const length = hypot(command.x, command.z);
      const scale = length > 1 ? 1 / length : 1;
      player.inputX = Number.isFinite(command.x) ? command.x * scale : 0;
      player.inputZ = Number.isFinite(command.z) ? command.z * scale : 0;
      if (player.inputX !== 0 || player.inputZ !== 0) player.rescue = null;
      return false;
    }
    case "view":
      if (Number.isFinite(command.yaw)) player.viewYaw = command.yaw;
      return false;
    case "dash":
      if (!player.alive || player.dashes <= 0 || frozen) return false;
      player.rescue = null;
      player.dashTime = DASH_TIME;
      player.dashes -= 1;
      if (player.dashCooldown <= 0) player.dashCooldown = DASH_COOLDOWN;
      [player.dashX, player.dashZ] =
        player.inputX || player.inputZ
          ? [player.inputX, player.inputZ]
          : [player.faceX, player.faceZ];
      return true;
    default:
      return false;
  }
}

/**
 * Walking velocity moves toward the input at a fixed rate: full speed in `ACCEL_TIME`, a stop in
 * `STOP_TIME`. Anything faster (the tail of a dash) is cut to walking speed at once, so dashes
 * end crisply instead of gliding.
 */
function easeVelocity(player: Player, speed: number, dt: number): void {
  const current = hypot(player.vx, player.vz);
  if (current > speed) {
    player.vx *= speed / current;
    player.vz *= speed / current;
  }
  const targetX = player.inputX * speed;
  const targetZ = player.inputZ * speed;
  const gapX = targetX - player.vx;
  const gapZ = targetZ - player.vz;
  const gap = hypot(gapX, gapZ);
  const rate = (targetX !== 0 || targetZ !== 0 ? speed / ACCEL_TIME : speed / STOP_TIME) * dt;
  if (gap <= rate) {
    player.vx = targetX;
    player.vz = targetZ;
  } else {
    player.vx += (gapX / gap) * rate;
    player.vz += (gapZ / gap) * rate;
  }
}

/** Kinematics only: no attacks, damage, pickups, events or random draws. */
export function movePlayer(
  world: Pick<World, "nav" | "time" | "map" | "hazards">,
  player: Player,
  speed: number,
  dt: number,
): void {
  if (!player.alive || player.rescue) {
    player.dashTime = 0;
    player.vx = player.vz = 0;
    player.moving = false;
    return;
  }
  if (player.dashTime > 0) {
    player.dashTime -= dt;
    player.vx = player.dashX * speed * DASH_SPEEDUP;
    player.vz = player.dashZ * speed * DASH_SPEEDUP;
  } else {
    const walking = slowed(player, speed, world.time, player.id);
    if (onIce(world, player)) {
      const top = walking * ICE_MOMENTUM.speed;
      const current = hypot(player.vx, player.vz);
      if (current > top) {
        player.vx *= top / current;
        player.vz *= top / current;
      }
      const ease = 1 - exp(-ICE_MOMENTUM.response * dt * 30);
      player.vx += (player.inputX * top - player.vx) * ease;
      player.vz += (player.inputZ * top - player.vz) * ease;
      // Finish subpixel drift so standing-still effects and locomotion can settle.
      if (player.inputX === 0 && player.inputZ === 0 && hypot(player.vx, player.vz) < 0.01)
        player.vx = player.vz = 0;
    } else easeVelocity(player, walking, dt);
  }
  const { vx, vz } = player;
  player.moving = vx !== 0 || vz !== 0;
  if (player.moving) {
    const length = hypot(vx, vz);
    player.faceX = vx / length;
    player.faceZ = vz / length;
  }
  // The form's body, not a fixed 0.5: Blastoise and Charizard are wider than a starter.
  const { radius } = formOf(player);
  moveWithSlope(world.nav, mobilityClasses.ground, player, vx * dt, vz * dt, radius);
}

/** One charge returns per `DASH_COOLDOWN`; the timer runs only while a charge is missing. */
export function rechargeDash(player: Player, charges: number, dt: number): void {
  player.dashes = Math.min(player.dashes, charges);
  if (player.dashes >= charges) {
    player.dashCooldown = 0;
    return;
  }
  player.dashCooldown = Math.max(0, player.dashCooldown - dt);
  if (player.dashCooldown > 0) return;
  player.dashes += 1;
  if (player.dashes < charges) player.dashCooldown = DASH_COOLDOWN;
}
