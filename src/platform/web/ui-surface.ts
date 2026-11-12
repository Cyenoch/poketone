import {
  claimInstallHint,
  needsFullscreen,
  onFullscreenChange,
  toggleFullscreen,
} from "../landscape";
import type { UiEvents, UiPointer, UiSurface } from "../ui-surface";
import { webText } from "./text";
import { WebGamepads } from "./gamepad";

export class WebUiSurface implements UiSurface {
  readonly text = webText;
  readonly base = new URL(import.meta.env.BASE_URL, location.href);
  readonly #canvas: HTMLCanvasElement;
  readonly #probe = document.createElement("div");
  readonly #coarse = matchMedia("(pointer: coarse)");
  readonly #portrait = matchMedia("(max-width: 700px) and (orientation: portrait)");
  #style = "";
  #tabIndex: string | null = null;
  #mounted = false;
  createGamepads() {
    return new WebGamepads();
  }
  get inputFocused() {
    return (
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      document.activeElement === this.#canvas
    );
  }
  setCursor(visible: boolean) {
    this.#canvas.style.cursor = visible ? "" : "none";
  }

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  }

  get display() {
    const style = getComputedStyle(this.#probe);
    return {
      width: this.#canvas.clientWidth,
      height: this.#canvas.clientHeight,
      pixelRatio: Math.min(devicePixelRatio, 2),
      coarsePointer: this.#coarse.matches,
      portrait: this.#portrait.matches,
      insets: {
        top: parseFloat(style.paddingTop),
        right: parseFloat(style.paddingRight),
        bottom: parseFloat(style.paddingBottom),
        left: parseFloat(style.paddingLeft),
      },
    };
  }
  focus() {
    this.#canvas.focus({ preventScroll: true });
  }
  capture(id: number) {
    this.#canvas.setPointerCapture(id);
  }
  release(id: number) {
    if (this.#canvas.hasPointerCapture(id)) this.#canvas.releasePointerCapture(id);
  }
  present(visible: boolean, interactive: boolean, layer: number) {
    // An aborted StrictMode creation never mutates the next host's canvas.
    if (!this.#mounted) {
      this.#mounted = true;
      this.#style = this.#canvas.style.cssText;
      this.#tabIndex = this.#canvas.getAttribute("tabindex");
      Object.assign(this.#canvas.style, {
        position: "fixed",
        inset: "0",
        width: "100%",
        height: "100%",
        touchAction: "none",
        outline: "none",
      });
      this.#canvas.style.height = "100dvh";
      document.body.append(this.#probe);
    }
    // Keep its layout box while the first GPU surface prepares: client size owns every viewport.
    this.#canvas.style.display = "block";
    this.#canvas.style.visibility = visible ? "visible" : "hidden";
    this.#canvas.style.pointerEvents = interactive ? "auto" : "none";
    this.#canvas.style.zIndex = String(layer);
    this.#canvas.tabIndex = interactive ? 0 : -1;
  }
  claimInstallHint = claimInstallHint;
  readonly #toggleFullscreen = () => void toggleFullscreen();
  get fullscreen() {
    return document.fullscreenElement || needsFullscreen()
      ? { active: !!document.fullscreenElement, toggle: this.#toggleFullscreen }
      : undefined;
  }

  listen(events: UiEvents) {
    const stopFullscreen = onFullscreenChange(() => {
      events.cancelInput();
      events.displayChanged();
    });
    const canvas = this.#canvas;
    const pointer = (event: PointerEvent): UiPointer => {
      const rect = canvas.getBoundingClientRect();
      return {
        id: event.pointerId,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        kind: event.pointerType as UiPointer["kind"],
        button: event.button,
        moved: !!(event.movementX || event.movementY),
      };
    };
    const down = (event: PointerEvent) => {
      if (events.down(pointer(event))) event.preventDefault();
    };
    const move = (event: PointerEvent) => events.move(pointer(event));
    const up = (event: PointerEvent) => events.up(pointer(event));
    const cancel = (event: PointerEvent) => events.cancel(pointer(event));
    const key = (event: KeyboardEvent) => ({
      key: event.key,
      code: event.code,
      shift: event.shiftKey,
      repeat: event.repeat,
    });
    const keyDown = (event: KeyboardEvent) => {
      if (events.keyDown(key(event))) event.preventDefault();
    };
    const keyUp = (event: KeyboardEvent) => events.keyUp(key(event));
    const visibility = () => {
      if (document.hidden) events.blur();
    };
    const wheel = (event: WheelEvent) => {
      const factor =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? canvas.clientHeight
            : 1;
      if (events.wheel(event.deltaY * factor)) event.preventDefault();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("lostpointercapture", cancel);
    canvas.addEventListener("pointerleave", events.leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("keydown", keyDown);
    canvas.addEventListener("keyup", keyUp);
    canvas.addEventListener("blur", events.cancelInput);
    window.addEventListener("blur", events.blur);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("resize", events.displayChanged);
    window.visualViewport?.addEventListener("resize", events.displayChanged);
    this.#coarse.addEventListener("change", events.displayChanged);
    this.#portrait.addEventListener("change", events.displayChanged);
    const observer = new ResizeObserver(events.displayChanged);
    observer.observe(canvas);
    observer.observe(this.#probe);
    let ratio = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    const changedRatio = () => {
      ratio.removeEventListener("change", changedRatio);
      ratio = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
      ratio.addEventListener("change", changedRatio);
      events.displayChanged();
    };
    ratio.addEventListener("change", changedRatio);
    return () => {
      stopFullscreen();
      observer.disconnect();
      ratio.removeEventListener("change", changedRatio);
      this.#coarse.removeEventListener("change", events.displayChanged);
      this.#portrait.removeEventListener("change", events.displayChanged);
      window.removeEventListener("resize", events.displayChanged);
      window.visualViewport?.removeEventListener("resize", events.displayChanged);
      window.removeEventListener("blur", events.blur);
      document.removeEventListener("visibilitychange", visibility);
      canvas.removeEventListener("blur", events.cancelInput);
      canvas.removeEventListener("keydown", keyDown);
      canvas.removeEventListener("keyup", keyUp);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("lostpointercapture", cancel);
      canvas.removeEventListener("pointerleave", events.leave);
      canvas.removeEventListener("wheel", wheel);
    };
  }
  dispose() {
    if (!this.#mounted) return;
    this.#probe.remove();
    this.#canvas.style.cssText = this.#style;
    if (this.#tabIndex === null) this.#canvas.removeAttribute("tabindex");
    else this.#canvas.setAttribute("tabindex", this.#tabIndex);
  }
}
