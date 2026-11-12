// Water moves added with the wave archetype: Surf (a band rolling out along the ground) and
// Whirlpool (a water vortex on the fire-spin rules). Mid tier. Surf's footprint is its hit band:
// 2 × radius wide, 2 × WAVE.depth deep; its crest stays under 1 m so enemies stay readable.

import { WAVE } from "../../sim/content/params/archetypes";
import { Decal } from "./decals";
import { perFrame, rand, seedOf, spray, type AreaLook, type ShotLook } from "./fx";
import { water, white } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";
import { place } from "./volumes";

const droplet = sprite({
  shape: Shape.drop,
  life: 0.45,
  grow: 0.7,
  from: water.light,
  accent: water.deep,
  gravity: 14,
  drag: 0.8,
  stretch: 0.03,
});
const foam = sprite({
  shape: Shape.cloud,
  life: 0.4,
  grow: 1.6,
  from: water.foam,
  to: water.light,
  accent: white,
  alpha: 0.7,
  add: 0.2,
  gravity: -0.5,
  drag: 2.5,
});
const splashRing = sprite({
  shape: Shape.ring,
  life: 0.24,
  grow: 2.4,
  from: water.foam,
  accent: water.light,
  add: 0.6,
});
const flash = sprite({
  shape: Shape.star,
  life: 0.14,
  grow: 1.5,
  from: water.light,
  accent: white,
  add: 1,
  spin: 2,
});

/** Crest samples across the band. */
const LANES = 9;
/** Body then foam lip: ribbon width, lift over the body, colour, alpha, style. */
const CREST = [
  [0.42, 0, water.mid, 0.85, Ribbon.solid],
  [0.16, 0.2, water.foam, 0.9, Ribbon.streak],
] as const;

export const surf: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(splashRing, x, fx.ground.heightAt(x, z) + 0.1, z, 0, 0, 0, 0.35);
    spray(fx, droplet, x, y, z, 6, 1.5, 2, 0.07);
  },
  fly(fx, shot, x, _y, z) {
    const r = shot.radius;
    const speed = Math.hypot(shot.vx, shot.vz) || 1;
    const dirX = shot.vx / speed;
    const dirZ = shot.vz / speed;
    const yaw = Math.atan2(dirX, dirZ);
    const d = WAVE.depth;
    // Rises over 0.1 s, collapses over the last 0.15 s.
    const grow = Math.min(1, (shot.dur - shot.life) / 0.1, shot.life / 0.15);
    fx.decals
      .put(Decal.strip, x - dirX * d, z - dirZ * d, 2 * d, yaw, seedOf(shot.id))
      .rect(-r * 1.05, 0, r * 1.05, 2 * d)
      .tint(water.mid, 0.9 * grow, water.foam, 0)
      .args(0, r, 1);
    const crest = WAVE.crest * 1.4 * grow;
    for (let layer = 0; layer < CREST.length; layer++) {
      const crestLayer = CREST[layer]!;
      const width = crestLayer[0];
      const lift = crestLayer[1];
      const colour = crestLayer[2];
      const alpha = crestLayer[3];
      const style = crestLayer[4];
      for (let i = 0; i < LANES; i++) {
        const side = (i / (LANES - 1)) * 2 - 1;
        const cx = x - dirZ * side * r;
        const cz = z + dirX * side * r;
        const taper = 1 - side ** 4 * 0.6;
        const h = fx.ground.heightAt(cx, cz) + (crest * 0.6 + lift) * taper;
        fx.ribbons.point(cx, h, cz, width * taper * grow, colour, alpha * grow);
      }
      fx.ribbons.flush(style, 0);
    }
    for (let i = perFrame(fx, 40 * grow); i > 0; i--) {
      const side = rand(-1, 1);
      const cx = x - dirZ * side * r;
      const cz = z + dirX * side * r;
      const floor = fx.ground.heightAt(cx, cz);
      fx.sprites.emit(
        droplet,
        cx,
        floor + crest,
        cz,
        dirX * speed * 0.6 + rand(-0.5, 0.5),
        rand(1, 2.5),
        dirZ * speed * 0.6 + rand(-0.5, 0.5),
        rand(0.05, 0.08),
        floor,
      );
    }
    for (let i = perFrame(fx, 14 * grow); i > 0; i--) {
      const side = rand(-1, 1);
      const cx = x - dirZ * side * r;
      const cz = z + dirX * side * r;
      fx.sprites.emit(foam, cx, fx.ground.heightAt(cx, cz) + crest, cz, 0, 0.3, 0, 0.14);
    }
  },
  hit(fx, x, y, z) {
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.25);
    spray(fx, droplet, x, y, z, 4, 1.5, 2, 0.06);
  },
  fade(fx, x, _y, z) {
    fx.decals.stamp(Decal.ripple, x, z, 1, 0.6, water.foam, 0.7, water.light, 0.3);
    spray(fx, droplet, x, fx.ground.heightAt(x, z) + 0.3, z, 8, 2, 2.5, 0.07);
    spray(fx, foam, x, fx.ground.heightAt(x, z) + 0.2, z, 4, 1, 0.5, 0.18);
  },
};

export const whirlpool: AreaLook = {
  live(fx, area, x, z, charge) {
    const r = area.radius;
    const h = fx.ground.heightAt(x, z);
    const fade = Math.min(1, area.life / 0.2);
    const active = area.delay <= 0;
    const intensity = (active ? 1 : charge * 0.6) * fade;
    const seed = seedOf(area.id);
    fx.decals.put(Decal.glow, x, z, r).tint(water.dark, 0.45 * intensity, water.deep, 0);
    fx.decals
      .put(Decal.whirl, x, z, r * 1.02, 0, seed)
      .tint(water.foam, 0.8 * intensity, water.mid, 0.2);
    if (active)
      fx.volumes.whirls.add(
        place(x, 0.05, z, -fx.time * 3, r * 0.85, 0.3, r * 0.85),
        water.light,
        fade * 0.55,
        water.deep,
        0,
      );
    // Water drawn round and in from the rim (the pull).
    for (let i = perFrame(fx, 22 * intensity); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      fx.sprites.emit(
        droplet,
        x + c * r * 0.95,
        h + rand(0.05, 0.3),
        z + s * r * 0.95,
        (-s * 3 - c * 1.2) * r,
        rand(0.6, 1.4),
        (c * 3 - s * 1.2) * r,
        rand(0.05, 0.07),
        h,
      );
    }
  },
};

/** Whirlpool's collapse: the water heaves up and falls back over the radius. */
export const whirlpoolBurst: AreaLook = {
  strike(fx, area, x, z) {
    const r = area.radius;
    const y = fx.ground.heightAt(x, z) + 0.3;
    fx.decals.stamp(Decal.ring, x, z, r, 0.3, water.foam, 0.9, water.mid, 0.5, 0.14, 0.3);
    fx.decals.stamp(Decal.ripple, x, z, r, 0.8, water.foam, 0.7, water.light, 0.3);
    fx.sprites.emit(splashRing, x, y, z, 0, 0, 0, r * 0.5);
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, r * 0.3);
    spray(fx, droplet, x, y, z, 16, r * 2, 4, 0.08);
    spray(fx, foam, x, y, z, 5, r, 0.8, 0.2);
  },
};
