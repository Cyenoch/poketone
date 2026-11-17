import { Container, Text } from "@pmndrs/uikit";
import { Color } from "three";
import { stack } from "./layer";
import { SNAP } from "./motion";
import { SlantPlate } from "./slant-plate";
import type { UiStage } from "./stage";
import { HARD_SHADOW, RADIUS_INNER, slantOf, ui } from "./tokens";

const REST_INK = ui.line,
  LOCKED_INK = "#5a5e68";

/**
 * One option of a segmented choice, on the ink tray (`segmentTray`): the picked option is a white
 * slanted block (same −14°, radius 4) that fades in over 200ms (SNAP) as the last one fades out; a
 * mouse lights the others faintly; an unavailable one is dimmed; keyboard focus rings it in ink.
 * At least 44px tall at every size.
 */
export class SegmentFace {
  readonly panel = new Container({
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    paddingX: 16 + slantOf(44) / 2,
    flexShrink: 0,
  });
  readonly label: Text;
  private readonly plate: SlantPlate;
  private readonly stage: UiStage;
  private readonly lit = { face: 0, ink: 0 };
  private target = "";
  private ink: string = REST_INK;

  constructor(stage: UiStage, text: string) {
    this.stage = stage;
    this.plate = new SlantPlate(this.panel, { fill: ui.white }, RADIUS_INNER);
    this.plate.set({ depth: 0, face: 0 });
    this.label = stack(
      new Text({ text, fontSize: 16, fontWeight: 800, color: REST_INK, lineHeight: 1.2 }),
      1,
    );
    this.panel.add(this.plate.content, this.label);
  }

  paint(state: {
    checked: boolean;
    locked: boolean;
    hovered: boolean;
    focused: boolean;
    focusVisible: boolean;
    pressed: boolean;
  }): void {
    const { checked, locked, hovered, focused, focusVisible, pressed } = state;
    this.plate.set({ focus: focused && focusVisible ? 1 : 0 });
    const hover = hovered && !checked && !locked;
    this.panel.setProperties({ transformTranslateY: pressed && !locked ? 1 : 0 });
    this.ink = locked ? LOCKED_INK : hover ? ui.white : REST_INK;
    const face = checked ? 1 : hover ? 0.14 : 0;
    const key = `${face}${this.ink}`;
    if (key === this.target) return;
    // The first paint lands on the state; later changes fade.
    const duration = this.target === "" ? 0 : 200;
    this.target = key;
    this.stage.motion.animate(this.lit, { face, ink: checked ? 1 : 0 }, duration, this.apply, SNAP);
  }

  private readonly apply = (): void => {
    this.plate.set({ face: this.lit.face });
    // UIKit compares colours by reference: a new one per change.
    this.label.setProperties({ color: new Color(this.ink).lerp(new Color(ui.ink), this.lit.ink) });
    this.stage.invalidate();
  };

  /** Touch rule: at least 44 host px tall at the stage's current scale (a minimum only). */
  fitTouch(): void {
    this.panel.setProperties({ minHeight: Math.max(44, this.stage.viewport.minTarget) });
  }

  /** Kept for the control loop's contract; the face has no running motion of its own. */
  update(_deltaMs: number): void {}

  dispose(): void {
    this.stage.motion.cancel(this.lit);
    this.plate.dispose();
  }
}

/** The ink tray segments sit in: a slanted ink plate with the hard shadow, 5px inside, 3px apart. */
export function segmentTray(): { tray: Container; dispose(): void } {
  const tray = new Container({
    flexDirection: "row",
    alignItems: "stretch",
    padding: 5,
    // Horizontal room that leaves the same 5px gap across the slanted ends.
    paddingX: 6.5,
    gap: 3,
    flexShrink: 0,
  });
  const plate = new SlantPlate(tray, { fill: ui.ink });
  plate.set({ depth: HARD_SHADOW.offset });
  tray.add(plate.content);
  return { tray, dispose: () => plate.dispose() };
}
