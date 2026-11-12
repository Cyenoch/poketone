// Ongoing status marks on the bodies that carry a status: flames for burn, drips for wet, sparks for
// paralysis, Z's for sleep, bubbles for poison, leaves circling the feet for root, frost flakes for
// chill (one per charge), an ice shell for freeze, dark wisps for curse, a gold ring for a mark. Each mark is a looped one-frame sprite whose phase comes
// from time and the body's id, so it follows the body with no particle state and costs a fixed few
// sprites per body. The body tint (createRunView.ts) carries the status at crowd scale; these say which.

import type { Color } from "three";
import { enemies as enemyDefs } from "../../sim/content/enemies";
import type { StatusId } from "../../sim/content/statuses";
import { formOf } from "../../sim/evolution";
import { FLYER_HOVER } from "../../sim/content/params/combat";
import type { ActiveStatus, Enemy, Player } from "../../sim/state/entities";
import type { World } from "../../sim/state/world";
import type { Fx } from "./fx";
import { find } from "../../sim/status";
import { electric, fire, gold, poison, stone, water, white } from "./palette";
import { Shape, sprite, type SpriteSpec } from "./sprites";

/** Immediate sprites reserved for status marks each frame, on top of the moves' own. */
export const STATUS_SPRITES = 720;
/** Bodies further than this from the local player are off screen (the far corners are ≈ 15 m). */
const VIEW_REACH = 17;
/** Most marks one status draws on one body; crowds get fewer each so the total fits the budget. */
const MAX_PER_STATUS = 3;
/** A third or fourth status on one body takes the second slot in turn, this many seconds each. */
const ROTATE_SECONDS = 1.4;
/** Paralysis crackles in steps of this rate (Hz); in each step a body sparks with this chance. */
const CRACKLE_RATE = 8;
const CRACKLE_CHANCE = 0.4;

const BURN = 1;
const PARALYSIS = 2;
const SLEEP = 4;
const WET = 8;
const POISON = 16;
const ROOT = 32;
const CHILL = 64;
const FREEZE = 128;
const CURSE = 256;
const MARKED = 512;
/** Slot priority: the first status a body carries always shows; the rest share the second slot. */
const ORDER = [FREEZE, SLEEP, PARALYSIS, ROOT, BURN, CHILL, CURSE, MARKED, WET, POISON] as const;
/** The mark each status draws; the stun-spore slow shows as paralysis' sparks. */
const MARK: Record<StatusId, number> = {
  burn: BURN,
  paralysis: PARALYSIS,
  sleep: SLEEP,
  wet: WET,
  poison: POISON,
  slow: PARALYSIS,
  root: ROOT,
  chill: CHILL,
  freeze: FREEZE,
  curse: CURSE,
  marked: MARKED,
};

const flame = sprite({
  shape: Shape.flame,
  from: fire.yellow,
  to: fire.red,
  accent: fire.core,
  add: 0.5,
});
const drip = sprite({ shape: Shape.drop, from: water.light, to: water.mid, accent: water.deep });
const zap = sprite({ shape: Shape.star, from: electric.yellow, accent: white, add: 0.6 });
const crackle = sprite({
  shape: Shape.spark,
  from: electric.gold,
  accent: electric.yellow,
  add: 0.6,
});
const zed = sprite({ shape: Shape.zed, from: white, accent: water.light });
const bubble = sprite({ shape: Shape.bubble, from: poison.purple, accent: poison.deep });
const miasma = sprite({
  shape: Shape.glow,
  from: poison.purple,
  accent: poison.light,
  alpha: 0.45,
});

const vine = sprite({ shape: Shape.leaf, from: gold.yellow, to: stone.light, accent: stone.dark });
/** A white star flake, not a faceted shard: cyan-blue facets on the ground read as XP candy. */
const frost = sprite({
  shape: Shape.star,
  from: white,
  to: water.foam,
  accent: water.light,
  add: 0.5,
});
const chillHaze = sprite({ shape: Shape.glow, from: water.light, accent: white, alpha: 0.35 });
const iceShell = sprite({
  shape: Shape.glow,
  from: electric.cyan,
  accent: water.foam,
  alpha: 0.55,
});
const hex = sprite({
  shape: Shape.puff,
  from: poison.purple,
  to: poison.deep,
  accent: poison.light,
  add: 0.2,
});
const markRing = sprite({ shape: Shape.ring, from: gold.yellow, accent: gold.white, add: 0.4 });
const markStar = sprite({ shape: Shape.star, from: gold.yellow, accent: gold.white, add: 0.5 });

const fract = (v: number) => v - Math.floor(v);
const hash = (a: number, b: number) => fract(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);

/** Whether a paralysed body is mid-crackle at `time`: its tint brightens on the same beat. */
function crackling(time: number, id: number): boolean {
  return hash(id, Math.floor(time * CRACKLE_RATE)) < CRACKLE_CHANCE;
}

/** The body being marked (one scratch object, refilled per body). */
const body = {
  id: 0,
  x: 0,
  z: 0,
  /** Feet and height of the drawn model. */
  y: 0,
  h: 0,
  r: 0,
  /** Mark size: grows gently with the body. */
  s: 1,
  seed: 0,
  /** Marks per status this frame. */
  n: 1,
  /** Chill charges (one flake each). */
  chill: 0,
};
/** Camera axes on the ground this frame: toward the camera, and screen right. */
let backX = 0;
let backZ = 0;
let rightX = 0;
let rightZ = 0;

function flagsOf(list: readonly ActiveStatus[]): number {
  let flags = 0;
  for (const status of list) flags |= MARK[status.id];
  return flags;
}

/**
 * Body tint that carries an enemy's status at crowd scale (freeze, sleep, paralysis, burn, curse,
 * poison, chill, wet); false when it has none. Paralysis flares on the same beat as its sparks; wet
 * glistens slowly. Root and a mark have no tint: their marks sit at the feet and over the head.
 */
export function statusTint(enemy: Enemy, time: number, out: Color): boolean {
  const flags = flagsOf(enemy.statuses);
  if (flags & FREEZE) out.setRGB(0.7, 1.35, 2);
  else if (flags & SLEEP) out.setRGB(0.6, 0.65, 1.1);
  else if (flags & PARALYSIS) {
    if (crackling(time, enemy.id)) out.setRGB(1.9, 1.8, 0.8);
    else out.setRGB(1.35, 1.25, 0.55);
  } else if (flags & BURN) out.setRGB(1.4, 0.8, 0.6);
  else if (flags & CURSE) out.setRGB(0.7, 0.45, 1.05);
  else if (flags & POISON) out.setRGB(1.15, 0.8, 1.3);
  else if (flags & CHILL) out.setRGB(0.8, 1.15, 1.6);
  else if (flags & WET) {
    const sheen = 1 + 0.12 * Math.sin(time * 3 + enemy.id);
    out.setRGB(0.75 * sheen, 0.95 * sheen, 1.3 * sheen);
  } else return false;
  return true;
}

/** Statuses that get a slot: one alone; with more, the first by priority plus the rest in turn. */
function slots(flags: number, time: number, seed: number): number {
  let first = 0;
  let rest = 0;
  for (const status of ORDER) {
    if (!(flags & status)) continue;
    if (!first) first = status;
    else rest++;
  }
  if (rest <= 1) return flags;
  let turn = Math.floor(time / ROTATE_SECONDS + seed * 7) % rest;
  for (const status of ORDER) {
    if (!(flags & status) || status === first) continue;
    if (turn-- === 0) return first | status;
  }
  return first;
}

const slotCount = (flags: number) => (flags & (flags - 1) ? 2 : flags ? 1 : 0);

/** Draws every status mark this frame within `STATUS_SPRITES`. Reads the world; never writes it. */
export function statusMarks(fx: Fx, world: World, alpha: number, self: Player): void {
  const cx = self.px + (self.x - self.px) * alpha;
  const cz = self.pz + (self.z - self.pz) * alpha;
  backX = Math.sin(fx.viewYaw);
  backZ = Math.cos(fx.viewYaw);
  rightX = backZ;
  rightZ = -backX;
  const time = fx.time;

  let budget = STATUS_SPRITES;
  for (const player of world.players) {
    if (!player.alive) continue;
    const flags = flagsOf(player.statuses);
    if (!flags) continue;
    const form = formOf(player);
    body.id = player.id;
    body.x = player.px + (player.x - player.px) * alpha;
    body.z = player.pz + (player.z - player.pz) * alpha;
    body.y = fx.ground.heightAt(body.x, body.z);
    body.h = form.height;
    body.r = form.radius;
    body.s = 1.2;
    body.seed = 0.37 * player.id;
    body.n = MAX_PER_STATUS;
    body.chill = 0;
    budget -= mark(fx, flags, time);
  }

  // Count the slots in view first so a crowd gets fewer marks each instead of a cut-off.
  let wanted = 0;
  for (const enemy of world.enemies) {
    const flags = flagsOf(enemy.statuses);
    if (!flags || Math.abs(enemy.x - cx) > VIEW_REACH || Math.abs(enemy.z - cz) > VIEW_REACH)
      continue;
    wanted += Math.min(2, slotCount(flags));
  }
  if (!wanted) return;
  const n = Math.max(1, Math.min(MAX_PER_STATUS, Math.floor(budget / wanted)));
  // Past one mark per slot, a stable share of bodies keeps its marks (no flicker between frames).
  const keep = budget / wanted;
  for (const enemy of world.enemies) {
    if (budget <= 0) break;
    const flags = flagsOf(enemy.statuses);
    if (!flags || Math.abs(enemy.x - cx) > VIEW_REACH || Math.abs(enemy.z - cz) > VIEW_REACH)
      continue;
    if (keep < 1 && hash(enemy.id, 0.5) >= keep) continue;
    const def = enemyDefs[enemy.species];
    body.id = enemy.id;
    body.x = enemy.px + (enemy.x - enemy.px) * alpha;
    body.z = enemy.pz + (enemy.z - enemy.pz) * alpha;
    body.y =
      fx.ground.heightAt(body.x, body.z) + (def.mobility.flying ? FLYER_HOVER * enemy.scale : 0);
    body.h = def.height * enemy.scale;
    body.r = enemy.radius;
    body.s = Math.min(1.6, Math.max(0.75, Math.sqrt(body.h)));
    body.seed = fract(enemy.id * 0.618034);
    body.n = n;
    body.chill = flags & CHILL ? (find(enemy, "chill")?.stacks ?? 1) : 0;
    budget -= mark(fx, slots(flags, time, body.seed), time);
  }
}

/** Draws one body's marks; returns how many sprites it used. */
function mark(fx: Fx, flags: number, time: number): number {
  let used = 0;
  if (flags & SLEEP) used += sleeping(fx, time);
  if (flags & PARALYSIS) used += paralysed(fx, time);
  if (flags & BURN) used += burning(fx, time);
  if (flags & WET) used += dripping(fx, time);
  if (flags & POISON) used += poisoned(fx, time);
  if (flags & ROOT) used += rooted(fx, time);
  if (flags & CHILL) used += chilled(fx, time);
  if (flags & FREEZE) used += frozen(fx, time);
  if (flags & CURSE) used += cursed(fx, time);
  if (flags & MARKED) used += marked(fx, time);
  return used;
}

/** Leaves circling low around the feet, passing in front of and behind the body. */
function rooted(fx: Fx, time: number): number {
  const { n, r, s } = body;
  const count = Math.max(3, n);
  for (let i = 0; i < count; i++) {
    const a = (time * 1.4 + body.seed + i / count) * Math.PI * 2;
    const lift = 0.06 + 0.04 * Math.sin(a * 2);
    draw(fx, vine, Math.cos(a) * r * 1.15, lift, 0.26 * s, 1, a, 0, Math.sin(a) * 1.15);
  }
  return count;
}

/** Frost flakes drifting down the body, one per chill charge, so the build-up to a freeze reads. */
function chilled(fx: Fx, time: number): number {
  const { h, r, s } = body;
  const count = Math.max(1, Math.min(3, body.chill));
  draw(fx, chillHaze, 0, h * 0.5, h * 0.5 + r * 0.3, 0.8, 0, 0, 0.2);
  for (let i = 0; i < count; i++) {
    const u = phase(time, 0.7, i, count);
    const side = (count === 1 ? 0.2 : (i / (count - 1) - 0.5) * 1.3) * r;
    const fade = Math.min(1, u * 5) * Math.min(1, (1 - u) * 5);
    draw(fx, frost, side, h * (0.95 - 0.7 * u), 0.17 * s, fade, u * 3, 0, 0.7);
  }
  return count + 1;
}

/** A pale ice shell over the body with two glints blinking on it. */
function frozen(fx: Fx, time: number): number {
  const { h, r, s } = body;
  draw(fx, iceShell, 0, h * 0.5, h * 0.62 + r * 0.4, 0.9, 0, 0, 0.2);
  for (let i = 0; i < 2; i++) {
    const blink = Math.max(0, Math.sin(time * 3 + body.seed * 6.28 + i * 2.4));
    draw(fx, frost, (i === 0 ? -0.45 : 0.4) * r, h * (0.35 + 0.35 * i), 0.12 * s, blink, i, 0, 0.8);
  }
  return 3;
}

/** Dark violet wisps rising off the head and fading. */
function cursed(fx: Fx, time: number): number {
  const { h, r, s } = body;
  const count = Math.min(2, body.n);
  for (let i = 0; i < count; i++) {
    const u = phase(time, 0.6, i, count);
    const fade = Math.min(1, u * 4) * (1 - u);
    const side = (i === 0 ? -0.3 : 0.25) * r + Math.sin(u * 5 + i) * 0.06;
    draw(fx, hex, side, h * 0.85 + u * 0.6, (0.2 + 0.16 * u) * s, fade, u * 2, 0, 0.4);
  }
  return count;
}

/** A gold ring turning over the head with a star in it: the enemy a mark makes take more damage. */
function marked(fx: Fx, time: number): number {
  const { h, s } = body;
  const pulse = 1 + 0.08 * Math.sin(time * 5);
  draw(fx, markRing, 0, h + 0.38, 0.3 * s * pulse, 0.95, time * 1.5, 0, 0.2);
  draw(fx, markStar, 0, h + 0.38, 0.13 * s, 1, -time * 2, 0, 0.25);
  return 2;
}

/** Loop phase of mark `i` of `n`: evenly staggered. */
function phase(time: number, rate: number, i: number, n: number): number {
  return fract(time * rate + body.seed + i / n);
}

/** World point on the camera side of the body: `side` across the screen, `lift` above the feet. */
function draw(
  fx: Fx,
  spec: SpriteSpec,
  side: number,
  lift: number,
  size: number,
  alpha: number,
  spin: number,
  age: number,
  front = 0.55,
): void {
  const x = body.x + rightX * side + backX * body.r * front;
  const z = body.z + rightZ * side + backZ * body.r * front;
  fx.sprites.draw(spec, x, body.y + lift, z, size, alpha, 0, 0, spin, body.seed, age);
}

/** Flames licking up the shoulders, shrinking as they rise. */
function burning(fx: Fx, time: number): number {
  const { n, h, r, s } = body;
  for (let i = 0; i < n; i++) {
    const u = phase(time, 1.5, i, n);
    const side = (n === 1 ? 0.15 : (i / (n - 1) - 0.5) * 1.2) * r;
    const lift = h * 0.5 + u * (0.25 + h * 0.3);
    draw(fx, flame, side, lift, 0.2 * s * (1 - 0.3 * u), Math.min(1, u * 8), 0, u);
  }
  return n;
}

/** Droplets running off the lower body and falling to the ground. */
function dripping(fx: Fx, time: number): number {
  const { n, h, r, s } = body;
  const count = Math.min(2, n);
  const start = h * 0.45;
  for (let i = 0; i < count; i++) {
    const u = phase(time, 1.1, i, count);
    const side = (count === 1 ? -0.35 : i === 0 ? -0.6 : 0.55) * r;
    const fade = Math.min(1, u * 6) * (1 - u * u * u * u);
    // Round end down: the drop shape points along +x, turned to face the ground.
    draw(fx, drip, side, start * (1 - u * u), 0.11 * s, fade, -Math.PI / 2, u, 0.75);
  }
  return count;
}

/** Sparks jumping across the body on a stepped beat. */
function paralysed(fx: Fx, time: number): number {
  const { id, h, r, s } = body;
  const step = Math.floor(time * CRACKLE_RATE);
  if (!crackling(time, id)) return 0;
  const count = Math.min(3, body.n + 1);
  for (let i = 0; i < count; i++) {
    const a = hash(id + i * 3.1, step);
    const b = hash(id - i * 1.7, step + 0.5);
    const spec = i === 0 ? zap : crackle;
    const size = (i === 0 ? 0.2 : 0.12) * s;
    draw(fx, spec, (a - 0.5) * 1.6 * r, h * (0.25 + b * 0.65), size, 1, a * 6.28, 0, 0.7);
  }
  return count;
}

/** Z's drifting up and aside from above the head, growing as they go. */
function sleeping(fx: Fx, time: number): number {
  const { h, r, s } = body;
  const count = Math.min(2, body.n);
  for (let i = 0; i < count; i++) {
    const u = phase(time, 0.5, i, count);
    const fade = Math.min(1, u * 5) * Math.min(1, (1 - u) * 4);
    const sway = Math.sin(u * 6.28 + body.seed * 6.28) * 0.05;
    const side = r * 0.35 + u * 0.35 + sway;
    draw(fx, zed, side, h + 0.12 + u * 0.5, (0.11 + u * 0.08) * s, fade, -0.2 + sway * 2, 0, 0.3);
  }
  return count;
}

/** Bubbles rising off the body and popping, over a faint purple cast on the body itself. */
function poisoned(fx: Fx, time: number): number {
  const { n, h, r, s } = body;
  const pulse = 0.75 + 0.25 * Math.sin(time * 4);
  draw(fx, miasma, 0, h * 0.5, h * 0.55, pulse, 0, 0, 0.2);
  for (let i = 0; i < n; i++) {
    const u = phase(time, 0.8, i, n);
    const side = Math.sin(body.seed * 6.28 + i * 2.1) * 0.7 * r + Math.sin(u * 9 + i) * 0.05;
    const pop = u > 0.88 ? 1 + (u - 0.88) * 4 : 1;
    const fade = Math.min(1, u * 6) * (u > 0.88 ? 1 - (u - 0.88) / 0.12 : 1);
    draw(fx, bubble, side, h * 0.3 + u * (h * 0.8 + 0.2), (0.08 + 0.06 * u) * s * pop, fade, 0, 0);
  }
  return n + 1;
}
