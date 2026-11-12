/**
 * Dynamic world resolution (single-canvas assessment S4, readiness design C9). Pure: the app renderer
 * feeds it frame and GPU timings and reads `ratio`, the world target's pixels per CSS pixel. The UI
 * keeps the canvas's own density; only the world target scales.
 *
 * Every threshold here is provisional (P). The defaults come from the assessment, not from measured
 * phones; they are to be calibrated on real devices (C10) from the dev probe's window log, never
 * from desktop numbers alone.
 */

/** Presentation budget at 60 Hz, also on 120 Hz screens (the sim stays 30 Hz). */
export const FRAME_BUDGET_MS = 1000 / 60;
/** P: evaluation window. */
const WINDOW_MS = 500;
/** P: a window closes only with this many world frames too, so slow frames still get judged. */
const MIN_SAMPLES = 8;
/** P: a gap this long between world frames is a pause (frozen or hidden world), not a slow frame. */
const GAP_MS = 1000;
/** P: GPU median above this share of the budget for two windows steps down. */
const OVER = 0.85;
/** P: above this for one window takes two steps down, once per overload. */
const SEVERE = 1.2;
/** P: below this share of the budget for UP_AFTER_MS, with CPU below CPU_ROOM, steps up. */
const UNDER = 0.65;
const UP_AFTER_MS = 3000;
const CPU_ROOM = 0.6;
const STEP_DOWN = 0.125;
const STEP_UP = 0.0625;
const HOLD_AFTER_DOWN_MS = 1000;
const HOLD_AFTER_UP_MS = 3000;
/** P: a decrease that improves the GPU median by less than this is noise, not a fix. */
const MIN_GAIN = 0.1;
/** P, no timer queries: a window missing more than this share of frames is a miss window. */
const MISS_SHARE = 0.2;

export interface ResolutionPolicy {
  readonly initial: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Starting density and range by device class (P, assessment §2); measured behaviour decides after.
 * `cap` is the canvas's own pixel ratio: the world target never goes denser, so neither does the
 * range (a ratio the target cannot apply would read as a decrease that did nothing).
 */
export function policyFor(dpr: number, coarsePointer: boolean, cap: number): ResolutionPolicy {
  const d = Math.max(1, dpr);
  const policy = coarsePointer
    ? { initial: Math.min(d, 1.5), min: Math.min(d, 1), max: Math.min(d, 2) }
    : d < 1.5
      ? { initial: 1, min: 0.75, max: 1 }
      : { initial: Math.min(d, 1.5), min: Math.min(d, 1), max: d };
  const max = Math.min(policy.max, cap);
  return { initial: Math.min(policy.initial, max), min: Math.min(policy.min, max), max };
}

export interface WindowReport {
  readonly at: number;
  readonly gpuMs: number | null;
  readonly cpuMs: number;
  readonly missShare: number;
  readonly ratio: number;
  readonly change: "down" | "down2" | "up" | "revert" | null;
}

interface Window {
  start: number;
  gpu: number[];
  cpu: number[];
  frames: number;
  misses: number;
}

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

export class WorldResolution {
  readonly policy: ResolutionPolicy;
  #ratio: number;
  #window: Window | null = null;
  #overWindows = 0;
  #underSince: number | null = null;
  #holdUntil = 0;
  #severeUsed = false;
  /** The GPU median before the last decrease, to judge whether it helped. */
  #beforeDecrease: number | null = null;
  #failedDecreases = 0;
  /** No timer queries: a one-step trial and the miss share it must beat. */
  #trial: { missShare: number; from: number } | null = null;
  #noTrials = false;
  #lastFrame: number | null = null;
  readonly log: WindowReport[] = [];

  constructor(policy: ResolutionPolicy) {
    this.policy = policy;
    this.#ratio = policy.initial;
  }

  get ratio(): number {
    return this.#ratio;
  }

  /** After a resize, restore, new world or the page showing again: old windows say nothing. */
  reset(now: number): void {
    this.#window = { start: now, gpu: [], cpu: [], frames: 0, misses: 0 };
    this.#lastFrame = null;
    this.#noTrials = false;
    this.#overWindows = 0;
    this.#underSince = null;
    this.#severeUsed = false;
    this.#beforeDecrease = null;
    this.#failedDecreases = 0;
    this.#trial = null;
    this.#holdUntil = now;
  }

  /**
   * One frame that drew the world: its interval and main-thread time. Decisions are made here only,
   * so nothing changes while the world is frozen (no world frames), whatever samples still arrive.
   */
  frame(now: number, intervalMs: number, cpuMs: number): void {
    // A long gap since the last world frame is a pause: what came before it says nothing now.
    if (this.#lastFrame !== null && now - this.#lastFrame > GAP_MS) {
      this.#window = null;
      this.#overWindows = 0;
      this.#underSince = null;
    }
    this.#lastFrame = now;
    const window = (this.#window ??= { start: now, gpu: [], cpu: [], frames: 0, misses: 0 });
    window.frames++;
    window.cpu.push(cpuMs);
    if (intervalMs > FRAME_BUDGET_MS * 1.5) window.misses++;
    // A window needs both time and frames: at sustained low frame rates it simply runs longer.
    if (now - window.start < WINDOW_MS || window.frames < MIN_SAMPLES) return;
    this.#window = null;
    this.#evaluate(window, now);
  }

  /** A GPU time that arrived (asynchronously) for the world frame drawn at `frameAt`. */
  gpu(ms: number, frameAt: number): void {
    const window = this.#window;
    // Results for frames before this window (before a pause, a reset) are dropped.
    if (window && frameAt >= window.start) window.gpu.push(ms);
  }

  #evaluate(window: Window, now: number): void {
    const cpu = median(window.cpu);
    const missShare = window.misses / window.frames;
    const gpu = window.gpu.length >= MIN_SAMPLES / 2 ? median(window.gpu) : null;
    const change =
      gpu === null ? this.#withoutTimer(missShare, cpu, now) : this.#withTimer(gpu, cpu, now);
    this.log.push({ at: now, gpuMs: gpu, cpuMs: cpu, missShare, ratio: this.#ratio, change });
    if (this.log.length > 240) this.log.shift();
  }

  #withTimer(gpu: number, cpu: number, now: number): WindowReport["change"] {
    const budget = FRAME_BUDGET_MS;
    // Judge the last decrease on its first full window.
    if (this.#beforeDecrease !== null && now >= this.#holdUntil) {
      const helped = gpu < this.#beforeDecrease * (1 - MIN_GAIN);
      this.#failedDecreases = helped ? 0 : this.#failedDecreases + 1;
      this.#beforeDecrease = null;
    }
    this.#overWindows = gpu > budget * OVER ? this.#overWindows + 1 : 0;
    if (gpu < budget * UNDER && cpu < budget * CPU_ROOM) this.#underSince ??= now;
    else this.#underSince = null;
    if (now < this.#holdUntil) return null;
    // Two decreases that did not move the GPU time: the cost is elsewhere (CPU, shadows, UI).
    const mayDecrease = this.#failedDecreases < 2 && this.#ratio > this.policy.min;
    if (mayDecrease && gpu > budget * SEVERE && !this.#severeUsed) {
      this.#severeUsed = true;
      return this.#down(2, gpu, now) ? "down2" : null;
    }
    if (mayDecrease && this.#overWindows >= 2) return this.#down(1, gpu, now) ? "down" : null;
    if (this.#underSince !== null && now - this.#underSince >= UP_AFTER_MS) {
      return this.#up(now) ? "up" : null;
    }
    return null;
  }

  /** Without GPU timings: misses with CPU room may be GPU-bound; try one step, keep it only if it helps. */
  #withoutTimer(missShare: number, cpu: number, now: number): WindowReport["change"] {
    const missing = missShare > MISS_SHARE && cpu < FRAME_BUDGET_MS * CPU_ROOM;
    this.#overWindows = missing ? this.#overWindows + 1 : 0;
    if (now < this.#holdUntil) return null;
    if (this.#trial) {
      const trial = this.#trial;
      this.#trial = null;
      if (missShare < trial.missShare * (1 - MIN_GAIN)) return null;
      this.#noTrials = true;
      this.#ratio = trial.from;
      this.#holdUntil = now + HOLD_AFTER_UP_MS;
      return "revert";
    }
    if (this.#noTrials || this.#overWindows < 2 || this.#ratio <= this.policy.min) return null;
    this.#trial = { missShare, from: this.#ratio };
    return this.#down(1, null, now) ? "down" : null;
  }

  #down(steps: number, gpu: number | null, now: number): boolean {
    const next = Math.max(this.policy.min, this.#ratio - STEP_DOWN * steps);
    if (next === this.#ratio) return false;
    this.#ratio = next;
    this.#overWindows = 0;
    this.#underSince = null;
    this.#beforeDecrease = gpu;
    this.#holdUntil = now + HOLD_AFTER_DOWN_MS;
    return true;
  }

  #up(now: number): boolean {
    const next = Math.min(this.policy.max, this.#ratio + STEP_UP);
    if (next === this.#ratio) return false;
    this.#ratio = next;
    this.#underSince = null;
    this.#severeUsed = false;
    this.#failedDecreases = 0;
    this.#holdUntil = now + HOLD_AFTER_UP_MS;
    return true;
  }
}
