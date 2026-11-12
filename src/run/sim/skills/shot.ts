import { ENEMY_SHOTS } from "../content/params/enemy-skills";
// Nidoran's poison sting, Vulpix's ember, Magnemite's thunder shock, Meowth's coin and the fans of
// Nidorina (3 stings), Omastar (5 spikes) and Jolteon (3 pins), and Seadra's water gun: locked lanes that each fire one shot at the end of the wind-up.

import { coverHit } from "../sight";
import { TICK, type World } from "../state/world";
import type { Enemy, Hazard } from "../state/entities";
import { cos, sin } from "../math";
import { activeCaster, addHazard, mouthY, type HazardRule } from "./kit";
import { telegraph } from "./telegraph";

export type ShotKind = keyof typeof ENEMY_SHOTS;
export const warnOf = {
  icicle: "icicle-warn",
  flamethrower: "flamethrower-warn",
  "poison-sting": "poison-sting-warn",
  ember: "ember-warn",
  "thunder-shock": "thunder-shock-warn",
  "poison-fan": "poison-fan-warn",
  "pay-day": "pay-day-warn",
  "spike-cannon": "spike-cannon-warn",
  "water-gun": "water-gun-warn",
  "pin-missile": "pin-missile-warn",
} as const;

/** The lane, cut short at the first cover the shot would meet. */
function laneLength(
  world: World,
  kind: ShotKind,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirZ: number,
  rise: number,
): number {
  const shot = ENEMY_SHOTS[kind];
  const reach = shot.speed * shot.life;
  return Math.min(reach, coverHit(world, x, y, z, dirX, dirZ, rise, reach));
}

function shotSkill(kind: ShotKind) {
  const shot = ENEMY_SHOTS[kind];
  return telegraph({
    projectileSpeed: shot.speed,
    range: shot.range,
    windup: shot.windup,
    tell: "normal",
    partner: { style: "shot" },
    start(world, enemy, { y, goal, distance }) {
      const count = "count" in shot ? shot.count : 1;
      const spread = "spread" in shot ? shot.spread : 0;
      const rise = (goal - y) / distance;
      for (let i = 0; i < count; i++) {
        const angle = (i - (count - 1) / 2) * spread;
        const c = cos(angle);
        const s = sin(angle);
        const dirX = enemy.dashX * c - enemy.dashZ * s;
        const dirZ = enemy.dashX * s + enemy.dashZ * c;
        addHazard(world, {
          kind: warnOf[kind],
          x: enemy.x,
          y,
          z: enemy.z,
          life: shot.windup + TICK,
          radius: shot.radius,
          dirX,
          dirZ,
          rise,
          length: laneLength(world, kind, enemy.x, y, enemy.z, dirX, dirZ, rise),
          caster: enemy.id,
        });
      }
    },
  });
}

export const icicle = shotSkill("icicle");
export const flamethrower = shotSkill("flamethrower");
export const poisonSting = shotSkill("poison-sting");
export const ember = shotSkill("ember");
export const thunderShock = shotSkill("thunder-shock");
export const poisonFan = shotSkill("poison-fan");
export const payDay = shotSkill("pay-day");
export const spikeCannon = shotSkill("spike-cannon");
export const waterGun = shotSkill("water-gun");
export const pinMissile = shotSkill("pin-missile");

function fire(world: World, warning: Hazard, enemy: Enemy, kind: ShotKind): void {
  const shot = ENEMY_SHOTS[kind];
  addHazard(world, {
    kind,
    x: warning.x,
    y: warning.y,
    z: warning.z,
    vx: warning.dirX * shot.speed,
    vy: warning.rise * shot.speed,
    vz: warning.dirZ * shot.speed,
    life: shot.life,
    radius: shot.radius,
    dmg: enemy.dmg * shot.damage,
  });
}

/** Knockback moves the complete lane, while its locked heading stays readable. */
function warning(kind: ShotKind): HazardRule {
  return {
    update(world, lane) {
      const caster = activeCaster(world, lane);
      if (!caster) {
        lane.life = 0;
        return;
      }
      lane.x = caster.x;
      lane.y = mouthY(world, caster);
      lane.z = caster.z;
      lane.length = laneLength(
        world,
        kind,
        lane.x,
        lane.y,
        lane.z,
        lane.dirX,
        lane.dirZ,
        lane.rise,
      );
      if (lane.life <= 0) fire(world, lane, caster, kind);
    },
  };
}

export const hazards = {
  "icicle-warn": warning("icicle"),
  "flamethrower-warn": warning("flamethrower"),
  icicle: { slow: ENEMY_SHOTS.icicle.slow },
  flamethrower: {},
  "poison-sting-warn": warning("poison-sting"),
  "ember-warn": warning("ember"),
  "thunder-shock-warn": warning("thunder-shock"),
  "poison-fan-warn": warning("poison-fan"),
  "pay-day-warn": warning("pay-day"),
  "spike-cannon-warn": warning("spike-cannon"),
  "water-gun-warn": warning("water-gun"),
  "pin-missile-warn": warning("pin-missile"),
  "poison-sting": { poison: ENEMY_SHOTS["poison-sting"].poison },
  ember: {},
  "thunder-shock": {},
  "poison-fan": { poison: ENEMY_SHOTS["poison-fan"].poison },
  "pay-day": {},
  "spike-cannon": {},
  "water-gun": {},
  "pin-missile": {},
} satisfies Record<string, HazardRule>;
