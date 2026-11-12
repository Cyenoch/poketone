// Nova moves (Lava Plume, Discharge): one hit on everything within `area.radius` of the caster on
// the area's first tick. The impact is the whole effect: a ring that sweeps out to the hit radius
// in the area's 0.3 s life, a few things thrown to the rim, a short dark residue. No 准备 (no delay).

import { CHEST } from "../../sim/content/params/combat";
import { Decal } from "./decals";
import { flicker, rand, reach, spray, type AreaLook, type Echo, type Fx } from "./fx";
import { electric, fire, white } from "./palette";
import { Shape, sprite, type SpriteSpec } from "./sprites";

const plume = sprite({
  shape: Shape.flame,
  life: 0.3,
  grow: 0.5,
  from: fire.yellow,
  to: fire.red,
  accent: fire.core,
  add: 0.5,
  gravity: -3,
  drag: 5,
});
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

export const lavaPlume: AreaLook = {
  strike(fx, area, x, z) {
    const r = area.radius;
    const h = fx.ground.heightAt(x, z);
    fx.decals.stamp(
      Decal.ring,
      x,
      z,
      r,
      area.maxLife,
      fire.yellow,
      0.9,
      fire.deep,
      0.5,
      0.14,
      0.35,
    );
    fx.decals.stamp(Decal.glow, x, z, r * 0.9, 0.25, fire.orange, 0.4, fire.yellow, 1);
    fx.decals.stamp(Decal.scorch, x, z, r * 0.75, 1.2, fire.soot, 0.55, fire.orange, 0);
    fx.sprites.emit(heat, x, h + 0.4, z, 0, 0, 0, 0.5);
    toRim(fx, plume, x, h + 0.25, z, r, 18);
    spray(fx, ash, x, h + 0.3, z, 4, r * 0.8, 0.5, 0.18);
  },
};

/** Arcs from the caster out to the hit radius. a = radius, b = chest height. */
function drawDischarge(fx: Fx, echo: Echo, t: number): void {
  const seed = flicker(fx, echo.seed, 24);
  const alpha = 1 - t * t;
  const count = 6;
  const out = 0.35 + 0.65 * Math.min(1, t * 3);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + echo.seed;
    const d = echo.a * out * (0.85 + 0.15 * Math.sin(seed * 1.7 + i));
    const ex = echo.x + Math.cos(angle) * d;
    const ez = echo.z + Math.sin(angle) * d;
    fx.ribbons.bolt(
      echo.x,
      echo.b,
      echo.z,
      ex,
      fx.ground.heightAt(ex, ez) + 0.2,
      ez,
      seed + i * 3.3,
      0.07,
      electric.yellow,
      alpha,
    );
  }
}

export const discharge: AreaLook = {
  strike(fx, area, x, z) {
    const r = area.radius;
    const h = fx.ground.heightAt(x, z);
    fx.decals.stamp(
      Decal.ring,
      x,
      z,
      r,
      area.maxLife,
      electric.yellow,
      0.95,
      white,
      0.7,
      0.12,
      0.35,
    );
    fx.decals.stamp(Decal.glow, x, z, r * 0.85, 0.2, electric.yellow, 0.2, electric.gold, 0.6);
    fx.echoes.add(drawDischarge, 0.24, x, 0, z, r, h + CHEST);
    fx.sprites.emit(flash, x, h + CHEST, z, 0, 0, 0, 0.28);
    toRim(fx, spark, x, h + 0.3, z, r, 16);
  },
};
