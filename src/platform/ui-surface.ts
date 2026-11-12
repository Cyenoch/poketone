import type { TextServices } from "./text";
import type { Display } from "./render-surface";
import type { UiInsets } from "../ui/gpu/viewport";
import type { GamepadSource } from "./input";

export interface UiPointer {
  id: number;
  x: number;
  y: number;
  kind: "mouse" | "touch" | "pen";
  button: number;
  moved: boolean;
}

export interface UiKey {
  key: string;
  code: string;
  shift: boolean;
  repeat: boolean;
}

export interface UiEvents {
  down: (event: UiPointer) => boolean;
  move: (event: UiPointer) => void;
  up: (event: UiPointer) => void;
  cancel: (event: UiPointer) => void;
  leave: () => void;
  keyDown: (event: UiKey) => boolean;
  keyUp: (event: UiKey) => void;
  wheel: (delta: number) => boolean;
  cancelInput: () => void;
  blur: () => void;
  displayChanged: () => void;
}

/** Window input, focus and presentation; GPU layout and interaction stay in the shared host. */
export interface UiSurface {
  readonly text: TextServices;
  createGamepads(): GamepadSource;
  readonly inputFocused: boolean;
  setCursor(visible: boolean): void;
  readonly base: URL;
  readonly display: Display & { insets: UiInsets; portrait: boolean };
  focus(): void;
  capture(id: number): void;
  release(id: number): void;
  /** Embedded web canvases also participate in the page's stacking and focus order. */
  present?(visible: boolean, interactive: boolean, layer: number): void;
  claimInstallHint?(): boolean;
  readonly fullscreen?: { active: boolean; toggle: () => void } | undefined;
  listen(events: UiEvents): () => void;
  dispose(): void;
}
