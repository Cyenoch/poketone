import { Decal } from "./decals";
import {
  perFrame,
  rand,
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
  launch(fx, x, y, z) {
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.18);
    spray(fx, shred, x, y, z, 2, 1, 0.6, 0.07);
  },
  fly(fx, shot, x, y, z) {
    fx.sprites.draw(leafStreak, x, y, z, shot.radius * 1.1, 1, shot.vx, shot.vz);
    // A few cut leaf scraps shed behind each blade, so a volley leaves visible paths through a crowd.
    for (let i = perFrame(fx, 9); i > 0; i--)
      fx.sprites.emit(
        shred,
        x,
        y,
        z,
        -shot.vx * 0.06 + rand(-0.4, 0.4),
        rand(0.2, 0.8),
        -shot.vz * 0.06 + rand(-0.4, 0.4),
        rand(0.05, 0.08),
      );
    fx.sprites.draw(
      leaf,
      x,
      y,
      z,
      shot.radius * 1.8,
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
  const sweep = 1 - (1 - Math.min(1, t / 0.35)) ** 3;
  const half = Math.abs(echo.c) * 0.95;
  const turn = Math.sign(echo.c);
  const tipAngle = turn * (-half + 2 * half * sweep);
  const length = echo.b * 0.95 * (1 - 0.75 * Math.max(0, (t - 0.65) / 0.35) ** 2);
  const alpha = 1 - Math.max(0, (t - 0.8) / 0.2);
  const lag = 0.9 * (1 - sweep);
  const segments = 8;
  for (let vine = 0; vine < 2; vine++) {
    for (let k = 0; k < segments; k++) {
      const f = k / (segments - 1);
      const r = 0.25 + (length * (1 - vine * 0.12) - 0.25) * f;
      const angle =
        echo.a + Math.max(-half, Math.min(half, tipAngle - turn * (lag * f * f + vine * 0.18)));
      const px = x + Math.sin(angle) * r;
      const pz = z + Math.cos(angle) * r;
      fx.ribbons.point(
        px,
        fx.ground.heightAt(px, pz) + 0.4 + Math.sin(f * Math.PI) * 0.2,
        pz,
        0.12 - 0.07 * f,
        grass.leaf,
        alpha,
      );
    }
    fx.ribbons.flush(Ribbon.vine, 0);
  }
  if (t < 0.45) {
    const steps = 10;
    const impact = (1 - t / 0.45) ** 2;
    for (let k = 0; k < steps; k++) {
      const f = k / (steps - 1);
      const angle = echo.a - half + 2 * half * f;
      const r = echo.b * 0.94;
      const px = x + Math.sin(angle) * r;
      const pz = z + Math.cos(angle) * r;
      fx.ribbons.point(
        px,
        fx.ground.heightAt(px, pz) + 0.45,
        pz,
        Math.min(0.1, echo.b * 0.05) * (0.5 + 0.5 * Math.sin(f * Math.PI)),
        grass.light,
        impact * 0.85,
      );
    }
    fx.ribbons.flush(Ribbon.streak, 0.5);
    const tipX = x + Math.sin(echo.a + tipAngle) * length;
    const tipZ = z + Math.cos(echo.a + tipAngle) * length;
    const tipY = fx.ground.heightAt(tipX, tipZ) + 0.45;
    fx.sprites.draw(tipFlash, tipX, tipY, tipZ, 0.16, 1 - sweep, 0, 0, fx.time * 9);
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
      area.life,
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
  strike(fx, area, x, z) {
    spray(
      fx,
      twinkle,
      x + area.dirX * 0.35,
      fx.ground.heightAt(x, z) + 0.65,
      z + area.dirZ * 0.35,
      3,
      0.35,
      0.2,
      0.06,
    );
  },
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
    // Slow motes drift within the current cone and erode with it, leaving the sleeping bodies clear.
    for (let i = 0; i < 12; i++) {
      const seed = seedOf(area.id + i * 13);
      const travel = (fx.time * 0.65 + seed) % 1;
      const angle = yaw + (seed * 2 - 1) * area.angle * 0.65;
      const d = length * (0.15 + travel * 0.68);
      const size = length * (0.06 + travel * 0.055) * fade;
      const px = x + Math.sin(angle) * d;
      const pz = z + Math.cos(angle) * d;
      fx.sprites.draw(
        powderCloud,
        px,
        h + 0.35 + travel * 0.2,
        pz,
        size,
        Math.sin(travel * Math.PI) * fade,
        0,
        0,
        0,
        seed,
        travel,
      );
    }
    for (let i = perFrame(fx, 14 * fade); i > 0; i--) {
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
