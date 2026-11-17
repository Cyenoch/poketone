import { runtime } from "../platform/runtime";

export type SceneTransitionPhase = "idle" | "covering" | "revealing";
/** Each curtain slab closes in 260ms and opens in 300ms (SNAP), the three 45ms apart. */
export const CURTAIN = { cover: 260, reveal: 300, stagger: 45 } as const;
/** From the first slab moving to the last one landing (covered) or leaving (revealed). */
export const SCENE_TRANSITION_TIMING = {
  cover: CURTAIN.cover + 2 * CURTAIN.stagger,
  reveal: CURTAIN.reveal + 2 * CURTAIN.stagger,
} as const;

/**
 * One curtain clock for both application hosts; closing cancels any pending scene swap. Besides
 * navigating, it covers a page loading in place ({@link cover}/{@link uncover}); a navigation may
 * take over such a cover, or a destination still loading under the curtain (leaving mid-load).
 */
export class SceneTransition {
  phase: SceneTransitionPhase = "idle";
  /** Where the current transition goes (null while idle and for a cover). */
  destination: string | null = null;
  readonly #commit: (destination: string) => void;
  readonly #hold: (destination: string) => Promise<unknown> | null;
  readonly #changed: (phase: SceneTransitionPhase) => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;
  /** The current phase is a {@link cover} (a load in place), not a navigation. */
  #loading = false;
  /** A navigation has committed and waits for its destination under the curtain. */
  #holding = false;
  /** Bumped by every navigation: a superseded swap stops at its next await. */
  #generation = 0;
  #coverStart = 0;

  constructor(
    commit: (destination: string) => void,
    hold: (destination: string) => Promise<unknown> | null,
    changed: (phase: SceneTransitionPhase) => void,
  ) {
    this.#commit = commit;
    this.#hold = hold;
    this.#changed = changed;
  }
  navigate(destination: string): void {
    if (this.#disposed || (this.phase !== "idle" && !this.#loading && !this.#holding)) return;
    clearTimeout(this.#timer);
    this.#loading = this.#holding = false;
    this.destination = destination;
    const generation = ++this.#generation;
    this.#timer = setTimeout(() => {
      void this.swap(destination, generation);
    }, this.closing());
  }
  /** Closes the curtain over the current page while it loads in place, until {@link uncover}. */
  cover(): void {
    if (this.#disposed || (this.phase === "covering" && !this.#loading)) return;
    clearTimeout(this.#timer);
    this.#loading = true;
    this.closing();
  }
  /** Opens a {@link cover} once it has fully closed (never a half-shut flash). */
  uncover(): void {
    if (this.#disposed || !this.#loading || this.phase !== "covering") return;
    clearTimeout(this.#timer);
    const left = this.#coverStart + SCENE_TRANSITION_TIMING.cover - performance.now();
    this.#timer = setTimeout(() => this.reveal(), Math.max(0, left));
  }
  /** Starts closing unless already closing; the ms left until fully closed. */
  private closing(): number {
    if (this.phase !== "covering") {
      this.#coverStart = performance.now();
      this.setPhase("covering");
    }
    return Math.max(0, this.#coverStart + SCENE_TRANSITION_TIMING.cover - performance.now());
  }
  private async swap(destination: string, generation: number) {
    // Paint the completed cover before disposing the old scene.
    await runtime().nextFrame();
    await runtime().nextFrame();
    if (this.#disposed || generation !== this.#generation) return;
    const held = this.#hold(destination);
    this.#commit(destination);
    this.#holding = true;
    await held;
    if (this.#disposed || generation !== this.#generation) return;
    this.#holding = false;
    this.reveal();
  }
  private reveal() {
    this.setPhase("revealing");
    this.#timer = setTimeout(() => {
      if (this.#disposed) return;
      this.destination = null;
      this.#loading = false;
      this.setPhase("idle");
    }, SCENE_TRANSITION_TIMING.reveal);
  }
  private setPhase(phase: SceneTransitionPhase) {
    this.phase = phase;
    this.#changed(phase);
  }
  dispose() {
    this.#disposed = true;
    clearTimeout(this.#timer);
  }
}
