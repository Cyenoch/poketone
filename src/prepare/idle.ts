/**
 * The idle lane (readiness design §8): main-thread and GPU units that may run while the player only
 * looks at the lobby. A unit runs only if an allowlist entry admits its kind and size; everything
 * else waits for a cover (出发, a curtain) or for its lane to rise. Each entry carries the measurement
 * that admitted it; an unmeasured unit is never admitted.
 *
 * Budget (P): a unit may block the main thread at most IDLE_BUDGET_MS on the phone profile, since
 * input arriving during a unit waits for it. The profile is directional only (desktop GPU, 4× CPU
 * throttle); real phones re-measure at C10 and may drop entries.
 */

export type IdleKind = "glb-parse" | "texture-upload";

/** Cost proxies known before the unit runs: geometry from the GLB's JSON, texels from image headers. */
export interface UnitSize {
  readonly vertices: number;
  readonly texturePixels: number;
}

export interface IdleEntry {
  readonly kind: IdleKind;
  /** Admitted up to (and including) these sizes. */
  readonly max: UnitSize;
  /** What admitted it: the longest main-thread block of any measured unit in the bucket. */
  readonly measured: {
    readonly blockMs: { readonly desktop: number; readonly cpu4x: number };
    readonly units: string;
    readonly profile: string;
    readonly date: string;
  };
}

/** P: the most a single idle unit may block the main thread on the phone profile. */
export const IDLE_BUDGET_MS = 8;
/** P: no unit starts until input has been quiet this long. */
export const QUIET_MS = 300;

const PROFILE = "M5 Pro, Chrome 157 headless (ANGLE Metal); cpu4x = CDP 4× CPU throttle";

export const IDLE_ALLOWLIST: readonly IdleEntry[] = [
  {
    // GLB parse + canonical prepare (instance bake) of the small models: every enemy but Scyther,
    // the stations and props. Player forms (1024²–2048², 3.3–12.1 ms at 4×) are not admitted.
    kind: "glb-parse",
    max: { vertices: 2000, texturePixels: 512 * 512 },
    measured: {
      blockMs: { desktop: 1.7, cpu4x: 7.7 },
      units: "33 GLBs (31 enemies, 2 stations) × 3 runs, 2 passes at 4× (scratchpad units.mjs)",
      profile: PROFILE,
      date: "2026-11-06",
    },
  },
  {
    // `renderer.initTexture` of an ImageBitmap texture (decoded off the main thread).
    kind: "texture-upload",
    max: { vertices: 0, texturePixels: 512 * 512 },
    measured: {
      blockMs: { desktop: 0.2, cpu4x: 1.2 },
      units: "256² and 512² × 3 runs × 2 passes (scratchpad units.mjs)",
      profile: PROFILE,
      date: "2026-11-06",
    },
  },
];

export function admits(
  kind: IdleKind,
  size: UnitSize,
  list: readonly IdleEntry[] = IDLE_ALLOWLIST,
): boolean {
  return list.some(
    (entry) =>
      entry.kind === kind &&
      size.vertices <= entry.max.vertices &&
      size.texturePixels <= entry.max.texturePixels,
  );
}

export interface IdleUnit {
  readonly kind: IdleKind;
  readonly size: UnitSize;
  run(): void;
}

/** First come, first served; at most one unit per call, and only after quiet input. */
export class IdleQueue {
  readonly #units: IdleUnit[] = [];

  get size(): number {
    return this.#units.length;
  }

  /** Queues `unit` if the allowlist admits it; returns its cancel, or null when not admitted. */
  add(unit: IdleUnit, list?: readonly IdleEntry[]): (() => void) | null {
    if (!admits(unit.kind, unit.size, list)) return null;
    this.#units.push(unit);
    return () => {
      const index = this.#units.indexOf(unit);
      if (index >= 0) this.#units.splice(index, 1);
    };
  }

  /** The next unit to run in an idle frame, or null while input is recent or nothing waits. */
  next(now: number, lastInput: number): IdleUnit | null {
    if (now - lastInput < QUIET_MS) return null;
    return this.#units.shift() ?? null;
  }
}
