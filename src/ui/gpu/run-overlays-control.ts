import type { Container } from "@pmndrs/uikit";
import type { HoverPattern } from "./hover-pattern";
import type { OutlineRing } from "./box-shadow";
import type { FocusMark } from "./focus-mark";

export interface RunOverlayControl {
  panel: Container;
  enabled(): boolean;
  /** `aria-disabled`: still focusable and shows why (its tip), but does nothing. */
  locked?(): boolean;
  action(): void;
  setFocused?(focused: boolean): void;
  setPressed?(pressed: boolean): void;
  setPointerOver?(over: boolean): void;
  /** Picked (a kept backpack item, the station's chosen move): lit like a hovered control. */
  selected?(): boolean;
  /** A `Tooltip` line: why it is locked, or what it is. */
  tip?: string;
  card?: number;
  /** A command-list `.game-button` (a station's action): focus shows the Poké Ball cursor and the
   *  ball pattern, tinted gold on a primary plate. */
  command?: "primary" | "danger";
  outline?: OutlineRing;
  pattern?: HoverPattern;
  cursor?: FocusMark;
}
