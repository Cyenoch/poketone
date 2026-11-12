import { Component, Container, Content, Image, Text, withOpacity } from "@pmndrs/uikit";
import {
  Color,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
  type Texture,
} from "three";
import { formDefs, starters, type FormId, type StarterId } from "../../run/sim/content/lines/index";
import { abilities } from "../../run/sim/content/abilities";
import { conditionTags } from "../../run/sim/content/effects";
import { armorFactor, type StatKey, type StatLine } from "../../run/sim/stats";
import type { PlayerSheet } from "../../run/createRun";
import { statTerms } from "../../run/glossary";
import type { RunOverlayControl } from "./run-overlays-control";
import { typeColors, type ChoiceArt } from "./run-choice-surface";
import { createRunStatIcon } from "./run-overlays-icons";
import { BoxShadow, OutlineRing } from "./box-shadow";
import { cubicBezier } from "./focus-mark";
import { stack } from "./layer";
import { breakLines } from "./line-break";
import type { UiStage } from "./stage";
import { gameTag, typeTag } from "./tag";
import {
  GpuBattlePage,
  INK,
  LINE,
  MUTED,
  NAVY_DEEP,
  panelTextSizes,
  YELLOW,
  type TextRole,
} from "./run-overlays-build";
import {
  amountText,
  bySource,
  bySourceShares,
  formatStat,
  shares,
  shownValue,
  sourceLabel,
  statDefs,
  statFormula,
  statGroups,
} from "./run-overlays-stats";

export interface StatsPanelState {
  starter: StarterId;
  form: FormId;
  level: number;
  build: PlayerSheet;
}

const PAGES = ["战况", "属性"] as const;

interface Tab {
  panel: Container;
  label: Text;
  ring: OutlineRing;
  focused: boolean;
  over: boolean;
}

/** `--kind-*` (stats-panel.css); evolution takes the form's type colour. */
const kindColors = {
  base: LINE,
  level: "#59c8ff",
  item: "#9c6a33",
  lab: "#2165a4",
  train: "#5d7389",
  ability: "#a35ce0",
} as const;

const ease = (t: number) => cubicBezier(t, 0, 0, 0.58, 1);

interface Row {
  key: StatKey;
  col: number;
  panel: Container;
  ring: OutlineRing;
  lit: { value: number };
  detail: Container | null;
  /** Detail lines wrapped to the detail's width (`about`, `math`), rebroken when it changes. */
  wrapped: { node: Text; text: string; size: () => number }[];
  wrapWidth: number;
  placed: { left: number; top: number; width: number } | null;
  shown: boolean;
  focused: boolean;
  over: boolean;
}

/**
 * The build panel: the light type-soft header (portrait, name, chips over the card art, the page
 * tabs) over one of two pages. 战况 is `GpuBattlePage`; 属性 holds three groups of 44px stat rows
 * (icon | name | value, a 4px source bar) whose detail opens under the row on hover, focus or tap.
 * Rows with nothing to break down are muted; the host owns the frame, close key, entrance and
 * keyboard navigation, and asks `turn` to change page (PageUp/PageDown, LB/RB).
 */
export class GpuStatsContent {
  readonly header: Container;
  /** Both pages share one cell (the second pulled back over the first), so the window keeps the
   *  taller page's height and its tabs stay put when the page turns; the other page is hidden. */
  readonly root = new Container({
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    flexShrink: 0,
  });
  private readonly statsPage = new Container({
    width: "100%",
    marginLeft: "-100%",
    flexDirection: "row",
    gap: 16,
    flexShrink: 0,
  });
  private readonly battle: GpuBattlePage;
  private readonly tabs: Tab[] = [];
  private page = 0;
  private readonly onPage: () => void;
  /** Details, laid over the frame (absolute in it), never clipped by the scrolling groups. */
  readonly details = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
  });
  readonly controls: RunOverlayControl[] = [];
  private readonly rows: Row[] = [];
  private readonly groups: { box: Container; heading: Container; label: Text; name: string }[] = [];
  private readonly texts: { node: Text; role: TextRole }[] = [];
  private readonly portrait: ReturnType<typeof portraitImage> | null;
  private readonly title: Text;
  private readonly surface: StatsHeaderSurface;
  private readonly shadows: BoxShadow[] = [];
  private readonly stage: UiStage;
  private readonly type: string;
  private readonly inverse = new Matrix4();
  private readonly point = new Vector3();
  private focusVisible = false;
  private compact = false;
  private border = 3;

  constructor(state: StatsPanelState, stage: UiStage, art: ChoiceArt, onPage: () => void) {
    this.stage = stage;
    this.onPage = onPage;
    const def = formDefs[state.form];
    const element = def.types[0]!;
    const tone = typeColors[element];
    this.type = tone.type;
    this.surface = new StatsHeaderSurface(art.get(element), tone.soft, tone.type);
    this.header = new Container({
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingLeft: 16,
      paddingRight: 4,
      flexShrink: 0,
    });
    this.header.add(this.surface.content);
    this.portrait = state.form === state.starter ? portraitImage(state.form) : null;
    if (this.portrait) this.header.add(this.portrait);
    this.title = this.text(def.name, "title", INK);
    this.title.setProperties({ whiteSpace: "pre", flexShrink: 0 });
    const chips = stack(
      new Container({
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 4,
        minWidth: 0,
        flexGrow: 1,
      }),
      1,
    );
    for (const type of def.types) chips.add(typeTag(type));
    chips.add(
      gameTag(`Lv ${state.level}`, lightTone),
      gameTag(abilities[starters[state.starter].ability].name, lightTone),
    );
    this.header.add(stack(this.title, 1), chips);
    const strip = stack(new Container({ flexDirection: "row", gap: 4, flexShrink: 0 }), 1);
    for (const [index, name] of PAGES.entries()) strip.add(this.tab(index, name));
    this.header.add(strip);
    this.battle = new GpuBattlePage(state.build, stage, () => this.page === 0);
    this.controls.push(...this.battle.controls);

    for (const [col, group] of statGroups.entries()) {
      const box = new Container({
        flexDirection: "column",
        gap: 4,
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
      });
      const heading = new Container({
        flexDirection: "column",
        justifyContent: "center",
        borderRadius: 4,
        flexShrink: 0,
      });
      const label = this.text(group.name, "caption", MUTED);
      heading.add(stack(label, 1));
      const list = new Container({ flexDirection: "column", flexGrow: 1, minWidth: 0 });
      box.add(heading, list);
      this.groups.push({ box, heading, label, name: group.name });
      let index = 0;
      for (const key of group.keys) {
        const line = state.build.sheet[key];
        if (statDefs[key].optional && line.value === 0 && line.sources.length === 0) continue;
        list.add(this.row(line, col, index++));
      }
      this.statsPage.add(box);
    }
    this.root.add(this.battle.root, this.statsPage);
    this.showPage(0);
  }

  /** A page tab: white on the header, yellow with the navy edge when it is the page shown. */
  private tab(index: number, name: string): Container {
    // As tall as the close key: a full touch target (`resize`).
    const panel = new Container({
      height: 44,
      paddingX: 14,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      borderWidth: 2,
      flexShrink: 0,
    });
    const label = this.text(name, "name", NAVY_DEEP);
    label.setProperties({ fontWeight: 800 });
    const ring = new OutlineRing(8, NAVY_DEEP, 2, 2);
    ring.content.setProperties({ display: "none" });
    panel.add(stack(label, 1), stack(ring.content, 2));
    const tab: Tab = { panel, label, ring, focused: false, over: false };
    this.tabs.push(tab);
    this.controls.push({
      panel,
      enabled: () => true,
      action: () => this.select(index),
      setFocused: (focused) => {
        tab.focused = focused;
        this.paintTabs();
      },
      setPointerOver: (over) => {
        tab.over = over;
        this.paintTabs();
      },
    });
    return panel;
  }

  private paintTabs(): void {
    for (const [index, tab] of this.tabs.entries()) {
      const shown = index === this.page;
      tab.panel.setProperties({
        backgroundColor: shown ? YELLOW : tab.over ? "#d8effb" : "#ffffff",
        borderColor: shown ? NAVY_DEEP : withOpacity(NAVY_DEEP, 0.25),
      });
      tab.ring.content.setProperties({
        display: tab.focused && this.focusVisible ? "flex" : "none",
      });
    }
    this.stage.invalidate();
  }

  private showPage(page: number): void {
    this.page = page;
    this.battle.root.setProperties({ visibility: page === 0 ? "visible" : "hidden" });
    this.statsPage.setProperties({ visibility: page === 1 ? "visible" : "hidden" });
    this.details.setProperties({ display: page === 1 ? "flex" : "none" });
    this.paintTabs();
  }

  private select(page: number): void {
    if (page === this.page) return;
    this.showPage(page);
    this.onPage();
  }

  /** The next (1) or previous (-1) page, wrapping. */
  turn(step: 1 | -1): void {
    this.select((this.page + step + PAGES.length) % PAGES.length);
  }

  /** The page tabs sit in the header, outside the scroll body, yet take taps. */
  isTab(control: RunOverlayControl): boolean {
    return this.tabs.some((tab) => tab.panel === control.panel);
  }
  /** The tab control of the page shown, for the host to move focus to after a turn. */
  get pageTab(): RunOverlayControl {
    return this.controls[this.page]!;
  }

  private text(text: string, role: GpuStatsContent["texts"][number]["role"], color: string): Text {
    const node = new Text({
      text,
      fontSize: 16,
      fontWeight: role === "body" || role === "name" ? 700 : 800,
      color,
      lineHeight: 1.2,
      minWidth: 0,
      flexShrink: 0,
    });
    this.texts.push({ node, role });
    return node;
  }

  private row(line: StatLine, col: number, index: number): Container {
    const def = statDefs[line.key];
    const base = line.sources.length === 0;
    const term = statTerms[line.key];
    const tone = base ? MUTED : INK;
    const slot = new Container({ flexDirection: "column", minWidth: 0, flexShrink: 0 });
    // `li + li { box-shadow: 0 -1px 0 }`: a hairline over every row but the first.
    if (index > 0)
      slot.add(
        stack(
          new Container({
            positionType: "absolute",
            positionLeft: 0,
            positionTop: -1,
            width: "100%",
            height: 1,
            backgroundColor: withOpacity(LINE, 0.45),
          }),
          3,
        ),
      );
    const panel = new Container({
      flexDirection: "column",
      justifyContent: "center",
      minHeight: 44,
      paddingTop: 3,
      paddingX: 8,
      paddingBottom: 4,
      borderRadius: 6,
      minWidth: 0,
    });
    const head = stack(
      new Container({ flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1 }),
      1,
    );
    const icon = createRunStatIcon(line.key);
    icon.setProperties({ width: 22, height: 22, color: base ? MUTED : INK });
    const name = this.text(def.name, "name", tone);
    name.setProperties({ flexGrow: 1, flexShrink: 1, whiteSpace: "pre" });
    const value = new Container({ flexDirection: "row", alignItems: "flex-end", flexShrink: 0 });
    value.add(this.text(formatStat(def.unit, shownValue(line)), "value", tone));
    if (def.suffix) {
      const suffix = this.text(def.suffix, "caption", MUTED);
      suffix.setProperties({ fontWeight: 700, marginLeft: 2, marginBottom: 1 });
      value.add(suffix);
    }
    head.add(icon, name, value);
    panel.add(head);
    if (!base) {
      // The base and each source kind's share of the value, under the name and value columns.
      const bar = stack(
        new Container({
          flexDirection: "row",
          gap: 1,
          height: 4,
          marginTop: 2,
          marginLeft: 30,
          borderRadius: 2,
          overflow: "hidden",
        }),
        1,
      );
      for (const part of bySourceShares(shares(line)))
        bar.add(
          new Container({
            flexGrow: part.size,
            flexBasis: 0,
            minWidth: 2,
            height: "100%",
            backgroundColor: part.kind === "evolution" ? this.type : kindColors[part.kind],
          }),
        );
      panel.add(bar);
    }
    slot.add(panel);
    // A muted row with no tip is plain text, not a control.
    if (base && !term) return slot;
    const ring = new OutlineRing(6, NAVY_DEEP, 2, -2);
    ring.content.setProperties({ display: "none" });
    panel.add(stack(ring.content, 2));
    const row: Row = {
      key: line.key,
      col,
      panel,
      ring,
      lit: { value: 0 },
      detail: null,
      wrapped: [],
      wrapWidth: 0,
      placed: null,
      shown: false,
      focused: false,
      over: false,
    };
    if (!base) {
      const { detail, wrapped } = this.detail(line);
      row.detail = detail;
      row.wrapped = wrapped;
      this.details.add(detail);
    }
    this.rows.push(row);
    this.controls.push({
      panel,
      enabled: () => this.page === 1,
      // Tap or Enter only focuses the row; focus opens its detail.
      action: () => {},
      tip: base ? term : undefined,
      setFocused: (focused) => {
        row.focused = focused;
        this.paint();
      },
      setPointerOver: (over) => {
        row.over = over;
        this.paint();
      },
    });
    return slot;
  }

  /** `.stats-detail`: what the stat means, each source with its share, and how they combine. */
  private detail(line: StatLine): { detail: Container; wrapped: Row["wrapped"] } {
    const def = statDefs[line.key];
    const detail = stack(
      new Container({
        positionType: "absolute",
        flexDirection: "column",
        gap: 4,
        paddingY: 8,
        paddingX: 12,
        borderWidth: 2,
        borderColor: NAVY_DEEP,
        borderRadius: 8,
        backgroundColor: "#ffffff",
        visibility: "hidden",
      }),
      50,
    );
    const shadow = new BoxShadow(8, [{ y: 12, blur: 32, color: NAVY_DEEP, alpha: 0.25 }]);
    this.shadows.push(shadow);
    detail.add(shadow.content);
    const wrapped: Row["wrapped"] = [];
    const about = statTerms[line.key];
    if (about) {
      const node = stack(this.text(about, "caption", MUTED), 1);
      node.setProperties({ fontWeight: 700, lineHeight: 1.45, whiteSpace: "pre" });
      wrapped.push({ node, text: about, size: () => (this.compact ? 12 : 13) });
      detail.add(node);
    }
    const sources = stack(
      new Container({ flexDirection: "row", flexWrap: "wrap", gapRow: 2, gapColumn: 12 }),
      1,
    );
    const item = (kind: string, off: boolean, parts: (Container | Text)[]) => {
      const color = kind === "evolution" ? this.type : kindColors[kind as keyof typeof kindColors];
      const li = new Container({ flexDirection: "row", alignItems: "center", gap: 4 });
      li.add(
        new Container({
          width: 8,
          height: 8,
          borderRadius: 2,
          flexShrink: 0,
          backgroundColor: off ? undefined : color,
          borderWidth: off ? 1.5 : 0,
          borderColor: color,
        }),
        ...parts,
      );
      sources.add(li);
    };
    const words = (label: string, amount: string, off: boolean) => {
      const name = this.text(label, "body", off ? MUTED : INK);
      const value = this.text(amount, "body", off ? MUTED : INK);
      name.setProperties({ lineHeight: 1.5, whiteSpace: "pre" });
      value.setProperties({ fontWeight: 800, lineHeight: 1.5, whiteSpace: "pre" });
      return [name, value];
    };
    if (line.base !== 0) item("base", false, words("基础", formatStat(def.unit, line.base), false));
    for (const source of bySource(line.sources)) {
      const off = !source.active;
      const parts: (Container | Text)[] = [];
      if (source.when) {
        const condition = gameTag(conditionTags[source.when], {
          size: "badge",
          face: off ? "#d0dfeb" : INK,
          ink: off ? INK : "#d8effb",
        });
        parts.push(condition);
      }
      parts.push(...words(sourceLabel(source), amountText(def.unit, source), off));
      item(source.kind, off, parts);
    }
    detail.add(sources);
    const note =
      line.key === "armor" ? `减伤 ${formatStat("pct", 1 - armorFactor(line.value))}` : null;
    const math = [statFormula(def.unit, line), note].filter(Boolean).join(" · ");
    if (math) {
      const rule = stack(
        new Container({
          paddingTop: 4,
          borderTopWidth: 1,
          borderColor: LINE,
          flexDirection: "column",
        }),
        1,
      );
      const node = this.text(math, "caption", MUTED);
      node.setProperties({ fontWeight: 700, lineHeight: 1.45, whiteSpace: "pre" });
      wrapped.push({ node, text: math, size: () => (this.compact ? 12 : 13) });
      rule.add(node);
      detail.add(rule);
    }
    return { detail, wrapped };
  }

  /** `:hover` / `[aria-expanded]` light the row yellow (120ms); `:focus-visible` adds the inset ring. */
  private paint(): void {
    const open = this.openRow();
    for (const row of this.rows) {
      const lit = row.over || row === open || (row.focused && this.focusVisible) ? 1 : 0;
      row.ring.content.setProperties({
        display: row.focused && this.focusVisible ? "flex" : "none",
      });
      if (row.detail && row !== open) {
        row.detail.setProperties({ visibility: "hidden" });
        row.placed = null;
        row.shown = false;
      }
      if (row.lit.value === lit) continue;
      this.stage.motion.animate(
        row.lit,
        { value: lit },
        120,
        () => {
          row.panel.setProperties({ backgroundColor: withOpacity(YELLOW, row.lit.value) });
          this.stage.invalidate();
        },
        ease,
      );
    }
    this.stage.invalidate();
  }

  /** A mouse pointer's row first, else the focused one (`hovered ?? focused`). */
  private openRow(): Row | undefined {
    return (
      this.rows.find((row) => row.over && row.detail) ??
      this.rows.find((row) => row.focused && row.detail)
    );
  }

  setFocusVisible(visible: boolean): void {
    if (this.focusVisible === visible) return;
    this.focusVisible = visible;
    this.battle.setFocusVisible(visible);
    this.paintTabs();
    this.paint();
  }

  /** Short landscape (stats-panel.css media query): smaller type, a 48px header, vertical group names. */
  resize(compact: boolean): void {
    this.compact = compact;
    this.border = compact ? 2 : 3;
    const sizes = panelTextSizes(compact);
    for (const { node, role } of this.texts) node.setProperties({ fontSize: sizes[role] });
    this.battle.resize(compact);
    for (const tab of this.tabs) tab.panel.setProperties({ height: this.stage.viewport.minTarget });
    this.header.setProperties({ minHeight: compact ? 48 : 56 });
    // Rows are touch targets: the viewport's minimum at every scale (44 host px).
    for (const row of this.rows)
      row.panel.setProperties({ minHeight: this.stage.viewport.minTarget });
    this.portrait?.setProperties({ width: compact ? 40 : 48, height: compact ? 40 : 48 });
    this.statsPage.setProperties({ gap: compact ? 12 : 16 });
    for (const { box, heading, label, name } of this.groups) {
      box.setProperties({ flexDirection: compact ? "row" : "column" });
      // `writing-mode: vertical-rl` with 0.1em tracking: one character per line on an ice strip.
      heading.setProperties({
        alignItems: compact ? "center" : "flex-start",
        paddingLeft: compact ? 2 : 8,
        paddingRight: compact ? 2 : 0,
        paddingY: compact ? 8 : 0,
        backgroundColor: compact ? "#d8effb" : undefined,
      });
      label.setProperties({
        text: compact ? name.split("").join("\n") : name,
        whiteSpace: "pre",
        lineHeight: compact ? 1.1 : 1.4,
        textAlign: compact ? "center" : "left",
      });
    }
    for (const row of this.rows) row.wrapWidth = 0;
  }

  /** Places the open detail under its row, or over it when the panel has more room above. */
  afterLayout(frame: Container): void {
    this.surface.update();
    this.battle.afterLayout();
    if (this.page !== 1) return;
    const font = this.title.fontSignal.value;
    const open = this.openRow();
    if (!open?.detail) return;
    const fm = frame.globalMatrix.value,
      fs = frame.size.value,
      rm = open.panel.globalMatrix.value,
      rs = open.panel.size.value,
      ds = open.detail.size.value;
    if (!fm || !fs || !rm || !rs || !ds) return;
    const width = Math.max(rs[0], 320);
    const inner = width - 2 * 2 - 2 * 12;
    if (font && open.wrapWidth !== inner) {
      open.wrapWidth = inner;
      for (const { node, text, size } of open.wrapped)
        node.setProperties({ text: breakLines(text, inner, size(), font) });
    }
    this.point.setFromMatrixPosition(rm).applyMatrix4(this.inverse.copy(fm).invert());
    // Border-box coordinates from the frame's top-left; absolute offsets start inside its border.
    const rowLeft = this.point.x - rs[0] / 2 + fs[0] / 2,
      rowTop = fs[1] / 2 - this.point.y - rs[1] / 2;
    const inset = 8;
    const room = fs[1] - inset - (rowTop + rs[1]);
    const above = ds[1] > room && rowTop - inset > room;
    const place = {
      left: Math.round((open.col === 2 ? rowLeft + rs[0] - width : rowLeft) - this.border),
      top: Math.round((above ? rowTop - 2 - ds[1] : rowTop + rs[1] + 2) - this.border),
      width,
    };
    const settled =
      open.placed !== null &&
      open.placed.left === place.left &&
      open.placed.top === place.top &&
      open.placed.width === place.width &&
      open.wrapWidth === inner;
    if (!settled) {
      open.placed = place;
      open.detail.setProperties({
        positionLeft: place.left,
        positionTop: place.top,
        width: place.width,
      });
      this.stage.invalidate();
    } else if (!open.shown) {
      open.shown = true;
      open.detail.setProperties({ visibility: "visible" });
      this.stage.invalidate();
    }
  }

  /** The host removes `root` first and disposes the frame (header, details) itself. */
  dispose(): void {
    for (const row of this.rows) {
      this.stage.motion.cancel(row.lit);
      row.ring.dispose();
    }
    for (const tab of this.tabs) tab.ring.dispose();
    for (const shadow of this.shadows) shadow.dispose();
    this.surface.dispose();
    this.battle.dispose();
    const parts: { dispose(): void }[] = [this.root];
    this.statsPage.traverse((node) => {
      if (node instanceof Component) parts.push(node);
    });
    for (const part of parts.reverse()) part.dispose();
  }
}

function portraitImage(form: FormId) {
  return stack(
    new Image({
      src: `/art/portraits/${form}.webp`,
      width: 48,
      height: 48,
      marginY: -4,
      flexShrink: 0,
    }),
    1,
  );
}

const lightTone = { face: "#ffffff", ink: NAVY_DEEP, ring: { color: INK, width: 1.5 } };

/**
 * `.stats-panel__header` background: the type-soft face, the card art 340px wide hanging 40px past
 * the right edge (vertically centred), faded out by `linear-gradient(90deg, soft 35%, transparent
 * 75%)`, rounded 5px, with a 2px inset bottom line in the type colour at 45%.
 */
class StatsHeaderSurface {
  readonly content = new Content({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly size = { value: new Vector2(1, 1) };

  constructor(art: Texture, soft: string, type: string) {
    this.material.map = art;
    this.material.customProgramCacheKey = () => "poketone-stats-header";
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        headerSize: this.size,
        headerSoft: { value: new Color(soft) },
        headerType: { value: new Color(type) },
      });
      shader.vertexShader =
        "varying vec2 headerUv;\n" +
        shader.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\nheaderUv=uv;");
      shader.fragmentShader =
        "varying vec2 headerUv; uniform vec2 headerSize; uniform vec3 headerSoft; uniform vec3 headerType;\n" +
        shader.fragmentShader.replace("#include <map_fragment>", "").replace(
          "#include <color_fragment>",
          `
        vec2 p=vec2(headerUv.x,1.-headerUv.y)*headerSize;
        float aa=.5*max(fwidth(p.x),fwidth(p.y));
        vec2 artUv=vec2((p.x-(headerSize.x+40.-340.))/340.,(p.y-(headerSize.y-340.)*.5)/340.);
        vec4 art=texture2D(map,vec2(artUv.x,1.-artUv.y));
        float inside=step(0.,artUv.x)*step(artUv.x,1.)*step(0.,artUv.y)*step(artUv.y,1.);
        vec3 soft=sRGBTransferOETF(vec4(headerSoft,1.)).rgb;
        vec3 ink=mix(soft,sRGBTransferOETF(vec4(art.rgb,1.)).rgb,art.a*inside);
        float veil=1.-clamp((p.x/headerSize.x-.35)/.4,0.,1.);
        ink=mix(ink,soft,veil);
        float line=step(headerSize.y-2.,p.y)*.45;
        ink=mix(ink,sRGBTransferOETF(vec4(headerType,1.)).rgb,line);
        vec2 corner=abs(p-headerSize*.5)-(headerSize*.5-vec2(5.));
        float edge=length(max(corner,0.))+min(max(corner.x,corner.y),0.)-5.;
        diffuseColor=vec4(sRGBTransferEOTF(vec4(ink,1.)).rgb,opacity*(1.-smoothstep(-aa,aa,edge)));
      `,
        );
    };
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  update(): void {
    const s = this.content.size.value;
    if (s) this.size.value.set(s[0], s[1]);
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
