import { Decal } from "./decals";
import { perFrame, rand, seedOf, spray, type AreaLook, type Fx, type ShotLook } from "./fx";
import { fire, water, white, wind } from "./palette";
import { Shape, sprite } from "./sprites";
import { CHEST } from "../../sim/content/params/combat";
import { BEAM_MOUTH, beamBody, place } from "./volumes";

const head = sprite({ shape: Shape.drop, from: water.light, accent: water.deep, stretch: 0.022 });
const sheen = sprite({
  shape: Shape.glow,
  from: water.mid,
  accent: water.foam,
  alpha: 0.45,
  add: 1,
});
const droplet = sprite({
  shape: Shape.drop,
  life: 0.45,
  grow: 0.7,
  from: water.light,
  accent: water.deep,
  gravity: 15,
  drag: 0.6,
  stretch: 0.03,
});
const mist = sprite({
  shape: Shape.cloud,
  life: 0.6,
  grow: 2,
  from: water.foam,
  to: water.light,
  accent: white,
  alpha: 0.4,
  add: 0.2,
  gravity: -0.6,
  drag: 2,
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
const bubble = sprite({ shape: Shape.bubble, from: water.light, accent: water.dark, alpha: 0.95 });
const fizz = sprite({
  shape: Shape.bubble,
  life: 0.6,
  grow: 0.6,
  from: water.light,
  accent: water.dark,
  alpha: 0.9,
  gravity: -1.4,
  drag: 1.5,
});
const gather = sprite({
  shape: Shape.drop,
  life: 0.3,
  grow: 0.6,
  from: water.light,
  accent: water.deep,
  stretch: 0.03,
});
const orb = sprite({ shape: Shape.bubble, from: water.mid, accent: water.dark });
const dust = sprite({
  shape: Shape.cloud,
  life: 0.55,
  grow: 1.8,
  from: wind.cream,
  to: wind.dust,
  accent: wind.white,
  alpha: 0.75,
  drag: 3,
  gravity: -0.5,
  spin: 1,
});
const gust = sprite({
  shape: Shape.spark,
  life: 0.22,
  grow: 0.6,
  from: wind.white,
  accent: wind.white,
  alpha: 0.85,
  add: 0.6,
  stretch: 0.05,
});

function splash(fx: Fx, x: number, y: number, z: number, size: number): void {
  fx.sprites.emit(splashRing, x, y, z, 0, 0, 0, 0.25 * size);
  fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.28 * size);
  spray(fx, droplet, x, y, z, 10 * size, 1.8, 2.5, 0.08);
  fx.decals.stamp(Decal.ripple, x, z, 0.55 * size, 0.6, water.foam, 0.8, water.light, 0.3);
}

export const waterGun: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(splashRing, x, y, z, 0, 0, 0, 0.16);
    spray(fx, droplet, x, y, z, 3, 0.8, 1.3, 0.06);
  },
  fly(fx, shot, x, y, z) {
    fx.sprites.draw(sheen, x, y, z, shot.radius * 1.8);
    fx.sprites.draw(head, x, y, z, shot.radius, 1, shot.vx, shot.vz);
    const floor = fx.ground.heightAt(x, z);
    for (let i = perFrame(fx, 45); i > 0; i--) {
      fx.sprites.emit(
        droplet,
        x + rand(-0.06, 0.06),
        y,
        z + rand(-0.06, 0.06),
        -shot.vx * 0.04 + rand(-0.5, 0.5),
        rand(0.3, 1),
        -shot.vz * 0.04 + rand(-0.5, 0.5),
        rand(0.05, 0.08),
        floor,
      );
    }
    for (let i = perFrame(fx, 10); i > 0; i--) fx.sprites.emit(mist, x, y, z, 0, 0.15, 0, 0.1);
  },
  hit(fx, x, y, z) {
    splash(fx, x, y, z, 1);
  },
  fade(fx, x, y, z) {
    splash(fx, x, y, z, 0.6);
  },
};

function pop(fx: Fx, x: number, y: number, z: number): void {
  fx.sprites.emit(splashRing, x, y, z, 0, 0, 0, 0.25);
  spray(fx, droplet, x, y, z, 6, 1.3, 1.5, 0.06);
  spray(fx, fizz, x, y, z, 3, 0.5, 0.5, 0.06);
  fx.decals.stamp(Decal.ripple, x, z, 0.4, 0.5, water.foam, 0.7, water.light, 0.3);
}

export const bubbleShot: ShotLook = {
  fly(fx, shot, x, y, z) {
    const bob = Math.sin(fx.time * 5 + shot.id) * 0.06;
    fx.sprites.draw(bubble, x, y + bob, z, shot.radius * 0.95, 1, 0, 0, 0, seedOf(shot.id));
    for (let i = perFrame(fx, 5); i > 0; i--)
      fx.sprites.emit(
        fizz,
        x,
        y + bob,
        z,
        rand(-0.15, 0.15),
        0.3,
        rand(-0.15, 0.15),
        rand(0.03, 0.05),
      );
  },
  hit: pop,
  fade: pop,
};

export const rapidSpin: AreaLook = {
  live(fx, area, x, z) {
    const r = area.radius;
    // Particle size and speed follow the radius (1 at the old 2.1 m spin).
    const scale = r / 2.1;
    const elapsed = area.maxLife - area.life;
    const fade = Math.min(1, area.life / 0.25) * Math.min(1, elapsed / 0.1);
    fx.volumes.whirls.add(
      place(x, 0.05, z, 0, r * 0.92, 0.4, r * 0.92),
      wind.white,
      fade * 0.8,
      wind.cyan,
      0,
    );
    fx.volumes.whirls.add(
      place(x, 0.05, z, Math.PI / 3, r * 0.55, 0.3, r * 0.55),
      wind.white,
      fade * 0.45,
      wind.cyan,
      0,
    );
    fx.decals
      .put(Decal.whirl, x, z, r * 1.05, 0, seedOf(area.id))
      .tint(wind.white, 0.55 * fade, wind.dust, 0.4);
    const h = fx.ground.heightAt(x, z);
    for (let i = perFrame(fx, 12 * fade); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      fx.sprites.emit(
        dust,
        x + c * r * 0.95,
        h + 0.1,
        z + s * r * 0.95,
        (-s * 5 + c * 1.5) * scale,
        rand(0.15, 0.5),
        (c * 5 + s * 1.5) * scale,
        rand(0.25, 0.4) * scale,
        h,
      );
    }
    for (let i = perFrame(fx, 20 * fade); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      const d = r * rand(0.6, 1);
      const c = Math.cos(a);
      const s = Math.sin(a);
      fx.sprites.emit(
        gust,
        x + c * d,
        h + rand(0.15, 0.6),
        z + s * d,
        -s * 9 * scale,
        0,
        c * 9 * scale,
        rand(0.1, 0.16) * scale,
      );
    }
    for (let i = perFrame(fx, 6 * fade); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      fx.sprites.emit(
        droplet,
        x + c * r * 0.5,
        h + 0.4,
        z + s * r * 0.5,
        (-s * 6 + c * 2) * scale,
        rand(1, 2),
        (c * 6 + s * 2) * scale,
        0.06,
        h,
      );
    }
  },
};

export const hydroPump: AreaLook = {
  live(fx, area, x, z, charge) {
    const yaw = Math.atan2(area.dirX, area.dirZ);
    const mouthX = x + area.dirX * BEAM_MOUTH;
    const mouthZ = z + area.dirZ * BEAM_MOUTH;
    const y = fx.ground.heightAt(x, z) + CHEST + area.rise * BEAM_MOUTH;
    const r = area.radius;
    if (area.delay > 0) {
      fx.decals
        .put(Decal.strip, x, z, area.length, yaw)
        .rect(-0.15, 0, 0.15, area.length)
        .tint(water.deep, 0.8 * charge, white, 0)
        .args(0, 0.15, 2);
      fx.sprites.draw(orb, mouthX, y, mouthZ, 0.1 + charge * 0.22, 1, 0, 0, 0, 0.5);
      for (let i = perFrame(fx, 60); i > 0; i--) {
        const a = Math.random() * Math.PI * 2;
        const d = rand(0.7, 1);
        const ox = Math.cos(a) * d;
        const oz = Math.sin(a) * d;
        const oy = rand(-0.2, 0.4);
        // Spiral inward: mostly radial with a tangential swirl.
        fx.sprites.emit(
          gather,
          mouthX + ox,
          y + oy,
          mouthZ + oz,
          (-ox - oz * 0.8) / 0.3,
          -oy / 0.3,
          (-oz + ox * 0.8) / 0.3,
          rand(0.04, 0.07),
        );
      }
      return;
    }
    const k = Math.min(1, area.life / 0.15);
    fx.volumes.beams.add(
      beamBody(area, mouthX, y, mouthZ, yaw, r * 0.72 * k),
      water.light,
      k,
      water.deep,
      2,
    );
    fx.volumes.beams.add(
      beamBody(area, mouthX, y, mouthZ, yaw, r * 1.05 * k),
      water.foam,
      k,
      water.light,
      3,
    );
    fx.decals
      .put(Decal.strip, x, z, area.length, yaw)
      .rect(-r * 1.15, 0, r * 1.15, area.length)
      .tint(water.dark, 0.75 * k, water.foam, 0)
      .args(0, r, 1);
    for (let i = perFrame(fx, 8 * k); i > 0; i--)
      fx.sprites.emit(splashRing, mouthX, y, mouthZ, 0, 0, 0, 0.2);
    const floor = fx.ground.heightAt(x, z);
    for (let i = perFrame(fx, 45 * k); i > 0; i--) {
      const d = rand(0.6, area.length * 0.75);
      const side = Math.random() < 0.5 ? -1 : 1;
      const px = mouthX + area.dirX * d + area.dirZ * r * 0.6 * side;
      const pz = mouthZ + area.dirZ * d - area.dirX * r * 0.6 * side;
      const out = rand(1, 2.5) * side;
      fx.sprites.emit(
        droplet,
        px,
        y + area.rise * d,
        pz,
        area.dirZ * out + area.dirX * 1.5,
        rand(1, 2.5),
        -area.dirX * out + area.dirZ * 1.5,
        rand(0.05, 0.09),
        floor - 1,
      );
    }
    for (let i = perFrame(fx, 10 * k); i > 0; i--) {
      const d = rand(0.5, area.length * 0.7);
      const px = mouthX + area.dirX * d;
      const pz = mouthZ + area.dirZ * d;
      fx.sprites.emit(
        mist,
        px,
        y + area.rise * d,
        pz,
        rand(-0.5, 0.5),
        0.3,
        rand(-0.5, 0.5),
        rand(0.12, 0.18),
      );
    }
  },
  strike(fx, area, x, z) {
    splash(fx, x + area.dirX * 0.6, fx.ground.heightAt(x, z) + CHEST, z + area.dirZ * 0.6, 1);
  },
};

const steam = sprite({
  shape: Shape.cloud,
  life: 1.2,
  grow: 2.3,
  from: white,
  to: wind.cream,
  accent: water.foam,
  alpha: 0.8,
  add: 0.1,
  gravity: -2.4,
  drag: 2.2,
});

const steamColumn = sprite({
  shape: Shape.cloud,
  life: 0.7,
  grow: 2.2,
  from: white,
  to: wind.cream,
  accent: water.foam,
  alpha: 0.6,
  add: 0.1,
  gravity: -3,
  drag: 2.4,
});
/** The flames going out: a hot flash that cools to white inside the steam. */
const doused = sprite({
  shape: Shape.glow,
  life: 0.25,
  grow: 1.5,
  from: fire.orange,
  to: white,
  accent: fire.core,
  alpha: 0.8,
  add: 0.8,
});
/** combat.ts splashes the stored burn over this radius. */
const STEAM_SPLASH = 2.8;

/**
 * 蒸汽: doused flames go out in a hot flash and burst into a white column of steam, with a low cloud
 * rolling out toward the splash ring.
 */
export function steamBurst(fx: Fx, x: number, y: number, z: number): void {
  fx.decals.stamp(
    Decal.ring,
    x,
    z,
    STEAM_SPLASH,
    0.35,
    water.foam,
    0.65,
    water.light,
    0.4,
    0.12,
    0.3,
  );
  fx.sprites.emit(doused, x, y, z, 0, 0, 0, 0.7);
  for (let i = 0; i < 4; i++) {
    fx.sprites.emit(
      steamColumn,
      x + rand(-0.2, 0.2),
      y + i * 0.12,
      z + rand(-0.2, 0.2),
      rand(-0.3, 0.3),
      rand(3, 5),
      rand(-0.3, 0.3),
      0.26,
    );
  }
  spray(fx, steam, x, y - 0.4, z, 5, 3.4, 0.5, 0.4);
  fx.sprites.emit(splashRing, x, y, z, 0, 0, 0, 0.8);
}
