import { runtime } from "../platform/runtime";

export type SceneTransitionPhase = "idle" | "covering" | "revealing";
export const SCENE_TRANSITION_TIMING = { cover: 260, reveal: 340 } as const;

/** One curtain clock for both application hosts; closing cancels any pending scene swap. */
export class SceneTransition {
  phase: SceneTransitionPhase = "idle";
  readonly #commit: (destination: string) => void;
  readonly #hold: (destination: string) => Promise<unknown> | null;
  readonly #changed: (phase: SceneTransitionPhase) => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;

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
    if (this.#disposed || this.phase !== "idle") return;
    this.setPhase("covering");
    this.#timer = setTimeout(() => {
      void this.swap(destination);
    }, SCENE_TRANSITION_TIMING.cover);
  }
  private async swap(destination: string) {
    // Paint the completed cover before disposing the old scene.
    await runtime().nextFrame();
    await runtime().nextFrame();
    if (this.#disposed) return;
    const held = this.#hold(destination);
    this.#commit(destination);
    await held;
    if (this.#disposed) return;
    this.setPhase("revealing");
    this.#timer = setTimeout(() => {
      if (!this.#disposed) this.setPhase("idle");
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
