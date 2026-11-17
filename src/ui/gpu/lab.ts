import { FullscreenIcon } from "./fullscreen-icon";
import { isNavigationDirection, type NavigationAction } from "../../platform/input";
import { revealInScroller } from "./scroll-reveal";
import { Container, Content, Image, Text, type FontFamilies } from "@pmndrs/uikit";
import { Matrix4, Mesh, PlaneGeometry, Vector2, Vector3, type Texture } from "three";
import { getAudio } from "../../audio/engine";
import { labTerms } from "../../run/glossary";
import { labItem, nextCost, type LabItem } from "../../run/lab";
import { type LabId } from "../../run/sim/content/lab";
import { labLock } from "../../run/locks";
import { archiveSlots, type Progress } from "../../run/progress";
import { items, type ItemId } from "../../run/sim/content/items";
import { rarityNames } from "../../run/sim/upgrades";
import { itemIcon } from "../../screens/runArt";
import { rarityTones } from "./run-choice-surface";
import { rarityTag } from "./tag";
import { OutlineRing } from "./box-shadow";
import { CURRENCY_ICON } from "./currency";
import { CardFace } from "./dialog-surface";
import { gridStep } from "./grid-nav";
import { GameButton } from "./game-button";
import { GrayscaleImageMaterial, setGrayscale } from "./grayscale-image";
import { createMenuIcon } from "./icons";
import { InnerScreenFrame } from "./inner-screen";
import { fade, stack } from "./layer";
import { EASE, LIFT, POP, SNAP, stagger } from "./motion";
import { clipMain, clipVertex } from "./screen-parts";
import { SegmentFace, segmentTray } from "./segment-face";
import { ellipsize } from "./text-fit";
import { UiStage } from "./stage";
import { GpuTooltip } from "./tooltip";
import { UiShaderMaterial } from "./ui-shader";
import type { UiInsets } from "./viewport";
import { HARD_SHADOW, RADIUS, RADIUS_INNER, srgb, ui } from "./tokens";

const glsl = (hex: string) => {
  const c = srgb(hex);
  return `vec3(${c.x.toFixed(4)},${c.y.toFixed(4)},${c.z.toFixed(4)})`;
};

export interface LabCallbacks {
  buy(id: LabId): void;
  archive(archive: ItemId[]): void;
  back(): void;
  settings(): void;
}

type SectionId = "combat" | "output" | "economy" | "system";

/** Display grouping only; the items and their rules stay in run/lab.ts. */
const sections: readonly { id: SectionId; name: string; items: readonly LabId[] }[] = [
  { id: "combat", name: "战斗", items: ["dmg", "hp", "armor", "regen"] },
  { id: "output", name: "输出", items: ["crit", "atkspd", "area", "ult"] },
  { id: "economy", name: "机动与经济", items: ["spd", "xp", "gold", "magnet", "luck"] },
  {
    id: "system",
    name: "系统",
    items: [
      "slot-move",
      "slot-vit",
      "choice4",
      "reroll",
      "skip",
      "banish",
      "revive",
      "research",
      "party",
      "archive",
      "bag",
    ],
  },
];

const LONG_PRESS_MS = 450;
const prices = new Intl.NumberFormat("zh-CN");
/** Tiles that slide in one after another when a section opens; the rest come with the last. */
const STAGGERED_TILES = 12;

/** `当前 → 下一级`; level 0 shows only the next value, a maxed item only its current one. */
function effect(item: LabItem, level: number): [string, string | null] {
  const now = item.value(item.per * level);
  if (level >= item.max) return [now, null];
  const next = item.value(item.per * (level + 1));
  return level === 0 ? [next, null] : [now, `→ ${next}`];
}

type Kind = "fullscreen" | "back" | "settings" | "tab" | "tile" | "archive";
interface Control {
  kind: Kind;
  panel: Container;
  tip(): string | null;
  /** `aria-disabled`: focusable and explained, but it does nothing. */
  locked(): boolean;
  activate(): void;
  paint(state: {
    hovered: boolean;
    focused: boolean;
    focusVisible: boolean;
    pressed: boolean;
  }): void;
  update(deltaMs: number): void;
  dispose(): void;
}

/**
 * The 研究所 (DESIGN.md › 研究所): the top line with the title plate and the 星星沙子 balance, the
 * section segments, and the upgrade tiles on the paper ground, three to a row (two where three
 * would be too narrow). A tile is the buy button: icon, name, level pips, `stat now → next` and its
 * price (ball red when it can be bought, mist when short, success when maxed). 系统 adds the 档案库,
 * every item as a toggle that strikes it out of runs.
 */
export class GpuLab {
  readonly stage = new UiStage();
  /** Tabs, three tile columns and the board need a landscape phone's room at least. */
  readonly minLayout = { width: 760, height: 320 };
  private readonly callbacks: LabCallbacks;
  private readonly frame: InnerScreenFrame;
  private readonly balance: Balance;
  private readonly body = new Container({ flexGrow: 1, minHeight: 0, flexDirection: "column" });
  private readonly tabs: Container;
  private readonly content = new Container({
    flexGrow: 1,
    minHeight: 0,
    flexDirection: "column",
    overflow: "scroll",
    scrollbarWidth: 3,
    scrollbarColor: ui.muted,
  });
  /**
   * The scrolled sheet: it clips the tiles' faces (their shadows reach past the tile) so they
   * never widen the scroll; its padding keeps lifts, shadows and focus rings inside the clip.
   */
  private sheet = new Container();
  private readonly tooltip: GpuTooltip;
  private fixed: Control[] = [];
  private controls: Control[] = [];
  private sectionControls: Control[] = [];
  private readonly sectionParts: { dispose(): void }[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly point = new Vector3();
  private readonly inverse = new Matrix4();
  private progress: Progress;
  private section: SectionId = "combat";
  private focused = -1;
  private hovered = -1;
  private pressed = -1;
  private focusVisible = false;
  private compact = false;
  private touchTip = -1;
  private hoveredTip = -1;
  private tipPress: { index: number; at: number; x: number; y: number; fired: boolean } | null =
    null;
  private elapsed = 0;
  private entrance: { x: number; opacity: number }[] = [];

  /** `_backdrop`: the host's lobby art, no longer drawn here (the frame draws the paper ground). */
  constructor(
    fonts: FontFamilies,
    _backdrop: Texture,
    progress: Progress,
    callbacks: LabCallbacks,
  ) {
    this.callbacks = callbacks;
    this.progress = progress;
    this.stage.root.setProperties({ fontFamilies: fonts, flexDirection: "column", color: ui.ink });
    this.tooltip = new GpuTooltip(this.stage);
    this.frame = new InnerScreenFrame(this.stage, "研究所");
    this.balance = new Balance(this.stage);
    this.balance.set(progress.stardust);
    this.frame.extra.add(this.balance.root);
    this.stage.root.add(this.frame.topline, this.frame.body);
    this.frame.body.add(this.body);
    const tray = segmentTray();
    this.tabs = tray.tray;
    this.disposables.push(tray);
    this.body.add(stack(this.content, 1));
    this.fixed.push(
      this.keyControl("back", this.frame.back, () => {
        getAudio().sfx("ui-back");
        this.callbacks.back();
      }),
      this.keyControl("settings", this.frame.settings, () => {
        getAudio().sfx("ui-confirm");
        this.callbacks.settings();
      }),
    );
    this.fullscreen = new GameButton(this.stage, {
      tone: "secondary",
      size: "small",
      square: true,
      icon: this.fullscreenIcon,
    });
    this.fullscreen.panel.setProperties({ display: "none" });
    this.frame.topline.add(stack(this.fullscreen.panel, 1));
    this.fullscreenControl = this.keyControl("fullscreen", this.fullscreen, () =>
      this.toggleFullscreen?.(),
    );
    this.buildTabs();
    this.buildSection(true);
  }

  private readonly fullscreen: GameButton;
  private readonly fullscreenControl: Control;
  private toggleFullscreen: (() => void) | undefined;
  private readonly fullscreenIcon = new FullscreenIcon();

  setFullscreenAction(action: (() => void) | undefined, active: boolean): void {
    if (this.fullscreenIcon.setActive(active)) this.stage.invalidate();
    if (this.toggleFullscreen === action) return;
    this.toggleFullscreen = action;
    this.fullscreen.panel.setProperties({ display: action ? "flex" : "none" });
    this.fixed = this.fixed.filter((control) => control !== this.fullscreenControl);
    if (action) this.fixed.push(this.fullscreenControl);
    this.controls = [...this.fixed, ...this.tabControls, ...this.sectionControls];
    this.focused = -1;
    this.repaint();
  }

  private keyControl(kind: Kind, button: GameButton, activate: () => void): Control {
    return {
      kind,
      panel: button.panel,
      tip: () => null,
      locked: () => false,
      activate,
      paint: ({ hovered, focused, focusVisible, pressed }) => {
        button.setHovered(hovered);
        button.setFocused(focused);
        button.setFocusVisible(focusVisible);
        button.setPressed(pressed);
      },
      update: (deltaMs) => button.update(deltaMs),
      dispose: () => {},
    };
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────────────────────

  private tabControls: Control[] = [];
  private readonly tabFaces: SegmentFace[] = [];

  /** The section segments on their ink tray (placed by `resize`: own row, or the top line). */
  private buildTabs(): void {
    for (const entry of sections) {
      const face = new SegmentFace(this.stage, entry.name);
      this.tabFaces.push(face);
      this.tabs.add(stack(face.panel, 1));
      this.disposables.push(face);
      const control: Control = {
        kind: "tab",
        panel: face.panel,
        tip: () => null,
        locked: () => false,
        activate: () => {
          if (this.section === entry.id) return;
          this.section = entry.id;
          this.buildSection(true);
        },
        paint: (state) =>
          face.paint({ ...state, checked: this.section === entry.id, locked: false }),
        update: (deltaMs) => face.update(deltaMs),
        dispose: () => {},
      };
      this.tabControls.push(control);
    }
  }

  // ── Board ──────────────────────────────────────────────────────────────────────────────────

  private grid = new Container();
  private tileRows: Container[] = [];
  private column = 0;
  /** Tiles to a row: three while a tile keeps its values clear of the price, else two. */
  private columns = 3;
  /** The open section's columns: two for a short section, else `columns`. */
  private gridColumns = 3;
  /** The tile rows grow into the sheet's free height (no 档案库 below them). */
  private fills = true;
  private readonly tiles: Control[] = [];

  /** Rebuilds the open section; `animate` slides its tiles in one after another (45ms apart). */
  private buildSection(animate = false): void {
    for (const control of this.sectionControls) control.dispose();
    for (const part of this.sectionParts.splice(0)) part.dispose();
    for (const state of this.entrance) this.stage.motion.cancel(state);
    this.sheet.removeFromParent();
    this.sheet.dispose();
    this.sheet = new Container({
      flexDirection: "column",
      flexGrow: 1,
      flexShrink: 0,
      overflow: "hidden",
      paddingTop: 10,
      paddingBottom: 14,
      paddingX: 10,
    });
    this.content.add(this.sheet);
    this.sectionControls = [];
    this.tiles.length = 0;
    this.sized = [];
    this.archiveItems = [];
    this.archiveLegend = null;
    this.tileRows = [];
    this.column = 0;
    // A new section starts at its top; a rebuild in place (columns, archive slots) keeps the scroll.
    if (animate) this.content.scrollPosition.value = [0, 0];
    const current = sections.find((entry) => entry.id === this.section)!;
    const slots = archiveSlots(this.progress);
    const archived = this.section === "system" && slots > 0;
    // A short section takes two wide columns; rows grow into the free height (up to a cap) and the
    // block sits centred, so the sheet is never a strip of cards over empty paper. With the 档案库
    // below, the tiles keep their natural height and the sheet scrolls.
    this.gridColumns = Math.min(this.columns, current.items.length <= 4 ? 2 : 3);
    this.fills = !archived;
    this.sheet.setProperties({ justifyContent: archived ? "flex-start" : "center" });
    // `columns` to a row, filled from the top; the last row keeps its column widths.
    const grid = new Container({
      flexDirection: "column",
      flexShrink: 0,
      flexGrow: archived ? 0 : 1,
    });
    this.grid = grid;
    this.sheet.add(grid);
    for (let i = 0; i < current.items.length; i += this.gridColumns) {
      const row = new Container({
        flexDirection: "row",
        flexShrink: 0,
        flexGrow: archived ? 0 : 1,
      });
      for (let j = 0; j < this.gridColumns; j++) {
        const id = current.items[i + j];
        if (id) row.add(this.tile(labItem(id)));
        else row.add(new Container({ flexGrow: 1, flexBasis: 0, minWidth: 0 }));
      }
      this.tileRows.push(row);
      grid.add(row);
    }
    if (archived) this.sheet.add(this.archive(slots));
    this.controls = [...this.fixed, ...this.tabControls, ...this.sectionControls];
    this.focused = Math.min(this.focused, this.controls.length - 1);
    this.applySizes();
    this.repaint();
    const moving = this.tiles.slice(0, STAGGERED_TILES).map((tile) => tile.panel);
    this.entrance = moving.map(() => ({ x: 0, opacity: 1 }));
    if (!animate) return;
    for (const [i, state] of this.entrance.entries()) {
      const panel = moving[i]!;
      this.stage.motion.enter(
        state,
        { x: -60, opacity: 0 },
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

  /** One upright card per upgrade; the whole card buys the next level. */
  private tile(item: LabItem): Container {
    const panel = new Container({
      flexDirection: "row",
      alignItems: "center",
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 0,
    });
    const face = new CardFace(panel, { fill: ui.white });
    const ring = new OutlineRing(RADIUS, ui.ink, 2.5, 3);
    ring.content.setProperties({ display: "none" });
    const well = stack(
      new Container({
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: RADIUS_INNER,
        backgroundColor: ui.mist,
      }),
      1,
    );
    well.add(new Image({ src: `/art/icons/lab/${item.id}.webp`, width: "86%", height: "86%" }));
    const body = stack(
      new Container({ flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 4 }),
      1,
    );
    const top = new Container({ flexDirection: "row", alignItems: "center", gap: 12 });
    const name = new Text({ text: item.name, fontWeight: 900, lineHeight: 1.2, color: ui.ink });
    name.setProperties({ flexGrow: 1, flexShrink: 1, minWidth: 0, whiteSpace: "pre" });
    const pips = new PipStrip(item.max);
    const pipBox = new Container({ flexShrink: 0 });
    pipBox.add(pips.content);
    top.add(name, pipBox);
    const bottom = new Container({ flexDirection: "row", alignItems: "flex-end", gap: 12 });
    // The effect leads the card: its stat small above, the value (now → next) large.
    const effectRow = new Container({
      flexDirection: "column",
      alignItems: "flex-start",
      gap: 0,
      flexGrow: 1,
      minWidth: 0,
    });
    const stat = new Text({ text: item.stat, fontWeight: 700, color: ui.muted, lineHeight: 1.2 });
    stat.setProperties({ flexShrink: 0 });
    // A partly bought upgrade's now → next can be wider than its column at the smallest scale: it
    // wraps between the two (「+24%」/「→ +32%」), the arrow kept with its value.
    const value = new Text({ text: "", fontWeight: 900, color: ui.ink, lineHeight: 1.2 });
    const next = new Text({ text: "", fontWeight: 900, color: ui.ink, lineHeight: 1.2 });
    // Each is one unbreakable unit (uikit's keep-all never wraps): the row wraps whole units.
    value.setProperties({ wordBreak: "keep-all", flexShrink: 0 });
    next.setProperties({ wordBreak: "keep-all", flexShrink: 0, display: "none" });
    const values = new Container({
      flexDirection: "row",
      flexWrap: "wrap",
      gapColumn: 6,
      alignSelf: "stretch",
      flexShrink: 1,
      minWidth: 0,
    });
    values.add(value, next);
    effectRow.add(stat, values);
    // The price: ball red when it can be bought, mist when short, success when maxed.
    const price = new Container({
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      paddingLeft: 4,
      paddingRight: 9,
      borderRadius: RADIUS_INNER,
      flexShrink: 0,
    });
    const coin = new Image({
      src: CURRENCY_ICON,
      width: 22,
      height: 22,
      flexShrink: 0,
      panelMaterialClass: GrayscaleImageMaterial,
    });
    const check = createMenuIcon("check");
    check.setProperties({ width: 16, height: 16, color: ui.white, marginLeft: 4 });
    const amount = new Text({ text: "", fontWeight: 900, lineHeight: 1.2 });
    price.add(coin, check, amount);
    // The chip is as wide as its coin and amount, centred under the pips (the column is the
    // pips' width): never stretched to the gauge.
    const priceSlot = new Container({
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      flexShrink: 0,
    });
    priceSlot.add(price);
    bottom.add(effectRow, priceSlot);
    body.add(top, bottom);
    panel.add(face.content, well, body, stack(ring.content, 3));
    this.sectionParts.push(face, ring, pips);
    const level = () => this.progress.lab[item.id] ?? 0;
    const lock = () => labLock(item, level(), this.progress.stardust);
    const pose = { lift: 0 };
    let target = "";
    const control: Control = {
      kind: "tile",
      panel,
      tip: () => [labTerms[item.id], lock()].filter(Boolean).join(" · ") || null,
      locked: () => lock() !== null,
      activate: () => {
        if (lock()) {
          getAudio().sfx("ui-denied");
          return;
        }
        getAudio().sfx("ui-confirm");
        this.callbacks.buy(item.id);
      },
      paint: ({ hovered, focused, focusVisible, pressed }) => {
        const now = level();
        const cost = nextCost(item, now);
        const state = cost === null ? "maxed" : lock() ? "short" : "ready";
        ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
        face.set({ fill: state === "maxed" ? ui.mist : ui.white });
        pips.set(now);
        const [current, following] = effect(item, now);
        value.setProperties({ text: current });
        next.setProperties({ text: following ?? "", display: following ? "flex" : "none" });
        amount.setProperties({
          text: cost === null ? "满级" : prices.format(cost),
          color: state === "short" ? ui.muted : ui.white,
        });
        coin.setProperties({ display: cost === null ? "none" : "flex" });
        setGrayscale(coin, state === "short" ? 0.7 : 0);
        check.setProperties({ display: cost === null ? "flex" : "none" });
        price.setProperties({
          backgroundColor: state === "maxed" ? ui.success : state === "short" ? ui.mist : ui.ball,
        });
        // A buyable tile lifts 3px under the pointer and sinks 1px when pressed.
        const lift = state !== "ready" ? 0 : pressed ? -LIFT.press : hovered ? LIFT.hover : 0;
        const key = `${lift}`;
        if (key === target) return;
        const duration = target === "" ? 0 : LIFT.ms;
        target = key;
        this.stage.motion.animate(
          pose,
          { lift },
          duration,
          () => {
            panel.setProperties({ transformTranslateY: -pose.lift });
            face.set({ depth: HARD_SHADOW.offset + pose.lift });
            this.stage.invalidate();
          },
          SNAP,
        );
      },
      update: () => {
        const fitted = ellipsize(name, item.name);
        if (fitted !== undefined && fitted !== name.properties.value.text)
          name.setProperties({ text: fitted });
        pips.update();
      },
      dispose: () => this.stage.motion.cancel(pose),
    };
    this.sectionControls.push(control);
    this.tiles.push(control);
    this.sized.push({
      panel,
      well,
      name,
      stat,
      value,
      next,
      amount,
      priceSlot,
      pipBox,
      pips,
      top,
      bottom,
      body,
      price,
      coinSize: (size) => coin.setProperties({ width: size, height: size }),
    });
    return panel;
  }
  private sized: {
    panel: Container;
    well: Container;
    name: Text;
    stat: Text;
    value: Text;
    next: Text;
    amount: Text;
    priceSlot: Container;
    pipBox: Container;
    pips: PipStrip;
    top: Container;
    bottom: Container;
    body: Container;
    price: Container;
    coinSize(size: number): void;
  }[] = [];

  private archiveItems: Container[] = [];
  private archiveLegend: Text | null = null;

  /** The 档案库: every item as a toggle, in rows by card tier (about 120 items read as four short
   *  shelves, not one long run); archived ones are struck out of runs. */
  private archive(slots: number): Container {
    const plate = new Container({
      flexDirection: "column",
      alignItems: "flex-start",
      gap: 10,
      marginTop: 16,
      paddingY: 12,
      paddingX: 14,
      flexShrink: 0,
    });
    const card = new CardFace(plate, { fill: ui.white });
    plate.add(card.content);
    this.sectionParts.push(card);
    this.archiveLegend = stack(
      new Text({ text: "", fontSize: 16, fontWeight: 900, letterSpacing: 1, color: ui.ink }),
      1,
    );
    plate.add(this.archiveLegend);
    const shelves = rarityNames.map((name, rarity) => {
      const shelf = new Container({
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        width: "100%",
      });
      shelf.add(stack(rarityTag(name, Object.values(rarityTones)[rarity]!), 1));
      return shelf;
    });
    for (const id of Object.keys(items) as ItemId[]) {
      const button = stack(
        new Container({ alignItems: "center", justifyContent: "center", flexShrink: 0 }),
        1,
      );
      const face = new CardFace(button, { fill: ui.white, border: { color: ui.line, width: 2 } });
      const ring = new OutlineRing(RADIUS, ui.ink, 2.5, 3);
      ring.content.setProperties({ display: "none" });
      const icon = stack(
        new Image({
          src: itemIcon(id),
          width: "78%",
          height: "78%",
          panelMaterialClass: GrayscaleImageMaterial,
        }),
        1,
      );
      // The strike: a white bar across the archived slot.
      const strike = stack(
        new Container({
          positionType: "absolute",
          positionLeft: "46%",
          positionTop: "14%",
          width: "8%",
          height: "72%",
          borderRadius: 2,
          backgroundColor: ui.white,
          transformRotateZ: -45,
        }),
        2,
      );
      button.add(face.content, icon, strike, stack(ring.content, 3));
      shelves[items[id].rarity]!.add(button);
      this.archiveItems.push(button);
      this.sectionParts.push(face, ring);
      const on = () => this.progress.archive.includes(id);
      const full = () => !on() && this.progress.archive.length >= slots;
      const pose = { lift: 0 };
      let target = "";
      const control: Control = {
        kind: "archive",
        panel: button,
        tip: () => (full() ? `${items[id].name} · 档案库已满` : items[id].name),
        locked: full,
        activate: () => {
          if (full()) {
            getAudio().sfx("ui-denied");
            return;
          }
          getAudio().sfx("ui-confirm");
          const archived = this.progress.archive;
          this.callbacks.archive(
            on() ? archived.filter((other) => other !== id) : [...archived, id],
          );
        },
        paint: ({ hovered, focused, focusVisible, pressed }) => {
          const archived = on();
          const keyed = focused && focusVisible;
          ring.content.setProperties({ display: keyed ? "flex" : "none" });
          face.set({
            fill: archived ? ui.ink : ui.white,
            border: archived ? ui.ink : hovered && !full() ? ui.ink : ui.line,
          });
          fade(icon, archived ? 0.4 : 1);
          setGrayscale(icon, archived ? 1 : 0);
          strike.setProperties({ display: archived ? "flex" : "none" });
          fade(button, full() ? 0.45 : 1);
          const lift = full() ? 0 : pressed ? -LIFT.press : hovered ? LIFT.hover : 0;
          const key = `${lift}`;
          if (key === target) return;
          const duration = target === "" ? 0 : LIFT.ms;
          target = key;
          this.stage.motion.animate(
            pose,
            { lift },
            duration,
            () => {
              button.setProperties({ transformTranslateY: -pose.lift });
              face.set({ depth: 2 + pose.lift });
              this.stage.invalidate();
            },
            SNAP,
          );
        },
        update: () => {},
        dispose: () => this.stage.motion.cancel(pose),
      };
      face.set({ depth: 2 });
      this.sectionControls.push(control);
    }
    for (const shelf of shelves) if (shelf.children.length > 1) plate.add(stack(shelf, 1));
    return plate;
  }

  /** Opens a section, as its tab does (the host's prewarm shows 系统 unseen). */
  showSection(id: SectionId): void {
    if (id === this.section) return;
    this.section = id;
    this.buildSection();
  }

  // ── State ──────────────────────────────────────────────────────────────────────────────────

  update(progress: Progress): void {
    const systemChanged =
      archiveSlots(progress) !== archiveSlots(this.progress) && this.section === "system";
    this.progress = progress;
    this.balance.set(progress.stardust);
    if (systemChanged) this.buildSection();
    else this.repaint();
  }

  private repaint(): void {
    for (const [i, control] of this.controls.entries())
      control.paint({
        hovered: i === this.hovered,
        focused: i === this.focused,
        focusVisible: this.focusVisible,
        pressed: i === this.pressed,
      });
    if (this.archiveLegend)
      this.archiveLegend.setProperties({
        text: `档案库 ${this.progress.archive.length}/${archiveSlots(this.progress)}`,
      });
    this.stage.invalidate();
  }

  private applySizes(): void {
    const c = this.compact;
    for (const face of this.tabFaces) face.fitTouch();
    const gap = c ? 8 : 12;
    // Filling the sheet, a card grows its icon and effect with it (most with two columns).
    const size = !this.fills ? 0 : this.gridColumns === 2 ? 2 : 1;
    this.grid.setProperties({ gap: c ? 10 : 16, justifyContent: "center" });
    for (const row of this.tileRows)
      row.setProperties({ gap: c ? 10 : 16, maxHeight: this.fills ? (c ? 150 : 200) : undefined });
    for (const part of this.sized) {
      part.panel.setProperties({
        minHeight: c ? 76 : 112,
        gap: c ? 12 : [18, 20, 26][size],
        paddingY: c ? 10 : 16,
        paddingLeft: c ? 10 : 16,
        paddingRight: c ? 12 : 20,
      });
      const well = c ? [52, 72, 80][size]! : [80, 100, 144][size]!;
      part.well.setProperties({ width: well, height: well });
      part.name.setProperties({ fontSize: c ? [16, 17, 18][size] : [20, 22, 24][size] });
      part.stat.setProperties({ fontSize: c ? 12 : 14 });
      for (const text of [part.value, part.next])
        text.setProperties({ fontSize: c ? [17, 19, 21][size] : [22, 24, 28][size] });
      part.amount.setProperties({ fontSize: c ? 14 : 17 });
      part.price.setProperties({ minHeight: c ? 28 : 34 });
      part.coinSize(c ? 22 : 26);
      part.body.setProperties({ gap: c ? 4 : 8 });
      part.top.setProperties({ gap });
      part.bottom.setProperties({ gap });
      part.pips.setCompact(c);
      part.pipBox.setProperties({ width: part.pips.width(), height: c ? 10 : 12 });
      // The price column is at least as wide as the gauge above it.
      part.priceSlot.setProperties({ minWidth: part.pips.width() });
    }
    const slot = Math.max(c ? 44 : 48, this.stage.viewport.minTarget);
    for (const button of this.archiveItems) button.setProperties({ width: slot, height: slot });
  }

  resize(width: number, height: number, scale: number, safe: UiInsets): void {
    this.stage.resize(width, height, scale, safe);
    const v = this.stage.viewport;
    // A short landscape host (a phone): the UI scale keeps its logical height near the desktop's.
    const compact = height <= 480 && width > height;
    // Short landscape: the segments join the top line, the tiles get the height back.
    if (compact !== this.compact || !this.tabs.parent) {
      this.tabs.removeFromParent();
      if (compact) this.frame.extra.add(stack(this.tabs, 1));
      else this.body.add(stack(this.tabs, 1));
      this.content.removeFromParent();
      this.body.add(stack(this.content, 1));
    }
    this.compact = compact;
    const edge = compact ? 16 : 28;
    this.frame.resize(compact);
    this.frame.extra.setProperties({ gap: compact ? 12 : 18 });
    this.balance.setCompact(compact);
    this.tabs.setProperties({ alignSelf: "flex-start", marginBottom: compact ? 0 : 6 });
    // The sheet's own padding keeps lifts and rings in; the body edge lines up with the top line.
    const inset = 10;
    this.body.setProperties({
      gap: compact ? 0 : 10,
      paddingLeft: Math.max(edge, v.safeArea.left) - inset,
      paddingRight: Math.max(edge, v.safeArea.right) - inset,
      paddingBottom: Math.max(compact ? 4 : 12, v.safeArea.bottom),
    });
    this.tabs.setProperties({ marginLeft: compact ? 0 : inset });
    const columns = this.fitColumns(
      v.width - 2 * Math.max(edge, v.safeArea.left, v.safeArea.right),
    );
    if (columns !== this.columns) {
      this.columns = columns;
      this.buildSection();
      return;
    }
    this.applySizes();
    this.repaint();
  }

  /**
   * Three tiles to a row when each is wide enough for its well, pips-wide price and a partly
   * bought `stat now / → next` (the values wrap between the two), else two. A full-size tile needs
   * 320, a compact one 220.
   */
  private fitColumns(sheetWidth: number): number {
    const c = this.compact;
    const tile = (sheetWidth - 2 * (c ? 8 : 12)) / 3;
    return tile >= (c ? 220 : 320) ? 3 : 2;
  }

  // ── Input ──────────────────────────────────────────────────────────────────────────────────

  private contains(panel: Container, x: number, y: number): boolean {
    const m = panel.globalMatrix.value,
      size = panel.size.value;
    if (!m || !size || !panel.isVisible.value || panel.isClipped.value) return false;
    const v = this.stage.viewport;
    this.point
      .set(x / v.scale + this.stage.camera.left, this.stage.camera.top - y / v.scale, 0)
      .applyMatrix4(this.inverse.copy(m).invert());
    return Math.abs(this.point.x) <= size[0] / 2 && Math.abs(this.point.y) <= size[1] / 2;
  }

  hit(x: number, y: number): number {
    for (let i = this.controls.length - 1; i >= 0; i--) {
      const control = this.controls[i]!;
      // Board controls are only hit inside the board's visible, scrolled area.
      if (
        (control.kind === "tile" || control.kind === "archive") &&
        !this.contains(this.content, x, y)
      )
        continue;
      // A tile still sliding in (under half shown) is not there to press yet.
      const entering = this.entrance[this.tiles.indexOf(control)];
      if (entering && entering.opacity < 0.5) continue;
      if (this.contains(control.panel, x, y)) return i;
    }
    return -1;
  }

  focus(index: number): void {
    if (index === this.focused) return;
    this.focused = index;
    this.reveal();
    this.repaint();
  }

  /** Tiles are a command list for sound: moving onto another buyable tile plays the move. */
  hover(index: number | null): void {
    const next = index ?? -1;
    if (next === this.hovered) return;
    const control = this.controls[next];
    if (control?.kind === "tile" && next !== this.focused && !control.locked())
      getAudio().sfx("ui-move");
    this.hovered = next;
    this.hoveredTip = next >= 0 && this.controls[next]!.tip() ? next : -1;
    this.repaint();
  }

  setPressed(index: number | null): void {
    this.pressed = index ?? -1;
    this.repaint();
  }

  activate(index: number): void {
    this.controls[index]?.activate();
  }

  scroll(delta: number): void {
    const [x, y] = this.content.scrollPosition.value;
    this.content.scrollPosition.value = [
      x,
      Math.max(
        0,
        Math.min(
          this.content.maxScrollPosition.value[1] ?? 0,
          y + delta / this.stage.viewport.scale,
        ),
      ),
    ];
    this.touchTip = -1;
    this.stage.invalidate();
  }

  /** Keeps a focused board control inside the scrolled board. */
  private reveal(): void {
    const control = this.controls[this.focused];
    if (!control || (control.kind !== "tile" && control.kind !== "archive")) return;
    revealInScroller(control.panel, this.content);
  }

  setFocusVisible(visible: boolean): void {
    if (visible === this.focusVisible) return;
    this.focusVisible = visible;
    this.repaint();
  }

  setCoarsePointer(_coarse: boolean): void {}

  /** Tab stops: back, settings, the picked tab, then every tile and archive item in order. */
  private tabStops(): number[] {
    const picked = this.tabControls[sections.findIndex((entry) => entry.id === this.section)]!;
    return this.controls
      .map((control, i) => ({ control, i }))
      .filter(({ control }) => control.kind !== "tab" || control === picked)
      .map(({ i }) => i);
  }

  private tabAt(stops: number[]): number {
    return this.controls[this.focused]?.kind === "tab"
      ? stops.findIndex((i) => this.controls[i]!.kind === "tab")
      : stops.indexOf(this.focused);
  }

  /** The next Tab would wrap: focus sits on the last stop (first, with Shift). */
  tabEdge(shift: boolean): boolean {
    const stops = this.tabStops();
    return this.tabAt(stops) === (shift ? 0 : stops.length - 1);
  }

  navigate(action: NavigationAction): boolean {
    if (this.touchTip >= 0) this.touchTip = -1;
    if (action === "previousPage" || action === "nextPage") {
      const at = sections.findIndex((entry) => entry.id === this.section);
      const next =
        this.tabControls[
          (Math.max(0, at) + (action === "previousPage" ? -1 : 1) + this.tabControls.length) %
            this.tabControls.length
        ]!;
      next.activate();
      this.focus(this.controls.indexOf(next));
      return true;
    }
    const current = this.controls[this.focused];
    if (action === "cancel") {
      this.callbacks.back();
      return true;
    }
    if (action === "next" || action === "previous") {
      const stops = this.tabStops();
      const here = this.tabAt(stops);
      const next =
        here < 0
          ? action === "previous"
            ? stops.length - 1
            : 0
          : (here + (action === "previous" ? -1 : 1) + stops.length) % stops.length;
      this.focus(stops[next]!);
      return true;
    }
    if (!current) {
      // Arrows from nowhere enter the board at its first tile.
      if (isNavigationDirection(action) && this.tiles[0]) {
        this.focus(this.controls.indexOf(this.tiles[0]));
        return true;
      }
      return false;
    }
    if (isNavigationDirection(action)) {
      const next = gridStep(
        this.controls.map((control) => control.panel),
        this.focused,
        action,
      );
      this.focus(next);
      if (current.kind === "tab" && this.controls[next]?.kind === "tab")
        this.controls[next]!.activate();
      return true;
    }
    if (action === "first" || action === "last") {
      const target = action === "first" ? this.tiles[0] : this.tiles.at(-1);
      if (target) this.focus(this.controls.indexOf(target));
      return true;
    }
    if (action === "confirm") {
      current.activate();
      return true;
    }
    return false;
  }

  pointerDown(x: number, y: number, touch: boolean): void {
    const index = this.hit(x, y);
    const tipped = index >= 0 && this.controls[index]!.tip() ? index : -1;
    if (this.touchTip >= 0 && tipped !== this.touchTip) this.touchTip = -1;
    this.tipPress =
      touch && tipped >= 0 ? { index: tipped, at: this.elapsed, x, y, fired: false } : null;
  }

  pointerMove(x: number, y: number): void {
    const press = this.tipPress;
    if (press && !press.fired && Math.hypot(x - press.x, y - press.y) > 10) this.tipPress = null;
  }

  pointerUp(touch: boolean): boolean {
    const press = this.tipPress;
    this.tipPress = null;
    if (!press || !touch) return false;
    if (press.fired) return true;
    if (this.controls[press.index]!.locked())
      this.touchTip = this.touchTip === press.index ? -1 : press.index;
    return false;
  }

  afterLayout(deltaMs: number): void {
    this.elapsed += deltaMs;
    const press = this.tipPress;
    if (press && !press.fired && this.elapsed - press.at >= LONG_PRESS_MS) {
      press.fired = true;
      this.touchTip = press.index;
    }
    const keyed = this.focusVisible && this.controls[this.focused]?.tip() ? this.focused : -1;
    const shown =
      this.touchTip >= 0 ? this.touchTip : this.hoveredTip >= 0 ? this.hoveredTip : keyed;
    const control = this.controls[shown];
    const text = control?.tip() ?? "";
    this.tooltip.show(text ? control!.panel : null, text);
    this.tooltip.update();
    this.frame.update();
    // `grid-template-columns: repeat(columns, minmax(0, 1fr))`: every column an equal share of the
    // sheet, so a short last row keeps the widths above it (flex growth let content widen it).
    // From the content box as laid out (before edges snap), so the columns and gaps fill it exactly.
    const inner = this.sheet.node.layoutInner.value?.[0];
    if (inner !== undefined) {
      const gap = this.compact ? 10 : 16;
      const n = this.gridColumns;
      const column = Math.max(0, (inner - (n - 1) * gap) / n);
      if (column !== this.column) {
        this.column = column;
        for (const row of this.tileRows)
          for (const cell of row.children)
            (cell as Container).setProperties({
              width: column,
              flexBasis: column,
              flexGrow: 0,
              flexShrink: 0,
            });
        this.stage.invalidate();
      }
    }
    this.fullscreen.fitTouch();
    for (const c of this.controls) c.update(deltaMs);
  }

  releaseUploads(): void {
    this.stage.releaseUploads();
  }

  dispose(): void {
    for (const control of this.sectionControls) control.dispose();
    for (const part of [...this.sectionParts, ...this.disposables]) part.dispose();
    this.balance.dispose();
    this.fullscreen.dispose();
    this.frame.dispose();
    this.tooltip.dispose();
    this.stage.dispose();
  }
}

/**
 * The level gauge: one 9 × 12 cell per level (7 × 10 when compact) with 3px (2px) gaps; a bought
 * level is an ink bar, one still to buy a small line-coloured dot, so an empty gauge reads as a
 * track, never as a row of blank boxes.
 */
class PipStrip {
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
  private readonly material: UiShaderMaterial<{
    stripSize: { value: Vector2 };
    lit: { value: number };
    count: { value: number };
    cell: { value: Vector2 };
    gap: { value: number };
    opacity: { value: number };
  }>;
  private readonly max: number;
  private compact = false;

  constructor(max: number) {
    this.max = max;
    this.material = new UiShaderMaterial("lab-pips", {
      uniforms: {
        stripSize: { value: new Vector2(1, 1) },
        lit: { value: 0 },
        count: { value: max },
        cell: { value: new Vector2(9, 12) },
        gap: { value: 3 },
        opacity: { value: 1 },
      },
      vertexShader: `
        varying vec2 pipUv;
        ${clipVertex}
        void main() { pipUv = uv; ${clipMain} }`,
      fragmentShader: `
        uniform vec2 stripSize, cell;
        uniform float lit, count, gap, opacity;
        varying vec2 pipUv;
        vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
        float roundBox(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
        #include <clipping_planes_pars_fragment>
        void main() {
          #include <clipping_planes_fragment>
          vec2 p = vec2(pipUv.x, 1. - pipUv.y) * stripSize;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          float i = floor(p.x / (cell.x + gap));
          float x = p.x - i * (cell.x + gap);
          if (i >= count || x > cell.x) discard;
          vec2 q = vec2(x, p.y) - cell * .5;
          float t = p.y / cell.y;
          vec3 col;
          float d;
          if (i < lit) {
            d = roundBox(q, cell * .5, 2.);
            col = ${glsl(ui.ink)};
          } else {
            d = length(q) - cell.x * .32;
            col = ${glsl(ui.line)};
          }
          gl_FragColor = vec4(toLinear(col), opacity * (1. - smoothstep(-aa, aa, d)));
          #include <colorspace_fragment>
        }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  set(level: number): void {
    this.material.uniforms.lit.value = level;
  }

  setCompact(compact: boolean): void {
    this.compact = compact;
    this.material.uniforms.cell.value.set(compact ? 7 : 9, compact ? 10 : 12);
    this.material.uniforms.gap.value = compact ? 2 : 3;
  }

  width(): number {
    const cell = this.compact ? 7 : 9,
      gap = this.compact ? 2 : 3;
    return this.max * cell + (this.max - 1) * gap;
  }

  update(): void {
    const s = this.content.size.value;
    if (s) this.material.uniforms.stripSize.value.set(s[0], s[1]);
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** The 星星沙子 balance: the coin and the banked amount on an upright ink chip; it pops on change. */
class Balance {
  readonly root = new Container({
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    borderRadius: RADIUS,
  });
  private readonly face = new CardFace(this.root, { fill: ui.ink });
  private readonly coin = stack(new Image({ src: CURRENCY_ICON, flexShrink: 0 }), 1);
  private readonly amount = stack(
    new Text({ text: "", fontWeight: 900, color: ui.white, lineHeight: 1.2 }),
    1,
  );
  private readonly pose = { scale: 1 };
  private readonly stage: UiStage;
  private value: number | null = null;

  constructor(stage: UiStage) {
    this.stage = stage;
    this.face.set({ depth: 2 });
    this.root.add(this.face.content, this.coin, this.amount);
  }

  setCompact(compact: boolean): void {
    this.root.setProperties({
      height: compact ? 36 : 44,
      gap: compact ? 4 : 6,
      paddingLeft: compact ? 4 : 6,
      paddingRight: compact ? 10 : 14,
    });
    this.coin.setProperties({ width: compact ? 26 : 32, height: compact ? 26 : 32 });
    this.amount.setProperties({ fontSize: compact ? 16 : 19 });
  }

  set(value: number): void {
    if (value === this.value) return;
    const first = this.value === null;
    this.value = value;
    this.amount.setProperties({ text: prices.format(value) });
    if (first) return;
    this.stage.motion.enter(
      this.pose,
      { scale: 1.25 },
      { scale: 1 },
      240,
      () => {
        this.amount.setProperties({
          transformScaleX: this.pose.scale,
          transformScaleY: this.pose.scale,
        });
        this.stage.invalidate();
      },
      POP,
    );
  }

  dispose(): void {
    this.stage.motion.cancel(this.pose);
    this.face.dispose();
  }
}
