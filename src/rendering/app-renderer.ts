import {
  NoToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  type WebGLRenderer,
  type Material,
  type Scene,
} from "three";
import type { GpuContext } from "../prepare/preparation";
import { IdleQueue, type IdleUnit } from "../prepare/idle";
import { GpuTimer } from "./gpu-timer";
import { WorldPass } from "./world-pass";
import { policyFor, WorldResolution } from "./world-resolution";
import type { RenderSurface } from "../platform/render-surface";

/**
 * The application's only canvas, WebGL context and frame loop (readiness design §6, single-canvas
 * assessment S1/S2). The world (a run) and the UI are clients: each frame advances both. The world
 * draws into its own target only when its picture changed (`world-pass.ts`); when anything changed
 * the canvas is cleared, the world picture copied and the UI drawn over it. Context loss has
 * one owner here: residents release their uploads while the old context is lost and restore after
 * three rebuilt its managers; nothing is drawn, and no client advances, until then.
 */

/**
 * A frame client. `advance` returns true when its picture changed; `draw` submits it. The world
 * client draws into the bound world target and clears it with its own background first.
 */
export interface FrameClient {
  advance(deltaMs: number): boolean;
  draw(renderer: WebGLRenderer): void;
}

/** Something holding GPU uploads that must be released on loss and may restore after it. */
export interface Resident {
  release(): void;
  restore?(): void;
}

/** Draw calls and triangles one pass submitted. */
export interface PassCounts {
  calls: number;
  triangles: number;
}

/**
 * The developer readout's view of the frame loop, overwritten in place each frame. Counts and CPU
 * times belong to the last frame that drew that pass; `presented` / `worldDrawn` count the frames
 * that drew, so a reader tells how many of its frames those numbers stand for.
 */
export interface FrameStats {
  /** Browser frame interval (ms). */
  intervalMs: number;
  /** Frames that presented (drew the canvas), and of those, frames that drew the world. */
  presented: number;
  worldDrawn: number;
  /** The world pass, its shadow-map renders excluded. */
  world: PassCounts;
  shadow: PassCounts;
  /** The canvas pass: the world-picture copy and the UI. */
  ui: PassCounts;
  worldCpuMs: number;
  uiCpuMs: number;
  /** GPU time of the newest timed (world-drawing) frame that finished undisjoint; null before one. */
  gpuMs: number | null;
  /** `performance.now()` of that frame. */
  gpuAt: number;
  gpuSupported: boolean;
}

/** Warm-queue units run under this budget per frame (P, design §8). */
const WARM_BUDGET_MS = 8;

export class AppRenderer implements GpuContext {
  readonly surface: RenderSurface;
  readonly #stop: () => void;
  #generation = 0;
  #available = true;
  #disposed = false;
  #invalid = true;
  #previous: number | null = null;
  #world: FrameClient | null = null;
  #ui: FrameClient | null = null;
  #input: (() => void) | null = null;
  readonly #residents = new Set<Resident>();
  readonly #listeners = new Set<() => void>();
  readonly #tasks: (() => Promise<void>)[] = [];
  readonly #worldPass = new WorldPass();
  #timer: GpuTimer;
  /**
   * The run-warm program set (readiness design §3.2): programs of warmed world materials, pinned so
   * that a run's dispose does not delete them and the next run links nothing. Attributed by material,
   * never a sweep of every program; bounded by the stage's material set; gone with the context.
   */
  #worldPrograms: ReturnType<WebGLRenderer["createProgramRetention"]>;
  #resolution: WorldResolution;
  /** The display the resolution controller was set up for (CSS size and device pixel ratio). */
  #display = "";
  /** Dev calibration: a fixed world density instead of the controller's. */
  #pinned: number | null = null;
  /** Dev probe (`window.__poketoneRender`): presented frames, world-pass draws, shadow-map renders. */
  readonly #counts = { presented: 0, world: 0, shadow: 0, idle: 0 };
  readonly stats: FrameStats = {
    intervalMs: 0,
    presented: 0,
    worldDrawn: 0,
    world: { calls: 0, triangles: 0 },
    shadow: { calls: 0, triangles: 0 },
    ui: { calls: 0, triangles: 0 },
    worldCpuMs: 0,
    uiCpuMs: 0,
    gpuMs: null,
    gpuAt: 0,
    gpuSupported: false,
  };
  /** Shadow-map draws of the current frame, summed by the `shadowMap.render` wrapper. */
  readonly #shadowFrame = { calls: 0, triangles: 0 };
  /** The idle lane (`prepare/idle.ts`): admitted units, run one per frame that presents nothing. */
  readonly #idle = new IdleQueue();
  #lastInput = Number.NEGATIVE_INFINITY;

  constructor(surface: RenderSurface) {
    this.surface = surface;
    this.#worldPrograms = this.renderer.createProgramRetention();
    this.#configure();
    this.#timer = new GpuTimer(this.renderer.getContext());
    this.#resolution = new WorldResolution(this.#policy());
    this.#residents.add({ release: () => this.#worldPass.release() });
    this.#stop = surface.start({
      frame: this.#frame,
      lost: this.#onLost,
      restored: this.#onRestored,
      input: this.#onInput,
      resume: this.#onResume,
    });
  }

  get renderer(): WebGLRenderer {
    return this.surface.renderer;
  }

  get generation(): number {
    return this.#generation;
  }

  get available(): boolean {
    return this.#available;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  enqueue(task: () => Promise<void>): void {
    this.#tasks.push(task);
  }

  resident(resident: Resident): () => void {
    this.#residents.add(resident);
    return () => this.#residents.delete(resident);
  }

  /** Returns the release; a later client replaces this one, and its release then does nothing. */
  setUi(client: FrameClient): () => void {
    this.#ui = client;
    this.#invalid = true;
    return () => {
      if (this.#ui !== client) return;
      this.#ui = null;
      this.#invalid = true;
    };
  }

  /** Sample and route local input before any simulation client advances. */
  setInput(sample: () => void): () => void {
    this.#input = sample;
    return () => {
      if (this.#input === sample) this.#input = null;
    };
  }

  /** Returns the release; a later client replaces this one, and its release then does nothing. */
  setWorld(client: FrameClient): () => void {
    this.#world = client;
    this.#worldPass.invalidate();
    this.#resolution.reset(performance.now());
    this.#invalid = true;
    return () => {
      if (this.#world !== client) return;
      this.#world = null;
      this.#invalid = true;
    };
  }

  /** Runs `draw` (a world compile) under the state and target the world pass renders with. */
  inWorldTarget<T>(draw: () => T): T {
    this.#worldPass.fit(this.surface.display, this.#worldRatio());
    return this.#worldPass.inTarget(this.renderer, draw);
  }

  /** Retains warmed variants and custom shader cache IDs across run teardown. */
  retainWorldPrograms(scene: Scene): void {
    scene.traverse((object) => {
      const { material, customDepthMaterial, customDistanceMaterial } = object as {
        material?: Material | Material[];
        customDepthMaterial?: Material;
        customDistanceMaterial?: Material;
      };
      for (const each of Array.isArray(material) ? material : material ? [material] : [])
        this.#worldPrograms.retain(each);
      if (customDepthMaterial) this.#worldPrograms.retain(customDepthMaterial);
      if (customDistanceMaterial) this.#worldPrograms.retain(customDistanceMaterial);
    });
  }

  /**
   * Queues a main-thread or GPU unit on the idle lane if the allowlist admits it; returns its cancel,
   * or null when it is not admitted (the owner then waits for a cover or a higher lane).
   */
  trySchedule(unit: IdleUnit): (() => void) | null {
    return this.#idle.add(unit);
  }

  /** The next frame redraws everything. */
  invalidate(): void {
    this.#invalid = true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stop();
    this.#worldPass.dispose();
    this.#worldPrograms.dispose();
    this.renderer.dispose();
    this.surface.dispose();
  }

  /** What every pass starts from; the world pass sets its grade and restores this after itself. */
  #configure(): void {
    const renderer = this.renderer;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    // Totals cover the whole frame, including world and UI.
    renderer.info.autoReset = false;
    this.#countShadows();
  }

  #policy() {
    return policyFor(
      this.surface.display.pixelRatio,
      this.surface.display.coarsePointer,
      this.renderer.getPixelRatio(),
    );
  }

  /** World pixels per CSS pixel: the controller's (or a dev pin), never denser than the canvas. */
  #worldRatio(): number {
    // The policy is already capped at the canvas density (`policyFor`); a dev pin is clamped here.
    return this.#pinned === null
      ? this.#resolution.ratio
      : Math.min(this.#pinned, this.renderer.getPixelRatio());
  }

  /** A new display size or pixel ratio restarts the controller (a new ratio, a new device class). */
  #watchDisplay(now: number): void {
    const viewport = this.surface.display;
    const density = `@${viewport.pixelRatio}/${this.renderer.getPixelRatio()}`;
    const display = `${viewport.width}x${viewport.height}${density}`;
    if (display === this.#display) return;
    // A new device or canvas pixel ratio changes the policy (its class and its cap).
    const ratioChanged = !this.#display.endsWith(density);
    this.#display = display;
    if (ratioChanged) this.#resolution = new WorldResolution(this.#policy());
    this.#resolution.reset(now);
  }

  readonly #frame = (): boolean => {
    if (this.#disposed || !this.#available) return false;
    const now = performance.now();
    const deltaMs = this.#previous === null ? 0 : now - this.#previous;
    this.#previous = now;
    this.renderer.info.reset();
    this.#shadowFrame.calls = this.#shadowFrame.triangles = 0;
    const stats = this.stats;
    stats.intervalMs = deltaMs;
    this.#runTasks(now);
    this.#input?.();
    const world = this.#world,
      ui = this.#ui;
    // Both always advance: a run's simulation must not depend on the UI changing, nor the UI's
    // clocks on the world.
    const worldChanged = world?.advance(deltaMs) ?? false;
    const uiChanged = ui?.advance(deltaMs) ?? false;
    // A client's advance may lose the context (a dev hook) or replace a client.
    if (!this.#available || this.#disposed) return false;
    this.#timer.poll((ms, at) => {
      this.#resolution.gpu(ms, at);
      stats.gpuMs = ms;
      stats.gpuAt = at;
    });
    stats.gpuSupported = this.#timer.supported;
    const current = this.#world;
    if (current) {
      this.#watchDisplay(now);
      this.#worldPass.fit(this.surface.display, this.#worldRatio());
    }
    const drawWorld = current !== null && (worldChanged || this.#worldPass.stale);
    if (!drawWorld && !uiChanged && !this.#invalid) {
      // Nothing to present this frame, so the next presentation is at least a frame away: the one
      // moment an idle unit may run, and only after quiet input.
      const unit = this.#idle.next(now, this.#lastInput);
      if (unit) {
        this.#counts.idle++;
        unit.run();
      }
      return false;
    }
    this.#invalid = false;
    // Only frames that draw the world feed the controller: a frozen world holds its resolution.
    if (drawWorld) this.#timer.begin();
    const info = this.renderer.info.render;
    if (current && drawWorld) {
      const start = performance.now();
      this.#worldPass.render(this.renderer, (renderer) => current.draw(renderer));
      stats.worldCpuMs = performance.now() - start;
      stats.worldDrawn++;
      stats.shadow.calls = this.#shadowFrame.calls;
      stats.shadow.triangles = this.#shadowFrame.triangles;
      stats.world.calls = info.calls - stats.shadow.calls;
      stats.world.triangles = info.triangles - stats.shadow.triangles;
      this.#counts.world++;
    }
    const worldCalls = info.calls,
      worldTriangles = info.triangles;
    const start = performance.now();
    // The canvas has no stencil or depth to keep: each frame rebuilds it from the world picture.
    this.renderer.setRenderTarget(null);
    this.renderer.clear(true, true, true);
    if (current) this.#worldPass.copy(this.renderer);
    this.#ui?.draw(this.renderer);
    stats.uiCpuMs = performance.now() - start;
    stats.ui.calls = info.calls - worldCalls;
    stats.ui.triangles = info.triangles - worldTriangles;
    stats.presented++;
    this.#counts.presented++;
    if (drawWorld) {
      this.#timer.end(now);
      this.#resolution.frame(now, deltaMs, performance.now() - now);
    }
    return true;
  };

  /** Splits the shadow pass out of the world pass's three totals (`stats.shadow`). */
  #countShadows(): void {
    const shadowMap = this.renderer.shadowMap;
    const render = shadowMap.render.bind(shadowMap);
    const info = this.renderer.info.render;
    const frame = this.#shadowFrame;
    shadowMap.render = (lights, scene, camera) => {
      // Mirrors WebGLShadowMap's own early returns: only a render that draws a shadow map counts.
      if (shadowMap.enabled && (shadowMap.autoUpdate || shadowMap.needsUpdate) && lights.length > 0)
        this.#counts.shadow++;
      const calls = info.calls,
        triangles = info.triangles;
      render(lights, scene, camera);
      frame.calls += info.calls - calls;
      frame.triangles += info.triangles - triangles;
    };
  }

  debugProbe() {
    const ratio = () => this.#worldRatio();
    const resolution = () => this.#resolution;
    const timer = () => this.#timer.supported;
    const pin = (value: number | null) => (this.#pinned = value);
    const drs = {
      get ratio() {
        return ratio();
      },
      get log() {
        return resolution().log;
      },
      get policy() {
        return resolution().policy;
      },
      get timer() {
        return timer();
      },
      /** Fixes the world density (calibration runs at native, 1.5, 1.25, 1.0); null hands it back. */
      pin,
    };
    return Object.assign(this.#counts, { drs });
  }

  #runTasks(start: number): void {
    while (this.#tasks.length > 0 && performance.now() - start < WARM_BUDGET_MS) {
      const task = this.#tasks.shift()!;
      void task();
    }
  }

  readonly #onLost = (): void => {
    this.#available = false;
    this.#generation++;
    // GPU units queued for the lost generation are dropped; live preparations queue them again.
    this.#tasks.length = 0;
    this.#timer.lost();
    // Programs die with the context; the restored run's warm pins the new ones.
    this.#worldPrograms.dispose();
    for (const resident of this.#residents) resident.release();
    this.#notify();
  };

  readonly #onRestored = (): void => {
    this.#worldPrograms = this.renderer.createProgramRetention();
    // Three rebuilt its state; the clear colour and pass defaults went with it.
    this.#configure();
    this.#timer = new GpuTimer(this.renderer.getContext());
    for (const resident of this.#residents) resident.restore?.();
    this.#worldPass.invalidate();
    this.#resolution.reset(performance.now());
    this.#available = true;
    // Time spent lost is not simulated.
    this.#previous = null;
    this.#invalid = true;
    this.#notify();
  };

  readonly #onInput = (): void => {
    this.#lastInput = performance.now();
  };

  readonly #onResume = (): void => {
    this.#previous = null;
    this.#resolution.reset(performance.now());
  };

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
