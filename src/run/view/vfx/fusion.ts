// Signature fusion looks (sim/archetypes/bloom, firestorm, sprinkler, rod). Each recipe builds on the parent moves' looks so a fusion
// reads as "both moves at once", then adds the beat only the fusion has. Shapes follow the sim parts:
// beam lane and leaves, the growing vortex and its feeding jet, the sprinkler jets, the hovering ball.

import { FIRESTORM, ROD, SPRINKLER } from "../../sim/content/params/archetypes";

import { CHEST } from "../../sim/content/params/combat";
import type { Area } from "../../sim/state/entities";
import { Decal } from "./decals";
import { electroBurst } from "./electric";
import { fireSpin, fireSpinBurst } from "./fire";
import {
  flicker,
  perFrame,
  rand,
  seedOf,
  skyTop,
  spray,
  type AreaLook,
  type Echo,
  type Fx,
} from "./fx";
import { solarBeam } from "./grass";
import { electric, fire, grass, powder, water, white } from "./palette";
import { Shape, sprite } from "./sprites";
import { place } from "./volumes";
import { whirlpoolBurst } from "./wave";

const blade = sprite({
  shape: Shape.leaf,
  life: 0.35,
  grow: 0.7,
  from: grass.leaf,
  accent: grass.deep,
  drag: 1.5,
  spin: 14,
});
const petal = sprite({
  shape: Shape.leaf,
  life: 0.9,
  grow: 0.8,
  from: powder.pink,
  to: white,
  accent: grass.deep,
  gravity: 2,
  drag: 2.2,
  spin: 9,
});
const bloomFlash = sprite({
  shape: Shape.star,
  life: 0.22,
  grow: 1.8,
  from: powder.pink,
  accent: white,
  add: 1,
  spin: 2,
});
const flame = sprite({
  shape: Shape.flame,
  life: 0.35,
  grow: 0.5,
  from: fire.yellow,
  to: fire.red,
  accent: fire.core,
  add: 0.5,
  gravity: -3,
  drag: 2,
});
const droplet = sprite({
  shape: Shape.drop,
  life: 0.45,
  grow: 0.6,
  from: water.light,
  accent: water.deep,
  gravity: 9,
  drag: 1,
  stretch: 0.03,
});
const halo = sprite({
  shape: Shape.glow,
  from: electric.gold,
  accent: electric.yellow,
  alpha: 0.5,
  add: 1,
});
const spark = sprite({
  shape: Shape.spark,
  life: 0.3,
  grow: 0.4,
  from: electric.yellow,
  to: electric.gold,
  accent: white,
  add: 1,
  gravity: 6,
  drag: 2.5,
  stretch: 0.04,
});
const strikeFlash = sprite({
  shape: Shape.star,
  life: 0.18,
  grow: 1.6,
  from: electric.yellow,
  accent: white,
  add: 1,
});

const elapsedOf = (area: Area) => area.maxLife - area.life;

/** 花朵光束: the solar beam with leaf blades peeling off both edges (the leaf projectiles draw themselves). */
export const floralBeam: AreaLook = {
  live(fx, area, x, z, charge) {
    solarBeam.live!(fx, area, x, z, charge);
    if (area.delay > 0) return;
    const y = fx.ground.heightAt(x, z) + CHEST;
    const k = Math.min(1, area.life / 0.15);
    for (let i = perFrame(fx, 40 * k); i > 0; i--) {
      const d = rand(0.8, area.length);
      const side = Math.random() < 0.5 ? -1 : 1;
      const edge = area.radius * 1.1 * side;
      const px = x + area.dirX * d + area.dirZ * edge;
      const pz = z + area.dirZ * d - area.dirX * edge;
      fx.sprites.emit(
        blade,
        px,
        y + area.rise * d,
        pz,
        area.dirZ * side * 3,
        rand(0, 0.6),
        -area.dirX * side * 3,
        rand(0.1, 0.16),
      );
    }
  },
  strike(fx, area, x, z) {
    solarBeam.strike!(fx, area, x, z);
  },
};

/** The petal burst where the beam ended: pink flash, a ring at the hitbox, petals that settle. */
export const floralBloom: AreaLook = {
  strike(fx, area, x, z) {
    const r = area.radius;
    const y = fx.ground.heightAt(x, z) + 0.5;
    fx.sprites.emit(bloomFlash, x, y, z, 0, 0, 0, r * 0.45);
    fx.decals.stamp(Decal.ring, x, z, r, 0.35, powder.pink, 0.9, white, 0.6, 0.14, 0.3);
    fx.decals.stamp(Decal.glow, x, z, r * 0.7, 0.5, powder.pink, 0.35, grass.sun, 0.5);
    spray(fx, petal, x, y, z, 22, r * 2.2, 2.5, 0.16);
  },
};

/**
 * 烈焰旋风: a flame jet from the cast point feeds the vortex (fire spin's look at the sim's growing
 * radius); after the jet, three spiral arms throw flames past the rim.
 */
export const fireWhirl: AreaLook = {
  live(fx, area, x, z, charge) {
    const f = FIRESTORM;
    const elapsed = elapsedOf(area);
    const h = fx.ground.heightAt(x, z);
    if (elapsed < f.jetFor) {
      const fromX = x - area.dirX * area.length;
      const fromZ = z - area.dirZ * area.length;
      const y = fx.ground.heightAt(fromX, fromZ) + CHEST;
      const half = f.jetWidth * area.scale;
      const speed = area.length / flame.life;
      for (let i = perFrame(fx, 70); i > 0; i--) {
        const off = rand(-half, half) * 0.6;
        fx.sprites.emit(
          flame,
          fromX + area.dirZ * off,
          y,
          fromZ - area.dirX * off,
          area.dirX * speed * rand(0.8, 1.1),
          (h + 0.3 - y) / flame.life,
          area.dirZ * speed * rand(0.8, 1.1),
          rand(0.2, 0.32),
        );
      }
      fx.decals
        .put(Decal.strip, fromX, fromZ, area.length, Math.atan2(area.dirX, area.dirZ))
        .rect(-half, 0, half, area.length)
        .tint(fire.orange, 0.45, fire.yellow, 0.8)
        .args(0, half, 0);
    }
    fireSpin.live!(fx, area, x, z, charge);
    if (area.delay > 0 || elapsed < f.jetFor) return;
    // Match the simulated spiral's angular speed.
    const spin = (elapsed - f.jetFor) * f.spiralSpin;
    const out = area.radius + f.spiralReach * area.scale;
    const fade = Math.min(1, area.life / 0.2);
    for (let arm = 0; arm < f.arms; arm++) {
      const angle = spin + (arm / f.arms) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      for (let i = perFrame(fx, 45 * fade); i > 0; i--) {
        const d = area.radius * rand(0.6, 1);
        fx.sprites.emit(
          flame,
          x + c * d,
          h + 0.3,
          z + s * d,
          (c * (out - d)) / flame.life - s * 2,
          rand(0.5, 1.5),
          (s * (out - d)) / flame.life + c * 2,
          rand(0.28, 0.42) * area.scale,
        );
      }
    }
  },
};

/**
 * 水旋涡: the player spins in the shell (a whirl at the shell's reach) while the jets sweep around like a
 * sprinkler: one water beam per jet at the sim's angle, length and width.
 */
export const hydroSpiral: AreaLook = {
  live(fx, area, x, z) {
    const f = SPRINKLER;
    const elapsed = elapsedOf(area);
    const h = fx.ground.heightAt(x, z);
    const fade = Math.min(1, area.life / 0.15, elapsed / 0.08);
    const shell = f.shell * area.scale;
    fx.decals
      .put(Decal.whirl, x, z, shell, -fx.time * 9, seedOf(area.id))
      .tint(water.foam, 0.55 * fade, water.light, 0.3)
      .args(fade);
    const turn = area.angle + elapsed * f.spin;
    const y = h + CHEST * 0.8;
    for (let jet = 0; jet < area.count; jet++) {
      const angle = turn + (jet / area.count) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const yaw = Math.atan2(dx, dz);
      fx.volumes.beams.add(
        place(
          x + dx * 0.5,
          y,
          z + dz * 0.5,
          yaw,
          area.radius * 0.75,
          area.radius * 0.75,
          area.length,
        ),
        water.light,
        fade,
        water.deep,
        2,
      );
      fx.decals
        .put(Decal.strip, x, z, area.length, yaw)
        .rect(-area.radius, 0, area.radius, area.length)
        .tint(water.dark, 0.5 * fade, water.foam, 0)
        .args(0, area.radius, 1);
      for (let i = perFrame(fx, 20 * fade); i > 0; i--) {
        const d = area.length * rand(0.85, 1);
        fx.sprites.emit(
          droplet,
          x + dx * d,
          y,
          z + dz * d,
          dx * 2 - dz * 3,
          rand(1.5, 3),
          dz * 2 + dx * 3,
          rand(0.07, 0.11),
          h,
        );
      }
    }
  },
  strike(fx, area, x, z) {
    const shell = SPRINKLER.shell * area.scale;
    fx.decals.stamp(Decal.ring, x, z, shell, 0.3, water.foam, 0.9, water.light, 0.5, 0.14, 0.3);
    spray(fx, droplet, x, fx.ground.heightAt(x, z) + 0.4, z, 12, shell * 2.5, 3, 0.08);
  },
};

/** A bolt out of the sky into the ball at (x, y, z); a = ground height under it. */
function drawRodBolt(fx: Fx, echo: Echo, t: number): void {
  const [tx, rise, tz] = skyTop(fx, echo.x, echo.z, 9);
  const alpha = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
  fx.ribbons.bolt(
    tx,
    echo.a + rise,
    tz,
    echo.x,
    echo.y,
    echo.z,
    flicker(fx, echo.seed, 24),
    0.16,
    electric.yellow,
    alpha,
    2,
  );
}

/** Strikes already drawn per ball (the sim strikes on its tick; the view sees it a frame later). */
const struck = new WeakMap<Area, number>();

/**
 * 电球风暴: a big electro ball arcs out and hovers over the horde; every strike a bolt from the sky lands
 * on it (the sim's chain event draws the arcs out of it), then it falls and bursts.
 */
export const ballStorm: AreaLook = {
  live(fx, area, x, z, charge) {
    const f = ROD;
    const ground = fx.ground.heightAt(x, z);
    let bx = x;
    let bz = z;
    let by = ground + f.height;
    if (area.delay > 0) {
      const fromX = x - area.dirX * area.length;
      const fromZ = z - area.dirZ * area.length;
      const from = fx.ground.heightAt(fromX, fromZ) + CHEST;
      bx = fromX + (x - fromX) * charge;
      bz = fromZ + (z - fromZ) * charge;
      by = from + (by - from) * charge + Math.sin(charge * Math.PI) * 1.2;
    } else {
      by += Math.sin(fx.time * 4) * 0.15;
    }
    const fade = Math.min(1, area.life / 0.12);
    const r = 0.55 * Math.min(1, 0.5 + charge);
    fx.volumes.orbs.add(
      place(bx, by, bz, fx.time * 3, r, r, r),
      electric.yellow,
      fade,
      electric.cyan,
      1,
      seedOf(area.id),
    );
    fx.sprites.draw(halo, bx, by, bz, r * 2.4, 0.5 * fade);
    if (area.delay > 0) return;
    // The chain reach on the ground, faint: where the arcs can land.
    fx.decals
      .put(Decal.ring, x, z, area.radius, 0, seedOf(area.id))
      .tint(electric.yellow, 0.35 * fade, white, 0.4)
      .args(0.5, 0.06, 1);
    const strikes = Math.floor((elapsedOf(area) - f.flight) / f.tick) + 1;
    if ((struck.get(area) ?? 0) < strikes) {
      struck.set(area, strikes);
      fx.echoes.add(drawRodBolt, 0.2, bx, by, bz, ground);
      fx.sprites.emit(strikeFlash, bx, by, bz, 0, 0, 0, 0.6);
      spray(fx, spark, bx, by, bz, 8, 4, 1, 0.06);
    }
  },
};

export {
  electroBurst as ballStormBurst,
  fireSpinBurst as fireWhirlBurst,
  whirlpoolBurst as hydroSpiralBurst,
};
