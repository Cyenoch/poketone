import { Decal } from "./decals";
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
  type ShotLook,
} from "./fx";
import { reactions } from "../../sim/content/reactions";
import { electric, stone, water, white } from "./palette";
import { Shape, sprite } from "./sprites";
import { place } from "./volumes";

const halo = sprite({
  shape: Shape.glow,
  from: electric.gold,
  accent: electric.yellow,
  alpha: 0.5,
  add: 1,
});
const core = sprite({ shape: Shape.star, from: electric.yellow, accent: white, add: 1 });
const spark = sprite({
  shape: Shape.spark,
  life: 0.28,
  grow: 0.4,
  from: electric.yellow,
  to: electric.gold,
  accent: white,
  add: 1,
  gravity: 6,
  drag: 2.5,
  stretch: 0.04,
});
const flash = sprite({
  shape: Shape.star,
  life: 0.18,
  grow: 1.6,
  from: electric.yellow,
  accent: white,
  add: 1,
  spin: 3,
});
const bloom = sprite({
  shape: Shape.glow,
  life: 0.28,
  grow: 1.3,
  from: electric.gold,
  to: electric.yellow,
  accent: white,
  alpha: 0.6,
  add: 0.6,
});
const ring = sprite({
  shape: Shape.ring,
  life: 0.22,
  grow: 2.2,
  from: electric.yellow,
  accent: white,
  add: 1,
});
const debris = sprite({
  shape: Shape.shard,
  life: 0.7,
  grow: 0.7,
  from: stone.light,
  accent: stone.dark,
  gravity: 16,
  drag: 0.5,
  spin: 10,
});
const dust = sprite({
  shape: Shape.puff,
  life: 0.7,
  grow: 2,
  from: stone.light,
  accent: stone.dark,
  alpha: 0.8,
  gravity: -0.8,
  drag: 3,
});

/** The wet coat flung off as it shorts out: cyan water with a charged yellow rim. */
const shortOut = sprite({
  shape: Shape.drop,
  life: 0.45,
  grow: 0.6,
  from: water.foam,
  to: electric.cyan,
  accent: electric.yellow,
  gravity: 12,
  drag: 1,
  stretch: 0.03,
});

function burstSparks(fx: Fx, x: number, y: number, z: number, n: number, speed: number): void {
  spray(fx, spark, x, y, z, n, speed, speed * 0.6, 0.06);
}

/** Short crackles around a point. a = reach. */
function drawArcs(fx: Fx, echo: Echo, t: number): void {
  const seed = flicker(fx, echo.seed, 24);
  const alpha = 1 - t * t;
  for (let i = 0; i < 3; i++) {
    const angle = seed * 3.1 + i * 2.1;
    const reach = echo.a * (0.6 + 0.4 * Math.sin(seed + i));
    fx.ribbons.bolt(
      echo.x,
      echo.y,
      echo.z,
      echo.x + Math.cos(angle) * reach,
      echo.y + (Math.sin(seed * 12.9 + i) * 0.25 + 0.05) * reach,
      echo.z + Math.sin(angle) * reach,
      seed + i,
      0.06,
      electric.yellow,
      alpha,
    );
  }
}

/** Arcs fanning out to the burst radius. a = radius. */
function drawRadial(fx: Fx, echo: Echo, t: number): void {
  const seed = flicker(fx, echo.seed, 20);
  const alpha = 1 - t * t;
  const count = 7;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + echo.seed;
    const reach = echo.a * (0.7 + 0.3 * Math.sin(seed * 1.7 + i));
    const ex = echo.x + Math.cos(angle) * reach;
    const ez = echo.z + Math.sin(angle) * reach;
    fx.ribbons.bolt(
      echo.x,
      echo.y,
      echo.z,
      ex,
      fx.ground.heightAt(ex, ez) + 0.25,
      ez,
      seed + i * 3.3,
      0.09,
      electric.yellow,
      alpha,
    );
  }
}

/** Thunderbolt's chain along `points` (x, z pairs, player first). */
function drawChain(fx: Fx, echo: Echo, t: number): void {
  const { points } = echo;
  const seed = flicker(fx, echo.seed, 20);
  const alpha = t < 0.15 ? 1 : 1 - ((t - 0.15) / 0.85) ** 2;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const ax = points[i]!;
    const az = points[i + 1]!;
    const bx = points[i + 2]!;
    const bz = points[i + 3]!;
    const width = Math.max(0.06, 0.12 - i * 0.01);
    fx.ribbons.bolt(
      ax,
      fx.ground.heightAt(ax, az) + (i === 0 ? echo.a : 0.7),
      az,
      bx,
      fx.ground.heightAt(bx, bz) + 0.7,
      bz,
      seed + i * 5.1,
      width,
      electric.yellow,
      alpha,
      1,
    );
  }
}

/** Thunder's strike: a forked bolt out of the sky. a = ground height. */
function drawSkyBolt(fx: Fx, echo: Echo, t: number): void {
  const seed = flicker(fx, echo.seed, 26);
  const alpha = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
  const [tx, rise, tz] = skyTop(fx, echo.x, echo.z, 10);
  fx.ribbons.bolt(
    tx + Math.sin(echo.seed) * 0.8,
    echo.a + rise,
    tz + Math.cos(echo.seed) * 0.8,
    echo.x,
    echo.a + 0.1,
    echo.z,
    seed,
    0.18,
    electric.yellow,
    alpha,
    2,
  );
  fx.sprites.draw(halo, echo.x, echo.a + 0.5, echo.z, 0.8 * (1 - t), 1);
}

/** `lift`: the first point's height over its ground (a hovering source). */
export function chain(fx: Fx, points: readonly number[], lift = 0.8): void {
  fx.echoes.add(drawChain, 0.32, 0, 0, 0, lift, 0, 0, points);
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i]!;
    const z = points[i + 1]!;
    const y = fx.ground.heightAt(x, z) + (i === 0 ? lift : 0.7);
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, i === 0 ? 0.28 : 0.35);
    if (i > 0) {
      fx.sprites.emit(ring, x, y, z, 0, 0, 0, 0.22);
      burstSparks(fx, x, y, z, 6, 2.5);
    }
  }
}

/**
 * 感电: the wet target shorts out. Its water sprays off charged, arcs jump out along the ground toward
 * the splash, and a cyan ring marks the splash reach (`reactions.shock` radius).
 */
export function electrocute(fx: Fx, x: number, y: number, z: number): void {
  fx.decals.stamp(
    Decal.ring,
    x,
    z,
    reactions.shock.effect.radius,
    0.3,
    electric.cyan,
    0.6,
    electric.yellow,
    0.7,
    0.1,
    0.25,
  );
  fx.echoes.add(drawRadial, 0.24, x, y, z, reactions.shock.effect.radius * 0.8);
  fx.echoes.add(drawArcs, 0.3, x, y + 0.2, z, 1.1);
  burstSparks(fx, x, y, z, 10, 6);
  spray(fx, shortOut, x, y + 0.2, z, 9, 3.2, 3, 0.08);
  fx.sprites.emit(bloom, x, y, z, 0, 0, 0, 1.1);
}

export const thunderShock: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.28);
    burstSparks(fx, x, y, z, 4, 2);
  },
  fly(fx, shot, x, y, z) {
    const speed = Math.hypot(shot.vx, shot.vz) || 1;
    const tail = 1.2;
    fx.sprites.draw(halo, x, y, z, shot.radius * 2);
    fx.sprites.draw(core, x, y, z, shot.radius * 1.4, 1, 0, 0, fx.time * 20);
    fx.ribbons.bolt(
      x,
      y,
      z,
      x - (shot.vx / speed) * tail,
      y,
      z - (shot.vz / speed) * tail,
      flicker(fx, shot.id, 30),
      0.07,
      electric.yellow,
      1,
    );
    for (let i = perFrame(fx, 26); i > 0; i--) {
      fx.sprites.emit(spark, x, y, z, rand(-1.5, 1.5), rand(-0.5, 1.5), rand(-1.5, 1.5), 0.05);
    }
  },
  hit(fx, x, y, z) {
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.45);
    burstSparks(fx, x, y, z, 10, 3);
    fx.echoes.add(drawArcs, 0.14, x, y, z, 0.5);
  },
  fade(fx, x, y, z) {
    burstSparks(fx, x, y, z, 4, 1.5);
  },
};

export const electroBall: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(ring, x, y, z, 0, 0, 0, 0.25);
    burstSparks(fx, x, y, z, 6, 2);
  },
  fly(fx, shot, x, y, z) {
    const r = shot.radius * 1.1;
    fx.volumes.orbs.add(
      place(x, y, z, fx.time * 3, r, r, r),
      electric.yellow,
      1,
      electric.cyan,
      1,
      seedOf(shot.id),
    );
    fx.sprites.draw(halo, x, y, z, r * 1.8, 0.45);
    fx.decals.put(Decal.glow, x, z, r * 1.5).tint(electric.yellow, 0.4, white, 1);
    const seed = flicker(fx, shot.id, 18);
    for (let i = 0; i < 2; i++) {
      const a = seed * 2.3 + i * Math.PI;
      const c = Math.cos(a);
      const s = Math.sin(a);
      fx.ribbons.bolt(
        x + c * r * 0.8,
        y + s * r * 0.4,
        z + s * r * 0.8,
        x + c * r * 2,
        y - s * r * 0.3,
        z + s * r * 2,
        seed + i,
        0.035,
        electric.yellow,
        0.9,
      );
    }
    for (let i = perFrame(fx, 30); i > 0; i--) {
      fx.sprites.emit(
        spark,
        x,
        y,
        z,
        rand(-1.5, 1.5) - shot.vx * 0.05,
        rand(-0.5, 1.5),
        rand(-1.5, 1.5) - shot.vz * 0.05,
        0.05,
      );
    }
  },
  // No hit or fade: the burst area carries the explosion.
};

export const electroBurst: AreaLook = {
  strike(fx, area, x, z) {
    const r = area.radius;
    const y = fx.ground.heightAt(x, z) + 0.5;
    fx.sprites.emit(bloom, x, y, z, 0, 0, 0, r * 0.5);
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, r * 0.35);
    fx.decals.stamp(Decal.ring, x, z, r, 0.3, electric.yellow, 0.9, white, 0.7, 0.14, 0.3);
    fx.decals.stamp(Decal.glow, x, z, r * 0.8, 0.25, electric.yellow, 0.5, white, 1);
    fx.echoes.add(drawRadial, 0.25, x, y, z, r);
    burstSparks(fx, x, y, z, 16, r * 2.5);
  },
};

export const thunder: AreaLook = {
  live(fx, area, x, z, charge) {
    if (area.delay <= 0) return;
    const r = area.radius;
    fx.decals
      .put(Decal.telegraph, x, z, r, 0, seedOf(area.id))
      .tint(electric.yellow, 0.95, electric.white, 0.5)
      .args(charge);
    const h = fx.ground.heightAt(x, z);
    for (let i = perFrame(fx, 14); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      fx.sprites.emit(
        spark,
        x + Math.cos(a) * r * 0.94,
        h + 0.1,
        z + Math.sin(a) * r * 0.94,
        0,
        rand(1.5, 3),
        0,
        0.05,
      );
    }
  },
  strike(fx, area, x, z) {
    const r = area.radius;
    const h = fx.ground.heightAt(x, z);
    fx.echoes.add(drawSkyBolt, 0.26, x, 0, z, h);
    fx.sprites.emit(bloom, x, h + 0.5, z, 0, 0, 0, r * 0.6);
    fx.sprites.emit(flash, x, h + 0.4, z, 0, 0, 0, r * 0.55);
    fx.decals.stamp(Decal.ring, x, z, r, 0.35, white, 1, electric.yellow, 0.7, 0.16, 0.3);
    fx.decals.stamp(Decal.cracks, x, z, r, 2, electric.yellow, 1, white, 0);
    burstSparks(fx, x, h + 0.3, z, 20, r * 4);
    spray(fx, debris, x, h + 0.2, z, 8, 2, 3, 0.08);
    spray(fx, dust, x, h + 0.1, z, 4, r, 0.4, 0.2);
  },
};
