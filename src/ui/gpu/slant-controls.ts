import { Container, Text, type Content } from "@pmndrs/uikit";
import { Color } from "three";
import { createMenuIcon } from "./icons";
import { stack } from "./layer";
import { LIFT, SNAP } from "./motion";
import { SlantPlate } from "./slant-plate";
import type { UiStage } from "./stage";
import { HARD_SHADOW, slantOf, ui } from "./tokens";

/** What every slanted control takes from its screen: pointer, keyboard and gamepad state. */
abstract class SlantControl {
  readonly panel: Container;
  protected readonly plate: SlantPlate;
  protected readonly stage: UiStage;
  protected hovered = false;
  protected focused = false;
  protected focusVisible = false;
  protected pressed = false;
  private readonly height: number;

  constructor(stage: UiStage, panel: Container, plate: SlantPlate, height: number) {
    this.stage = stage;
    this.panel = panel;
    this.plate = plate;
    this.height = height;
    panel.add(plate.content);
  }

  setHovered(hovered: boolean): void {
    if (hovered === this.hovered) return;
    this.hovered = hovered;
    this.paint();
  }
  setFocused(focused: boolean): void {
    if (focused === this.focused) return;
    this.focused = focused;
    this.paint();
  }
  setFocusVisible(visible: boolean): void {
    if (visible === this.focusVisible) return;
    this.focusVisible = visible;
    this.paint();
  }
  setPressed(pressed: boolean): void {
    if (pressed === this.pressed) return;
    this.pressed = pressed;
    this.paint();
  }

  /** Touch rule: at least 44 host px tall at the stage's current scale. Owners call it on resize. */
  fitTouch(): void {
    this.panel.setProperties({ minHeight: Math.max(this.height, this.stage.viewport.minTarget) });
  }

  protected get keyed(): boolean {
    return this.focused && this.focusVisible;
  }

  protected abstract paint(): void;

  dispose(): void {
    this.plate.dispose();
  }
}

/**
 * A page tab (研究所, 图鉴, 联机): a white slanted plate with a resident 6px ball-red stripe on its
 * left edge. Hover or keyboard focus pushes ink in from the left (220ms SNAP) and turns the label
 * white; a press sinks it 1px. An optional icon sits before the label.
 */
export class SlantTab extends SlantControl {
  private readonly label: Text;
  private readonly icon: Content | undefined;
  private readonly pose = { push: 0, y: 0 };

  constructor(stage: UiStage, text: string, icon?: Content) {
    const height = 44;
    const lean = slantOf(height) / 2;
    const panel = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexShrink: 0,
      minHeight: height,
      paddingLeft: 6 + 14 + lean,
      paddingRight: 18 + lean,
    });
    const plate = new SlantPlate(panel, {
      fill: ui.white,
      stripe: { color: ui.ball, width: 6 },
      push: ui.ink,
    });
    plate.set({ depth: 3 });
    super(stage, panel, plate, height);
    this.icon = icon;
    if (icon) {
      icon.setProperties({ width: 20, height: 20, color: ui.ink });
      panel.add(stack(icon, 1));
    }
    this.label = stack(
      new Text({ text, fontSize: 15, fontWeight: 800, letterSpacing: 1, color: ui.ink }),
      1,
    );
    panel.add(this.label);
  }

  protected paint(): void {
    const lit = this.hovered || this.keyed;
    this.plate.set({ focus: this.keyed ? 1 : 0 });
    this.stage.motion.animate(
      this.pose,
      { push: lit ? 1 : 0, y: this.pressed ? LIFT.press : 0 },
      220,
      () => {
        this.plate.set({ push: this.pose.push, depth: 3 - this.pose.y });
        // The label turns as the ink passes under it (UIKit compares colours by reference).
        const ink = new Color(ui.ink).lerp(new Color(ui.white), Math.min(1, this.pose.push * 1.6));
        this.label.setProperties({ color: ink });
        this.icon?.setProperties({ color: ink });
        this.panel.setProperties({ transformTranslateY: this.pose.y });
        this.stage.invalidate();
      },
      SNAP,
    );
  }

  dispose(): void {
    this.stage.motion.cancel(this.pose);
    super.dispose();
  }
}

/**
 * ‹ or ›: a white slanted key with an ink frame and an upright chevron (beside a stage, a pager).
 * Hover lifts it 3px, a press sinks it 1px (SNAP 160ms), keyboard focus rings it.
 */
export class ArrowButton extends SlantControl {
  private readonly pose = { y: 0, depth: HARD_SHADOW.offset - 1 };

  constructor(stage: UiStage, direction: "left" | "right") {
    const height = 44;
    const panel = new Container({
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      minWidth: 40 + slantOf(height),
      minHeight: height,
    });
    const plate = new SlantPlate(panel, {
      fill: ui.white,
      border: { color: ui.ink, width: 2 },
    });
    plate.set({ depth: HARD_SHADOW.offset - 1 });
    super(stage, panel, plate, height);
    const chevron = createMenuIcon("chevron");
    chevron.setProperties({
      width: 22,
      height: 22,
      color: ui.ink,
      transformScaleX: direction === "left" ? -1 : 1,
    });
    panel.add(stack(chevron, 1));
  }

  protected paint(): void {
    const lift = this.pressed ? -LIFT.press : this.hovered ? LIFT.hover : 0;
    this.plate.set({ focus: this.keyed ? 1 : 0 });
    this.stage.motion.animate(
      this.pose,
      { y: -lift, depth: HARD_SHADOW.offset - 1 + lift },
      LIFT.ms,
      () => {
        this.plate.set({ depth: this.pose.depth });
        this.panel.setProperties({ transformTranslateY: this.pose.y });
        this.stage.invalidate();
      },
      SNAP,
    );
  }

  dispose(): void {
    this.stage.motion.cancel(this.pose);
    super.dispose();
  }
}
