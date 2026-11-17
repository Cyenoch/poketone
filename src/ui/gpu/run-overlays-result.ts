import { Component, Container, Image, Text } from "@pmndrs/uikit";
import type { RunOverlayControl } from "./run-overlays-control";
import type { RunResult } from "../../run/createRun";
import { starters } from "../../run/sim/content/lines/index";
import { items, type ItemId } from "../../run/sim/content/items";
import { moves } from "../../run/sim/content/moves";
import { difficulties } from "../../run/sim/content/difficulties";
import { formatTime } from "../../run/labels";
import { itemIcon, moveIcon } from "../../screens/runArt";
import type { UiStage } from "./stage";
import { wrapLines } from "./text-fit";
import { fade, stack } from "./layer";
import { GameButton } from "./game-button";
import { createMenuIcon } from "./icons";
import { EASE, stagger } from "./motion";
import { RADIUS_INNER, ui } from "./tokens";
import { GpuCurrency } from "./currency";
import { softOf } from "./run-choice-surface";

export interface ResultContentState {
  result: RunResult;
  note: string | null;
  backpackSize: number | null;
}
export interface ResultContentCallbacks {
  keepItems(items: ItemId[]): boolean;
  retry(): void;
  exit(): void;
  invalidate(): void;
}

export class GpuResultContent {
  readonly root = new Container({ width: "100%", flexDirection: "column", gap: 12, flexShrink: 0 });
  /** `CurrencyCounter gain` in the title band (`.run-modal__head`), right of the title. */
  private readonly purse: GpuCurrency;
  readonly headerCurrency: Container;
  controls: RunOverlayControl[] = [];
  private state: ResultContentState;
  private readonly callbacks: ResultContentCallbacks;
  private readonly stage: UiStage;
  private kept: ItemId[] = [];
  private resultIdentity: RunResult | null = null;
  private signature = "";
  private viewportKey = "";
  private readonly tiles: { id: ItemId; panel: Container }[] = [];
  private bagLabel: Text | null = null;
  private rows: Container[] = [];
  private meta: Text | null = null;
  private noteText: { node: Text; full: string } | null = null;
  private buttons: GameButton[] = [];
  private focusVisible = true;
  /** The result whose rows already came in: a rebuild (a kept item) does not replay it. */
  private entered: RunResult | null = null;
  private readonly entrances: { x: number; a: number }[] = [];

  constructor(state: ResultContentState, callbacks: ResultContentCallbacks, stage: UiStage) {
    this.state = state;
    this.callbacks = callbacks;
    this.stage = stage;
    this.purse = new GpuCurrency(stage, true);
    this.headerCurrency = this.purse.root;
    this.headerCurrency.setProperties({ marginLeft: "auto" });
    this.update(state);
  }
  update(state: ResultContentState): void {
    this.state = state;
    if (state.result !== this.resultIdentity) {
      this.resultIdentity = state.result;
      this.kept = [];
      this.signature = "";
    }
    const signature = JSON.stringify(state);
    if (signature === this.signature) return;
    this.signature = signature;
    this.build();
    this.afterLayout(0);
  }
  private build(): void {
    this.clear();
    const { result: r } = this.state;
    this.meta = this.text(
      `${starters[r.starter].stages[0].form.name} · ${difficulties[r.difficulty].name} · ${formatTime(r.time)} · Lv.${r.level} · 击倒 ${r.kills}`,
      13,
      ui.muted,
      700,
    );
    this.root.add(this.meta);
    const rewards = new Container({
      width: "100%",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    });
    this.purse.set(r.stardust);
    if (this.state.backpackSize !== null && r.items.length) {
      const bag = new Container({
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        // `.run-result__bag`: the legend first, the items after it, from the left.
        justifyContent: "flex-start",
        gap: 8,
      });
      this.bagLabel = this.text("", 16);
      bag.add(this.bagLabel);
      for (const id of r.items) {
        // The touch target is the tile's size (a fixed 40 under the min-height made its row short).
        const tile = new Container({
          minWidth: Math.max(40, this.stage.viewport.minTarget),
          minHeight: Math.max(40, this.stage.viewport.minTarget),
          flexShrink: 0,
          borderWidth: 2,
          borderColor: ui.ink,
          borderRadius: RADIUS_INNER,
          backgroundColor: ui.white,
          alignItems: "center",
          justifyContent: "center",
        });
        tile.add(this.image(itemIcon(id), 32));
        this.tiles.push({ id, panel: tile });
        const enabled = () => this.kept.includes(id) || this.kept.length < this.state.backpackSize!;
        this.controls.push({
          panel: tile,
          enabled,
          action: () => this.toggle(id),
          selected: () => this.kept.includes(id),
        });
        this.controls.find((control) => control.panel === tile)!.tip = items[id].name;
        bag.add(tile);
      }
      rewards.add(bag);
      this.paintBag();
      this.root.add(rewards);
    }
    const damage = new Container({ width: "100%", flexDirection: "column", gap: 4 });
    const total = r.moves.reduce((sum, move) => sum + move.damage, 0) || 1;
    for (const move of [...r.moves].sort((a, b) => b.damage - a.damage)) {
      const row = new Container({
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingX: 12,
        paddingY: 8,
        borderRadius: RADIUS_INNER,
        backgroundColor: ui.mist,
        overflow: "hidden",
      });
      row.add(
        new Container({
          positionType: "absolute",
          positionLeft: 0,
          positionTop: 0,
          width: `${(move.damage / total) * 100}%`,
          height: "100%",
          backgroundColor: softOf(moves[move.id].type),
        }),
      );
      const label = stack(
        new Container({
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }),
        1,
      );
      const name = this.text(moves[move.id].name, 16);
      name.setProperties({ flexShrink: 1 });
      label.add(
        this.image(moveIcon(move.id), 24),
        name,
        this.text(`Lv.${move.level}`, 13, ui.muted, 700),
      );
      const amount = this.text(Math.round(move.damage).toLocaleString("zh-CN"), 16);
      stack(amount, 1).setProperties({ textAlign: "right" });
      row.add(label, amount);
      this.rows.push(row);
      damage.add(row);
    }
    this.root.add(damage);
    if (this.state.note) {
      const note = new Container({
        paddingX: 12,
        paddingY: 8,
        borderRadius: RADIUS_INNER,
        backgroundColor: ui.mist,
        width: "100%",
      });
      // A sentence of Chinese has no spaces to wrap at: broken to its width in `afterLayout`.
      const text = this.text(this.state.note, 16);
      text.setProperties({ width: "100%", wordBreak: "keep-all", whiteSpace: "pre-line" });
      this.noteText = { node: text, full: this.state.note };
      note.add(text);
      this.root.add(note);
    }
    const actions = new Container({
      width: "100%",
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
      paddingBottom: 3,
    });
    actions.add(
      this.button("再来一局", () => this.callbacks.retry(), true),
      this.button("返回大厅", () => this.callbacks.exit(), false),
    );
    this.root.add(actions);
    this.viewportKey = "";
    if (this.entered !== r) {
      this.entered = r;
      this.enter();
    }
  }
  /** A restrained celebration: the result's lines come in from the left one after another. */
  private enter(): void {
    for (const e of this.entrances) this.stage.motion.cancel(e);
    this.entrances.length = 0;
    // The actions stay put: 再来一局 is ready from the first frame.
    const lines = this.root.children
      .filter((c): c is Component => c instanceof Component)
      .slice(0, -1);
    const items = lines.flatMap((line) =>
      line === this.rows[0]?.parentContainer.value ? this.rows : [line],
    );
    items.forEach((item, i) => {
      const e = { x: -60, a: 0 };
      this.entrances.push(e);
      this.stage.motion.enter(
        e,
        { x: -60, a: 0 },
        { x: 0, a: 1 },
        380,
        () => {
          fade(item, e.a).setProperties({ transformTranslateX: e.x });
          this.stage.invalidate();
        },
        EASE,
        stagger(i, 45, 120),
      );
    });
  }
  setFocusVisible(visible: boolean): void {
    this.focusVisible = visible;
    for (const button of this.buttons) button.setFocusVisible(visible);
  }
  private toggle(id: ItemId): void {
    const next = this.kept.includes(id)
      ? this.kept.filter((other) => other !== id)
      : [...this.kept, id];
    if (next.length > this.state.backpackSize! || !this.callbacks.keepItems(next)) return;
    this.kept = next;
    this.paintBag();
    this.callbacks.invalidate();
  }
  private paintBag(): void {
    this.bagLabel?.setProperties({ text: `背包 ${this.kept.length}/${this.state.backpackSize}` });
    for (const { id, panel } of this.tiles) {
      const on = this.kept.includes(id),
        enabled = on || this.kept.length < this.state.backpackSize!;
      fade(panel, enabled ? 1 : 0.45).setProperties({
        backgroundColor: on ? ui.ink : ui.white,
        borderColor: on ? ui.ink : ui.line,
      });
    }
  }
  private text(text: string, fontSize = 16, color: string = ui.ink, fontWeight = 800): Text {
    return new Text({
      text,
      fontSize,
      fontWeight,
      color,
      minWidth: 0,
      maxWidth: "100%",
      flexShrink: 0,
    });
  }
  private image(src: string, size: number) {
    return stack(new Image({ src, width: size, height: size, flexShrink: 0 }), 1);
  }
  private button(label: string, action: () => void, primary: boolean): Container {
    // 再来一局 is the slanted CTA; 返回大厅 stands upright.
    const button = new GameButton(this.stage, {
      tone: primary ? "primary" : "secondary",
      size: "normal",
      label,
      icon: primary ? undefined : createMenuIcon("back"),
    });
    button.panel.setProperties({ flexGrow: 1, flexBasis: 0, minWidth: 140 });
    button.setFocusVisible(this.focusVisible);
    this.buttons.push(button);
    this.controls.push({
      panel: button.panel,
      enabled: () => true,
      action,
      selfDrawn: true,
      setFocused: (focused) => button.setFocused(focused),
      setPointerOver: (over) => button.setHovered(over),
      setPressed: (pressed) => button.setPressed(pressed),
    });
    return button.panel;
  }
  afterLayout(deltaMs: number): void {
    for (const button of this.buttons) button.update(deltaMs);
    if (this.noteText) {
      const lines = wrapLines(this.noteText.node, this.noteText.full);
      if (lines !== undefined && lines !== this.noteText.node.properties.value.text)
        this.noteText.node.setProperties({ text: lines });
    }
    const v = this.stage.viewport,
      key = [v.width, v.height, v.scale].join(",");
    if (key === this.viewportKey) return;
    this.viewportKey = key;
    const compact = v.height <= 480 && v.width > v.height;
    this.root.setProperties({ gap: compact ? 8 : 12 });
    for (const row of this.rows) row.setProperties({ paddingY: compact ? 4 : 8 });
    for (const button of this.buttons) button.fitTouch();
    for (const tile of this.tiles)
      tile.panel.setProperties({ minWidth: v.minTarget, minHeight: v.minTarget });
    this.stage.invalidate();
  }
  private clear(): void {
    for (const e of this.entrances) this.stage.motion.cancel(e);
    this.entrances.length = 0;
    for (const button of this.buttons) button.dispose();
    this.buttons = [];
    const parts: { dispose(): void }[] = [];
    this.controls = [];
    this.tiles.length = 0;
    this.rows = [];
    this.meta = null;
    this.noteText = null;
    this.bagLabel = null;
    for (const child of this.root.children.slice()) {
      child.traverse((o) => {
        if (o instanceof Component) parts.push(o);
      });
      child.removeFromParent();
    }
    for (const part of parts.reverse()) part.dispose();
  }
  dispose(): void {
    this.root.removeFromParent();
    this.headerCurrency.removeFromParent();
    this.purse.dispose();
    for (const e of this.entrances) this.stage.motion.cancel(e);
    this.clear();
    this.root.dispose();
    this.headerCurrency.dispose();
  }
}
