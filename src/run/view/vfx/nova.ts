// Nova moves (Lava Plume, Discharge): one hit on everything within `area.radius` of the caster on
// the area's first tick. The impact is the whole effect: a full-radius edge at impact
// that thins during the area's life, things thrown to the rim, a short dark residue. A 准备 is drawn
// only when the sim delays the hit.

import { CHEST } from "../../sim/content/params/combat";
import { Decal } from "./decals";
import { flicker, perFrame, rand, reach, spray, type AreaLook, type Echo, type Fx } from "./fx";
import { electric, fire, white } from "./palette";
import { Shape, sprite, type SpriteSpec } from "./sprites";

const ash = sprite({
  shape: Shape.puff,
  life: 0.7,
  grow: 1.8,
  from: fire.ash,
  to: fire.smoke,
  accent: fire.smoke,
  alpha: 0.75,
  gravity: -1.2,
  drag: 3,
  spin: 0.6,
});
const heat = sprite({
  shape: Shape.glow,
  life: 0.22,
  grow: 1.4,
  from: fire.orange,
  to: fire.red,
  accent: fire.core,
  alpha: 0.6,
  add: 0.6,
});
const spark = sprite({
  shape: Shape.spark,
  life: 0.24,
  grow: 0.4,
  from: electric.yellow,
  to: electric.gold,
  accent: white,
  add: 1,
  drag: 6,
  stretch: 0.03,
});
const flash = sprite({
  shape: Shape.star,
  life: 0.16,
  grow: 1.5,
  from: electric.yellow,
  accent: white,
  add: 1,
  spin: 3,
});

/** Throws `n` particles flat from the centre so they coast to the hit radius over their life. */
function toRim(fx: Fx, spec: SpriteSpec, x: number, y: number, z: number, r: number, n: number) {
  const speed = reach(r, spec.life, spec.drag);
  for (let i = 0; i < n; i++) {
    const a = ((i + Math.random() * 0.5) / n) * Math.PI * 2;
    fx.sprites.emit(spec, x, y, z, Math.cos(a) * speed, rand(0, 0.6), Math.sin(a) * speed, 0.16);
  }
}

const column = sprite({
  shape: Shape.flame,
  life: 0.34,
  grow: 1.3,
  from: fire.yellow,
  to: fire.red,
  accent: fire.core,
  add: 0.5,
  gravity: -2,
  drag: 2.5,
});
const wave = sprite({
  shape: Shape.flame,
  life: 0.3,
  grow: 0.7,
  from: fire.yellow,
  to: fire.red,
  accent: fire.core,
  add: 0.5,
  gravity: -3,
  drag: 5,
});
const glob = sprite({
  shape: Shape.ball,
  life: 0.7,
  grow: 0.5,
  from: fire.yellow,
  to: fire.deep,
  accent: fire.red,
  gravity: 14,
  drag: 0.4,
});
const bubble = sprite({
  shape: Shape.glow,
  life: 0.25,
  grow: 1.6,
  from: fire.orange,
  to: fire.red,
  accent: fire.yellow,
  add: 1,
  gravity: -2,
});

/** Lava bursts out from the centre to the rim in this share of the area's life. */
const ERUPT = 0.45;

/** The eruption front running out to the rim, throwing up columns of lava. a = radius. */
function drawEruption(fx: Fx, echo: Echo, t: number): void {
  if (t > ERUPT) return;
  const front = echo.a * Math.min(1, 0.25 + t / ERUPT);
  for (let i = perFrame(fx, 260); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    const d = front * rand(0.7, 1);
    const px = echo.x + Math.cos(a) * d;
    const pz = echo.z + Math.sin(a) * d;
    const floor = fx.ground.heightAt(px, pz);
    fx.sprites.emit(column, px, floor + 0.1, pz, 0, rand(2.5, 4), 0, rand(0.22, 0.32), floor);
  }
}

/**
 * Lava Plume: the ground under the caster cracks and glows, then lava erupts from the centre out to
 * the full radius in columns about a metre tall, flinging molten globs that land at the rim. A
 * delayed cast (if the sim gives it one) builds the glow and bubbles first. Leaves cooling cracks.
 */
export const lavaPlume: AreaLook = {
  live(fx, area, x, z, charge) {
    if (area.delay <= 0) return;
    const r = area.radius;
    fx.decals.put(Decal.glow, x, z, r * charge).tint(fire.orange, 0.5 * charge, fire.yellow, 1);
    for (let i = perFrame(fx, 40 * charge); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      const d = r * charge * Math.sqrt(Math.random());
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      fx.sprites.emit(bubble, px, fx.ground.heightAt(px, pz) + 0.05, pz, 0, 0.5, 0, 0.12);
    }
  },
  strike(fx, area, x, z) {
    const r = area.radius;
    const h = fx.ground.heightAt(x, z);
    fx.decals.stamp(Decal.glow, x, z, r, 0.35, fire.orange, 0.7, fire.yellow, 1);
    fx.decals.stamp(Decal.cracks, x, z, r * 0.95, 1.1, fire.yellow, 1, fire.orange, 0);
    fx.decals.stamp(Decal.ring, x, z, r, 0.2, fire.orange, 0.6, fire.yellow, 0.4, 0.08, 1);
    fx.decals.stamp(Decal.ring, x, z, r, area.maxLife, fire.orange, 0.7, fire.red, 0.3, 0.04, 1);
    fx.decals.stamp(Decal.scorch, x, z, r * 0.8, 1.2, fire.soot, 0.55, fire.orange, 0);
    fx.sprites.emit(heat, x, h + 0.4, z, 0, 0, 0, 0.55);
    fx.echoes.add(drawEruption, area.maxLife, x, h, z, r);
    // The wall of flame racing out to the rim.
    const speed = reach(r * 0.95, wave.life, wave.drag);
    for (let i = 0; i < 36; i++) {
      const a = ((i + Math.random() * 0.5) / 36) * Math.PI * 2;
      fx.sprites.emit(
        wave,
        x + Math.cos(a) * 0.3,
        h + 0.25,
        z + Math.sin(a) * 0.3,
        Math.cos(a) * speed,
        rand(0.3, 0.8),
        Math.sin(a) * speed,
        rand(0.24, 0.32),
      );
    }
    for (let i = 0; i < 10; i++) {
      const a = ((i + Math.random() * 0.6) / 10) * Math.PI * 2;
      const d = r * rand(0.1, 0.5);
      const lift = rand(3.5, 5);
      const out = (r * rand(0.85, 1.05) - d) / ((2 * lift) / glob.gravity);
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      fx.sprites.emit(
        glob,
        px,
        h + 0.3,
        pz,
        Math.cos(a) * out,
        lift,
        Math.sin(a) * out,
        rand(0.07, 0.1),
        fx.ground.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r),
      );
    }
    spray(fx, ash, x, h + 0.4, z, 4, r * 0.8, 0.6, 0.2);
  },
};

/** Arcs from the caster out to the hit radius. a = radius, b = chest height. */
function drawDischarge(fx: Fx, echo: Echo, t: number): void {
  const seed = flicker(fx, echo.seed, 24);
  const alpha = (1 - t) ** 2;
  // Bolt count follows the radius so a 4–5 m discharge stays a dense starburst, not six lines.
  const count = Math.max(6, Math.round(echo.a * 2.2));
  const out = 1 - t * 0.2;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + echo.seed;
    const d = echo.a * out * (0.85 + 0.15 * Math.sin(seed * 1.7 + i));
    const ex = echo.x + Math.cos(angle) * d;
    const ez = echo.z + Math.sin(angle) * d;
    const ey = fx.ground.heightAt(ex, ez) + 0.2;
    fx.ribbons.bolt(
      echo.x,
      echo.b,
      echo.z,
      ex,
      ey,
      ez,
      seed + i * 3.3,
      0.07,
      electric.yellow,
      alpha,
    );
    // A fork off the outer half of every other bolt fills the disc between the spokes.
    if (i % 2) continue;
    const mx = echo.x + Math.cos(angle) * d * 0.55;
    const mz = echo.z + Math.sin(angle) * d * 0.55;
    const fa = angle + (i % 4 ? 0.45 : -0.45);
    const fx2 = echo.x + Math.cos(fa) * d * 0.85;
    const fz2 = echo.z + Math.sin(fa) * d * 0.85;
    fx.ribbons.bolt(
      mx,
      (echo.b + ey) * 0.5,
      mz,
      fx2,
      fx.ground.heightAt(fx2, fz2) + 0.15,
      fz2,
      seed + i * 5.1,
      0.045,
      electric.yellow,
      alpha * 0.8,
    );
  }
}

export const discharge: AreaLook = {
  strike(fx, area, x, z) {
    const r = area.radius;
    const h = fx.ground.heightAt(x, z);
    fx.decals.stamp(Decal.ring, x, z, r, area.maxLife, electric.yellow, 0.95, white, 0.7, 0.05, 1);
    fx.decals.stamp(Decal.glow, x, z, r * 0.85, 0.2, electric.yellow, 0.2, electric.gold, 0.6);
    fx.echoes.add(drawDischarge, 0.24, x, 0, z, r, h + CHEST);
    fx.sprites.emit(flash, x, h + CHEST, z, 0, 0, 0, 0.28);
    toRim(fx, spark, x, h + 0.3, z, r, Math.max(16, Math.round(r * 5)));
  },
};
