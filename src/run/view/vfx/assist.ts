// Trainer items (skill-vfx): the trainer, off screen behind the camera, lobs the item over the
// player; it pops overhead on the key frame (`ASSIST_POP`, where the sound's hit lands), a ring the
// size of the sim's reach (`TRAINER.radius`) runs out on the ground and every teammate it reached
// gets the item's own read. Support colours only: no red, no danger rims, no candy-blue ground blobs.
// Who it reached is the sim's list (the event's `to`), drawn where those bodies stand on the pop
// frame; nothing is written back.

import { TRAINER } from "../../sim/content/params/trainers";
import type { AssistItem } from "../../sim/content/trainers";
import { Decal } from "./decals";
import { perFrame, rand, type Echo, type Fx } from "./fx";
import { rgb, type Rgb } from "./gl";
import { healCue } from "./items";
import { gold, white, wind } from "./palette";
import { Shape, sprite, type SpriteSpec } from "./sprites";

/** Seconds from the event to the pop overhead: the throw's arc, and the sound's key frame. */
export const ASSIST_POP = 0.24;
const LIFE = ASSIST_POP + 0.05;
/** Where the lob starts: towards the camera from the player, and how high it peaks over them. */
const THROW_BACK = 3.2;
const APEX = 1.1;

const ITEMS: readonly AssistItem[] = ["xSpeed", "superPotion", "direHit", "fullHeal"];
/** Each item's body colour (its bottle in the icon) and its light. */
const LOOK: Record<AssistItem, { body: Rgb; light: Rgb }> = {
  xSpeed: { body: rgb("#5cc8f2"), light: rgb("#e3f7ff") },
  superPotion: { body: rgb("#ffb43c"), light: rgb("#fff1c9") },
  direHit: { body: rgb("#ff9a3a"), light: rgb("#ffe7c4") },
  fullHeal: { body: rgb("#ffd84a"), light: rgb("#fffbe0") },
};

const flask = ITEMS.map((id) =>
  sprite({ shape: Shape.drop, from: LOOK[id].body, accent: LOOK[id].light, stretch: -1 }),
);
const trail = ITEMS.map((id) =>
  sprite({
    shape: Shape.spark,
    life: 0.18,
    grow: 0.2,
    from: LOOK[id].light,
    to: LOOK[id].body,
    accent: white,
    add: 0.6,
  }),
);
const pop = ITEMS.map((id) =>
  sprite({
    shape: Shape.star,
    life: 0.3,
    grow: 1.6,
    from: white,
    accent: LOOK[id].light,
    add: 0.8,
  }),
);
const speedLine = sprite({
  shape: Shape.spark,
  life: 0.32,
  grow: 0.4,
  from: white,
  to: wind.cyan,
  accent: white,
  add: 0.7,
  drag: 1.5,
  stretch: 0.07,
});
const focusSpark = sprite({
  shape: Shape.spark,
  life: 0.26,
  grow: 0.3,
  from: gold.white,
  to: gold.yellow,
  accent: white,
  add: 0.8,
  stretch: 0.05,
});
const focusStar = sprite({
  shape: Shape.star,
  life: 0.35,
  grow: 0.6,
  from: gold.yellow,
  accent: white,
  add: 0.7,
});
const auraMote = ITEMS.map((id) =>
  sprite({
    shape: Shape.glow,
    life: 0.8,
    grow: 0.4,
    from: LOOK[id].light,
    to: LOOK[id].body,
    accent: white,
    add: 1,
    gravity: -1.5,
    drag: 1,
  }),
);
const cleanse = sprite({
  shape: Shape.bubble,
  life: 0.6,
  grow: 0.4,
  from: wind.cream,
  to: white,
  accent: gold.deep,
  alpha: 0.9,
  drag: 2,
});

/**
 * The item thrown for a player at (x, z). On the pop frame `targets` gives x, z, radius and height
 * of every teammate the sim reached, the thrower included, and `popped` runs once with how far that
 * frame is past the pop (seconds): the sound's key frame. A throw cleared before it pops never calls it.
 */
export function trainerAssist(
  fx: Fx,
  item: AssistItem,
  x: number,
  z: number,
  reach: number,
  targets: () => readonly number[],
  popped: (late: number) => void,
): void {
  const draw = (fx: Fx, echo: Echo, t: number) => drawAssist(fx, echo, t, targets, popped);
  fx.echoes.add(draw, LIFE, x, fx.ground.heightAt(x, z), z, ITEMS.indexOf(item), reach, fx.viewYaw);
}

function drawAssist(
  fx: Fx,
  echo: Echo,
  t: number,
  targets: () => readonly number[],
  popped: (late: number) => void,
): void {
  const age = t * echo.life;
  const kind = echo.a;
  if (age < ASSIST_POP) {
    // A lob from the camera's side: up and over, landing above the player's head.
    const k = age / ASSIST_POP;
    const back = THROW_BACK * (1 - k);
    const x = echo.x + Math.sin(echo.c) * back;
    const z = echo.z + Math.cos(echo.c) * back;
    const y = echo.y + 0.6 + (APEX + 0.9) * Math.sin(k * Math.PI * 0.62) + 0.3 * k;
    fx.sprites.draw(flask[kind]!, x, y, z, 0.2, 1, 0, 0, k * 9, echo.seed);
    if (Math.random() < 0.7) fx.sprites.emit(trail[kind]!, x, y, z, 0, 0, 0, 0.08);
    return;
  }
  if (age - fx.dt >= ASSIST_POP) return;
  land(fx, echo, targets());
  popped(age - ASSIST_POP);
}

function land(fx: Fx, echo: Echo, p: readonly number[]): void {
  const kind = echo.a;
  const item = ITEMS[kind]!;
  const { body, light } = LOOK[item];
  fx.sprites.emit(pop[kind]!, echo.x, echo.y + APEX + 1.2, echo.z, 0, 0, 0, 0.5);
  // The reach: a ring that ends at the sim's radius, and a faint fill under it.
  fx.decals.stamp(Decal.ring, echo.x, echo.z, echo.b, 0.45, light, 0.9, body, 0.5, 0.12, 0.35);
  fx.decals.stamp(Decal.glow, echo.x, echo.z, echo.b, 0.4, light, 0.35, body, 0.6);
  for (let i = 0; i + 3 < p.length; i += 4) {
    const x = p[i]!,
      z = p[i + 1]!,
      radius = p[i + 2]!,
      height = p[i + 3]!;
    if (item === "superPotion") healCue(fx, x, z, radius, TRAINER.superPotion.hp);
    else if (item === "xSpeed") rise(fx, speedLine, x, z, radius, height, 8, 7);
    else if (item === "direHit") focus(fx, x, z, radius, height);
    else rise(fx, cleanse, x, z, radius, height, 6, 1.8);
  }
}

/** `n` sprites running up the body: the games' stat-up read. */
function rise(
  fx: Fx,
  spec: SpriteSpec,
  x: number,
  z: number,
  radius: number,
  height: number,
  n: number,
  speed: number,
): void {
  const h = fx.ground.heightAt(x, z);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
    const d = radius * rand(0.6, 1.05);
    fx.sprites.emit(
      spec,
      x + Math.cos(a) * d,
      h + height * rand(0.2, 0.7),
      z + Math.sin(a) * d,
      0,
      speed * rand(0.8, 1.2),
      0,
      rand(0.08, 0.12),
    );
  }
}

/** Sparks drawn in to the chest, then a glint: attention sharpening on the next hit. */
function focus(fx: Fx, x: number, z: number, radius: number, height: number): void {
  const y = fx.ground.heightAt(x, z) + height * 0.6;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const d = radius * 1.8;
    fx.sprites.emit(
      focusSpark,
      x + Math.cos(a) * d,
      y,
      z + Math.sin(a) * d,
      -Math.cos(a) * d * 4,
      0,
      -Math.sin(a) * d * 4,
      0.09,
    );
  }
  fx.sprites.emit(focusStar, x, y + height * 0.3, z, 0, 0.8, 0, 0.3);
}

/**
 * While a trainer item's buff lasts on a player: a pulse of its colour and a thin ring at their feet, and
 * motes of its light rising off them, fading out over its last second.
 */
export function assistAura(
  fx: Fx,
  item: Exclude<AssistItem, "superPotion">,
  x: number,
  z: number,
  radius: number,
  height: number,
  left: number,
): void {
  const k = Math.min(1, left);
  const { body, light } = LOOK[item];
  const pulse = 0.75 + 0.25 * Math.sin(fx.time * 5);
  // Outside the player's own seat ring (0.87 m), which would cover a body-sized ring.
  const reach = Math.max(1.2, radius * 2.4);
  fx.decals.put(Decal.glow, x, z, reach).tint(body, 0.45 * k * pulse, light, 1);
  fx.decals
    .put(Decal.ring, x, z, reach)
    .tint(light, 0.8 * k, body, 1)
    .args(0, 0.07 * pulse, 1);
  const h = fx.ground.heightAt(x, z);
  for (let i = perFrame(fx, 12 * k); i > 0; i--) {
    const a = rand(0, Math.PI * 2);
    const d = radius * rand(0.5, 1.1);
    fx.sprites.emit(
      auraMote[ITEMS.indexOf(item)]!,
      x + Math.cos(a) * d,
      h + height * rand(0, 0.4),
      z + Math.sin(a) * d,
      0,
      rand(0.8, 1.6),
      0,
      rand(0.08, 0.12),
    );
  }
}
