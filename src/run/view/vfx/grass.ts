import { Decal } from "./decals";
import {
  perFrame,
  rand,
  reach,
  seedOf,
  spray,
  type AreaLook,
  type Echo,
  type Fx,
  type ShotLook,
} from "./fx";
import { grass, powder, white } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";
import { CHEST } from "../../sim/content/params/combat";
import { BEAM_MOUTH, beamBody } from "./volumes";

const leaf = sprite({ shape: Shape.leaf, from: grass.leaf, accent: grass.deep });
const leafStreak = sprite({
  shape: Shape.spark,
  from: grass.light,
  accent: white,
  alpha: 0.55,
  add: 1,
  stretch: 0.045,
});
const shred = sprite({
  shape: Shape.leaf,
  life: 0.6,
  grow: 0.6,
  from: grass.leaf,
  accent: grass.deep,
  gravity: 6,
  drag: 2,
  spin: 12,
});
const falling = sprite({
  shape: Shape.leaf,
  life: 1.1,
  grow: 0.8,
  from: grass.leaf,
  accent: grass.deep,
  gravity: 1.6,
  drag: 3,
  spin: 6,
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
const tipFlash = sprite({ shape: Shape.star, from: grass.light, accent: white, add: 1 });
const powderCloud = sprite({
  shape: Shape.cloud,
  life: 1.1,
  grow: 1.9,
  from: powder.lilac,
  to: powder.pink,
  accent: powder.mist,
  alpha: 0.45,
  add: 0.15,
  gravity: -0.4,
  drag: 1,
});
const twinkle = sprite({
  shape: Shape.star,
  life: 0.6,
  grow: 0.4,
  from: powder.pink,
  to: powder.lilac,
  accent: white,
  add: 1,
  gravity: -0.6,
  drag: 1,
  spin: 3,
});
const mote = sprite({
  shape: Shape.glow,
  life: 0.3,
  grow: 0.5,
  from: grass.gold,
  to: grass.sun,
  accent: white,
  add: 1,
});
const sunGlow = sprite({ shape: Shape.glow, from: grass.gold, accent: white, add: 1 });
const sunStar = sprite({ shape: Shape.star, from: grass.sun, accent: white, add: 1 });
const sparkle = sprite({
  shape: Shape.star,
  life: 0.55,
  grow: 0.3,
  from: grass.sun,
  to: grass.lime,
  accent: white,
  add: 1,
  gravity: -1.5,
  drag: 1.5,
  spin: 4,
});

export const razorLeaf: ShotLook = {
  fly(fx, shot, x, y, z) {
    fx.sprites.draw(leafStreak, x, y, z, shot.radius * 0.7, 1, shot.vx, shot.vz);
    fx.sprites.draw(
      leaf,
      x,
      y,
      z,
      shot.radius * 1.5,
      1,
      0,
      0,
      fx.time * 22 + shot.id,
      seedOf(shot.id),
    );
  },
  hit(fx, x, y, z) {
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.3);
    spray(fx, shred, x, y, z, 4, 1.5, 1.5, 0.1);
  },
  fade(fx, x, y, z) {
    fx.sprites.emit(
      falling,
      x,
      y,
      z,
      rand(-0.3, 0.3),
      0.3,
      rand(-0.3, 0.3),
      0.2,
      fx.ground.heightAt(x, z) + 0.05,
    );
  },
};

/** One lash: a vine whips across the fan and a pale smear trails its tip. a = yaw, b = reach, c = signed half-angle. */
function drawLash(fx: Fx, echo: Echo, t: number): void {
  const { x, z } = echo;
  const sweep = 1 - (1 - Math.min(1, t / 0.6)) ** 3;
  const half = Math.abs(echo.c) * 0.95;
  const turn = Math.sign(echo.c);
  const tipAngle = turn * (-half + 2 * half * sweep);
  const length = echo.b * (1 - 0.75 * Math.max(0, (t - 0.65) / 0.35) ** 2);
  const alpha = 1 - Math.max(0, (t - 0.8) / 0.2);
  const lag = 0.9 * (1 - sweep);
  const segments = 14;
  for (let k = 0; k < segments; k++) {
    const f = k / (segments - 1);
    const r = 0.3 + (length - 0.3) * f;
    const angle = echo.a + tipAngle - turn * lag * f * f;
    const px = x + Math.sin(angle) * r;
    const pz = z + Math.cos(angle) * r;
    fx.ribbons.point(
      px,
      fx.ground.heightAt(px, pz) + 0.4 + Math.sin(f * Math.PI) * 0.2,
      pz,
      0.18 - 0.11 * f,
      grass.leaf,
      alpha,
    );
  }
  fx.ribbons.flush(Ribbon.vine, 0);
  if (sweep < 0.98) {
    const steps = 16;
    const from = turn * -half;
    for (let k = 0; k < steps; k++) {
      const f = k / (steps - 1);
      const angle = echo.a + from + (tipAngle - from) * f;
      const r = length * 0.9;
      const px = x + Math.sin(angle) * r;
      const pz = z + Math.cos(angle) * r;
      fx.ribbons.point(
        px,
        fx.ground.heightAt(px, pz) + 0.45,
        pz,
        0.03 + 0.4 * f,
        grass.light,
        (1 - sweep) * 0.8 + 0.4,
      );
    }
    fx.ribbons.flush(Ribbon.streak, 0.5);
    const tipX = x + Math.sin(echo.a + tipAngle) * length;
    const tipZ = z + Math.cos(echo.a + tipAngle) * length;
    const tipY = fx.ground.heightAt(tipX, tipZ) + 0.45;
    fx.sprites.draw(tipFlash, tipX, tipY, tipZ, 0.3, 1 - sweep, 0, 0, fx.time * 9);
    for (let i = perFrame(fx, 50); i > 0; i--) {
      fx.sprites.emit(
        shred,
        tipX,
        tipY,
        tipZ,
        rand(-1, 1),
        rand(0.5, 1.5),
        rand(-1, 1),
        0.08,
        tipY - 0.45,
      );
    }
  }
}

export const vineWhip: AreaLook = {
  strike(fx, area, x, z) {
    const turn = area.id % 2 === 0 ? 1 : -1;
    fx.echoes.add(
      drawLash,
      0.34,
      x,
      0,
      z,
      Math.atan2(area.dirX, area.dirZ),
      area.length,
      turn * area.angle,
    );
  },
};

export const sleepPowder: AreaLook = {
  live(fx, area, x, z) {
    const length = area.length;
    const fade = Math.min(1, area.life / 0.35);
    const yaw = Math.atan2(area.dirX, area.dirZ);
    const side = length * Math.sin(Math.min(area.angle, Math.PI / 2)) + 0.3;
    fx.decals
      .put(Decal.sector, x, z, length, yaw, seedOf(area.id))
      .rect(-side, -0.3, side, length + 0.3)
      .tint(powder.lilac, 0.42 * fade, powder.pink, 0)
      .args(0, area.angle, 1);
    const h = fx.ground.heightAt(x, z);
    const scale = length / 5;
    const speed = reach(length * 0.85, powderCloud.life, powderCloud.drag);
    for (let i = perFrame(fx, 30 * fade); i > 0; i--) {
      const spread = rand(-1, 1) * area.angle * 0.85;
      const dx = Math.sin(yaw + spread);
      const dz = Math.cos(yaw + spread);
      const v = speed * rand(0.35, 1.05);
      fx.sprites.emit(
        powderCloud,
        x + dx * 0.4,
        h + rand(0.25, 0.55),
        z + dz * 0.4,
        dx * v,
        rand(0, 0.2),
        dz * v,
        rand(0.3, 0.45) * scale,
      );
    }
    for (let i = perFrame(fx, 26 * fade); i > 0; i--) {
      const spread = rand(-1, 1) * area.angle;
      const d = length * Math.sqrt(Math.random());
      const px = x + Math.sin(yaw + spread) * d;
      const pz = z + Math.cos(yaw + spread) * d;
      fx.sprites.emit(
        twinkle,
        px,
        fx.ground.heightAt(px, pz) + rand(0.15, 0.8),
        pz,
        0,
        0.2,
        0,
        rand(0.06, 0.11),
      );
    }
  },
};

export const solarBeam: AreaLook = {
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
        .tint(grass.gold, 0.7 * charge, white, 1)
        .args(0, 0.15, 2);
      fx.sprites.draw(sunGlow, mouthX, y, mouthZ, 0.15 + charge * 0.25, 0.9);
      fx.sprites.draw(sunStar, mouthX, y, mouthZ, charge * 0.35, 1, 0, 0, fx.time * 3);
      for (let i = perFrame(fx, 70); i > 0; i--) {
        const a = Math.random() * Math.PI * 2;
        const e = rand(-0.6, 0.9);
        const d = 1.1;
        const ox = Math.cos(a) * Math.cos(e) * d;
        const oy = Math.sin(e) * d;
        const oz = Math.sin(a) * Math.cos(e) * d;
        fx.sprites.emit(
          mote,
          mouthX + ox,
          y + oy,
          mouthZ + oz,
          -ox / 0.3,
          -oy / 0.3,
          -oz / 0.3,
          rand(0.06, 0.11),
        );
      }
      return;
    }
    const elapsed = area.maxLife - area.life;
    const k = Math.min(1, area.life / 0.15);
    const wobble = 1 + 0.08 * Math.sin(fx.time * 45);
    fx.volumes.beams.add(
      beamBody(area, mouthX, y, mouthZ, yaw, r * 0.42 * k * wobble),
      grass.sun,
      k,
      white,
      0,
    );
    fx.volumes.beams.add(
      beamBody(area, mouthX, y, mouthZ, yaw, r * 1.05 * k),
      grass.gold,
      k,
      grass.lime,
      1,
    );
    fx.decals
      .put(Decal.strip, x, z, area.length, yaw)
      .rect(-r * 1.15, 0, r * 1.15, area.length)
      .tint(grass.gold, 0.8 * k, white, 1)
      .args(0, r, 0);
    // The mouth glow stays smaller than the caster so it never buries them.
    fx.sprites.draw(sunGlow, mouthX, y, mouthZ, 0.4 * k, 0.9);
    fx.sprites.draw(
      sunStar,
      mouthX,
      y,
      mouthZ,
      (0.45 + 0.08 * Math.sin(elapsed * 30)) * k,
      1,
      0,
      0,
      fx.time * 2,
    );
    for (let i = perFrame(fx, 35 * k); i > 0; i--) {
      const d = rand(0.5, area.length * 0.8);
      const off = rand(-1, 1) * r;
      const px = mouthX + area.dirX * d + area.dirZ * off;
      const pz = mouthZ + area.dirZ * d - area.dirX * off;
      fx.sprites.emit(
        sparkle,
        px,
        y + area.rise * d + rand(-0.2, 0.2),
        pz,
        area.dirZ * off * 1.5,
        rand(0.3, 1),
        -area.dirX * off * 1.5,
        rand(0.06, 0.12),
      );
    }
  },
  strike(fx, area, x, z) {
    const y = fx.ground.heightAt(x, z) + CHEST;
    fx.sprites.emit(flash, x + area.dirX * 0.6, y, z + area.dirZ * 0.6, 0, 0, 0, 0.4);
    fx.decals.stamp(Decal.ring, x, z, 0.55, 0.3, grass.gold, 0.8, white, 0.8, 0.2, 0.3);
  },
};
