import sdl, { type Sdl } from "@kmamal/sdl";
import type { EventEmitter } from "node:events";
import { createWebGL2Context } from "webgl-node";
import { WebGLRenderer } from "three";
import type { RenderSurface, SurfaceEvents } from "../render-surface";

export class NativeRenderSurface implements RenderSurface {
  readonly window = sdl.video.createWindow({
    title: "poketone",
    width: 1280,
    height: 800,
    resizable: true,
    accelerated: false,
  }) as Sdl.Video.Window & Pick<EventEmitter, "off" | "emit" | "removeListener">;
  #context: ReturnType<typeof createWebGL2Context>;
  #renderer: WebGLRenderer;
  #events?: SurfaceEvents;
  private readonly onError: (error: Error) => void;
  readonly #waiters = new Set<() => void>();

  constructor(onError: (error: Error) => void) {
    this.onError = onError;
    let context: ReturnType<typeof createWebGL2Context> | undefined;
    try {
      this.#context = context = this.#createContext();
      this.#renderer = new WebGLRenderer({ canvas: null, context: this.#context.gl });
      this.resize();
    } catch (error) {
      context?.destroy();
      this.window.destroy();
      throw error;
    }
  }

  get renderer(): WebGLRenderer {
    return this.#renderer;
  }

  #createContext(): ReturnType<typeof createWebGL2Context> {
    const handle = this.window.native.handle;
    if (!handle) throw new Error("SDL did not provide a native window handle.");
    const context = createWebGL2Context(this.window.pixelWidth, this.window.pixelHeight, {
      antialias: true,
      canvas: false,
    });
    if (!context.attachWindow(handle)) {
      context.destroy();
      throw new Error("Could not attach the WebGL2 context to the SDL window.");
    }
    context.setSwapInterval(1);
    return context;
  }

  /** Rebuild the actual native context; CPU session/world state stays mounted. */
  recreateContext(): void {
    this.#renderer.notifyContextLost();
    this.#events?.lost();
    this.#renderer.dispose();
    this.#context.destroy();
    this.#context = this.#createContext();
    this.#renderer = new WebGLRenderer({ canvas: null, context: this.#context.gl });
    this.resize();
    this.#events?.restored();
  }

  get display() {
    const win = this.window;
    return {
      width: win.width,
      height: win.height,
      pixelRatio: win.pixelWidth / win.width,
      coarsePointer: false,
    };
  }

  resize(): void {
    const { width, height, pixelRatio } = this.display;
    this.#context.resize(this.window.pixelWidth, this.window.pixelHeight);
    this.renderer.setDrawingBufferSize(width, height, pixelRatio);
  }

  nextFrame = (): Promise<void> =>
    new Promise((resolve) => {
      this.#waiters.add(resolve);
    });

  start(events: SurfaceEvents): () => void {
    this.#events = events;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let recovering = false;
    const visible = () => this.window.visible && !this.window.minimized;
    const finishFrame = () => {
      for (const resolve of this.#waiters) resolve();
      this.#waiters.clear();
    };
    const frame = () => {
      timer = undefined;
      if (stopped || !visible()) return;
      try {
        const presented = events.frame();
        if (presented) {
          if (this.#context.swapBuffers()) recovering = false;
          else {
            if (recovering)
              throw new Error("Native presentation failed after rebuilding the context.");
            recovering = true;
            this.recreateContext();
          }
        }
        finishFrame();
        timer = setTimeout(frame, presented ? 0 : 8);
      } catch (error) {
        stopped = true;
        finishFrame();
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const resize = () => {
      this.resize();
      events.resume();
    };
    const suspend = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const resume = () => {
      if (stopped || !visible()) return;
      suspend();
      resize();
      timer = setTimeout(frame, 0);
    };
    this.window.on("resize", resize);
    this.window.on("displayChange", resize);
    this.window.on("focus", events.resume);
    this.window.on("hide", suspend);
    this.window.on("minimize", suspend);
    this.window.on("show", resume);
    this.window.on("restore", resume);
    this.window.on("keyDown", events.input);
    this.window.on("mouseMove", events.input);
    this.window.on("mouseButtonDown", events.input);
    this.window.on("mouseWheel", events.input);
    if (visible()) timer = setTimeout(frame, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
      this.#events = undefined;
      this.window.removeListener("resize", resize);
      this.window.removeListener("displayChange", resize);
      this.window.removeListener("focus", events.resume);
      this.window.removeListener("hide", suspend);
      this.window.removeListener("minimize", suspend);
      this.window.removeListener("show", resume);
      this.window.removeListener("restore", resume);
      this.window.removeListener("keyDown", events.input);
      this.window.removeListener("mouseMove", events.input);
      this.window.removeListener("mouseButtonDown", events.input);
      this.window.removeListener("mouseWheel", events.input);
      for (const resolve of this.#waiters) resolve();
      this.#waiters.clear();
    };
  }

  dispose(): void {
    this.#context.destroy();
    if (!this.window.destroyed) this.window.destroy();
  }
}
