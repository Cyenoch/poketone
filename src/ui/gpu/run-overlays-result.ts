import { Component, Container, Image, Text } from "@pmndrs/uikit";
import type { RunOverlayControl } from "./run-overlays-control";
import type { RunResult } from "../../run/createRun";
import { starters } from "../../run/sim/content/lines/index";
import { items, type ItemId } from "../../run/sim/content/items";
import { moves } from "../../run/sim/content/moves";
import { difficulties } from "../../run/sim/content/difficulties";
import { bondTitle, formatTime } from "../../run/labels";
import { bondLevel, bondMilestones, MAX_BOND_LEVEL } from "../../run/sim/content/bonds";
import { HeartGauge } from "./heart-gauge";
import { itemIcon, moveIcon } from "../../screens/runArt";
import type { UiStage } from "./stage";
import { wrapLines } from "./text-fit";
import { fade, stack } from "./layer";
import { GameButton } from "./game-button";
import { createMenuIcon } from "./icons";
import { EASE, POP, stagger } from "./motion";
import { RADIUS_INNER, ui } from "./tokens";
import { GpuCurrency } from "./currency";
import { softOf } from "./run-choice-surface";
import { badges as badgeTable, type BadgeId } from "../../run/sim/content/badges";
import { badgeMedal, multiplierText } from "./challenge-rules";

/** The run's partner's bond points before and after this result was saved. */
export interface BondGain {
  before: number;
  after: number;
  /** This save newly owns the partner's shiny look (false when it was already owned). */
  look: boolean;
}

export interface ResultContentState {
  result: RunResult;
  note: string | null;
  badges: BadgeId[];
  /** Null until the result is saved. */
  bond: BondGain | null;
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
  /** New badges pop in one after another, once per result. */
  private readonly medalPops: { s: number }[] = [];
  private poppedFor: RunResult | null = null;
  /** The bond scale fills from before to after once per result; a crossed level pops. */
  private bondGauge: HeartGauge | null = null;
  private readonly bondFill = { p: 0 };
  private readonly bondPops: { s: number }[] = [];
  private bondFor: RunResult | null = null;

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
    // With rules, the facts end on the run's danger and the stardust multiplier it earned.
    const danger = r.danger > 0 ? ` · 危险度 ${r.danger} ${multiplierText(r.danger)}` : "";
    this.meta = this.text(
      `${starters[r.starter].stages[0].form.name} · ${difficulties[r.difficulty].name} · ${formatTime(r.time)} · Lv.${r.level} · 击倒 ${r.kills}${danger}`,
      13,
      ui.muted,
      700,
    );
    // 对战塔: the floors passed lead, the run's figure of merit.
    if (r.floor !== undefined) this.root.add(this.floorRow(r.floor));
    this.root.add(this.meta);
    const bond = this.state.bond;
    if (bond && bond.after > bond.before) this.root.add(this.bondRow(bond, r));
    if (this.state.badges.length) this.root.add(this.badgeRow(this.state.badges, r));
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
  /** 通过 12 层: the floor count large between its words, on one baseline. */
  private floorRow(floor: number): Container {
    const row = new Container({ flexDirection: "row", alignItems: "baseline", gap: 6 });
    const count = this.text(String(floor), 34);
    count.setProperties({ lineHeight: "100%" });
    row.add(this.text("通过", 16, ui.muted), count, this.text("层", 16));
    return row;
  }

  /**
   * The bond with the run's partner: the heart scale fills by the points this run earned (+N).
   * Crossing a level pops its heart, the new title and what the level grants.
   */
  private bondRow({ before, after, look }: BondGain, result: RunResult): Container {
    const row = new Container({
      width: "100%",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 10,
    });
    const gauge = new HeartGauge(this.stage);
    gauge.size(18, 3);
    this.bondGauge = gauge;
    const title = this.text("", 16);
    const gain = this.text(`+${after - before}`, 16, ui.ball, 900);
    row.add(gauge.panel, title, gain);
    // What each level reached on the way grants, popping in as the scale reaches it.
    const from = bondLevel(before),
      to = bondLevel(after);
    const grants = new Map<number, Container>();
    for (let level = from + 1; level <= to; level++) {
      const reward = bondMilestones[level - 1]!.reward;
      // The top level's look only counts when this save actually added it.
      if (!reward || (level === MAX_BOND_LEVEL && !look)) continue;
      const chip = new Container({
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingLeft: 6,
        paddingRight: 10,
        paddingY: 3,
        borderRadius: RADIUS_INNER,
        backgroundColor: ui.success,
        flexShrink: 0,
      });
      const check = createMenuIcon("check");
      check.setProperties({ width: 14, height: 14, color: ui.white });
      chip.add(check, this.text(reward, 14, ui.white));
      grants.set(level, chip);
      row.add(chip);
    }
    const replay = this.bondFor !== result;
    this.bondFor = result;
    this.stage.motion.cancel(this.bondFill);
    for (const pop of this.bondPops.splice(0)) this.stage.motion.cancel(pop);
    let shown = -1;
    const reach = (level: number, celebrate: boolean) => {
      shown = level;
      const name = bondTitle(level);
      title.setProperties({ text: name ?? "", display: name ? "flex" : "none" });
      for (const [at, chip] of grants)
        chip.setProperties({ display: at <= level ? "flex" : "none" });
      if (!celebrate) return;
      gauge.pop(level);
      for (const part of [title, grants.get(level)]) {
        if (!part) continue;
        const pop = { s: 0.6 };
        this.bondPops.push(pop);
        this.stage.motion.animate(
          pop,
          { s: 1 },
          320,
          () => {
            part.setProperties({ transformScaleX: pop.s, transformScaleY: pop.s });
            this.stage.invalidate();
          },
          POP,
        );
      }
    };
    const apply = () => {
      gauge.set(this.bondFill.p);
      const level = bondLevel(Math.floor(this.bondFill.p));
      if (level !== shown) reach(level, shown >= 0);
    };
    this.bondFill.p = replay ? before : after;
    apply();
    if (replay)
      this.stage.motion.animate(
        this.bondFill,
        { p: after },
        Math.min(1200, 500 + (after - before) * 25),
        apply,
        EASE,
        420,
      );
    return row;
  }

  /** The badges this run earned: each its medal and name, popping in one by one. */
  private badgeRow(earned: BadgeId[], result: RunResult): Container {
    const row = new Container({ width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 10 });
    const replay = this.poppedFor !== result;
    this.poppedFor = result;
    for (const pop of this.medalPops.splice(0)) this.stage.motion.cancel(pop);
    for (const [i, id] of earned.entries()) {
      const chip = new Container({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 4,
        paddingRight: 12,
        paddingY: 4,
        borderRadius: 999,
        backgroundColor: ui.mist,
        flexShrink: 0,
      });
      const medal = badgeMedal(id, 36);
      chip.add(medal, this.text(badgeTable[id].name, 15));
      row.add(chip);
      const pop = { s: replay ? 0 : 1 };
      this.medalPops.push(pop);
      const apply = () => {
        medal.setProperties({ transformScaleX: pop.s, transformScaleY: pop.s });
        fade(chip, Math.min(1, pop.s * 1.5));
        this.stage.invalidate();
      };
      apply();
      if (replay) this.stage.motion.animate(pop, { s: 1 }, 320, apply, POP, stagger(i, 90, 240));
    }
    return row;
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
    this.stage.motion.cancel(this.bondFill);
    for (const pop of this.bondPops.splice(0)) this.stage.motion.cancel(pop);
    // The scale's hearts own their shader parts: released here, then left out of the sweep below.
    this.bondGauge?.dispose();
    this.bondGauge?.panel.removeFromParent();
    this.bondGauge = null;
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
    for (const pop of this.medalPops) this.stage.motion.cancel(pop);
    for (const e of this.entrances) this.stage.motion.cancel(e);
    this.clear();
    this.root.dispose();
    this.headerCurrency.dispose();
  }
}
