// Standing marks on special enemies (skill-vfx), drawn where the body stands each frame: an elite
// keeps its own colours and gets a gold ring at its feet with motes rising off it; a shiny gets a
// pale glow underfoot and, every so often, the games' four-point glint burst across its body (its
// recoloured model and the twinkles in createRunView.ts stay). View-only and stateless: phases come
// from time and the enemy's id.

import { Decal } from "./decals";
import { perFrame, rand, type Fx } from "./fx";
import { gold, powder, white } from "./palette";
import { Shape, sprite } from "./sprites";

const eliteMote = sprite({
  shape: Shape.glow,
  life: 0.7,
  grow: 0.3,
  from: gold.white,
  to: gold.yellow,
  accent: white,
  add: 1,
  gravity: -1.8,
  drag: 1,
});
const glint = sprite({
  shape: Shape.star,
  life: 0.4,
  grow: 1.2,
  from: white,
  to: powder.mist,
  accent: white,
  add: 1,
  spin: 1.5,
});

/** Seconds between a shiny's glint bursts, and the stars in each. */
const GLINT_EVERY = 1.6;
const GLINTS = 3;

export function eliteMark(fx: Fx, x: number, z: number, radius: number, height: number): void {
  const reach = radius * 1.35;
  const pulse = 0.85 + 0.15 * Math.sin(fx.time * 4 + x);
  fx.decals.put(Decal.glow, x, z, reach).tint(gold.yellow, 0.35 * pulse, gold.white, 1);
  fx.decals.put(Decal.ring, x, z, reach).tint(gold.yellow, 0.9, gold.deep, 0.6).args(0, 0.1, 1);
  const h = fx.ground.heightAt(x, z);
  for (let i = perFrame(fx, 5); i > 0; i--) {
    const a = rand(0, Math.PI * 2);
    const d = radius * rand(0.6, 1.1);
    fx.sprites.emit(
      eliteMote,
      x + Math.cos(a) * d,
      h + height * rand(0, 0.3),
      z + Math.sin(a) * d,
      0,
      rand(0.8, 1.5),
      0,
      rand(0.06, 0.1),
    );
  }
}

export function shinyMark(
  fx: Fx,
  id: number,
  x: number,
  z: number,
  radius: number,
  height: number,
): void {
  fx.decals.put(Decal.glow, x, z, radius * 1.6).tint(powder.pink, 0.55, gold.white, 1);
  const phase = (fx.time + id * 0.37) % GLINT_EVERY;
  if (phase >= fx.dt) return;
  const h = fx.ground.heightAt(x, z);
  for (let i = 0; i < GLINTS; i++)
    fx.sprites.emit(
      glint,
      x + rand(-0.7, 0.7) * radius,
      h + height * rand(0.3, 1),
      z + rand(-0.7, 0.7) * radius,
      0,
      0,
      0,
      rand(0.18, 0.3) * Math.max(1, height * 0.6),
    );
}
