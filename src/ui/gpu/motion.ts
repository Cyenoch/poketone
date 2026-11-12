import { Easing, Group, Tween } from "@tweenjs/tween.js";

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
  ): void {
    this.cancel(state);
    if (duration === 0) {
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
      .start(this.time);
    this.tracks.set(state, () => {
      tween.stop();
      this.group.remove(tween);
    });
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
