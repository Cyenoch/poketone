import { ZONE_GUARDIAN as Z } from "../content/params/late-zones";
import { difficulties } from "../content/difficulties";
import type { ElementType } from "../content/elements";
import { coverHit } from "../sight";
import { heightAt } from "../terrain";
import { TICK, type World } from "../state/world";
import type { Enemy, Hazard, Player } from "../state/entities";
import { atan2, cos, sin, hypot } from "../math";
import { addHazard, chestOf, enter, mouthY, tell } from "../skills/kit";
import { range } from "../rng";
import { predictTarget } from "../enemy-aim";

export const telegraphScale = (world: World) => difficulties[world.difficulty].bossTelegraph;
export const lowHealth = (boss: Enemy) => boss.hp < boss.maxHp * Z.below;

export function aim(boss: Enemy, target: Player): void {
  const dx = target.x - boss.x,
    dz = target.z - boss.z,
    d = hypot(dx, dz) || 1;
  boss.dashX = dx / d;
  boss.dashZ = dz / d;
}

export function action(
  world: World,
  boss: Enemy,
  target: Player,
  attack: string,
  windup: number,
  active: number,
  recover: number,
  speed = 0,
  chain = 0,
  gap = 0,
): void {
  const tele = telegraphScale(world);
  aim(boss, predictTarget(world, boss, target, windup * tele));
  boss.action = {
    attack,
    windup: windup * tele,
    active,
    recover: recover * tele,
    speed,
    chain,
    gap: gap * tele,
  };
  enter(boss, "windup");
  tell(world, boss, "danger", windup * tele);
}

/** Beams lock all lanes together and clip to actual cover before showing the warning. */
export function beams(
  world: World,
  boss: Enemy,
  target: Player,
  count: number,
  spread: number,
  length: number,
  width: number,
  element: ElementType,
  slow = 0,
): void {
  const a = boss.action!,
    y = mouthY(world, boss);
  const d = hypot(target.x - boss.x, target.z - boss.z) || 1,
    rise = (chestOf(world, target) - y) / d;
  const heading = atan2(boss.dashZ, boss.dashX);
  for (let i = 0; i < count; i++) {
    const angle = heading + (i - (count - 1) / 2) * spread,
      dx = cos(angle),
      dz = sin(angle);
    addHazard(world, {
      kind: "boss-beam",
      x: boss.x,
      y,
      z: boss.z,
      life: a.windup + a.active + TICK,
      duration: a.windup + a.active,
      active: a.active,
      radius: width / 2,
      dmg: boss.dmg * Z.beam,
      dirX: dx,
      dirZ: dz,
      rise,
      length: Math.min(length, coverHit(world, boss.x, y, boss.z, dx, dz, rise, length)),
      caster: boss.id,
      element,
      slow,
    });
  }
}

/** Explicit lanes for fans of projectiles; flight itself still uses the shared cover rule. */
export function fanWarning(
  world: World,
  boss: Enemy,
  target: Player,
  count: number,
  spread: number,
  length: number,
  width: number,
  element: ElementType,
): void {
  const angle = atan2(boss.dashZ, boss.dashX),
    a = boss.action!,
    y = mouthY(world, boss),
    rise = (chestOf(world, target) - y) / (hypot(target.x - boss.x, target.z - boss.z) || 1);
  for (let i = 0; i < count; i++) {
    const heading = angle + (i - (count - 1) / 2) * spread,
      dx = cos(heading),
      dz = sin(heading);
    addHazard(world, {
      kind: "bone-warn",
      x: boss.x,
      y,
      z: boss.z,
      life: a.windup + TICK,
      radius: width,
      dirX: dx,
      dirZ: dz,
      rise,
      length: Math.min(length, coverHit(world, boss.x, y, boss.z, dx, dz, rise, length)),
      caster: boss.id,
      element,
    });
  }
}
/** Release the exact lanes that were shown, including cover, elevation and range. */
export function shots(world: World, boss: Enemy, speed: number, slow = 0, pool?: "poison"): void {
  const lanes = world.hazards.filter(
    (h) => h.kind === "bone-warn" && h.caster === boss.id && h.life > 0,
  );
  for (const lane of lanes) {
    addHazard(world, {
      kind: "boss-shot",
      x: lane.x,
      y: lane.y,
      z: lane.z,
      vx: lane.dirX * speed,
      vy: lane.rise * speed,
      vz: lane.dirZ * speed,
      life: lane.length / speed,
      radius: lane.radius,
      dmg: boss.dmg * Z.shot,
      element: lane.element,
      slow,
      pool,
      poolLife: Z.poolLife,
    });
    lane.life = 0;
  }
}

export function burst(
  world: World,
  boss: Enemy,
  count: number,
  element: ElementType,
  poison = 0,
): void {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    addHazard(world, {
      kind: "boss-shot",
      x: boss.x,
      y: heightAt(world.map.terrain, boss.x, boss.z) + Z.burstHeight,
      z: boss.z,
      vx: cos(angle) * Z.burstSpeed,
      vz: sin(angle) * Z.burstSpeed,
      life: Z.burstLife,
      radius: Z.shotRadius,
      dmg: boss.dmg * Z.burst,
      element,
      poison,
    });
  }
}
export function fallAt(
  world: World,
  boss: Enemy,
  x: number,
  z: number,
  radius: number,
  seconds: number,
  element: ElementType,
  pool?: "fire" | "poison",
  poolLife: number = Z.poolLife,
  delay = 0,
): Hazard {
  return addHazard(world, {
    kind: "boss-fall",
    x,
    y: heightAt(world.map.terrain, x, z),
    z,
    life: seconds + Z.fallResidue + TICK,
    duration: seconds + Z.fallResidue,
    active: Z.fallResidue,
    delay,
    radius,
    dmg: boss.dmg,
    caster: boss.id,
    element,
    pool,
    poolLife,
  });
}
export function falls(
  world: World,
  boss: Enemy,
  target: Player,
  count: number,
  ring: number,
  radius: number,
  seconds: number,
  element: ElementType,
  pool?: "fire" | "poison",
  poolLife: number = Z.poolLife,
  spacing = 0,
): void {
  target = predictTarget(world, boss, target, seconds);
  const turn = range(world.rng, 0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const angle = turn + (i / (count - 1)) * Math.PI * 2;
    fallAt(
      world,
      boss,
      i === 0 ? target.x : target.x + cos(angle) * ring,
      i === 0 ? target.z : target.z + sin(angle) * ring,
      radius,
      seconds,
      element,
      pool,
      poolLife,
      i * spacing,
    );
  }
}
export function lane(
  world: World,
  boss: Enemy,
  width: number,
  length: number,
  element: ElementType,
): void {
  const a = boss.action!;
  addHazard(world, {
    kind: "dash-warn",
    x: boss.x,
    y: heightAt(world.map.terrain, boss.x, boss.z),
    z: boss.z,
    life: a.windup + TICK,
    radius: width / 2,
    dirX: boss.dashX,
    dirZ: boss.dashZ,
    length,
    caster: boss.id,
    element,
  });
}
