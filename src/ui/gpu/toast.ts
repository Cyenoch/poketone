import { type NavigationAction } from "../../platform/input";
import { Container, Text, withOpacity, type FontFamilies } from "@pmndrs/uikit";
import { Matrix4, Vector3 } from "three";
import { UiStage } from "./stage";
import { cubicBezier, uiEaseOut } from "./focus-mark";
import { createMenuIcon } from "./icons";
import { ToastSurface } from "./toast-surface";
import type { UiInsets } from "./viewport";
import { fade, stack } from "./layer";
import { OutlineRing } from "./box-shadow";

const closeBorder = withOpacity("#d8effb", 0.55);
/** A notice: chevron, a wide ribbon at the bottom. A hint (the share key it names): beside the
 *  screen's primary actions, on the left at mid height, so it covers none of them. */
export type ToastKind = "notice" | "hint";

/** Host-independent notification overlay. Host routes hover/focus separately from pointer presses. */
export class GpuToast {
  readonly stage = new UiStage();
  private readonly ribbon: Container;
  private readonly messageText: Text;
  private readonly textShadow: Text;
  private readonly close: Container;
  private readonly closeIcon = createMenuIcon("close");
  private readonly marks = { notice: createMenuIcon("chevron"), hint: createMenuIcon("upload") };
  private kind: ToastKind = "notice";
  private readonly focusRing = new OutlineRing(8, "#ffd45b");
  private readonly surface = new ToastSurface("ribbon");
  private readonly medallion = new ToastSurface("medallion");
  private readonly fade = { opacity: 0 };
  private readonly transform = { y: 16, scale: 0.92 };
  private readonly press = { y: 0, x: 1, sy: 1 };
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
        width: 820,
        maxWidth: "100%",
        minHeight: 72,
        flexDirection: "row",
        alignItems: "center",
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 22,
        paddingRight: 30,
        gap: 14,
        color: "#ffffff",
        fontWeight: 700,
        display: "none",
      }),
      0,
    );
    this.ribbon.add(this.surface.content);
    const mark = stack(
      new Container({
        width: 38,
        height: 38,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
      }),
      1,
    );
    mark.add(this.medallion.content);
    for (const icon of Object.values(this.marks)) {
      stack(icon, 2).setProperties({ color: "#0d233f" });
      mark.add(icon);
    }
    this.marks.hint.setProperties({ display: "none" });
    const copy = stack(new Container({ flexGrow: 1, flexShrink: 1, minWidth: 0 }), 1);
    this.textShadow = new Text({
      text: "",
      color: "#0d233f",
      fontSize: 18,
      fontWeight: 700,
      positionType: "absolute",
      positionLeft: 0,
      positionTop: 0,
      width: "100%",
      height: "100%",
      transformTranslateY: 2,
    });
    this.messageText = stack(
      new Text({
        text: "",
        color: "#ffffff",
        fontSize: 18,
        fontWeight: 700,
      }),
      1,
    );
    copy.add(this.textShadow, this.messageText);
    this.close = stack(
      new Container({
        width: 44,
        height: 44,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0d233f",
        borderColor: closeBorder,
        borderWidth: 2,
        borderRadius: 8,
      }),
      1,
    );
    this.closeIcon.setProperties({ width: 18, height: 18, color: "#ffffff" });
    this.focusRing.content.setProperties({ display: "none" });
    this.close.add(this.closeIcon, stack(this.focusRing.content, 2));
    this.ribbon.add(mark, copy, this.close);
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
      this.textShadow.setProperties({ text: message });
      this.kind = kind;
      for (const [name, icon] of Object.entries(this.marks))
        icon.setProperties({ display: name === kind ? "flex" : "none" });
      const hint = kind === "hint";
      this.stage.root.setProperties({
        alignItems: hint ? "flex-start" : "center",
        justifyContent: hint ? "center" : "flex-end",
      });
      this.ribbon.setProperties({ width: hint ? "auto" : 820, maxWidth: hint ? "50%" : "100%" });
      this.ribbon.setProperties({ display: "flex" });
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
      (t) => cubicBezier(t, 0, 0, 0.58, 1),
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
      uiEaseOut,
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
    this.ribbon.setProperties({
      minHeight: narrow ? 64 : compact ? 56 : 72,
      paddingLeft: narrow ? 18 : 22,
      paddingRight: narrow ? 22 : 30,
      paddingY: narrow ? 8 : compact ? 4 : 10,
      gap: narrow ? 8 : 14,
    });
    this.close.setProperties({ minWidth: v.minTarget, minHeight: v.minTarget });
    const fontSize = Math.max(16, Math.min(19, 14.4 + v.width * 0.003));
    this.messageText.setProperties({ fontSize });
    this.textShadow.setProperties({ fontSize });
    this.stage.invalidate();
  }

  /** Index 0 is the close key; index 1 is the ribbon's hover area and never activates. */
  hit(x: number, y: number): number {
    if (this.message === null) return -1;
    return this.contains(this.close, x, y) ? 0 : this.contains(this.ribbon, x, y) ? 1 : -1;
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

  private paintClose(): void {
    const highlighted = this.focused || this.closeHovered;
    this.close.setProperties({
      backgroundColor: highlighted ? "#ffd45b" : "#0d233f",
      borderColor: highlighted ? "#0d233f" : closeBorder,
    });
    this.closeIcon.setProperties({ color: highlighted ? "#0d233f" : "#ffffff" });
    this.focusRing.content.setProperties({ display: this.focused ? "flex" : "none" });
    this.stage.invalidate();
  }

  setPressed(index: number | null): void {
    const next = this.message !== null && index === 0;
    if (this.pressed === next) return;
    this.pressed = next;
    this.applyPressed();
  }

  private applyPressed(): void {
    this.stage.motion.animate(
      this.press,
      {
        y: this.pressed ? 2 : 0,
        x: this.pressed ? 1.012 : 1,
        sy: this.pressed ? 0.96 : 1,
      },
      this.pressed ? 60 : 140,
      () => {
        this.close.setProperties({
          transformTranslateY: this.press.y,
          transformScaleX: this.press.x,
          transformScaleY: this.press.sy,
        });
        this.stage.invalidate();
      },
      uiEaseOut,
    );
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
    const size = this.ribbon.size.value;
    if (size) this.surface.resize(size[0], size[1]);
    this.medallion.resize(38, 38);
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
    this.surface.dispose();
    this.medallion.dispose();
    this.focusRing.dispose();
    this.stage.dispose();
  }
}
