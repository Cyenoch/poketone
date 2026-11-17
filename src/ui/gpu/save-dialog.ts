import { isNavigationDirection, type NavigationAction } from "../../platform/input";
import type { TextServices } from "../../platform/text";
import { gridStep } from "./grid-nav";
import { EASE } from "./motion";
import { Container, Text, type FontFamilies } from "@pmndrs/uikit";
import { Matrix4, Vector3 } from "three";
import { getAudio } from "../../audio/engine";
import { DialogBackdrop } from "./dialog-backdrop";
import { DialogFrame } from "./dialog-surface";
import { GameButton } from "./game-button";
import { fade, stack } from "./layer";
import { UiStage } from "./stage";
import { ui } from "./tokens";
import type { UiInsets } from "./viewport";

export interface SaveDialogCallbacks {
  notify(message: string): void;
  /** Imports `text`; throws with the reason when it is not a usable save. */
  load(text: string): void;
  /** The exit has played; the owner unmounts the window. */
  closed(): void;
}

const DANGER = "#a83243";

/**
 * One save window for Web and SDL. A save code only ever moves whole: out through the clipboard or
 * a file, in the same two ways; nothing is typed. Only clipboard and file access differ by platform.
 */
export class GpuSaveDialog {
  readonly stage = new UiStage();
  readonly minLayout = { width: 400, height: 300 };
  readonly modal = true;
  private readonly callbacks: SaveDialogCallbacks;
  private readonly text: TextServices;
  /** The export, encoded when the window opened; empty when progress could not load. */
  private readonly code: string;
  private disposed = false;
  private pending = false;
  private closeElapsed = 0;
  private readonly frame: DialogFrame;
  private readonly panel: Container;
  private readonly body = new Container({
    flexDirection: "column",
    gap: 14,
    flexShrink: 1,
    minHeight: 0,
  });
  private readonly rows: Container[] = [];
  private readonly status = new Text({
    text: "",
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.5,
    color: DANGER,
    display: "none",
  });
  private readonly backdrop = new DialogBackdrop();
  private readonly close: GameButton;
  private readonly copyButton: GameButton;
  private readonly saveButton: GameButton;
  private readonly pasteButton: GameButton;
  private readonly openButton: GameButton;
  /** Tab order, which is also reading order: close, then export, then import. */
  private readonly order: GameButton[];
  private readonly point = new Vector3();
  private readonly inverse = new Matrix4();
  private readonly opacity = { value: 0 };
  private readonly fade = { y: 14, scale: 0.98 };
  private focused = 0;
  private hovered = -1;
  private pressed = -1;
  private focusVisible = false;
  private error = "";
  private closing = false;

  constructor(
    fonts: FontFamilies,
    initial: { text: string; error: string },
    callbacks: SaveDialogCallbacks,
    text: TextServices,
  ) {
    this.callbacks = callbacks;
    this.text = text;
    this.code = initial.text;
    this.error = initial.error;
    this.stage.root.setProperties({
      fontFamilies: fonts,
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      color: ui.ink,
    });
    this.stage.scene.add(this.backdrop.dim, this.backdrop.shadow);
    this.frame = new DialogFrame(this.stage, "存档", 480);
    this.panel = this.frame.panel;
    this.close = this.frame.close;
    const key = (label: string, tone: "primary" | "secondary") => {
      const button = new GameButton(this.stage, { tone, size: "normal", label });
      button.panel.setProperties({ width: "100%" });
      return button;
    };
    this.copyButton = key("复制存档", "primary");
    this.saveButton = key("保存文件", "secondary");
    this.pasteButton = key("粘贴导入", "secondary");
    this.openButton = key("打开文件", "secondary");
    this.body.add(
      this.row("导出", this.copyButton, this.saveButton),
      this.row("导入", this.pasteButton, this.openButton),
      this.status,
    );
    this.panel.add(this.body);
    this.stage.root.add(this.panel);
    this.order = [this.close, this.copyButton, this.saveButton, this.pasteButton, this.openButton];
    this.focused = this.step(0, 1);
    this.paint();
    this.animate(true);
  }

  /** A group: its name, then its two keys sharing the rest of the width (columns line up). */
  private row(label: string, ...buttons: GameButton[]): Container {
    const row = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      flexShrink: 0,
    });
    row.add(
      stack(
        new Text({ text: label, fontSize: 16, fontWeight: 800, color: ui.ink, marginRight: 6 }),
        1,
      ),
      // Equal unpadded cells: a key's own padding (the slanted primary's is wider) cannot skew
      // the columns.
      ...buttons.map((button) => {
        const cell = new Container({
          flexGrow: 1,
          flexBasis: 0,
          minWidth: 0,
          flexDirection: "row",
        });
        cell.add(stack(button.panel, 1));
        return cell;
      }),
    );
    this.rows.push(row);
    return row;
  }

  /** Opacity 140ms, transform 220ms (translateY 14px, scale .98). */
  private animate(open: boolean): void {
    this.stage.motion.animate(
      this.opacity,
      { value: open ? 1 : 0 },
      140,
      () => this.applyFade(),
      EASE,
    );
    this.stage.motion.animate(
      this.fade,
      { y: open ? 0 : 14, scale: open ? 1 : 0.98 },
      220,
      () => this.applyFade(),
      EASE,
    );
  }

  private applyFade(): void {
    fade(this.panel, this.opacity.value).setProperties({
      transformTranslateY: this.fade.y,
      transformScaleX: this.fade.scale,
      transformScaleY: this.fade.scale,
    });
    this.backdrop.setOpacity(this.opacity.value);
    this.stage.invalidate();
  }

  /** The next control from `from` in Tab order, past unavailable keys (as `:disabled` ones are). */
  private step(from: number, way: 1 | -1): number {
    let next = from;
    do next = (next + way + this.order.length) % this.order.length;
    while (!this.enabled(next));
    return next;
  }

  private enabled(index: number): boolean {
    const button = this.order[index];
    if (this.pending) return button === this.close;
    // Locked progress has nothing to export.
    if (button === this.copyButton || button === this.saveButton) return this.code !== "";
    return true;
  }

  private paint(): void {
    if (this.disposed) return;
    this.order.forEach((button, i) => {
      button.setDisabled(!this.enabled(i));
      button.setHovered(this.hovered === i);
      button.setFocused(this.focused === i);
      button.setFocusVisible(this.focused === i && this.focusVisible);
      button.setPressed(this.pressed === i);
    });
    this.status.setProperties({ text: this.error, display: this.error ? "flex" : "none" });
    this.stage.invalidate();
  }

  private requestClose(): void {
    if (this.closing) return;
    this.closing = true;
    getAudio().sfx("ui-back");
    this.animate(false);
    this.closeElapsed = 0;
  }

  /** One I/O at a time; results arriving after the window closed are dropped. A save is only
   *  committed by `load`, which validates first, so a failed read or a bad code changes nothing. */
  private async run(index: number): Promise<void> {
    if (this.closing || !this.enabled(index)) return;
    const button = this.order[index]!;
    if (button === this.close) {
      this.requestClose();
      return;
    }
    getAudio().sfx("ui-confirm");
    this.pending = true;
    this.paint();
    let step = "";
    try {
      if (button === this.copyButton) {
        step = "复制";
        await this.text.writeClipboard(this.code);
        if (this.disposed || this.closing) return;
        this.error = "";
        this.callbacks.notify("存档已复制");
      } else if (button === this.saveButton) {
        step = "导出";
        const saved = await this.text.saveFile(this.code);
        if (!saved || this.disposed || this.closing) return;
        this.error = "";
        this.callbacks.notify("存档已导出");
      } else {
        const paste = button === this.pasteButton;
        step = paste ? "粘贴" : "打开";
        const text = paste ? await this.text.readClipboard() : await this.text.openFile();
        if (text === null || this.disposed || this.closing) return;
        step = "导入";
        this.callbacks.load(text);
        this.requestClose();
      }
    } catch (cause) {
      if (this.disposed || this.closing) return;
      this.error = `${step}失败：${(cause as Error).message}`;
    } finally {
      this.pending = false;
      this.paint();
    }
  }

  // ── GpuScreen ──────────────────────────────────────────────────────────────────────────────

  resize(width: number, height: number, scale: number, safe: UiInsets): void {
    this.stage.resize(width, height, scale, safe);
    const v = this.stage.viewport;
    const compact = v.height <= 480 && v.width > v.height;
    const narrow = v.width <= 520;
    // Room above and left for the title plate set over the window's corner.
    this.stage.root.setProperties({
      paddingTop: (compact ? 20 : 26) + v.safeArea.top,
      paddingRight: 16 + v.safeArea.right,
      paddingBottom: 16 + v.safeArea.bottom,
      paddingLeft: 24 + v.safeArea.left,
    });
    this.body.setProperties({
      gap: compact ? 10 : 14,
      paddingX: narrow ? 12 : compact ? 16 : 18,
      paddingTop: narrow ? 20 : compact ? 12 : 24,
      paddingBottom: narrow ? 16 : compact ? 14 : 22,
    });
    for (const row of this.rows) row.setProperties({ gap: narrow ? 8 : 10 });
    this.frame.resize(compact);
    for (const button of this.order) button.fitTouch();
    this.backdrop.resize(v.width, v.height);
  }

  setCoarsePointer(coarse: boolean): void {
    this.frame.escBadge.setProperties({ display: coarse ? "none" : "flex" });
  }

  setFocusVisible(visible: boolean): void {
    if (visible === this.focusVisible) return;
    this.focusVisible = visible;
    this.paint();
  }

  private contains(panel: Container, x: number, y: number): boolean {
    const m = panel.globalMatrix.value,
      size = panel.size.value;
    if (!m || !size) return false;
    const v = this.stage.viewport;
    this.point
      .set(x / v.scale + this.stage.camera.left, this.stage.camera.top - y / v.scale, 0)
      .applyMatrix4(this.inverse.copy(m).invert());
    return Math.abs(this.point.x) <= size[0] / 2 && Math.abs(this.point.y) <= size[1] / 2;
  }

  /** Controls, then the panel and backdrop hit targets. */
  hit(x: number, y: number): number {
    if (this.closing) return -1;
    const index = this.order.findIndex((button) => this.contains(button.panel, x, y));
    if (index >= 0) return index;
    return this.contains(this.panel, x, y) ? this.order.length : this.order.length + 1;
  }

  focus(index: number): void {
    if (index >= this.order.length) return;
    this.focused = index;
    this.paint();
  }

  hover(index: number | null): void {
    this.hovered = index ?? -1;
    this.paint();
  }

  setPressed(index: number | null): void {
    this.pressed = index ?? -1;
    this.paint();
  }

  activate(index: number): void {
    // A press that starts and ends on the backdrop closes.
    if (index === this.order.length + 1) this.requestClose();
    else if (index < this.order.length) void this.run(index);
  }

  scroll(): void {}

  navigate(action: NavigationAction): boolean {
    if (action === "cancel") this.requestClose();
    else if (isNavigationDirection(action)) {
      const entries = this.order
        .map((button, index) => ({ index, panel: button.panel }))
        .filter(({ index }) => this.enabled(index));
      const at = gridStep(
        entries.map(({ panel }) => panel),
        entries.findIndex(({ index }) => index === this.focused),
        action,
      );
      this.focus(entries[at]!.index);
    } else if (action === "next" || action === "previous")
      this.focus(this.step(this.focused, action === "previous" ? -1 : 1));
    else if (action === "confirm") void this.run(this.focused);
    return true;
  }

  pointerDown(): void {}
  pointerMove(): void {}
  pointerUp(): boolean {
    return false;
  }

  afterLayout(deltaMs: number): void {
    if (this.closing) {
      this.closeElapsed += deltaMs;
      if (this.closeElapsed >= 220) {
        this.callbacks.closed();
        return;
      }
    }
    for (const button of this.order) button.update(deltaMs);
    const panelMatrix = this.panel.globalMatrix.value,
      panelSize = this.panel.size.value;
    if (panelMatrix && panelSize)
      this.backdrop.updatePanel(panelMatrix, panelSize[0], panelSize[1]);
  }

  releaseUploads(): void {
    this.stage.releaseUploads();
  }

  dispose(): void {
    this.disposed = true;
    this.backdrop.dispose();
    // The frame disposes its close key.
    for (const button of this.order) if (button !== this.close) button.dispose();
    this.frame.dispose();
    this.stage.dispose();
  }
}
