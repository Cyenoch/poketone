import { Container, Text, withOpacity, type Content } from "@pmndrs/uikit";
import { Color, SRGBColorSpace } from "three";
import { BoxShadow, OutlineRing, plateShadow } from "./box-shadow";
import { cubicBezier, FocusMark, uiEaseOut } from "./focus-mark";
import { HoverPattern } from "./hover-pattern";
import { inheritedOpacity, stack } from "./layer";
import { RunButtonSurface } from "./run-overlays-surface";
import { HatchFill } from "./screen-parts";
import type { UiStage } from "./stage";

/** `.game-button` tones: the plate's fill, ink and border at rest. */
const tones = {
  secondary: { fill: "#e9f4fb", ink: "#142f50", border: "#142f50" },
  primary: { fill: "#ffd45b", ink: "#0d233f", border: "#142f50" },
  /** `.game-topline > .game-button`: a navy key with ice ink on the sky. */
  navy: { fill: "#142f50", ink: "#d8effb", border: "#92b8d1" },
  /** The lobby's keys on the scene: navy with the difficulty segments' dark edge (DESIGN.md). */
  scene: { fill: "#142f50", ink: "#d8effb", border: "#0a1c33" },
  /** `.game-close`: a navy-deep key with a 55% ice rim on a dialog's band. */
  close: { fill: "#0d233f", ink: "#ffffff", border: "#7f93a6" },
} as const;
const lit = { fill: "#ffd45b", ink: "#0d233f", border: "#142f50" };
/** `.game-button:disabled`: the disabled group in solid colours under the white hatch, on a 1px base. */
const off = { fill: "#d0dfeb", ink: "#657b91", border: "#9fb5c7" };
const css = (t: number) => cubicBezier(t, 0.25, 0.1, 0.25, 1);

export interface GameButtonOptions {
  tone: keyof typeof tones;
  /** `small`: 2px base, 44px; `normal`: 3px base, 50px; `cta`: 3px base, the launch bar's 60px. */
  size: "small" | "normal" | "cta";
  label?: string;
  icon?: Content;
  /** A square key holding only its icon (no Poké Ball cursor). */
  square?: boolean;
  /** A flat face (no sheen gradient) with a 14% white top line, as the lobby's raised segments. */
  flat?: boolean;
}

/**
 * ui/Button.tsx `.game-button` on the GPU: a raised plate (sheen and bevel) on a hard navy base, a
 * 2px border, an icon and a label. Hover and `:focus-visible` light it yellow (120ms) and show the
 * Poké Ball cursor on its left border; hover also lifts it 1px onto a deeper base; a press sinks it
 * onto the base and squashes it. `:focus-visible` adds the 3px yellow outline.
 */
export class GameButton {
  readonly panel: Container;
  private readonly label: Text | null;
  private readonly icon: Content | undefined;
  private readonly surface = new RunButtonSurface();
  private readonly hatch = new HatchFill(0.5, 6);
  private readonly shadow: BoxShadow;
  private readonly ring = new OutlineRing(8, "#ffd45b");
  /** The ball pattern over the lit (yellow) face, with the hover and the focus-visible light. */
  private readonly pattern: HoverPattern;
  private readonly cursor: FocusMark | null;
  private readonly stage: UiStage;
  private readonly tone: (typeof tones)[keyof typeof tones];
  private readonly baseDepth: number;
  private readonly height: number;
  private readonly square: boolean;
  private readonly paint = { lit: 0 };
  private readonly pose = { depth: 0, lift: 0, press: 0 };
  private hovered = false;
  private focused = false;
  private focusVisible = false;
  private pressed = false;
  private disabled = false;

  constructor(stage: UiStage, options: GameButtonOptions) {
    this.stage = stage;
    this.tone = tones[options.tone];
    this.baseDepth = options.size === "small" ? 2 : 3;
    this.pose.depth = this.baseDepth;
    const height = (this.height = options.size === "small" ? 44 : options.size === "cta" ? 60 : 50);
    this.square = options.square ?? false;
    this.panel = new Container({
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      flexShrink: 0,
      // Minimums only (a fixed size under a minimum breaks the parent's sizing); see fitTouch.
      minWidth: options.square ? height : 44,
      minHeight: height,
      paddingX: options.square ? 0 : options.size === "small" ? 16 : 22,
      paddingY: options.size === "small" ? 8 : 11,
      borderWidth: 2,
      borderRadius: 8,
      borderColor: this.tone.border,
      backgroundColor: this.tone.fill,
    });
    this.shadow = new BoxShadow(8, plateShadow(this.baseDepth));
    this.hatch.content.setProperties({ display: "none" });
    this.pattern = new HoverPattern(stage.motion, () => stage.invalidate(), lit.fill);
    this.panel.add(
      this.shadow.content,
      this.surface.content,
      this.hatch.content,
      this.pattern.content,
    );
    if (options.flat) {
      this.surface.content.setProperties({ display: "none" });
      this.panel.add(
        new Container({
          positionType: "absolute",
          positionLeft: 2,
          positionRight: 2,
          positionTop: 0,
          height: 1.5,
          backgroundColor: withOpacity("#ffffff", 0.14),
        }),
      );
    }
    this.icon = options.icon;
    if (options.icon) {
      options.icon.setProperties({ width: 24, height: 24, color: this.tone.ink });
      this.panel.add(stack(options.icon, 1));
    }
    this.label = options.label
      ? stack(
          new Text({
            text: options.label,
            fontSize: options.size === "small" ? 14 : 16,
            fontWeight: 800,
            color: this.tone.ink,
          }),
          1,
        )
      : null;
    if (this.label) this.panel.add(this.label);
    this.ring.content.setProperties({ display: "none" });
    this.panel.add(stack(this.ring.content, 2));
    this.cursor = options.square ? null : new FocusMark(stage.motion, () => stage.invalidate());
    if (this.cursor) {
      this.cursor.mesh.renderOrder = 30;
      stage.scene.add(this.cursor.mesh);
    }
  }

  /** Touch rule: at least 44 host px each way at the stage's current scale. Owners call it on resize. */
  fitTouch(): void {
    const target = this.stage.viewport.minTarget;
    this.panel.setProperties({
      minWidth: Math.max(this.square ? this.height : 44, target),
      minHeight: Math.max(this.height, target),
    });
  }

  setLabel(text: string): void {
    this.label?.setProperties({ text });
  }

  setHovered(hovered: boolean): void {
    if (hovered === this.hovered) return;
    this.hovered = hovered;
    this.apply();
  }

  setFocused(focused: boolean): void {
    if (focused === this.focused) return;
    this.focused = focused;
    this.apply();
  }

  setFocusVisible(visible: boolean): void {
    if (visible === this.focusVisible) return;
    this.focusVisible = visible;
    this.apply();
  }

  setPressed(pressed: boolean): void {
    if (pressed === this.pressed) return;
    this.pressed = pressed;
    this.apply();
  }

  /** Unavailable: the disabled look; it neither lights nor sinks, and its owner skips it on Tab. */
  setDisabled(disabled: boolean): void {
    if (disabled === this.disabled) return;
    this.disabled = disabled;
    this.hatch.content.setProperties({ display: disabled ? "flex" : "none" });
    this.apply();
  }

  private apply(): void {
    const keyed = this.focused && this.focusVisible && !this.disabled;
    const on = (this.hovered || keyed) && !this.disabled;
    this.ring.content.setProperties({ display: keyed ? "flex" : "none" });
    this.cursor?.setFocused(on);
    this.pattern.setFocused(on);
    this.stage.motion.animate(this.paint, { lit: on ? 1 : 0 }, 120, () => this.repaint(), css);
    const pressed = this.pressed && !this.disabled,
      hovered = this.hovered && !this.disabled;
    this.surface.setPressed(pressed);
    const depth = this.disabled ? 1 : pressed ? 0 : hovered ? this.baseDepth + 1 : this.baseDepth;
    this.stage.motion.animate(
      this.pose,
      { depth, lift: hovered && !pressed ? -1 : 0, press: pressed ? 1 : 0 },
      pressed ? 60 : 140,
      () => {
        this.shadow.set(plateShadow(this.pose.depth, this.disabled ? off.border : undefined));
        this.panel.setProperties({
          transformTranslateY: this.pose.lift + 3 * this.pose.press,
          transformScaleX: 1 + 0.012 * this.pose.press,
          transformScaleY: 1 - 0.03 * this.pose.press,
        });
        this.stage.invalidate();
      },
      uiEaseOut,
    );
  }

  private repaint(): void {
    const t = this.paint.lit;
    const mix = (from: string, to: string) => {
      const a = new Color(from).convertLinearToSRGB(),
        b = new Color(to).convertLinearToSRGB();
      return new Color().setRGB(
        a.r + (b.r - a.r) * t,
        a.g + (b.g - a.g) * t,
        a.b + (b.b - a.b) * t,
        SRGBColorSpace,
      );
    };
    const rest = this.disabled ? off : this.tone;
    const ink = mix(rest.ink, lit.ink);
    this.panel.setProperties({
      backgroundColor: mix(rest.fill, lit.fill),
      borderColor: mix(rest.border, lit.border),
    });
    this.label?.setProperties({ color: ink });
    this.icon?.setProperties({ color: ink });
    this.stage.invalidate();
  }

  /** Sizes the plate and places the cursor on the left border; call after layout, once a frame
   *  with the frame's time (the pattern drifts by it). */
  update(deltaMs: number): void {
    this.pattern.update(deltaMs);
    this.surface.update();
    this.hatch.update();
    const matrix = this.panel.globalMatrix.value,
      size = this.panel.size.value;
    if (!this.cursor || !matrix || !size) return;
    this.cursor.setParentOpacity(inheritedOpacity(this.panel));
    this.cursor.mesh.visible = this.panel.isVisible.value && !this.panel.isClipped.value;
    this.cursor.mesh.position.set(matrix.elements[12]! - size[0] / 2, matrix.elements[13]!, 0.1);
  }

  dispose(): void {
    this.stage.motion.cancel(this.paint);
    this.stage.motion.cancel(this.pose);
    this.cursor?.dispose();
    this.ring.dispose();
    this.pattern.dispose();
    this.shadow.dispose();
    this.surface.dispose();
    this.hatch.dispose();
  }
}
