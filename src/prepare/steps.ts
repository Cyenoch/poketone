/**
 * Long CPU construction (a run's view, its minimap bake) as a generator that yields between small
 * steps, driven so no frame-long task forms (readiness design §3.2): steps run until the budget is
 * used, then the next animation frame resumes them, and the loading cover keeps presenting.
 */

/** P: main-thread time per frame given to construction steps under a cover. */
import { runtime } from "../platform/runtime";

export const STEP_BUDGET_MS = 8;

/** A construction that yields between steps and returns what it built. */
export type Steps<T> = Generator<void, T, void>;

/** Resolves in a task of its own after the next animation frame has been presented. */
export const afterFrame = () =>
  nextFrame().then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** Resolves at the next animation frame. */
export const nextFrame = () => runtime().nextFrame();

/**
 * Runs `steps` to completion, a budget's worth per frame; rejects if a step throws. `live` is
 * checked before every step: once it is false (the owner disposed, the context it drew in is gone)
 * no further step runs and the drive rejects with an AbortError.
 */
export async function drive<T>(
  steps: Steps<T>,
  {
    live = () => true,
    budgetMs = STEP_BUDGET_MS,
  }: { live?: () => boolean; budgetMs?: number } = {},
): Promise<T> {
  let start = performance.now();
  for (;;) {
    if (!live()) throw new DOMException("construction abandoned", "AbortError");
    const step = steps.next();
    if (step.done) return step.value;
    if (performance.now() - start >= budgetMs) {
      await nextFrame();
      start = performance.now();
    }
  }
}

/** Runs `steps` at once (where no frame is waiting, e.g. tests). */
export function runAll<T>(steps: Steps<T>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
