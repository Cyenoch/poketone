import type { UiKey } from "../../platform/ui-surface";
import { isNavigationDirection, type NavigationAction } from "../../platform/input";
import { InputGlyph } from "./input-glyph";
import { revealInScroller } from "./scroll-reveal";
import { EASE, idleTicked, stagger } from "./motion";
import { Component, Container, Image, Text, type FontFamilies } from "@pmndrs/uikit";
import { Matrix4, Vector3, type WebGLRenderer } from "three";
import { getAudio } from "../../audio/engine";
import {
  codexEntry,
  codexSections,
  dexBlock,
  formKey,
  hasShinyRecord,
  type CodexBlock,
  type CodexEntry,
  type CodexModel,
  type CodexRef,
} from "../../run/codex";
import { rarityNames } from "../../run/sim/upgrades";
import { starterLock } from "../../run/locks";
import type { Progress } from "../../run/progress";
import { lineForms, starterOrder, type StarterId } from "../../run/sim/content/lines/index";
import { LockChip } from "./lock-chip";
import { CodexModelStage, CodexThumbs, KEY_TURN } from "./codex-model";
import {
  BallGround,
  CodexChip,
  CodexRow,
  createArt,
  typeChip,
  typeInk,
  type CodexPaint,
} from "./codex-parts";
import { slantTag } from "./tag";
import { DialogBackdrop } from "./dialog-backdrop";
import { DialogFrame } from "./dialog-surface";
import { InnerScreenFrame } from "./inner-screen";
import type { GpuScreen } from "./app-host";
import { cubicBezier, uiEaseOut } from "./focus-mark";
import { GameButton } from "./game-button";
import { createMenuIcon } from "./icons";
import { rarityTones } from "./run-choice-surface";
import { fade, stack } from "./layer";
import { segmentTray, SegmentFace } from "./segment-face";
import { SlantPlate } from "./slant-plate";
import { UiStage } from "./stage";
import { HARD_SHADOW, RADIUS, RADIUS_INNER, slantOf, ui } from "./tokens";
import { GpuTooltip } from "./tooltip";
import { balanceLines, breakLines, type GlyphWidths } from "./line-break";
import type { UiInsets } from "./viewport";

export interface CodexOptions {
  /** Partners not yet unlocked show as silhouettes with their lock, without their kit. */
  progress: Progress;
  onClose(): void;
  /** Outside a run the 图鉴 is a page on the paper ground (the shared top line), not a window. */
  page?: { settings(): void };
}

/** Each partner form's page, by the line it belongs to. */
const formLines = new Map<string, StarterId>(
  starterOrder.flatMap((line) => lineForms(line).map((form) => [formKey(form.id), line] as const)),
);
/** What a locked partner's page keeps: its evolution chain (in silhouette). */
const LOCKED_BLOCKS = new Set(["进化"]);

type Region = "back" | "close" | "settings" | "tab" | "entry" | "model" | "look" | "ref";

interface Control {
  region: Region;
  panel: Container;
  activate(): void;
  /** Draws the control's pointer, keyboard and pick state. */
  paint(state: CodexPaint, animate: boolean): void;
  /** Entry key (entries, refs) or section index (tabs). */
  key?: string;
  tab?: number;
  tip?: string;
}

/** Where a followed link was left from: back returns here, as it was. */
interface Stop {
  section: number;
  key: string;
  listScroll: number;
  detailScroll: number;
  /** The page link that was followed (its index among the page's controls), or -1. */
  link: number;
}

/** A rebuilt part of the window: its root and everything it owns outside the UIKit tree. */
interface Part {
  root: Container;
  owned: { dispose(): void }[];
  wraps: Wrap[];
}

/**
 * Text broken by `line-break.ts` (numbers whole, no line-start punctuation, no orphan) and drawn
 * with UIKit's no-wrap wrapper, so those are its only breaks. `width` reads a box whose width does
 * not depend on this text; the text is broken again whenever that width changes.
 */
interface Wrap {
  node: Text;
  text: string;
  size: number;
  width(): number | undefined;
  balance: boolean;
  laid: number;
}

/** Greedy lines, evened out when asked or when the last line would be an orphan. */
function wrapText(
  text: string,
  width: number,
  size: number,
  font: GlyphWidths,
  balance: boolean,
): string {
  const greedy = breakLines(text, width, size, font);
  const lines = greedy.split("\n");
  if (lines.length < 2) return greedy;
  return balance || lines.at(-1)!.length <= 2 ? balanceLines(text, width, size, font) : greedy;
}

const LONG_PRESS_MS = 450;

const REVEAL_WAIT_MS = 300;
const fadeEase = (t: number) => cubicBezier(t, 0, 0, 0.58, 1);
/** List rows past this many come in with the list itself, not one by one. */
const STAGGERED_ROWS = 12;

/**
 * The 图鉴: a paper window with its title plate, category segments in the header, an entry list,
 * and the selected entry's page. Every
 * page is built from `run/codex.ts`; links on a page jump to their entry and leave a trail that back
 * (the header key, Esc, Backspace) retraces. Its own UI pass owns modal
 * input like the settings window; the host draws it with `render()` so the model's offscreen pass
 * runs first.
 */
export class GpuCodex {
  readonly stage = new UiStage();
  /** The smallest logical size its tabs, list and detail card are laid out for (screenScale). */
  readonly minLayout = { width: 750, height: 375 };
  private readonly sections = codexSections();
  private readonly options: CodexOptions;
  /** The window's dim and drop shadow; a page has none. */
  private readonly backdrop: DialogBackdrop | undefined;
  private readonly tooltip: GpuTooltip;
  private readonly model: CodexModelStage;
  private readonly thumbs = new CodexThumbs(() => this.stage.invalidate());
  /** Wrapped texts of the part being built. */
  private building: Wrap[] = [];
  /** The window's frame, or the page's (one of the two). */
  private readonly frame: DialogFrame | undefined;
  private readonly inner: InnerScreenFrame | undefined;
  private readonly tabTray: Container;
  private readonly panel: Container;
  private readonly body: Container;
  private readonly listPane: Container;
  private readonly detailPane: Container;
  private readonly owned: { dispose(): void }[] = [];
  /** The window's close key; on a page, its back key (which retraces the trail first). */
  private readonly close: Control;
  private readonly settings: Control | undefined;
  private readonly back: Control;
  private readonly backKey: GameButton;
  /** Esc goes back first while a trail exists: the cap moves to the back key. */
  private readonly backBadge: Container;
  private readonly segments: SegmentFace[] = [];
  /** Links followed since the last direct pick (a tab or a list row), oldest first. */
  private readonly trail: Stop[] = [];
  private restoring: Stop | undefined;
  private readonly tabs: Control[] = [];
  private entries: Control[] = [];
  private details: Control[] = [];
  private controls: Control[] = [];
  private list: Part | undefined;
  private detail: Part | undefined;
  private modelNote: Text | undefined;
  /** The enemy page whose model shows in its shiny palette (browsing only, never saved). */
  private shinyOf: string | undefined;
  private readonly memory = new Map<string, string>();
  private section = 0;
  private selectedKey = "";
  private focusIndex = 0;
  private focused!: Control;
  private hovered: number | null = null;
  private pressed: number | null = null;
  private focusVisible = true;
  private coarse = false;
  private needsReveal = true;
  private lastLayout = "";
  private pointer = { x: -1, y: -1 };
  private pressPane: Container | undefined;
  /** The pointer whose press the window follows; a second finger is ignored like `MenuInput`. */
  private owner: number | undefined;
  private turning: { x: number } | undefined;
  private tipPress: { index: number; at: number; x: number; y: number; fired: boolean } | null =
    null;
  private touchTip: number | null = null;
  private elapsed = 0;
  private readonly enterFade = { opacity: 0 };
  private readonly enterMove = { y: 14, scale: 0.98 };
  private readonly listIn = { opacity: 1, x: 0 };
  /** The list rows' staggered entrance, one state per row. */
  private rowsIn: { x: number; opacity: number }[] = [];
  /** The page's name plate, unrolled from the left as the page comes in. */
  private namePlate: SlantPlate | undefined;
  private readonly unroll = { reveal: 1 };
  private readonly detailIn = { opacity: 1, y: 0 };
  private pending: {
    state: object;
    images: { texture: { value: unknown } }[];
    wraps: Wrap[];
    waited: number;
    frames: number;
    start(): void;
  }[] = [];
  private closing = false;
  private modelAsked = false;
  private exitRemaining = 0;
  private readonly point = new Vector3();
  private readonly inverse = new Matrix4();
  private compact = false;
  private minTarget = 0;
  private listWidth = 300;

  get exitFinished(): boolean {
    return this.closing && this.exitRemaining <= 0;
  }

  constructor(fonts: FontFamilies, options: CodexOptions) {
    this.options = options;
    const invalidate = () => this.stage.invalidate();
    this.model = new CodexModelStage(() => {
      this.paintModelNote();
      invalidate();
    });
    const page = options.page;
    this.stage.root.setProperties({
      fontFamilies: fonts,
      flexDirection: "column",
      ...(page ? {} : { alignItems: "center", justifyContent: "center" }),
    });
    if (page) {
      this.inner = new InnerScreenFrame(this.stage, "图鉴");
      this.owned.push(this.inner);
      this.panel = new Container({ flexDirection: "column", flexGrow: 1, minHeight: 0 });
      this.panel.add(this.inner.topline, this.inner.body);
      this.backKey = this.inner.back;
    } else {
      this.backdrop = new DialogBackdrop();
      this.stage.scene.add(this.backdrop.dim, this.backdrop.shadow);
      this.frame = new DialogFrame(this.stage, "图鉴", 1240);
      // The title leads the header row beside the tabs, lined up with the list below.
      this.frame.seatTitle();
      this.owned.push(this.frame);
      this.panel = this.frame.panel;
      this.panel.setProperties({ width: "100%", height: "100%", maxWidth: 1240, maxHeight: 820 });
      // Back leads the header's controls, shown while a trail exists: top left, clear of the thumb.
      this.backKey = new GameButton(this.stage, {
        tone: "secondary",
        size: "small",
        square: true,
        icon: createMenuIcon("back"),
      });
      this.owned.push(this.backKey);
    }
    this.backBadge = new Container({
      positionType: "absolute",
      positionRight: -4,
      positionBottom: -6,
    });
    this.backBadge.add(new InputGlyph("cancel", "Esc"));
    this.back = this.keyControl("back", this.backKey, () => this.goBack());
    const tray = segmentTray();
    this.owned.push(tray);
    this.tabTray = tray.tray;
    tray.tray.setProperties({ flexShrink: 1, minWidth: 0 });
    if (this.frame) {
      this.backKey.panel.add(stack(this.backBadge, 3));
      this.backKey.panel.setProperties({ display: "none" });
      this.frame.extra.add(stack(this.backKey.panel, 1), stack(tray.tray, 1));
    }
    for (const [index, section] of this.sections.entries()) {
      const face = new SegmentFace(this.stage, section.name);
      this.segments.push(face);
      this.owned.push(face);
      tray.tray.add(stack(face.panel, 1));
      this.tabs.push({
        region: "tab",
        panel: face.panel,
        tab: index,
        activate: () => this.pickSection(index),
        paint: (state) => face.paint({ ...state, checked: state.selected, locked: false }),
      });
    }
    if (this.inner) {
      this.close = this.keyControl("close", this.inner.back, () =>
        this.trail.length ? this.goBack() : this.options.onClose(),
      );
      this.settings = this.keyControl("settings", this.inner.settings, () => page!.settings());
    } else this.close = this.keyControl("close", this.frame!.close, () => this.options.onClose());

    this.body = new Container({
      flexDirection: "row",
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 0,
      gap: 12,
      padding: 14,
    });
    this.listPane = new Container({
      width: this.listWidth,
      flexShrink: 0,
      flexDirection: "column",
      overflow: "scroll",
      backgroundColor: ui.mist,
      borderRadius: RADIUS,
      scrollbarWidth: 3,
      scrollbarColor: ui.muted,
    });
    this.detailPane = new Container({
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      flexDirection: "column",
      overflow: "scroll",
      scrollbarWidth: 3,
      scrollbarColor: ui.muted,
    });
    this.body.add(this.listPane, this.detailPane);
    if (this.inner) {
      // On the patterned ground the page reads on its own card, as 研究所's tiles do.
      this.detailPane.setProperties({ backgroundColor: ui.white, borderRadius: RADIUS });
      this.inner.body.add(stack(tray.tray, 1), stack(this.body, 1));
    } else this.panel.add(stack(this.body, 1));
    this.stage.root.add(this.panel);
    this.tooltip = new GpuTooltip(this.stage);
    this.focused = this.tabs[0]!;
    this.showSection(0, true);
    // A page comes in under the scene curtain; a window rises over what it covers.
    if (this.frame) {
      this.applyEnter();
      this.animateWindow(true);
    }
  }

  // ── Building ──────────────────────────────────────────────────────────────

  /** A header key (back, close) as a control: the button draws its own states. */
  private keyControl(
    region: "back" | "close" | "settings",
    button: GameButton,
    activate: () => void,
  ): Control {
    return {
      region,
      panel: button.panel,
      activate,
      paint: (state) => {
        button.setHovered(state.hovered);
        button.setFocused(state.focused);
        button.setFocusVisible(state.focusVisible);
        button.setPressed(state.pressed);
      },
    };
  }

  /** Keeps focus on the same control across a rebuild, else on the selected row. */
  private rebuildControls(): void {
    this.setPressed(null);
    this.controls.length = 0;
    if (this.trail.length && this.frame) this.controls.push(this.back);
    this.controls.push(this.close);
    if (this.settings) this.controls.push(this.settings);
    this.controls.push(...this.tabs, ...this.entries, ...this.details);
    this.touchTip = null;
    this.tipPress = null;
    this.hovered = null;
    this.focusIndex = this.controls.indexOf(this.focused);
    if (this.focusIndex < 0) {
      this.focused =
        this.entries.find((row) => row.key === this.selectedKey) ?? this.tabs[this.section]!;
      this.focusIndex = this.controls.indexOf(this.focused);
    }
    this.needsReveal = true;
    this.paintFocus();
  }

  private disposePart(part: Part | undefined): void {
    if (!part) return;
    part.root.removeFromParent();
    const components: { dispose(): void }[] = [];
    part.root.traverse((node) => {
      if (node instanceof Component) components.push(node);
    });
    for (const component of components.reverse()) component.dispose();
    for (const owned of part.owned) owned.dispose();
  }

  /** A direct pick (a tab, a list row) starts afresh: the trail is only for links followed. */
  private clearTrail(): void {
    if (!this.trail.length) return;
    this.trail.length = 0;
    this.restoring = undefined;
    this.paintTrail();
  }

  private pickSection(index: number): void {
    this.clearTrail();
    this.selectSection(index, true);
  }

  private pickEntry(key: string): void {
    this.clearTrail();
    this.selectEntry(key, true);
  }

  /** Back shows while a trail exists, and takes the Esc badge from close (Esc goes back first). */
  private paintTrail(): void {
    // A page's back key is always shown and always retraces first.
    if (!this.frame) return;
    const trail = this.trail.length > 0;
    this.backKey.panel.setProperties({ display: trail ? "flex" : "none" });
    this.backBadge.setProperties({ display: trail && !this.coarse ? "flex" : "none" });
    this.frame.escBadge.setProperties({ display: !trail && !this.coarse ? "flex" : "none" });
    if (this.controls.includes(this.back) !== trail) this.rebuildControls();
  }

  /** Imported progress: redraw the open section in place so its locks follow. */
  update(progress: Progress): void {
    this.options.progress = progress;
    const key = this.selectedKey;
    this.selectedKey = "";
    this.showSection(this.section, false, key || undefined);
  }

  private selectSection(index: number, animate: boolean): void {
    if (index === this.section && this.list) return;
    this.showSection(index, animate);
  }

  private showSection(index: number, animate: boolean, key?: string): void {
    const previous = this.sections[this.section]!;
    if (this.selectedKey) this.memory.set(previous.id, this.selectedKey);
    this.section = index;
    const section = this.sections[index]!;
    for (const row of this.rowsIn) this.stage.motion.cancel(row);
    this.disposePart(this.list);
    // The old rows are gone: nothing paints them until the controls are rebuilt below.
    this.controls.length = 0;
    const owned: { dispose(): void }[] = [];
    // Clips the rows' plates (their shadow and slant reach past the row) so they never widen the
    // pane's scroll; the padding keeps lifts, shadows and focus rings inside the clip.
    const root = new Container({
      flexDirection: "column",
      gap: 6,
      flexShrink: 0,
      overflow: "hidden",
      // The picked row's 5px lift plus its focus ring.
      paddingTop: 14,
      paddingBottom: 12,
      paddingLeft: 8,
      paddingRight: 14,
    });
    this.entries = [];
    for (const group of section.groups) {
      if (section.groups.length > 1)
        root.add(
          new Text({
            text: group.title,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 1,
            color: ui.muted,
            paddingLeft: 6,
            paddingTop: 6,
          }),
        );
      for (const entry of group.entries) root.add(this.entryRow(entry, owned));
    }
    this.list = { root, owned, wraps: [] };
    this.listPane.add(root);
    this.listPane.scrollPosition.value = [0, 0];
    const wanted = key ?? this.memory.get(section.id) ?? this.entries[0]!.key!;
    this.selectedKey = "";
    this.selectEntry(wanted, animate);
    this.rebuildControls();
    this.applyThumbReserve();
    this.rowsIn = this.entries.slice(0, STAGGERED_ROWS).map(() => ({ x: 0, opacity: 1 }));
    this.fadeIn(root, this.listIn, "x", 0, 120, animate, [], () => this.staggerRows());
  }

  /** The list's entrance: its first rows slide in from the left one after another, 45ms apart. */
  private staggerRows(): void {
    for (const [i, state] of this.rowsIn.entries()) {
      const panel = this.entries[i]!.panel;
      this.stage.motion.enter(
        state,
        { x: -36, opacity: 0 },
        { x: 0, opacity: 1 },
        380,
        () => {
          fade(panel, state.opacity).setProperties({ transformTranslateX: state.x });
          this.stage.invalidate();
        },
        EASE,
        stagger(i),
      );
    }
  }

  private entryRow(entry: CodexEntry, owned: { dispose(): void }[]): Container {
    const row = new CodexRow(this.stage, entry, this.thumbs, !!this.lock(entry));
    row.fitTouch(this.stage.viewport.minTarget);
    owned.push(row);
    this.entries.push({
      region: "entry",
      panel: row.panel,
      key: entry.key,
      activate: () => this.pickEntry(entry.key),
      paint: (state, animate) => row.paint(state, animate),
    });
    return row.panel;
  }

  private selectEntry(key: string, animate: boolean): void {
    if (key === this.selectedKey) return;
    this.selectedKey = key;
    if (this.controls.length) this.paintFocus();
    const entry = codexEntry(key)!.entry;
    this.disposePart(this.detail);
    this.details = [];
    this.modelNote = undefined;
    this.namePlate = undefined;
    const owned: { dispose(): void }[] = [];
    this.building = [];
    // Clipped like the list (see `showSection`), with room for the plates' shadows and lifts.
    const root = new Container({
      flexDirection: "column",
      gap: this.compact ? 12 : 18,
      flexShrink: 0,
      overflow: "hidden",
      paddingTop: 8,
      paddingBottom: this.compact ? 8 : 12,
      paddingLeft: 8,
      paddingRight: 12,
    });
    const lock = this.lock(entry);
    // Another page, or a record no longer there (imported progress), starts in its own colours.
    if (this.shinyOf !== key || !this.shinyRecord(entry)) this.shinyOf = undefined;
    root.add(this.hero(entry, lock, owned));
    for (const block of this.pageBlocks(entry))
      if (!lock || LOCKED_BLOCKS.has(block.title)) root.add(this.block(block, entry, owned));
    this.detail = { root, owned, wraps: this.building };
    this.building = [];
    this.detailPane.add(root);
    this.detailPane.scrollPosition.value = [0, 0];
    // A partner not yet unlocked shows its portrait's silhouette, not its model.
    this.model.show(lock ? undefined : this.picture(entry));
    this.paintModelNote();
    if (this.controls.length) this.rebuildControls();
    const plate = this.namePlate as SlantPlate | undefined;
    // The name plate unrolls from the left as the page shows.
    const unroll = this.unroll;
    this.stage.motion.cancel(unroll);
    unroll.reveal = animate ? 0 : 1;
    plate?.set(unroll);
    this.fadeIn(root, this.detailIn, "y", 8, 180, animate, this.detail.wraps, () =>
      this.stage.motion.animate(
        unroll,
        { reveal: 1 },
        380,
        () => {
          plate?.set({ reveal: unroll.reveal });
          this.stage.invalidate();
        },
        EASE,
      ),
    );
  }

  /** An enemy's page carries the player's record of it after its numbers. */
  private pageBlocks(entry: CodexEntry): readonly CodexBlock[] {
    const model = entry.model;
    if (model?.kind !== "enemy") return entry.blocks;
    const [numbers, ...rest] = entry.blocks;
    return [numbers!, dexBlock(this.options.progress.dex, model.id), ...rest];
  }

  private shinyRecord(entry: CodexEntry): boolean {
    const model = entry.model;
    return model?.kind === "enemy" && hasShinyRecord(this.options.progress.dex, model.id);
  }

  /** The model the stage shows for `entry`: in the shiny palette while that is picked. */
  private picture(entry: CodexEntry): CodexModel | undefined {
    const model = entry.model;
    return model?.kind === "enemy" && this.shinyOf === entry.key
      ? { ...model, shiny: true }
      : model;
  }

  /** 普通 / 异色 on the page's ink tray, like the section segments; picking one recolours the
   *  model in place (same turn and pose). */
  private palettePicker(entry: CodexEntry, owned: { dispose(): void }[]): Container {
    const tray = segmentTray();
    owned.push(tray);
    for (const [shiny, text] of [
      [false, "普通"],
      [true, "异色"],
    ] as const) {
      const face = new SegmentFace(this.stage, text);
      owned.push(face);
      face.fitTouch();
      face.label.setProperties({ fontSize: this.compact ? 15 : 16 });
      tray.tray.add(stack(face.panel, 1));
      this.details.push({
        region: "look",
        panel: face.panel,
        activate: () => this.pickPalette(entry, shiny),
        paint: (state) =>
          face.paint({ ...state, checked: (this.shinyOf === entry.key) === shiny, locked: false }),
      });
    }
    return tray.tray;
  }

  private pickPalette(entry: CodexEntry, shiny: boolean): void {
    if ((this.shinyOf === entry.key) === shiny) return;
    this.shinyOf = shiny ? entry.key : undefined;
    this.model.show(this.picture(entry));
    this.paintModelNote();
    this.paintFocus();
  }

  /** A text broken by `line-break.ts` at the width `width` reports (see `Wrap`). */
  private wrapped(
    text: string,
    properties: Omit<NonNullable<ConstructorParameters<typeof Text>[0]>, "text"> & {
      fontSize: number;
    },
    width: () => number | undefined,
    balance = false,
  ): Text {
    const node = new Text({ ...properties, text, whiteSpace: "pre", wordBreak: "keep-all" });
    this.building.push({ node, text, size: properties.fontSize, width, balance, laid: 0 });
    return node;
  }

  /** Breaks every wrapped text whose width changed; true when one did. */
  private layWraps(wraps: readonly Wrap[]): boolean {
    let changed = false;
    for (const wrap of wraps) {
      const font = wrap.node.fontSignal.value;
      const width = wrap.width();
      if (!font || !width || width <= 0 || Math.abs(width - wrap.laid) < 0.5) continue;
      wrap.laid = width;
      wrap.node.setProperties({ text: wrapText(wrap.text, width, wrap.size, font, wrap.balance) });
      changed = true;
    }
    return changed;
  }

  /**
   * Fades a rebuilt list or page in. It stays hidden until its pictures have textures (and its text
   * one layout), so it never appears as plates without icons or labels; an image that fails to load
   * stops holding it after `REVEAL_WAIT_MS`.
   */
  private fadeIn(
    root: Container,
    state: { opacity: number } & ({ x: number } | { y: number }),
    axis: "x" | "y",
    offset: number,
    duration: number,
    animate: boolean,
    wraps: Wrap[],
    onStart?: () => void,
  ): void {
    this.pending = this.pending.filter((pending) => pending.state !== state);
    const apply = () => {
      fade(root, state.opacity).setProperties(
        axis === "x"
          ? { transformTranslateX: (state as { x: number }).x }
          : { transformTranslateY: (state as { y: number }).y },
      );
      this.stage.invalidate();
    };
    const start = () => {
      this.stage.motion.animate(
        state,
        { opacity: 1, [axis]: 0 } as typeof state,
        duration,
        apply,
        uiEaseOut,
      );
      onStart?.();
    };
    this.stage.motion.cancel(state);
    if (!animate) {
      Object.assign(state, { opacity: 1, [axis]: 0 });
      apply();
      return;
    }
    Object.assign(state, { opacity: 0, [axis]: offset });
    apply();
    const images: { texture: { value: unknown } }[] = [];
    root.traverse((node) => {
      if (node instanceof Image) images.push(node);
    });
    this.pending.push({ state, images, wraps, waited: 0, frames: 0, start });
  }

  /**
   * The page's head: the picture (the turnable model, or the portrait, on the ball ground; else the
   * entry's art), then its name on the ink plate and its type and tag chips.
   */
  /** A partner's form whose line is not yet unlocked: what is still needed; else null. */
  private lock(entry: CodexEntry): string | null {
    const line = formLines.get(entry.key);
    return line ? starterLock(this.options.progress, line) : null;
  }

  private hero(entry: CodexEntry, lock: string | null, owned: { dispose(): void }[]): Container {
    const compact = this.compact;
    const pokemon = !!entry.model || entry.art.kind === "portrait";
    const hero = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: compact ? 14 : 22,
      height: pokemon ? (compact ? 150 : 210) : compact ? 92 : 132,
      flexShrink: 0,
    });
    const picture = new Container({
      width: pokemon ? (compact ? 170 : 260) : compact ? 92 : 132,
      height: "100%",
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: RADIUS,
      borderWidth: 2,
      borderColor: "transparent",
    });
    if (pokemon) {
      const ground = new BallGround(typeInk(entry.types[0]));
      owned.push(ground);
      picture.add(ground.content);
    } else picture.setProperties({ backgroundColor: ui.mist });
    if (entry.model && !lock) {
      picture.add(stack(this.model.mount(), 1));
      this.modelNote = new Text({ text: "", fontSize: 13, fontWeight: 800, color: ui.ink });
      picture.add(stack(this.modelNote, 2));
      // Focus outlines the stage (its arrows turn the model); it has no hover or press of its own.
      this.details.push({
        region: "model",
        panel: picture,
        activate: () => {},
        paint: (state) =>
          picture.setProperties({
            borderColor: state.focused && state.focusVisible ? ui.ink : "transparent",
          }),
      });
    } else {
      const size = pokemon ? (compact ? 104 : 150) : compact ? 64 : 96;
      const art = createArt(entry, size, this.thumbs, !!lock);
      owned.push(art);
      if (pokemon) art.root.setProperties({ marginBottom: compact ? 18 : 26 });
      picture.add(stack(art.root, 1));
    }
    hero.add(picture);
    const copy = new Container({
      flexDirection: "column",
      alignItems: "flex-start",
      gap: compact ? 10 : 14,
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
    });
    const nameHeight = compact ? 40 : 52;
    const lean = slantOf(nameHeight);
    const name = new Container({
      minHeight: nameHeight,
      flexShrink: 1,
      minWidth: 0,
      // Centred on the plate's visual centre (the box's): equal room both sides of the slant.
      alignItems: "center",
      justifyContent: "center",
      paddingX: 18 + lean,
      paddingY: 4,
    });
    const plate = new SlantPlate(name, { fill: ui.ink });
    plate.set({ depth: HARD_SHADOW.offset });
    owned.push(plate);
    this.namePlate = plate;
    name.add(
      plate.content,
      stack(
        this.wrapped(
          entry.name,
          {
            fontSize: compact ? 22 : 28,
            fontWeight: 900,
            letterSpacing: 1,
            color: ui.white,
            textAlign: "center",
          },
          () => {
            const width = copy.size.value?.[0];
            return width ? width - 36 - 2 * lean : undefined;
          },
          true,
        ),
        1,
      ),
    );
    copy.add(stack(name, 1));
    if (lock) {
      const chip = new LockChip();
      chip.set(lock);
      chip.size(nameHeight, compact);
      copy.add(stack(chip.panel, 1));
    }
    const tags = new Container({ flexDirection: "row", flexWrap: "wrap", gap: 8 });
    for (const type of entry.types) {
      const chip = typeChip(type, compact);
      owned.push(chip);
      tags.add(chip.tag);
    }
    for (const text of entry.tags) {
      const chip = slantTag(text, { face: ui.mist, ink: ui.ink, size: compact ? 13 : 14 });
      owned.push(chip);
      tags.add(chip.tag);
    }
    if (entry.types.length || entry.tags.length) copy.add(stack(tags, 1));
    // After the model's control, so focus reads stage → palette → the page's links.
    if (entry.model && !lock && this.shinyRecord(entry))
      copy.add(stack(this.palettePicker(entry, owned), 1));
    hero.add(copy);
    return hero;
  }

  private block(block: CodexBlock, entry: CodexEntry, owned: { dispose(): void }[]): Container {
    const root = new Container({ flexDirection: "column", gap: 10, flexShrink: 0 });
    // The heading keeps its width; the rule takes what is left (none on a narrow page).
    const title = new Container({ flexDirection: "row", alignItems: "center", gap: 10 });
    title.add(
      new Text({
        text: block.title,
        fontSize: 15,
        fontWeight: 900,
        letterSpacing: 1,
        color: ui.ink,
        flexShrink: 0,
        wordBreak: "keep-all",
      }),
      new Container({
        height: 2,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        backgroundColor: ui.line,
        borderRadius: 1,
      }),
    );
    root.add(title);
    const body = new Container({ flexDirection: "row", flexWrap: "wrap", gap: 8 });
    if (block.kind === "stats")
      for (const row of block.rows) {
        const wide = row.value.length > 10;
        const cell = new Container({
          flexDirection: wide ? "row" : "column",
          alignItems: wide ? "center" : "flex-start",
          gap: wide ? 12 : 2,
          minWidth: 96,
          ...(wide ? { width: "100%" } : {}),
          paddingX: 12,
          paddingY: 8,
          borderRadius: RADIUS_INNER,
          backgroundColor: ui.mist,
        });
        const label = new Text({
          text: row.label,
          fontSize: 12,
          fontWeight: 700,
          color: ui.muted,
          flexShrink: 0,
          wordBreak: "keep-all",
        });
        cell.add(
          label,
          wide
            ? this.wrapped(
                row.value,
                { fontSize: 16, fontWeight: 800, color: ui.ink, flexShrink: 1 },
                () => {
                  const width = cell.size.value?.[0],
                    labelWidth = label.size.value?.[0];
                  return width && labelWidth ? width - 2 * 12 - labelWidth - 12 : undefined;
                },
              )
            : new Text({
                text: row.value,
                fontSize: 16,
                fontWeight: 800,
                color: ui.ink,
                wordBreak: "keep-all",
              }),
        );
        body.add(cell);
      }
    else if (block.kind === "lines") {
      body.setProperties({ flexDirection: "column", gap: 6 });
      for (const line of block.lines)
        body.add(
          this.wrapped(
            line,
            { fontSize: 15, fontWeight: 700, lineHeight: 1.45, color: ui.ink },
            () => body.size.value?.[0],
          ),
        );
    } else if (block.kind === "rolls") {
      body.setProperties({ alignItems: "flex-start" });
      body.add(...this.rolls(block));
    } else for (const ref of block.refs) body.add(this.refChip(ref, entry, owned));
    root.add(body);
    return root;
  }

  /**
   * A move's level-ups: the gain every level gives, then what a level-up card adds, one row per
   * stat under the card's lowest and highest rarity (chips in the cards' rarity colours).
   */
  private rolls(block: Extract<CodexBlock, { kind: "rolls" }>): Container[] {
    const cell = (text: string, width: number, strong: boolean) =>
      new Text({
        text,
        width,
        flexShrink: 0,
        fontSize: strong ? 16 : 13,
        fontWeight: 800,
        color: strong ? ui.ink : ui.muted,
        wordBreak: "keep-all",
      });
    const LABEL = 76,
      VALUE = 72;
    // Every level, whatever the card: a stat cell like the 数值 above it.
    const perLevel = new Container({
      flexDirection: "column",
      alignItems: "flex-start",
      gap: 2,
      minWidth: 96,
      paddingX: 12,
      paddingY: 8,
      borderRadius: RADIUS_INNER,
      backgroundColor: ui.mist,
    });
    perLevel.add(
      new Text({
        text: block.perLevel.label,
        fontSize: 12,
        fontWeight: 700,
        color: ui.muted,
        wordBreak: "keep-all",
      }),
      new Text({
        text: block.perLevel.value,
        fontSize: 16,
        fontWeight: 800,
        color: ui.ink,
        wordBreak: "keep-all",
      }),
    );
    const table = new Container({
      flexDirection: "column",
      gap: 4,
      paddingX: 12,
      paddingY: 8,
      borderRadius: RADIUS_INNER,
      backgroundColor: ui.mist,
    });
    const head = new Container({ flexDirection: "row", alignItems: "center", gap: 12 });
    head.add(cell("升级卡", LABEL - 12, false));
    for (const rarity of block.ends) {
      const chip = new Container({
        width: VALUE,
        flexShrink: 0,
        justifyContent: "center",
        paddingY: 2,
        borderRadius: 4,
        backgroundColor: Object.values(rarityTones)[rarity]!,
      });
      chip.add(
        new Text({ text: rarityNames[rarity]!, fontSize: 12, fontWeight: 800, color: ui.ink }),
      );
      head.add(chip);
    }
    table.add(head);
    for (const row of block.rows) {
      const line = new Container({ flexDirection: "row", alignItems: "center", gap: 12 });
      line.add(cell(row.label, LABEL - 12, false));
      for (const value of [row.low, row.high]) {
        const text = cell(value, VALUE, true);
        text.setProperties({ textAlign: "center" });
        line.add(text);
      }
      table.add(line);
    }
    return [perLevel, table];
  }

  private refChip(ref: CodexRef, from: CodexEntry, owned: { dispose(): void }[]): Container {
    const target = ref.key ? codexEntry(ref.key)!.entry : undefined;
    const self = target?.key === from.key;
    const chip = new CodexChip(
      this.stage,
      target,
      target?.name ?? ref.label ?? "",
      ref.note,
      self,
      this.thumbs,
      !!target && !!this.lock(target),
    );
    chip.fitTouch(this.stage.viewport.minTarget);
    owned.push(chip);
    if (target && !self)
      this.details.push({
        region: "ref",
        panel: chip.panel,
        key: target.key,
        tip: target.summary,
        activate: () => this.jump(target.key),
        paint: (state, animate) => chip.paint(state, animate),
      });
    return chip.panel;
  }

  private paintModelNote(): void {
    this.modelNote?.setProperties({
      text: this.model.state === "error" ? "模型载入失败" : "",
    });
  }

  /**
   * Follows a link: its section's tab, its list row, its page; focus lands on the row. The page
   * left is added to the trail; a link to a page already on it rewinds the trail to that page
   * instead, so the trail never holds a page twice.
   */
  private jump(key: string): void {
    const found = codexEntry(key);
    if (!found) return;
    getAudio().sfx("ui-confirm");
    const earlier = this.trail.findIndex((stop) => stop.key === key);
    if (earlier >= 0) {
      const stop = this.trail[earlier]!;
      this.trail.length = earlier;
      this.visit(stop);
      return;
    }
    const link = this.details.indexOf(this.controls[this.focusIndex]!);
    this.trail.push({
      section: this.section,
      key: this.selectedKey,
      listScroll: this.listPane.scrollPosition.value[1],
      detailScroll: this.detailPane.scrollPosition.value[1],
      link,
    });
    this.restoring = undefined;
    this.open(this.sections.indexOf(found.section), key);
    const row = this.entries.find((candidate) => candidate.key === key);
    if (row) this.focus(this.controls.indexOf(row), false);
  }

  /** Back: the last page left, as it was (tab, row, both scrolls, the link that was followed). */
  private goBack(): void {
    const stop = this.trail.pop();
    if (!stop) return;
    getAudio().sfx("ui-back");
    this.visit(stop);
  }

  private visit(stop: Stop): void {
    this.open(stop.section, stop.key);
    this.restoring = stop;
    const target =
      this.details[stop.link] ?? this.entries.find((candidate) => candidate.key === stop.key);
    if (target) this.focus(this.controls.indexOf(target), false);
  }

  private open(section: number, key: string): void {
    if (section !== this.section) this.showSection(section, true, key);
    else this.selectEntry(key, true);
    this.paintTrail();
  }

  /**
   * Once the restored page has its final height (its images in, its text broken: its reveal has
   * started): its scrolls as they were, clamped. The scroll is the user's; nothing nudges it after.
   */
  private restoreScroll(): void {
    const stop = this.restoring;
    if (!stop || this.pending.length) return;
    const list = this.listPane.maxScrollPosition.value[1] ?? 0,
      detail = this.detailPane.maxScrollPosition.value[1] ?? 0;
    this.restoring = undefined;
    this.listPane.scrollPosition.value = [0, Math.min(stop.listScroll, list)];
    this.detailPane.scrollPosition.value = [0, Math.min(stop.detailScroll, detail)];
    this.stage.invalidate();
  }

  // ── Painting ──────────────────────────────────────────────────────────────

  /** Draws every control: hovered, focused (a ring only from keys or a pad), pressed, picked. */
  private paintFocus(animate = true): void {
    for (const [i, control] of this.controls.entries())
      control.paint(
        {
          selected:
            control.region === "tab"
              ? control.tab === this.section
              : control.region === "entry" && control.key === this.selectedKey,
          hovered: i === this.hovered,
          focused: i === this.focusIndex,
          focusVisible: this.focusVisible,
          pressed: i === this.pressed,
        },
        animate,
      );
    this.stage.invalidate();
  }

  // ── Window ────────────────────────────────────────────────────────────────

  private readonly applyEnter = (): void => {
    fade(this.panel, this.enterFade.opacity).setProperties({
      transformTranslateY: this.enterMove.y,
      transformScaleX: this.enterMove.scale,
      transformScaleY: this.enterMove.scale,
    });
    this.backdrop?.setOpacity(this.enterFade.opacity);
    this.stage.invalidate();
  };

  /** The dialog pair: 140ms opacity, 220ms rise and scale (DESIGN.md › Motion). */
  private animateWindow(visible: boolean): void {
    this.stage.motion.animate(
      this.enterFade,
      { opacity: visible ? 1 : 0 },
      140,
      this.applyEnter,
      fadeEase,
    );
    this.stage.motion.animate(
      this.enterMove,
      { y: visible ? 0 : 14, scale: visible ? 1 : 0.98 },
      220,
      this.applyEnter,
      uiEaseOut,
    );
  }

  /** The host keeps input and the pass through the exit transition, then disposes. */
  closeWindow(): void {
    if (this.closing) return;
    this.setPressed(null);
    this.tooltip.clear();
    this.closing = true;
    this.exitRemaining = 220;
    this.animateWindow(false);
  }

  resize(width: number, height: number, scale: number, safeArea: UiInsets): void {
    this.stage.resize(width, height, scale, safeArea);
    const view = this.stage.viewport;
    this.backdrop?.resize(view.width, view.height);
    // A short landscape screen (a phone) by its host height: the UI scale keeps its logical height
    // near the desktop's, so that alone would not tell a phone.
    const compact = height <= 480;
    const narrow = view.width <= 820;
    if (this.inner) this.resizePage(compact);
    else {
      const frame = this.frame!;
      this.stage.root.setProperties({
        paddingTop: (compact ? 10 : 18) + view.safeArea.top,
        paddingRight: (compact ? 10 : 18) + view.safeArea.right,
        paddingBottom: (compact ? 8 : 18) + view.safeArea.bottom,
        paddingLeft: (compact ? 12 : 22) + view.safeArea.left,
      });
      frame.resize(compact);
      frame.header.setProperties({
        gap: compact ? 8 : 12,
        paddingLeft: compact ? 10 : 16,
        paddingTop: compact ? 8 : 14,
      });
      frame.extra.setProperties({ gap: compact ? 8 : 10 });
      frame.close.fitTouch();
    }
    for (const face of this.segments) {
      face.fitTouch();
      face.panel.setProperties({ paddingX: (narrow ? 10 : 16) + slantOf(44) / 2 });
      face.label.setProperties({ fontSize: compact ? 15 : 16 });
    }
    this.backKey.fitTouch();
    this.listWidth = view.width >= 1000 ? (compact ? 264 : 304) : view.width >= 760 ? 244 : 200;
    this.listPane.setProperties({ width: this.listWidth });
    if (!this.inner)
      this.body.setProperties({
        gap: compact ? 10 : 14,
        paddingX: compact ? 10 : 16,
        paddingTop: compact ? 10 : 18,
        paddingBottom: compact ? 10 : 16,
      });
    if (compact !== this.compact || view.minTarget !== this.minTarget) {
      this.compact = compact;
      this.minTarget = view.minTarget;
      // The page's hero and art take the short-landscape sizes; its links, the touch minimum.
      const key = this.selectedKey;
      this.selectedKey = "";
      this.selectEntry(key, false);
    }
    for (const row of this.entries)
      row.panel.setProperties({ minHeight: Math.max(48, view.minTarget) });
    this.applyThumbReserve();
    this.tooltip.clear();
    this.touchTip = null;
    this.needsReveal = true;
    this.stage.invalidate();
  }

  /** 研究所's page layout: the segments join the top line on a short landscape screen, else lead
   *  the body; the body's edges line up with the top line's. */
  private resizePage(compact: boolean): void {
    const inner = this.inner!,
      view = this.stage.viewport;
    if (compact !== this.compact || !this.tabTray.parent) {
      this.tabTray.removeFromParent();
      this.body.removeFromParent();
      if (compact) inner.extra.add(stack(this.tabTray, 1));
      else inner.body.add(stack(this.tabTray, 1));
      inner.body.add(stack(this.body, 1));
    }
    inner.resize(compact);
    inner.extra.setProperties({ gap: compact ? 12 : 18 });
    const edge = compact ? 16 : 28;
    // In the top line it gives way to the title; above the body it keeps its height.
    this.tabTray.setProperties({
      alignSelf: "flex-start",
      flexShrink: compact ? 1 : 0,
      marginBottom: compact ? 0 : 6,
    });
    inner.body.setProperties({
      gap: compact ? 0 : 10,
      paddingLeft: Math.max(edge, view.safeArea.left),
      paddingRight: Math.max(edge, view.safeArea.right),
      paddingBottom: Math.max(compact ? 8 : 16, view.safeArea.bottom),
    });
    this.body.setProperties({ gap: compact ? 10 : 14, padding: 0 });
    this.detailPane.setProperties({ paddingX: compact ? 12 : 18, paddingY: compact ? 10 : 16 });
  }

  /** Touch: the list's end can scroll clear of the thumb in the bottom-left corner. */
  private applyThumbReserve(): void {
    this.listPane.setProperties({ paddingBottom: this.coarse ? 72 : 0 });
  }

  setCoarsePointer(coarse: boolean): void {
    this.coarse = coarse;
    this.paintTrail();
    this.applyThumbReserve();
    this.stage.invalidate();
  }

  /** Keyboard focus is outlined; focus a pointer gave is not (`:focus-visible`). */
  setFocusVisible(visible: boolean): void {
    if (visible === this.focusVisible) return;
    this.focusVisible = visible;
    this.paintFocus();
  }

  // ── Focus and keys ────────────────────────────────────────────────────────

  focus(index: number, sound = true): void {
    if (this.closing || !this.controls[index] || index === this.focusIndex) return;
    this.focusIndex = index;
    this.focused = this.controls[index]!;
    if (sound) getAudio().sfx("ui-move");
    this.needsReveal = true;
    this.paintFocus();
  }

  /** Tab order: back (with a trail), the selected tab, the selected row, the page, then close; a
   *  page leads with its top line (back, settings) as 研究所 does. */
  private tabOrder(): number[] {
    const tab = this.tabs[this.section]!;
    const row = this.entries.find((candidate) => candidate.key === this.selectedKey);
    const content = [tab, ...(row ? [row] : []), ...this.details];
    const order = this.settings
      ? [this.close, this.settings, ...content]
      : [...(this.trail.length ? [this.back] : []), ...content, this.close];
    return order.map((control) => this.controls.indexOf(control));
  }

  physicalKey(event: UiKey): boolean {
    if (event.code !== "Backspace") return false;
    if (!this.closing) this.goBack();
    return true;
  }

  navigate(action: NavigationAction): boolean {
    if (this.closing) return true;
    if (action === "previousPage" || action === "nextPage") {
      this.pickSection(
        (this.section + (action === "previousPage" ? -1 : 1) + this.tabs.length) % this.tabs.length,
      );
      this.focus(this.controls.indexOf(this.tabs[this.section]!));
      return true;
    }
    const control = this.controls[this.focusIndex];
    // Esc steps out one layer: an open tip, then the trail, then the window.
    if (action === "cancel") {
      if (this.touchTip !== null) this.touchTip = null;
      else if (this.trail.length) this.goBack();
      else this.options.onClose();
      return true;
    }
    if (action === "next" || action === "previous") {
      const order = this.tabOrder();
      const at = order.indexOf(this.focusIndex);
      this.focus(order[(at + (action === "previous" ? -1 : 1) + order.length) % order.length]!);
      return true;
    }
    if (!control) return true;
    const step = action === "left" || action === "up" ? -1 : 1;
    switch (control.region) {
      case "tab": {
        if (action === "left" || action === "right" || action === "first" || action === "last") {
          const next =
            action === "first"
              ? 0
              : action === "last"
                ? this.tabs.length - 1
                : (this.section + step + this.tabs.length) % this.tabs.length;
          this.pickSection(next);
          this.focus(this.controls.indexOf(this.tabs[next]!));
        } else if (action === "up") {
          this.focus(
            this.controls.findIndex(
              (item) => item.region === (this.trail.length && this.frame ? "back" : "close"),
            ),
          );
        } else if (action === "down" || action === "confirm") this.focusSelectedRow();
        return true;
      }
      case "entry": {
        const at = this.entries.findIndex((row) => row.key === control.key);
        if (action === "up" || action === "down" || action === "first" || action === "last") {
          if (action === "up" && at === 0) {
            this.focus(this.controls.indexOf(this.tabs[this.section]!));
            return true;
          }
          const next =
            action === "first"
              ? 0
              : action === "last"
                ? this.entries.length - 1
                : Math.max(0, Math.min(this.entries.length - 1, at + step));
          const row = this.entries[next]!;
          this.pickEntry(row.key!);
          this.focus(this.controls.indexOf(row));
        } else if ((action === "right" || action === "confirm") && this.details[0])
          this.focus(this.controls.indexOf(this.details[0]));
        return true;
      }
      case "model":
        if (action === "left" || action === "right") this.model.turn(step * KEY_TURN);
        else if (action === "down" && this.details[1])
          this.focus(this.controls.indexOf(this.details[1]));
        else if (action === "up") this.focusSelectedRow();
        return true;
      case "look": {
        // Like the section segments: ←→ move and pick; ↑ back to the stage, ↓ on to the links.
        const looks = this.details.filter((detail) => detail.region === "look");
        if (action === "left" || action === "right") {
          const next = looks[(looks.indexOf(control) + step + looks.length) % looks.length]!;
          next.activate();
          this.focus(this.controls.indexOf(next));
        } else if (action === "confirm") control.activate();
        else if (action === "up") this.focus(this.controls.indexOf(this.details[0]!));
        else if (action === "down") {
          const after = this.details[this.details.indexOf(looks.at(-1)!) + 1];
          if (after) this.focus(this.controls.indexOf(after));
        }
        return true;
      }
      case "ref": {
        const at = this.details.indexOf(control);
        if (isNavigationDirection(action)) {
          const next = this.details[at + step];
          if (next) this.focus(this.controls.indexOf(next));
          else if (step < 0) this.focusSelectedRow();
        } else if (action === "confirm") this.activate(this.focusIndex);
        return true;
      }
      case "back":
        if (action === "confirm") this.goBack();
        else if (action === "right" || action === "down")
          this.focus(this.controls.indexOf(this.tabs[0]!));
        return true;
      case "close":
        // A page's back key leads the top line; a window's close key ends it.
        if (action === "confirm") control.activate();
        else if (this.settings && action === "right")
          this.focus(this.controls.indexOf(this.settings));
        else if (action === "down" || action === (this.settings ? "right" : "left"))
          this.focus(this.controls.indexOf(this.settings ? this.tabs[0]! : this.tabs.at(-1)!));
        return true;
      case "settings":
        if (action === "confirm") control.activate();
        else if (action === "left") this.focus(this.controls.indexOf(this.close));
        else if (action === "down") this.focus(this.controls.indexOf(this.tabs[0]!));
        return true;
    }
  }

  private focusSelectedRow(): void {
    const row = this.entries.find((candidate) => candidate.key === this.selectedKey);
    if (row) this.focus(this.controls.indexOf(row));
  }

  activate(index: number): void {
    if (this.closing) return;
    this.controls[index]?.activate();
  }

  // ── Pointer ───────────────────────────────────────────────────────────────

  private contains(panel: Container, x: number, y: number): boolean {
    const matrix = panel.globalMatrix.value,
      size = panel.size.value;
    if (!matrix || !size || panel.isClipped.value) return false;
    const scale = this.stage.viewport.scale;
    this.point
      .set(x / scale + this.stage.camera.left, this.stage.camera.top - y / scale, 0)
      .applyMatrix4(this.inverse.copy(matrix).invert());
    return Math.abs(this.point.x) <= size[0] / 2 && Math.abs(this.point.y) <= size[1] / 2;
  }

  private paneAt(x: number, y: number): Container | undefined {
    return this.contains(this.listPane, x, y)
      ? this.listPane
      : this.contains(this.detailPane, x, y)
        ? this.detailPane
        : undefined;
  }

  /** A control index, `controls.length` for a scrollable pane (drag scrolls it), or -1. */
  hit(x: number, y: number): number {
    if (this.closing || !this.contains(this.panel, x, y)) return -1;
    const pane = this.paneAt(x, y);
    const index = this.controls.findIndex(
      (control) =>
        (control.region === "entry"
          ? pane === this.listPane
          : control.region === "model" || control.region === "look" || control.region === "ref"
            ? pane === this.detailPane
            : true) && this.contains(control.panel, x, y),
    );
    return index >= 0 ? index : pane ? this.controls.length : -1;
  }

  hover(index: number | null): void {
    const next = index !== null && this.controls[index] ? index : null;
    if (next === this.hovered) return;
    this.hovered = next;
    this.paintFocus();
  }

  setPressed(index: number | null): void {
    const next = !this.closing && index !== null && this.controls[index] ? index : null;
    if (next === this.pressed) return;
    this.pressed = next;
    this.paintFocus();
  }

  /** Every press, before `MenuInput`: long-press tips, model turning and which pane a drag scrolls. */
  pointerDown(id: number, x: number, y: number, touch: boolean): void {
    if (this.owner !== undefined) return;
    this.owner = id;
    this.pointer = { x, y };
    const index = this.hit(x, y);
    const control = index >= 0 ? this.controls[index] : undefined;
    if (this.touchTip !== null && index !== this.touchTip) this.touchTip = null;
    this.tipPress = touch && control?.tip ? { index, at: this.elapsed, x, y, fired: false } : null;
    this.turning = control?.region === "model" ? { x } : undefined;
    this.pressPane = this.paneAt(x, y);
  }

  pointerMove(id: number, x: number, y: number): void {
    if (this.owner !== undefined && id !== this.owner) return;
    this.pointer = { x, y };
    const press = this.tipPress;
    if (press && !press.fired && Math.hypot(x - press.x, y - press.y) > 10) this.tipPress = null;
    if (this.turning) {
      this.model.drag(x - this.turning.x);
      this.turning.x = x;
    }
  }

  /**
   * True when the press only opened a tip (long press) and must not also activate. `id` undefined
   * cancels whatever press is in progress.
   */
  pointerUp(id: number | undefined, touch: boolean): boolean {
    if (id !== undefined && id !== this.owner) return false;
    this.owner = undefined;
    this.turning = undefined;
    this.pressPane = undefined;
    const press = this.tipPress;
    this.tipPress = null;
    return !!press && touch && press.fired;
  }

  turnModel(delta: number): void {
    if (this.controls[this.focusIndex]?.region === "model") this.model.turn(delta);
  }

  scroll(delta: number): void {
    if (this.closing || this.turning) return;
    const pane = this.focusVisible
      ? this.detailPane
      : (this.pressPane ?? this.paneAt(this.pointer.x, this.pointer.y) ?? this.detailPane);
    const [x, y] = pane.scrollPosition.value;
    const max = pane.maxScrollPosition.value[1] ?? 0;
    pane.scrollPosition.value = [
      x,
      Math.max(0, Math.min(max, y + delta / this.stage.viewport.scale)),
    ];
    this.touchTip = null;
    this.stage.invalidate();
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  /** After `stage.update`: layout-dependent parts and the idle loops (which invalidate). */
  afterLayout(deltaMs = 0): void {
    this.elapsed += deltaMs;
    if (this.closing) this.exitRemaining = Math.max(0, this.exitRemaining - deltaMs);
    const matrix = this.panel.globalMatrix.value,
      size = this.panel.size.value;
    if (matrix && size) this.backdrop?.updatePanel(matrix, size[0], size[1]);
    this.inner?.update();
    // The model turns on the page's 30Hz idle clock, so it never interleaves into extra frames.
    const tick = idleTicked(30);
    this.pending = this.pending.filter((pending) => {
      pending.waited += deltaMs;
      pending.frames++;
      const ready =
        pending.images.every((image) => image.texture.value !== undefined) &&
        pending.wraps.every((wrap) => wrap.laid > 0);
      if ((!ready || pending.frames < 2) && pending.waited < REVEAL_WAIT_MS) return true;
      pending.start();
      return false;
    });
    const press = this.tipPress;
    if (press && !press.fired && this.elapsed - press.at >= LONG_PRESS_MS) {
      press.fired = true;
      this.touchTip = press.index;
    }
    const touched = this.touchTip !== null ? this.controls[this.touchTip] : undefined;
    const pointed = this.hovered !== null ? this.controls[this.hovered] : undefined;
    const keyed = this.focusVisible ? this.controls[this.focusIndex] : undefined;
    const tipped = this.closing ? undefined : (touched ?? (pointed?.tip ? pointed : keyed));
    this.tooltip.show(tipped?.tip ? tipped.panel : null, tipped?.tip ?? "");
    this.tooltip.update();
    const layout = [
      this.listPane.size.value,
      this.detailPane.size.value,
      this.detailPane.maxScrollPosition.value,
    ]
      .map((value) => value?.join(",") ?? "")
      .join("|");
    if (layout !== this.lastLayout) {
      this.lastLayout = layout;
      this.needsReveal = true;
    }
    if (this.restoring) {
      this.restoreScroll();
      this.needsReveal = false;
    }
    if (this.needsReveal) {
      this.needsReveal = false;
      this.reveal();
    }
    if (this.detail && this.layWraps(this.detail.wraps)) this.stage.invalidate();
    this.thumbs.update();
    // The model stays dirty until the window draws it (`render`): ask for that frame once.
    const modelDue = this.model.update(deltaMs, tick) && !this.modelAsked;
    if (modelDue) this.modelAsked = true;
    if (modelDue) this.stage.invalidate();
  }

  /** Scrolls the focused control's pane so the control is fully in view. */
  private reveal(): void {
    const control = this.controls[this.focusIndex];
    if (
      !control ||
      control.region === "tab" ||
      control.region === "back" ||
      control.region === "close"
    )
      return;
    const pane = control.region === "entry" ? this.listPane : this.detailPane;
    if (revealInScroller(control.panel, pane)) this.stage.invalidate();
  }

  /** The model's offscreen pass, then the window. */
  render(renderer: WebGLRenderer): void {
    this.thumbs.render(renderer);
    this.model.render(renderer, this.stage.viewport.scale);
    this.modelAsked = false;
    this.stage.render(renderer);
  }

  /** Context lost: GPU copies of the stage and of the model's offscreen pass. */
  releaseUploads(): void {
    this.stage.releaseUploads();
    this.model.releaseUploads();
    this.thumbs.releaseUploads();
  }

  dispose(): void {
    this.stage.motion.cancel(this.unroll);
    this.tooltip.dispose();
    this.disposePart(this.detail);
    this.disposePart(this.list);
    for (const owned of this.owned) owned.dispose();
    this.model.dispose();
    this.thumbs.dispose();
    this.backdrop?.dispose();
    this.stage.dispose();
  }
}

/** The pointer the page's codex follows: the host's screen input owns one press at a time. */
const PAGE_POINTER = 0;

/**
 * The 图鉴 outside a run: a full page the host shows like 研究所 (curtain in and out), with the
 * same tabs, list and pages as the in-run window.
 */
export class GpuCodexPage implements GpuScreen {
  readonly codex: GpuCodex;

  constructor(
    fonts: FontFamilies,
    progress: Progress,
    callbacks: { back(): void; settings(): void },
  ) {
    this.codex = new GpuCodex(fonts, {
      progress,
      onClose: () => {
        getAudio().sfx("ui-back");
        callbacks.back();
      },
      page: {
        settings: () => {
          getAudio().sfx("ui-confirm");
          callbacks.settings();
        },
      },
    });
  }

  get stage(): UiStage {
    return this.codex.stage;
  }
  update(progress: Progress): void {
    this.codex.update(progress);
  }
  get minLayout(): { width: number; height: number } {
    return this.codex.minLayout;
  }
  navigate(action: NavigationAction): boolean {
    return this.codex.navigate(action);
  }
  physicalKey(event: UiKey): boolean {
    return this.codex.physicalKey(event);
  }
  resize(width: number, height: number, scale: number, insets: UiInsets): void {
    this.codex.resize(width, height, scale, insets);
  }
  afterLayout(deltaMs: number): void {
    this.codex.afterLayout(deltaMs);
  }
  setFocusVisible(visible: boolean): void {
    this.codex.setFocusVisible(visible);
  }
  setCoarsePointer(coarse: boolean): void {
    this.codex.setCoarsePointer(coarse);
  }
  hit(x: number, y: number): number {
    return this.codex.hit(x, y);
  }
  hover(index: number | null): void {
    this.codex.hover(index);
  }
  focus(index: number): void {
    this.codex.focus(index);
  }
  activate(index: number): void {
    this.codex.activate(index);
  }
  scroll(delta: number): void {
    this.codex.scroll(delta);
  }
  setPressed(index: number | null): void {
    this.codex.setPressed(index);
  }
  pointerDown(x: number, y: number, touch: boolean): void {
    this.codex.pointerDown(PAGE_POINTER, x, y, touch);
  }
  pointerMove(x: number, y: number): void {
    this.codex.pointerMove(PAGE_POINTER, x, y);
  }
  pointerUp(touch: boolean): boolean {
    return this.codex.pointerUp(PAGE_POINTER, touch);
  }
  turnModel(delta: number): void {
    this.codex.turnModel(delta);
  }
  render(renderer: WebGLRenderer): void {
    this.codex.render(renderer);
  }
  releaseUploads(): void {
    this.codex.releaseUploads();
  }
  dispose(): void {
    this.codex.dispose();
  }
}
