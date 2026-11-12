import sdl, { type Events } from "@kmamal/sdl";
import type { UiEvents, UiKey, UiPointer, UiSurface } from "../ui-surface";
import type { NativeRenderSurface } from "./render-surface";
import { NativeTextServices } from "./text";
import { NativeGamepads } from "./gamepad";

const special: Record<string, string> = {
  RETURN: "Enter",
  KP_ENTER: "NumpadEnter",
  ESCAPE: "Escape",
  SPACE: "Space",
  TAB: "Tab",
  BACKSPACE: "Backspace",
  DELETE: "Delete",
  UP: "ArrowUp",
  DOWN: "ArrowDown",
  LEFT: "ArrowLeft",
  RIGHT: "ArrowRight",
  HOME: "Home",
  END: "End",
  PAGEUP: "PageUp",
  PAGEDOWN: "PageDown",
  GRAVE: "Backquote",
  LSHIFT: "ShiftLeft",
  RSHIFT: "ShiftRight",
};
const codes = new Map(
  Object.entries(sdl.keyboard.SCANCODE).map(([name, code]) => [
    code,
    special[name] ??
      (/^[A-Z]$/.test(name) ? `Key${name}` : /^[0-9]$/.test(name) ? `Digit${name}` : name),
  ]),
);

export class NativeUiSurface implements UiSurface {
  readonly base: URL;
  readonly text: NativeTextServices;
  readonly #surface: NativeRenderSurface;
  #captured = false;
  createGamepads() {
    return new NativeGamepads();
  }
  get inputFocused() {
    return this.#surface.window.focused;
  }
  setCursor(visible: boolean) {
    sdl.mouse.showCursor(visible);
  }
  constructor(surface: NativeRenderSurface, base: URL) {
    this.#surface = surface;
    this.base = base;
    const handle = surface.window.native.handle;
    if (!handle) throw new Error("Native text services require an SDL window handle.");
    this.text = new NativeTextServices(handle);
  }
  get display() {
    return {
      ...this.#surface.display,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      portrait: false,
    };
  }
  readonly #toggleFullscreen = () => {
    const win = this.#surface.window;
    win.setFullscreen(!win.fullscreen);
  };
  get fullscreen() {
    return { active: this.#surface.window.fullscreen, toggle: this.#toggleFullscreen };
  }
  focus() {
    this.#surface.window.focus();
  }
  capture(id: number) {
    if (id !== 1) return;
    sdl.mouse.capture();
    this.#captured = true;
  }
  release(id = 1) {
    if (id !== 1) return;
    if (this.#captured) sdl.mouse.uncapture();
    this.#captured = false;
  }
  listen(events: UiEvents) {
    const win = this.#surface.window;
    const key = (event: Events.Window.KeyDown | Events.Window.KeyUp): UiKey => {
      const code = codes.get(event.scancode) ?? "";
      return {
        code,
        key:
          code === "Space"
            ? " "
            : code === "NumpadEnter"
              ? "Enter"
              : code.startsWith("Key") || code.startsWith("Digit")
                ? (event.key ?? code)
                : code,
        shift: !!event.shift,
        repeat: event.type === "keyDown" && !!event.repeat,
      };
    };
    const pointer = (
      event: Events.Window.MouseMove | Events.Window.MouseButtonDown | Events.Window.MouseButtonUp,
    ): UiPointer => ({
      id: 1,
      x: event.x,
      y: event.y,
      kind: "mouse",
      button: "button" in event ? event.button - 1 : -1,
      moved: event.type === "mouseMove",
    });
    const editingKeys = new Set<number>();
    const keyDown = (event: Events.Window.KeyDown) => {
      const mapped = key(event);
      if (mapped.code === "F11") {
        if (!event.repeat) {
          events.cancelInput();
          this.#toggleFullscreen();
          events.displayChanged();
        }
      } else if (this.text.keyDown(event, mapped.key)) editingKeys.add(event.scancode);
      else events.keyDown(mapped);
    };
    const textInput = (event: Events.Window.TextInput) => this.text.textInput(event.text);
    const keyUp = (event: Events.Window.KeyUp) => {
      if (!editingKeys.delete(event.scancode)) events.keyUp(key(event));
    };
    const down = (event: Events.Window.MouseButtonDown) => {
      if (!event.touch) events.down(pointer(event));
    };
    const up = (event: Events.Window.MouseButtonUp) => {
      if (!event.touch && event.button === 1) events.up(pointer(event));
    };
    const move = (event: Events.Window.MouseMove) => {
      if (!event.touch) events.move(pointer(event));
    };
    const wheel = (event: Events.Window.MouseWheel) => {
      if (!event.touch) events.wheel(-event.dy * 40);
    };
    let nextFinger = 2;
    const fingers = new Map<string, UiPointer>();
    const finger = (
      event: Events.Window.FingerDown | Events.Window.FingerMove | Events.Window.FingerUp,
    ) => {
      if (event.mouse) return;
      const token = `${event.device.id}:${event.fingerId}`;
      const previous = fingers.get(token);
      if (!previous && event.type !== "fingerDown") return;
      const point: UiPointer = {
        id: previous?.id ?? nextFinger++,
        x: event.x * win.width,
        y: event.y * win.height,
        kind: "touch",
        button: 0,
        moved: event.type === "fingerMove",
      };
      if (event.type === "fingerUp") {
        fingers.delete(token);
        events.up(point);
      } else {
        fingers.set(token, point);
        if (event.type === "fingerDown") events.down(point);
        else events.move(point);
      }
    };
    const blur = () => {
      for (const point of fingers.values()) events.cancel(point);
      fingers.clear();
      this.release();
      this.setCursor(true);
      editingKeys.clear();
      this.text.blur();
      events.blur();
    };
    win.on("textInput", textInput);
    win.on("keyDown", keyDown);
    win.on("keyUp", keyUp);
    win.on("mouseButtonDown", down);
    win.on("mouseButtonUp", up);
    win.on("mouseMove", move);
    win.on("mouseWheel", wheel);
    win.on("fingerDown", finger);
    win.on("fingerMove", finger);
    win.on("fingerUp", finger);
    win.on("blur", blur);
    win.on("hide", blur);
    win.on("minimize", blur);
    win.on("leave", events.leave);
    win.on("resize", events.displayChanged);
    win.on("displayChange", events.displayChanged);
    return () => {
      win.off("textInput", textInput);
      win.off("keyDown", keyDown);
      win.off("keyUp", keyUp);
      win.off("mouseButtonDown", down);
      win.off("mouseButtonUp", up);
      win.off("mouseMove", move);
      win.off("mouseWheel", wheel);
      win.off("fingerDown", finger);
      win.off("fingerMove", finger);
      win.off("fingerUp", finger);
      win.off("blur", blur);
      win.off("hide", blur);
      win.off("minimize", blur);
      win.off("leave", events.leave);
      win.off("resize", events.displayChanged);
      win.off("displayChange", events.displayChanged);
    };
  }
  dispose() {
    this.text.dispose();
    this.release();
    this.setCursor(true);
  }
}
