import { isNavigationDirection, type NavigationAction } from "../../platform/input";
import { TextKeyboard } from "./text-keyboard";
import { TextBuffer } from "../text-buffer";
import type { TextInput, TextServices } from "../../platform/text";
import {
  getCharIndex,
  getCaretTransformation,
  getSelectionTransformations,
} from "@pmndrs/uikit/dist/text/layout/query.js";
import { gridStep } from "./grid-nav";
import { currentInputMode, InputGlyph } from "./input-glyph";
import { idleTicked } from "./motion";
import { Container, Text, type FontFamilies } from "@pmndrs/uikit";
import { Matrix4, Vector3 } from "three";
import { getAudio } from "../../audio/engine";
import { OutlineRing } from "./box-shadow";
import { DialogBackdrop } from "./dialog-backdrop";
import { DialogSurface } from "./dialog-surface";
import { cubicBezier, uiEaseOut } from "./focus-mark";
import { GameButton } from "./game-button";
import { createMenuIcon } from "./icons";
import { fade, stack } from "./layer";
import { InsetShade, WellFace } from "./screen-parts";
import { UiStage } from "./stage";
import type { UiInsets } from "./viewport";

export interface SaveDialogCallbacks {
  notify(message: string): void;
  /** Imports `text`; throws with the reason when it is not a usable save. */
  load(text: string): void;
  /** The exit has played; the owner unmounts the window. */
  closed(): void;
}

const NAVY = "#142f50",
  NAVY_DEEP = "#0d233f",
  DANGER = "#a83243";
const easeOut = (t: number) => cubicBezier(t, 0, 0, 0.58, 1);

/** One save window for Web and SDL; only platform text controls and file access differ. */
export class GpuSaveDialog {
  readonly stage = new UiStage();
  readonly minLayout = { width: 400, height: 300 };
  readonly modal = true;
  private readonly callbacks: SaveDialogCallbacks;
  private readonly text: TextServices;
  readonly buffer: TextBuffer;
  private readonly input: TextInput;
  private readonly unsubscribe: () => void;
  private readonly selectionPanels: Container[] = [];
  private readonly caret = new Container({
    positionType: "absolute",
    width: 1.5,
    backgroundColor: "#2165a4",
  });
  private dragAnchor: number | undefined;
  private disposed = false;
  private pending = false;
  private elapsed = 0;
  private closeElapsed = 0;
  private previewRevision = -1;
  private selectionLayout: object | undefined;
  private selectionState = "";
  private readonly preview = new Container({
    positionType: "absolute",
    positionTop: 10,
    positionBottom: 10,
    positionLeft: 12,
    positionRight: 12,
    overflow: "scroll",
    flexDirection: "column",
  });
  private readonly previewContent = new Container({ flexShrink: 0, width: "100%", minHeight: 18 });
  private readonly initial: string;
  private readonly keyboard = new TextKeyboard(this.stage);
  private readonly keyboardButton: GameButton;
  private keyboardOpen = false;
  private lowercase = false;
  private readonly codePreview = new Text({
    text: "",
    fontSize: 13,
    color: NAVY,
    wordBreak: "break-all",
    whiteSpace: "pre",
    width: "100%",
    flexShrink: 0,
    lineHeight: 1.4,
  });
  private readonly panel = new Container({
    width: 560,
    maxWidth: "100%",
    maxHeight: "100%",
    flexDirection: "column",
    padding: 4,
    borderWidth: 3,
    borderColor: NAVY_DEEP,
    borderRadius: 12,
    backgroundColor: "#e9f4fb",
  });
  private readonly header = new Container({
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    paddingLeft: 20,
    paddingRight: 10,
    paddingY: 8,
    flexShrink: 0,
  });
  private readonly body = new Container({
    flexDirection: "column",
    gap: 8,
    flexShrink: 1,
    minHeight: 0,
  });
  private readonly well = new Container({
    height: 97.5,
    flexShrink: 1,
    minHeight: 72,
    borderWidth: 2,
    borderRadius: 8,
  });
  private readonly wellFace = new WellFace(6);
  private readonly status = new Text({
    text: "",
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.5,
    color: DANGER,
    display: "none",
  });
  private readonly actions = new Container({
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 10,
    paddingTop: 12,
    paddingX: 14,
    paddingBottom: 15,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    // color-mix(in srgb, var(--line) 26%, var(--surface)), under `inset 0 2px 0` navy-deep 10%
    backgroundColor: "#d2e4f0",
    flexShrink: 0,
  });
  private readonly trayShade = new InsetShade(2, NAVY_DEEP, 0.1, 3);
  private readonly band = new DialogSurface("header");
  private readonly backdrop = new DialogBackdrop();
  private readonly ring = new OutlineRing(8, "#2165a4", 3, 3);
  private readonly close: GameButton;
  private readonly copyButton: GameButton;
  private readonly loadButton: GameButton;
  private readonly openButton: GameButton;
  private readonly exportButton: GameButton;
  private readonly baseCount = 7;
  /** Index 1 is the platform editor; remaining entries are shared GPU controls. */
  private readonly order: (GameButton | "field")[];
  private readonly point = new Vector3();
  private readonly inverse = new Matrix4();
  private readonly fade = { y: 14, scale: 0.98 };
  private readonly titles: Text[];
  /** The entrance has settled: the field shows only then (it cannot take the window's scale). */
  private settled = false;
  private covered = false;
  private focused = 0;
  private hovered = -1;
  private pressed = -1;
  private focusVisible = false;
  private fieldFocused = false;
  private error = "";
  private closing = false;
  private placed = "";
  private codeSize = 13;

  constructor(
    fonts: FontFamilies,
    initial: { text: string; error: string },
    callbacks: SaveDialogCallbacks,
    text: TextServices,
  ) {
    this.callbacks = callbacks;
    this.text = text;
    this.initial = initial.text;
    this.buffer = new TextBuffer(initial.text);
    this.error = initial.error;
    this.stage.root.setProperties({
      fontFamilies: fonts,
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      color: NAVY,
    });
    this.stage.scene.add(this.backdrop.dim, this.backdrop.shadow);
    // Header: the striped band with the Poké Ball mark, the title with its 2px drop, the close key.
    this.header.add(this.band.content);
    const titleBox = stack(new Container({ flexGrow: 1, minWidth: 0 }), 1);
    this.titles = [
      new Text({
        text: "存档",
        fontSize: 22,
        fontWeight: 800,
        color: NAVY_DEEP,
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 2,
      }),
      stack(new Text({ text: "存档", fontSize: 22, fontWeight: 800, color: "#ffffff" }), 1),
    ];
    titleBox.add(...this.titles);
    this.close = new GameButton(this.stage, {
      tone: "close",
      size: "small",
      square: true,
      icon: createMenuIcon("close"),
    });
    const esc = stack(
      new Container({
        positionType: "absolute",
        positionRight: -6,
        positionBottom: -6,
        height: 16,
        paddingX: 4,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: NAVY_DEEP,
        backgroundColor: "#d8effb",
      }),
      4,
    );
    esc.add(new InputGlyph("cancel", "Esc"));
    this.close.panel.add(esc);
    this.escBadge = esc;
    this.header.add(titleBox, stack(this.close.panel, 1));
    // Body: the well the textarea sits in, and the import error.
    this.ring.content.setProperties({ display: "none" });
    this.previewContent.add(stack(this.codePreview, 1), stack(this.caret, 2));
    this.preview.add(this.previewContent);
    this.well.add(this.wellFace.content, stack(this.ring.content, 3), stack(this.preview, 1));
    this.actions.add(this.trayShade.content);
    this.body.add(this.well, this.status);
    this.copyButton = new GameButton(this.stage, {
      tone: "secondary",
      size: "normal",
      label: "复制",
      icon: createMenuIcon("check"),
    });
    this.loadButton = new GameButton(this.stage, {
      tone: "primary",
      size: "normal",
      label: "导入",
      icon: createMenuIcon("upload"),
    });
    this.keyboardButton = new GameButton(this.stage, {
      tone: "secondary",
      size: "small",
      label: "键盘",
    });
    this.openButton = new GameButton(this.stage, {
      tone: "secondary",
      size: "small",
      label: "打开",
      icon: createMenuIcon("upload"),
    });
    this.exportButton = new GameButton(this.stage, {
      tone: "secondary",
      size: "small",
      label: "导出",
      icon: createMenuIcon("arrow"),
    });
    this.actions.add(
      stack(this.openButton.panel, 1),
      stack(this.exportButton.panel, 1),
      stack(this.keyboardButton.panel, 1),
      stack(this.copyButton.panel, 1),
      stack(this.loadButton.panel, 1),
    );
    this.panel.add(
      stack(
        new Container({
          positionType: "absolute",
          positionLeft: 0,
          positionTop: 0,
          width: "100%",
          height: "100%",
          borderWidth: 1,
          borderRadius: 9,
          borderColor: "#ffd45b",
        }),
        5,
      ),
      this.header,
      this.body,
      this.actions,
      this.keyboard.panel,
    );
    this.stage.root.add(this.panel);
    this.order = [
      this.close,
      "field",
      this.openButton,
      this.exportButton,
      this.keyboardButton,
      this.copyButton,
      this.loadButton,
    ];
    this.input = text.createInput(this.buffer, {
      focus: (focused) => {
        this.fieldFocused = focused;
        if (focused) {
          this.focused = 1;
          this.buffer.select(0, this.buffer.text.length);
        }
        this.paint();
      },
      leave: (backward) => this.leaveField(this.step(1, backward ? -1 : 1)),
      close: () => this.requestClose(),
      error: (error) => {
        this.error = error.message;
        this.paint();
      },
    });
    let previousText = this.buffer.text;
    this.unsubscribe = this.buffer.subscribe(() => {
      if (previousText !== this.buffer.text) this.error = "";
      previousText = this.buffer.text;
      this.paint();
    });
    this.showField();
    this.paint();
    this.animate(true);
  }

  /** `.game-dialog`: opacity 140ms ease-out, transform 220ms (translateY 14px, scale .98). */
  private animate(open: boolean): void {
    const ease = open ? uiEaseOut : easeOut;
    this.stage.motion.animate(
      this.opacity,
      { value: open ? 1 : 0 },
      140,
      () => this.applyFade(),
      ease,
    );
    this.stage.motion.animate(
      this.fade,
      { y: open ? 0 : 14, scale: open ? 1 : 0.98 },
      220,
      () => this.applyFade(),
      ease,
    );
  }
  private readonly opacity = { value: 0 };

  /** Whether the field may show: settled, open, and nothing (portrait notice, curtain, a window
   *  or screen over this one) drawn over the well. */
  private showField(): void {
    const shown = this.settled && !this.closing && !this.covered && !this.keyboardOpen;
    this.preview.setProperties({
      display: this.keyboardOpen || !this.input.overlay ? "flex" : "none",
    });
    this.input.overlay?.visible(shown);
    if (!shown && this.fieldFocused) {
      this.input.blur();
      this.focusCanvas();
    }
  }

  setCovered(covered: boolean): void {
    if (covered === this.covered) return;
    this.covered = covered;
    this.showField();
  }
  private readonly escBadge: Container;

  /** The next control from `from` in Tab order, past unavailable keys (as `:disabled` ones are). */
  private step(from: number, way: 1 | -1): number {
    let next = from;
    do next = (next + way + this.order.length) % this.order.length;
    while (!this.enabled(next));
    return next;
  }

  private enabled(index: number): boolean {
    const entry = this.order[index];
    if (this.pending) return entry === this.close;
    if (entry === "field" && this.keyboardOpen) return false;
    return entry === this.copyButton || entry === this.exportButton
      ? this.canCopy()
      : entry === this.loadButton
        ? this.canLoad()
        : true;
  }
  private canCopy = () => this.buffer.text.length > 0;
  private canLoad = () => this.buffer.text.length > 0 && this.buffer.text !== this.initial;

  private applyFade(): void {
    fade(this.panel, this.opacity.value).setProperties({
      transformTranslateY: this.fade.y,
      transformScaleX: this.fade.scale,
      transformScaleY: this.fade.scale,
    });
    this.backdrop.setOpacity(this.opacity.value);
    this.stage.invalidate();
  }

  private paint(): void {
    if (this.disposed) return;
    const keyed = (i: number) => this.focused === i && this.focusVisible && i !== 1;
    this.order.forEach((entry, i) => {
      if (entry === "field") return;
      entry.setDisabled(!this.enabled(i));
      entry.setHovered(this.hovered === i);
      entry.setFocused(this.focused === i);
      entry.setFocusVisible(keyed(i));
      entry.setPressed(this.pressed === i);
    });
    // The well: `.game-text-input`, its `:focus-visible` (a text box shows it for any focus) and
    // `[aria-invalid]` looks.
    const invalid = this.error !== "";
    this.well.setProperties({
      borderColor: invalid ? DANGER : this.fieldFocused ? "#173f70" : NAVY,
    });
    if (invalid) this.wellFace.setColors("#f6d5da", "#fff4f5");
    else this.wellFace.setColors(this.fieldFocused ? "#d6ecff" : "#dcebf5", "#ffffff");
    this.ring.content.setProperties({ display: this.fieldFocused ? "flex" : "none" });
    this.status.setProperties({ text: this.error, display: invalid ? "flex" : "none" });
    this.codePreview.setProperties({ text: [this.buffer.text] });
    this.input.overlay?.invalid(invalid);
    this.stage.invalidate();
  }

  private leaveField(index: number): void {
    this.input.blur();
    this.focusVisible = true;
    this.focus(index);
    this.focusCanvas();
  }
  private focusCanvas: () => void = () => {};

  bindFocus(focus: () => void): void {
    this.focusCanvas = focus;
  }

  private requestClose(): void {
    if (this.closing) return;
    this.closing = true;
    getAudio().sfx("ui-back");
    this.showField();
    this.animate(false);
    this.closeElapsed = 0;
  }

  private toggleKeyboard(open: boolean): void {
    this.keyboardOpen = open;
    this.keyboard.panel.setProperties({ display: open ? "flex" : "none" });
    this.panel.setProperties({ width: open ? 760 : 560 });
    this.well.setProperties({ height: open ? 24 : 97.5, minHeight: open ? 24 : 72 });
    const v = this.stage.viewport;
    this.body.setProperties({
      paddingY: open ? 0 : v.width <= 520 ? 20 : v.height <= 480 && v.width > v.height ? 12 : 24,
    });
    this.order.splice(
      this.baseCount,
      this.order.length - this.baseCount,
      ...(open ? this.keyboard.keys.map(({ button }) => button) : []),
    );
    this.input.blur();
    this.focusCanvas();
    this.showField();
    this.focus(open ? this.baseCount : 4);
    this.preview.setProperties({ positionTop: open ? 0 : 10, positionBottom: open ? 0 : 10 });
    this.previewRevision = -1;
    this.selectionState = "";
  }

  private async edit(value: string): Promise<void> {
    const revision = this.buffer.revision;
    if (value === "Aa") {
      this.lowercase = !this.lowercase;
      for (const entry of this.keyboard.keys.slice(0, 26)) {
        entry.value = this.lowercase ? entry.value.toLowerCase() : entry.value.toUpperCase();
        entry.button.setLabel(entry.value);
      }
      return;
    }
    if (value === "完成") {
      this.toggleKeyboard(false);
      return;
    }
    if (value === "全选") this.buffer.select(0, this.buffer.text.length);
    else if (value === "←" || value === "→") this.buffer.move(value === "←" ? -1 : 1);
    else if (value === "删除") this.buffer.delete(true);
    else {
      let insert = value;
      if (value === "粘贴") {
        try {
          insert = await this.text.readClipboard();
        } catch (cause) {
          if (!this.disposed) {
            this.error = `粘贴失败：${(cause as Error).message}`;
            this.paint();
          }
          return;
        }
        if (this.disposed || this.closing || this.buffer.revision !== revision) return;
      }
      this.buffer.replace(insert);
    }
    this.paint();
  }

  private async run(index: number): Promise<void> {
    if (this.closing || !this.enabled(index)) return;
    if (index >= this.baseCount) {
      await this.edit(this.keyboard.keys[index - this.baseCount]!.value);
      return;
    }
    if (index === 4) {
      this.toggleKeyboard(!this.keyboardOpen);
      return;
    }
    const entry = this.order[index];
    if (!entry) return;
    if (entry === "field") {
      if (currentInputMode().kind === "gamepad") this.toggleKeyboard(true);
      else this.focus(1);
      return;
    }
    if (entry === this.close) {
      this.requestClose();
      return;
    }
    getAudio().sfx("ui-confirm");
    this.pending = true;
    this.paint();
    try {
      if (entry === this.copyButton) {
        await this.text.writeClipboard(this.buffer.text);
        if (!this.disposed && !this.closing) this.callbacks.notify("存档已复制");
      } else if (entry === this.openButton) {
        const text = await this.text.openFile();
        if (!this.disposed && !this.closing && text !== null) this.buffer.set(text, 0, text.length);
      } else if (entry === this.exportButton) {
        const saved = await this.text.saveFile(this.buffer.text);
        if (saved && !this.disposed && !this.closing) this.callbacks.notify("存档已导出");
      } else if (entry === this.loadButton) {
        this.callbacks.load(this.buffer.text);
        this.requestClose();
      }
    } catch (cause) {
      if (this.disposed || this.closing) return;
      this.error = `${entry === this.loadButton ? "导入" : entry === this.copyButton ? "复制" : entry === this.openButton ? "打开" : "导出"}失败：${(cause as Error).message}`;
      if (entry === this.copyButton) {
        this.buffer.select(0, this.buffer.text.length);
        if (!this.keyboardOpen) this.input.focus();
      }
    } finally {
      this.pending = false;
      if (!this.disposed) this.paint();
    }
  }

  // ── GpuScreen ──────────────────────────────────────────────────────────────────────────────

  resize(width: number, height: number, scale: number, safe: UiInsets): void {
    this.stage.resize(width, height, scale, safe);
    const v = this.stage.viewport;
    const compact = v.height <= 480 && v.width > v.height;
    const narrow = v.width <= 520;
    this.stage.root.setProperties({
      paddingTop: 16 + v.safeArea.top,
      paddingRight: 16 + v.safeArea.right,
      paddingBottom: 16 + v.safeArea.bottom,
      paddingLeft: 16 + v.safeArea.left,
    });
    this.header.setProperties({
      paddingY: compact ? 4 : 8,
      paddingLeft: narrow ? 14 : compact ? 16 : 20,
      paddingRight: narrow ? 8 : compact ? 4 : 10,
    });
    this.body.setProperties({
      paddingX: narrow ? 12 : compact ? 16 : 18,
      paddingY: this.keyboardOpen ? 0 : narrow ? 20 : compact ? 12 : 24,
    });
    this.actions.setProperties({
      paddingTop: compact ? 8 : 12,
      paddingX: compact ? 12 : 14,
      paddingBottom: compact ? 11 : 15,
    });
    // Short landscape: 2px frame, 18px title, a 90px well; narrow: the keys share the width.
    this.panel.setProperties({ borderWidth: compact ? 2 : 3 });
    for (const title of this.titles) title.setProperties({ fontSize: compact ? 18 : 22 });
    this.well.setProperties({
      height: this.keyboardOpen ? 24 : compact ? 90 : 97.5,
      minHeight: this.keyboardOpen ? 24 : 72,
    });
    for (const entry of this.order) if (entry !== "field") entry.fitTouch();
    for (const button of [this.copyButton, this.loadButton])
      button.panel.setProperties(
        narrow
          ? { flexGrow: 1, flexBasis: 0, minWidth: 0 }
          : { flexGrow: 0, flexBasis: "auto", minWidth: v.minTarget },
      );
    this.codeSize = compact ? 12 : 13;
    this.codePreview.setProperties({ fontSize: this.codeSize });
    this.backdrop.resize(v.width, v.height);
    this.placed = "";
  }

  setCoarsePointer(coarse: boolean): void {
    this.escBadge.setProperties({ display: coarse ? "none" : "flex" });
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
    for (const [i, entry] of this.order.entries())
      if (entry !== "field" && this.contains(entry.panel, x, y)) return i;
    if (this.contains(this.well, x, y) && !this.keyboardOpen) return 1;
    return this.contains(this.panel, x, y) ? this.order.length : this.order.length + 1;
  }

  focus(index: number): void {
    if (index >= this.order.length) return;
    if (index === 1 && currentInputMode().kind !== "gamepad" && !this.keyboardOpen) {
      if (!this.fieldFocused) this.buffer.select(0, this.buffer.text.length);
      this.input.focus();
      return;
    }
    this.input.blur();
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
    // `ui/Dialog.tsx`: a press that starts and ends on the backdrop closes.
    if (index === this.order.length + 1) this.requestClose();
    else if (index < this.order.length) void this.run(index);
  }

  scroll(delta: number): void {
    const [x, y] = this.preview.scrollPosition.value;
    const max = this.preview.maxScrollPosition.value?.[1] ?? 0;
    this.preview.scrollPosition.value = [
      x,
      Math.max(0, Math.min(max, y + delta / this.stage.viewport.scale)),
    ];
    this.stage.invalidate();
  }

  navigate(action: NavigationAction): boolean {
    if (action === "cancel") {
      if (this.keyboardOpen) this.toggleKeyboard(false);
      else this.requestClose();
    } else if (this.keyboardOpen && (action === "previousPage" || action === "nextPage"))
      void this.edit("Aa");
    else if (isNavigationDirection(action)) {
      const entries = this.order
        .map((entry, index) => ({ index, panel: entry === "field" ? this.well : entry.panel }))
        .filter(({ index }) => this.enabled(index) && (!this.keyboardOpen || index !== 1));
      this.focus(
        entries[
          gridStep(
            entries.map(({ panel }) => panel),
            entries.findIndex(({ index }) => index === this.focused),
            action,
          )
        ]!.index,
      );
    } else if (action === "next" || action === "previous") {
      this.focus(this.step(this.focused, action === "previous" ? -1 : 1));
    } else if (action === "confirm") void this.run(this.focused);
    return true;
  }

  private textIndex(x: number, y: number): number {
    const matrix = this.codePreview.globalTextMatrix.value;
    const layout = this.codePreview.textLayout.value;
    if (!matrix || !layout) return 0;
    const v = this.stage.viewport;
    this.point
      .set(x / v.scale + this.stage.camera.left, this.stage.camera.top - y / v.scale, 0)
      .applyMatrix4(this.inverse.copy(matrix).invert());
    return getCharIndex(
      layout,
      this.point.x + layout.availableWidth / 2,
      this.point.y - layout.availableHeight / 2,
      "between",
    );
  }

  pointerDown(x: number, y: number): void {
    if (this.input.overlay || this.keyboardOpen || !this.contains(this.well, x, y)) return;
    this.input.focus();
    this.dragAnchor = this.textIndex(x, y);
    this.buffer.select(this.dragAnchor);
  }
  pointerMove(x: number, y: number): void {
    if (this.dragAnchor !== undefined) this.buffer.select(this.dragAnchor, this.textIndex(x, y));
  }
  pointerUp(): boolean {
    const dragged = this.dragAnchor !== undefined;
    this.dragAnchor = undefined;
    return dragged;
  }

  /** Keeps the textarea over the well, in CSS px, whenever the well moves or resizes. */
  afterLayout(deltaMs: number): void {
    this.elapsed += deltaMs;
    if (!this.settled && this.elapsed >= 220) {
      this.settled = true;
      this.showField();
    }
    if (this.closing) {
      this.closeElapsed += deltaMs;
      if (this.closeElapsed >= 220) {
        this.callbacks.closed();
        return;
      }
    }
    this.updateSelection();
    this.keyboard.fitTouch();
    if (this.band.update(deltaMs) && idleTicked(15)) this.stage.invalidate();
    this.wellFace.update();
    this.trayShade.update();
    for (const entry of this.order) if (entry !== "field") entry.update(deltaMs);
    const panelMatrix = this.panel.globalMatrix.value,
      panelSize = this.panel.size.value;
    if (panelMatrix && panelSize)
      this.backdrop.updatePanel(panelMatrix, panelSize[0], panelSize[1]);
    const m = this.well.globalMatrix.value,
      size = this.well.size.value;
    if (!m || !size) return;
    const v = this.stage.viewport;
    // On the same device-pixel grid as the well it sits in.
    const device = this.stage.pixelGrid / v.scale,
      snap = (css: number) => Math.round(css * device) / device;
    const left = snap((m.elements[12]! - this.stage.camera.left - size[0] / 2 + 2) * v.scale),
      top = snap((this.stage.camera.top - m.elements[13]! - size[1] / 2 + 2) * v.scale),
      width = snap((size[0] - 4) * v.scale),
      height = snap((size[1] - 4) * v.scale);
    const key = [left, top, width, height, v.scale, this.codeSize]
      .map((n) => n.toFixed(1))
      .join(",");
    if (key === this.placed) return;
    this.placed = key;
    this.input.overlay?.bounds(left, top, width, height, this.codeSize * v.scale, v.scale);
  }

  private updateSelection(): void {
    if (!this.keyboardOpen && this.input.overlay) return;
    const layout = this.codePreview.textLayout.value,
      size = this.codePreview.size.value;
    if (!layout || !size) return;
    const state = `${this.buffer.revision}:${this.fieldFocused}:${this.keyboardOpen}`;
    if (this.selectionLayout === layout && this.selectionState === state) return;
    this.selectionLayout = layout;
    this.selectionState = state;
    const selected = getSelectionTransformations(layout, [this.buffer.start, this.buffer.end]);
    const cursor = getCaretTransformation(layout, this.buffer.cursor) ?? {
      position: [-size[0] / 2, size[1] / 2 - this.codeSize / 2] as [number, number],
      height: this.codeSize,
    };
    const show = this.fieldFocused || this.keyboardOpen;
    const caret = this.buffer.start === this.buffer.end ? cursor : undefined;
    this.caret.setProperties({
      display: show && caret ? "flex" : "none",
      positionLeft: size[0] / 2 + (caret?.position[0] ?? 0),
      positionTop: size[1] / 2 - (caret?.position[1] ?? 0) - (caret?.height ?? 0) / 2,
      height: caret?.height ?? 0,
    });
    while (this.selectionPanels.length > selected.selections.length) {
      const panel = this.selectionPanels.pop()!;
      this.previewContent.remove(panel);
      panel.dispose();
    }
    while (this.selectionPanels.length < selected.selections.length) {
      const panel = new Container({ positionType: "absolute", backgroundColor: "#ffd45b" });
      this.previewContent.add(panel);
      this.selectionPanels.push(panel);
    }
    this.selectionPanels.forEach((panel, index) => {
      const selection = selected.selections[index];
      panel.setProperties({
        display: show && selection ? "flex" : "none",
        positionLeft: size[0] / 2 + (selection?.position[0] ?? 0) - (selection?.size[0] ?? 0) / 2,
        positionTop: size[1] / 2 - (selection?.position[1] ?? 0) - (selection?.size[1] ?? 0) / 2,
        width: selection?.size[0] ?? 0,
        height: selection?.size[1] ?? 0,
      });
    });
    if (this.previewRevision !== this.buffer.revision && cursor) {
      this.previewRevision = this.buffer.revision;
      const [x, y] = this.preview.scrollPosition.value;
      const height = this.preview.size.value?.[1] ?? 0;
      const top = size[1] / 2 - cursor.position[1] - cursor.height / 2;
      if (top < y || top + cursor.height > y + height)
        this.preview.scrollPosition.value = [
          x,
          Math.max(0, top < y ? top : top + cursor.height - height),
        ];
    }
  }

  releaseUploads(): void {
    this.stage.releaseUploads();
  }

  dispose(): void {
    this.keyboard.dispose();
    this.disposed = true;
    this.unsubscribe();
    this.input.dispose();
    this.backdrop.dispose();
    this.band.dispose();
    this.wellFace.dispose();
    this.trayShade.dispose();
    this.ring.dispose();
    for (const entry of this.order.slice(0, this.baseCount)) if (entry !== "field") entry.dispose();
    this.stage.dispose();
  }
}
