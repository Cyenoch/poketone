import type { Area, Projectile } from "../../sim/state/entities";
import type { TerrainUniforms } from "../terrain";
import type { Decals } from "./decals";
import type { Ribbons } from "./ribbons";
import type { Sprites, SpriteSpec } from "./sprites";
import { compact } from "./pool";
import type { Volumes } from "./volumes";

/** Ground access for effects: CPU height for positions, uniforms for terrain-hugging shaders. */
export interface Ground {
  uniforms: TerrainUniforms;
  heightAt(x: number, z: number): number;
}

/** Everything a recipe draws with. Rebuilt layers are cleared every frame; particles persist. */
export interface Fx {
  sprites: Sprites;
  /** Player ground layer. */
  decals: Decals;
  /** Enemy telegraphs, drawn over every player effect. */
  danger: Decals;
  ribbons: Ribbons;
  volumes: Volumes;
  echoes: Echoes;
  ground: Ground;
  /** Camera yaw this frame; a ground shape meant to read upright takes its yaw from it once, when it lands. */
  viewYaw: number;
  /** Seconds of unpaused play since the view started. */
  time: number;
  dt: number;
}

/** How one projectile move looks in flight and where it ends. */
export interface ShotLook {
  /** Leaves the caster (x, z is the caster): the muzzle beat before the flight. */
  launch?(fx: Fx, x: number, y: number, z: number): void;
  fly(fx: Fx, shot: Projectile, x: number, y: number, z: number): void;
  /** Struck a target (once per pierced target). */
  hit?(fx: Fx, x: number, y: number, z: number): void;
  /** Ran out of range. */
  fade?(fx: Fx, x: number, y: number, z: number): void;
}

/** How one area move looks. (x, z) is the interpolated centre, owner-following when the area follows. */
export interface AreaLook {
  /** Every frame; `charge` runs 0 → 1 over the telegraph and is 1 once it does damage. */
  live?(fx: Fx, area: Area, x: number, z: number, charge: number): void;
  /** First damaging frame. */
  strike?(fx: Fx, area: Area, x: number, z: number): void;
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Stable 0..1 seed per sim id, so an effect keeps its look from frame to frame. */
export const seedOf = (id: number) => (id * 0.618034) % 1;

/** Particles to emit this frame for a continuous rate; the fractional remainder is rolled. */
export function perFrame(fx: Fx, perSecond: number): number {
  return Math.floor(perSecond * fx.dt + Math.random());
}

/** Drag-aware launch speed so a particle coasts `distance` over `life` seconds. */
export function reach(distance: number, life: number, drag: number): number {
  return (distance * drag) / (1 - Math.exp(-drag * life));
}

/** Radial burst around (x, z) with an upward kick; particles stop at the local ground. */
export function spray(
  fx: Fx,
  spec: SpriteSpec,
  x: number,
  y: number,
  z: number,
  n: number,
  speed: number,
  lift: number,
  size: number,
): void {
  const floor = fx.ground.heightAt(x, z);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * rand(0.4, 1);
    fx.sprites.emit(
      spec,
      x,
      y,
      z,
      Math.cos(a) * s,
      lift * rand(0.4, 1.2),
      Math.sin(a) * s,
      size * rand(0.7, 1.25),
      floor,
    );
  }
}

/** Lightning jitter seed: re-rolled `rate` times a second. */
export function flicker(fx: Fx, seed: number, rate: number): number {
  return seed + Math.floor(fx.time * rate) * 7.31;
}

type EchoDraw = (fx: Fx, echo: Echo, t: number) => void;

/** A short-lived drawn effect with no sim object behind it (chains, swipes, arcs). */
export interface Echo {
  draw: EchoDraw;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  /** Recipe-specific numbers (direction, reach, spin...). */
  a: number;
  b: number;
  c: number;
  seed: number;
  points: readonly number[];
}

const NO_POINTS: readonly number[] = [];

export class Echoes {
  private readonly items: Echo[] = [];
  private live = 0;
  /** This frame's dt, read by `grow`. */
  private step = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  add(
    draw: EchoDraw,
    life: number,
    x: number,
    y: number,
    z: number,
    a = 0,
    b = 0,
    c = 0,
    points = NO_POINTS,
  ): void {
    if (this.live >= this.capacity) return;
    let echo = this.items[this.live];
    if (!echo) {
      echo = { draw, age: 0, life, x, y, z, a, b, c, seed: 0, points };
      this.items.push(echo);
    }
    this.live++;
    echo.draw = draw;
    echo.age = 0;
    echo.life = life;
    echo.x = x;
    echo.y = y;
    echo.z = z;
    echo.a = a;
    echo.b = b;
    echo.c = c;
    echo.seed = Math.random() * 100;
    echo.points = points;
  }

  update(fx: Fx): void {
    this.step = fx.dt;
    this.live = compact(this.items, this.live, this.grow);
    for (let i = 0; i < this.live; i++) {
      const echo = this.items[i]!;
      echo.draw(fx, echo, echo.age / echo.life);
    }
  }

  private readonly grow = (echo: Echo): boolean => (echo.age += this.step) < echo.life;
}

/**
 * Top end of a bolt out of the sky above (x, z): `rise` metres up and leaned away from the camera. A
 * plumb bolt near the camera's side of the player rises past the camera itself (12.5 m up) and its
 * camera-facing ribbon smears into a flat band across the top of the screen.
 */
export function skyTop(fx: Fx, x: number, z: number, rise: number): [number, number, number] {
  const lean = rise * 0.6;
  return [x - Math.sin(fx.viewYaw) * lean, rise, z - Math.cos(fx.viewYaw) * lean];
}
