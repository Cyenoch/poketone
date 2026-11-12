// Seed Bomb (lob). Mid tier. 准备 is the landing marker: a player-coloured telegraph at the burst
// radius, filling as the shell comes down (the shell knows where it will land, so the ground does
// too). 命中 is the shared `burst` area: ring at the radius, soil and seed debris, short soil mark.

import { LOB } from "../../sim/content/params/archetypes";
import { Decal } from "./decals";
import { perFrame, rand, seedOf, spray, type AreaLook, type ShotLook } from "./fx";
import { rgb } from "./gl";
import { grass, stone, white } from "./palette";
import { Shape, sprite } from "./sprites";

const soil = { light: rgb("#b48a55"), dark: rgb("#5a4026") };

const shell = sprite({ shape: Shape.ball, from: grass.leaf, accent: grass.deep });
const shellTrail = sprite({
  shape: Shape.leaf,
  life: 0.35,
  grow: 0.5,
  from: grass.lime,
  accent: grass.deep,
  gravity: 2,
  drag: 2,
  spin: 8,
});
const flash = sprite({
  shape: Shape.star,
  life: 0.16,
  grow: 1.6,
  from: grass.light,
  accent: white,
  add: 1,
  spin: 2,
});
const clod = sprite({
  shape: Shape.shard,
  life: 0.6,
  grow: 0.7,
  from: soil.light,
  accent: soil.dark,
  gravity: 16,
  drag: 0.8,
  spin: 10,
});
const seed = sprite({
  shape: Shape.ball,
  life: 0.55,
  grow: 0.6,
  from: grass.lime,
  accent: grass.deep,
  gravity: 14,
  drag: 1,
});
const dust = sprite({
  shape: Shape.puff,
  life: 0.6,
  grow: 1.8,
  from: stone.light,
  to: soil.light,
  accent: stone.dark,
  alpha: 0.7,
  gravity: -0.6,
  drag: 3,
});
const leaf = sprite({
  shape: Shape.leaf,
  life: 0.8,
  grow: 0.7,
  from: grass.leaf,
  accent: grass.deep,
  gravity: 3,
  drag: 2.5,
  spin: 9,
});

export const seedBomb: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.22);
  },
  fly(fx, shot, x, y, z) {
    // Where the arc meets the ground: one refinement of the drop height is enough at this range.
    const g = LOB.gravity;
    let floor = fx.ground.heightAt(x, z);
    let t = 0;
    for (let i = 0; i < 2; i++) {
      t = (shot.vy + Math.sqrt(Math.max(0, shot.vy ** 2 + 2 * g * (y - floor)))) / g;
      floor = fx.ground.heightAt(x + shot.vx * t, z + shot.vz * t);
    }
    const charge = Math.min(1, Math.max(0, 1 - t / LOB.flight));
    fx.decals
      .put(Decal.telegraph, x + shot.vx * t, z + shot.vz * t, shot.area, 0, seedOf(shot.id))
      .tint(grass.light, 0.85, grass.leaf, 0.4)
      .args(charge);
    fx.sprites.draw(shell, x, y, z, shot.radius, 1, 0, 0, fx.time * 6);
    for (let i = perFrame(fx, 14); i > 0; i--)
      fx.sprites.emit(shellTrail, x, y, z, rand(-0.3, 0.3), 0, rand(-0.3, 0.3), 0.07);
  },
  // No hit or fade: the burst area carries the impact.
};

export const seedBombBurst: AreaLook = {
  strike(fx, area, x, z) {
    const r = area.radius;
    const y = fx.ground.heightAt(x, z) + 0.2;
    fx.decals.stamp(Decal.ring, x, z, r, 0.3, grass.light, 0.9, grass.deep, 0.5, 0.14, 0.3);
    fx.decals.stamp(Decal.scorch, x, z, r * 0.7, 1.4, soil.dark, 0.8, grass.lime, 0);
    fx.sprites.emit(flash, x, y + 0.2, z, 0, 0, 0, r * 0.4);
    spray(fx, clod, x, y, z, 10, r * 1.8, 4, 0.1);
    spray(fx, seed, x, y, z, 8, r * 2, 3.5, 0.06);
    spray(fx, dust, x, y, z, 4, r * 0.9, 0.6, 0.25);
    spray(fx, leaf, x, y + 0.3, z, 4, r * 1.2, 1.5, 0.09);
  },
};
