import { uiScaleRange } from "../../settings";

export interface UiInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Host sizes are CSS pixels (Web) or logical window pixels (SDL), never framebuffer pixels. */
export function uiViewport(
  width: number,
  height: number,
  scale: number,
  safeArea: UiInsets = { top: 0, right: 0, bottom: 0, left: 0 },
) {
  return {
    width: width / scale,
    height: height / scale,
    scale,
    safeArea: {
      top: safeArea.top / scale,
      right: safeArea.right / scale,
      bottom: safeArea.bottom / scale,
      left: safeArea.left / scale,
    },
    // A larger UI never reduces a touch target below 44 host pixels.
    minTarget: Math.max(44, 44 / scale),
  };
}

export type UiViewport = ReturnType<typeof uiViewport>;

/** The screen the UI is drawn for at 100%: larger safe areas grow it by the smaller ratio. */
export const UI_REFERENCE = { width: 1280, height: 800 } as const;

/** The automatic factor a large screen gives the UI (≥ 1; phones and 1280×800 stay at 1). */
export function autoScale(width: number, height: number, insets: UiInsets): number {
  return Math.max(
    1,
    Math.min(
      (width - insets.left - insets.right) / UI_REFERENCE.width,
      (height - insets.top - insets.bottom) / UI_REFERENCE.height,
    ),
  );
}

/**
 * DESIGN.md › 界面缩放下限: a surface's scale is the user's times the screen's `autoScale`, held back so `minLayout` (its content's
 * smallest logical size) still fits the safe area it lays out in, never under the settings' minimum.
 * Host sizes are CSS / logical window pixels.
 */
export function fitScale(
  user: number,
  width: number,
  height: number,
  insets: UiInsets,
  minLayout: { width: number; height: number },
): number {
  const fit = Math.min(
    (width - insets.left - insets.right) / minLayout.width,
    // Landscape chrome and stacked controls need a full vertical working area, even when an
    // individual screen's width would fit at 100%. Share the same floor with windows and HUD.
    (height - insets.top - insets.bottom) / Math.max(460, minLayout.height),
  );
  // A fitted scale is an arbitrary ratio; taken down to a multiple of 1/64 it stays exact in
  // binary, so layout on its pixel grid adds up (an inexact grid let Yoga's float rounding push a
  // text box a device pixel past its parent, which turned the parent scrollable).
  const auto = autoScale(width, height, insets);
  // At the reference size and below the user's scale stays exact; above it, the grown scale on the grid.
  const want = auto > 1 ? Math.max(user, Math.floor(user * auto * 64) / 64) : user;
  return Math.max(uiScaleRange.min, want <= fit ? want : Math.floor(fit * 64) / 64);
}
