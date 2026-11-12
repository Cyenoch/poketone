import { Container, Text, withOpacity } from "@pmndrs/uikit";
import { Color } from "three";
import { BoxShadow, OutlineRing } from "./box-shadow";
import { CodexBall } from "./codex-parts";
import { HoverPattern } from "./hover-pattern";
import { fade, stack } from "./layer";
import { RunButtonSurface } from "./run-overlays-surface";
import { HatchFill } from "./screen-parts";
import type { UiStage } from "./stage";

const NAVY_DEEP = "#0d233f",
  ICE = "#d8effb",
  TRAY = "#173f70",
  YELLOW = "#ffd45b";

/**
 * ui/SegmentedControl.tsx `.game-segments__face`: a Poké Ball and a label in the navy tray. The
 * picked option is a raised yellow plate that fades in over 120ms as the last one fades out; a
 * mouse lights the others blue-deep; an unavailable one is muted and hatched; `:focus-visible`
 * rings it yellow 2px out. At least 44px tall at every size.
 */
export class SegmentFace {
  readonly panel = new Container({
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    paddingY: 4,
    paddingX: 16,
    borderWidth: 2,
    borderRadius: 8,
    borderColor: "transparent",
    flexShrink: 0,
  });
  readonly label: Text;
  // The picked look on its own layer over the border box, so it can cross-fade.
  private readonly plate = new Container({
    positionType: "absolute",
    positionLeft: -2,
    positionTop: -2,
    positionRight: -2,
    positionBottom: -2,
    borderWidth: 2,
    borderRadius: 8,
    borderColor: NAVY_DEEP,
    backgroundColor: YELLOW,
  });
  private readonly sheen = new RunButtonSurface();
  private readonly pattern: HoverPattern;
  private readonly ring = new OutlineRing(8, YELLOW, 3, 2);
  private readonly hatch = new HatchFill();
  private readonly shadow = new BoxShadow(8, [{ y: 2, blur: 0, color: "#000000", alpha: 0.45 }]);
  private readonly ball: CodexBall;
  private readonly stage: UiStage;
  private readonly lit = { value: 0 };
  private litTarget = -1;
  private ink = ICE;
  private readonly picked = new Color(NAVY_DEEP);

  constructor(stage: UiStage, text: string) {
    this.stage = stage;
    this.pattern = new HoverPattern(stage.motion, () => stage.invalidate(), TRAY);
    this.ball = new CodexBall(stage.motion, () => stage.invalidate());
    this.label = stack(
      new Text({ text, fontSize: 16, fontWeight: 800, color: ICE, lineHeight: 1.2 }),
      1,
    );
    this.ring.content.setProperties({ display: "none" });
    this.hatch.content.setProperties({ display: "none" });
    this.plate.add(this.sheen.content);
    fade(this.plate, 0);
    fade(this.shadow.content, 0);
    this.panel.add(this.shadow.content, this.plate, this.hatch.content);
    this.panel.add(this.pattern.content, stack(this.ball.content, 2), this.label);
    this.panel.add(stack(this.ring.content, 3));
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
    this.ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
    this.ball.set(checked, true);
    this.pattern.setSurface(checked ? YELLOW : TRAY);
    // Lit while picked, hovered or keyboard-focused (fx-hover); gold on the picked yellow plate.
    this.pattern.setFocused((checked || hovered || (focused && focusVisible)) && !locked);
    const hover = hovered && !checked && !locked;
    const press = pressed && !locked;
    this.panel.setProperties({
      backgroundColor: hover ? TRAY : undefined,
      borderColor: hover ? withOpacity(ICE, 0.35) : "transparent",
      transformScaleX: press ? 0.97 : 1,
      transformScaleY: press ? 0.97 : 1,
      transformTranslateY: press ? 1 : 0,
    });
    this.ink = locked ? "#7d93a8" : hover ? "#ffffff" : ICE;
    this.hatch.content.setProperties({ display: locked && !checked ? "flex" : "none" });
    const target = checked ? 1 : 0;
    if (target === this.litTarget) return this.applyLit();
    // The first paint lands on the state; later picks fade.
    const duration = this.litTarget < 0 ? 0 : 120;
    this.litTarget = target;
    this.stage.motion.animate(this.lit, { value: target }, duration, () => this.applyLit());
  }

  private applyLit(): void {
    const t = this.lit.value;
    fade(this.plate, t);
    fade(this.shadow.content, t);
    // UIKit compares colours by reference: a new one per change.
    this.label.setProperties({ color: new Color(this.ink).lerp(this.picked, t) });
    this.stage.invalidate();
  }

  /** Call after layout. */
  /** Touch rule: at least 44 host px tall at the stage's current scale (a minimum only). */
  fitTouch(): void {
    this.panel.setProperties({ minHeight: Math.max(44, this.stage.viewport.minTarget) });
  }

  update(deltaMs: number): void {
    this.sheen.update();
    this.hatch.update();
    this.pattern.update(deltaMs);
  }

  dispose(): void {
    this.stage.motion.cancel(this.lit);
    this.sheen.dispose();
    this.hatch.dispose();
    this.shadow.dispose();
    this.ring.dispose();
    this.pattern.dispose();
    this.ball.dispose();
  }
}
