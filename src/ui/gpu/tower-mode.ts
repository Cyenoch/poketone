import { Container, Text } from "@pmndrs/uikit";
import { towerUnlocked, type LobbyPick } from "../../lobbyPick";
import type { Progress } from "../../run/progress";
import { difficulties } from "../../run/sim/content/difficulties";
import type { StarterId } from "../../run/sim/content/lines/index";
import { createMenuIcon } from "./icons";
import { stack } from "./layer";
import { LIFT, SNAP } from "./motion";
import { SlantPlate } from "./slant-plate";
import type { UiStage } from "./stage";
import { HARD_SHADOW, slantOf, ui } from "./tokens";

export type RunMode = LobbyPick["mode"];
export const modeOrder: readonly RunMode[] = ["expedition", "tower"];
const modeNames: Record<RunMode, string> = { expedition: "探险", tower: "对战塔" };

/** Why 对战塔 cannot be picked yet (the same gate as `validPick`): any clear opens it. */
export function towerLock(progress: Progress): string | null {
  return towerUnlocked(progress) ? null : `${difficulties[0].name}通关后解锁`;
}

/**
 * One of the route's two modes, a slanted key of the 规则 family: white face and ink frame, the
 * picked one ink with a white word; a locked one muted behind a padlock. Hover lifts it, a press
 * sinks it, keyboard focus rings it.
 */
export class ModeKey {
  readonly panel = new Container({
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    minHeight: 44,
    paddingX: 12 + slantOf(44) / 2,
    gap: 4,
  });
  private readonly plate = new SlantPlate(this.panel, {
    fill: ui.white,
    border: { color: ui.ink, width: 2 },
  });
  private readonly lock = createMenuIcon("lock");
  private readonly label: Text;
  private readonly pose = { y: 0, depth: HARD_SHADOW.offset - 1 };
  private readonly stage: UiStage;
  private hovered = false;
  private focused = false;
  private focusVisible = false;
  private pressed = false;
  private checked = false;
  private locked = false;

  constructor(stage: UiStage, mode: RunMode) {
    this.stage = stage;
    this.label = new Text({
      text: modeNames[mode],
      fontSize: 15,
      fontWeight: 800,
      letterSpacing: 1,
      color: ui.ink,
      whiteSpace: "pre",
    });
    this.lock.setProperties({ width: 16, height: 16, color: ui.muted, display: "none" });
    this.plate.set({ depth: this.pose.depth });
    this.panel.add(this.plate.content, stack(this.lock, 1), stack(this.label, 1));
  }

  set(checked: boolean, locked: boolean): void {
    if (checked === this.checked && locked === this.locked) return;
    this.checked = checked;
    this.locked = locked;
    this.plate.set({
      fill: checked ? ui.ink : locked ? ui.mist : ui.white,
      border: locked ? ui.line : ui.ink,
    });
    this.label.setProperties({ color: checked ? ui.white : locked ? ui.muted : ui.ink });
    this.lock.setProperties({ display: locked ? "flex" : "none" });
    this.paint();
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

  /** A locked key holds still; the picked one sits down on its base. */
  private paint(): void {
    const live = !this.locked && !this.checked;
    const lift = this.pressed && !this.locked ? -LIFT.press : live && this.hovered ? LIFT.hover : 0;
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

/** The two mode keys side by side, in `modeOrder`. */
export function modeKeys(stage: UiStage): { row: Container; keys: ModeKey[] } {
  const row = new Container({ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 });
  const keys = modeOrder.map((mode) => new ModeKey(stage, mode));
  row.add(...keys.map((key) => key.panel));
  return { row, keys };
}

/** The partner's best tower floor where the route map stands: 最高 12 层 (and the record's
 *  difficulty past 普通); nothing before a first tower run. */
export class TowerRecord {
  readonly panel = new Container({
    flexDirection: "row",
    alignItems: "baseline",
    flexShrink: 0,
    gap: 4,
  });
  private readonly caption = new Text({
    text: "最高",
    fontWeight: 800,
    color: ui.muted,
    whiteSpace: "pre",
  });
  private readonly floor = new Text({ fontWeight: 800, color: ui.ink, whiteSpace: "pre" });
  private readonly unit = new Text({
    text: "层",
    fontWeight: 800,
    color: ui.ink,
    whiteSpace: "pre",
  });
  private readonly difficulty = new Text({
    fontWeight: 800,
    color: ui.muted,
    whiteSpace: "pre",
  });

  constructor() {
    this.panel.add(this.caption, this.floor, this.unit, this.difficulty);
    this.size(false);
  }

  /** Shows `starter`'s record (hidden while `shown` is false or no record exists). */
  set(progress: Progress, starter: StarterId, shown: boolean): void {
    const record = progress.tower[starter];
    this.panel.setProperties({ display: shown && record ? "flex" : "none" });
    if (!record) return;
    this.floor.setProperties({ text: String(record.floor) });
    this.difficulty.setProperties({
      text: record.difficulty > 0 ? `· ${difficulties[record.difficulty].name}` : "",
    });
  }

  size(compact: boolean): void {
    const small = compact ? 12 : 13;
    for (const text of [this.caption, this.unit, this.difficulty])
      text.setProperties({ fontSize: small });
    this.floor.setProperties({ fontSize: compact ? 20 : 24, lineHeight: "100%" });
  }
}
