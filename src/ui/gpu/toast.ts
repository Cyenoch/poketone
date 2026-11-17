import { type NavigationAction } from "../../platform/input";
import { Container, Text, type FontFamilies } from "@pmndrs/uikit";
import { Matrix4, Vector3 } from "three";
import { UiStage } from "./stage";
import { GameButton } from "./game-button";
import { createMenuIcon } from "./icons";
import { SlantPlate } from "./slant-plate";
import type { UiInsets } from "./viewport";
import { fade, stack } from "./layer";
import { EASE } from "./motion";
import { HARD_SHADOW, ui } from "./tokens";

/** A notice: chevron, a small upright ink plate at the bottom centre. A hint (the share key it names):
 *  beside the screen's primary actions, on the left at mid height, so it covers none of them. */
export type ToastKind = "notice" | "hint";

/** Host-independent notification overlay. Host routes hover/focus separately from pointer presses. */
export class GpuToast {
  readonly stage = new UiStage();
  private readonly ribbon: Container;
  private readonly messageText: Text;
  private readonly close: GameButton;
  private readonly marks = { notice: createMenuIcon("chevron"), hint: createMenuIcon("upload") };
  private kind: ToastKind = "notice";
  private readonly plate: SlantPlate;
  private readonly fade = { opacity: 0 };
  private readonly transform = { y: 16, scale: 0.92 };
  private readonly point = new Vector3();
  private readonly inverse = new Matrix4();
  private message: string | null = null;
  private duration = 3000;
  private remaining = 3000;
  private hovered = false;
  private closeHovered = false;
  private focused = false;
  private pressed = false;
  private safeArea: UiInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private exiting = 0;
  private dismissed = false;

  private readonly onDismiss: () => void;

  constructor(fonts: FontFamilies, onDismiss: () => void) {
    this.onDismiss = onDismiss;
    this.stage.root.setProperties({
      fontFamilies: fonts,
      alignItems: "center",
      justifyContent: "flex-end",
      flexDirection: "column",
    });
    this.ribbon = fade(
      new Container({
        maxWidth: 640,
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        paddingY: 6,
        paddingLeft: 16,
        paddingRight: 6,
        gap: 12,
        display: "none",
      }),
      0,
    );
    this.plate = new SlantPlate(this.ribbon, { fill: ui.ink, upright: true });
    this.plate.set({ depth: HARD_SHADOW.offset });
    this.ribbon.add(this.plate.content);
    for (const icon of Object.values(this.marks)) {
      icon.setProperties({ width: 20, height: 20, color: ui.white });
      this.ribbon.add(stack(icon, 1));
    }
    this.marks.hint.setProperties({ display: "none" });
    this.messageText = stack(
      new Text({
        text: "",
        color: ui.white,
        fontSize: 16,
        fontWeight: 700,
        flexShrink: 1,
        minWidth: 0,
      }),
      1,
    );
    this.close = new GameButton(this.stage, {
      tone: "secondary",
      size: "small",
      square: true,
      icon: createMenuIcon("close"),
    });
    this.ribbon.add(this.messageText, stack(this.close.panel, 1));
    this.stage.root.add(this.ribbon);
  }

  /** Showing a message or still playing its exit. */
  get visible(): boolean {
    return this.message !== null || this.exiting > 0;
  }

  setMessage(message: string | null, duration = 3000, kind: ToastKind = "notice"): void {
    if (this.message === message && this.duration === duration && this.kind === kind) return;
    const wasVisible = this.message !== null;
    this.duration = duration;
    this.remaining = duration;
    this.message = message;
    this.dismissed = false;
    if (message !== null) {
      this.messageText.setProperties({ text: message });
      this.kind = kind;
      for (const [name, icon] of Object.entries(this.marks))
        icon.setProperties({ display: name === kind ? "flex" : "none" });
      const hint = kind === "hint";
      this.stage.root.setProperties({
        alignItems: hint ? "flex-start" : "center",
        justifyContent: hint ? "center" : "flex-end",
      });
      this.ribbon.setProperties({ maxWidth: hint ? "50%" : 640, display: "flex" });
      this.exiting = 0;
      if (!wasVisible) this.animateVisibility(true);
    } else {
      this.hovered = false;
      this.closeHovered = false;
      this.focused = false;
      this.setPressed(null);
      this.paintClose();
      if (wasVisible) this.animateVisibility(false);
    }
    this.stage.invalidate();
  }

  private animateVisibility(visible: boolean): void {
    this.exiting = visible ? 0 : 220;
    this.stage.motion.animate(
      this.fade,
      { opacity: visible ? 1 : 0 },
      140,
      () => {
        fade(this.ribbon, this.fade.opacity);
        this.stage.invalidate();
      },
      EASE,
    );
    this.stage.motion.animate(
      this.transform,
      { y: visible ? 0 : 12, scale: 1 },
      220,
      () => {
        this.ribbon.setProperties({
          transformTranslateY: this.transform.y,
          transformScaleX: this.transform.scale,
        });
        this.stage.invalidate();
      },
      EASE,
    );
  }

  resize(width: number, height: number, scale: number, safeArea: UiInsets = this.safeArea): void {
    this.safeArea = { ...safeArea };
    this.stage.resize(width, height, scale, safeArea);
    const v = this.stage.viewport,
      narrow = v.width <= 520,
      compact = v.height <= 480 && v.width > v.height;
    this.stage.root.setProperties({
      paddingLeft: 16 + v.safeArea.left,
      paddingRight: 16 + v.safeArea.right,
      paddingTop: 16 + v.safeArea.top,
      paddingBottom: Math.max(22, v.safeArea.bottom),
    });
    this.ribbon.setProperties({ paddingY: compact ? 4 : 6, gap: narrow ? 8 : 12 });
    this.close.fitTouch();
    this.messageText.setProperties({ fontSize: narrow || compact ? 15 : 16 });
    this.stage.invalidate();
  }

  /** Index 0 is the close key; index 1 is the ribbon's hover area and never activates. */
  hit(x: number, y: number): number {
    if (this.message === null) return -1;
    return this.contains(this.close.panel, x, y) ? 0 : this.contains(this.ribbon, x, y) ? 1 : -1;
  }

  private contains(panel: Container, x: number, y: number): boolean {
    const matrix = panel.globalMatrix.value,
      size = panel.size.value;
    if (!matrix || !size || panel.isClipped.value) return false;
    this.point
      .set(
        x / this.stage.viewport.scale + this.stage.camera.left,
        this.stage.camera.top - y / this.stage.viewport.scale,
        0,
      )
      .applyMatrix4(this.inverse.copy(matrix).invert());
    return Math.abs(this.point.x) <= size[0] / 2 && Math.abs(this.point.y) <= size[1] / 2;
  }

  setHovered(index: number | null): void {
    this.hovered = this.message !== null && index !== null && index >= 0;
    const closeHovered = this.hovered && index === 0;
    if (closeHovered === this.closeHovered) return;
    this.closeHovered = closeHovered;
    this.paintClose();
  }

  /** The close key holds the keyboard. */
  get keyed(): boolean {
    return this.focused;
  }

  focus(index: number | null): void {
    this.focused = this.message !== null && index === 0;
    this.paintClose();
  }

  /** The close key holds the keyboard only, so its focus is always shown. */
  private paintClose(): void {
    this.close.setHovered(this.closeHovered);
    this.close.setFocused(this.focused);
    this.close.setFocusVisible(this.focused);
    this.close.setPressed(this.pressed);
  }

  setPressed(index: number | null): void {
    const next = this.message !== null && index === 0;
    if (this.pressed === next) return;
    this.pressed = next;
    this.paintClose();
  }

  activate(index: number): void {
    if (index === 0) this.dismiss();
  }

  navigate(action: NavigationAction): boolean {
    if (!this.focused || this.message === null) return false;
    if (action === "confirm") {
      this.dismiss();
      return true;
    }
    return false;
  }

  private dismiss(): void {
    if (this.message === null || this.dismissed) return;
    this.dismissed = true;
    this.onDismiss();
  }

  afterLayout(deltaMs: number): void {
    if (this.exiting > 0) {
      this.exiting = Math.max(0, this.exiting - deltaMs);
      if (this.exiting === 0) {
        this.ribbon.setProperties({ display: "none" });
        this.transform.y = 16;
        this.transform.scale = 0.92;
        this.ribbon.setProperties({
          transformTranslateY: this.transform.y,
          transformScaleX: this.transform.scale,
        });
        this.stage.invalidate();
      }
    }
    if (
      this.message !== null &&
      this.duration > 0 &&
      !this.hovered &&
      !this.focused &&
      !this.dismissed
    ) {
      this.remaining = Math.max(0, this.remaining - deltaMs);
      if (this.remaining === 0) this.dismiss();
    }
  }

  dispose(): void {
    this.close.dispose();
    this.plate.dispose();
    this.stage.dispose();
  }
}
