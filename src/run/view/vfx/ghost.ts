// Gastly line (skill-vfx): near-black indigo bodies, a hot magenta rim and inked spirits. The dark value
// carries the shape on bright grass; magenta keeps it apart from the enemies' saturated violet poison.

import { FIRESTORM } from "../../sim/content/params/archetypes";
import type { UltPulseEvent } from "../../sim/state/events";
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
import { discEdge, groundArc } from "./line-shapes";
import { ghost } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";
import { place } from "./volumes";

const halo = sprite({
  shape: Shape.glow,
  from: ghost.glow,
  accent: ghost.light,
  alpha: 0.55,
  add: 1,
});
const wisp = sprite({
  shape: Shape.crescent,
  life: 0.25,
  grow: 0.2,
  from: ghost.glow,
  to: ghost.veil,
  accent: ghost.ink,
  drag: 4,
  spin: 5,
});
const trail = sprite({
  shape: Shape.puff,
  life: 0.34,
  grow: 0.5,
  from: ghost.shade,
  to: ghost.ink,
  accent: ghost.ink,
  alpha: 0.85,
  drag: 3,
  gravity: -0.4,
});
const spark = sprite({
  shape: Shape.spark,
  life: 0.22,
  grow: 0.2,
  from: ghost.glow,
  to: ghost.veil,
  accent: ghost.light,
  add: 0.6,
  drag: 5,
  stretch: 0.03,
});
const pop = sprite({
  shape: Shape.ring,
  life: 0.2,
  grow: 1.6,
  from: ghost.glow,
  to: ghost.veil,
  accent: ghost.light,
  add: 0.5,
});
const flash = sprite({
  shape: Shape.star,
  life: 0.16,
  grow: 0.6,
  from: ghost.glow,
  to: ghost.veil,
  accent: ghost.light,
  add: 0.6,
});
const spirit = sprite({ shape: Shape.spirit, from: ghost.light, accent: ghost.veil });
const smogPuff = sprite({
  shape: Shape.puff,
  life: 0.85,
  grow: 1.25,
  from: ghost.smog,
  to: ghost.soot,
  accent: ghost.soot,
  alpha: 0.92,
  drag: 2.2,
  gravity: -0.25,
});
const glint = sprite({
  shape: Shape.spark,
  life: 0.3,
  grow: 0.4,
  from: ghost.glow,
  to: ghost.veil,
  accent: ghost.glow,
  add: 0.4,
});
const goo = sprite({ shape: Shape.ball, from: ghost.sludge, accent: ghost.ink });
const drip = sprite({
  shape: Shape.drop,
  life: 0.4,
  grow: 0.2,
  from: ghost.sludge,
  to: ghost.shade,
  accent: ghost.glow,
  gravity: 9,
  drag: 1.5,
  stretch: -1,
});
const dream = sprite({
  shape: Shape.glow,
  life: 0.3,
  grow: 0.3,
  from: ghost.glow,
  to: ghost.veil,
  accent: ghost.light,
  alpha: 0.85,
  add: 1,
  drag: 3,
});

export const shadowBall: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(wisp, x, y, z, 0, 0, 0, 0.3);
    spray(fx, spark, x, y, z, 4, 1.6, 0.4, 0.08);
  },
  fly(fx, p, x, y, z) {
    const r = p.radius * 1.15;
    fx.volumes.orbs.add(
      place(x, y, z, fx.time * 3, r, r, r),
      ghost.glow,
      1,
      ghost.ink,
      2,
      seedOf(p.id),
    );
    fx.sprites.draw(halo, x, y, z, r * 2.4, 0.6);
    // Two thin crescents circle the ball: the ball's own spin, readable in a still frame.
    for (let i = 0; i < 2; i++) {
      const a = fx.time * 11 + i * Math.PI;
      fx.sprites.draw(
        wisp,
        x + Math.cos(a) * r * 1.25,
        y + Math.sin(a) * r * 0.5,
        z + Math.sin(a) * r * 1.25,
        r * 0.75,
        0.9,
        0,
        0,
        a,
      );
    }
    for (let i = perFrame(fx, 22); i > 0; i--)
      fx.sprites.emit(trail, x, y, z, -p.vx * 0.05, 0.15, -p.vz * 0.05, r * 0.75);
  },
  hit(fx, x, y, z) {
    fx.sprites.emit(pop, x, y, z, 0, 0, 0, 0.3);
    spray(fx, spark, x, y, z, 5, 1.8, 0.5, 0.08);
  },
  fade(fx, x, y, z) {
    spray(fx, trail, x, y, z, 3, 0.5, 0.3, 0.14);
  },
};

export const dreamEater: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(pop, x, y, z, 0, 0, 0, 0.25);
  },
  fly(fx, p, x, y, z) {
    const n = Math.hypot(p.vx, p.vz) || 1;
    // A small ghost swimming to its target on a wavy pink tail.
    fx.sprites.draw(halo, x, y, z, p.radius * 3, 0.7);
    fx.sprites.draw(
      spirit,
      x,
      y + Math.sin(fx.time * 14) * 0.03,
      z,
      p.radius * 1.5,
      1,
      0,
      0,
      0,
      seedOf(p.id),
    );
    for (let i = 0; i <= 8; i++) {
      const d = i * 0.1;
      const k = i / 8;
      fx.ribbons.point(
        x - (p.vx / n) * d,
        y - 0.05 + Math.sin(i * 1.3 + fx.time * 16) * 0.06,
        z - (p.vz / n) * d,
        p.radius * 0.9 * (1 - k),
        ghost.glow,
        0.9 * (1 - k),
      );
    }
    fx.ribbons.flush(Ribbon.glow, 0.5);
  },
  hit(fx, x, y, z) {
    fx.sprites.emit(pop, x, y, z, 0, 0, 0, 0.3);
  },
  fade(fx, x, y, z) {
    fx.sprites.emit(dream, x, y, z, 0, 0.3, 0, 0.15);
  },
};

/** The drain event supplies the actual hit and recipient, rather than a guessed destination. */
export function dreamReturn(fx: Fx, x: number, z: number, tx: number, tz: number): void {
  fx.echoes.add(drawReturn, 0.3, x, fx.ground.heightAt(x, z) + 0.6, z, tx, tz);
}

function drawReturn(fx: Fx, e: Echo, t: number): void {
  const progress = 1 - (1 - t) ** 2;
  const endY = fx.ground.heightAt(e.a, e.b) + 0.6;
  for (let i = 0; i < 3; i++) {
    const k = Math.max(0, progress - i * 0.08);
    fx.sprites.draw(
      dream,
      e.x + (e.a - e.x) * k,
      e.y + (endY - e.y) * k + Math.sin(k * Math.PI) * 0.3,
      e.z + (e.b - e.z) * k,
      0.2 * (1 - t * 0.6),
      1 - t * 0.7,
    );
  }
}

/**
 * A low shadow dome over a disc of r: dark swirling body, magenta fresnel rim at the hitbox edge. It
 * stands above the grass, where a ground decal alone is lost.
 */
function dome(
  fx: Fx,
  x: number,
  z: number,
  r: number,
  height: number,
  alpha: number,
  seed: number,
): void {
  fx.volumes.orbs.add(
    place(x, fx.ground.heightAt(x, z), z, fx.time * 0.8 + seed, r, height, r),
    ghost.glow,
    alpha,
    ghost.ink,
    2,
    seed,
  );
}

/** The ground darkened under a ghost move: a soft-edged ink disc that reaches about r (scorch at age 0,
 * alpha 1.5 is about 75% cover). */
function shadowDisc(fx: Fx, x: number, z: number, r: number, alpha: number): void {
  fx.decals.put(Decal.scorch, x, z, r * 1.12, 0, 0.37).tint(ghost.ink, alpha * 1.5, ghost.shade, 0);
}

/** A dark curse disc: its full edge in magenta, four hooked strokes turning inside. */
function curseMark(fx: Fx, x: number, z: number, r: number, alpha: number, turn: number): void {
  shadowDisc(fx, x, z, r * 1.05, 0.55 * alpha);
  dome(fx, x, z, r, 0.12, 0.3 * alpha, turn);
  discEdge(fx, x, z, r, ghost.glow, alpha);
  for (let i = 0; i < 4; i++)
    groundArc(fx, x, z, r * 0.62, turn + (i * Math.PI) / 2, 1.05, 0.08, 0.09, ghost.glow, alpha);
}

/** Spirits on a circle of `d` around (x, z), bobbing; `n` of them, `size` each. */
function spirits(
  fx: Fx,
  x: number,
  y: number,
  z: number,
  d: number,
  n: number,
  turn: number,
  size: number,
  alpha: number,
): void {
  for (let i = 0; i < n; i++) {
    const a = turn + (i * Math.PI * 2) / n;
    fx.sprites.draw(
      spirit,
      x + Math.sin(a) * d,
      y + 0.45 + 0.12 * Math.sin(fx.time * 5 + i * 2.1),
      z + Math.cos(a) * d,
      size,
      alpha,
      0,
      0,
      0,
      i * 0.13,
    );
  }
}

/** Low smog cloud over a disc of r: inked puffs swirling in, a dark shadow and magenta glints. */
function smogCloud(fx: Fx, x: number, z: number, r: number, fade: number, seed: number): void {
  const h = fx.ground.heightAt(x, z);
  shadowDisc(fx, x, z, r * 1.08, 0.6 * fade);
  dome(fx, x, z, r, 0.3, 0.45 * fade, seed);
  fx.decals.put(Decal.whirl, x, z, r, 0, seed).tint(ghost.glow, 0.55 * fade, ghost.shade, 0);
  discEdge(fx, x, z, r, ghost.smog, 0.75 * fade);
  const size = Math.min(0.55, 0.22 + r * 0.17);
  for (let i = perFrame(fx, (14 + r * 6) * fade); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    const d = r * Math.sqrt(Math.random()) * 0.82;
    fx.sprites.emit(
      smogPuff,
      x + Math.sin(a) * d,
      h + rand(0.2, 0.5),
      z + Math.cos(a) * d,
      Math.cos(a) * 0.9,
      0.15,
      -Math.sin(a) * 0.9,
      size * rand(0.75, 1.15),
    );
  }
  for (let i = perFrame(fx, 5 * fade); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    const d = r * Math.sqrt(Math.random()) * 0.8;
    fx.sprites.emit(
      glint,
      x + Math.sin(a) * d,
      h + rand(0.3, 0.8),
      z + Math.cos(a) * d,
      0,
      0.4,
      0,
      0.13,
    );
  }
}

export const smog: AreaLook = {
  live(fx, a, x, z, charge) {
    const r = a.radius;
    if (a.delay > 0) {
      // 准备: the cloud's shadow gathers inward to its full edge.
      shadowDisc(fx, x, z, r, 0.45 * charge);
      groundArc(
        fx,
        x,
        z,
        r * (1 - 0.55 * charge),
        fx.time * 4,
        Math.PI * 1.6,
        0.12,
        0.09,
        ghost.glow,
        charge,
      );
      return;
    }
    smogCloud(fx, x, z, r, Math.min(1, a.life / 0.25), seedOf(a.id));
  },
  strike(fx, a, x, z) {
    spray(fx, smogPuff, x, fx.ground.heightAt(x, z) + 0.3, z, 6, a.radius * 1.4, 0.4, 0.35);
  },
};

/** A shadow burst: the full edge flashes in magenta, a dark fill erodes, wisps cut inward or out. */
function drawShadowBurst(fx: Fx, e: Echo, t: number): void {
  const fade = (1 - t) ** 2;
  shadowDisc(fx, e.x, e.z, e.a * 1.05, 0.7 * fade);
  dome(fx, e.x, e.z, e.a, 0.12 + 0.3 * (1 - t), 0.65 * fade, e.seed);
  fx.decals
    .put(Decal.ring, e.x, e.z, e.a)
    .tint(ghost.glow, 0.95 * (1 - t), ghost.shade, 0.3)
    .args(t * 0.6, 0.16, 0.55);
  const n = e.a > 2 ? 7 : 5;
  for (let i = 0; i < n; i++) {
    const angle = (i * Math.PI * 2) / n + e.seed;
    const distance = e.a * (e.b ? 0.85 - t * 0.7 : 0.15 + 0.7 * (1 - (1 - t) ** 3));
    fx.sprites.draw(
      wisp,
      e.x + Math.sin(angle) * distance,
      e.y + 0.35,
      e.z + Math.cos(angle) * distance,
      Math.min(0.5, e.a * 0.22) * (1 - t * 0.6),
      fade,
      0,
      0,
      angle,
    );
  }
  if (t < 0.3) fx.sprites.draw(flash, e.x, e.y + 0.4, e.z, Math.min(0.7, e.a * 0.35), 1 - t / 0.3);
}

export const shadowBurst: AreaLook = {
  strike(fx, a, x, z) {
    fx.echoes.add(drawShadowBurst, 0.3, x, fx.ground.heightAt(x, z), z, a.radius, 1);
    fx.decals.stamp(Decal.scorch, x, z, a.radius * 0.7, 0.7, ghost.soot, 0.5, ghost.glow, 0);
  },
};

/** Smog's collapse: the cloud is blown out to its edge. */
export const smogBurst: AreaLook = {
  strike(fx, a, x, z) {
    const h = fx.ground.heightAt(x, z);
    fx.echoes.add(drawShadowBurst, 0.28, x, h, z, a.radius, 0);
    spray(fx, smogPuff, x, h + 0.35, z, 10, a.radius * 1.8, 0.5, Math.min(0.5, a.radius * 0.3));
    fx.decals.stamp(Decal.scorch, x, z, a.radius * 0.7, 0.7, ghost.soot, 0.5, ghost.glow, 0);
  },
};

function drawHex(fx: Fx, e: Echo, t: number): void {
  drawShadowBurst(fx, e, t);
  // Spirits rise out of the struck disc.
  const k = 1 - (1 - t) ** 2;
  spirits(fx, e.x, e.y + k * 0.6, e.z, e.a * 0.4, 3, e.seed + t, 0.3 * (1 - t * 0.5), 1 - t);
}

export const hex: AreaLook = {
  live(fx, a, x, z, charge) {
    if (a.delay > 0)
      curseMark(fx, x, z, a.radius, 0.35 + charge * 0.65, -charge * 1.2 + seedOf(a.id));
  },
  strike(fx, a, x, z) {
    fx.echoes.add(drawHex, 0.34, x, fx.ground.heightAt(x, z), z, a.radius, 1);
    fx.decals.stamp(Decal.scorch, x, z, a.radius * 0.7, 0.7, ghost.soot, 0.5, ghost.glow, 0);
  },
};

/** A dark wave rolls out to the nova's edge and throws spirits outward. */
function drawNightShade(fx: Fx, e: Echo, t: number): void {
  const grow = 1 - (1 - t) ** 3;
  const fade = 1 - t * t;
  shadowDisc(fx, e.x, e.z, e.a * (0.35 + 0.7 * grow), 0.75 * fade);
  dome(fx, e.x, e.z, e.a * (0.35 + 0.65 * grow), 0.45, 0.6 * fade, e.seed);
  fx.decals
    .put(Decal.ring, e.x, e.z, e.a)
    .tint(ghost.glow, fade, ghost.shade, 0.3)
    .args(t * 0.7, 0.2, 0.25);
  spirits(fx, e.x, e.y, e.z, e.a * (0.2 + 0.65 * grow), 6, e.seed, 0.32 * (1 - t * 0.4), fade);
  if (t < 0.25) fx.sprites.draw(flash, e.x, e.y + 0.5, e.z, 0.6, 1 - t / 0.25);
}

export const nightShade: AreaLook = {
  strike(fx, a, x, z) {
    fx.echoes.add(drawNightShade, 0.36, x, fx.ground.heightAt(x, z), z, a.radius);
  },
};

export const sludgeBomb: ShotLook = {
  launch(fx, x, y, z) {
    spray(fx, drip, x, y, z, 3, 1, 1, 0.08);
  },
  fly(fx, p, x, y, z) {
    const r = p.radius * 1.3;
    fx.sprites.draw(halo, x, y, z, r * 2, 0.45);
    fx.sprites.draw(goo, x, y, z, r, 1, 0, 0, 0, seedOf(p.id));
    fx.sprites.draw(goo, x - p.vx * 0.02, y + r * 0.35, z - p.vz * 0.02, r * 0.5, 1);
    // Where it will land: a small dark spot under the shell.
    shadowDisc(fx, x, z, 0.45, 0.45);
    for (let i = perFrame(fx, 16); i > 0; i--)
      fx.sprites.emit(drip, x, y - r * 0.5, z, p.vx * 0.2, 0, p.vz * 0.2, 0.08);
  },
  fade(fx, x, y, z) {
    spray(fx, drip, x, y, z, 5, 1.2, 1.5, 0.08);
  },
};

export const sludgeBurst: AreaLook = {
  strike(fx, a, x, z) {
    const h = fx.ground.heightAt(x, z);
    fx.echoes.add(drawShadowBurst, 0.28, x, h, z, a.radius, 0);
    // A goo puddle with glowing magenta bubbles that sinks away.
    fx.decals.stamp(Decal.scorch, x, z, a.radius * 0.8, 1.3, ghost.sludge, 1, ghost.glow, 0);
    spray(fx, drip, x, h + 0.25, z, 14, a.radius * 2, 3, 0.11);
    spray(fx, smogPuff, x, h + 0.3, z, 4, a.radius, 0.4, 0.3);
  },
};

export const nightmareVortex: AreaLook = {
  live(fx, a, x, z, charge) {
    smog.live!(fx, a, x, z, charge);
    const h = fx.ground.heightAt(x, z);
    if (a.delay <= 0)
      spirits(fx, x, h, z, a.radius * 0.6, 3, fx.time * 2.2, 0.32, Math.min(1, a.life / 0.25));
    const elapsed = a.maxLife - a.life;
    const f = FIRESTORM;
    if (elapsed < f.jetFor) {
      const sx = x - a.dirX * a.length;
      const sz = z - a.dirZ * a.length;
      const half = f.jetWidth * a.scale;
      const fade = Math.min(1, (f.jetFor - elapsed) / 0.15);
      fx.decals
        .put(Decal.strip, sx, sz, a.length, Math.atan2(a.dirX, a.dirZ))
        .rect(-half * 1.3, 0, half * 1.3, a.length)
        .tint(ghost.ink, 0.9 * fade, ghost.glow, 0.3)
        .args(0, half, 1);
      for (let i = 0; i <= 14; i++) {
        const d = (a.length * i) / 14;
        const px = sx + a.dirX * d;
        const pz = sz + a.dirZ * d;
        fx.ribbons.point(
          px,
          fx.ground.heightAt(px, pz) + 0.45 + 0.1 * Math.sin(i - fx.time * 13),
          pz,
          half * 0.6 * fade,
          ghost.glow,
          0.85 * fade,
        );
      }
      fx.ribbons.flush(Ribbon.glow, 0.3);
      for (let i = perFrame(fx, 16 * fade); i > 0; i--) {
        const d = Math.random() * a.length;
        const px = sx + a.dirX * d;
        const pz = sz + a.dirZ * d;
        fx.sprites.emit(
          trail,
          px,
          fx.ground.heightAt(px, pz) + 0.4,
          pz,
          a.dirX * 2,
          0.3,
          a.dirZ * 2,
          half * 0.7,
        );
      }
    } else if (a.delay <= 0) {
      // The sim hits discrete discs at each step, rather than a continuously swept spiral.
      const step = Math.floor((elapsed - f.jetFor) / f.spiralTick);
      const phase = (elapsed - f.jetFor) / f.spiralTick - step;
      const spin = step * f.spiralTick * f.spiralSpin;
      for (let arm = 0; arm < f.arms; arm++) {
        const angle = spin + (arm / f.arms) * Math.PI * 2;
        const out = a.radius + f.spiralReach * a.scale;
        const px = x + Math.cos(angle) * out;
        const pz = z + Math.sin(angle) * out;
        const r = f.spiralRadius * a.scale;
        const fade = 1 - phase;
        shadowDisc(fx, px, pz, r, 0.6 * fade);
        discEdge(fx, px, pz, r, ghost.glow, 0.8 * fade);
        fx.sprites.draw(
          spirit,
          px,
          fx.ground.heightAt(px, pz) + 0.3 + phase * 0.5,
          pz,
          0.34 * (1 - phase * 0.4),
          fade,
          0,
          0,
          0,
          arm * 0.3,
        );
      }
    }
  },
  strike(fx, a, x, z) {
    smog.strike!(fx, a, x, z);
  },
};

/** One veil beat: a dark disc on the ultimate's radius with spirits circling inside it. */
function drawVeil(fx: Fx, e: Echo, t: number): void {
  // Eases in and out so consecutive beats (0.4 s apart, 0.55 s long) read as one continuous night.
  const alpha = Math.min(1, t / 0.15) * Math.min(1, (1 - t) / 0.3);
  const open = e.b ? 1 - (1 - Math.min(1, t / 0.3)) ** 3 : 1;
  const r = e.a * (0.3 + 0.7 * open);
  shadowDisc(fx, e.x, e.z, r * 1.12, 0.62 * alpha);
  dome(fx, e.x, e.z, r, 0.8, 0.42 * alpha, e.seed);
  discEdge(fx, e.x, e.z, r, ghost.glow, 0.8 * alpha);
  if (e.b) {
    for (let i = 0; i < 4; i++)
      groundArc(
        fx,
        e.x,
        e.z,
        r * 0.62,
        e.seed - t * 2 + (i * Math.PI) / 2,
        1.05,
        0.08,
        0.1,
        ghost.glow,
        alpha,
      );
  }
  spirits(fx, e.x, e.y, e.z, r * 0.68, 6, e.seed + fx.time * 1.4, 0.4, alpha);
}

/** Spirits converge on the caster, then the night bursts out to its edge. */
function drawPhantomBlast(fx: Fx, e: Echo, t: number): void {
  if (t < 0.35) {
    const k = t / 0.35;
    spirits(fx, e.x, e.y, e.z, e.a * 0.8 * (1 - k * k), 8, e.seed + k * 2, 0.42, 1);
    shadowDisc(fx, e.x, e.z, e.a, 0.6);
    return;
  }
  drawShadowBurst(fx, e, (t - 0.35) / 0.65);
}

/** A spirit strike: it lands with a short dark trail from above and a burst on its disc. */
function drawSpiritDive(fx: Fx, e: Echo, t: number): void {
  const fall = Math.min(1, t / 0.2);
  const lift = 2.6 * (1 - fall);
  fx.ribbons.point(
    e.x - Math.sin(fx.viewYaw) * 1.4,
    e.y + 3,
    e.z - Math.cos(fx.viewYaw) * 1.4,
    0.05,
    ghost.shade,
    0,
  );
  fx.ribbons.point(e.x, e.y + 0.4 + lift, e.z, 0.3 * (1 - t), ghost.glow, 1 - t);
  fx.ribbons.flush(Ribbon.streak, 0.3);
  fx.sprites.draw(
    spirit,
    e.x,
    e.y + 0.4 + lift,
    e.z,
    0.45 * (1 - t * 0.5),
    1 - t * t,
    0,
    0,
    0,
    e.seed,
  );
  drawShadowBurst(fx, e, t);
}

export function phantomNight(fx: Fx, e: UltPulseEvent): void {
  const h = fx.ground.heightAt(e.x, e.z);
  switch (e.look) {
    case "ring":
      fx.echoes.add(drawVeil, 0.55, e.x, h, e.z, e.radius, 1);
      fx.echoes.add(drawShadowBurst, 0.3, e.x, h, e.z, e.radius, 0);
      return;
    case "embers":
      fx.echoes.add(drawVeil, 0.55, e.x, h, e.z, e.radius, 0);
      return;
    case "blast":
      fx.echoes.add(drawPhantomBlast, 0.5, e.x, h, e.z, e.radius, 0);
      fx.decals.stamp(Decal.scorch, e.x, e.z, e.radius * 0.7, 1, ghost.soot, 0.55, ghost.glow, 0);
      return;
    default:
      fx.echoes.add(drawSpiritDive, 0.34, e.x, h, e.z, e.radius, 1);
      fx.decals.stamp(Decal.scorch, e.x, e.z, e.radius * 0.7, 0.8, ghost.soot, 0.5, ghost.glow, 0);
  }
}

/** Short split silhouette on the real evade event; no change to movement or collision. */
export function shadowPhase(fx: Fx, x: number, z: number): void {
  const y = fx.ground.heightAt(x, z) + 0.55;
  for (let i = -1; i <= 1; i += 2) fx.sprites.emit(trail, x, y, z, i * 1.8, 0.2, 0, 0.32);
}
