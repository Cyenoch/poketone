// Wind-up tells (docs/GAME-FEEL.md「出招预警」): when an enemy starts a telegraphed attack it glints at the
// head and its body flashes, blue for a plain dodge and red for a heavy one. Red also differs in shape
// (double ring, and a 「!」 that stays up until the attack leaves) so colour is never the only cue.
// Crowds show at most MAX_TELLS at once, red first, then nearest. Ground telegraphs are not touched.

import type { Color } from "three";
import { enemies as enemyDefs } from "../../sim/content/enemies";
import { FLYER_HOVER } from "../../sim/content/params/combat";
import { TICK, type World } from "../../sim/state/world";
import type { Enemy, Player } from "../../sim/state/entities";
import type { RunEvent, TellSeverity } from "../../sim/state/events";
import { rgb } from "./gl";
import type { Fx } from "./fx";
import { danger } from "./palette";
import { Shape, sprite } from "./sprites";

/** Tells drawn at once. More than a handful of glints in a swarm stops reading as "this one". */
const MAX_TELLS = 6;
/** Immediate sprites one tell draws at most (glow, star, two rings, 「!」). */
export const TELL_SPRITES = MAX_TELLS * 5;
/** Enemies further than this from the local player are off screen. */
const VIEW_REACH = 17;
/** Tells waiting for or in their wind-up; one per enemy, far more than a frame ever shows. */
const CAPACITY = 128;
/** The glint's life (s), shortened to the wind-up when that is quicker. */
const GLINT = 0.4;
/** Red's second body flash and second ring start this long after the first. */
const ECHO = 0.16;
/** Ring start delays for a red tell: the ring and its echo. */
const ECHO_DELAYS = [0, ECHO] as const;

const blue = { body: rgb("#2f7dff"), core: rgb("#9fd0ff"), deep: rgb("#0d2f80") };
/**
 * Body tint the flash pulls toward. Instance colour multiplies the model's own colours, so a plain hue
 * would only darken a body that lacks it; brightening every channel and over-driving one reads on all.
 */
const FLASH_TINT = { normal: [1.4, 2.1, 4.6], danger: [5.0, 0.75, 0.6] } as const;

const glow = {
  normal: sprite({ shape: Shape.glow, from: blue.deep, accent: blue.body, alpha: 0.75 }),
  danger: sprite({ shape: Shape.glow, from: danger.deep, accent: danger.red, alpha: 0.75 }),
};
// Light-coloured cores, not white: additive white on sunlit grass is the generic hit sparkle.
const star = {
  normal: sprite({ shape: Shape.star, from: blue.body, accent: blue.core, add: 0.7 }),
  danger: sprite({ shape: Shape.star, from: danger.red, accent: danger.pale, add: 0.7 }),
};
const ring = sprite({ shape: Shape.ring, from: danger.red, accent: danger.pale, add: 0.6 });
const bang = sprite({ shape: Shape.bang, from: danger.red, accent: danger.pale });

interface Tell {
  enemy: number;
  severity: TellSeverity;
  glint: number;
  /** Display time of the first frame that saw it (NaN until then). */
  start: number;
  age: number;
  /** Last frame its enemy was still winding up. */
  seen: number;
  shown: boolean;
  /** Head point and size, refilled each frame for the shown ones. */
  x: number;
  y: number;
  z: number;
  size: number;
  /** Squared distance to the local player, for ranking. */
  rank: number;
}

const blank = (): Tell => ({
  enemy: -1,
  severity: "normal",
  glint: 0,
  start: Number.NaN,
  age: 0,
  seen: 0,
  shown: false,
  x: 0,
  y: 0,
  z: 0,
  size: 0,
  rank: 0,
});

/** Red outranks blue; then nearer outranks further. */
const before = (a: Tell, b: Tell) =>
  a.severity !== b.severity ? a.severity === "danger" : a.rank < b.rank;

/** A quick rise (40 ms) and a 220 ms fall, 0 outside. */
function pulse(age: number): number {
  if (age < 0) return 0;
  return age < 0.04 ? age / 0.04 : Math.max(0, 1 - (age - 0.04) / 0.22);
}

/** Wind-up tells. Reads the world; never writes it. */
export class Tells {
  private readonly pool: Tell[] = Array.from({ length: CAPACITY }, blank);
  private live = 0;
  private readonly byEnemy = new Map<number, Tell>();
  private readonly shown: Tell[] = [];
  private frame = 0;

  add(event: Extract<RunEvent, { t: "tell" }>): void {
    let tell = this.byEnemy.get(event.enemy);
    if (!tell) {
      if (this.live >= CAPACITY) return;
      tell = this.pool[this.live++]!;
      this.byEnemy.set(event.enemy, tell);
    }
    tell.enemy = event.enemy;
    tell.severity = event.severity;
    tell.glint = Math.min(GLINT, event.windup);
    tell.start = Number.NaN;
    tell.shown = false;
  }

  /**
   * Ages the tells, drops the ones whose wind-up ended (or was cancelled), and picks this frame's shown
   * set nearest `self` (the local player). Runs before the enemies are drawn so their flash and the
   * glint start on the same frame.
   */
  select(
    world: World,
    alpha: number,
    ground: (x: number, z: number) => number,
    self: Player,
  ): void {
    this.shown.length = 0;
    if (!this.live) return;
    const frame = ++this.frame;
    const now = world.time - (1 - alpha) * TICK;
    const cx = self.px + (self.x - self.px) * alpha;
    const cz = self.pz + (self.z - self.pz) * alpha;
    for (const enemy of world.enemies) {
      const tell = this.byEnemy.get(enemy.id);
      // A burrower's wind-up is its time underground.
      if (!tell || (enemy.phase !== "windup" && enemy.phase !== "under") || enemy.hp <= 0) continue;
      tell.seen = frame;
      if (Number.isNaN(tell.start)) tell.start = now;
      tell.age = now - tell.start;
      const x = enemy.px + (enemy.x - enemy.px) * alpha;
      const z = enemy.pz + (enemy.z - enemy.pz) * alpha;
      tell.rank = (x - cx) ** 2 + (z - cz) ** 2;
      if (tell.rank > VIEW_REACH * VIEW_REACH) continue;
      this.place(tell, enemy, x, z, ground);
      this.offer(tell);
    }
    // Tells whose enemy is gone or no longer winding up swap out past `live`.
    for (let i = 0; i < this.live;) {
      const tell = this.pool[i]!;
      tell.shown = false;
      if (tell.seen === frame) {
        i++;
        continue;
      }
      this.byEnemy.delete(tell.enemy);
      this.pool[i] = this.pool[--this.live]!;
      this.pool[this.live] = tell;
    }
    for (const tell of this.shown) tell.shown = true;
  }

  /** Mixes the wind-up flash into an enemy's body tint. */
  tint(id: number, color: Color): void {
    if (!this.shown.length) return;
    const tell = this.byEnemy.get(id);
    if (!tell?.shown) return;
    const red = tell.severity === "danger";
    const k = red ? Math.min(1, pulse(tell.age) + pulse(tell.age - ECHO)) : 0.85 * pulse(tell.age);
    if (k <= 0) return;
    const [r, g, b] = FLASH_TINT[tell.severity];
    color.setRGB(
      color.r + (r - color.r) * k,
      color.g + (g - color.g) * k,
      color.b + (b - color.b) * k,
    );
  }

  /** Glints, rings and 「!」 for the shown tells. Call first among the immediate sprites (reserved budget). */
  draw(fx: Fx): void {
    for (const tell of this.shown) {
      const red = tell.severity === "danger";
      const s = tell.size * (red ? 1.3 : 1.15);
      const t = tell.age / tell.glint;
      if (t < 1) {
        // Pops in over 15 % of its life with a little overshoot, then shrinks and fades.
        const pop = t < 0.15 ? (t / 0.15) * 1.25 : 1.25 - 0.55 * ((t - 0.15) / 0.85);
        const fade = 1 - t * t;
        fx.sprites.draw(glow[tell.severity], tell.x, tell.y, tell.z, s * 1.4 * pop, fade);
        fx.sprites.draw(star[tell.severity], tell.x, tell.y, tell.z, s * pop, fade, 0, 0, t * 0.6);
      }
      if (red) {
        for (const delay of ECHO_DELAYS) {
          const r = (tell.age - delay) / 0.3;
          if (r < 0 || r >= 1) continue;
          fx.sprites.draw(ring, tell.x, tell.y, tell.z, s * (0.6 + r), 1 - r, 0, 0, 0, 0, r);
        }
        const rise = Math.min(1, tell.age / 0.08);
        fx.sprites.draw(bang, tell.x, tell.y + s * 1.35, tell.z, s * 0.7 * rise);
      }
    }
  }

  /** Head of the drawn model, nudged toward the camera so the glint sits in front of the face. */
  private place(
    tell: Tell,
    enemy: Enemy,
    x: number,
    z: number,
    ground: (x: number, z: number) => number,
  ): void {
    const def = enemyDefs[enemy.species];
    const height = def.height * enemy.scale;
    tell.x = x;
    tell.z = z;
    tell.y = ground(x, z) + (def.mobility.flying ? FLYER_HOVER * enemy.scale : 0) + height * 0.9;
    tell.size = Math.min(0.75, Math.max(0.42, 0.3 + height * 0.15));
  }

  /** Keeps the best MAX_TELLS in `shown`, best first (insertion into a tiny sorted list). */
  private offer(tell: Tell): void {
    const shown = this.shown;
    let i = Math.min(shown.length, MAX_TELLS);
    while (i > 0 && before(tell, shown[i - 1]!)) {
      if (i < MAX_TELLS) shown[i] = shown[i - 1]!;
      i--;
    }
    if (i < MAX_TELLS) shown[i] = tell;
  }
}
