// Item trigger looks. Bursts and strikes reuse the ultimate pulse drawers (their shape and size are
// the hitbox: `radius` is the sim's). The heal cue marks a rule-based heal (sitrus, lum, berry juice,
// leaf stone): a gold-green ring at the feet and leaves rising off the body, sized by the share of max
// HP restored; no column (level-up, evolve) and no line from an enemy (drain). The buff cue marks a
// timed buff switching on (smoke ball, adrenaline orb, metal powder, shed shell, poké flute): white
// streaks running up the body, the games' stat-up read, with a thin ring hugging the feet.

import type { RunEvent } from "../../sim/state/events";
import { Decal } from "./decals";
import { rand, type Fx } from "./fx";
import { gold, grass, white, wind } from "./palette";
import { Shape, sprite } from "./sprites";
import { ultPulse } from "./ultimates";

export function itemBurst(fx: Fx, event: Extract<RunEvent, { t: "item-burst" }>): void {
  ultPulse(fx, { ...event, t: "ult-pulse" });
}

const leafUp = sprite({
  shape: Shape.leaf,
  life: 0.6,
  grow: 0.2,
  from: grass.light,
  to: gold.white,
  accent: grass.leaf,
  add: 0.35,
  drag: 2.5,
});
const glint = sprite({
  shape: Shape.star,
  life: 0.45,
  grow: 0.4,
  from: gold.white,
  to: grass.light,
  accent: white,
  add: 0.6,
  drag: 2,
});

/** `share` of max HP healed at (x, z) on a body of `radius`; peaks in the first 0.1 s. */
export function healCue(fx: Fx, x: number, z: number, radius: number, share: number): void {
  const h = fx.ground.heightAt(x, z);
  const big = Math.min(1, share / 0.3);
  fx.decals.stamp(
    Decal.ring,
    x,
    z,
    radius * (1.3 + big),
    0.35,
    grass.light,
    0.85,
    gold.white,
    0.5,
    0.1,
    0.5,
  );
  const leaves = 3 + Math.round(big * 4);
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rand(-0.3, 0.3);
    const d = radius * rand(0.5, 1);
    fx.sprites.emit(
      leafUp,
      x + Math.cos(a) * d,
      h + rand(0.2, 0.6),
      z + Math.sin(a) * d,
      Math.cos(a) * 0.4,
      rand(1.4, 2.4),
      Math.sin(a) * 0.4,
      0.14 + 0.05 * big,
    );
  }
  fx.sprites.emit(glint, x, h + 1, z, 0, 1.2, 0, 0.22 + 0.1 * big);
}

const statUp = sprite({
  shape: Shape.spark,
  life: 0.35,
  grow: 0.5,
  from: white,
  to: gold.white,
  accent: white,
  add: 0.7,
  drag: 1.5,
  stretch: 0.06,
});

/** A buff switched on for a body of `radius` and `height` at (x, z): short and small, it fires often. */
export function buffCue(fx: Fx, x: number, z: number, radius: number, height: number): void {
  const h = fx.ground.heightAt(x, z);
  fx.decals.stamp(Decal.ring, x, z, radius * 1.35, 0.3, white, 0.8, wind.cream, 0.4, 0.12, 0.7);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rand(-0.25, 0.25);
    const d = radius * rand(0.75, 1.05);
    fx.sprites.emit(
      statUp,
      x + Math.cos(a) * d,
      h + height * rand(0.1, 0.6),
      z + Math.sin(a) * d,
      0,
      rand(5, 7),
      0,
      rand(0.07, 0.1),
    );
  }
}
