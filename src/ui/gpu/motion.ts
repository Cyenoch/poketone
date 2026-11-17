import { Easing, Group, Tween } from "@tweenjs/tween.js";
import { cubicBezier } from "./focus-mark";

/** The redesign's two curves: EASE settles (entrances, lists), SNAP cuts (slabs, tabs, curtain). */
export const EASE = (t: number): number => cubicBezier(t, 0.2, 0.9, 0.25, 1);
export const SNAP = (t: number): number => cubicBezier(t, 0.7, 0, 0.2, 1);
/** cubic-bezier(.3, 1.6, .5, 1): a pop with a light overshoot (a partner landing). */
export const POP = (t: number): number => cubicBezier(t, 0.3, 1.6, 0.5, 1);

/** Hover lift, picked lift and press sink (px), and how long a pose change takes (SNAP). */
export const LIFT = { hover: 3, picked: 5, press: 1, ms: 160 } as const;

/** Entrance stagger: item `index`'s delay (ms) after `start`. */
export const stagger = (index: number, step = 45, start = 0): number => start + index * step;

/** The primary key's light sweep (DESIGN 空闲循环): one 650ms cross every 4.2s, the first after 1.2s. */
export const SWEEP = { period: 4200, delay: 1200, ms: 650 } as const;
/** Elapsed time at which a sweep starts crossing (a hover catches one at once from here). */
export const SWEEP_START = SWEEP.delay + SWEEP.period - SWEEP.ms;

/**
 * The sweep's position 0–1 (ease-in-out) at `elapsed` ms, or −1 between sweeps. Owners step it
 * only on the idle clock (`idleTicked(30)`) while it is not −1, so a resting key draws nothing.
 */
export function sweepAt(elapsed: number): number {
  if (elapsed < SWEEP.delay) return -1;
  const into = ((elapsed - SWEEP.delay) % SWEEP.period) - (SWEEP.period - SWEEP.ms);
  if (into < 0) return -1;
  const k = into / SWEEP.ms;
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
}

/**
 * The paper ground's drift (DESIGN 空闲循环): the ball/cloud/star pattern, and the lobby slab's
 * card art with it, slides down and right along the −14° slant at `speed` stage units a second
 * (stage units follow the UI scale). `tile` is the pattern's repeat, in the same units.
 */
export const PATTERN_DRIFT = { speed: 7, angle: (14 * Math.PI) / 180, tile: 360 } as const;
const DRIFT_DX = Math.cos(PATTERN_DRIFT.angle);
const DRIFT_DY = Math.sin(PATTERN_DRIFT.angle);

/**
 * The drift's offset now (stage units, y down), from one wall clock every screen shares, so
 * changing screen never sends the ground back to its origin. Wrapped to `period` (the repeat of
 * whatever is sampled) to keep the float small; sampling at `p - offset` then wraps with no jump.
 */
export function patternDrift(period: number = PATTERN_DRIFT.tile): [number, number] {
  const travelled = (performance.now() / 1000) * PATTERN_DRIFT.speed;
  return [(travelled * DRIFT_DX) % period, (travelled * DRIFT_DY) % period];
}

/**
 * The page's idle clock, advanced once a frame by the host: every decorative loop of every stage
 * steps on it (15Hz bands and drift, 30Hz model stages). Stacked stages (the menu under a dialog)
 * share one canvas, so one clock keeps a 15Hz step on a 30Hz frame and loops never interleave into
 * extra redraws.
 */
const idle = { time: 0, previous: 0 };
export function advanceIdleClock(deltaMs: number): void {
  idle.previous = idle.time;
  idle.time += deltaMs;
}
/** True on the frame the idle clock crosses a step of `rateHz`. */
export function idleTicked(rateHz: number): boolean {
  const step = 1000 / rateHz;
  return Math.floor(idle.time / step) !== Math.floor(idle.previous / step);
}

/** One real-time clock per UI stage. Replacing a track preserves the current rendered value. */
export class UiMotion {
  readonly group = new Group();
  private time = 0;
  private readonly tracks = new Map<object, () => void>();

  animate<T extends Record<string, number>>(
    state: T,
    target: T,
    duration: number,
    apply: () => void,
    ease: (value: number) => number = Easing.Cubic.Out,
    delay = 0,
  ): void {
    this.cancel(state);
    if (duration === 0 && delay === 0) {
      Object.assign(state, target);
      apply();
      return;
    }
    const tween = new Tween(state, this.group)
      .to(target, duration)
      .easing(ease)
      .onUpdate(apply)
      .onComplete(() => {
        this.group.remove(tween);
        this.tracks.delete(state);
      })
      .delay(delay)
      .start(this.time);
    this.tracks.set(state, () => {
      tween.stop();
      this.group.remove(tween);
    });
  }

  /** An entrance: lands on `from` now, then animates to `to` after `delay` ms. */
  enter<T extends Record<string, number>>(
    state: T,
    from: T,
    to: T,
    duration: number,
    apply: () => void,
    ease: (value: number) => number = EASE,
    delay = 0,
  ): void {
    this.cancel(state);
    Object.assign(state, from);
    apply();
    this.animate(state, to, duration, apply, ease, delay);
  }

  cancel(state: object): void {
    this.tracks.get(state)?.();
    this.tracks.delete(state);
  }

  update(deltaMs: number): boolean {
    const active = !this.group.allStopped();
    this.time += deltaMs;
    this.group.update(this.time);
    return active;
  }

  dispose(): void {
    for (const stop of this.tracks.values()) stop();
    this.tracks.clear();
    this.group.removeAll();
  }
}
