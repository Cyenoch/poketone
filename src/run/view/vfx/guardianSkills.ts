// P4–P6 geometry and phase fields come directly from sim/bosses/zone-hazards.ts.
import { boxHalf, orbitAngle, sweepHeading } from "../../sim/bosses/zone-hazards";
import { ZONE_ATTACK } from "../../sim/content/params/late-zones";
import { coverHit } from "../../sim/sight";
import type { Hazard } from "../../sim/state/entities";
import type { World } from "../../sim/state/world";
import { Decal } from "./decals";
import { perFrame, spray, type Fx } from "./fx";
import { rgb, type Rgb } from "./gl";
import { danger, fire, poison, powder, stone, water, white } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";
import { iceSlick } from "./desertSkills";

const dragon = rgb("#9870e2");
const ice = sprite({ shape: Shape.shard, from: water.foam, accent: water.deep });
const flame = sprite({ shape: Shape.flame, from: fire.orange, accent: fire.core, add: 0.35 });
const ghost = sprite({
  shape: Shape.flame,
  from: poison.purple,
  accent: powder.lilac,
  alpha: 0.85,
});
const shadow = sprite({ shape: Shape.ball, from: poison.deep, accent: poison.light });
const psychic = sprite({ shape: Shape.star, from: powder.lilac, accent: white, add: 0.3 });
const ember = sprite({
  shape: Shape.puff,
  life: 0.4,
  from: fire.orange,
  to: fire.soot,
  accent: fire.deep,
  grow: 1.6,
  drag: 3,
});
const frost = sprite({
  shape: Shape.shard,
  life: 0.4,
  from: water.foam,
  to: water.light,
  accent: water.deep,
  gravity: 6,
  drag: 2,
});
const mote = sprite({
  shape: Shape.star,
  life: 0.35,
  from: powder.lilac,
  to: poison.deep,
  accent: white,
  grow: 0.2,
  drag: 2,
});
const mist = sprite({ shape: Shape.cloud, from: water.foam, accent: water.light, alpha: 0.16 });
const note = sprite({ shape: Shape.note, from: powder.pink, accent: powder.mist });

function elementColor(h: Hazard): Rgb {
  if (h.element === "fire") return fire.orange;
  if (h.element === "ice" || h.element === "water") return water.light;
  if (h.element === "poison" || h.element === "ghost") return poison.purple;
  if (h.element === "psychic") return powder.lilac;
  if (h.element === "fairy") return powder.pink;
  if (h.element === "dragon") return dragon;
  return stone.light;
}

export function teleportMark(fx: Fx, h: Hazard): void {
  const fade = Math.min(1, h.life * 6);
  fx.decals
    .put(Decal.ring, h.x, h.z, h.radius * 1.5)
    .tint(powder.lilac, fade * 0.6, white, 0)
    .args(0, 0.045, 1);
  fx.sprites.draw(psychic, h.x, h.y + 0.6, h.z, 0.15, fade * 0.7);
}

/** Red wind-up, element-coloured contact, dark residue; no delayed circle appears early. */
export function fallingStrike(fx: Fx, h: Hazard, charge: number, fresh: boolean): void {
  const color = elementColor(h);
  if (h.dmg > 0) {
    fx.danger
      .put(Decal.telegraph, h.x, h.z, h.radius, 0, h.id)
      .tint(danger.red, 0.95, danger.deep, 0)
      .args(charge);
    if (charge > 0.5) {
      const head =
        h.element === "ice" || h.element === "water"
          ? ice
          : h.element === "fire" || h.element === "dragon"
            ? flame
            : psychic;
      fx.sprites.draw(head, h.x, h.y + 0.4 + (1 - charge) * 10, h.z, h.radius * 0.3);
    }
    return;
  }
  const fade = Math.min(1, h.life / 0.3);
  fx.danger
    .put(Decal.ring, h.x, h.z, h.radius)
    .tint(color, fade, danger.deep, 0)
    .args(1 - fade, 0.18);
  if (fresh)
    spray(
      fx,
      h.element === "ice" || h.element === "water"
        ? frost
        : h.element === "fire" || h.element === "dragon"
          ? ember
          : mote,
      h.x,
      h.y + 0.1,
      h.z,
      8,
      h.radius * 2,
      1.4,
      0.2,
    );
}

/** The rectangle is exactly the damaging beam; the bright core stays inside it. */
function beam(
  fx: Fx,
  h: Hazard,
  dx: number,
  dz: number,
  length: number,
  charge: number,
  active: boolean,
): void {
  const yaw = Math.atan2(dx, dz);
  const color = elementColor(h);
  const fade = active ? Math.min(1, h.life / 0.12) : 1;
  fx.danger
    .put(active ? Decal.strip : Decal.danger, h.x, h.z, length, yaw)
    .rect(-h.radius, 0, h.radius, length)
    .tint(active ? color : danger.red, fade * 0.95, active ? white : danger.deep, active ? 0.4 : 0)
    .args(charge, h.radius, 0);
  if (!active) return;
  const segments = Math.ceil(length / 0.8);
  for (let i = 0; i <= segments; i++) {
    const along = (i / segments) * length;
    fx.ribbons.point(
      h.x + dx * along,
      h.y + h.rise * along,
      h.z + dz * along,
      h.radius * 0.55,
      color,
      fade * 0.8,
    );
  }
  fx.ribbons.flush(Ribbon.glow, 0.5);
}

export function bossBeam(fx: Fx, h: Hazard): void {
  const active = h.life <= h.active!;
  const charge = Math.max(0, 1 - (h.life - h.active!) / (h.duration! - h.active!));
  beam(fx, h, h.dirX, h.dirZ, h.length, charge, active);
}

export function coneHazard(fx: Fx, h: Hazard): void {
  const active = h.life <= h.active!;
  const charge = Math.max(0, 1 - (h.life - h.active!) / (h.duration! - h.active!));
  const fade = active ? Math.min(1, h.life / 0.15) : 1;
  if (h.element === "fairy") {
    fx.danger
      .put(active ? Decal.ring : Decal.telegraph, h.x, h.z, h.length, 0, h.id)
      .tint(powder.pink, fade * 0.95, powder.lilac, 0)
      .args(active ? 1 - fade : charge, 0.14);
    for (let i = 0; i < 4; i++) {
      const a = fx.time + (i * Math.PI) / 2;
      fx.sprites.draw(
        note,
        h.x + Math.cos(a) * h.length * 0.6,
        h.y + 0.6,
        h.z + Math.sin(a) * h.length * 0.6,
        0.3,
        fade * 0.8,
      );
    }
    return;
  }
  fx.danger
    .put(Decal.cone, h.x, h.z, h.length, Math.atan2(h.dirX, h.dirZ))
    .tint(active ? elementColor(h) : danger.red, fade, danger.deep, 0)
    .args(charge, h.angle!, active ? 1 : 0);
  if (active && h.element === "fire" && h.angle === Math.PI)
    fx.danger
      .put(Decal.blast, h.x, h.z, h.length * 0.8, 0, h.id)
      .tint(fire.orange, fade, fire.yellow, 0)
      .args(0.4, 1);
}

export function sweepHazard(fx: Fx, world: World, h: Hazard): void {
  if (h.life > h.active!) {
    coneHazard(fx, h);
    return;
  }
  // Keep the fan dim during the sweep, so it communicates the remaining arc without hiding the beam.
  fx.danger
    .put(Decal.cone, h.x, h.z, h.length, Math.atan2(h.dirX, h.dirZ))
    .tint(danger.red, 0.28, danger.deep, 0)
    .args(1, h.angle!, 0);
  const angle = sweepHeading(h),
    dx = Math.cos(angle),
    dz = Math.sin(angle);
  beam(
    fx,
    h,
    dx,
    dz,
    Math.min(h.length, coverHit(world, h.x, h.y, h.z, dx, dz, h.rise, h.length)),
    1,
    true,
  );
}

/** Four thin sides, with the actual 2.4 m opening; no fill claims that the safe interior hurts. */
export function closingBox(fx: Fx, h: Hazard): void {
  const half = boxHalf(h),
    active = h.life <= h.active!;
  const charge = Math.max(0, 1 - (h.life - h.active!) / (h.duration! - h.active!));
  for (let side = 0; side < 4; side++) {
    const sign = side < 2 ? 1 : -1;
    const vertical = side % 2 === 0;
    const gaps = side === h.gap;
    for (let part = 0; part < (gaps ? 2 : 1); part++) {
      const from = gaps && part === 1 ? ZONE_ATTACK.cage.gapHalf : -half;
      const to = gaps && part === 0 ? -ZONE_ATTACK.cage.gapHalf : half;
      if (to <= from) continue;
      const x = h.x + (vertical ? sign * half : from),
        z = h.z + (vertical ? from : sign * half);
      fx.danger
        .put(Decal.danger, x, z, to - from, vertical ? 0 : Math.PI / 2)
        .rect(-h.radius, 0, h.radius, to - from)
        .tint(active ? powder.pink : danger.red, 0.95, danger.deep, 0)
        .args(active ? 1 : charge, h.radius);
      if (active) {
        fx.ribbons.point(x, h.y + 0.15, z, h.radius, powder.pink, 0.6);
        fx.ribbons.point(
          x + (vertical ? 0 : to - from),
          h.y + 0.15,
          z + (vertical ? to - from : 0),
          h.radius,
          powder.pink,
          0.6,
        );
        fx.ribbons.flush(Ribbon.solid, 0);
      }
    }
  }
}

export function orbitHazard(fx: Fx, h: Hazard): void {
  const angle = orbitAngle(h),
    fade = Math.min(1, h.life / 0.2);
  for (let i = 0; i < ZONE_ATTACK.shell.count; i++) {
    const a = angle + (i * Math.PI) / ZONE_ATTACK.shell.spacingDivisor,
      x = h.x + Math.cos(a) * h.length,
      z = h.z + Math.sin(a) * h.length;
    fx.danger
      .put(Decal.ring, x, z, h.radius)
      .tint(water.light, fade, water.dark, 0)
      .args(0, 0.2, 1);
    fx.sprites.draw(ice, x, h.y + 0.5, z, h.radius, fade, -Math.sin(a), Math.cos(a));
  }
}

export function curseMark(fx: Fx, h: Hazard): void {
  const locked = h.life <= h.active! + ZONE_ATTACK.curse.residue;
  const charge = Math.max(
    0,
    1 - (h.life - ZONE_ATTACK.curse.residue) / (h.duration! - ZONE_ATTACK.curse.residue),
  );
  if (h.dmg > 0) {
    fx.danger
      .put(Decal.telegraph, h.x, h.z, h.radius, 0, h.id)
      .tint(locked ? danger.red : poison.purple, 0.95, poison.deep, 0)
      .args(charge);
    // A second narrow rim only after lock distinguishes "following" from "leave this spot".
    if (locked)
      fx.danger
        .put(Decal.ring, h.x, h.z, h.radius * 0.82)
        .tint(danger.pale, 0.65, poison.deep, 0)
        .args(0, 0.025, 1);
  } else {
    const fade = Math.min(1, h.life / 0.3);
    fx.danger
      .put(Decal.ring, h.x, h.z, h.radius)
      .tint(poison.purple, fade, poison.deep, 0)
      .args(1 - fade, 0.18);
  }
}

export function bossShot(fx: Fx, h: Hazard, x: number, y: number, z: number): void {
  const color = elementColor(h);
  fx.danger.put(Decal.ring, x, z, h.radius).tint(color, 0.8, danger.deep, 0).args(0, 0.2, 1);
  fx.sprites.draw(
    h.element === "ice"
      ? ice
      : h.element === "fire"
        ? flame
        : h.element === "poison"
          ? shadow
          : ghost,
    x,
    y,
    z,
    h.radius,
    1,
    h.vx,
    h.vz,
  );
}

export function ghostFire(fx: Fx, h: Hazard, x: number, z: number): void {
  const armed = h.duration! - h.life >= ZONE_ATTACK.ghostFire.arm;
  const fade = Math.min(1, h.life / 0.3);
  fx.danger
    .put(Decal.ring, x, z, h.radius)
    .tint(poison.purple, fade * (armed ? 0.85 : 0.4), poison.deep, 0)
    .args(0, 0.15, 1);
  fx.sprites.draw(ghost, x, fx.ground.heightAt(x, z) + 0.45, z, h.radius * 0.55, fade);
}

export function iceTrail(fx: Fx, h: Hazard): void {
  const steps = Math.max(1, Math.ceil(h.length));
  for (let i = 0; i <= steps; i++) {
    const along = (i / steps) * h.length;
    iceSlick(
      fx,
      h.x + h.dirX * along,
      h.z + h.dirZ * along,
      h.radius,
      Math.min(1, h.life / 0.5),
      h.id + i,
    );
  }
}

/** Lapras's constant aura is an element ring, without a filling attack clock. */
export function iceMist(fx: Fx, h: Hazard): void {
  fx.danger
    .put(Decal.ring, h.x, h.z, h.radius)
    .tint(water.light, 0.7, water.dark, 0)
    .args(0, 0.04, 1);
  for (let i = 0; i < 5; i++) {
    const angle = fx.time * 0.18 + (i * Math.PI * 2) / 5;
    fx.sprites.draw(
      mist,
      h.x + Math.cos(angle) * h.radius * 0.7,
      h.y + 0.2,
      h.z + Math.sin(angle) * h.radius * 0.7,
      0.7,
      0.5,
    );
  }
}

export function burningPool(fx: Fx, h: Hazard): void {
  const fade = Math.min(1, h.life / 0.5);
  fx.danger
    .put(Decal.scorch, h.x, h.z, h.radius, 0, h.id)
    .tint(fire.soot, fade, fire.orange, 0)
    .args(0.3);
  fx.danger
    .put(Decal.ring, h.x, h.z, h.radius)
    .tint(fire.orange, fade * 0.65, fire.deep, 0)
    .args(0, 0.07, 1);
  if (perFrame(fx, 8 * fade))
    fx.sprites.emit(flame, h.x, h.y + 0.15, h.z, 0, 0.5, 0, Math.min(0.35, h.radius * 0.25));
}
