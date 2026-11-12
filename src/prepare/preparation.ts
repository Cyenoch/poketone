import type { Handle, Lane, NetworkProgress } from "./handle";

/**
 * One stage's readiness (readiness design §3, §4). A preparation owns a handle per need and settles exactly once per
 * attempt: `ready` when every need's result is in and every GPU step ran in the current context generation while the
 * context is available, `failed` on the first error, `cancelled` when its owner drops it. It never stays pending
 * forever on its own account, and it ignores every completion that belongs to an earlier attempt, an earlier
 * generation, or a settled attempt.
 */

export type Outcome = "ready" | "failed" | "cancelled";
export type Phase = "network" | "cpu" | "gpu";

/** The renderer side the GPU guard reads (`app-renderer.ts`). */
export interface GpuContext {
  /** Bumped on every context loss. */
  readonly generation: number;
  /** False from `webglcontextlost` until the restore finished. */
  readonly available: boolean;
  /** Called after every loss and restore. */
  subscribe(listener: () => void): () => void;
  /** Runs a GPU unit on the warm queue. Tasks queued before a loss may be dropped. */
  enqueue(task: () => Promise<void>): void;
}

export interface Need<T = unknown> {
  /** Names the need in errors; the URL or page key for cache handles. */
  readonly key: string;
  /** Absent for a GPU-only step such as a warm draw. */
  acquire?(this: void, lane: Lane): Handle<T>;
  /** The GPU phase, run once per generation after `acquire`'s result is in. */
  gpu?(this: void, value: T): void | Promise<void>;
}

export interface PreparationError {
  readonly key: string;
  readonly phase: Phase;
  readonly cause: unknown;
}

export interface Progress {
  readonly phase: Phase | "done";
  readonly network: {
    readonly done: number;
    readonly total: number;
    readonly bytes: number;
    readonly bytesTotal: number | null;
  };
  readonly cpu: { readonly done: number; readonly total: number };
  readonly gpu: { readonly done: number; readonly total: number };
}

export interface Preparation<R> {
  readonly revision: R;
  readonly state: "pending" | Outcome;
  /** The current attempt's outcome; `retry()` starts a new attempt with a new promise. */
  readonly settled: Promise<Outcome>;
  /** The first error of the current attempt. */
  readonly error: PreparationError | null;
  progress(): Progress;
  /** Called on every state or progress change. */
  subscribe(listener: () => void): () => void;
  setLane(lane: Lane): void;
  /** After `failed`: re-acquires failed needs and re-runs unfinished phases. Done work is kept. */
  retry(): void;
  /** Releases this preparation's handles, and settles `cancelled` if still pending. */
  cancel(): void;
}

interface Item {
  readonly need: Need;
  handle: Handle<unknown> | null;
  unwatch: (() => void) | null;
  value: unknown;
  cpuDone: boolean;
  failed: boolean;
  gpuDoneIn: number | null;
  gpuQueuedIn: number | null;
  gpuTask: number;
}

export function createPreparation<R>(options: {
  revision: R;
  lane: Lane;
  needs: readonly Need[];
  context?: GpuContext;
}): Preparation<R> {
  const { revision, context } = options;
  if (!context && options.needs.some((need) => need.gpu)) {
    throw new Error("createPreparation: needs with a GPU phase require a GpuContext");
  }
  let lane = options.lane;
  let attempt = 0;
  let state: "pending" | Outcome = "pending";
  let error: PreparationError | null = null;
  let settle: (outcome: Outcome) => void = () => {};
  let settled!: Promise<Outcome>;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const items: Item[] = options.needs.map((need) => ({
    need,
    handle: null,
    unwatch: null,
    value: undefined,
    cpuDone: false,
    failed: false,
    gpuDoneIn: null,
    gpuQueuedIn: null,
    gpuTask: 0,
  }));

  const finish = (outcome: Outcome) => {
    state = outcome;
    settle(outcome);
    emit();
  };

  const fail = (failure: PreparationError) => {
    if (state !== "pending") return;
    error = failure;
    finish("failed");
  };

  const gpuDone = (item: Item) =>
    !item.need.gpu ||
    (context !== undefined && context.available && item.gpuDoneIn === context.generation);

  const check = () => {
    if (state === "pending" && items.every((item) => item.cpuDone && gpuDone(item)))
      finish("ready");
  };

  const queueGpu = (item: Item) => {
    const gpu = item.need.gpu;
    if (!gpu || !context || !item.cpuDone || !context.available) return;
    const generation = context.generation;
    if (item.gpuDoneIn === generation || item.gpuQueuedIn === generation) return;
    item.gpuQueuedIn = generation;
    const task = ++item.gpuTask;
    // The task id is the GPU attempt: a retry and every restore re-issue it.
    const live = () =>
      state === "pending" &&
      item.gpuTask === task &&
      context.available &&
      context.generation === generation;
    context.enqueue(async () => {
      if (!live()) return;
      try {
        await gpu(item.value);
      } catch (cause) {
        if (!live()) return;
        item.gpuQueuedIn = null;
        fail({ key: item.need.key, phase: "gpu", cause });
        return;
      }
      if (!live()) return;
      item.gpuDoneIn = generation;
      check();
      emit();
    });
  };

  const start = (item: Item) => {
    if (item.cpuDone) return queueGpu(item);
    if (!item.need.acquire) {
      item.cpuDone = true;
      return queueGpu(item);
    }
    if (item.failed) {
      item.unwatch?.();
      item.handle?.release();
      item.handle = null;
      item.failed = false;
    }
    if (!item.handle) {
      item.handle = item.need.acquire(lane);
      item.unwatch = item.handle.watch(emit);
    }
    const handle = item.handle;
    const issuedIn = attempt;
    const live = () => issuedIn === attempt && state === "pending" && item.handle === handle;
    void handle.result.then(
      (value) => {
        if (!live()) return;
        item.value = value;
        item.cpuDone = true;
        queueGpu(item);
        check();
        emit();
      },
      (cause: unknown) => {
        // Every failed need is marked, also after the attempt already failed on another one, so
        // one retry re-acquires them all; only the first error is the attempt's.
        if (item.handle !== handle || state === "cancelled") return;
        item.failed = true;
        if (!live()) return;
        const phase = handle.network && !handle.network.done ? "network" : "cpu";
        fail({ key: item.need.key, phase, cause });
      },
    );
  };

  const begin = () => {
    attempt++;
    state = "pending";
    error = null;
    settled = new Promise((resolve) => (settle = resolve));
    for (const item of items) if (!gpuDone(item)) item.gpuQueuedIn = null;
    for (const item of items) start(item);
    check();
  };

  const unsubscribe = context?.subscribe(() => {
    if (state !== "pending") return;
    for (const item of items) queueGpu(item);
    check();
    emit();
  });

  begin();

  return {
    revision,
    get state() {
      return state;
    },
    get settled() {
      return settled;
    },
    get error() {
      return error;
    },
    progress: () => progressOf(items, gpuDone),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLane(next) {
      lane = next;
      for (const item of items) item.handle?.setLane(next);
    },
    retry() {
      if (state !== "failed") return;
      begin();
      emit();
    },
    cancel() {
      if (state === "cancelled") return;
      const pending = state === "pending";
      state = "cancelled";
      unsubscribe?.();
      for (const item of items) {
        item.unwatch?.();
        item.handle?.release();
        item.handle = null;
      }
      if (pending) settle("cancelled");
      emit();
    },
  };
}

function progressOf(items: readonly Item[], gpuDone: (item: Item) => boolean): Progress {
  const network = { done: 0, total: 0, bytes: 0, bytesTotal: 0 as number | null };
  const cpu = { done: 0, total: 0 };
  const gpu = { done: 0, total: 0 };
  for (const item of items) {
    const net: NetworkProgress | null | undefined = item.handle?.network;
    if (net) {
      network.total++;
      if (net.done || item.cpuDone) network.done++;
      network.bytes += net.bytes;
      network.bytesTotal =
        network.bytesTotal === null || net.bytesTotal === null
          ? null
          : network.bytesTotal + net.bytesTotal;
    }
    if (item.need.acquire) {
      cpu.total++;
      if (item.cpuDone) cpu.done++;
    }
    if (item.need.gpu) {
      gpu.total++;
      if (gpuDone(item)) gpu.done++;
    }
  }
  const phase =
    network.done < network.total
      ? "network"
      : cpu.done < cpu.total
        ? "cpu"
        : gpu.done < gpu.total
          ? "gpu"
          : "done";
  return { phase, network, cpu, gpu };
}

/**
 * Calls `start` once `preparation` is ready, only if its revision is still `current()` at that moment. A preparation
 * for a revision the owner has moved past, or one cancelled before it became ready, never starts anything.
 */
export function startWhenReady<R>(
  preparation: Preparation<R>,
  current: () => R,
  start: () => void,
): () => void {
  let stop = () => {};
  const check = () => {
    if (preparation.state === "cancelled") return stop();
    if (preparation.state !== "ready") return;
    stop();
    if (Object.is(current(), preparation.revision)) start();
  };
  stop = preparation.subscribe(check);
  check();
  return stop;
}
