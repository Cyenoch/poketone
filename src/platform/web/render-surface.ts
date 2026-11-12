import { WebGLRenderer } from "three";
import type { RenderSurface, SurfaceEvents } from "../render-surface";

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

export class WebRenderSurface implements RenderSurface {
  readonly renderer: WebGLRenderer;
  readonly #canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true });
  }

  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  get display() {
    return {
      width: this.#canvas.clientWidth,
      height: this.#canvas.clientHeight,
      pixelRatio: devicePixelRatio || 1,
      coarsePointer: matchMedia("(pointer: coarse)").matches,
    };
  }

  start(events: SurfaceEvents): () => void {
    const visibility = () => {
      if (document.visibilityState === "visible") events.resume();
    };
    // Registered after Three's own listeners, so its context state is rebuilt before the app's.
    this.#canvas.addEventListener("webglcontextlost", events.lost);
    this.#canvas.addEventListener("webglcontextrestored", events.restored);
    document.addEventListener("visibilitychange", visibility);
    for (const type of INPUT_EVENTS)
      window.addEventListener(type, events.input, { capture: true, passive: true });
    this.renderer.setAnimationLoop(events.frame);
    return () => {
      this.renderer.setAnimationLoop(null);
      this.#canvas.removeEventListener("webglcontextlost", events.lost);
      this.#canvas.removeEventListener("webglcontextrestored", events.restored);
      document.removeEventListener("visibilitychange", visibility);
      for (const type of INPUT_EVENTS)
        window.removeEventListener(type, events.input, { capture: true });
    };
  }

  dispose(): void {
    this.renderer.forceContextLoss();
  }
}
