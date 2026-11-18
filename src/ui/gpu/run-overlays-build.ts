import { Component, Container, Image, Text, withOpacity } from "@pmndrs/uikit";
import type { PlayerSheet } from "../../run/createRun";
import { itemEffect } from "../../run/codex";
import { formatTime } from "../../run/labels";
import { items } from "../../run/sim/content/items";
import { moves } from "../../run/sim/content/moves";
import { itemIcon, moveIcon } from "../../screens/runArt";
import { OutlineRing } from "./box-shadow";
import { CURRENCY_ICON } from "./currency";
import { cubicBezier } from "./focus-mark";
import { stack } from "./layer";
import { RichText } from "./rich-text";
import { typeTag } from "./type-icon";
import type { RunOverlayControl } from "./run-overlays-control";
import { typeColors } from "./run-theme";
import type { UiStage } from "./stage";
import { gameTag } from "./tag";
import { ui } from "./tokens";

/** The redesign's ink scale under the build panel's names; YELLOW is the lit row's wash. */
export const INK = ui.ink,
  NAVY_DEEP = ui.ink,
  MUTED = ui.muted,
  LINE = ui.line,
  YELLOW = ui.mist;

export type TextRole = "title" | "name" | "value" | "body" | "caption" | "figure";

/** Type sizes of the build panel, regular and short landscape. */
export function panelTextSizes(compact: boolean): Record<TextRole, number> {
  return compact
    ? { title: 18, name: 16, value: 15, body: 13, caption: 12, figure: 20 }
    : { title: 22, name: 16, value: 18, body: 15, caption: 13, figure: 26 };
}

const ease = (t: number) => cubicBezier(t, 0, 0, 0.58, 1);
const decimal = (value: number) => Number(value.toFixed(1)).toString();

/** Whole numbers to 9999, then 万 with one decimal: 12.3万. */
export function bigNumber(value: number): string {
  return value < 10000 ? String(Math.round(value)) : `${decimal(value / 10000)}万`;
}

interface Row {
  panel: Container;
  ring: OutlineRing;
  lit: { value: number };
  focused: boolean;
}

/**
 * 战况: the run's figures on one strip, then the moves by damage dealt (type crest, share bar in the
 * move's type colour, share, damage per second, cooldown) beside the items with their effect at the
 * level held. Figures in the facts and effects take `figure` (the theme's deep step). Rows are
 * focusable so a pad or keyboard can scroll the page; they do nothing.
 */
export class GpuBattlePage {
  readonly root = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 12,
    flexShrink: 0,
  });
  readonly controls: RunOverlayControl[] = [];
  private readonly texts: { node: Text; role: TextRole }[] = [];
  private readonly rows: Row[] = [];
  private readonly figures: Container;
  private readonly cells: Container[] = [];
  private readonly icons: { node: Container; size: [number, number] }[] = [];
  private readonly typeTags: { dispose(): void }[] = [];
  private readonly columns: Container;
  /** Move facts (one line) and item effects (broken to their column's width once it is known). */
  private readonly rich: { text: RichText; role: TextRole; box: Container | null }[] = [];
  private readonly stage: UiStage;
  private focusVisible = false;
  private compact = false;

  constructor(build: PlayerSheet, stage: UiStage, enabled: () => boolean, figure: string) {
    this.stage = stage;
    const total = build.moves.reduce((sum, move) => sum + move.damage, 0);
    const perSecond = (damage: number) => (build.time > 0 ? damage / build.time : 0);

    this.figures = new Container({
      flexDirection: "row",
      alignItems: "center",
      flexShrink: 0,
      borderRadius: 8,
      backgroundColor: YELLOW,
    });
    this.figures.add(
      this.cell("用时", formatTime(build.time)),
      this.cell("击败", String(build.kills)),
      this.cell("招式伤害", bigNumber(total)),
      this.cell("每秒伤害", bigNumber(perSecond(total))),
      this.cell("星星沙子", String(build.stardust), CURRENCY_ICON),
    );

    this.columns = new Container({ flexDirection: "row", gap: 16, flexShrink: 0 });
    const moveList = this.section("招式", 3);
    for (const move of build.moves.toSorted((a, b) => b.damage - a.damage)) {
      const def = moves[move.id];
      const share = total > 0 ? move.damage / total : 0;
      const panel = this.rowPanel(enabled, moveList.list, moveList.count++);
      const head = new Container({ flexDirection: "row", alignItems: "center", gap: 6 });
      const name = this.text(def.name, "name", INK);
      name.setProperties({ flexShrink: 1, whiteSpace: "pre" });
      const damage = this.text(bigNumber(move.damage), "value", INK);
      damage.setProperties({ marginLeft: "auto" });
      const mark = typeTag(def.type, 11, false);
      this.typeTags.push(mark);
      head.add(name, mark.tag, levelTag(move.level), damage);
      const bar = new Container({
        width: "100%",
        height: 6,
        borderRadius: 3,
        backgroundColor: withOpacity(LINE, 0.35),
        overflow: "hidden",
      });
      bar.add(
        new Container({
          width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%`,
          height: "100%",
          borderRadius: 3,
          backgroundColor: typeColors[def.type].type,
        }),
      );
      const facts = new RichText(
        `${decimal(share * 100)}% · 每秒 ${bigNumber(perSecond(move.damage))} · 冷却 ${move.cd.toFixed(1)} 秒`,
        { ink: MUTED, figure, weight: 700 },
      );
      this.rich.push({ text: facts, role: "caption", box: null });
      // The bar has its own full-width line, so every row's track is the same length.
      const info = new Container({ flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 });
      info.add(head, bar, facts.panel);
      panel.add(stack(this.icon(moveIcon(move.id), [40, 32]), 1), stack(info, 1));
    }

    const itemList = this.section("道具", 2);
    for (const held of build.items) {
      const def = items[held.id];
      const panel = this.rowPanel(enabled, itemList.list, itemList.count++);
      const head = new Container({ flexDirection: "row", alignItems: "center", gap: 6 });
      const name = this.text(def.name, "name", INK);
      name.setProperties({ flexShrink: 1, whiteSpace: "pre" });
      head.add(name, levelTag(held.level));
      const effect = new RichText(itemEffect(held.id, held.level), { ink: INK, figure });
      const info = new Container({ flexDirection: "column", gap: 2, flexGrow: 1, minWidth: 0 });
      info.add(head, effect.panel);
      this.rich.push({ text: effect, role: "body", box: info });
      panel.add(stack(this.icon(itemIcon(held.id), [32, 28]), 1), stack(info, 1));
    }
    if (build.items.length === 0) {
      const none = this.text("还没有道具", "body", MUTED);
      none.setProperties({ paddingX: 8, paddingY: 12 });
      itemList.list.add(none);
    }
    this.root.add(this.figures, this.columns);
  }

  private text(text: string, role: TextRole, color: string): Text {
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

  private icon(src: string, size: [number, number]): Container {
    const node = new Container({
      width: size[0],
      height: size[0],
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: "#ffffff",
      borderWidth: 1,
      borderColor: withOpacity(LINE, 0.7),
    });
    node.add(new Image({ src, width: "80%", height: "80%" }));
    this.icons.push({ node, size });
    return node;
  }

  /** A figure on the strip: the number large, its name small under it (stardust carries the coin);
   *  a hairline parts it from the one before. */
  private cell(label: string, value: string, icon?: string): Container {
    const cell = new Container({
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 0,
      flexDirection: "column",
      alignItems: "flex-start",
      gap: 2,
      paddingY: 8,
      paddingX: 14,
      borderLeftWidth: this.cells.length > 0 ? 1 : 0,
      borderColor: withOpacity(LINE, 0.7),
    });
    const line = new Container({ flexDirection: "row", alignItems: "center", gap: 4 });
    if (icon) line.add(new Image({ src: icon, width: 22, height: 22, marginLeft: -3 }));
    line.add(this.text(value, "figure", NAVY_DEEP));
    cell.add(line, this.text(label, "caption", MUTED));
    this.cells.push(cell);
    return cell;
  }

  private section(name: string, grow: number): { list: Container; count: number } {
    const box = new Container({
      flexDirection: "column",
      gap: 4,
      flexGrow: grow,
      flexBasis: 0,
      minWidth: 0,
    });
    const heading = this.text(name, "caption", MUTED);
    heading.setProperties({ paddingLeft: 8 });
    const list = new Container({ flexDirection: "column", minWidth: 0 });
    box.add(heading, list);
    this.columns.add(box);
    return { list, count: 0 };
  }

  /** A row slot with the hairline over every row but the first, as on the 属性 page. */
  private rowPanel(enabled: () => boolean, list: Container, index: number): Container {
    const slot = new Container({ flexDirection: "column", minWidth: 0, flexShrink: 0 });
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
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingY: 6,
      paddingX: 8,
      borderRadius: 6,
      minWidth: 0,
    });
    const ring = new OutlineRing(6, NAVY_DEEP, 2, -2);
    ring.content.setProperties({ display: "none" });
    panel.add(stack(ring.content, 2));
    slot.add(panel);
    list.add(slot);
    const row: Row = { panel, ring, lit: { value: 0 }, focused: false };
    this.rows.push(row);
    this.controls.push({
      panel,
      enabled,
      action: () => {},
      selfDrawn: true,
      setFocused: (focused) => {
        row.focused = focused;
        this.paint();
      },
      setPointerOver: () => {},
    });
    return panel;
  }

  private paint(): void {
    for (const row of this.rows) {
      const ringed = row.focused && this.focusVisible;
      row.ring.content.setProperties({ display: ringed ? "flex" : "none" });
      // Rows do nothing, so a pointer over one draws nothing; only keyboard/pad focus lights it.
      const lit = ringed ? 1 : 0;
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

  setFocusVisible(visible: boolean): void {
    if (this.focusVisible === visible) return;
    this.focusVisible = visible;
    this.paint();
  }

  /** `inline`: the figure strip on one line (name beside number), for short screens. */
  resize(compact: boolean, inline = compact): void {
    this.compact = compact;
    const sizes = panelTextSizes(compact);
    for (const { node, role } of this.texts) node.setProperties({ fontSize: sizes[role] });
    for (const { node, size } of this.icons) {
      const side = size[compact ? 1 : 0];
      node.setProperties({ width: side, height: side });
    }
    for (const cell of this.cells)
      cell.setProperties({
        flexDirection: inline ? "row" : "column",
        alignItems: inline ? "center" : "flex-start",
        gap: inline ? 6 : 2,
        paddingY: inline ? 6 : 8,
        paddingX: inline ? 10 : 14,
      });
    this.root.setProperties({ gap: compact ? 8 : 12 });
    this.columns.setProperties({ gap: compact ? 12 : 16 });
    for (const row of this.rows)
      row.panel.setProperties({ minHeight: this.stage.viewport.minTarget });
  }

  /** Lays out the facts, and breaks each item effect to its column once its width is known. */
  afterLayout(): void {
    const sizes = panelTextSizes(this.compact);
    let changed = false;
    for (const { text, role, box } of this.rich) {
      const width = box ? Math.floor(box.size.value?.[0] ?? 0) : Infinity;
      if (width <= 0) continue;
      changed =
        (role === "body"
          ? text.layout(width, sizes.body, 1.4, "always")
          : text.layout(width, sizes[role], 1.2)) || changed;
    }
    if (changed) this.stage.invalidate();
  }

  dispose(): void {
    for (const row of this.rows) {
      this.stage.motion.cancel(row.lit);
      row.ring.dispose();
    }
    for (const tag of this.typeTags) tag.dispose();
    const parts: { dispose(): void }[] = [];
    this.root.traverse((node) => {
      if (node instanceof Component) parts.push(node);
    });
    for (const part of parts.reverse()) part.dispose();
  }
}

function levelTag(level: number): Container {
  // A light fact badge (as in the panel header), so the dark type chip beside it leads.
  return gameTag(`Lv ${level}`, {
    size: "badge",
    face: "#ffffff",
    ink: NAVY_DEEP,
    ring: { color: NAVY_DEEP, width: 1.5 },
  });
}
