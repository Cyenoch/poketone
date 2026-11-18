// Weather moves (大晴天, 求雨, 沙暴): the cast sets the whole field's weather and hits nothing, so the
// effect is a cast beat on the caster only. It rises off the body into the sky the weather comes
// from, and its ground mark hugs the feet: no ring at a radius that could read as a hitbox. The
// weather itself (sky, light, particles) is drawn from `world.weather` by `view/weather.ts`.
//
// Each beat peaks in its first 0.25 s and has ended within `WEATHER_CAST_SECONDS`, which is at least
// as long as the longest mastered cast take (大晴天, 1.0 s).

import type { WeatherId } from "../../sim/state/field";
import { Decal } from "./decals";
import { perFrame, rand, type Echo, type Fx } from "./fx";
import { gold, rock, water, white, wind } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";

/** The weathers a move can call; hail has no line yet. */
export type CastWeatherId = Exclude<WeatherId, "hail">;

/** The caster's interpolated ground position and its form's `radius` and `height`. */
export type WeatherCast = (fx: Fx, x: number, z: number, radius: number, height: number) => void;

export const WEATHER_CAST_SECONDS = 1.1;

/** How far over the head the sun and the cloud form. */
const OVERHEAD = 0.8;

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

const sunCore = sprite({ shape: Shape.glow, from: gold.white, accent: white, add: 1 });
const sunHalo = sprite({
  shape: Shape.glow,
  from: gold.yellow,
  accent: gold.white,
  alpha: 0.55,
  add: 1,
});
const sunRays = sprite({ shape: Shape.star, from: gold.yellow, accent: gold.white, add: 1 });
const mote = sprite({
  shape: Shape.spark,
  life: 0.5,
  grow: 0.4,
  from: gold.white,
  to: gold.yellow,
  accent: white,
  add: 0.8,
  drag: 1.5,
  stretch: 0.05,
});

/** A small sun climbs off the caster and flares. a = body radius, b = top height. */
function drawSun(fx: Fx, echo: Echo, t: number): void {
  const rise = easeOut(Math.min(1, t / 0.22));
  const y = echo.y + 0.5 + (echo.b - 0.5) * rise;
  // Flares as it arrives, then shrinks away instead of fading flat.
  const flare = t < 0.22 ? t / 0.22 : (1 - (t - 0.22) / 0.78) ** 1.5;
  const size = (0.2 + echo.a * 0.35) * (0.4 + 0.6 * flare);
  for (let i = 0; i <= 4; i++) {
    const k = i / 4;
    fx.ribbons.point(
      echo.x,
      echo.y + 0.3 + (y - echo.y - 0.3) * k,
      echo.z,
      0.12 * (1 - k * 0.5),
      gold.white,
      0.7 * (1 - rise * 0.6) * flare,
    );
  }
  fx.ribbons.flush(Ribbon.glow, 1);
  fx.sprites.draw(sunHalo, echo.x, y, echo.z, size * 2.6, flare);
  const turn = fx.time * 1.2 + echo.seed;
  fx.sprites.draw(sunRays, echo.x, y, echo.z, size * 2, flare, 0, 0, turn);
  fx.sprites.draw(sunRays, echo.x, y, echo.z, size * 1.5, flare, 0, 0, turn + Math.PI / 4);
  fx.sprites.draw(sunCore, echo.x, y, echo.z, size, Math.min(1, flare * 1.6));
}

const sunnyDay: WeatherCast = (fx, x, z, radius, height) => {
  const h = fx.ground.heightAt(x, z);
  fx.echoes.add(drawSun, WEATHER_CAST_SECONDS, x, h, z, radius, height + OVERHEAD);
  fx.decals.stamp(Decal.glow, x, z, radius * 2.2, 0.9, gold.yellow, 0.55, gold.white, 1);
  fx.decals.stamp(
    Decal.ring,
    x,
    z,
    radius * 1.5,
    0.35,
    gold.white,
    0.85,
    gold.yellow,
    0.6,
    0.1,
    0.5,
  );
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rand(-0.3, 0.3);
    const d = radius * rand(0.6, 1.1);
    fx.sprites.emit(
      mote,
      x + Math.cos(a) * d,
      h + rand(0.1, height * 0.6),
      z + Math.sin(a) * d,
      0,
      rand(3, 5.5),
      0,
      rand(0.06, 0.09),
    );
  }
};

const cloudBody = sprite({
  shape: Shape.cloud,
  from: wind.cream,
  to: water.light,
  accent: white,
  alpha: 0.85,
});
const cloudShade = sprite({
  shape: Shape.cloud,
  from: water.mid,
  to: water.deep,
  accent: water.light,
  alpha: 0.6,
});
const gather = sprite({
  shape: Shape.drop,
  life: 0.28,
  grow: 0.5,
  from: water.light,
  accent: water.deep,
  drag: 1,
  stretch: 0.03,
});
const rainDrop = sprite({
  shape: Shape.drop,
  life: 0.4,
  grow: 0.8,
  from: water.light,
  accent: water.deep,
  gravity: 14,
  stretch: 0.035,
});
const splashRing = sprite({
  shape: Shape.ring,
  life: 0.22,
  grow: 2.2,
  from: water.foam,
  accent: water.light,
  add: 0.5,
});

/** Lobes of the cloud, as offsets in units of its width: x, y, size. */
const LOBES = [-0.55, -0.05, 0.6, 0.5, -0.1, 0.55, 0, 0.12, 0.8] as const;

/** A rain cloud pops over the caster and sheds its first drops. a = body radius, b = top height. */
function drawCloud(fx: Fx, echo: Echo, t: number): void {
  // Pops open, holds, then shrinks away.
  const open = t < 0.18 ? easeOut(t / 0.18) : t > 0.7 ? 1 - ((t - 0.7) / 0.3) ** 2 : 1;
  const width = (0.45 + echo.a * 0.5) * open;
  const y = echo.y + echo.b;
  const sx = Math.cos(fx.viewYaw);
  const sz = -Math.sin(fx.viewYaw);
  for (let i = 0; i < LOBES.length; i += 3) {
    const ox = LOBES[i]! * width;
    const px = echo.x + sx * ox;
    const pz = echo.z + sz * ox;
    const py = y + LOBES[i + 1]! * width;
    const size = LOBES[i + 2]! * width;
    fx.sprites.draw(cloudShade, px, py - size * 0.25, pz, size, open, 0, 0, 0, echo.seed + i);
    fx.sprites.draw(cloudBody, px, py, pz, size, open, 0, 0, 0, echo.seed + i + 1);
  }
  if (t < 0.2 || t > 0.6) return;
  const floor = fx.ground.heightAt(echo.x, echo.z);
  for (let i = perFrame(fx, 26); i > 0; i--) {
    const ox = rand(-0.8, 0.8) * width;
    fx.sprites.emit(
      rainDrop,
      echo.x + sx * ox + rand(-0.15, 0.15),
      y - 0.1,
      echo.z + sz * ox + rand(-0.15, 0.15),
      0,
      -2,
      0,
      0.06,
      floor,
    );
  }
}

const rainDance: WeatherCast = (fx, x, z, radius, height) => {
  const h = fx.ground.heightAt(x, z);
  fx.echoes.add(drawCloud, 0.95, x, h, z, radius, height + OVERHEAD);
  fx.decals.stamp(Decal.ripple, x, z, radius * 2, 0.7, water.foam, 0.8, water.light, 0.3);
  fx.sprites.emit(splashRing, x, h + 0.1, z, 0, 0, 0, radius * 0.7);
  // Drops leave the ground for the cloud: the cast beat.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand(-0.3, 0.3);
    const d = radius * rand(0.5, 1.1);
    fx.sprites.emit(
      gather,
      x + Math.cos(a) * d,
      h + rand(0.1, 0.4),
      z + Math.sin(a) * d,
      -Math.cos(a) * d * 2,
      (height + OVERHEAD) / 0.3,
      -Math.sin(a) * d * 2,
      0.07,
    );
  }
};

// Dark clay edges keep the sand readable on the desert's own sand.
const grit = sprite({
  shape: Shape.spark,
  life: 0.4,
  grow: 0.5,
  from: rock.light,
  to: rock.clay,
  accent: rock.dust,
  alpha: 0.95,
  drag: 1.2,
  stretch: 0.05,
});
const sandCloud = sprite({
  shape: Shape.puff,
  life: 0.7,
  grow: 1.9,
  from: rock.dust,
  to: rock.earth,
  accent: rock.clay,
  alpha: 0.75,
  gravity: -0.8,
  drag: 2.5,
  spin: 1,
});

/** Sand whips round the caster and climbs. a = body radius, b = top height. */
function drawSandSpin(fx: Fx, echo: Echo, t: number): void {
  const out = easeOut(Math.min(1, t / 0.25));
  const fade = t < 0.6 ? 1 : 1 - ((t - 0.6) / 0.4) ** 2;
  const r = echo.a * (1.1 + 0.7 * out);
  fx.decals
    .put(Decal.whirl, echo.x, echo.z, r, 0, echo.seed)
    .tint(rock.dust, 0.9 * fade, rock.clay, 0);
  for (let i = perFrame(fx, 46 * fade); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    const d = r * rand(0.55, 0.95);
    const speed = rand(4, 6);
    fx.sprites.emit(
      grit,
      echo.x + Math.cos(a) * d,
      echo.y + rand(0.1, echo.b * (0.3 + 0.7 * t)),
      echo.z + Math.sin(a) * d,
      -Math.sin(a) * speed,
      rand(1, 3),
      Math.cos(a) * speed,
      rand(0.05, 0.08),
    );
  }
}

const sandstorm: WeatherCast = (fx, x, z, radius, height) => {
  const h = fx.ground.heightAt(x, z);
  fx.echoes.add(drawSandSpin, 0.9, x, h, z, radius, height + OVERHEAD);
  fx.decals.stamp(Decal.ring, x, z, radius * 1.6, 0.3, rock.light, 0.85, rock.clay, 0, 0.12, 0.5);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand(-0.4, 0.4);
    fx.sprites.emit(
      sandCloud,
      x + Math.cos(a) * radius,
      h + 0.25,
      z + Math.sin(a) * radius,
      -Math.sin(a) * 2.2,
      rand(0.4, 1.2),
      Math.cos(a) * 2.2,
      rand(0.2, 0.3),
    );
  }
};

/** The cast beat of each weather a move can call. */
export const weatherCasts: Record<CastWeatherId, WeatherCast> = {
  sun: sunnyDay,
  rain: rainDance,
  sandstorm,
};

/** The weather each weather move calls, by move id. */
export const moveWeather: Partial<Record<string, CastWeatherId>> = {
  "sunny-day": "sun",
  "rain-dance": "rain",
  sandstorm: "sandstorm",
};
