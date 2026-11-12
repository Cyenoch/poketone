/**
 * Waiter handles (readiness design §4). A cache owns one shared operation per key (`Shared`); every caller owns a
 * `Handle` on it. The operation runs at the highest lane among live handles, is aborted only when its last handle is
 * released before it finishes, and its finished result is the cache's to dispose once no handle holds it.
 */

/** Scheduling lanes, highest first (§8). `keep` holds finished work and starts nothing. */
export type Lane = "critical" | "interactive" | "background" | "idle" | "keep";

const RANK: Record<Lane, number> = { critical: 4, interactive: 3, background: 2, idle: 1, keep: 0 };

export const laneRank = (lane: Lane): number => RANK[lane];

/** Network progress of one shared operation. `bytesTotal` is known only from a manifest, never guessed. */
export interface NetworkProgress {
  readonly bytes: number;
  readonly bytesTotal: number | null;
  readonly done: boolean;
}

export interface Handle<T> {
  readonly key: string;
  /** Settles with the shared result, or rejects with an `AbortError` when this handle is released first. */
  readonly result: Promise<T>;
  /** `null` when the operation has no network phase. */
  readonly network: NetworkProgress | null;
  /** Calls `listener` whenever `network` changes; returns the unsubscribe. */
  watch(listener: () => void): () => void;
  setLane(lane: Lane): void;
  /** Idempotent. */
  release(): void;
}

export interface SharedHooks {
  /** The effective lane changed while at least one handle is live. */
  lane?(lane: Lane): void;
  /** The last handle was released. The cache aborts pending work or applies its retention policy. */
  empty(): void;
}

interface Holder<T> {
  lane: Lane;
  resolve(value: T): void;
  reject(cause: unknown): void;
  readonly watchers: Set<() => void>;
}

/** The cache side of one keyed operation: its waiter set, lane and outcome. */
export class Shared<T> {
  readonly key: string;
  readonly #hooks: SharedHooks;
  readonly #holders = new Set<Holder<T>>();
  #state: "pending" | "done" | "failed" = "pending";
  #value: T | undefined;
  #cause: unknown;
  #lane: Lane | null = null;
  #network: NetworkProgress | null;

  constructor(
    key: string,
    hooks: SharedHooks,
    network: { bytesTotal: number | null } | null = null,
  ) {
    this.key = key;
    this.#hooks = hooks;
    this.#network = network && { bytes: 0, bytesTotal: network.bytesTotal, done: false };
  }

  get state(): "pending" | "done" | "failed" {
    return this.#state;
  }

  get holders(): number {
    return this.#holders.size;
  }

  /** The highest lane among live handles; `null` with none. */
  get lane(): Lane | null {
    return this.#lane;
  }

  get network(): NetworkProgress | null {
    return this.#network;
  }

  acquire(lane: Lane): Handle<T> {
    let resolve!: (value: T) => void;
    let reject!: (cause: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // A holder that never reads `result` must not surface its release or failure as an unhandled rejection.
    result.catch(() => {});
    const holder: Holder<T> = { lane, resolve, reject, watchers: new Set() };
    if (this.#state === "done") resolve(this.#value as T);
    else if (this.#state === "failed") reject(this.#cause);
    this.#holders.add(holder);
    this.#updateLane();
    let released = false;
    const network = () => this.#network;
    return {
      key: this.key,
      result,
      get network() {
        return network();
      },
      watch: (listener) => {
        if (released) return () => {};
        holder.watchers.add(listener);
        return () => holder.watchers.delete(listener);
      },
      setLane: (next) => {
        if (released || holder.lane === next) return;
        holder.lane = next;
        this.#updateLane();
      },
      release: () => {
        if (released) return;
        released = true;
        holder.watchers.clear();
        this.#holders.delete(holder);
        if (this.#state === "pending")
          holder.reject(new DOMException(`${this.key} released`, "AbortError"));
        this.#updateLane();
        if (this.#holders.size === 0) this.#hooks.empty();
      },
    };
  }

  resolve(value: T): void {
    if (this.#state !== "pending") return;
    this.#state = "done";
    this.#value = value;
    for (const holder of this.#holders) holder.resolve(value);
  }

  reject(cause: unknown): void {
    if (this.#state !== "pending") return;
    this.#state = "failed";
    this.#cause = cause;
    for (const holder of this.#holders) holder.reject(cause);
  }

  progress(network: NetworkProgress): void {
    this.#network = network;
    for (const holder of this.#holders) for (const listener of holder.watchers) listener();
  }

  #updateLane(): void {
    let lane: Lane | null = null;
    for (const holder of this.#holders)
      if (lane === null || RANK[holder.lane] > RANK[lane]) lane = holder.lane;
    if (lane === this.#lane) return;
    this.#lane = lane;
    if (lane !== null) this.#hooks.lane?.(lane);
  }
}

/**
 * One handle over several (a named set of sounds, a surface's images): it settles when all have,
 * fails with the first failure, and sets lanes on and releases all of them. Its network progress
 * sums the parts; `bytesTotal` is known only when every part's is.
 */
export function allOf(key: string, parts: readonly Handle<unknown>[]): Handle<void> {
  const result = Promise.all(parts.map((part) => part.result)).then(() => {});
  result.catch(() => {});
  const network = (): NetworkProgress | null => {
    const known = parts.map((part) => part.network).filter((value) => value !== null);
    if (known.length === 0) return null;
    const totals = known.map((value) => value.bytesTotal);
    return {
      bytes: known.reduce((sum, value) => sum + value.bytes, 0),
      bytesTotal: totals.includes(null) ? null : totals.reduce((sum, value) => sum! + value!, 0),
      done: known.every((value) => value.done),
    };
  };
  let released = false;
  return {
    key,
    result,
    get network() {
      return network();
    },
    watch(listener) {
      const unwatch = parts.map((part) => part.watch(listener));
      return () => unwatch.forEach((stop) => stop());
    },
    setLane(lane) {
      if (!released) for (const part of parts) part.setLane(lane);
    },
    release() {
      if (released) return;
      released = true;
      for (const part of parts) part.release();
    },
  };
}
