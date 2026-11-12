import type { UiKey } from "../../platform/ui-surface";
import { isNavigationDirection, type NavigationAction } from "../../platform/input";
import { InputGlyph } from "./input-glyph";
import { revealInScroller } from "./scroll-reveal";
import { idleTicked } from "./motion";
import {
  Component,
  Container,
  Image,
  Text,
  withOpacity,
  type Content,
  type FontFamilies,
} from "@pmndrs/uikit";
import { Matrix4, Vector3, type WebGLRenderer } from "three";
import { getAudio } from "../../audio/engine";
import {
  codexEntry,
  codexSections,
  type CodexBlock,
  type CodexEntry,
  type CodexRef,
} from "../../run/codex";
import { rarityNames } from "../../run/sim/upgrades";
import { BoxShadow, OutlineRing, plateShadow } from "./box-shadow";
import { CodexModelStage, CodexThumbs, KEY_TURN } from "./codex-model";
import { CodexBall, ColorTween, cardArt, createArt, ink } from "./codex-parts";
import { gameTag, typeTag } from "./tag";
import { DialogBackdrop } from "./dialog-backdrop";
import { DialogSurface } from "./dialog-surface";
import { cubicBezier, uiEaseOut } from "./focus-mark";
import { HoverPattern } from "./hover-pattern";
import { createMenuIcon } from "./icons";
import { rarityTones } from "./run-choice-surface";
import { fade, stack } from "./layer";
import { UiStage } from "./stage";
import { GpuTooltip } from "./tooltip";
import { balanceLines, breakLines, type GlyphWidths } from "./line-break";
import type { UiInsets } from "./viewport";

export interface CodexOptions {
  onClose(): void;
}

type Region = "back" | "close" | "tab" | "entry" | "model" | "ref";

interface Control {
  region: Region;
  panel: Container;
  ring: OutlineRing;
  activate(): void;
  /** The ball pattern shown while it is hovered, focused or selected (DESIGN.md fx-hover). */
  pattern?: HoverPattern;
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

/** A header key (back, close): navy square, lit yellow on focus or hover, Esc badge for keyboards. */
interface HeaderKey {
  panel: Container;
  icon: Content;
  badge: Container;
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
const windowShadow = { y: 12, blur: 32, color: ink.deep, alpha: 0.25 };

/**
 * The 图鉴: category tabs in the title band, an entry list, and the selected entry's page. Every
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
  private readonly backdrop = new DialogBackdrop();
  private readonly tooltip: GpuTooltip;
  private readonly colors: ColorTween;
  private readonly model: CodexModelStage;
  private readonly thumbs = new CodexThumbs(() => this.stage.invalidate());
  /** Wrapped texts of the part being built. */
  private building: Wrap[] = [];
  private readonly panel: Container;
  private readonly header: Container;
  private readonly titleBox: Container;
  private readonly tabStrip: Container;
  private readonly listPane: Container;
  private readonly detailPane: Container;
  private readonly band = new DialogSurface("header");
  private readonly owned: { dispose(): void }[] = [];
  private readonly close: Control;
  private readonly closeKey: HeaderKey;
  private readonly back: Control;
  private readonly backKey: HeaderKey;
  /** Links followed since the last direct pick (a tab or a list row), oldest first. */
  private readonly trail: Stop[] = [];
  private restoring: Stop | undefined;
  private readonly keyPress = { y: 0, scale: 1 };
  private keyPressed!: Control;
  private readonly tabs: (Control & {
    ball: CodexBall;
    label: Text;
    shadow: BoxShadow;
    sheen: DialogSurface;
    pattern: HoverPattern;
  })[] = [];
  private entries: (Control & { ball: CodexBall })[] = [];
  private details: Control[] = [];
  private controls: Control[] = [];
  private list: Part | undefined;
  private detail: Part | undefined;
  private modelNote: Text | undefined;
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
    this.colors = new ColorTween(this.stage.motion, invalidate);
    this.model = new CodexModelStage(() => {
      this.paintModelNote();
      invalidate();
    });
    this.stage.root.setProperties({
      fontFamilies: fonts,
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    });
    this.stage.scene.add(this.backdrop.dim, this.backdrop.shadow);
    this.panel = new Container({
      width: "100%",
      height: "100%",
      maxWidth: 1240,
      maxHeight: 820,
      flexDirection: "column",
      backgroundColor: ink.surface,
      borderColor: ink.deep,
      borderWidth: 3,
      borderRadius: 12,
      padding: 4,
    });
    this.header = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      backgroundColor: ink.blueDeep,
      paddingLeft: 18,
      paddingRight: 8,
      paddingY: 6,
      flexShrink: 0,
    });
    this.owned.push(this.band);
    this.header.add(this.band.content);
    this.titleBox = stack(new Container({ flexShrink: 0 }), 1);
    this.titleBox.add(
      stack(
        new Text({
          text: "图鉴",
          color: ink.deep,
          fontSize: 22,
          fontWeight: 800,
          positionType: "absolute",
          positionLeft: 0,
          positionTop: 0,
          transformTranslateY: 2,
        }),
        1,
      ),
      stack(new Text({ text: "图鉴", color: "#ffffff", fontSize: 22, fontWeight: 800 }), 2),
    );
    this.tabStrip = stack(
      new Container({
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        paddingY: 4,
      }),
      1,
    );
    // Back leads the band, shown while a trail exists: top left, clear of the thumb's corner.
    this.backKey = this.headerKey("back");
    this.back = this.control("back", this.backKey.panel, 8, () => this.goBack());
    this.backKey.panel.setProperties({ display: "none" });
    this.header.add(this.backKey.panel, this.titleBox, this.tabStrip);
    for (const [index, section] of this.sections.entries()) this.addTab(index, section.name);

    this.closeKey = this.headerKey("close");
    this.close = this.control("close", this.closeKey.panel, 8, () => this.options.onClose());
    this.keyPressed = this.close;
    this.header.add(this.closeKey.panel);

    const body = new Container({ flexDirection: "row", flexGrow: 1, flexShrink: 1, minHeight: 0 });
    this.listPane = new Container({
      width: this.listWidth,
      flexShrink: 0,
      flexDirection: "column",
      overflow: "scroll",
      backgroundColor: ink.ice,
      borderRightWidth: 1,
      borderColor: ink.line,
      paddingX: 8,
      paddingY: 8,
      scrollbarWidth: 3,
      scrollbarColor: ink.blueDeep,
    });
    this.detailPane = new Container({
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      flexDirection: "column",
      overflow: "scroll",
      paddingX: 18,
      paddingY: 16,
      scrollbarWidth: 3,
      scrollbarColor: ink.blueDeep,
    });
    body.add(this.listPane, this.detailPane);
    this.panel.add(
      new Container({
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 0,
        width: "100%",
        height: "100%",
        borderWidth: 1,
        borderColor: ink.yellow,
        borderRadius: 9,
      }),
      this.header,
      body,
    );
    this.stage.root.add(this.panel);
    this.tooltip = new GpuTooltip(this.stage);
    this.focused = this.tabs[0]!;
    this.showSection(0, false);
    this.applyEnter();
    this.animateWindow(true);
  }

  // ── Building ──────────────────────────────────────────────────────────────

  /** Registers `panel` as focusable; its index is its place in `controls`. */
  private control(
    region: Region,
    panel: Container,
    radius: number,
    activate: () => void,
    extra: Partial<Control> = {},
  ): Control {
    const ring = new OutlineRing(radius, ink.yellow);
    ring.content.setProperties({ display: "none" });
    // Tabs bring their own pattern; the model stage is its own picture and takes none.
    const lit = region === "back" || region === "close" ? ink.yellow : "#ffffff";
    const pattern =
      region === "tab" || region === "model"
        ? undefined
        : new HoverPattern(this.stage.motion, () => this.stage.invalidate(), lit);
    if (pattern) panel.add(pattern.content);
    panel.add(stack(ring.content, 2));
    return { region, panel, ring, activate, pattern, ...extra };
  }

  private headerKey(name: "back" | "close"): HeaderKey {
    const panel = stack(
      new Container({
        width: 44,
        height: 44,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        borderWidth: 2,
        borderColor: ink.ice,
        backgroundColor: ink.deep,
      }),
      1,
    );
    const icon = createMenuIcon(name);
    icon.setProperties({ color: "#ffffff" });
    panel.add(
      new Container({
        positionType: "absolute",
        positionLeft: 0,
        positionRight: 0,
        positionTop: 0,
        height: 2,
        borderTopLeftRadius: 6,
        borderTopRightRadius: 6,
        backgroundColor: withOpacity("#ffffff", 0.14),
      }),
      icon,
    );
    const badge = stack(
      new Container({
        positionType: "absolute",
        positionRight: -6,
        positionBottom: -6,
        paddingX: 4,
        paddingY: 1,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: ink.deep,
        backgroundColor: ink.ice,
      }),
      3,
    );
    badge.add(new InputGlyph("cancel", "Esc"));
    panel.add(badge);
    return { panel, icon, badge };
  }

  private addTab(index: number, name: string): void {
    const panel = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 40,
      paddingX: 10,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: "transparent",
      flexShrink: 0,
    });
    const shadow = new BoxShadow(8, []);
    const sheen = new DialogSurface("knob");
    const pattern = new HoverPattern(this.stage.motion, () => this.stage.invalidate(), "#0d233f");
    const ball = new CodexBall(this.stage.motion, () => this.stage.invalidate());
    const label = new Text({ text: name, fontSize: 15, fontWeight: 800, color: ink.ice });
    panel.add(
      shadow.content,
      sheen.content,
      pattern.content,
      stack(ball.content, 1),
      stack(label, 1),
    );
    this.owned.push(shadow, sheen, pattern, ball);
    const tab = Object.assign(
      this.control("tab", panel, 8, () => this.pickSection(index), { tab: index }),
      { ball, label, shadow, sheen, pattern },
    );
    this.tabs.push(tab);
    this.tabStrip.add(panel);
  }

  /** Keeps focus on the same control across a rebuild, else on the selected row. */
  private rebuildControls(): void {
    this.setPressed(null);
    this.controls.length = 0;
    if (this.trail.length) this.controls.push(this.back);
    this.controls.push(this.close, ...this.tabs, ...this.entries, ...this.details);
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
      if (!(node instanceof Component)) return;
      this.colors.forget(node);
      components.push(node);
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
    const trail = this.trail.length > 0;
    this.backKey.panel.setProperties({ display: trail ? "flex" : "none" });
    this.backKey.badge.setProperties({ display: trail && !this.coarse ? "flex" : "none" });
    this.closeKey.badge.setProperties({ display: !trail && !this.coarse ? "flex" : "none" });
    if (this.controls.includes(this.back) !== trail) this.rebuildControls();
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
    for (const tab of this.tabs) this.paintTab(tab, animate);
    this.disposePart(this.list);
    const owned: { dispose(): void }[] = [];
    const root = new Container({ flexDirection: "column", gap: 2, flexShrink: 0 });
    this.entries = [];
    for (const group of section.groups) {
      if (section.groups.length > 1)
        root.add(
          new Text({
            text: group.title,
            fontSize: 12,
            fontWeight: 800,
            color: ink.muted,
            paddingX: 6,
            paddingTop: 8,
            paddingBottom: 2,
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
    this.fadeIn(root, this.listIn, "x", 12, 200, animate, []);
  }

  private entryRow(entry: CodexEntry, owned: { dispose(): void }[]): Container {
    const panel = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: Math.max(48, this.stage.viewport.minTarget),
      paddingX: 8,
      paddingY: 4,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: "transparent",
      flexShrink: 0,
    });
    const ball = new CodexBall(this.stage.motion, () => this.stage.invalidate());
    const art = createArt(entry, 36, this.thumbs);
    owned.push(ball, art);
    panel.add(
      ball.content,
      art.root,
      new Text({ text: entry.name, fontSize: 15, fontWeight: 800, flexShrink: 1, minWidth: 0 }),
    );
    const row = Object.assign(
      this.control("entry", panel, 8, () => this.pickEntry(entry.key), {
        key: entry.key,
      }),
      { ball },
    );
    owned.push(row.ring, ...(row.pattern ? [row.pattern] : []));
    this.entries.push(row);
    return panel;
  }

  private selectEntry(key: string, animate: boolean): void {
    if (key === this.selectedKey) return;
    this.selectedKey = key;
    for (const row of this.entries) this.paintEntry(row, animate);
    const entry = codexEntry(key)!.entry;
    this.disposePart(this.detail);
    this.details = [];
    this.modelNote = undefined;
    const owned: { dispose(): void }[] = [];
    this.building = [];
    const root = new Container({ flexDirection: "column", gap: 16, flexShrink: 0 });
    root.add(this.hero(entry, owned));
    for (const block of entry.blocks) root.add(this.block(block, entry, owned));
    this.detail = { root, owned, wraps: this.building };
    this.building = [];
    this.detailPane.add(root);
    this.detailPane.scrollPosition.value = [0, 0];
    this.model.show(entry.model);
    this.paintModelNote();
    if (this.controls.length) this.rebuildControls();
    this.fadeIn(root, this.detailIn, "y", 8, 180, animate, this.detail.wraps);
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
    const start = () =>
      this.stage.motion.animate(
        state,
        { opacity: 1, [axis]: 0 } as typeof state,
        duration,
        apply,
        uiEaseOut,
      );
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

  private hero(entry: CodexEntry, owned: { dispose(): void }[]): Container {
    const hero = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      height: entry.model ? (this.compact ? 150 : 210) : this.compact ? 100 : 150,
      paddingX: 14,
      paddingY: 10,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: ink.deep,
      flexShrink: 0,
    });
    const shadow = new BoxShadow(10, [windowShadow]);
    owned.push(shadow);
    hero.add(
      shadow.content,
      new Image({
        src: cardArt(entry),
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        keepAspectRatio: false,
        borderRadius: 8,
      }),
    );
    let picture: Container;
    if (entry.model) {
      const box = (picture = stack(
        new Container({
          width: this.compact ? 150 : 240,
          height: "100%",
          flexShrink: 0,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
        }),
        1,
      ));
      box.add(this.model.mount());
      this.modelNote = new Text({ text: "", fontSize: 13, fontWeight: 800, color: ink.muted });
      box.add(stack(this.modelNote, 1));
      const control = this.control("model", box, 8, () => {});
      owned.push(control.ring, ...(control.pattern ? [control.pattern] : []));
      this.details.push(control);
      hero.add(box);
    } else {
      const art = createArt(entry, this.compact ? 72 : 112, this.thumbs);
      owned.push(art);
      hero.add((picture = stack(art.root, 1)));
    }
    const copy = stack(
      new Container({ flexDirection: "column", gap: 10, flexShrink: 1, minWidth: 0 }),
      1,
    );
    copy.add(
      this.wrapped(
        entry.name,
        { fontSize: this.compact ? 24 : 30, fontWeight: 800, color: ink.deep },
        () => {
          const width = hero.size.value?.[0],
            beside = picture.size.value?.[0];
          return width && beside ? width - 2 * 2 - 2 * 14 - beside - 16 : undefined;
        },
        true,
      ),
    );
    const tags = new Container({ flexDirection: "row", flexWrap: "wrap", gap: 6 });
    for (const type of entry.types) tags.add(typeTag(type));
    for (const tag of entry.tags) tags.add(gameTag(tag, { face: ink.deep, ink: ink.ice }));
    if (entry.types.length || entry.tags.length) copy.add(tags);
    hero.add(copy);
    return hero;
  }

  private block(block: CodexBlock, entry: CodexEntry, owned: { dispose(): void }[]): Container {
    const root = new Container({ flexDirection: "column", gap: 8, flexShrink: 0 });
    // The heading keeps its width; the rule takes what is left (none on a narrow page).
    const title = new Container({ flexDirection: "row", alignItems: "center", gap: 10 });
    title.add(
      new Text({
        text: block.title,
        fontSize: 14,
        fontWeight: 800,
        color: ink.blueDeep,
        flexShrink: 0,
        wordBreak: "keep-all",
      }),
      new Container({
        height: 2,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        backgroundColor: ink.line,
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
          paddingY: 7,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: ink.line,
          backgroundColor: "#ffffff",
        });
        const label = new Text({
          text: row.label,
          fontSize: 12,
          fontWeight: 700,
          color: ink.muted,
          flexShrink: 0,
          wordBreak: "keep-all",
        });
        cell.add(
          label,
          wide
            ? this.wrapped(row.value, { fontSize: 16, fontWeight: 800, flexShrink: 1 }, () => {
                const width = cell.size.value?.[0],
                  labelWidth = label.size.value?.[0];
                return width && labelWidth ? width - 2 * 1 - 2 * 12 - labelWidth - 12 : undefined;
              })
            : new Text({ text: row.value, fontSize: 16, fontWeight: 800, wordBreak: "keep-all" }),
        );
        body.add(cell);
      }
    else if (block.kind === "lines") {
      body.setProperties({ flexDirection: "column", gap: 6 });
      for (const line of block.lines)
        body.add(
          this.wrapped(
            line,
            { fontSize: 15, fontWeight: 700, lineHeight: 1.45 },
            () => body.size.value?.[0],
          ),
        );
    } else if (block.kind === "rolls") {
      body.setProperties({ flexDirection: "column", alignItems: "flex-start" });
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
        color: strong ? ink.deep : ink.muted,
        wordBreak: "keep-all",
      });
    const LABEL = 76,
      VALUE = 72;
    const perLevel = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingX: 12,
      paddingY: 7,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: ink.line,
      backgroundColor: "#ffffff",
    });
    // Every level, whatever the card: centred across both rarity columns.
    const gain = cell(block.perLevel.value, 2 * VALUE + 12, true);
    gain.setProperties({ textAlign: "center" });
    perLevel.add(cell(block.perLevel.label, LABEL - 12, false), gain);
    const table = new Container({
      flexDirection: "column",
      gap: 4,
      paddingX: 12,
      paddingY: 8,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: ink.line,
      backgroundColor: "#ffffff",
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
        new Text({ text: rarityNames[rarity]!, fontSize: 12, fontWeight: 800, color: ink.deep }),
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
    const chip = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: this.stage.viewport.minTarget,
      paddingLeft: target ? 6 : 12,
      paddingRight: 12,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: self ? ink.navy : ink.line,
      backgroundColor: self ? "#fff3c9" : "#ffffff",
      flexShrink: 0,
    });
    if (target) {
      const art = createArt(target, 30, this.thumbs);
      owned.push(art);
      chip.add(art.root);
    }
    chip.add(
      new Text({
        text: target?.name ?? ref.label ?? "",
        fontSize: 15,
        fontWeight: 800,
        wordBreak: "keep-all",
      }),
    );
    if (ref.note)
      chip.add(
        new Text({
          text: ref.note,
          fontSize: 12,
          fontWeight: 700,
          color: ink.muted,
          wordBreak: "keep-all",
        }),
      );
    if (target && !self) {
      const control = this.control("ref", chip, 8, () => this.jump(target.key), {
        key: target.key,
        tip: target.summary,
      });
      owned.push(control.ring, ...(control.pattern ? [control.pattern] : []));
      this.details.push(control);
    }
    return chip;
  }

  private paintModelNote(): void {
    this.modelNote?.setProperties({
      text: this.model.state === "error" ? "模型载入失败" : "",
      color: ink.danger,
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

  private paintTab(tab: (typeof this.tabs)[number], animate: boolean): void {
    const selected = tab.tab === this.section;
    const index = this.controls.indexOf(tab);
    const hovered = index >= 0 && index === this.hovered;
    tab.ball.set(selected, animate);
    this.colors.set(
      tab.panel,
      "backgroundColor",
      selected ? ink.yellow : hovered ? ink.blue : "transparent",
      animate,
    );
    this.colors.set(tab.panel, "borderColor", selected ? ink.deep : "transparent", animate);
    this.colors.set(tab.label, "color", selected ? ink.deep : ink.ice, animate);
    tab.shadow.set(selected ? plateShadow(3) : []);
    tab.sheen.content.setProperties({ display: selected ? "flex" : "none" });
    const focused = index >= 0 && index === this.focusIndex;
    // The picked tab is yellow: the pattern inks gold on it, pale on the navy band otherwise.
    tab.pattern.setSurface(selected ? ink.yellow : "#0d233f");
    tab.pattern.setFocused(selected || hovered || (focused && this.focusVisible));
  }

  private paintEntry(row: (typeof this.entries)[number], animate: boolean): void {
    const selected = row.key === this.selectedKey;
    const index = this.controls.indexOf(row);
    const hovered = index >= 0 && index === this.hovered;
    row.ball.set(selected, animate);
    this.colors.set(
      row.panel,
      "backgroundColor",
      selected ? "#ffffff" : hovered ? ink.surface : "transparent",
      animate,
    );
    this.colors.set(row.panel, "borderColor", selected ? ink.navy : "transparent", animate);
  }

  /** Every other control's pattern: lit while hovered, keyboard-focused or (a list row) picked. */
  private paintPatterns(): void {
    for (const [i, control] of this.controls.entries()) {
      if (!control.pattern) continue;
      const picked = control.region === "entry" && control.key === this.selectedKey;
      control.pattern.setFocused(
        picked || i === this.hovered || (i === this.focusIndex && this.focusVisible),
      );
    }
  }

  private paintKey(control: Control, key: HeaderKey, animate: boolean): void {
    const index = this.controls.indexOf(control);
    const lit = index >= 0 && (this.focusIndex === index || this.hovered === index);
    this.colors.set(key.panel, "backgroundColor", lit ? ink.yellow : ink.deep, animate);
    this.colors.set(key.panel, "borderColor", lit ? ink.deep : ink.ice, animate);
    this.colors.set(key.icon, "color", lit ? ink.deep : "#ffffff", animate);
  }

  private paintFocus(): void {
    for (const [i, control] of this.controls.entries()) {
      control.ring.content.setProperties({
        display: i === this.focusIndex && this.focusVisible ? "flex" : "none",
      });
      if (control.region === "ref")
        this.colors.set(
          control.panel,
          "borderColor",
          i === this.hovered || i === this.focusIndex ? ink.blue : ink.line,
          true,
        );
    }
    for (const tab of this.tabs) this.paintTab(tab, true);
    for (const row of this.entries) this.paintEntry(row, true);
    this.paintKey(this.close, this.closeKey, true);
    this.paintKey(this.back, this.backKey, true);
    this.paintPatterns();
    this.stage.invalidate();
  }

  // ── Window ────────────────────────────────────────────────────────────────

  private readonly applyEnter = (): void => {
    fade(this.panel, this.enterFade.opacity).setProperties({
      transformTranslateY: this.enterMove.y,
      transformScaleX: this.enterMove.scale,
      transformScaleY: this.enterMove.scale,
    });
    this.backdrop.setOpacity(this.enterFade.opacity);
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
    this.backdrop.resize(view.width, view.height);
    const compact = view.height <= 480;
    const narrow = view.width <= 720;
    const gutter = compact ? 8 : 16;
    this.stage.root.setProperties({
      paddingTop: gutter + view.safeArea.top,
      paddingRight: gutter + view.safeArea.right,
      paddingBottom: gutter + view.safeArea.bottom,
      paddingLeft: gutter + view.safeArea.left,
    });
    this.titleBox.setProperties({ display: narrow ? "none" : "flex" });
    this.header.setProperties({ paddingLeft: narrow ? 8 : 18, paddingY: compact ? 2 : 6 });
    this.tabStrip.setProperties({ gap: narrow ? 2 : 4 });
    for (const tab of this.tabs)
      tab.panel.setProperties({
        height: view.minTarget,
        paddingX: narrow ? 7 : 12,
        gap: narrow ? 4 : 6,
      });
    for (const key of [this.closeKey, this.backKey])
      key.panel.setProperties({ width: view.minTarget, height: view.minTarget });
    this.listWidth = view.width >= 1000 ? 300 : view.width >= 760 ? 250 : 196;
    this.listPane.setProperties({ width: this.listWidth });
    this.detailPane.setProperties({
      paddingX: narrow ? 10 : 18,
      paddingY: compact ? 10 : 16,
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

  /** Touch: the list's end can scroll clear of the thumb in the bottom-left corner. */
  private applyThumbReserve(): void {
    this.listPane.setProperties({ paddingBottom: this.coarse ? 72 : 8 });
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

  /** Tab order: back (with a trail), the selected tab, the selected row, the page, then close. */
  private tabOrder(): number[] {
    const tab = this.tabs[this.section]!;
    const row = this.entries.find((candidate) => candidate.key === this.selectedKey);
    const back = this.trail.length ? [this.back] : [];
    return [...back, tab, ...(row ? [row] : []), ...this.details, this.close].map((control) =>
      this.controls.indexOf(control),
    );
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
              (item) => item.region === (this.trail.length ? "back" : "close"),
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
        if (action === "confirm") this.options.onClose();
        else if (action === "left" || action === "down")
          this.focus(this.controls.indexOf(this.tabs.at(-1)!));
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
          : control.region === "model" || control.region === "ref"
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
    const before = this.pressed !== null ? this.controls[this.pressed] : undefined;
    this.pressed = next;
    const keys = [this.close, this.back];
    if (before && !keys.includes(before)) before.panel.setProperties({ transformTranslateY: 0 });
    const control = next !== null ? this.controls[next] : undefined;
    if (control && !keys.includes(control) && control.region !== "model")
      control.panel.setProperties({ transformTranslateY: 2 });
    // A header key sinks and squashes; the one released springs back.
    const down = control !== undefined && keys.includes(control);
    if (down) this.keyPressed = control;
    const pressed = this.keyPressed;
    this.stage.motion.animate(
      this.keyPress,
      { y: down ? 3 : 0, scale: down ? 0.97 : 1 },
      down ? 60 : 140,
      () => {
        pressed.panel.setProperties({
          transformTranslateY: this.keyPress.y,
          transformScaleY: this.keyPress.scale,
        });
        this.stage.invalidate();
      },
      uiEaseOut,
    );
    this.stage.invalidate();
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
    if (matrix && size) this.backdrop.updatePanel(matrix, size[0], size[1]);
    // The band drifts under 7 px/s: 15 redraws a second step it under 0.5 px, where a redraw
    // every frame would keep the whole window drawing at full rate while nothing else moves. The
    // band (15Hz), the model (30Hz) and the lit patterns (15Hz) all step on the page's idle clock,
    // so they never interleave into extra frames. Each asks for its frame by invalidating.
    this.band.update(deltaMs);
    const tick = idleTicked(30);
    const bandDue = idleTicked(15);
    for (const control of this.controls)
      if (control.region !== "tab") control.pattern?.update(deltaMs);
    for (const tab of this.tabs) {
      tab.pattern.update(deltaMs);
      tab.sheen.update(deltaMs);
    }
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
    // Every idle loop on the page (this window's model and band, its patterns, the menu's behind it)
    // asks for its step the same way, an invalidate, so all land on the same frame.
    // The model stays dirty until the window draws it (`render`): ask for that frame once.
    const modelDue = this.model.update(deltaMs, tick) && !this.modelAsked;
    if (modelDue) this.modelAsked = true;
    if (modelDue || bandDue) this.stage.invalidate();
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
    this.tooltip.dispose();
    this.disposePart(this.detail);
    this.disposePart(this.list);
    for (const owned of this.owned) owned.dispose();
    for (const tab of this.tabs) tab.ring.dispose();
    for (const key of [this.close, this.back]) {
      key.ring.dispose();
      key.pattern?.dispose();
    }
    this.model.dispose();
    this.thumbs.dispose();
    this.backdrop.dispose();
    this.stage.dispose();
  }
}
