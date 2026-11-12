import { FullscreenIcon } from "./fullscreen-icon";
import { isNavigationDirection, type NavigationAction } from "../../platform/input";
import { revealInScroller } from "./scroll-reveal";
import { Container, Content, Image, Text, withOpacity, type FontFamilies } from "@pmndrs/uikit";
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
import { BoxShadow, OutlineRing } from "./box-shadow";
import { CURRENCY_ICON, GpuCurrency } from "./currency";
import { gridStep } from "./grid-nav";
import { uiEaseOut } from "./focus-mark";
import { GameButton } from "./game-button";
import { GrayscaleImageMaterial, setGrayscale } from "./grayscale-image";
import { HoverPattern } from "./hover-pattern";
import { createMenuIcon } from "./icons";
import { InnerScreenFrame } from "./inner-screen";
import { fade, stack } from "./layer";
import { RunButtonSurface } from "./run-overlays-surface";
import { clipMain, clipVertex, HatchFill, InsetShade, RadialFace } from "./screen-parts";
import { SegmentFace } from "./segment-face";
import { ellipsize } from "./text-fit";
import { UiStage } from "./stage";
import { GpuTooltip } from "./tooltip";
import { UiShaderMaterial } from "./ui-shader";
import type { UiInsets } from "./viewport";

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

const NAVY = "#142f50",
  NAVY_DEEP = "#0d233f",
  INK = "#142f50",
  MUTED = "#536b82",
  SURFACE = "#e9f4fb",
  YELLOW = "#ffd45b",
  SUCCESS = "#287a58",
  // `color-mix(in srgb, var(--success) 14%, var(--surface))`
  MAXED_FACE = "#cee3e4";
const LONG_PRESS_MS = 450;
const prices = new Intl.NumberFormat("zh-CN");

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
 * screens/Lab.tsx on the GPU (DESIGN.md › 研究所): the top line with the 星星沙子 balance, the section tabs,
 * and a board window whose upgrade tiles fill it three to a row (two where three would be too narrow). A tile is the buy button: icon,
 * name, level pips, `stat now → next` and its price (gold, hatched when short, success when maxed).
 * 系统 adds the 档案库, every item as a toggle that strikes it out of runs.
 */
export class GpuLab {
  readonly stage = new UiStage();
  /** Tabs, three tile columns and the board need a landscape phone's room at least. */
  readonly minLayout = { width: 760, height: 320 };
  private readonly callbacks: LabCallbacks;
  private readonly frame: InnerScreenFrame;
  private readonly balance: GpuCurrency;
  private readonly body = new Container({ flexGrow: 1, minHeight: 0, flexDirection: "column" });
  private readonly tabs = new Container({ flexDirection: "row", flexShrink: 0 });
  private readonly board = new Container({
    flexGrow: 1,
    minHeight: 0,
    flexDirection: "column",
    borderColor: NAVY_DEEP,
    borderRadius: 10,
  });
  private readonly content = new Container({
    flexGrow: 1,
    minHeight: 0,
    flexDirection: "column",
    overflow: "scroll",
    scrollbarWidth: 3,
    scrollbarColor: NAVY,
  });
  private readonly boardFace = new BoardFace();
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

  constructor(fonts: FontFamilies, backdrop: Texture, progress: Progress, callbacks: LabCallbacks) {
    this.callbacks = callbacks;
    this.progress = progress;
    this.stage.root.setProperties({ fontFamilies: fonts, flexDirection: "column", color: INK });
    this.tooltip = new GpuTooltip(this.stage);
    this.frame = new InnerScreenFrame(this.stage, backdrop, "研究所");
    this.balance = new GpuCurrency(this.stage);
    this.balance.set(progress.stardust);
    this.frame.extra.add(this.balance.root);
    this.stage.root.add(this.frame.topline, this.frame.body);
    this.frame.body.add(this.body);
    this.body.add(this.tabs, this.board);
    const boardShadow = new BoxShadow(10, [
      { y: 5, blur: 0, color: NAVY_DEEP, alpha: 1 },
      { y: 12, blur: 32, color: NAVY_DEEP, alpha: 0.25 },
    ]);
    this.disposables.push(boardShadow, this.boardFace);
    this.board.add(
      boardShadow.content,
      this.boardFace.content,
      stack(
        new Container({
          positionType: "absolute",
          positionLeft: 0,
          positionTop: 0,
          width: "100%",
          height: "100%",
          borderWidth: 1,
          borderRadius: 7,
          borderColor: YELLOW,
        }),
        3,
      ),
      stack(this.content, 1),
    );
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
      tone: "navy",
      size: "small",
      square: true,
      icon: this.fullscreenIcon,
    });
    this.fullscreen.panel.setProperties({ display: "none" });
    this.frame.topline.add(this.fullscreen.panel);
    this.fullscreenControl = this.keyControl("fullscreen", this.fullscreen, () =>
      this.toggleFullscreen?.(),
    );
    this.buildTabs();
    this.buildSection();
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

  /** The section SegmentedControl: its legend only names it for screen readers, so none shows. */
  private buildTabs(): void {
    const tray = this.tabs;
    tray.setProperties({
      width: "100%",
      gap: 4,
      padding: 4,
      borderWidth: 2,
      borderColor: NAVY,
      borderRadius: 10,
      backgroundColor: NAVY_DEEP,
    });
    // inset 0 3px 0 rgb(0 0 0 / 35%): the tray's lip.
    tray.add(
      new Container({
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 0,
        width: "100%",
        height: 3,
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
        backgroundColor: withOpacity("#000000", 0.35),
      }),
    );
    for (const entry of sections) {
      const face = new SegmentFace(this.stage, entry.name);
      this.tabFaces.push(face);
      face.panel.setProperties({ flexGrow: 1, flexBasis: 0, minWidth: 0 });
      tray.add(face.panel);
      this.disposables.push(face);
      const control: Control = {
        kind: "tab",
        panel: face.panel,
        tip: () => null,
        locked: () => false,
        activate: () => {
          if (this.section === entry.id) return;
          this.section = entry.id;
          this.buildSection();
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

  private tileRows: Container[] = [];
  private column = 0;
  /** Tiles to a row: three while a tile keeps its values clear of the price, else two. */
  private columns = 3;
  private readonly tiles: Control[] = [];

  private buildSection(): void {
    for (const control of this.sectionControls) control.dispose();
    for (const part of this.sectionParts.splice(0)) part.dispose();
    for (const child of this.content.children.slice()) {
      child.removeFromParent();
      (child as { dispose?: () => void }).dispose?.();
    }
    this.sectionControls = [];
    this.tiles.length = 0;
    this.tileRows = [];
    this.column = 0;
    const current = sections.find((entry) => entry.id === this.section)!;
    // `columns` to a row, filled from the top; the last row keeps its column widths. `.lab-tiles`:
    // rows 8 apart (`gap: space-2 space-3`), at every size.
    const grid = new Container({ flexDirection: "column", flexShrink: 0, gap: 8 });
    this.content.add(grid);
    for (let i = 0; i < current.items.length; i += this.columns) {
      const row = new Container({ flexDirection: "row", flexShrink: 0 });
      for (let j = 0; j < this.columns; j++) {
        const id = current.items[i + j];
        if (id) row.add(this.tile(labItem(id)));
        else row.add(new Container({ flexGrow: 1, flexBasis: 0, minWidth: 0 }));
      }
      this.tileRows.push(row);
      grid.add(row);
    }
    const slots = archiveSlots(this.progress);
    if (this.section === "system" && slots > 0) this.content.add(this.archive(slots));
    this.controls = [...this.fixed, ...this.tabControls, ...this.sectionControls];
    this.focused = Math.min(this.focused, this.controls.length - 1);
    this.applySizes();
    this.repaint();
  }

  /** `.lab-tile`: one raised plate per upgrade; the whole plate buys the next level. */
  private tile(item: LabItem): Container {
    const panel = new Container({
      flexDirection: "row",
      alignItems: "center",
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 0,
      borderWidth: 2,
      borderColor: NAVY,
      borderRadius: 8,
    });
    const shadow = new BoxShadow(8, [{ y: 3, blur: 0, color: NAVY_DEEP, alpha: 1 }]);
    const plate = new RunButtonSurface();
    // `:active`: `inset 0 3px 0 rgb(13 35 63 / 14%)` in place of the base.
    const pressShade = new InsetShade(3, NAVY_DEEP, 0.14, 6);
    fade(pressShade.content, 0);
    const pattern = new HoverPattern(this.stage.motion, () => this.stage.invalidate(), SURFACE);
    const ring = new OutlineRing(8, "#2165a4", 3, 3);
    ring.content.setProperties({ display: "none" });
    const well = stack(
      new Container({ flexShrink: 0, alignItems: "center", justifyContent: "center" }),
      1,
    );
    const wellFace = new RadialFace({
      at: [0.5, 0.4],
      inner: "#ffffff",
      middle: "#d8effb",
      mid: 0.75,
      radius: 8,
      ring: { width: 1.5, color: "#92b8d1" },
    });
    well.add(
      wellFace.content,
      stack(new Image({ src: `/art/icons/lab/${item.id}.webp`, width: "86%", height: "86%" }), 1),
    );
    const body = stack(
      new Container({ flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 2 }),
      1,
    );
    const top = new Container({ flexDirection: "row", alignItems: "flex-end", gap: 12 });
    const name = new Text({ text: item.name, fontWeight: 800, lineHeight: 1.2, color: INK });
    name.setProperties({ flexGrow: 1, flexShrink: 1, minWidth: 0, whiteSpace: "pre" });
    const pips = new PipStrip(item.max);
    const pipBox = new Container({ flexShrink: 0 });
    pipBox.add(pips.content);
    top.add(name, pipBox);
    const bottom = new Container({ flexDirection: "row", alignItems: "flex-start", gap: 12 });
    const effectRow = new Container({
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 4,
      flexGrow: 1,
      minWidth: 0,
    });
    const stat = new Text({ text: item.stat, fontWeight: 700, color: MUTED, lineHeight: 1.2 });
    stat.setProperties({ flexShrink: 0 });
    // `.lab-tile__effect`. A partly bought upgrade's now → next can be wider than its column at the
    // smallest scale: it wraps between the two (「+24%」/「→ +32%」), the arrow kept with its value.
    const value = new Text({ text: "", fontWeight: 800, color: INK, lineHeight: 1.2 });
    const next = new Text({ text: "", fontWeight: 800, color: INK, lineHeight: 1.2 });
    // Each is one unbreakable unit (uikit's keep-all never wraps): 「→ +N」 broke at its space when
    // its column was narrower. The row wraps whole units.
    value.setProperties({ wordBreak: "keep-all", flexShrink: 0 });
    next.setProperties({ wordBreak: "keep-all", flexShrink: 0, display: "none" });
    const values = new Container({
      flexDirection: "row",
      flexWrap: "wrap",
      gapColumn: 4,
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
    });
    values.add(value, next);
    effectRow.add(stat, values);
    // `.lab-tile__price`: gold when affordable, hatched when short, a success chip when maxed.
    const price = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: 28,
      paddingLeft: 4,
      paddingRight: 8,
      borderWidth: 2,
      borderRadius: 8,
      flexShrink: 0,
    });
    const priceSheen = new RunButtonSurface();
    const priceHatch = new HatchFill(0.5, 6);
    const priceShadow = new BoxShadow(8, [{ y: 2, blur: 0, color: NAVY_DEEP, alpha: 1 }]);
    const coin = stack(
      new Image({
        src: CURRENCY_ICON,
        width: 20,
        height: 20,
        flexShrink: 0,
        panelMaterialClass: GrayscaleImageMaterial,
      }),
      1,
    );
    const check = createMenuIcon("check");
    check.setProperties({ width: 16, height: 16, color: "#ffffff" });
    const amount = stack(new Text({ text: "", fontWeight: 800, lineHeight: 1.2 }), 1);
    price.add(priceShadow.content, priceSheen.content, priceHatch.content);
    price.add(coin, stack(check, 1), amount);
    // The plate is as wide as its coin and amount, centred under the pips (the column is the
    // pips' width): never stretched to the gauge.
    const priceSlot = new Container({
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "flex-start",
      flexShrink: 0,
    });
    priceSlot.add(price);
    bottom.add(effectRow, priceSlot);
    body.add(top, bottom);
    panel.add(shadow.content, plate.content, pressShade.content, pattern.content);
    panel.add(well, body, stack(ring.content, 3));
    this.sectionParts.push(
      shadow,
      plate,
      pressShade,
      pattern,
      ring,
      wellFace,
      pips,
      priceSheen,
      priceHatch,
      priceShadow,
    );
    const level = () => this.progress.lab[item.id] ?? 0;
    const lock = () => labLock(item, level(), this.progress.stardust);
    const pose = { y: 0, press: 0, depth: 3 };
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
        pattern.setFocused(hovered || (focused && focusVisible));
        panel.setProperties({ backgroundColor: state === "maxed" ? MAXED_FACE : SURFACE });
        pips.set(now);
        const [current, following] = effect(item, now);
        value.setProperties({ text: current });
        next.setProperties({ text: following ?? "", display: following ? "flex" : "none" });
        amount.setProperties({
          text: cost === null ? "满级" : prices.format(cost),
          color: state === "maxed" ? "#ffffff" : state === "short" ? "#3e566d" : NAVY_DEEP,
        });
        coin.setProperties({ display: cost === null ? "none" : "flex" });
        setGrayscale(coin, state === "short" ? 0.7 : 0);
        check.setProperties({ display: cost === null ? "flex" : "none" });
        price.setProperties({
          borderColor: state === "maxed" ? SUCCESS : state === "short" ? "#9fb5c7" : NAVY,
          backgroundColor: state === "maxed" ? SUCCESS : state === "short" ? "#d0dfeb" : YELLOW,
        });
        priceSheen.content.setProperties({ display: state === "ready" ? "flex" : "none" });
        priceShadow.content.setProperties({ display: state === "ready" ? "flex" : "none" });
        priceHatch.content.setProperties({ display: state === "short" ? "flex" : "none" });
        // Hover lifts a buyable tile 2px onto a 5px base; a press sinks it onto the base.
        const lift = state === "ready" && hovered && !pressed;
        const press = state === "ready" && pressed;
        this.stage.motion.animate(
          pose,
          { y: press ? 3 : lift ? -2 : 0, press: press ? 1 : 0, depth: press ? 0 : lift ? 5 : 3 },
          press ? 60 : 140,
          () => {
            panel.setProperties({
              transformTranslateY: pose.y,
              transformScaleX: 1 + 0.006 * pose.press,
              transformScaleY: 1 - 0.02 * pose.press,
            });
            shadow.set([
              { y: pose.depth, blur: 0, color: NAVY_DEEP, alpha: pose.depth > 0 ? 1 : 0 },
            ]);
            fade(pressShade.content, pose.press);
            this.stage.invalidate();
          },
          uiEaseOut,
        );
      },
      update: (deltaMs) => {
        pressShade.update();
        const fitted = ellipsize(name, item.name);
        if (fitted !== undefined && fitted !== name.properties.value.text)
          name.setProperties({ text: fitted });
        plate.update();
        priceSheen.update();
        priceHatch.update();
        wellFace.update();
        pips.update();
        pattern.update(deltaMs);
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
  }[] = [];

  private archiveItems: Container[] = [];
  private archiveLegend: Text | null = null;

  /** `.lab-archive`: every item as a toggle, in rows by card tier (the 图鉴's order: about 120
   *  items read as four short shelves, not one long run); archived ones are struck out of runs. */
  private archive(slots: number): Container {
    const plate = new Container({
      flexDirection: "column",
      alignItems: "flex-start",
      gap: 8,
      paddingY: 8,
      paddingX: 12,
      borderWidth: 2,
      borderColor: NAVY,
      borderRadius: 8,
      backgroundColor: SURFACE,
      flexShrink: 0,
    });
    const sheen = new RunButtonSurface();
    const shadow = new BoxShadow(8, [{ y: 3, blur: 0, color: NAVY_DEEP, alpha: 1 }]);
    plate.add(shadow.content, sheen.content);
    this.sectionParts.push(sheen, shadow);
    this.archiveLegend = stack(
      new Text({ text: "", fontSize: 16, fontWeight: 800, color: INK, marginRight: 8 }),
      1,
    );
    plate.add(this.archiveLegend);
    this.archiveItems = [];
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
        new Container({
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2,
          borderColor: NAVY,
          borderRadius: 8,
          flexShrink: 0,
        }),
        1,
      );
      const face = new RadialFace({
        at: [0.5, 0.38],
        inner: "#ffffff",
        middle: "#d8effb",
        mid: 0.72,
        outer: "#bcd8ea",
        radius: 6,
        ring: { width: 2, color: "#eef5fa" },
      });
      const buttonShadow = new BoxShadow(8, [{ y: 2, blur: 0, color: NAVY_DEEP, alpha: 1 }]);
      // Archived: `inset 0 3px 0 rgb(0 0 0 / 35%)`, a sunk socket.
      const lip = new InsetShade(3, "#000000", 0.35, 6);
      const pattern = new HoverPattern(this.stage.motion, () => this.stage.invalidate(), SURFACE);
      const ring = new OutlineRing(8, YELLOW, 3, 2);
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
      // The strike: a warm bar across the socket.
      const strike = stack(
        new Container({
          positionType: "absolute",
          positionLeft: "46%",
          positionTop: "18%",
          width: "8%",
          height: "64%",
          borderRadius: 2,
          backgroundColor: YELLOW,
          transformRotateZ: -45,
        }),
        2,
      );
      button.add(
        buttonShadow.content,
        face.content,
        lip.content,
        pattern.content,
        icon,
        strike,
        stack(ring.content, 3),
      );
      shelves[items[id].rarity]!.add(button);
      this.archiveItems.push(button);
      this.sectionParts.push(face, buttonShadow, lip, pattern, ring);
      const on = () => this.progress.archive.includes(id);
      const full = () => !on() && this.progress.archive.length >= slots;
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
        paint: ({ hovered, focused, focusVisible }) => {
          const pressed = on();
          ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
          // Archived is its picked state: lit like a hovered slot, inked for the sunk navy socket.
          pattern.setSurface(pressed ? NAVY : SURFACE);
          pattern.setFocused((pressed || hovered || (focused && focusVisible)) && !full());
          face.content.setProperties({ display: pressed ? "none" : "flex" });
          button.setProperties({
            backgroundColor: pressed ? NAVY : undefined,
            borderColor: pressed ? NAVY_DEEP : NAVY,
          });
          buttonShadow.content.setProperties({ display: pressed ? "none" : "flex" });
          fade(icon, pressed ? 0.4 : 1);
          setGrayscale(icon, pressed ? 1 : 0);
          lip.content.setProperties({ display: pressed ? "flex" : "none" });
          strike.setProperties({ display: pressed ? "flex" : "none" });
          fade(button, full() ? 0.45 : 1);
        },
        update: (deltaMs) => {
          face.update();
          lip.update();
          pattern.update(deltaMs);
        },
        dispose: () => {},
      };
      this.sectionControls.push(control);
    }
    for (const shelf of shelves) if (shelf.children.length > 1) plate.add(shelf);
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
    this.content.setProperties({ gap: c ? 8 : 12, padding: c ? 8 : 12 });
    for (const row of this.tileRows) row.setProperties({ gap: c ? 8 : 12 });
    for (const part of this.sized) {
      part.panel.setProperties({
        minHeight: c ? 60 : 72,
        gap: c ? 8 : 12,
        paddingY: c ? 4 : 8,
        paddingLeft: c ? 4 : 8,
        paddingRight: c ? 8 : 12,
      });
      part.well.setProperties({ width: c ? 40 : 56, height: c ? 40 : 56 });
      part.name.setProperties({ fontSize: c ? 15 : 18 });
      for (const text of [part.stat, part.value, part.next, part.amount])
        text.setProperties({ fontSize: c ? 13 : 15 });
      part.top.setProperties({ gap: c ? 8 : 12 });
      part.bottom.setProperties({ gap: c ? 8 : 12 });
      part.pips.setCompact(c);
      part.pipBox.setProperties({
        width: part.pips.width(),
        height: c ? 10 : 12,
      });
      // Grid column `auto` shared with the pips: the column is at least as wide as the gauge.
      part.priceSlot.setProperties({ minWidth: part.pips.width() });
    }
    for (const button of this.archiveItems)
      button.setProperties({ width: c ? 34 : 40, height: c ? 34 : 40 });
  }

  resize(width: number, height: number, scale: number, safe: UiInsets): void {
    this.stage.resize(width, height, scale, safe);
    const v = this.stage.viewport;
    this.compact = v.height <= 480 && v.width > v.height;
    const edge = this.compact ? 16 : 28;
    this.frame.resize(this.compact);
    this.body.setProperties({
      gap: this.compact ? 8 : 12,
      paddingLeft: Math.max(edge, v.safeArea.left),
      paddingRight: Math.max(edge, v.safeArea.right),
      paddingBottom: Math.max(this.compact ? 12 : 20, v.safeArea.bottom),
    });
    this.board.setProperties({ borderWidth: this.compact ? 2 : 3 });
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
   * Three tiles to a row when each is wide enough for its well, pips-wide price and a
   * partly bought `stat now / → next` (the values wrap between the two), else two. Measured at the
   * widest values today (「伤害 +12% / → +16%」): a full-size tile needs 300 (320 with room for
   * longer values), a compact one 200 (1280×800 at 150% gives 248, 1440×900 283, phones 225–240).
   */
  private fitColumns(boardWidth: number): number {
    const c = this.compact;
    const inner = boardWidth - 2 * (c ? 2 : 3) - 2 * (c ? 8 : 12);
    const tile = (inner - 2 * (c ? 8 : 12)) / 3;
    return tile >= (c ? 200 : 320) ? 3 : 2;
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
    this.boardFace.update();
    // `grid-template-columns: repeat(columns, minmax(0, 1fr))`: every column an equal share of the
    // board, so a short last row keeps the widths above it (flex growth let content widen it).
    // From the content box as laid out (before edges snap), so the columns and gaps fill it exactly.
    const inner = this.content.node.layoutInner.value?.[0];
    if (inner !== undefined) {
      const gap = this.compact ? 8 : 12;
      const n = this.columns;
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
 * `.lab-board`'s face: ice under `repeating-linear-gradient(-55deg, rgb(20 47 80 / 3%) 0 2px,
 * transparent 2px 8px)`, with `inset 0 4px 8px rgb(13 35 63 / 12%)` along the top.
 */
class BoardFace {
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
  private readonly material = new UiShaderMaterial("lab-board", {
    uniforms: { boardSize: { value: new Vector2(1, 1) }, opacity: { value: 1 } },
    vertexShader: `
      varying vec2 boardUv;
      void main() { boardUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `
      uniform vec2 boardSize;
      uniform float opacity;
      varying vec2 boardUv;
      vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
      float roundBox(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
      void main() {
        vec2 p = vec2(boardUv.x, 1. - boardUv.y) * boardSize;
        float aa = .5 * max(fwidth(p.x), fwidth(p.y));
        float box = roundBox(p - boardSize * .5, boardSize * .5, 7.);
        vec3 col = vec3(.847, .937, .984);
        float m = mod(dot(p, vec2(.819152, .573576)), 8.);
        col = mix(col, vec3(.078, .184, .314), .03 * (1. - smoothstep(2. - aa, 2. + aa, m)));
        col = mix(col, vec3(.051, .137, .247), .12 * exp(-p.y / 5.));
        gl_FragColor = vec4(toLinear(col), opacity * (1. - smoothstep(-aa, aa, box)));
        #include <colorspace_fragment>
      }`,
  });

  constructor() {
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  update(): void {
    const s = this.content.size.value;
    if (s) this.material.uniforms.boardSize.value.set(s[0], s[1]);
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * `.lab-tile__pips`: one 9 × 12 cell per level (7 × 10 when compact) with 3px (2px) gaps; a bought
 * level is a gold segment with a navy ring, one still to buy a small recessed slate dot.
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
            // A bought level: a gold segment in a navy ring.
            d = roundBox(q, cell * .5, 2.);
            vec3 face = t < .55 ? mix(vec3(1., .902, .561), vec3(1., .831, .357), t / .55) : mix(vec3(1., .831, .357), vec3(.949, .71, .165), (t - .55) / .45);
            col = mix(face, vec3(.078, .184, .314), smoothstep(-1.5 - aa, -1.5 + aa, d));
          } else {
            // A level still to buy: a small dot sunk into the plate (shaded at its top edge), so an
            // empty gauge reads as a track, never as a row of blank boxes.
            float r = cell.x * .36;
            d = length(q) - r;
            col = mix(vec3(.333, .443, .553), vec3(.659, .757, .839), smoothstep(-r, r, q.y));
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
