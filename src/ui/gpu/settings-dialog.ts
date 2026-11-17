import { FullscreenIcon } from "./fullscreen-icon";
import { type NavigationAction } from "../../platform/input";
import { revealInScroller } from "./scroll-reveal";
import { LEGAL_NOTICE } from "../../legalNotice";
import { wrapLines } from "./text-fit";
import { EASE, LIFT, SNAP } from "./motion";
import { Container, Text, type FontFamilies } from "@pmndrs/uikit";
import { Color, Matrix4, Vector3 } from "three";
import { type Settings, uiScaleRange } from "../../settings";
import { UiStage } from "./stage";
import { fitScale, type UiInsets } from "./viewport";
import { createMenuIcon } from "./icons";
import { DialogFrame } from "./dialog-surface";
import { DialogBackdrop } from "./dialog-backdrop";
import { fade, stack } from "./layer";
import { GameButton } from "./game-button";
import { SegmentFace, segmentTray } from "./segment-face";
import { SlantPlate } from "./slant-plate";
import { slantOf, ui } from "./tokens";

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

interface PaintState {
  hovered: boolean;
  focused: boolean;
  focusVisible: boolean;
  pressed: boolean;
}

interface Control {
  panel: Container;
  activate(): void;
  enabled(): boolean;
  paint(state: PaintState): void;
  dispose(): void;
}

/** SegmentFace's locked ink on the tray. */
const SEGMENT_LOCKED = "#5a5e68";

/** Separate UI pass owns modal input and clipping without changing the underlying menu state. */
export class SettingsDialog {
  readonly stage = new UiStage();
  /** Its window at the compact size: the 560 panel with all rows, in a 16px margin (fitScale). */
  readonly minLayout = { width: 592, height: 360 };
  private readonly frame: DialogFrame;
  private readonly body: Container;
  private compact = false;
  /** The legal line: the lobby shows it on wide screens, this window in short landscape. */
  private readonly legal = new Text({
    text: LEGAL_NOTICE,
    fontSize: 11,
    lineHeight: "145%",
    fontWeight: 500,
    color: ui.muted,
    width: "100%",
    wordBreak: "keep-all",
    whiteSpace: "pre-line",
    flexShrink: 0,
  });
  private squeezed = false;
  private sizedFor = "";
  private readonly fullscreen: GameButton;
  private toggleFullscreen: (() => void) | undefined;
  private readonly fullscreenIcon = new FullscreenIcon();
  private focusVisible = true;
  private pressed: number | null = null;
  private readonly backdrop = new DialogBackdrop();
  private safeArea: UiInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly controls: Control[] = [];
  private readonly buttons: GameButton[] = [];
  private readonly rows: Container[] = [];
  private readonly trays: { dispose(): void }[] = [];
  private readonly switches: {
    key: "sound" | "devMode";
    off: SegmentFace;
    on: SegmentFace;
    index: number;
  }[] = [];
  private readonly scaleFaces: SegmentFace[] = [];
  private scaleRow!: Container;
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
    const frame = (this.frame = new DialogFrame(this.stage, "设置", 520));
    // The frame owns (and disposes) its close key.
    this.addButton(frame.close, () => options.onClose(), undefined, false);
    this.body = new Container({
      paddingX: 18,
      paddingY: 18,
      gap: 10,
      flexDirection: "column",
      overflow: "scroll",
      flexShrink: 1,
      minHeight: 0,
      scrollbarWidth: 3,
      scrollbarColor: ui.line,
    });
    for (const [key, label] of [
      ["sound", "声音"],
      ["devMode", "开发者模式"],
    ] as const) {
      const row = this.addRow(label, () => this.changeBoolean(key, !this.settings[key]));
      const { tray, ...plate } = segmentTray();
      this.trays.push(plate);
      const off = new SegmentFace(this.stage, "关");
      const on = new SegmentFace(this.stage, "开");
      tray.add(stack(off.panel, 1), stack(on.panel, 1));
      row.add(stack(tray, 1));
      this.switches.push({ key, off, on, index: this.controls.length - 1 });
    }
    this.addScaleRow();
    if (options.onSave) {
      const save = new GameButton(this.stage, {
        tone: "secondary",
        size: "normal",
        label: "存档",
        icon: createMenuIcon("upload"),
      });
      save.panel.setProperties({ width: "100%", marginTop: 6 });
      this.addButton(save, options.onSave);
      this.body.add(stack(save.panel, 1));
    }
    this.fullscreen = new GameButton(this.stage, {
      tone: "secondary",
      size: "small",
      square: true,
      icon: this.fullscreenIcon,
    });
    this.fullscreen.panel.setProperties({ display: "none", marginLeft: "auto" });
    this.addButton(
      this.fullscreen,
      () => this.toggleFullscreen?.(),
      () => !!this.toggleFullscreen,
    );
    frame.extra.add(stack(this.fullscreen.panel, 1));
    this.body.add(this.legal);
    frame.panel.add(this.body);
    this.stage.root.add(frame.panel);
    this.refresh();
    this.focus(0);
    this.applyTransition();
    this.animateVisibility(true);
  }

  /** A labelled row (声音, 开发者模式): the whole row is the control; hover and keyboard focus
   *  raise its upright mist plate, keyboard focus rings it. */
  private addRow(label: string, activate: () => void): Container {
    const row = this.row(label);
    const plate = new SlantPlate(row, { fill: ui.mist, upright: true });
    plate.set({ depth: 0, face: 0 });
    row.add(plate.content);
    const lit = { face: 0 };
    let target = -1;
    this.controls.push({
      panel: row,
      activate,
      enabled: () => true,
      paint: (state) => {
        const keyed = state.focused && state.focusVisible;
        plate.set({ focus: keyed ? 1 : 0 });
        row.setProperties({ transformTranslateY: state.pressed ? LIFT.press : 0 });
        const face = state.hovered || keyed ? 1 : 0;
        if (face === target) return;
        target = face;
        this.stage.motion.animate(
          lit,
          { face },
          LIFT.ms,
          () => {
            plate.set({ face: lit.face });
            this.stage.invalidate();
          },
          SNAP,
        );
      },
      dispose: () => {
        this.stage.motion.cancel(lit);
        plate.dispose();
      },
    });
    return row;
  }

  private row(label: string): Container {
    const row = new Container({
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      paddingLeft: 14,
      paddingRight: 6,
      paddingY: 6,
      flexShrink: 0,
    });
    row.add(
      stack(
        new Text({
          text: label,
          fontSize: 16,
          fontWeight: 800,
          flexGrow: 1,
          flexShrink: 1,
          color: ui.ink,
        }),
        1,
      ),
    );
    this.rows.push(row);
    this.body.add(row);
    return row;
  }

  /** 界面缩放: − value + on one tray, each its own control; the value resets to 100%. */
  private addScaleRow(): void {
    const row = (this.scaleRow = this.row("界面缩放"));
    const { tray, ...plate } = segmentTray();
    this.trays.push(plate);
    const segment = (icon: "minus" | "plus" | null, activate: () => void, enabled = () => true) => {
      const face = new SegmentFace(this.stage, "");
      const mark = icon ? createMenuIcon(icon) : null;
      if (mark) {
        face.label.setProperties({ display: "none" });
        mark.setProperties({ width: 20, height: 20 });
        face.panel.add(stack(mark, 1));
      }
      face.panel.setProperties({ paddingX: (mark ? 10 : 14) + slantOf(44) / 2 });
      this.scaleFaces.push(face);
      tray.add(stack(face.panel, 1));
      let ink = "";
      this.controls.push({
        panel: face.panel,
        activate,
        enabled,
        paint: (state) => {
          const locked = !enabled();
          const lit = !locked && (state.hovered || (state.focused && state.focusVisible));
          face.paint({ ...state, checked: !mark, locked, hovered: lit });
          const next = locked ? SEGMENT_LOCKED : lit ? ui.white : ui.line;
          if (mark && next !== ink) {
            ink = next;
            // UIKit compares colours by reference: a new one per change.
            mark.setProperties({ color: new Color(next) });
          }
        },
        dispose: () => face.dispose(),
      });
    };
    segment(
      "minus",
      () => this.changeScale(-1),
      () => this.settings.uiScale > uiScaleRange.min,
    );
    segment(null, () => this.commit({ ...this.settings, uiScale: 1 }));
    segment(
      "plus",
      () => this.changeScale(1),
      () => this.settings.uiScale < uiScaleRange.max,
    );
    row.add(stack(tray, 1));
  }

  private addButton(
    button: GameButton,
    activate: () => void,
    enabled = () => true,
    owned = true,
  ): void {
    if (owned) this.buttons.push(button);
    let disabled: boolean | null = null;
    this.controls.push({
      panel: button.panel,
      activate,
      enabled,
      paint: (state) => {
        if (disabled !== !enabled()) button.setDisabled((disabled = !enabled()));
        button.setHovered(state.hovered);
        button.setFocused(state.focused);
        button.setFocusVisible(state.focusVisible);
        button.setPressed(state.pressed);
      },
      dispose: () => {
        if (owned) button.dispose();
      },
    });
  }

  private readonly applyTransition = (): void => {
    fade(this.frame.panel, this.fade.opacity).setProperties({
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
      EASE,
    );
    this.stage.motion.animate(
      this.transform,
      { y: visible ? 0 : 14, scale: visible ? 1 : 0.98 },
      220,
      this.applyTransition,
      EASE,
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

  setFullscreenAction(action: (() => void) | undefined, active: boolean): void {
    if (this.fullscreenIcon.setActive(active)) this.stage.invalidate();
    if (this.toggleFullscreen === action) return;
    this.toggleFullscreen = action;
    this.fullscreen.panel.setProperties({ display: action ? "flex" : "none" });
    if (!action && this.controls[this.selected]?.panel === this.fullscreen.panel) this.focus(0);
    this.paint();
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
    // Room above and left for the title plate set over the window's corner.
    this.stage.root.setProperties({
      paddingTop: (compact ? 20 : 26) + viewport.safeArea.top,
      paddingRight: 16 + viewport.safeArea.right,
      paddingBottom: 16 + viewport.safeArea.bottom,
      paddingLeft: 24 + viewport.safeArea.left,
    });
    this.frame.resize(compact);
    this.body.setProperties({
      paddingX: narrow ? 12 : compact ? 16 : 20,
      paddingTop: compact ? 8 : 16,
      paddingBottom: compact ? 12 : 22,
      gap: compact ? 6 : 10,
    });
    const minTarget = viewport.minTarget;
    for (const row of this.rows)
      row.setProperties({ paddingY: compact ? 2 : 6, minHeight: minTarget });
    for (const button of this.buttons) button.fitTouch();
    for (const face of this.scaleFaces) {
      face.fitTouch();
      face.panel.setProperties({ minWidth: minTarget });
    }
    // The switch halves sit in a row that is the touch target; they only need to read as keys.
    for (const toggle of this.switches)
      for (const face of [toggle.off, toggle.on])
        face.panel.setProperties({ minHeight: compact ? 34 : 40 });
    this.needsReveal = true;
    this.stage.invalidate();
  }

  private commit(settings: Settings): void {
    this.settings = settings;
    this.refresh();
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

  private refresh(): void {
    this.scaleFaces[1]!.label.setProperties({
      text: `${Math.round(this.settings.uiScale * 100)}%`,
    });
    if (!this.controls[this.selected]!.enabled()) {
      const next = this.controls.findIndex(
        (control, index) => index > this.selected && control.enabled(),
      );
      this.focus(next < 0 ? controlIndex.close : next);
    }
    this.paint();
  }

  focus(index: number): void {
    if (this.closing) return;
    if (!this.controls[index]?.enabled()) return;
    if (this.selected !== index) {
      this.selected = index;
      this.options.onFocusChange?.();
      this.paint();
    }
    this.needsReveal = true;
    this.revealSelected();
    this.stage.invalidate();
  }

  /** Hover lights a control; keyboard focus also rings it (`:focus-visible`), a pointer's does
   *  not. The switch halves show the setting. */
  private paint(): void {
    for (const [i, control] of this.controls.entries())
      control.paint({
        hovered: this.hovered === i && control.enabled(),
        focused: this.selected === i,
        focusVisible: this.focusVisible,
        pressed: this.pressed === i,
      });
    for (const toggle of this.switches) {
      const checked = this.settings[toggle.key];
      const idle = { locked: false, hovered: false, focused: false, focusVisible: false };
      toggle.off.paint({ ...idle, checked: !checked, pressed: false });
      toggle.on.paint({ ...idle, checked, pressed: false });
    }
    this.stage.invalidate();
  }

  /** Keyboard focus is outlined; focus a pointer gave is not (`:focus-visible`). */
  setFocusVisible(visible: boolean): void {
    if (this.focusVisible === visible) return;
    this.focusVisible = visible;
    this.paint();
  }

  hover(index: number | null): void {
    if (this.hovered !== index) {
      this.hovered = index;
      this.paint();
    }
  }

  setPressed(index: number | null): void {
    const next = !this.closing && index !== null && this.controls[index]?.enabled() ? index : null;
    if (this.pressed === next) return;
    this.pressed = next;
    this.paint();
  }

  setCoarsePointer(coarse: boolean): void {
    this.frame.escBadge.setProperties({ display: coarse ? "none" : "flex" });
  }

  /** Called after stage.update, when Yoga and loaded font measurements have settled. */
  afterLayout(deltaMs = 0): void {
    if (this.closing) this.exitRemaining = Math.max(0, this.exitRemaining - deltaMs);
    if (!this.compact && (this.body.maxScrollPosition.value[1] ?? 0) > 0) {
      this.squeezed = true;
      this.resize(this.width, this.height);
    }
    const wrapped = wrapLines(this.legal, LEGAL_NOTICE);
    if (wrapped !== undefined && wrapped !== this.legal.properties.peek().text)
      this.legal.setProperties({ text: wrapped });
    const panelMatrix = this.frame.panel.globalMatrix.value,
      panelSize = this.frame.panel.size.value;
    if (panelMatrix && panelSize)
      this.backdrop.updatePanel(panelMatrix, panelSize[0], panelSize[1]);
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
    const panel = this.controls[this.selected]!.panel;
    if (this.inHeader(panel)) return;
    // A scale segment scrolls into view by its row.
    const target = this.scaleFaces.some((face) => face.panel === panel) ? this.scaleRow : panel;
    if (revealInScroller(target, this.body)) this.stage.invalidate();
  }

  private inHeader(panel: Container): boolean {
    return panel === this.frame.close.panel || panel === this.fullscreen.panel;
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
    if (!this.contains(this.frame.panel, x, y)) return this.controls.length;
    const hitIndex = this.controls.findIndex(
      (control) =>
        control.enabled() &&
        (this.inHeader(control.panel) || this.contains(this.body, x, y)) &&
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
    for (const control of this.controls) control.dispose();
    for (const toggle of this.switches) {
      toggle.off.dispose();
      toggle.on.dispose();
    }
    for (const tray of this.trays) tray.dispose();
    this.frame.dispose();
    this.stage.dispose();
  }
}
