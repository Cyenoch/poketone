// A player's lasting states drawn on their body (skill-vfx): the shield bubble and its break, the
// ultimate's protection ring and motes, the partner bond's hearts and the revive beat. Support colours only.

import { Decal } from "./decals";
import { groundArc } from "./line-shapes";
import { rand, type Echo, type Fx } from "./fx";
import { buffCue, healCue } from "./items";
import { gold, powder, water, white } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";

const bubble = sprite({
  shape: Shape.bubble,
  from: water.foam,
  accent: water.light,
  alpha: 0.85,
});
const shard = sprite({
  shape: Shape.shard,
  life: 0.45,
  grow: 0.5,
  from: water.foam,
  to: water.light,
  accent: white,
  add: 0.5,
  gravity: 9,
  drag: 1.5,
  spin: 10,
});
const breakFlash = sprite({
  shape: Shape.ring,
  life: 0.25,
  grow: 1.8,
  from: water.foam,
  accent: white,
  add: 0.8,
});
const protectMote = sprite({
  shape: Shape.star,
  life: 0.6,
  grow: 0.3,
  from: gold.white,
  to: gold.yellow,
  accent: white,
  add: 1,
  gravity: -2.5,
  drag: 1.5,
  spin: 3,
});
const heart = sprite({
  shape: Shape.heart,
  life: 0.8,
  grow: 0.35,
  from: powder.pink,
  accent: white,
  gravity: -1.6,
  drag: 2.5,
});
const reviveFlash = sprite({
  shape: Shape.glow,
  life: 0.35,
  grow: 1.6,
  from: white,
  to: gold.white,
  accent: white,
  add: 1,
});
const reviveStar = sprite({
  shape: Shape.star,
  life: 0.3,
  grow: 2,
  from: gold.white,
  accent: white,
  add: 1,
  spin: 2,
});
const reviveFall = sprite({
  shape: Shape.star,
  life: 0.7,
  grow: 0.2,
  from: white,
  to: gold.yellow,
  accent: white,
  add: 1,
  gravity: 3,
  drag: 1.2,
  spin: 4,
});
const reviveShard = sprite({
  shape: Shape.gem,
  life: 0.55,
  grow: 0.4,
  from: gold.yellow,
  to: gold.white,
  accent: white,
  add: 0.5,
  gravity: 7,
  drag: 1.5,
  stretch: -1,
});

/** A thin bubble round the body while shield HP lasts; `k` fades it in and out. */
export function shieldBubble(fx: Fx, x: number, z: number, height: number, k: number): void {
  const h = fx.ground.heightAt(x, z);
  const wobble = 1 + 0.03 * Math.sin(fx.time * 5);
  fx.sprites.draw(bubble, x, h + height * 0.5, z, height * 0.72 * wobble, k);
}

/** The shield's last point gone: the bubble cracks into falling shards with a pale flash. */
export function shieldBreak(fx: Fx, x: number, z: number, height: number): void {
  const h = fx.ground.heightAt(x, z);
  const y = h + height * 0.5;
  fx.sprites.emit(breakFlash, x, y, z, 0, 0, 0, height * 0.75);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rand(-0.2, 0.2);
    const up = rand(-0.6, 0.8);
    fx.sprites.emit(
      shard,
      x + Math.cos(a) * height * 0.6,
      y + up * height * 0.5,
      z + Math.sin(a) * height * 0.6,
      Math.cos(a) * rand(2, 3.5),
      rand(1, 3),
      Math.sin(a) * rand(2, 3.5),
      rand(0.08, 0.13),
      h,
    );
  }
}

/** The ultimate's protection blinks through its last this many seconds. */
export const PROTECTION_WARN = 1.2;

/**
 * How strongly the ultimate's protection shows with `left` seconds of it: full, then through the last
 * `PROTECTION_WARN` seconds a hard on/off blink that quickens, so the player sees it is about to drop.
 * Shared by the body rim (createRunView.ts) and the ground mark here so both blink together.
 */
export function protectionLevel(left: number): number {
  if (left <= 0) return 0;
  if (left > PROTECTION_WARN) return 1;
  return Math.sin((PROTECTION_WARN - left) ** 1.6 * 40) > 0 ? 1 : 0.1;
}

/**
 * The ground half of the ultimate's protection, at `level` (protectionLevel): a thin pale-gold ring
 * just outside the seat ring with two bright arcs turning on it, and gold motes rising off the body.
 * Warm and edged where the shield is a pale blue dome, and thin so the crowd around stays readable.
 */
export function protectionMark(
  fx: Fx,
  x: number,
  z: number,
  radius: number,
  height: number,
  level: number,
): void {
  const reach = Math.max(1.05, radius * 2.2);
  fx.decals
    .put(Decal.ring, x, z, reach)
    .tint(gold.yellow, 0.95 * level, gold.deep, 0.2)
    .args(0, 0.08, 1);
  // Each arc is white over a deep-gold band, so it holds on grass, sand and snow alike.
  const spin = fx.time * 1.6;
  for (let i = 0; i < 2; i++) {
    const from = spin + i * Math.PI;
    groundArc(fx, x, z, reach - 0.03, from, 1.3, 0.05, 0.22, gold.deep, 0.8 * level);
    groundArc(fx, x, z, reach - 0.03, from, 1.3, 0.06, 0.1, white, level);
  }
  if (Math.random() > fx.dt * 16 * level) return;
  const a = rand(0, Math.PI * 2);
  fx.sprites.emit(
    protectMote,
    x + Math.cos(a) * radius * 0.9,
    fx.ground.heightAt(x, z) + height * rand(0.1, 0.7),
    z + Math.sin(a) * radius * 0.9,
    0,
    rand(1, 2),
    0,
    rand(0.08, 0.12),
  );
}

/** The partner bond held the player up (endure) or cleared their status (cure): the buff or heal cue, with hearts. */
export function bondCue(
  fx: Fx,
  kind: "endure" | "cure",
  x: number,
  z: number,
  radius: number,
  height: number,
): void {
  if (kind === "endure") buffCue(fx, x, z, radius, height);
  else healCue(fx, x, z, radius, 0);
  const h = fx.ground.heightAt(x, z);
  for (let i = 0; i < 3; i++) {
    const side = i - 1;
    fx.sprites.emit(
      heart,
      // Above the health bar (form height + 0.1), so none passes behind it.
      x + side * radius * 1.3,
      h + height + 0.45 + 0.15 * (1 - Math.abs(side)),
      z,
      side * 0.8,
      1.1,
      0,
      kind === "endure" ? 0.3 : 0.27,
    );
  }
}

const REVIVE_COLUMN = 5;

/**
 * Back on their feet: everything peaks on the event frame (the sound's hit): a white flash and star at
 * the body, a gold ring and light column that narrow away, and sparkles falling back down onto them.
 */
export function revive(fx: Fx, x: number, z: number, radius: number, height: number): void {
  const h = fx.ground.heightAt(x, z);
  fx.sprites.emit(reviveFlash, x, h + height * 0.5, z, 0, 0, 0, Math.max(1, height * 1.1));
  fx.sprites.emit(reviveStar, x, h + height * 0.6, z, 0, 0, 0, Math.max(0.7, height * 0.6));
  fx.decals.stamp(Decal.ring, x, z, radius * 4 + 1, 0.55, gold.yellow, 1, white, 0.9, 0.12, 0.15);
  fx.decals.stamp(Decal.glow, x, z, radius * 2 + 0.8, 0.8, gold.white, 0.9, gold.yellow, 1);
  fx.echoes.add(drawReviveColumn, 0.7, x, h, z);
  for (let i = 0; i < 18; i++) {
    const a = rand(0, Math.PI * 2);
    const d = radius * rand(0.3, 1.4);
    fx.sprites.emit(
      reviveFall,
      x + Math.cos(a) * d,
      h + height + rand(1, 2.5),
      z + Math.sin(a) * d,
      0,
      rand(-1, 0.5),
      0,
      rand(0.08, 0.14),
      h,
    );
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    fx.sprites.emit(
      reviveShard,
      x,
      h + height * 0.6,
      z,
      Math.cos(a) * 3,
      rand(2, 4),
      Math.sin(a) * 3,
      0.12,
      h,
    );
  }
}

function drawReviveColumn(fx: Fx, echo: Echo, t: number): void {
  const width = 1.1 * (1 - t) ** 1.5;
  for (const [w, colour, alpha] of [
    [width, gold.yellow, 0.7],
    [width * 0.4, white, 1],
  ] as const) {
    for (let i = 0; i <= 6; i++) {
      const k = i / 6;
      fx.ribbons.point(
        echo.x,
        echo.y + k * REVIVE_COLUMN,
        echo.z,
        w * (1 - 0.5 * k),
        colour,
        alpha * (1 - k * 0.85) * (1 - t),
      );
    }
    fx.ribbons.flush(Ribbon.glow, 1);
  }
}
