import { Container, Text, type Content } from "@pmndrs/uikit";
import { Color } from "three";
import { ballGlyph } from "./ball";
import { stack } from "./layer";
import { idleTicked, LIFT, SNAP, SWEEP_START, sweepAt } from "./motion";
import { RING_ROOM, SlantPlate } from "./slant-plate";
import type { UiStage } from "./stage";
import { HARD_SHADOW, slantOf, ui } from "./tokens";

/** Faces: primary Poké Ball red with the ball mark and the periodic light sweep; secondary white
 *  with an ink frame; ink a dark key. */
const looks = {
  primary: { fill: ui.ball, ink: ui.white },
  secondary: { fill: ui.white, ink: ui.ink },
  ink: { fill: ui.ink, ink: ui.white },
} as const;
type Look = keyof typeof looks;
/** Earlier tone names, drawn as their redesign look until their screens move to the three above. */
const legacy = { navy: "ink", scene: "ink", close: "ink" } as const satisfies Record<string, Look>;
const off = { fill: ui.mist, ink: ui.muted };

export interface GameButtonOptions {
  tone: Look | keyof typeof legacy;
  /** `small` 44, `normal` 50, `cta` 58 tall. */
  size: "small" | "normal" | "cta";
  label?: string;
  icon?: Content;
  /** A key holding only its icon. */
  square?: boolean;
  /** Overrides the default stance: only the primary CTA slants, every other key stands upright. */
  upright?: boolean;
  /** Unused by the redesign (every face is flat). */
  flat?: boolean;
}

/**
 * The game's key: the primary CTA slants (skewX(−14°), upright content), every other look stands
 * upright; all carry the hard shadow. Hover lifts it 3px (the primary
 * instead nudges 4px left), a press sinks it 1px, both SNAP; keyboard focus shows the ink ring that
 * follows the slant. The primary face carries the ball mark and a 650ms light sweep every 4.2s (stepped
 * on the 30Hz idle clock only while it crosses). Disabled: a mist face with muted ink.
 */
export class GameButton {
  readonly panel: Container;
  private readonly label: Text | null;
  private readonly icon: Content | undefined;
  private readonly plate: SlantPlate;
  private readonly glyph: ReturnType<typeof ballGlyph> | null;
  private readonly stage: UiStage;
  private readonly look: Look;
  private readonly height: number;
  private readonly square: boolean;
  private readonly lean: number;
  private readonly room: number;
  private readonly pose = { x: 0, y: 0, depth: HARD_SHADOW.offset, focus: 0 };
  private elapsed = 0;
  private shine = -1;
  private hovered = false;
  private focused = false;
  private focusVisible = false;
  private pressed = false;
  private disabled = false;

  constructor(stage: UiStage, options: GameButtonOptions) {
    this.stage = stage;
    this.look =
      options.tone in legacy ? legacy[options.tone as keyof typeof legacy] : (options.tone as Look);
    const look = looks[this.look];
    const height = (this.height = options.size === "small" ? 44 : options.size === "cta" ? 58 : 50);
    this.square = options.square ?? false;
    const upright = options.upright ?? this.look !== "primary";
    const lean = (this.lean = upright ? 0 : slantOf(height) / 2);
    // A slanted key's lean carries its focus ring past a column's edge: it keeps the ring inside its
    // own box (the plate drawn that much narrower, the padding grown by the same, content centred).
    const room = (this.room = upright || options.square ? 0 : RING_ROOM);
    const padding =
      room +
      (options.square ? 0 : options.size === "small" ? 14 : options.size === "cta" ? 30 : 20);
    this.panel = new Container({
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: options.size === "cta" ? 12 : 8,
      flexShrink: 0,
      // Minimums only (a fixed size under a minimum breaks the parent's sizing); see fitTouch.
      minWidth: options.square ? height + 2 * lean : 44 + 2 * room,
      minHeight: height,
      paddingLeft: padding + lean,
      paddingRight: padding + lean,
    });
    this.plate = new SlantPlate(this.panel, {
      fill: look.fill,
      border: this.look === "secondary" ? { color: ui.ink, width: 2 } : undefined,
      upright,
      insetX: room,
    });
    this.panel.add(this.plate.content);
    this.glyph =
      this.look === "primary" && !options.square
        ? ballGlyph(options.size === "small" ? 20 : options.size === "cta" ? 30 : 24)
        : null;
    if (this.glyph) this.panel.add(stack(this.glyph.glyph, 1));
    this.icon = options.icon;
    if (options.icon) {
      options.icon.setProperties({ width: 24, height: 24, color: look.ink });
      this.panel.add(stack(options.icon, 1));
    }
    this.label = options.label
      ? stack(
          new Text({
            text: options.label,
            fontSize: options.size === "small" ? 14 : options.size === "cta" ? 26 : 16,
            fontWeight: 800,
            letterSpacing: options.size === "cta" ? 6 : 0.5,
            color: look.ink,
          }),
          1,
        )
      : null;
    if (this.label) this.panel.add(this.label);
  }

  /** Touch rule: at least 44 host px each way at the stage's current scale. Owners call it on resize. */
  fitTouch(): void {
    const target = this.stage.viewport.minTarget;
    this.panel.setProperties({
      minWidth: Math.max(this.square ? this.height + 2 * this.lean : 44, target) + 2 * this.room,
      minHeight: Math.max(this.height, target),
    });
  }

  setLabel(text: string): void {
    this.label?.setProperties({ text });
  }

  setHovered(hovered: boolean): void {
    if (hovered === this.hovered) return;
    this.hovered = hovered;
    // A hover catches one sweep at once.
    if (hovered && this.look === "primary" && this.shine < 0) this.elapsed = SWEEP_START;
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

  /** Unavailable: a mist face; it neither lifts nor sinks, and its owner skips it on Tab. */
  setDisabled(disabled: boolean): void {
    if (disabled === this.disabled) return;
    this.disabled = disabled;
    const look = disabled ? off : looks[this.look];
    this.plate.set({ fill: look.fill, border: disabled ? ui.line : ui.ink });
    // UIKit compares colours by reference: a new one per change.
    this.label?.setProperties({ color: new Color(look.ink) });
    this.icon?.setProperties({ color: new Color(look.ink) });
    this.glyph?.glyph.setProperties({ display: disabled ? "none" : "flex" });
    // A sweep caught mid-cross must not stay on the grey face.
    this.shine = -1;
    this.plate.set({ shine: -1 });
    this.apply();
  }

  private apply(): void {
    const live = !this.disabled;
    const pressed = this.pressed && live,
      hovered = this.hovered && live && !pressed;
    const primary = this.look === "primary";
    const ring = this.focused && this.focusVisible && live;
    const lift = hovered && !primary ? LIFT.hover : 0;
    this.stage.motion.animate(
      this.pose,
      {
        // The nudge would carry a visible focus ring past the reserved room.
        x: hovered && primary && !ring ? -4 : 0,
        y: pressed ? LIFT.press : -lift,
        depth: pressed ? HARD_SHADOW.offset - LIFT.press : HARD_SHADOW.offset + lift,
        focus: ring ? 1 : 0,
      },
      primary && hovered ? 150 : LIFT.ms,
      () => {
        this.panel.setProperties({
          transformTranslateX: this.pose.x,
          transformTranslateY: this.pose.y,
        });
        this.plate.set({ depth: this.pose.depth, focus: this.pose.focus });
        this.stage.invalidate();
      },
      SNAP,
    );
  }

  /** Call once a frame with the frame's time: steps the primary's light sweep. */
  update(deltaMs: number): void {
    if (this.look !== "primary" || this.disabled) return;
    this.elapsed += deltaMs;
    const shine = sweepAt(this.elapsed);
    if (shine === this.shine || (shine >= 0 && !idleTicked(30))) return;
    this.shine = shine;
    this.plate.set({ shine });
    this.stage.invalidate();
  }

  dispose(): void {
    this.stage.motion.cancel(this.pose);
    this.glyph?.dispose();
    this.plate.dispose();
  }
}
