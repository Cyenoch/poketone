import { FullscreenIcon } from "./fullscreen-icon";
import { type NavigationAction } from "../../platform/input";
import { InputGlyph } from "./input-glyph";
import { revealInScroller } from "./scroll-reveal";
import { LEGAL_NOTICE } from "../../legalNotice";
import { wrapLines } from "./text-fit";
import { idleTicked } from "./motion";
import { Container, Text, withOpacity, type FontFamilies } from "@pmndrs/uikit";
import { Color, Matrix4, SRGBColorSpace, Vector3 } from "three";
import { type Settings, uiScaleRange } from "../../settings";
import { UiStage } from "./stage";
import { fitScale, type UiInsets } from "./viewport";
import { createMenuIcon } from "./icons";
import { cubicBezier, uiEaseOut } from "./focus-mark";
import { DialogSurface } from "./dialog-surface";
import { DialogBackdrop } from "./dialog-backdrop";
import { HoverPattern } from "./hover-pattern";
import { fade, stack } from "./layer";
import { BoxShadow, OutlineRing, plateShadow } from "./box-shadow";

interface SettingsDialogOptions {
  settings: Settings;
  onChange(settings: Settings): void;
  onClose(): void;
  onFocusChange?: () => void;
  onSave?: () => void;
}

const controlIndex = {
  close: 0,
  sound: 1,
  devMode: 2,
  minus: 3,
  reset: 4,
  plus: 5,
  save: 6,
} as const;

interface Control {
  panel: Container;
  activate(): void;
  enabled(): boolean;
  /** The ball pattern, lit with the control (hovered or keyboard-focused). */
  pattern: HoverPattern;
}

/** Separate UI pass owns modal input and clipping without changing the underlying menu state. */
export class SettingsDialog {
  readonly stage = new UiStage();
  /** Its window at the compact size: the 560 panel with all rows, in a 16px margin (fitScale). */
  readonly minLayout = { width: 592, height: 360 };
  private readonly panel: Container;
  private readonly body: Container;
  private compact = false;
  /** The legal line: the lobby shows it on wide screens, this window in short landscape. */
  private readonly legal = new Text({
    text: LEGAL_NOTICE,
    fontSize: 11,
    lineHeight: "145%",
    fontWeight: 500,
    color: "#536b82",
    width: "100%",
    wordBreak: "keep-all",
    whiteSpace: "pre-line",
    flexShrink: 0,
  });
  private squeezed = false;
  private sizedFor = "";
  private readonly header: Container;
  private readonly fullscreen: Container;
  private toggleFullscreen: (() => void) | undefined;
  private readonly fullscreenIcon = new FullscreenIcon();
  private readonly title: Text;
  private readonly titleShadow: Text;
  private readonly focusRings: (OutlineRing | null)[] = [];
  private focusVisible = true;
  private pressed: number | null = null;
  private readonly closeTransform = { y: 0, xScale: 1, yScale: 1, press: 0 };
  private readonly linearColor = new Color();
  private readonly colors = new Map<
    object,
    Map<string, { target: string; value: { r: number; g: number; b: number; a: number } }>
  >();
  private readonly backdrop = new DialogBackdrop();
  private safeArea: UiInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private switchTravel = 51;
  private readonly controls: Control[] = [];
  private readonly surfaces: DialogSurface[] = [];
  private readonly shadows: BoxShadow[] = [];
  private readonly closeIcon: ReturnType<typeof createMenuIcon>;
  private readonly closeBadge: Container;
  private readonly closeBevel: Container;
  private readonly closeBase: Container;
  private readonly switches: {
    key: "sound" | "devMode";
    knob: Container;
    track: Container;
    off: Text;
    on: Text;
    position: { x: number };
    index: number;
  }[] = [];
  private readonly scaleLabel: Text;
  private readonly scaleRow: Container;
  private hovered: number | null = null;
  private readonly point = new Vector3();
  private readonly inverse = new Matrix4();
  private readonly options: SettingsDialogOptions;
  private settings: Settings;
  private selected: number = controlIndex.close;
  private needsReveal = true;
  private lastLayout = "";
  private readonly transform = { y: 14, scale: 0.98 };
  private readonly fade = { opacity: 0 };
  private closing = false;
  private exitRemaining = 0;
  get exitFinished(): boolean {
    return this.closing && this.exitRemaining <= 0;
  }
  private width = 1;
  private height = 1;

  constructor(fonts: FontFamilies, options: SettingsDialogOptions) {
    this.options = options;
    this.settings = { ...options.settings };
    this.stage.root.setProperties({
      fontFamilies: fonts,
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    });
    this.stage.scene.add(this.backdrop.dim, this.backdrop.shadow);
    this.panel = new Container({
      width: 560,
      maxWidth: "100%",
      maxHeight: "100%",
      flexDirection: "column",
      backgroundColor: "#e9f4fb",
      borderColor: "#0d233f",
      borderWidth: 3,
      borderRadius: 12,
      padding: 4,
      minHeight: 0,
    });
    const header = (this.header = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 18,
      backgroundColor: "#173f70",
      paddingLeft: 20,
      paddingRight: 10,
      paddingY: 8,
      flexShrink: 0,
    }));
    const band = new DialogSurface("header");
    this.surfaces.push(band);
    header.add(band.content);
    const titleBox = stack(new Container({ flexGrow: 1, minWidth: 0 }), 1);
    this.titleShadow = stack(
      new Text({
        text: "设置",
        color: "#0d233f",
        fontSize: 22,
        fontWeight: 800,
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 0,
        width: "100%",
        height: "100%",
        transformTranslateY: 2,
      }),
      1,
    );
    this.title = stack(
      new Text({
        text: "设置",
        color: "#ffffff",
        fontSize: 22,
        fontWeight: 800,
        flexGrow: 1,
      }),
      2,
    );
    titleBox.add(this.titleShadow, this.title);
    header.add(titleBox);
    // Sizes are minimums: the touch rule (minTarget) may raise them, and a fixed size under a
    // larger min-height is laid out at the min but counted at the fixed size by its parent.
    const close = this.addControl(() => options.onClose(), {
      minWidth: 44,
      minHeight: 44,
      backgroundColor: "#0d233f",
      borderColor: "#92b8d1",
      borderWidth: 2,
    });
    stack(close, 1);
    this.closeBase = new Container({
      positionType: "absolute",
      positionLeft: -2,
      positionRight: -2,
      positionBottom: -5,
      height: 3,
      borderBottomLeftRadius: 8,
      borderBottomRightRadius: 8,
      backgroundColor: withOpacity("#000000", 0.35),
    });
    this.closeBevel = new Container({
      positionType: "absolute",
      positionLeft: 0,
      positionRight: 0,
      positionTop: 0,
      height: 2,
      borderTopLeftRadius: 6,
      borderTopRightRadius: 6,
      backgroundColor: withOpacity("#ffffff", 0.14),
    });
    close.add(this.closeBase, this.closeBevel);
    const closeIcon = (this.closeIcon = createMenuIcon("close"));
    closeIcon.setProperties({ color: "#ffffff" });
    close.add(closeIcon);
    this.closeBadge = new Container({
      positionType: "absolute",
      positionRight: -6,
      positionBottom: -6,
      paddingX: 4,
      paddingY: 1,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: "#0d233f",
      backgroundColor: "#d8effb",
    });
    this.closeBadge.add(new InputGlyph("cancel", "Esc"));
    close.add(stack(this.closeBadge, 3));
    header.add(close);
    this.body = new Container({
      paddingX: 18,
      paddingY: 24,
      gap: 10,
      flexDirection: "column",
      overflow: "scroll",
      flexShrink: 1,
      minHeight: 0,
      scrollbarWidth: 3,
      scrollbarColor: "#173f70",
    });
    for (const [key, label] of [
      ["sound", "声音"],
      ["devMode", "开发者模式"],
    ] as const) {
      const row = this.addControl(
        () => this.changeBoolean(key, !this.settings[key]),
        {
          width: "100%",
          minHeight: 66,
          paddingX: 14,
          paddingY: 12,
          flexDirection: "row",
          gap: 24,
          // `.game-toggle`: a transparent 1px border; the line under it is the child below.
          borderWidth: 1,
          borderColor: "transparent",
          borderRadius: 6,
        },
        undefined,
        // A switch row stays pale when hovered (navy only under keyboard focus).
        "#e9f4fb",
      );
      row.add(
        new Container({
          positionType: "absolute",
          positionLeft: 0,
          positionRight: 0,
          positionBottom: 0,
          height: 1,
          backgroundColor: "#92b8d1",
        }),
      );
      const copy = new Container({
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        flexDirection: "column",
        gap: 4,
      });
      copy.add(new Text({ text: label, fontSize: 16, fontWeight: 800 }));
      const track = new Container({
        width: 112,
        height: 40,
        flexShrink: 0,
        flexDirection: "row",
        padding: 3,
        borderWidth: 2,
        borderColor: "#142f50",
        borderRadius: 8,
        backgroundColor: "#0d233f",
      });
      const well = new DialogSurface("track");
      this.surfaces.push(well);
      track.add(well.content);
      const knob = new Container({
        positionType: "absolute",
        positionLeft: 3,
        positionTop: 3,
        width: 51,
        height: 30,
        borderRadius: 5,
        backgroundColor: "#c9dae7",
      });
      const surface = new DialogSurface("knob");
      this.surfaces.push(surface);
      knob.add(surface.content);
      track.add(knob);
      const off = new Text({
        text: "关",
        width: "50%",
        height: "100%",
        textAlign: "center",
        fontSize: 15,
        fontWeight: 800,
      });
      const on = new Text({
        text: "开",
        width: "50%",
        height: "100%",
        textAlign: "center",
        fontSize: 15,
        fontWeight: 800,
      });
      track.add(off, on);
      row.add(copy, track);
      this.body.add(row);
      this.switches.push({
        key,
        knob,
        track,
        off,
        on,
        position: { x: this.settings[key] ? 51 : 0 },
        index: this.controls.length - 1,
      });
    }
    // A row like the switches: the label, then a stepper on the same navy well (− value +); the
    // value resets to 100%.
    const scaleRow = (this.scaleRow = new Container({
      width: "100%",
      minHeight: 66,
      paddingX: 14,
      paddingY: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 24,
      flexShrink: 0,
    }));
    scaleRow.add(
      new Container({
        positionType: "absolute",
        positionLeft: 0,
        positionRight: 0,
        positionBottom: 0,
        height: 1,
        backgroundColor: "#92b8d1",
      }),
      new Text({ text: "界面缩放", fontSize: 16, fontWeight: 800, flexGrow: 1, flexShrink: 1 }),
    );
    const stepper = new Container({
      flexDirection: "row",
      flexShrink: 0,
      padding: 2,
      gap: 2,
      borderWidth: 2,
      borderColor: "#142f50",
      borderRadius: 8,
      backgroundColor: "#0d233f",
    });
    const well = new DialogSurface("track");
    this.surfaces.push(well);
    stepper.add(well.content);
    const segment = (activate: () => void, enabled?: () => boolean) =>
      this.addControl(
        activate,
        { width: 44, borderWidth: 0, borderRadius: 5, backgroundColor: "transparent" },
        enabled,
      );
    const minus = segment(
      () => this.changeScale(-1),
      () => this.settings.uiScale > uiScaleRange.min,
    );
    minus.add(stack(createMenuIcon("minus"), 1));
    const reset = segment(() => this.commit({ ...this.settings, uiScale: 1 }));
    reset.setProperties({ width: 64 });
    this.scaleLabel = new Text({ text: "", fontSize: 15, fontWeight: 800 });
    reset.add(stack(this.scaleLabel, 1));
    const plus = segment(
      () => this.changeScale(1),
      () => this.settings.uiScale < uiScaleRange.max,
    );
    plus.add(stack(createMenuIcon("plus"), 1));
    stepper.add(minus, reset, plus);
    scaleRow.add(stepper);
    this.body.add(scaleRow);
    if (options.onSave) {
      const save = this.addControl(options.onSave, {
        width: "100%",
        minHeight: 50,
        paddingX: 54,
        backgroundColor: "#e9f4fb",
        borderWidth: 2,
        borderColor: "#142f50",
      });
      const shadow = new BoxShadow(8, plateShadow(3));
      this.shadows.push(shadow);
      const sheen = new DialogSurface("knob");
      this.surfaces.push(sheen);
      const iconSlot = stack(
        new Container({
          positionType: "absolute",
          positionLeft: 22,
          positionTop: 0,
          positionBottom: 0,
          width: 24,
          alignItems: "center",
          justifyContent: "center",
        }),
        1,
      );
      iconSlot.add(createMenuIcon("upload"));
      save.add(
        shadow.content,
        sheen.content,
        iconSlot,
        stack(new Text({ text: "存档", fontSize: 16, fontWeight: 800 }), 1),
      );
      this.body.add(save);
    }
    this.fullscreen = this.addControl(
      () => this.toggleFullscreen?.(),
      {
        minWidth: 44,
        minHeight: 44,
        padding: 8,
        display: "none",
        backgroundColor: "#e9f4fb",
      },
      () => !!this.toggleFullscreen,
    );
    const fullscreenIcon = this.fullscreenIcon;
    fullscreenIcon.setProperties({ width: 24, height: 24 });
    this.fullscreen.add(stack(fullscreenIcon, 1));
    header.add(this.fullscreen);
    this.body.add(this.legal);
    this.panel.add(
      new Container({
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 0,
        width: "100%",
        height: "100%",
        borderWidth: 1,
        borderColor: "#ffd45b",
        borderRadius: 9,
      }),
      header,
      this.body,
    );
    for (const [index, control] of this.controls.entries()) {
      // The stepper's segments light yellow inside their well instead.
      if (index >= controlIndex.minus && index <= controlIndex.plus) {
        this.focusRings.push(null);
        continue;
      }
      // An outline, not a bordered child: a child sticking out would widen the scroll box (the
      // stray scrollbar line under a focused row) and sit above the Esc badge.
      const ring = new OutlineRing(
        index === controlIndex.close || index === controlIndex.save ? 8 : 6,
        "#ffd45b",
      );
      ring.content.setProperties({ display: "none" });
      control.panel.add(stack(ring.content, 2));
      this.focusRings.push(ring);
    }
    this.stage.root.add(this.panel);
    this.refresh(false);
    this.focus(0);
    this.applyTransition();
    this.animateVisibility(true);
  }

  private readonly applyTransition = (): void => {
    fade(this.panel, this.fade.opacity).setProperties({
      transformTranslateY: this.transform.y,
      transformScaleX: this.transform.scale,
      transformScaleY: this.transform.scale,
    });
    this.backdrop.setOpacity(this.fade.opacity);
    this.stage.invalidate();
  };

  private animateVisibility(visible: boolean): void {
    this.stage.motion.animate(
      this.fade,
      { opacity: visible ? 1 : 0 },
      140,
      this.applyTransition,
      (t) => cubicBezier(t, 0, 0, 0.58, 1),
    );
    this.stage.motion.animate(
      this.transform,
      {
        y: visible ? 0 : 14,
        scale: visible ? 1 : 0.98,
      },
      220,
      this.applyTransition,
      uiEaseOut,
    );
  }

  /** The host retains the modal pass and input ownership through its exit transition. */
  close(): void {
    if (this.closing) return;
    this.setPressed(null);
    this.closing = true;
    this.exitRemaining = 220;
    this.animateVisibility(false);
  }

  /** `lit`: the face the control turns when lit, which inks its ball pattern. */
  private addControl(
    activate: () => void,
    properties: ConstructorParameters<typeof Container>[0],
    enabled = () => true,
    lit = "#ffd45b",
  ): Container {
    const panel = new Container({
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      borderWidth: 2,
      borderColor: "transparent",
      flexShrink: 0,
      ...properties,
    });
    const pattern = new HoverPattern(this.stage.motion, () => this.stage.invalidate(), lit);
    panel.add(pattern.content);
    this.controls.push({ panel, activate, enabled, pattern });
    return panel;
  }

  setFullscreenAction(action: (() => void) | undefined, active: boolean): void {
    if (this.fullscreenIcon.setActive(active)) this.stage.invalidate();
    if (this.toggleFullscreen === action) return;
    this.toggleFullscreen = action;
    this.fullscreen.setProperties({ display: action ? "flex" : "none" });
    if (!action && this.controls[this.selected]?.panel === this.fullscreen) this.focus(0);
    this.stage.invalidate();
  }

  resize(width: number, height: number, safeArea: UiInsets = this.safeArea): void {
    this.width = width;
    this.height = height;
    this.safeArea = { ...safeArea };
    // The shared floor (DESIGN.md › 界面缩放下限) at the scale being set, so a change previews live.
    this.stage.resize(
      width,
      height,
      fitScale(this.settings.uiScale, width, height, safeArea, this.minLayout),
      safeArea,
    );
    const viewport = this.stage.viewport;
    this.fullscreen.setProperties({ minWidth: viewport.minTarget, minHeight: viewport.minTarget });
    this.backdrop.resize(viewport.width, viewport.height);
    const narrow = viewport.width <= 520;
    // Short landscape is compact, and so is any size where the roomy rows would make the body
    // scroll (`afterLayout` finds that and lays it out again).
    const sizedFor = [width, height, viewport.scale].join(",");
    if (sizedFor !== this.sizedFor) {
      this.sizedFor = sizedFor;
      this.squeezed = false;
    }
    const short = viewport.height <= 480 && viewport.width > viewport.height;
    const compact = this.squeezed || short;
    this.compact = compact;
    this.legal.setProperties({ display: short ? "flex" : "none" });
    this.stage.root.setProperties({
      paddingTop: 16 + viewport.safeArea.top,
      paddingRight: 16 + viewport.safeArea.right,
      paddingBottom: 16 + viewport.safeArea.bottom,
      paddingLeft: 16 + viewport.safeArea.left,
    });
    this.header.setProperties({
      paddingTop: narrow ? 8 : compact ? 4 : 8,
      paddingBottom: narrow ? 8 : compact ? 4 : 8,
      paddingLeft: narrow ? 14 : compact ? 16 : 20,
      paddingRight: narrow ? 8 : compact ? 4 : 10,
    });
    this.title.setProperties({ fontSize: compact ? 18 : 22 });
    this.titleShadow.setProperties({ fontSize: compact ? 18 : 22 });
    this.body.setProperties({
      paddingX: narrow ? 12 : compact ? 16 : 18,
      paddingY: narrow ? 20 : compact ? 12 : 24,
    });
    const minTarget = viewport.minTarget;
    for (const [index, control] of this.controls.entries()) {
      const toggle = index >= controlIndex.sound && index <= controlIndex.devMode;
      control.panel.setProperties({
        minHeight: toggle ? Math.max(compact ? 48 : 66, minTarget) : minTarget,
        minWidth: index === controlIndex.reset ? Math.max(64, minTarget) : minTarget,
        ...(toggle
          ? {
              paddingX: narrow ? 8 : 14,
              paddingY: narrow ? 12 : compact ? 4 : 12,
              gap: narrow ? 12 : 24,
            }
          : {}),
      });
    }
    this.scaleRow.setProperties({
      minHeight: Math.max(compact ? 48 : 66, minTarget),
      paddingX: narrow ? 8 : 14,
      paddingY: narrow ? 12 : compact ? 4 : 12,
      gap: narrow ? 12 : 24,
    });
    const travel = narrow ? 41 : 51;
    if (travel !== this.switchTravel) {
      this.switchTravel = travel;
      for (const toggle of this.switches) {
        toggle.track.setProperties({ width: narrow ? 92 : 112 });
        toggle.knob.setProperties({ width: travel });
        const checked = this.settings[toggle.key];
        this.stage.motion.animate(
          toggle.position,
          { x: checked ? travel : 0 },
          0,
          () => toggle.knob.setProperties({ transformTranslateX: toggle.position.x }),
          uiEaseOut,
        );
      }
    }
    this.needsReveal = true;
    this.stage.invalidate();
  }

  private commit(settings: Settings): void {
    this.settings = settings;
    this.refresh(true);
    this.resize(this.width, this.height);
    this.options.onChange({ ...settings });
  }

  private changeBoolean(key: "sound" | "devMode", value: boolean): void {
    if (this.settings[key] === value) return;
    this.commit({ ...this.settings, [key]: value });
  }

  private changeScale(direction: number): void {
    const next = Math.round((this.settings.uiScale + direction * uiScaleRange.step) * 10) / 10;
    this.commit({
      ...this.settings,
      uiScale: Math.max(uiScaleRange.min, Math.min(uiScaleRange.max, next)),
    });
  }

  private refresh(animate: boolean): void {
    for (const toggle of this.switches) {
      const checked = this.settings[toggle.key];
      this.transitionColor(
        toggle.knob,
        "backgroundColor",
        checked ? "#ffd45b" : "#c9dae7",
        animate,
      );
      this.transitionColor(toggle.off, "color", checked ? "#8eabc3" : "#0d233f", animate);
      this.transitionColor(toggle.on, "color", checked ? "#0d233f" : "#8eabc3", animate);
      this.stage.motion.animate(
        toggle.position,
        { x: checked ? this.switchTravel : 0 },
        animate ? 180 : 0,
        () => toggle.knob.setProperties({ transformTranslateX: toggle.position.x }),
        uiEaseOut,
      );
    }
    this.scaleLabel.setProperties({ text: `${Math.round(this.settings.uiScale * 100)}%` });

    if (!this.controls[this.selected]!.enabled()) {
      const next = this.controls.findIndex(
        (control, index) => index > this.selected && control.enabled(),
      );
      this.focus(next < 0 ? controlIndex.close : next);
    } else this.paintFocus(animate);
    this.applyPressed();
  }

  focus(index: number): void {
    if (this.closing) return;
    if (!this.controls[index]?.enabled()) return;
    if (this.selected !== index) {
      this.selected = index;
      this.options.onFocusChange?.();
      this.paintFocus(true);
    }
    this.needsReveal = true;
    this.revealSelected();
    this.stage.invalidate();
  }

  private transitionColor(
    panel: Container | Text | ReturnType<typeof createMenuIcon>,
    property: "color" | "backgroundColor" | "borderColor",
    target: string,
    animate: boolean,
  ): void {
    let properties = this.colors.get(panel);
    if (!properties) this.colors.set(panel, (properties = new Map()));
    let color = properties.get(property);
    if (color?.target === target) return;
    const rgb = new Color(target === "transparent" ? "#142f50" : target).getRGB(
      { r: 0, g: 0, b: 0 },
      SRGBColorSpace,
    );
    const next = { ...rgb, a: target === "transparent" ? 0 : 1 };
    if (!color) {
      color = { target, value: { ...next } };
      properties.set(property, color);
    }
    color.target = target;
    const state = color.value;
    this.stage.motion.animate(
      state,
      next,
      animate ? 120 : 0,
      () => {
        this.linearColor.setRGB(state.r, state.g, state.b, SRGBColorSpace);
        panel.setProperties({
          [property]: [this.linearColor.r, this.linearColor.g, this.linearColor.b, state.a],
        });
        this.stage.invalidate();
      },
      (t) => cubicBezier(t, 0.25, 0.1, 0.25, 1),
    );
  }

  /** `:focus-visible` paints a switch row navy and a stepper segment yellow; a pointer's focus does
   *  not. Hover lights the segments and the close key like the original buttons. */
  private paintFocus(animate: boolean): void {
    const index = this.selected;
    const shown = (i: number) => i === index && this.focusVisible;
    const hoveredOrShown = (i: number) =>
      this.controls[i]!.enabled() && (shown(i) || this.hovered === i);
    for (const [i, control] of this.controls.entries())
      control.pattern.setFocused(hoveredOrShown(i));
    for (const [i, control] of this.controls.entries()) {
      if (i === controlIndex.close) continue;
      const toggle = i >= controlIndex.sound && i <= controlIndex.devMode;
      const segment = i >= controlIndex.minus && i <= controlIndex.plus;
      if (toggle) {
        this.transitionColor(
          control.panel,
          "backgroundColor",
          shown(i) ? "#142f50" : "transparent",
          animate,
        );
        this.transitionColor(control.panel, "color", shown(i) ? "#d8effb" : "#142f50", animate);
      } else if (segment) {
        const lit = control.enabled() && (shown(i) || this.hovered === i);
        this.transitionColor(
          control.panel,
          "backgroundColor",
          lit ? "#ffd45b" : "transparent",
          animate,
        );
        this.transitionColor(
          control.panel,
          "color",
          lit ? "#0d233f" : control.enabled() ? "#d8effb" : "#536b82",
          animate,
        );
      } else {
        // `.game-button` (存档): yellow on :hover or :focus-visible.
        const lit = shown(i) || this.hovered === i;
        this.transitionColor(
          control.panel,
          "backgroundColor",
          lit ? "#ffd45b" : "#e9f4fb",
          animate,
        );
        this.transitionColor(control.panel, "color", lit ? "#0d233f" : "#142f50", animate);
      }
    }
    const close = shown(controlIndex.close) || this.hovered === controlIndex.close;
    const closePanel = this.controls[controlIndex.close]!.panel;
    this.transitionColor(closePanel, "backgroundColor", close ? "#ffd45b" : "#0d233f", animate);
    this.transitionColor(closePanel, "borderColor", close ? "#0d233f" : "#d8effb", animate);
    this.transitionColor(this.closeIcon, "color", close ? "#0d233f" : "#ffffff", animate);
    this.focusRings.forEach((ring, i) =>
      ring?.content.setProperties({ display: shown(i) ? "flex" : "none" }),
    );
  }

  /** Keyboard focus is outlined; focus a pointer gave is not (`:focus-visible`). */
  setFocusVisible(visible: boolean): void {
    if (this.focusVisible === visible) return;
    this.focusVisible = visible;
    this.paintFocus(true);
    this.stage.invalidate();
  }

  hover(index: number | null): void {
    if (this.hovered !== index) {
      this.hovered = index;
      this.paintFocus(true);
    }
  }

  setPressed(index: number | null): void {
    const next = !this.closing && index !== null && this.controls[index]?.enabled() ? index : null;
    if (this.pressed === next) return;
    this.pressed = next;
    this.applyPressed();
  }

  private applyPressed(): void {
    for (const toggle of this.switches) {
      const pressed = this.pressed === toggle.index && this.controls[toggle.index]!.enabled();
      toggle.knob.setProperties({
        transformScaleX: pressed ? 0.94 : 1,
        transformScaleY: pressed ? 0.9 : 1,
      });
    }
    const pressed = this.pressed === controlIndex.close && !this.closing;
    this.stage.motion.animate(
      this.closeTransform,
      {
        y: pressed ? 3 : 0,
        xScale: pressed ? 1.012 : 1,
        yScale: pressed ? 0.97 : 1,
        press: pressed ? 1 : 0,
      },
      pressed ? 60 : 140,
      () => {
        this.controls[controlIndex.close]!.panel.setProperties({
          transformTranslateY: this.closeTransform.y,
          transformScaleX: this.closeTransform.xScale,
          transformScaleY: this.closeTransform.yScale,
        });
        const press = this.closeTransform.press;
        const alpha = 0.14 * (1 - press) + 0.25 * press;
        const channel = Math.round((255 * 0.14 * (1 - press)) / alpha);
        this.linearColor.setRGB(channel / 255, channel / 255, channel / 255, SRGBColorSpace);
        this.closeBevel.setProperties({
          height: 2 + press,
          backgroundColor: [this.linearColor.r, this.linearColor.g, this.linearColor.b, alpha],
        });
        this.closeBase.setProperties({ backgroundColor: [0, 0, 0, 0.35 * (1 - press)] });
      },
      uiEaseOut,
    );
    this.stage.invalidate();
  }

  /** Called after stage.update, when Yoga and loaded font measurements have settled. */
  setCoarsePointer(coarse: boolean): void {
    this.closeBadge.setProperties({ display: coarse ? "none" : "flex" });
  }

  afterLayout(deltaMs = 0): void {
    if (this.closing) this.exitRemaining = Math.max(0, this.exitRemaining - deltaMs);
    if (!this.compact && (this.body.maxScrollPosition.value[1] ?? 0) > 0) {
      this.squeezed = true;
      this.resize(this.width, this.height);
    }
    const wrapped = wrapLines(this.legal, LEGAL_NOTICE);
    if (wrapped !== undefined && wrapped !== this.legal.properties.peek().text)
      this.legal.setProperties({ text: wrapped });
    const panelMatrix = this.panel.globalMatrix.value,
      panelSize = this.panel.size.value;
    if (panelMatrix && panelSize)
      this.backdrop.updatePanel(panelMatrix, panelSize[0], panelSize[1]);
    for (const control of this.controls) control.pattern.update(deltaMs);
    // The header band moves on its own: redrawn on the stage's 15Hz idle clock.
    let moving = false;
    for (const surface of this.surfaces) moving = surface.update(deltaMs) || moving;
    if (moving && idleTicked(15)) this.stage.invalidate();
    const layout = [
      this.body.size.value,
      this.body.maxScrollPosition.value,
      ...this.controls.map((control) => control.panel.size.value),
    ]
      .map((size) => size?.join(",") ?? "")
      .join("|");
    if (layout !== this.lastLayout) {
      this.lastLayout = layout;
      this.needsReveal = true;
    }
    if (this.needsReveal) {
      this.revealSelected();
      this.needsReveal = false;
    }
  }

  private revealSelected(): void {
    if (this.selected === controlIndex.close) return;
    if (revealInScroller(this.controls[this.selected]!.panel, this.body)) this.stage.invalidate();
  }

  activate(index: number): void {
    if (this.closing) return;
    if (index === this.controls.length) this.options.onClose();
    else if (this.controls[index]?.enabled()) {
      this.focus(index);
      this.controls[index]!.activate();
    }
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

  hit(x: number, y: number): number {
    if (!this.contains(this.panel, x, y)) return this.controls.length;
    const hitIndex = this.controls.findIndex(
      (control, i) =>
        control.enabled() &&
        (i === controlIndex.close || this.contains(this.body, x, y)) &&
        this.contains(control.panel, x, y),
    );
    return hitIndex >= 0
      ? hitIndex
      : this.contains(this.body, x, y)
        ? this.controls.length + 1
        : -1;
  }

  scroll(delta: number): void {
    if (this.closing) return;
    const [x, y] = this.body.scrollPosition.value;
    this.body.scrollPosition.value = [
      x,
      Math.max(
        0,
        Math.min(this.body.maxScrollPosition.value[1] ?? 0, y + delta / this.stage.viewport.scale),
      ),
    ];
    this.stage.invalidate();
  }

  navigate(action: NavigationAction): boolean {
    if (this.closing) return true;
    if (action === "cancel") this.options.onClose();
    else if (action === "confirm") this.activate(this.selected);
    else if (["down", "up", "next", "previous", "first", "last"].includes(action)) {
      const enabled = this.controls
        .map((control, index) => (control.enabled() ? index : -1))
        .filter((index) => index >= 0);
      const current = enabled.indexOf(this.selected);
      const next =
        action === "first"
          ? 0
          : action === "last"
            ? enabled.length - 1
            : (current + (action === "up" || action === "previous" ? -1 : 1) + enabled.length) %
              enabled.length;
      this.focus(enabled[next]!);
    } else if (action === "left" || action === "right") {
      const toggle = this.switches.find((toggle) => toggle.index === this.selected);
      if (toggle) this.changeBoolean(toggle.key, action === "right");
      else if (this.selected >= controlIndex.minus && this.selected <= controlIndex.plus)
        this.changeScale(action === "right" ? 1 : -1);
    }
    return true;
  }

  dispose(): void {
    this.backdrop.dispose();
    for (const control of this.controls) control.pattern.dispose();
    for (const surface of this.surfaces) surface.dispose();
    for (const shadow of this.shadows) shadow.dispose();
    for (const ring of this.focusRings) ring?.dispose();
    this.stage.dispose();
  }
}
