import { BONEMERANG } from "../content/params/enemy-skills";
// Cubone's bonemerang (docs/state-machines/simulation.md`boomerang`): a locked lane, then a bone that flies
// `length` out along it and back to its thrower's current position, hurting on the way out and on the
// way back. Marowak throws the same bones (bosses/marowak.ts).

import { coverHit, stopAtCover } from "../sight";
import { formOf, hazardRadius } from "../evolution";
import { damagePlayer } from "../hurt";
import { heightAt } from "../terrain";
import { TICK, type World } from "../state/world";
import type { Enemy, Hazard } from "../state/entities";
import { hypot } from "../math";
import { addHazard, type HazardRule } from "./kit";
import { followCaster } from "./lunge";
import { telegraph } from "./telegraph";

/**
 * Throws one bone along (dirX, dirZ) that turns back after `length`. Each leg passes a body in less
 * than the player's i-frames, so a leg lands at most one hit on each player.
 */
export function throwBone(
  world: World,
  thrower: Enemy,
  dirX: number,
  dirZ: number,
  length: number,
  dmg: number,
  piercesCover?: true,
): void {
  addHazard(world, {
    kind: "bone",
    ...(piercesCover ? { piercesCover, element: "ghost" as const } : {}),
    x: thrower.x,
    y: heightAt(world.map.terrain, thrower.x, thrower.z) + BONEMERANG.height,
    z: thrower.z,
    vx: dirX * BONEMERANG.speed,
    vz: dirZ * BONEMERANG.speed,
    life: BONEMERANG.maxFlight,
    radius: BONEMERANG.radius,
    dmg,
    dirX,
    dirZ,
    length,
    caster: thrower.id,
  });
}

/** True while any bone of this thrower is in the air (it throws no other until they are back). */
export function bonesOut(world: World, thrower: Enemy): boolean {
  return world.hazards.some((hazard) => hazard.kind === "bone" && hazard.caster === thrower.id);
}

/** The warning lane for `seconds`: as long as the bone's reach out, following its thrower like a lunge's. */
export function boneLane(
  world: World,
  thrower: Enemy,
  dirX: number,
  dirZ: number,
  length: number,
  seconds: number,
): void {
  addHazard(world, {
    kind: "bone-warn",
    x: thrower.x,
    y: 0,
    z: thrower.z,
    // Integrated later in the tick that starts the wind-up.
    life: seconds + TICK,
    radius: BONEMERANG.radius,
    dirX,
    dirZ,
    length: Math.min(
      length,
      coverHit(
        world,
        thrower.x,
        heightAt(world.map.terrain, thrower.x, thrower.z) + BONEMERANG.height,
        thrower.z,
        dirX,
        dirZ,
        0,
        length,
      ),
    ),
    caster: thrower.id,
  });
}

export const bonemerang = telegraph({
  range: BONEMERANG.range,
  windup: BONEMERANG.windup,
  tell: "normal",
  partner: { style: "shot" },
  start(world, enemy) {
    boneLane(world, enemy, enemy.dashX, enemy.dashZ, BONEMERANG.length, BONEMERANG.windup);
  },
  release(world, enemy) {
    throwBone(
      world,
      enemy,
      enemy.dashX,
      enemy.dashZ,
      BONEMERANG.length,
      enemy.dmg * BONEMERANG.damage,
    );
  },
});

function fly(world: World, bone: Hazard): void {
  if (!bone.piercesCover && stopAtCover(world, bone)) return;
  bone.y = heightAt(world.map.terrain, bone.x, bone.z) + BONEMERANG.height;
  if (bone.length > 0) {
    bone.length -= BONEMERANG.speed * TICK;
  } else {
    const thrower = world.enemies.find((enemy) => enemy.id === bone.caster && enemy.hp > 0);
    const dx = (thrower?.x ?? 0) - bone.x;
    const dz = (thrower?.z ?? 0) - bone.z;
    const distance = hypot(dx, dz);
    // A bone whose thrower fell drops; one back in reach is caught.
    if (!thrower || distance < BONEMERANG.catch) {
      bone.life = 0;
      return;
    }
    bone.vx = (dx / distance) * BONEMERANG.speed;
    bone.vz = (dz / distance) * BONEMERANG.speed;
  }
  for (const player of world.players) {
    if (!player.alive) continue;
    if (hypot(player.x - bone.x, player.z - bone.z) > bone.radius + hazardRadius(player)) continue;
    const feet = heightAt(world.map.terrain, player.x, player.z);
    if (bone.y < feet - bone.radius || bone.y > feet + formOf(player).height + bone.radius)
      continue;
    damagePlayer(world, player, bone.dmg);
  }
}

export const hazards = {
  "bone-warn": { update: followCaster },
  bone: { update: fly },
} satisfies Record<string, HazardRule>;
