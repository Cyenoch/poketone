import type { Container } from "@pmndrs/uikit";
import type { OutlineRing } from "./box-shadow";

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
  /** Draws its own hover, focus and press (a slanted key or card): the window adds no ring. */
  selfDrawn?: boolean;
  outline?: OutlineRing;
}
