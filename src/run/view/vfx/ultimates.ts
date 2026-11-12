// Ultimates and evolution (skill-vfx). Every ultimate pulse arrives as a `ult-pulse` event whose
// radius / lane is the hitbox, so the primary shape is drawn exactly there; flourishes stay inside it
// and short. Evolution is a light column: a tall, thin, brief beat that never covers the crowd.

import { starters, type StarterId } from "../../sim/content/lines/index";
import { CHEST } from "../../sim/content/params/combat";
import type { UltPulseEvent } from "../../sim/state/events";
import type { UltimateId } from "../../sim/content/ultimates";
import { Decal } from "./decals";
import { flicker, rand, skyTop, spray, type Echo, type Fx } from "./fx";
import type { Rgb } from "./gl";
import { electric, fire, gold, grass, powder, water, white } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";

const COLUMN_HEIGHT = 6.5;

const riseGold = sprite({
  shape: Shape.spark,
  life: 0.8,
  grow: 0.3,
  from: gold.white,
  to: gold.yellow,
  accent: white,
  add: 1,
  drag: 1.5,
  stretch: 0.05,
});
const flash = sprite({
  shape: Shape.glow,
  life: 0.22,
  grow: 1.6,
  from: white,
  accent: white,
  add: 1,
});
const flame = sprite({
  shape: Shape.flame,
  from: fire.orange,
  to: fire.soot,
  accent: fire.yellow,
  add: 0.3,
});
const leaf = sprite({
  shape: Shape.leaf,
  life: 0.6,
  grow: 0.8,
  from: grass.leaf,
  to: grass.deep,
  accent: grass.light,
  gravity: 4,
  drag: 2,
  spin: 8,
});
const petal = sprite({
  shape: Shape.leaf,
  life: 0.7,
  grow: 0.9,
  from: powder.pink,
  to: powder.lilac,
  accent: white,
  gravity: 1,
  drag: 2.5,
  spin: 6,
});
const spore = sprite({
  shape: Shape.cloud,
  life: 0.8,
  grow: 1.6,
  from: powder.lilac,
  to: powder.mist,
  accent: white,
  alpha: 0.55,
  gravity: -0.4,
  drag: 2,
});
const drop = sprite({
  shape: Shape.drop,
  life: 0.45,
  grow: 0.6,
  from: water.light,
  to: water.mid,
  accent: water.foam,
  gravity: 14,
  drag: 0.5,
  stretch: -1,
});
const foam = sprite({
  shape: Shape.puff,
  life: 0.4,
  grow: 1.5,
  from: water.foam,
  to: water.light,
  accent: white,
  alpha: 0.8,
  drag: 3,
});
const spark = sprite({
  shape: Shape.spark,
  life: 0.25,
  grow: 0.4,
  from: electric.white,
  to: electric.yellow,
  accent: white,
  add: 1,
  gravity: 6,
  drag: 2,
  stretch: 0.04,
});

const ultColour: Record<UltimateId, readonly [Rgb, Rgb]> = {
  "frenzy-plant": [grass.leaf, grass.sun],
  "blast-burn": [fire.orange, fire.core],
  "hydro-cannon": [water.mid, water.foam],
  "volt-tackle": [electric.yellow, electric.white],
};

/** Evolution: a column of light on the player, a ring on the ground and motes rising up it. */
export function evolveColumn(fx: Fx, x: number, z: number): void {
  const h = fx.ground.heightAt(x, z);
  fx.echoes.add(drawColumn, 0.9, x, h, z);
  fx.decals.stamp(Decal.ring, x, z, 1.6, 0.6, gold.yellow, 1, white, 0.8, 0.25, 0.2);
  fx.decals.stamp(Decal.glow, x, z, 1.2, 0.8, gold.yellow, 0.9, white, 1);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = rand(0.2, 0.7);
    fx.sprites.emit(
      riseGold,
      x + Math.cos(a) * d,
      h + rand(0, 1.5),
      z + Math.sin(a) * d,
      0,
      rand(3, 7),
      0,
      rand(0.12, 0.22),
    );
  }
}

function drawColumn(fx: Fx, echo: Echo, t: number): void {
  // Snaps open in the first 10 %, then narrows away instead of fading flat.
  const open = Math.min(1, t / 0.1);
  const width = 0.9 * open * (1 - t) ** 0.6;
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    fx.ribbons.point(
      echo.x,
      echo.y + k * COLUMN_HEIGHT * open,
      echo.z,
      width * (1 - 0.6 * k),
      gold.white,
      1 - k * 0.7,
    );
  }
  fx.ribbons.flush(Ribbon.glow, 1);
}

/** Cast beat: a bright ring at the body in the ultimate's colour. */
export function ultCast(fx: Fx, line: StarterId, x: number, z: number): void {
  // Blast Burn's simultaneous near-body pulse supplies its cast beat without hiding the caster.
  if (starters[line].ultimate === "blast-burn") return;
  const [colour, core] = ultColour[starters[line].ultimate];
  const y = fx.ground.heightAt(x, z) + CHEST;
  fx.sprites.emit(flash, x, y, z, 0, 0, 0, 1.4);
  fx.decals.stamp(Decal.ring, x, z, 1.4, 0.35, colour, 1, core, 0.8, 0.3, 0.1);
}

export function ultPulse(fx: Fx, e: UltPulseEvent): void {
  const { x, z, radius: r } = e;
  const h = fx.ground.heightAt(x, z);
  switch (e.look) {
    case "roots":
      fx.echoes.add(drawRootLane, 0.7, x, r, z, e.dirX, e.dirZ, e.length);
      fx.echoes.add(drawRoot, 0.55, x, h, z, e.dirX, e.dirZ, e.length);
      along(e, (px, pz) => spray(fx, leaf, px, h + 0.3, pz, 2, 2, 3, 0.18));
      return;
    case "sun":
      fx.decals.stamp(Decal.glow, x, z, r, 0.9, grass.gold, 0.9, grass.sun, 1);
      for (let i = 0; i < 16; i++)
        fx.sprites.emit(
          riseGold,
          x + rand(-0.5, 0.5),
          h + rand(0, 1),
          z + rand(-0.5, 0.5),
          0,
          rand(2, 4),
          0,
          0.15,
        );
      return;
    case "spores":
      fx.decals.stamp(Decal.ring, x, z, r, 0.5, powder.lilac, 0.8, white, 0.4, 0.15, 0.3);
      spray(fx, spore, x, h + 0.5, z, 14, r * 1.6, 0.6, 0.6);
      return;
    case "petals":
      fx.decals.stamp(Decal.ring, x, z, r, 0.45, powder.pink, 0.9, white, 0.6, 0.12, 0.6);
      spray(fx, petal, x, h + 0.6, z, 22, r * 2.2, 1.5, 0.22);
      return;
    case "pillar":
      fx.echoes.add(drawFireRelease, 0.28, x, h, z, r, 1);
      return;
    case "ring":
      fx.echoes.add(drawFireRelease, 0.28, x, h, z, r, 0.8);
      return;
    case "embers":
      fx.echoes.add(drawEmberPatch, 0.28, x, h, z, r);
      return;
    case "crack":
      fx.echoes.add(drawMagmaLane, 0.5, x, r, z, e.dirX, e.dirZ, e.length);
      return;
    case "meteor":
      fx.echoes.add(drawFall, 0.1, x, h, z, 0.18);
      fx.echoes.add(drawFireRelease, 0.24, x, h, z, r, 0.65);
      fx.decals.stamp(Decal.scorch, x, z, r * 0.8, 0.7, fire.soot, 0.45, fire.orange, 0);
      return;
    case "blast":
      fx.echoes.add(drawFireRelease, 0.3, x, h, z, r, 1);
      fx.decals.stamp(Decal.scorch, x, z, r * 0.85, 1, fire.soot, 0.45, fire.orange, 0);
      return;
    case "whirl":
      fx.decals.stamp(Decal.whirl, x, z, r, 0.3, water.mid, 0.75, water.foam, 0.3);
      rim(x, z, r * 0.8, 6, (px, pz, a) =>
        fx.sprites.emit(drop, px, h + 0.4, pz, -Math.sin(a) * 5, 1.5, Math.cos(a) * 5, 0.16),
      );
      return;
    case "wave":
      fx.decals.stamp(Decal.ring, x, z, r, 0.45, water.light, 1, water.foam, 0.6, 0.14, 0.2);
      fx.decals.stamp(Decal.ripple, x, z, r, 0.7, water.mid, 0.6, water.foam, 0.3);
      rim(x, z, r, 22, (px, pz, a) =>
        fx.sprites.emit(
          foam,
          px,
          h + 0.3,
          pz,
          Math.cos(a) * 3,
          rand(0.5, 1.5),
          Math.sin(a) * 3,
          rand(0.22, 0.36),
        ),
      );
      return;
    case "rain":
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * r;
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        fx.sprites.emit(
          drop,
          px,
          fx.ground.heightAt(px, pz) + 4,
          pz,
          0,
          -9,
          0,
          0.12,
          fx.ground.heightAt(px, pz),
        );
      }
      fx.decals.stamp(Decal.ripple, x, z, r, 0.6, water.light, 0.35, water.foam, 0.2);
      return;
    case "cannon":
      fx.echoes.add(drawCannon, 0.16, x, r, z, e.dirX, e.dirZ, e.length);
      // The strip alone is lost on grass; a line of drops along the beam carries its direction.
      along(e, (px, pz) =>
        fx.sprites.emit(
          drop,
          px,
          fx.ground.heightAt(px, pz) + 0.6,
          pz,
          e.dirX * 4,
          1.5,
          e.dirZ * 4,
          0.16,
        ),
      );
      return;
    case "storm":
      fx.echoes.add(drawSkyBolt, 0.18, x, h, z, 0.07);
      fx.decals.stamp(Decal.ring, x, z, r, 0.25, electric.yellow, 0.9, white, 0.8, 0.2, 0.2);
      spray(fx, spark, x, h + 0.3, z, 6, 4, 3, 0.18);
      return;
    case "bolt":
      fx.echoes.add(drawSkyBolt, 0.3, x, h, z, 0.16);
      fx.sprites.emit(flash, x, h + 0.8, z, 0, 0, 0, r * 1.1);
      fx.decals.stamp(Decal.ring, x, z, r, 0.35, electric.yellow, 1, white, 0.8, 0.15, 0.1);
      fx.decals.stamp(Decal.cracks, x, z, r * 0.8, 1.2, electric.gold, 0.6, white, 0.5);
      spray(fx, spark, x, h + 0.4, z, 14, 7, 5, 0.22);
      return;
    case "zigzag":
      fx.echoes.add(drawHop, 0.28, x, h, z, e.dirX, e.dirZ, e.length);
      fx.decals.stamp(
        Decal.ring,
        x + e.dirX * e.length,
        z + e.dirZ * e.length,
        r,
        0.3,
        electric.yellow,
        0.9,
        white,
        0.8,
        0.2,
        0.2,
      );
      return;
  }
}

/** A lane from (x, z): y is its half-width, a, b its heading, c the length cover left it. */
function strip(fx: Fx, echo: Echo, colour: Rgb, edge: Rgb, alpha: number, style: number): void {
  fx.decals
    .put(Decal.strip, echo.x, echo.z, echo.c, Math.atan2(echo.a, echo.b))
    .rect(-echo.y, 0, echo.y, echo.c)
    .tint(colour, alpha, edge, 0.4)
    .args(0, echo.y, style);
}

function drawRootLane(fx: Fx, echo: Echo, t: number): void {
  strip(fx, echo, grass.deep, grass.leaf, 0.7 * (1 - t * t), 2);
}

function drawMagmaLane(fx: Fx, echo: Echo, t: number): void {
  strip(fx, echo, fire.soot, fire.orange, 0.65 * (1 - t) ** 2, 0);
  for (let s = 0.8; s < echo.c; s += 1.2) {
    const x = echo.x + echo.a * s;
    const z = echo.z + echo.b * s;
    fx.sprites.draw(
      flame,
      x,
      fx.ground.heightAt(x, z) + 0.18,
      z,
      0.28 * (1 - t),
      1 - t,
      0,
      0,
      0,
      echo.seed + s,
      t,
    );
  }
}

function along(e: UltPulseEvent, at: (x: number, z: number) => void): void {
  for (let s = 0.8; s < e.length; s += 1.2) at(e.x + e.dirX * s, e.z + e.dirZ * s);
}

function rim(
  x: number,
  z: number,
  r: number,
  n: number,
  at: (x: number, z: number, a: number) => void,
): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
    at(x + Math.cos(a) * r, z + Math.sin(a) * r, a);
  }
}

/** A root rope that pushes out along the lane, then sinks. a, b: heading; c: length. */
function drawRoot(fx: Fx, echo: Echo, t: number): void {
  const reach = Math.min(1, t / 0.25) * echo.c;
  const sink = t < 0.6 ? 0 : (t - 0.6) / 0.4;
  for (let i = 0; i <= 10; i++) {
    const s = (reach * i) / 10;
    const px = echo.x + echo.a * s;
    const pz = echo.z + echo.b * s;
    const arch = Math.sin((i / 10) * Math.PI * 3 + echo.seed) * 0.12 + 0.25;
    fx.ribbons.point(
      px,
      fx.ground.heightAt(px, pz) + arch * (1 - sink),
      pz,
      0.16 * (1 - 0.5 * (i / 10)),
      grass.deep,
      1 - sink,
    );
  }
  fx.ribbons.flush(Ribbon.vine, 0);
}

/** Instant disc hit: its full edge is visible at impact; low fire tongues tear outward inside it. */
function drawFireRelease(fx: Fx, echo: Echo, t: number): void {
  const r = echo.a;
  const fade = (1 - t) ** 2;
  fx.decals
    .put(Decal.sector, echo.x, echo.z, r, 0, echo.seed)
    .tint(fire.orange, 0.6 * echo.b * fade, fire.yellow, 0.15)
    .args(t, Math.PI, 0);
  fx.decals
    .put(Decal.ring, echo.x, echo.z, r)
    .tint(fire.orange, 0.8 * fade, fire.yellow, 0.2)
    .args(t, 0.035, 1);
  const open = 1 - (1 - t) ** 3;
  const count = r < 2 ? 7 : 11;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.sin(i * 7.13 + echo.seed) * 0.18;
    const width = Math.min(0.75, r * 0.3) * (1 - t) * (0.8 + 0.2 * Math.sin(i * 4.1));
    const tip = 0.72 + 0.12 * Math.sin(i * 2.4 + echo.seed);
    for (let j = 0; j < 4; j++) {
      const k = j / 3;
      const d = r * (0.24 + 0.38 * open + k * (tip - 0.24 - 0.24 * open));
      const bend = Math.sin(k * Math.PI) * Math.sin(i * 5.3 + echo.seed) * width;
      const x = echo.x + Math.cos(angle) * d - Math.sin(angle) * bend;
      const z = echo.z + Math.sin(angle) * d + Math.cos(angle) * bend;
      fx.ribbons.point(
        x,
        fx.ground.heightAt(x, z) + 0.12 + Math.sin(k * Math.PI) * 0.35 * (1 - t),
        z,
        width * (j === 0 ? 0.45 : j === 1 ? 1 : j === 2 ? 0.5 : 0),
        j === 1 ? fire.yellow : fire.orange,
        fade * echo.b,
      );
    }
    fx.ribbons.flush(Ribbon.glow, 0.3);
  }
}

/** One damage tick at a burning spot; ends before the next tick, without floating fireballs. */
function drawEmberPatch(fx: Fx, echo: Echo, t: number): void {
  fx.decals
    .put(Decal.scorch, echo.x, echo.z, echo.a, 0, echo.seed)
    .tint(fire.soot, 0.6, fire.orange, 0)
    .args(t);
  for (let i = 0; i < 2; i++) {
    const angle = echo.seed + i * Math.PI;
    const x = echo.x + Math.cos(angle) * echo.a * 0.35;
    const z = echo.z + Math.sin(angle) * echo.a * 0.35;
    fx.sprites.draw(
      flame,
      x,
      fx.ground.heightAt(x, z) + 0.14,
      z,
      0.22 * (1 - t * 0.8),
      0.7 * (1 - t),
      0,
      0,
      0,
      echo.seed + i,
      t,
    );
  }
}

/** A fireball's last metres down onto (x, z); a: streak width. */
function drawFall(fx: Fx, echo: Echo, t: number): void {
  const top = echo.y + 5 * (1 - t);
  fx.ribbons.point(echo.x + 1.2, top + 2.5, echo.z - 0.6, echo.a * 0.3, fire.yellow, 0.4);
  fx.ribbons.point(echo.x, echo.y + 0.3, echo.z, echo.a, fire.core, 1 - t);
  fx.ribbons.flush(Ribbon.streak, 1);
}

/** Bolt from the sky; a: width. */
function drawSkyBolt(fx: Fx, echo: Echo, t: number): void {
  const alpha = t < 0.2 ? 1 : 1 - (t - 0.2) / 0.8;
  const [tx, rise, tz] = skyTop(fx, echo.x, echo.z, 9);
  fx.ribbons.bolt(
    tx + 0.8,
    echo.y + rise,
    tz - 0.4,
    echo.x,
    echo.y + 0.1,
    echo.z,
    flicker(fx, echo.seed, 24),
    echo.a,
    electric.yellow,
    alpha,
    1,
  );
}

/** Zig-zag hop from (x, z) along (a, b) for c metres. */
function drawHop(fx: Fx, echo: Echo, t: number): void {
  const alpha = 1 - t * t;
  const bx = echo.x + echo.a * echo.c;
  const bz = echo.z + echo.b * echo.c;
  fx.ribbons.bolt(
    echo.x,
    echo.y + 0.8,
    echo.z,
    bx,
    fx.ground.heightAt(bx, bz) + 0.7,
    bz,
    flicker(fx, echo.seed, 20),
    0.14,
    electric.yellow,
    alpha,
    1,
  );
}

/** One cannon beam; y: half-width, a, b: heading, c: length. Each tick's beam is drawn briefly. */
function drawCannon(fx: Fx, echo: Echo, t: number): void {
  strip(fx, echo, water.mid, water.foam, 0.85 * (1 - t), 1);
}
