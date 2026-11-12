// Steered shots (Will-O-Wisp, Shock Wave, Giga Drain). Basic tier: a head the size of the hitbox
// and a short trail; the curve itself is the signature, so trails are left behind in world space
// (particles), never stretched along the current heading. Drain hits send motes back to the caster.

import { CHEST } from "../../sim/content/params/combat";
import { flicker, perFrame, rand, spray, type Echo, type Fx, type ShotLook } from "./fx";
import { rgb } from "./gl";
import { electric, grass, white } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";

/** Will-O-Wisp's ghost flame: pale periwinkle, kept off the saturated enemy purple. */
const ghost = { core: rgb("#f4f2ff"), mid: rgb("#a9b6ff"), deep: rgb("#4f5cc4") };

const wispHalo = sprite({
  shape: Shape.glow,
  from: ghost.mid,
  accent: ghost.core,
  alpha: 0.5,
  add: 1,
});
const wispHead = sprite({ shape: Shape.flame, from: ghost.mid, accent: ghost.core, add: 0.4 });
const wispTrail = sprite({
  shape: Shape.flame,
  life: 0.35,
  grow: 0.3,
  from: ghost.mid,
  to: ghost.deep,
  accent: ghost.core,
  alpha: 0.85,
  add: 0.4,
  gravity: -2.5,
  drag: 2,
});
const wispFlash = sprite({
  shape: Shape.glow,
  life: 0.2,
  grow: 1.6,
  from: ghost.mid,
  to: ghost.deep,
  accent: ghost.core,
  alpha: 0.8,
  add: 0.7,
});

export const willOWisp: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(wispFlash, x, y, z, 0, 0, 0, 0.25);
  },
  fly(fx, shot, x, y, z) {
    const r = shot.radius;
    const bob = Math.sin(fx.time * 9 + shot.id) * 0.05;
    fx.sprites.draw(wispHalo, x, y + bob, z, r * 2.2, 0.6);
    fx.sprites.draw(wispHead, x, y + bob + r * 0.3, z, r * 1.4);
    for (let i = perFrame(fx, 40); i > 0; i--)
      fx.sprites.emit(wispTrail, x, y + bob, z, rand(-0.2, 0.2), 0.3, rand(-0.2, 0.2), r * 0.8);
  },
  hit(fx, x, y, z) {
    fx.sprites.emit(wispFlash, x, y, z, 0, 0, 0, 0.35);
    spray(fx, wispTrail, x, y, z, 5, 1, 1.2, 0.14);
  },
  fade(fx, x, y, z) {
    spray(fx, wispTrail, x, y, z, 3, 0.4, 0.6, 0.12);
  },
};

const voltHalo = sprite({
  shape: Shape.glow,
  from: electric.gold,
  accent: electric.yellow,
  alpha: 0.5,
  add: 1,
});
const voltCore = sprite({ shape: Shape.star, from: electric.yellow, accent: white, add: 1 });
const voltRing = sprite({
  shape: Shape.ring,
  from: electric.yellow,
  accent: white,
  alpha: 0.8,
  add: 1,
});
const voltSpark = sprite({
  shape: Shape.spark,
  life: 0.22,
  grow: 0.4,
  from: electric.yellow,
  to: electric.gold,
  accent: white,
  add: 1,
  gravity: 5,
  drag: 2.5,
  stretch: 0.03,
});
const voltFlash = sprite({
  shape: Shape.star,
  life: 0.16,
  grow: 1.6,
  from: electric.yellow,
  accent: white,
  add: 1,
  spin: 3,
});

export const shockWave: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(voltFlash, x, y, z, 0, 0, 0, 0.35);
  },
  fly(fx, shot, x, y, z) {
    const r = shot.radius;
    // A pulsing ring around a small core: Shock Wave's "wave", apart from Thunder Shock's streak.
    const pulse = (fx.time * 4 + shot.id * 0.37) % 1;
    fx.sprites.draw(voltHalo, x, y, z, r * 2.6, 0.5);
    fx.sprites.draw(voltRing, x, y, z, r * (1.3 + pulse * 1.3), 1 - pulse);
    fx.sprites.draw(voltCore, x, y, z, r * 1.4, 1, 0, 0, fx.time * 18);
    const seed = flicker(fx, shot.id, 20);
    const a = seed * 2.3;
    fx.ribbons.bolt(
      x + Math.cos(a) * r,
      y + Math.sin(a * 1.7) * r * 0.5,
      z + Math.sin(a) * r,
      x - Math.cos(a) * r * 2.4,
      y,
      z - Math.sin(a) * r * 2.4,
      seed,
      0.04,
      electric.yellow,
      0.8,
    );
    for (let i = perFrame(fx, 22); i > 0; i--)
      fx.sprites.emit(voltSpark, x, y, z, rand(-2, 2), rand(-0.5, 2), rand(-2, 2), 0.07);
  },
  hit(fx, x, y, z) {
    fx.sprites.emit(voltFlash, x, y, z, 0, 0, 0, 0.6);
    spray(fx, voltSpark, x, y, z, 8, 5, 3, 0.09);
  },
  fade(fx, x, y, z) {
    spray(fx, voltSpark, x, y, z, 4, 3, 2, 0.08);
  },
};

const drainHalo = sprite({
  shape: Shape.glow,
  from: grass.leaf,
  accent: grass.light,
  alpha: 0.55,
  add: 1,
});
const drainCore = sprite({ shape: Shape.ball, from: grass.lime, accent: grass.deep });
const drainMote = sprite({
  shape: Shape.glow,
  life: 0.4,
  grow: 0.4,
  from: grass.light,
  to: grass.leaf,
  accent: white,
  add: 1,
  drag: 1.5,
});
const drainFlash = sprite({
  shape: Shape.star,
  life: 0.16,
  grow: 1.5,
  from: grass.light,
  accent: white,
  add: 1,
  spin: 2,
});
/** Motes that fly back to the caster; their life is the flight time. */
const drainReturn = sprite({
  shape: Shape.glow,
  life: 0.32,
  grow: 0.6,
  from: grass.sun,
  to: grass.lime,
  accent: white,
  add: 1,
});
const healGlow = sprite({
  shape: Shape.glow,
  life: 0.3,
  grow: 1.3,
  from: grass.lime,
  to: grass.leaf,
  accent: white,
  alpha: 0.6,
  add: 0.8,
});

export const gigaDrain: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(drainFlash, x, y, z, 0, 0, 0, 0.25);
  },
  fly(fx, shot, x, y, z) {
    const r = shot.radius;
    fx.sprites.draw(drainHalo, x, y, z, r * 2.2, 0.6);
    fx.sprites.draw(drainCore, x, y, z, r * 1.1);
    for (let i = perFrame(fx, 30); i > 0; i--)
      fx.sprites.emit(drainMote, x, y, z, rand(-0.4, 0.4), rand(-0.2, 0.5), rand(-0.4, 0.4), 0.06);
  },
  hit(fx, x, y, z) {
    fx.sprites.emit(drainFlash, x, y, z, 0, 0, 0, 0.4);
    spray(fx, drainMote, x, y, z, 6, 1.5, 1, 0.08);
  },
  fade(fx, x, y, z) {
    spray(fx, drainMote, x, y, z, 4, 0.8, 0.6, 0.07);
  },
};

/** The drained life running back: a streak from the hit (echo x, y, z) to the caster (a, b, c). */
function drawDrain(fx: Fx, echo: Echo, t: number): void {
  const head = Math.min(1, t * 1.4);
  const tail = Math.max(0, head - 0.45);
  for (let i = 0; i <= 6; i++) {
    const k = tail + ((head - tail) * i) / 6;
    const lift = Math.sin(k * Math.PI) * 0.35;
    fx.ribbons.point(
      echo.x + (echo.a - echo.x) * k,
      echo.y + (echo.b - echo.y) * k + lift,
      echo.z + (echo.c - echo.z) * k,
      0.05 + 0.07 * (i / 6),
      grass.sun,
      (1 - t * t) * (0.3 + 0.7 * (i / 6)),
    );
  }
  fx.ribbons.flush(Ribbon.streak, 0.6);
}

/** A drain hit at (fromX, fromZ) healed the caster standing at (x, z): life streams back to it. */
export function drainBack(fx: Fx, fromX: number, fromZ: number, x: number, z: number): void {
  const fromY = fx.ground.heightAt(fromX, fromZ) + CHEST;
  const y = fx.ground.heightAt(x, z) + CHEST;
  fx.echoes.add(drawDrain, 0.3, fromX, fromY, fromZ, x, y, z);
  const t = drainReturn.life;
  for (let i = 0; i < 3; i++) {
    const ox = rand(-0.25, 0.25);
    const oz = rand(-0.25, 0.25);
    fx.sprites.emit(
      drainReturn,
      fromX + ox,
      fromY + rand(-0.15, 0.25),
      fromZ + oz,
      (x - fromX - ox) / t,
      (y - fromY) / t,
      (z - fromZ - oz) / t,
      0.13,
    );
  }
  fx.sprites.emit(healGlow, x, y, z, 0, 0, 0, 0.35);
}
