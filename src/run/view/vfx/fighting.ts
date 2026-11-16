// Machop line (skill-vfx): warm amber force with cream edges, inked fists and ochre ground dust. Each
// combo move keeps one silhouette (blade, chop, X, fists) so the four read apart at a glance.

import { COMBO } from "../../sim/content/params/archetypes";
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
import { fighting } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";
import { place } from "./volumes";

const fist = sprite({ shape: Shape.fist, from: fighting.cream, accent: fighting.amber });
const halo = sprite({
  shape: Shape.glow,
  from: fighting.amber,
  accent: fighting.cream,
  alpha: 0.5,
  add: 1,
});
const spark = sprite({
  shape: Shape.spark,
  life: 0.18,
  grow: 0.1,
  from: fighting.cream,
  to: fighting.amber,
  accent: fighting.amber,
  drag: 6,
  stretch: 0.04,
});
const bang = sprite({
  shape: Shape.star,
  life: 0.14,
  grow: 0.5,
  from: fighting.amber,
  to: fighting.ochre,
  accent: fighting.cream,
  add: 0.2,
});
const chip = sprite({
  shape: Shape.shard,
  life: 0.27,
  grow: 0.25,
  from: fighting.dust,
  to: fighting.deep,
  accent: fighting.ochre,
  gravity: 10,
  drag: 4,
  spin: 8,
});
const pebble = sprite({
  shape: Shape.ball,
  life: 0.35,
  grow: 0.6,
  from: fighting.dust,
  to: fighting.ochre,
  accent: fighting.deep,
  gravity: 12,
  drag: 3,
});
const dust = sprite({
  shape: Shape.puff,
  life: 0.25,
  grow: 0.7,
  from: fighting.dust,
  to: fighting.deep,
  accent: fighting.ochre,
  alpha: 0.35,
  drag: 4,
});
const cloud = sprite({
  shape: Shape.puff,
  life: 0.45,
  grow: 1,
  from: fighting.cream,
  to: fighting.dust,
  accent: fighting.ochre,
  alpha: 0.6,
  drag: 4,
  gravity: -0.4,
});

/** A blade of ribbon from (ax, ay, az) to (bx, by, bz): thick in the middle, cream over amber. */
function blade(
  fx: Fx,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  width: number,
  alpha: number,
): void {
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      const w = width * Math.sin(k * Math.PI) * (layer ? 0.45 : 1);
      fx.ribbons.point(
        ax + (bx - ax) * k,
        ay + (by - ay) * k,
        az + (bz - az) * k,
        w,
        layer ? fighting.cream : fighting.amber,
        alpha,
      );
    }
    fx.ribbons.flush(Ribbon.solid, layer ? 0.3 : 0.1);
  }
}

/** Silhouette per combo move; the echo's `c` holds the index, plus 0.5 on the finisher. */
const punchKinds = ["karate-chop", "brick-break", "cross-chop", "hundred-fists"] as const;

/**
 * One punch, from its landing frame: the sector fills, the move's silhouette strikes through its
 * first 30 % and hangs, then the whole punch fades (the finisher hangs longer). `a` is the locked yaw,
 * `b` the reach (negative on odd punches, which swing from the other side).
 */
function drawPunch(fx: Fx, e: Echo, t: number): void {
  const kind = Math.floor(e.c);
  const finisher = e.c - kind > 0.25;
  const yaw = e.a;
  const length = Math.abs(e.b);
  const from = e.b < 0 ? 1 : -1;
  const angle = COMBO.angle;
  const dirX = Math.sin(yaw);
  const dirZ = Math.cos(yaw);
  const strike = 1 - (1 - Math.min(1, t / 0.3)) ** 3;
  const fade = (1 - Math.max(0, (t - (finisher ? 0.4 : 0.25)) / (finisher ? 0.6 : 0.75))) ** 2;
  const y = e.y + 0.55;
  const side = length * Math.sin(angle);
  fx.decals
    .put(Decal.sector, e.x, e.z, length, yaw, e.seed)
    .rect(-side, 0, side, length)
    .tint(fighting.amber, 0.7 * fade, fighting.cream, 0.15)
    .args(0, angle, 0);
  // The fan's body above the grass: two swept amber bands and a cream rim at full reach.
  for (let band = 0; band < 2; band++)
    groundArc(
      fx,
      e.x,
      e.z,
      length * (0.5 + band * 0.25),
      yaw - from * angle * (1 - 2 * strike),
      from * angle * 2 * strike,
      0.2,
      length * 0.2 * fade,
      fighting.amber,
      0.85 * fade,
    );
  groundArc(
    fx,
    e.x,
    e.z,
    length * 0.96,
    yaw - angle,
    angle * 2,
    0.2,
    (finisher ? 0.22 : 0.15) * fade,
    fighting.cream,
    fade,
  );
  const d = length * 0.7;
  const px = e.x + dirX * d;
  const pz = e.z + dirZ * d;
  const span = length * 0.8;
  switch (kind) {
    case 0: {
      // Karate Chop: one wide crescent blade sweeping across the sector.
      const sweep = angle * 1.8;
      for (let layer = 0; layer < 2; layer++) {
        for (let i = 0; i <= 12; i++) {
          const k = i / 12;
          const a = yaw + from * (angle * 0.9 - sweep * strike * k);
          fx.ribbons.point(
            e.x + Math.sin(a) * d,
            y + 0.25 - 0.3 * k,
            e.z + Math.cos(a) * d,
            (layer ? 0.09 : 0.28) * Math.sin(k * Math.PI) * fade,
            layer ? fighting.cream : fighting.amber,
            fade,
          );
        }
        fx.ribbons.flush(Ribbon.solid, layer ? 0.3 : 0.1);
      }
      break;
    }
    case 1: {
      // Brick Break: a vertical chop dropping onto the front of the sector.
      const top = y + 1.4 * (1 - strike) + 0.25;
      blade(fx, px, top + 0.7, pz, px, top - 0.75 * strike, pz, 0.3 * fade, fade);
      fx.sprites.draw(fist, px, top + 0.1, pz, 0.5, fade);
      break;
    }
    case 2:
      // Cross Chop: two blades crossing into an X over the front of the sector.
      for (let n = -1; n <= 1; n += 2)
        blade(
          fx,
          px + dirZ * span * 0.5 * n,
          y + 0.9,
          pz - dirX * span * 0.5 * n,
          px - dirZ * span * 0.5 * n * strike,
          y + 0.9 - 1.1 * strike,
          pz + dirX * span * 0.5 * n * strike,
          0.3 * fade,
          fade,
        );
      break;
    default:
      // Hundred Fists: a spread of fists driving out over the sector, staggered.
      for (let n = 0; n < 4; n++) {
        const spread = (n - 1.5) * 0.4 * angle + from * 0.1;
        const reach = length * (0.3 + 0.55 * (1 - (1 - Math.min(1, (t + n * 0.05) / 0.35)) ** 3));
        const sx = Math.sin(yaw + spread);
        const sz = Math.cos(yaw + spread);
        const fy = y + (n % 2) * 0.2;
        fx.ribbons.point(e.x + sx * 0.3, fy, e.z + sz * 0.3, 0.02, fighting.ochre, 0);
        fx.ribbons.point(
          e.x + sx * reach,
          fy,
          e.z + sz * reach,
          0.22 * fade,
          fighting.cream,
          0.9 * fade,
        );
        fx.ribbons.flush(Ribbon.streak, 0.15);
        fx.sprites.draw(fist, e.x + sx * reach, fy, e.z + sz * reach, 0.42, fade);
      }
  }
}

/** All punches share the sim's locked heading, active sector and final-beat marker. */
export const combo: AreaLook = {
  live(fx, a, x, z) {
    // Each later punch cues only its own 80 ms startup, not the whole queued delay.
    if (a.delay <= 0 || a.delay > COMBO.delay) return;
    const charge = 1 - a.delay / COMBO.delay;
    const y = fx.ground.heightAt(x, z) + 0.55;
    fx.sprites.draw(fist, x + a.dirX * 0.45, y, z + a.dirZ * 0.45, 0.2 + charge * 0.2, charge);
  },
  strike(fx, a, x, z) {
    const finisher = a.released === a.count - 1;
    const kind = Math.max(0, punchKinds.indexOf(a.move as (typeof punchKinds)[number]));
    const h = fx.ground.heightAt(x, z);
    // Hundred Fists recasts every 0.8 s with four punches: short echoes keep casts from stacking up.
    const life = kind === 3 ? 0.22 : 0.32;
    fx.echoes.add(
      drawPunch,
      finisher ? life + 0.1 : life,
      x,
      h,
      z,
      Math.atan2(a.dirX, a.dirZ),
      a.length * (a.released % 2 ? -1 : 1),
      kind + (finisher ? 0.5 : 0),
    );
    const px = x + a.dirX * a.length * 0.7;
    const pz = z + a.dirZ * a.length * 0.7;
    const ph = fx.ground.heightAt(px, pz);
    fx.sprites.emit(bang, px, ph + 0.5, pz, 0, 0, 0, finisher ? 0.8 : 0.55);
    spray(fx, spark, px, ph + 0.45, pz, finisher ? 7 : 4, 2, 0.8, 0.08);
    spray(fx, dust, px, ph + 0.15, pz, 4, 1.4, 0.3, 0.2);
    if (finisher) {
      fx.decals.stamp(
        Decal.cracks,
        px,
        pz,
        a.length * 0.32,
        0.6,
        fighting.amber,
        1,
        fighting.deep,
        0,
      );
      if (a.move === "brick-break") spray(fx, pebble, px, ph + 0.35, pz, 8, 1.8, 2.6, 0.09);
    }
  },
};

export const lowSweep: AreaLook = {
  live(fx, a, x, z) {
    const fade = Math.min(1, a.life / 0.15);
    discEdge(fx, x, z, a.radius, fighting.ochre, 0.5 * fade);
    const turn = (a.maxLife - a.life) * Math.PI * 5;
    groundArc(
      fx,
      x,
      z,
      a.radius * 0.94,
      turn,
      Math.PI * 1.65,
      0.15,
      0.13 * fade,
      fighting.cream,
      0.75 * fade,
    );
    for (let i = perFrame(fx, 14 * fade); i > 0; i--)
      fx.sprites.emit(
        dust,
        x + Math.sin(turn) * a.radius * 0.8,
        fx.ground.heightAt(x, z) + 0.12,
        z + Math.cos(turn) * a.radius * 0.8,
        Math.cos(turn) * 0.7,
        0.3,
        -Math.sin(turn) * 0.7,
        0.16,
      );
  },
  strike(fx, _a, x, z) {
    fx.sprites.emit(spark, x, fx.ground.heightAt(x, z) + 0.3, z, 0, 0, 0, 0.2);
  },
};

export const focusBlast: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(bang, x, y, z, 0, 0, 0, 0.4);
  },
  fly(fx, p, x, y, z) {
    const r = p.radius * 1.2;
    fx.volumes.orbs.add(
      place(x, y, z, fx.time * 5, r, r, r),
      fighting.amber,
      1,
      fighting.ochre,
      1,
      seedOf(p.id),
    );
    fx.sprites.draw(halo, x, y, z, r * 2.6, 0.5);
    const speed = Math.hypot(p.vx, p.vz) || 1;
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      const d = k * 0.8;
      fx.ribbons.point(
        x - (p.vx / speed) * d,
        y,
        z - (p.vz / speed) * d,
        r * (1 - k),
        k < 0.3 ? fighting.cream : fighting.amber,
        0.8 * (1 - k),
      );
    }
    fx.ribbons.flush(Ribbon.streak, 0.3);
    for (let i = perFrame(fx, 20); i > 0; i--)
      fx.sprites.emit(
        spark,
        x,
        y,
        z,
        -p.vx * 0.06 + rand(-1, 1),
        rand(-0.5, 1),
        -p.vz * 0.06 + rand(-1, 1),
        0.07,
      );
  },
  fade(fx, x, y, z) {
    spray(fx, dust, x, y, z, 3, 0.5, 0.3, 0.12);
  },
};

function drawSlam(fx: Fx, e: Echo, t: number): void {
  const fade = (1 - Math.max(0, (t - 0.15) / 0.85)) ** 2;
  discEdge(fx, e.x, e.z, e.a, fighting.amber, 0.85 * fade);
  const turn = e.seed;
  for (let arm = 0; arm < (e.b ? 8 : 4); arm++) {
    const angle = turn + (arm * Math.PI * 2) / (e.b ? 8 : 4);
    for (let i = 0; i <= 3; i++) {
      const k = i / 3;
      const d = e.a * (0.25 + k * 0.65);
      const x = e.x + Math.sin(angle) * d;
      const z = e.z + Math.cos(angle) * d;
      fx.ribbons.point(
        x,
        fx.ground.heightAt(x, z) + 0.18 + 0.12 * Math.sin(k * Math.PI),
        z,
        (0.09 + (e.b ? 0.05 : 0)) * fade * Math.sin(k * Math.PI),
        fighting.cream,
        0.8 * fade,
      );
    }
    fx.ribbons.flush(Ribbon.streak, 0.1);
  }
  fx.decals
    .put(Decal.cracks, e.x, e.z, e.a * 0.86, turn, e.seed)
    .tint(fighting.deep, 0.45 * fade, fighting.ochre, 0)
    .args(t);
}

export const seismicToss: AreaLook = {
  strike(fx, a, x, z) {
    fx.echoes.add(drawSlam, 0.28, x, fx.ground.heightAt(x, z), z, a.radius, 1);
    spray(fx, chip, x, fx.ground.heightAt(x, z) + 0.2, z, 10, a.radius * 2, 2.5, 0.1);
    fx.decals.stamp(
      Decal.cracks,
      x,
      z,
      a.radius * 0.85,
      0.7,
      fighting.deep,
      0.3,
      fighting.ochre,
      0,
    );
  },
};

/** A shockwave: an amber ring racing to the edge over a warm flash. */
function drawShock(fx: Fx, e: Echo, t: number): void {
  const fade = (1 - t) ** 2;
  fx.decals
    .put(Decal.glow, e.x, e.z, e.a * 1.1)
    .tint(fighting.amber, 0.5 * fade, fighting.cream, 1);
  fx.decals
    .put(Decal.ring, e.x, e.z, e.a)
    .tint(fighting.cream, 1 - t, fighting.amber, 0.4)
    .args(t * 0.8, 0.2, 0.3);
  discEdge(fx, e.x, e.z, e.a, fighting.amber, fade);
}

export const focusBurst: AreaLook = {
  strike(fx, a, x, z) {
    const h = fx.ground.heightAt(x, z);
    fx.echoes.add(drawShock, 0.3, x, h, z, a.radius);
    fx.echoes.add(drawSlam, 0.25, x, h, z, a.radius);
    fx.sprites.emit(bang, x, h + 0.5, z, 0, 0, 0, 0.9);
    spray(fx, spark, x, h + 0.4, z, 12, a.radius * 3, 1, 0.1);
    dustRing(fx, x, h, z, a.radius, 8);
  },
};

/** Dust kicked out at a ring's edge. */
function dustRing(fx: Fx, x: number, h: number, z: number, r: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    fx.sprites.emit(
      cloud,
      x + Math.sin(a) * r * 0.9,
      h + 0.15,
      z + Math.cos(a) * r * 0.9,
      Math.sin(a) * 1.5,
      0.4,
      Math.cos(a) * 1.5,
      rand(0.3, 0.42),
    );
  }
}

/** One quake beat: two fists slam inside the disc while its shockwave runs to the edge. */
function drawQuake(fx: Fx, e: Echo, t: number): void {
  drawShock(fx, e, t);
  const drop = Math.min(1, t / 0.3);
  for (let n = 0; n < (e.b ? 4 : 2); n++) {
    const angle = e.seed + (n * Math.PI * 2) / (e.b ? 4 : 2);
    const d = e.b ? e.a * 0.55 * (1 - drop) : e.a * 0.45;
    const px = e.x + Math.sin(angle) * d;
    const pz = e.z + Math.cos(angle) * d;
    const py = fx.ground.heightAt(px, pz) + 0.7 + 1.8 * (1 - drop) ** 2;
    const fade = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
    fx.sprites.draw(fist, px, py, pz, (e.b ? 1.1 : 0.85) * (0.8 + 0.2 * drop), fade);
  }
}

export function seismicBarrage(fx: Fx, e: UltPulseEvent): void {
  const heavy = e.look === "blast";
  const h = fx.ground.heightAt(e.x, e.z);
  // 0.32 s beats overlap the 0.22 s pulse spacing so the cast never has a dead frame.
  fx.echoes.add(drawQuake, heavy ? 0.45 : 0.32, e.x, h, e.z, e.radius, heavy ? 1 : 0);
  fx.decals.stamp(
    Decal.cracks,
    e.x,
    e.z,
    e.radius * (heavy ? 1 : 0.8),
    heavy ? 1.4 : 0.6,
    fighting.amber,
    1,
    fighting.deep,
    0,
  );
  fx.sprites.emit(bang, e.x, h + 0.5, e.z, 0, 0, 0, heavy ? 1.4 : 0.8);
  dustRing(fx, e.x, h, e.z, e.radius, heavy ? 14 : 8);
  if (heavy) {
    fx.echoes.add(drawShock, 0.5, e.x, h, e.z, e.radius * 0.6);
    spray(fx, pebble, e.x, h + 0.3, e.z, 14, e.radius * 2, 3, 0.11);
  }
}
