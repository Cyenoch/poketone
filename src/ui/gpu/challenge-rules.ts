import { Container, Image, Text } from "@pmndrs/uikit";
import { Matrix4, Vector3 } from "three";
import { getAudio } from "../../audio/engine";
import { isNavigationDirection, type NavigationAction } from "../../platform/input";
import { badgeIds, badges, badgeScore, type BadgeId } from "../../run/sim/content/badges";
import type { Difficulty } from "../../run/sim/content/difficulties";
import { RULE_DANGER } from "../../run/sim/content/params/rules";
import {
  ruleIds,
  rules,
  stardustMultiplier,
  totalDanger,
  type RuleId,
} from "../../run/sim/content/rules";
import { CURRENCY_ICON } from "./currency";
import { DialogFrame } from "./dialog-surface";
import { gridStep } from "./grid-nav";
import { createMenuIcon } from "./icons";
import { fade, stack } from "./layer";
import { EASE, LIFT, POP, SNAP } from "./motion";
import { SlantPlate } from "./slant-plate";
import type { UiStage } from "./stage";
import { HARD_SHADOW, RADIUS, RADIUS_INNER, slantOf, ui } from "./tokens";
import { GpuTooltip } from "./tooltip";

/** The highest danger one rule carries: every board shows that many pips. */
const PIPS = Math.max(...Object.values(RULE_DANGER));
const LONG_PRESS_MS = 450;
/** Each badge's own colour (Kanto's badge colours; rainbow takes its violet petal). */
export const badgeColors: Record<BadgeId, string> = {
  boulder: "#8b919c",
  cascade: "#3c8ee0",
  thunder: "#f08a2c",
  rainbow: "#8a6be0",
  soul: "#e07cb4",
  marsh: "#d9a400",
  volcano: "#c4402f",
  earth: "#3e9e3a",
};

export const ruleIcon = (id: RuleId) => createMenuIcon(`rule-${id}`);
export const badgeIcon = (id: BadgeId) => createMenuIcon(`badge-${id}`);

/** `×1.7`: the stardust a run brings home under `danger`. */
export const multiplierText = (danger: number) => `×${stardustMultiplier(danger).toFixed(1)}`;

/** The first badge not yet owned (thresholds rise in table order) and whether `score` reaches it. */
export function nextBadge(
  owned: readonly BadgeId[],
  score: number,
): { id: BadgeId; reached: boolean } | null {
  const id = badgeIds.find((badge) => !owned.includes(badge));
  return id ? { id, reached: score >= badges[id].score } : null;
}

/** A badge on its white disc, ringed in its colour; `dim` greys one not yet reached. */
export function badgeMedal(id: BadgeId, size: number, dim = false): Container {
  const color = dim ? ui.line : badgeColors[id];
  const medal = new Container({
    width: size,
    height: size,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: color,
    backgroundColor: ui.white,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  });
  const icon = badgeIcon(id);
  icon.setProperties({ width: size * 0.62, height: size * 0.62, color });
  medal.add(icon);
  return medal;
}

/** Name and effect, the tip a rule's chip shows. */
export const ruleTip = (id: RuleId) => `${rules[id].name}：${rules[id].effect}`;

/**
 * A run's rules as a row of upright icon keys (the room, the 构筑 panel): white face, ink frame, the
 * rule's icon, in table order. Each key sits centred in its own touch square (`panel`, at least the
 * stage's minimum target), squares edge to edge so no two overlap. All six are built once and only
 * shown or hidden, so an owner can keep each as a control; the row hides without rules.
 */
export class RuleChips {
  readonly panel = new Container({ flexDirection: "row", alignItems: "center" });
  readonly chips: {
    id: RuleId;
    /** The touch square: the control's hit and tip anchor. */
    panel: Container;
    key: Container;
    plate: SlantPlate;
    icon: ReturnType<typeof createMenuIcon>;
  }[];
  shown: readonly RuleId[] = [];

  constructor() {
    this.chips = ruleIds.map((id) => {
      const panel = new Container({
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        display: "none",
      });
      const key = new Container({ alignItems: "center", justifyContent: "center", flexShrink: 0 });
      const plate = new SlantPlate(key, {
        fill: ui.white,
        border: { color: ui.ink, width: 2 },
        upright: true,
      });
      plate.set({ depth: 2 });
      const icon = ruleIcon(id);
      icon.setProperties({ color: ui.ink });
      key.add(plate.content, stack(icon, 1));
      panel.add(key);
      this.panel.add(panel);
      return { id, panel, key, plate, icon };
    });
    this.resize(32, 44);
    this.set([]);
  }

  set(selected: readonly RuleId[]): void {
    this.shown = selected;
    for (const chip of this.chips)
      chip.panel.setProperties({ display: selected.includes(chip.id) ? "flex" : "none" });
    this.panel.setProperties({ display: selected.length ? "flex" : "none" });
  }

  /** `size`: the key drawn; `minTarget`: the stage's touch minimum, the square around it. */
  resize(size: number, minTarget: number): void {
    const target = Math.max(size + 6, minTarget);
    for (const { panel, key, icon } of this.chips) {
      panel.setProperties({ width: target, height: target });
      key.setProperties({ width: size, height: size });
      icon.setProperties({ width: Math.round(size * 0.62), height: Math.round(size * 0.62) });
    }
  }

  /** The keyboard / pad focus ring on chip `index` (−1: none). */
  focusRing(index: number): void {
    this.chips.forEach((chip, i) => chip.plate.set({ focus: i === index ? 1 : 0 }));
  }

  dispose(): void {
    for (const chip of this.chips) chip.plate.dispose();
  }
}

interface Board {
  id: RuleId;
  panel: Container;
  plate: SlantPlate;
  icon: ReturnType<typeof createMenuIcon>;
  name: Text;
  pips: Container[];
  pose: { y: number; depth: number };
}

export interface ChallengeContext {
  /** The rules the run would start with now. */
  selected: readonly RuleId[];
  difficulty: Difficulty;
  owned: readonly BadgeId[];
  available(id: RuleId): boolean;
}

/**
 * 挑战规则: a window over its owner's screen (a dim, then the shared window frame). Six rule boards
 * stand in a 3 × 2 grid, each an upright plate with the rule's icon, name and danger pips; a
 * picked board turns ink like a checked segment. A tray under them reads the run's total danger,
 * its stardust multiplier and the next badge the run can earn. A rule's effect is its tip only
 * (hover, keyboard / pad focus, a long touch). The owner routes input here while it is open.
 */
export class ChallengeWindow {
  readonly root = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    display: "none",
  });
  private readonly dim = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    backgroundColor: ui.ink,
    opacity: 0.45,
  });
  private readonly holder = new Container({ flexShrink: 1, maxWidth: "100%", maxHeight: "100%" });
  private readonly shadow = new Container({
    positionType: "absolute",
    positionLeft: HARD_SHADOW.offset + 2,
    positionTop: HARD_SHADOW.offset + 2,
    positionRight: -(HARD_SHADOW.offset + 2),
    positionBottom: -(HARD_SHADOW.offset + 2),
    borderRadius: RADIUS,
    backgroundColor: "#000000",
    opacity: HARD_SHADOW.alpha,
  });
  private readonly frame: DialogFrame;
  private readonly grid = new Container({ flexDirection: "row", flexWrap: "wrap" });
  private readonly body = new Container({ flexDirection: "column", flexShrink: 1, minHeight: 0 });
  private readonly tray = new Container({
    flexDirection: "row",
    alignItems: "center",
    borderRadius: RADIUS_INNER,
    backgroundColor: ui.mist,
    flexShrink: 0,
  });
  private readonly dangerValue = new Text({
    text: "0",
    fontWeight: 800,
    color: ui.ink,
    whiteSpace: "pre",
  });
  private readonly dangerLabel = new Text({
    text: "危险度",
    fontWeight: 800,
    color: ui.muted,
    whiteSpace: "pre",
  });
  private readonly stardustIcon = new Image({ src: CURRENCY_ICON, flexShrink: 0 });
  private readonly multiplier = new Text({
    text: "×1.0",
    fontWeight: 800,
    color: ui.ink,
    whiteSpace: "pre",
  });
  private readonly badgeSlot = new Container({ flexDirection: "row", alignItems: "center" });
  private readonly badgeName = new Text({ fontWeight: 800, color: ui.ink, whiteSpace: "pre" });
  private readonly badgeScore = new Text({ fontWeight: 700, color: ui.muted, whiteSpace: "pre" });
  /** Holds the next badge's medal (rebuilt when the badge or its reach changes). */
  private readonly medalHolder = new Container({ flexShrink: 0 });
  private readonly separators: Container[] = [];
  private readonly boards: Board[] = [];
  private readonly tooltip: GpuTooltip;
  private readonly stage: UiStage;
  private readonly change: (next: RuleId[]) => void;
  private readonly closed: () => void;
  private readonly inverse = new Matrix4();
  private readonly point = new Vector3();
  private readonly enter = { t: 0 };
  private readonly pop = { scale: 1 };
  private context: ChallengeContext | null = null;
  private shownDanger = -1;
  private shownBadge = "";
  private compact = false;
  private coarse = false;
  private focusVisible = false;
  private focused = -1;
  private hovered = -1;
  private pressed = -1;
  private elapsed = 0;
  private longPress: { index: number; at: number; fired: boolean } | null = null;
  private touchTip = -1;
  private outside: boolean | null = null;
  private pointer: { x: number; y: number } | null = null;
  private closing = false;
  open = false;

  constructor(stage: UiStage, change: (next: RuleId[]) => void, closed: () => void) {
    this.stage = stage;
    this.change = change;
    this.closed = closed;
    this.tooltip = new GpuTooltip(stage);
    this.frame = new DialogFrame(stage, "挑战规则", 660);
    for (const id of ruleIds) this.board(id);
    const separator = () => {
      const line = new Container({ width: 2, height: 28, backgroundColor: ui.line, flexShrink: 0 });
      this.separators.push(line);
      return line;
    };
    const danger = new Container({ flexDirection: "row", alignItems: "baseline", gap: 8 });
    danger.add(this.dangerLabel, this.dangerValue);
    const stardust = new Container({ flexDirection: "row", alignItems: "center", gap: 6 });
    stardust.add(this.stardustIcon, this.multiplier);
    const badgeText = new Container({ flexDirection: "column", flexShrink: 1, minWidth: 0 });
    badgeText.add(this.badgeName, this.badgeScore);
    this.badgeSlot.add(this.medalHolder, badgeText);
    this.tray.add(danger, separator(), stardust, separator(), this.badgeSlot);
    // Above the window's card face, as the boards are.
    this.body.add(this.grid, stack(this.tray, 1));
    this.frame.panel.add(this.body);
    this.holder.add(this.shadow, this.frame.panel);
    this.root.add(stack(this.dim, 0), stack(this.holder, 1));
  }

  private board(id: RuleId): void {
    const panel = new Container({
      flexDirection: "row",
      alignItems: "center",
      flexShrink: 0,
    });
    const plate = new SlantPlate(panel, {
      fill: ui.white,
      border: { color: ui.ink, width: 2 },
      upright: true,
    });
    const icon = ruleIcon(id);
    const name = new Text({
      text: rules[id].name,
      fontWeight: 800,
      whiteSpace: "pre",
      wordBreak: "keep-all",
    });
    const pipRow = new Container({ flexDirection: "row", gap: 3 });
    const pips = Array.from(
      { length: PIPS },
      () => new Container({ width: 12, height: 5, borderRadius: 2, flexShrink: 0 }),
    );
    pipRow.add(...pips);
    const text = new Container({ flexDirection: "column", gap: 5, flexShrink: 1, minWidth: 0 });
    text.add(name, pipRow);
    panel.add(plate.content, stack(icon, 1), stack(text, 1));
    this.grid.add(panel);
    this.boards.push({ id, panel, plate, icon, name, pips, pose: { y: 0, depth: 3 } });
  }

  /** Opens over the owner with its current rules; focus starts on the first board for keys. */
  show(context: ChallengeContext): void {
    this.context = context;
    this.open = true;
    this.closing = false;
    this.focused = this.focusVisible ? 0 : -1;
    this.hovered = this.pressed = this.touchTip = -1;
    this.longPress = null;
    this.root.setProperties({ display: "flex" });
    this.shownDanger = -1;
    this.paint();
    this.stage.motion.enter(this.enter, { t: 0 }, { t: 1 }, 200, () => this.applyEnter(), EASE);
  }

  /** New rules or difficulty from outside (the owner refreshed). */
  update(context: ChallengeContext): void {
    if (!this.open) return;
    this.context = context;
    this.paint();
  }

  close(): void {
    if (!this.open || this.closing) return;
    this.closing = true;
    this.tooltip.show(null, "");
    getAudio().sfx("ui-back");
    this.stage.motion.animate(
      this.enter,
      { t: 0 },
      160,
      () => {
        this.applyEnter();
        if (this.enter.t > 0) return;
        this.open = false;
        this.closing = false;
        this.root.setProperties({ display: "none" });
        this.closed();
      },
      SNAP,
    );
  }

  private applyEnter(): void {
    const t = this.enter.t;
    fade(this.root, t);
    const scale = this.closing ? 0.96 + 0.04 * t : 0.95 + 0.05 * t;
    this.holder.setProperties({ transformScaleX: scale, transformScaleY: scale });
    this.stage.invalidate();
  }

  // ── Paint ─────────────────────────────────────────────────────────────────────────────────

  private paint(): void {
    const context = this.context;
    if (!context) return;
    for (const [index, board] of this.boards.entries()) {
      const on = context.selected.includes(board.id);
      const locked = !context.available(board.id);
      const ink = on ? ui.white : locked ? ui.muted : ui.ink;
      board.plate.set({
        fill: on ? ui.ink : locked ? ui.mist : ui.white,
        border: locked ? ui.line : ui.ink,
        focus: index === this.focused && this.focusVisible ? 1 : 0,
      });
      board.icon.setProperties({ color: ink });
      board.name.setProperties({ color: ink });
      board.pips.forEach((pip, i) =>
        pip.setProperties({
          backgroundColor:
            i < RULE_DANGER[board.id] ? (locked ? ui.line : ui.ball) : on ? ui.muted : ui.line,
        }),
      );
      const lift = locked
        ? 0
        : index === this.pressed
          ? -LIFT.press
          : index === this.hovered
            ? LIFT.hover
            : 0;
      this.stage.motion.animate(
        board.pose,
        { y: -lift, depth: 3 + lift },
        LIFT.ms,
        () => {
          board.panel.setProperties({ transformTranslateY: board.pose.y });
          board.plate.set({ depth: board.pose.depth });
          this.stage.invalidate();
        },
        SNAP,
      );
    }
    const close = this.frame.close;
    close.setHovered(this.hovered === this.boards.length);
    close.setFocused(this.focused === this.boards.length);
    close.setFocusVisible(this.focusVisible);
    close.setPressed(this.pressed === this.boards.length);
    const danger = totalDanger(context.selected);
    this.dangerValue.setProperties({ text: String(danger) });
    this.multiplier.setProperties({ text: multiplierText(danger) });
    if (this.shownDanger >= 0 && danger !== this.shownDanger)
      // The tray's numbers answer each toggle with one small pop.
      this.stage.motion.enter(
        this.pop,
        { scale: 1.25 },
        { scale: 1 },
        240,
        () => {
          for (const text of [this.dangerValue, this.multiplier])
            text.setProperties({
              transformScaleX: this.pop.scale,
              transformScaleY: this.pop.scale,
            });
          this.stage.invalidate();
        },
        POP,
      );
    this.shownDanger = danger;
    const score = badgeScore(context.difficulty, danger);
    const next = nextBadge(context.owned, score);
    const key = next ? `${next.id}:${next.reached}` : "all";
    if (key !== this.shownBadge) {
      this.shownBadge = key;
      for (const child of this.medalHolder.children.slice()) child.removeFromParent();
      const size = this.compact ? 30 : 36;
      // All eight owned: the last one stands for the set.
      this.medalHolder.add(
        next ? badgeMedal(next.id, size, !next.reached) : badgeMedal("earth", size),
      );
    }
    this.badgeName.setProperties({
      text: next ? badges[next.id].name : "道馆徽章",
      color: next && !next.reached ? ui.muted : ui.ink,
    });
    this.badgeScore.setProperties({
      text: next ? `${score} / ${badges[next.id].score}` : "8 / 8",
    });
    this.stage.invalidate();
  }

  resize(compact: boolean, coarse: boolean, width: number, height: number): void {
    this.compact = compact;
    this.coarse = coarse;
    const min = this.stage.viewport.minTarget;
    this.frame.resize(compact);
    this.frame.escBadge.setProperties({ display: coarse ? "none" : "flex" });
    const gap = compact ? 8 : 12;
    const pad = compact ? 12 : 20;
    const panelW = Math.min(compact ? 600 : 660, width);
    this.frame.panel.setProperties({ width: panelW });
    this.holder.setProperties({ maxWidth: width, maxHeight: height });
    const boardW = Math.floor((panelW - 2 * pad - 2 * gap) / 3);
    const boardH = Math.max(compact ? 50 : 64, min);
    this.body.setProperties({
      paddingX: pad,
      paddingTop: compact ? 8 : 16,
      paddingBottom: pad,
      gap,
    });
    this.grid.setProperties({ gap, width: boardW * 3 + gap * 2 });
    for (const board of this.boards) {
      board.panel.setProperties({
        width: boardW,
        height: boardH,
        paddingX: compact ? 10 : 14,
        gap: compact ? 8 : 12,
      });
      board.icon.setProperties({ width: compact ? 24 : 28, height: compact ? 24 : 28 });
      board.name.setProperties({ fontSize: compact ? 15 : 16 });
    }
    this.tray.setProperties({
      gap: compact ? 12 : 18,
      paddingX: compact ? 12 : 18,
      paddingY: compact ? 6 : 10,
    });
    this.dangerLabel.setProperties({ fontSize: compact ? 13 : 14 });
    this.dangerValue.setProperties({ fontSize: compact ? 22 : 26 });
    this.stardustIcon.setProperties({ width: compact ? 22 : 26, height: compact ? 22 : 26 });
    this.multiplier.setProperties({ fontSize: compact ? 18 : 20 });
    this.badgeSlot.setProperties({ gap: compact ? 8 : 10, flexShrink: 1, minWidth: 0 });
    this.badgeName.setProperties({ fontSize: compact ? 14 : 15 });
    this.badgeScore.setProperties({ fontSize: compact ? 12 : 13 });
    for (const line of this.separators) line.setProperties({ height: compact ? 22 : 28 });
    this.frame.close.fitTouch();
    this.shownBadge = "";
    this.paint();
  }

  // ── Input ─────────────────────────────────────────────────────────────────────────────────

  private panels(): Container[] {
    return [...this.boards.map((board) => board.panel), this.frame.close.panel];
  }

  private contains(panel: Container, x: number, y: number): boolean {
    const m = panel.globalMatrix.value,
      size = panel.size.value;
    if (!m || !size || !panel.isVisible.value) return false;
    const v = this.stage.viewport;
    this.point
      .set(x / v.scale + this.stage.camera.left, this.stage.camera.top - y / v.scale, 0)
      .applyMatrix4(this.inverse.copy(m).invert());
    return Math.abs(this.point.x) <= size[0] / 2 && Math.abs(this.point.y) <= size[1] / 2;
  }

  hit(x: number, y: number): number {
    if (!this.open || this.closing) return -1;
    return this.panels().findIndex((panel) => this.contains(panel, x, y));
  }

  focus(index: number): void {
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

  setFocusVisible(visible: boolean): void {
    this.focusVisible = visible;
    if (visible && this.focused < 0 && this.open) this.focused = 0;
    this.paint();
  }

  activate(index: number): void {
    if (!this.open || this.closing || !this.context) return;
    if (index === this.boards.length) return this.close();
    const board = this.boards[index];
    if (!board) return;
    if (!this.context.available(board.id)) {
      getAudio().sfx("ui-denied");
      this.touchTip = index;
      return;
    }
    const was = this.context.selected;
    const next = ruleIds.filter((id) => (id === board.id ? !was.includes(id) : was.includes(id)));
    getAudio().sfx("ui-confirm");
    this.context = { ...this.context, selected: next };
    this.change(next);
    this.paint();
  }

  /** Grid moves among the boards and the close key; confirm toggles; back closes. */
  navigate(action: NavigationAction): boolean {
    if (!this.open) return false;
    this.touchTip = -1;
    if (this.closing) return true;
    if (action === "cancel") {
      this.close();
      return true;
    }
    const count = this.boards.length + 1;
    if (action === "next" || action === "previous") {
      this.focus((Math.max(0, this.focused) + (action === "next" ? 1 : count - 1)) % count);
      return true;
    }
    if (this.focused < 0) {
      if (isNavigationDirection(action) || action === "confirm") this.focus(0);
      return true;
    }
    if (isNavigationDirection(action)) {
      this.focus(gridStep(this.panels(), this.focused, action));
      return true;
    }
    if (action === "confirm") this.activate(this.focused);
    return true;
  }

  pointerDown(x: number, y: number, touch: boolean): void {
    this.pointer = { x, y };
    this.outside = !this.contains(this.frame.panel, x, y);
    const index = this.hit(x, y);
    if (this.touchTip >= 0 && index !== this.touchTip) this.touchTip = -1;
    this.longPress =
      touch && index >= 0 && index < this.boards.length
        ? { index, at: this.elapsed, fired: false }
        : null;
  }

  pointerMove(x: number, y: number): void {
    this.pointer = { x, y };
  }

  /** True when the press only opened a tip. A press that starts and ends on the dim closes. */
  pointerUp(): boolean {
    const press = this.longPress;
    this.longPress = null;
    const outside = this.outside;
    this.outside = null;
    const at = this.pointer;
    if (outside && at && !this.contains(this.frame.panel, at.x, at.y)) this.close();
    return !!press?.fired;
  }

  afterLayout(deltaMs: number): void {
    this.elapsed += deltaMs;
    if (!this.open) return;
    const press = this.longPress;
    if (press && !press.fired && this.elapsed - press.at >= LONG_PRESS_MS) {
      press.fired = true;
      this.touchTip = press.index;
    }
    const keyed = this.focusVisible && this.focused < this.boards.length ? this.focused : -1;
    const shown =
      this.touchTip >= 0 ? this.touchTip : !this.coarse && this.hovered >= 0 ? this.hovered : keyed;
    const board = this.closing ? undefined : this.boards[shown];
    const locked = board && this.context && !this.context.available(board.id);
    this.tooltip.show(
      board?.panel ?? null,
      board ? (locked ? `${rules[board.id].effect}\n尚未解锁` : rules[board.id].effect) : "",
    );
    this.tooltip.update();
  }

  dispose(): void {
    this.stage.motion.cancel(this.enter);
    this.stage.motion.cancel(this.pop);
    for (const board of this.boards) {
      this.stage.motion.cancel(board.pose);
      board.plate.dispose();
    }
    this.tooltip.dispose();
    this.frame.dispose();
  }
}

/**
 * 规则 by the route: a slanted key of the ‹ › family (white face, ink frame, hard shadow) with the
 * word and the run's total danger on an ink chip (a muted mist chip at 0). Hover lifts it, a press
 * sinks it, keyboard focus rings it; it opens the rules window.
 */
export class RulesKey {
  readonly panel = new Container({
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    minHeight: 44,
    paddingLeft: 14 + slantOf(44) / 2,
    paddingRight: 10 + slantOf(44) / 2,
    gap: 8,
  });
  private readonly plate = new SlantPlate(this.panel, {
    fill: ui.white,
    border: { color: ui.ink, width: 2 },
  });
  private readonly label = new Text({
    text: "规则",
    fontSize: 15,
    fontWeight: 800,
    letterSpacing: 1,
    color: ui.ink,
    whiteSpace: "pre",
  });
  private readonly chip = new Container({
    minWidth: 24,
    height: 24,
    paddingX: 6,
    borderRadius: RADIUS_INNER,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  });
  private readonly value = new Text({ fontSize: 14, fontWeight: 800, whiteSpace: "pre" });
  private readonly pose = { y: 0, depth: HARD_SHADOW.offset - 1 };
  private readonly stage: UiStage;
  private hovered = false;
  private focused = false;
  private focusVisible = false;
  private pressed = false;
  private danger = -1;

  constructor(stage: UiStage) {
    this.stage = stage;
    this.plate.set({ depth: this.pose.depth });
    this.chip.add(this.value);
    this.panel.add(this.plate.content, stack(this.label, 1), stack(this.chip, 1));
    this.setDanger(0);
  }

  setDanger(danger: number): void {
    if (danger === this.danger) return;
    this.danger = danger;
    this.value.setProperties({ text: String(danger), color: danger ? ui.white : ui.muted });
    this.chip.setProperties({ backgroundColor: danger ? ui.ink : ui.mist });
    this.stage.invalidate();
  }

  setHovered(hovered: boolean): void {
    if (hovered === this.hovered) return;
    this.hovered = hovered;
    this.paint();
  }
  setFocused(focused: boolean): void {
    if (focused === this.focused) return;
    this.focused = focused;
    this.paint();
  }
  setFocusVisible(visible: boolean): void {
    if (visible === this.focusVisible) return;
    this.focusVisible = visible;
    this.paint();
  }
  setPressed(pressed: boolean): void {
    if (pressed === this.pressed) return;
    this.pressed = pressed;
    this.paint();
  }
  fitTouch(): void {
    this.panel.setProperties({ minHeight: Math.max(44, this.stage.viewport.minTarget) });
  }

  private paint(): void {
    const lift = this.pressed ? -LIFT.press : this.hovered ? LIFT.hover : 0;
    this.plate.set({ focus: this.focused && this.focusVisible ? 1 : 0 });
    this.stage.motion.animate(
      this.pose,
      { y: -lift, depth: HARD_SHADOW.offset - 1 + lift },
      LIFT.ms,
      () => {
        this.plate.set({ depth: this.pose.depth });
        this.panel.setProperties({ transformTranslateY: this.pose.y });
        this.stage.invalidate();
      },
      SNAP,
    );
  }

  dispose(): void {
    this.stage.motion.cancel(this.pose);
    this.plate.dispose();
  }
}
