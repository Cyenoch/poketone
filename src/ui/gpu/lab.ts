import { FullscreenIcon } from "./fullscreen-icon";
import { isNavigationDirection, type NavigationAction } from "../../platform/input";
import { revealInScroller } from "./scroll-reveal";
import { Container, Image, Text, type FontFamilies } from "@pmndrs/uikit";
import { Matrix4, Vector3, type Texture, type WebGLRenderer } from "three";
import { getAudio } from "../../audio/engine";
import {
  codexEntry,
  enemyKey,
  researchedEntry,
  researchGroups,
  researchView,
} from "../../run/codex";
import { labTerms } from "../../run/glossary";
import { bondLabItems, labItem, nextCost, type LabItem } from "../../run/lab";
import { labLock } from "../../run/locks";
import { archiveSlots, type Progress } from "../../run/progress";
import { researchOf, researchedCount } from "../../run/research";
import { abilities } from "../../run/sim/content/abilities";
import { bondLevel } from "../../run/sim/content/bonds";
import { starters } from "../../run/sim/content/lines/index";
import { BOND_LAB_LEVEL } from "../../run/sim/content/params/bonds";
import { badgeIds, badges, type BadgeId } from "../../run/sim/content/badges";
import { difficulties } from "../../run/sim/content/difficulties";
import { enemies, type EnemyId } from "../../run/sim/content/enemies";
import { fieldEventDefs } from "../../run/sim/content/events";
import { items, type ItemId } from "../../run/sim/content/items";
import { type LabId } from "../../run/sim/content/lab";
import { routeMarkers } from "../../run/sim/content/route";
import { rules } from "../../run/sim/content/rules";
import { sites } from "../../run/sim/content/sites";
import type { UnlockDef } from "../../run/sim/content/unlocks";
import { rarityNames } from "../../run/sim/upgrades";
import { unlockStatus } from "../../run/unlocks";
import { itemIcon } from "../../screens/runArt";
import { OutlineRing } from "./box-shadow";
import { badgeMedal, ruleIcon } from "./challenge-rules";
import { portraitSrc } from "./ball";
import { createArt } from "./codex-parts";
import { CodexThumbs } from "./codex-model";
import { CURRENCY_ICON } from "./currency";
import { CardFace } from "./dialog-surface";
import { GameButton } from "./game-button";
import { GrayscaleImageMaterial, setGrayscale } from "./grayscale-image";
import { gridStep } from "./grid-nav";
import { createMenuIcon, type MenuIconName } from "./icons";
import { InnerScreenFrame } from "./inner-screen";
import { LabBackdrop, CASE_HOLES, places, type Place } from "./lab-scene";
import { fade, stack } from "./layer";
import { EASE, LIFT, POP, SNAP, stagger } from "./motion";
import { researchGauge } from "./research-parts";
import { rarityTones } from "./run-choice-surface";
import { SegmentFace, segmentTray } from "./segment-face";
import { disposeTree, UiStage } from "./stage";
import { rarityTag } from "./tag";
import { ellipsize } from "./text-fit";
import { TickGauge } from "./tick-gauge";
import { GpuTooltip } from "./tooltip";
import { HARD_SHADOW, RADIUS, RADIUS_INNER, ui } from "./tokens";
import type { UiInsets } from "./viewport";

export type { Place } from "./lab-scene";
export type Binder = "research" | "unlocks" | "bonds";

/** Where the 研究所 was left: the place, its open binder and the picked species, if any. */
export interface LabAt {
  place: Place;
  binder: Binder;
  key?: string;
}

export interface LabCallbacks {
  buy(id: LabId): void;
  archive(archive: ItemId[]): void;
  /** Opens a 图鉴 entry; coming back restores `at`. */
  codex(key: string, at: LabAt): void;
  back(): void;
  settings(): void;
}

const placeLooks: Record<Place, { name: string; icon: MenuIconName }> = {
  shelf: { name: "书架", icon: "binder" },
  bench: { name: "实验台", icon: "flask" },
  badges: { name: "徽章盒", icon: "case" },
};

const binders: readonly { id: Binder; name: string; icon: MenuIconName }[] = [
  { id: "research", name: "图鉴研究", icon: "eye" },
  { id: "unlocks", name: "解锁", icon: "lock" },
  { id: "bonds", name: "羁绊", icon: "heart" },
];

/** The bench's instruments; the 档案库 and 背包 nodes live in its drawer. */
const benchGroups: readonly { name: string; items: readonly LabId[] }[] = [
  { name: "战斗", items: ["dmg", "hp", "armor", "regen"] },
  { name: "输出", items: ["crit", "atkspd", "area", "ult"] },
  { name: "机动与经济", items: ["spd", "xp", "gold", "magnet", "luck"] },
  {
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
    ],
  },
];
const drawerItems: readonly LabId[] = ["archive", "bag"];

const LONG_PRESS_MS = 450;
const prices = new Intl.NumberFormat("zh-CN");
/** Controls that rise in one after another when a place opens; the rest come with the last. */
const STAGGERED = 12;
/** The case's dark wells. */
const WELL = "#0c0d14";

/** `当前 → 下一级`; level 0 shows only the next value, a maxed item only its current one. */
function effect(item: LabItem, level: number): [string, string | null] {
  const now = item.value(item.per * level);
  if (level >= item.max) return [now, null];
  const next = item.value(item.per * (level + 1));
  return level === 0 ? [next, null] : [now, `→ ${next}`];
}

type Content = UnlockDef["content"];
/** What an unlock opens; a species the player has never seen stays ？？？. */
function contentName(content: Content, dex: Progress["dex"]): string {
  if ("site" in content) {
    const species = content.species;
    if (!species) return sites[content.site].name;
    const name = researchView(dex, species) === "unseen" ? "？？？" : enemies[species].name;
    return `${sites[content.site].name} · ${name}`;
  }
  if ("event" in content) return fieldEventDefs[content.event].name;
  if ("marker" in content) return routeMarkers[content.marker].name;
  if ("ability" in content) return abilities[content.ability].name;
  return rules[content.rule].name;
}
function contentIcon(content: Content) {
  if ("rule" in content) return ruleIcon(content.rule);
  return createMenuIcon(
    "site" in content
      ? "pin"
      : "event" in content
        ? "event"
        : "marker" in content
          ? "arrow"
          : "ability",
  );
}

type Kind =
  | "fullscreen"
  | "back"
  | "settings"
  | "spot"
  | "place"
  | "spine"
  | "cell"
  | "unlock"
  | "tile"
  | "drawer"
  | "archive"
  | "badge";
/** Controls inside the open place's scrolled pane: only hit where the pane shows them. */
const scrolled = new Set<Kind>(["cell", "unlock", "tile", "drawer", "archive"]);

interface Control {
  kind: Kind;
  panel: Container;
  /** A spot's place, a spine's binder, a cell's species, an unlock, an instrument, an item, a
   *  badge: what keeps focus when the place is rebuilt. */
  key?: string;
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
 * The 研究所 (DESIGN.md › 研究所, `.impeccable/surfaces/src-ui-gpu-lab-ts.md`): the room is the
 * menu. The lab art fills the view; its three places (书架, 实验台, 徽章盒) carry floor plates, or
 * a strip of three cards on a short landscape. A place opens over the dimmed room: the shelf's
 * binders (图鉴研究 by map, 解锁 with their conditions, 羁绊 per partner), the bench's instruments with
 * the 档案库 and 背包 in its drawer, the eight-slot badge case. Back closes a place before the room.
 */
export class GpuLab {
  readonly stage = new UiStage();
  readonly minLayout = { width: 760, height: 320 };
  private readonly callbacks: LabCallbacks;
  private readonly frame: InnerScreenFrame;
  private readonly balance: Balance;
  private readonly backdrop: LabBackdrop;
  private readonly thumbs = new CodexThumbs(() => this.stage.invalidate());
  private readonly tooltip: GpuTooltip;
  /** Desktop spots and the owned badges in the case's holes, placed over the art. */
  private readonly sceneLayer = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
  });
  private readonly body = new Container({ flexGrow: 1, minHeight: 0, flexDirection: "column" });
  private readonly tray: Container;
  private readonly trayFaces: SegmentFace[] = [];
  private trayControls: Control[] = [];
  private fixed: Control[] = [];
  private controls: Control[] = [];
  private viewControls: Control[] = [];
  private readonly viewParts: { dispose(): void }[] = [];
  /** Rows whose height is their only touch dimension: at least `minTarget` at any UI scale. */
  private touchRows: { panel: Container; min: number }[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private view = new Container();
  /** The open place's scrolled pane, if it has one. */
  private scroller: Container | null = null;
  private readonly point = new Vector3();
  private readonly inverse = new Matrix4();
  private progress: Progress;
  private place: Place | null = null;
  private binder: Binder = "research";
  private drawer = false;
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
  private entrance: { y: number; opacity: number }[] = [];
  private entering: Control[] = [];
  private needsReveal = false;
  private readonly dim = { amount: 0 };
  private readonly light = { amount: 0 };
  private lit: Place | null = null;

  /** `_backdrop`: the host's lobby art; the lab draws its own room. `at` reopens where it was left. */
  constructor(
    fonts: FontFamilies,
    _backdrop: Texture,
    progress: Progress,
    callbacks: LabCallbacks,
    at?: LabAt,
  ) {
    this.callbacks = callbacks;
    this.progress = progress;
    this.stage.root.setProperties({ fontFamilies: fonts, flexDirection: "column", color: ui.ink });
    this.backdrop = new LabBackdrop(this.stage);
    this.tooltip = new GpuTooltip(this.stage);
    this.frame = new InnerScreenFrame(this.stage, "研究所");
    this.balance = new Balance(this.stage);
    this.balance.set(progress.stardust);
    this.frame.extra.add(this.balance.root);
    this.stage.root.add(this.sceneLayer, this.frame.topline, this.frame.body);
    this.frame.body.add(this.body);
    const tray = segmentTray();
    this.tray = tray.tray;
    this.disposables.push(tray);
    this.fixed.push(
      this.keyControl("back", this.frame.back, () => this.back()),
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
    this.buildTray();
    if (at) {
      this.place = at.place;
      this.binder = at.binder;
    }
    this.build(false);
    if (at?.key) {
      const index = this.controls.findIndex((c) => c.kind === "cell" && c.key === at.key);
      if (index >= 0) {
        this.focused = index;
        this.needsReveal = true;
      }
    }
    this.setDim(this.place ? 1 : 0, 0);
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
    const focused = this.controls[this.focused];
    this.fixed = this.fixed.filter((control) => control !== this.fullscreenControl);
    if (action) this.fixed.push(this.fullscreenControl);
    this.relist();
    // Indices shift; focus stays on its control (e.g. the species reopened from the 图鉴).
    this.focused = focused ? this.controls.indexOf(focused) : -1;
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

  private relist(): void {
    this.controls = [...this.fixed, ...(this.place ? this.trayControls : []), ...this.viewControls];
  }

  // ── Places ─────────────────────────────────────────────────────────────────────────────────

  /** The three places as segments: their own row over an open place, or the top line when short. */
  private buildTray(): void {
    for (const place of places) {
      const face = new SegmentFace(this.stage, placeLooks[place].name);
      this.trayFaces.push(face);
      this.tray.add(stack(face.panel, 1));
      this.disposables.push(face);
      this.trayControls.push({
        kind: "place",
        panel: face.panel,
        key: place,
        tip: () => null,
        locked: () => false,
        activate: () => this.open(place),
        paint: (state) => face.paint({ ...state, checked: this.place === place, locked: false }),
        update: () => {},
        dispose: () => {},
      });
    }
  }

  /** Opens a place (the room dims behind it), or switches to another. */
  open(place: Place): void {
    if (this.place === place) return;
    getAudio().sfx("ui-confirm");
    this.place = place;
    this.drawer = false;
    this.build(true);
    this.setDim(1, 240);
  }

  /** Back: an open place returns to the room (its spot focused), the room to the lobby. */
  private back(): void {
    getAudio().sfx("ui-back");
    const from = this.place;
    if (!from) {
      this.callbacks.back();
      return;
    }
    this.place = null;
    this.build(true);
    this.setDim(0, 240);
    this.focused = this.controls.findIndex((c) => c.kind === "spot" && c.key === from);
    this.repaint();
  }

  /** Shows a place unseen (the host's prewarm draws each once). */
  showPlace(place: Place | null): void {
    this.place = place;
    this.build(false);
    this.setDim(place ? 1 : 0, 0);
  }

  private setDim(amount: number, ms: number): void {
    this.stage.motion.animate(
      this.dim,
      { amount },
      ms,
      () => {
        this.backdrop.setDim(this.dim.amount);
        this.stage.invalidate();
      },
      EASE,
    );
  }

  /** Lights the hovered or focused spot's object in the art. */
  private setLit(place: Place | null): void {
    if (place === this.lit) return;
    if (place) this.lit = place;
    const target = place ? 1 : 0;
    const shown = this.lit;
    if (place) this.light.amount = 0;
    this.stage.motion.animate(
      this.light,
      { amount: target },
      160,
      () => {
        this.backdrop.light(shown, this.light.amount);
        this.stage.invalidate();
      },
      SNAP,
    );
    if (!place) this.lit = null;
  }

  // ── Build ──────────────────────────────────────────────────────────────────────────────────

  private build(animate: boolean): void {
    for (const control of this.viewControls) control.dispose();
    for (const part of this.viewParts.splice(0)) part.dispose();
    for (const state of this.entrance) this.stage.motion.cancel(state);
    disposeTree(this.view);
    for (const child of this.sceneLayer.children.slice()) disposeTree(child);
    this.viewControls = [];
    this.touchRows = [];
    this.tileRows = [];
    this.sized = [];
    this.archiveItems = [];
    this.archiveLegend = null;
    this.badgeLabels = [];
    this.cellRows = [];
    this.cellWidth = 0;
    this.scroller = null;
    this.column = 0;
    this.tray.removeFromParent();
    if (this.place) {
      if (this.compact) this.frame.extra.add(stack(this.tray, 1));
      else this.body.add(stack(this.tray, 1));
    }
    this.view = new Container({ flexGrow: 1, minHeight: 0, flexDirection: "column" });
    this.body.add(this.view);
    if (!this.place) this.buildScene();
    else {
      const window = stack(
        new Container({
          flexGrow: 1,
          minHeight: 0,
          flexDirection: this.place === "shelf" ? "row" : "column",
          padding: this.compact ? 10 : 14,
          gap: this.compact ? 10 : 14,
        }),
        1,
      );
      const face = new CardFace(window, { fill: ui.paper });
      face.set({ depth: HARD_SHADOW.offset });
      window.add(face.content);
      this.viewParts.push(face);
      this.view.add(window);
      if (this.place === "shelf") this.buildShelf(window);
      else if (this.place === "bench") this.buildBench(window);
      else this.buildBadges(window);
    }
    this.relist();
    this.focused = Math.min(this.focused, this.controls.length - 1);
    this.hovered = -1;
    this.pressed = -1;
    this.hoveredTip = -1;
    this.touchTip = -1;
    this.setLit(null);
    this.applySizes();
    this.layoutScene();
    this.repaint();
    this.entering = this.viewControls.filter((c) => c.kind !== "spot").slice(0, STAGGERED);
    this.entrance = this.entering.map(() => ({ y: 0, opacity: 1 }));
    if (!animate) return;
    for (const [i, state] of this.entrance.entries()) {
      const panel = this.entering[i]!.panel;
      this.stage.motion.enter(
        state,
        { y: 14, opacity: 0 },
        { y: 0, opacity: 1 },
        240,
        () => {
          fade(panel, state.opacity).setProperties({ transformTranslateY: state.y });
          this.stage.invalidate();
        },
        EASE,
        stagger(i),
      );
    }
  }

  // ── The room ───────────────────────────────────────────────────────────────────────────────

  private spotPanels = new Map<Place, { hit: Container; plate: Container }>();
  private holes: { id: BadgeId; medal: Container }[] = [];

  /** Each place's plate with its icon, name and count; desktop over the art, short as a strip. */
  private buildScene(): void {
    this.spotPanels.clear();
    this.holes = [];
    const strip = new Container({
      flexDirection: "row",
      gap: 12,
      marginTop: "auto",
      paddingBottom: 4,
      paddingX: 4,
    });
    if (this.compact) this.view.add(strip);
    for (const place of places) {
      const plate = new Container({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 48,
        paddingLeft: 12,
        paddingRight: 16,
        flexShrink: 0,
      });
      const face = new CardFace(plate, { fill: ui.ink });
      const ring = new OutlineRing(RADIUS, ui.white, 2.5, 3);
      ring.content.setProperties({ display: "none" });
      const icon = stack(createMenuIcon(placeLooks[place].icon), 1);
      icon.setProperties({ width: 24, height: 24, color: ui.white });
      const name = stack(
        new Text({ text: placeLooks[place].name, fontSize: 18, fontWeight: 900, color: ui.white }),
        1,
      );
      const count = stack(
        new Text({ text: this.placeCount(place), fontSize: 15, fontWeight: 800, color: ui.line }),
        1,
      );
      plate.add(face.content, icon, name, count, stack(ring.content, 3));
      this.viewParts.push(face, ring);
      let hit: Container;
      if (this.compact) {
        plate.setProperties({ flexGrow: 1, flexBasis: 0, justifyContent: "center", minHeight: 64 });
        strip.add(plate);
        hit = plate;
      } else {
        hit = new Container({
          positionType: "absolute",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 12,
        });
        hit.add(plate);
        this.sceneLayer.add(hit);
      }
      this.spotPanels.set(place, { hit, plate });
      const pose = { lift: 0 };
      let target = "";
      this.viewControls.push({
        kind: "spot",
        panel: hit,
        key: place,
        tip: () => null,
        locked: () => false,
        activate: () => this.open(place),
        paint: ({ hovered, focused, focusVisible, pressed }) => {
          ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
          face.set({ fill: hovered || (focused && focusVisible) ? ui.ball : ui.ink });
          const lift = pressed ? -LIFT.press : hovered ? LIFT.hover : 0;
          if (`${lift}` === target) return;
          const duration = target === "" ? 0 : LIFT.ms;
          target = `${lift}`;
          this.stage.motion.animate(
            pose,
            { lift },
            duration,
            () => {
              plate.setProperties({ transformTranslateY: -pose.lift });
              face.set({ depth: HARD_SHADOW.offset + pose.lift });
              this.stage.invalidate();
            },
            SNAP,
          );
        },
        update: () => {},
        dispose: () => this.stage.motion.cancel(pose),
      });
    }
    // The badges the player holds sit in the case's holes.
    for (const id of this.progress.badges) {
      const medal = badgeMedal(id, 24);
      medal.setProperties({ positionType: "absolute" });
      this.sceneLayer.add(medal);
      this.holes.push({ id, medal });
    }
  }

  private placeCount(place: Place): string {
    if (place === "shelf") {
      const species = researchGroups().flatMap((group) => group.species);
      const done = species.filter((id) => researchOf(this.progress.dex, id).done).length;
      return `${done}/${species.length}`;
    }
    if (place === "badges") return `${this.progress.badges.length}/${badgeIds.length}`;
    return "";
  }

  /** Puts the desktop spots under their objects and the medals in their holes. */
  private layoutScene(): void {
    if (this.place) return;
    if (!this.compact)
      for (const [place, { hit }] of this.spotPanels) {
        const r = this.backdrop.spot(place);
        hit.setProperties({
          positionLeft: r.x,
          positionTop: r.y,
          width: r.width,
          height: r.height,
        });
      }
    const size = this.backdrop.point(CASE_HOLES.diameter, 0).x - this.backdrop.point(0, 0).x;
    for (const { id, medal } of this.holes) {
      const at = badgeIds.indexOf(id);
      const { x, y } = this.backdrop.point(
        CASE_HOLES.u[at % 4]!,
        CASE_HOLES.v[Math.floor(at / 4)]!,
      );
      const s = Math.round(size * 0.92);
      medal.setProperties({ positionLeft: x - s / 2, positionTop: y - s / 2, width: s, height: s });
      (medal.children[0] as Container | undefined)?.setProperties({
        width: s * 0.62,
        height: s * 0.62,
      });
    }
  }

  // ── 书架 ───────────────────────────────────────────────────────────────────────────────────

  private buildShelf(window: Container): void {
    const spines = new Container({
      flexDirection: "column",
      gap: 8,
      flexShrink: 0,
      width: this.compact ? 120 : 160,
    });
    window.add(stack(spines, 1));
    for (const binder of binders) {
      const panel = new Container({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingX: 12,
      });
      this.touchRows.push({ panel, min: 52 });
      const face = new CardFace(panel, { fill: ui.white });
      const ring = new OutlineRing(RADIUS, ui.ink, 2.5, 3);
      ring.content.setProperties({ display: "none" });
      const icon = stack(createMenuIcon(binder.icon), 1);
      icon.setProperties({ width: 20, height: 20 });
      const label = stack(new Text({ text: binder.name, fontSize: 16, fontWeight: 900 }), 1);
      panel.add(face.content, icon, label, stack(ring.content, 3));
      spines.add(panel);
      this.viewParts.push(face, ring);
      this.viewControls.push({
        kind: "spine",
        panel,
        key: binder.id,
        tip: () => null,
        locked: () => false,
        activate: () => {
          if (this.binder === binder.id) return;
          getAudio().sfx("ui-confirm");
          this.binder = binder.id;
          this.build(true);
          this.focused = this.controls.findIndex((c) => c.kind === "spine" && c.key === binder.id);
          this.repaint();
        },
        paint: ({ hovered, focused, focusVisible }) => {
          const picked = this.binder === binder.id;
          ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
          face.set({
            fill: picked ? ui.ink : hovered ? ui.mist : ui.white,
            depth: picked ? 0 : 2,
          });
          const ink = picked ? ui.white : ui.ink;
          icon.setProperties({ color: ink });
          label.setProperties({ color: ink });
        },
        update: () => {},
        dispose: () => {},
      });
    }
    const pane = stack(
      new Container({
        flexGrow: 1,
        minWidth: 0,
        flexDirection: "column",
        overflow: "scroll",
        scrollbarWidth: 3,
        scrollbarColor: ui.muted,
      }),
      1,
    );
    const sheet = new Container({
      flexDirection: "column",
      flexShrink: 0,
      gap: 12,
      padding: 6,
      overflow: "hidden",
    });
    pane.add(sheet);
    window.add(pane);
    this.scroller = pane;
    if (this.binder === "research") this.buildResearch(sheet);
    else if (this.binder === "bonds") this.buildBonds(sheet);
    else this.buildUnlocks(sheet);
  }

  /** Each partner's bond research, two to a row; sealed until that partner's bond reaches Lv.3. */
  private buildBonds(sheet: Container): void {
    this.sheet = sheet;
    this.rows(
      sheet,
      bondLabItems.map((item) => item.id),
    );
  }

  /** Every species by the map it is first met on: still or silhouette, name, research scale. */
  private buildResearch(sheet: Container): void {
    const c = this.compact;
    for (const group of researchGroups()) {
      sheet.add(
        new Text({
          text: group.title,
          fontSize: c ? 14 : 16,
          fontWeight: 900,
          color: ui.muted,
          marginTop: 4,
        }),
      );
      const row = new Container({ flexDirection: "row", flexWrap: "wrap", gap: c ? 8 : 10 });
      sheet.add(row);
      for (const id of group.species) row.add(this.cell(id));
      this.cellRows.push(row);
    }
  }

  private cellRows: Container[] = [];
  private cellWidth = 0;

  private cell(id: EnemyId): Container {
    const c = this.compact;
    const research = researchOf(this.progress.dex, id);
    const view = researchView(this.progress.dex, id);
    // The page as the research allows: an unseen species shows no type on its plate either.
    const entry = researchedEntry(this.progress.dex, codexEntry(enemyKey(id))!.entry, id);
    const panel = new Container({
      flexDirection: "column",
      alignItems: "center",
      gap: c ? 4 : 6,
      width: c ? 100 : 124,
      paddingTop: c ? 6 : 8,
      paddingBottom: c ? 8 : 10,
      flexShrink: 0,
    });
    const face = new CardFace(panel, { fill: ui.white });
    const ring = new OutlineRing(RADIUS, ui.ink, 2.5, 3);
    ring.content.setProperties({ display: "none" });
    const art = createArt(entry, c ? 48 : 64, this.thumbs, view === "unseen");
    const name = new Text({
      text: view === "unseen" ? "？？？" : enemies[id].name,
      fontSize: c ? 13 : 14,
      fontWeight: 800,
      color: view === "unseen" ? ui.muted : ui.ink,
      whiteSpace: "pre",
    });
    const { box, gauge } = researchGauge(research, c ? 6 : 7, c ? 10 : 12);
    box.size.subscribe(() => gauge.update());
    panel.add(
      face.content,
      stack(art.root, 1),
      stack(name, 1),
      stack(box, 1),
      stack(ring.content, 3),
    );
    if (research.done) {
      const stamp = stack(
        new Container({
          positionType: "absolute",
          positionTop: 6,
          positionRight: 6,
          width: 20,
          height: 20,
          borderRadius: 999,
          backgroundColor: ui.success,
          alignItems: "center",
          justifyContent: "center",
        }),
        2,
      );
      const check = createMenuIcon("check");
      check.setProperties({ width: 12, height: 12, color: ui.white });
      stamp.add(check);
      panel.add(stamp);
    }
    this.viewParts.push(face, ring, art, gauge);
    const pose = { lift: 0 };
    let target = "";
    this.viewControls.push({
      kind: "cell",
      panel,
      key: id,
      tip: () => null,
      locked: () => false,
      activate: () => {
        getAudio().sfx("ui-confirm");
        this.callbacks.codex(enemyKey(id), { place: "shelf", binder: "research", key: id });
      },
      paint: ({ hovered, focused, focusVisible, pressed }) => {
        ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
        const lift = pressed ? -LIFT.press : hovered ? LIFT.hover : 0;
        if (`${lift}` === target) return;
        const duration = target === "" ? 0 : LIFT.ms;
        target = `${lift}`;
        this.stage.motion.animate(
          pose,
          { lift },
          duration,
          () => {
            panel.setProperties({ transformTranslateY: -pose.lift });
            face.set({ depth: 2 + pose.lift });
            this.stage.invalidate();
          },
          SNAP,
        );
      },
      update: () => {},
      dispose: () => this.stage.motion.cancel(pose),
    });
    return panel;
  }

  /** Each unlock: what it opens, then a check, or the conditions still to meet. */
  private buildUnlocks(sheet: Container): void {
    const c = this.compact;
    for (const status of unlockStatus(this.progress)) {
      const panel = new Container({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingX: 12,
        paddingY: 6,
        flexShrink: 0,
      });
      this.touchRows.push({ panel, min: c ? 48 : 56 });
      const face = new CardFace(panel, { fill: status.unlocked ? ui.white : ui.mist });
      const ring = new OutlineRing(RADIUS, ui.ink, 2.5, 3);
      ring.content.setProperties({ display: "none" });
      const icon = stack(contentIcon(status.content), 1);
      icon.setProperties({
        width: 24,
        height: 24,
        color: status.unlocked ? ui.ink : ui.muted,
        flexShrink: 0,
      });
      const name = stack(
        new Text({
          text: contentName(status.content, this.progress.dex),
          fontSize: c ? 15 : 17,
          fontWeight: 900,
          color: status.unlocked ? ui.ink : ui.muted,
          flexGrow: 1,
          minWidth: 0,
        }),
        1,
      );
      panel.add(face.content, icon, name);
      if (status.unlocked) {
        const done = stack(
          new Container({
            width: 28,
            height: 28,
            borderRadius: 999,
            backgroundColor: ui.success,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }),
          1,
        );
        const check = createMenuIcon("check");
        check.setProperties({ width: 16, height: 16, color: ui.white });
        done.add(check);
        panel.add(done);
      } else panel.add(stack(this.condition(status.requires, status.met), 1));
      panel.add(stack(ring.content, 3));
      sheet.add(panel);
      this.viewParts.push(face, ring);
      const species = "research" in status.requires ? status.requires.research : undefined;
      this.viewControls.push({
        kind: "unlock",
        panel,
        key: status.id,
        tip: () => null,
        locked: () => !species,
        activate: () => {
          if (!species) return;
          getAudio().sfx("ui-confirm");
          this.callbacks.codex(enemyKey(species), { place: "shelf", binder: "unlocks" });
        },
        paint: ({ hovered, focused, focusVisible }) => {
          ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
          face.set({ depth: hovered && species ? 4 : 2 });
        },
        update: () => {},
        dispose: () => {},
      });
    }
  }

  /** A condition chip: its icon and target (a species, a count, a difficulty); green once met. */
  private condition(requires: UnlockDef["requires"], met: boolean): Container {
    let icon: MenuIconName, text: string;
    if ("research" in requires) {
      icon = "flask";
      text =
        researchView(this.progress.dex, requires.research) === "unseen"
          ? "？？？"
          : enemies[requires.research].name;
    } else if ("researched" in requires) {
      icon = "binder";
      text = `${Math.min(researchedCount(this.progress.dex), requires.researched)}/${requires.researched}`;
    } else if ("badges" in requires) {
      icon = "case";
      text = `${Math.min(this.progress.badges.length, requires.badges)}/${requires.badges}`;
    } else {
      icon = "flag";
      text = difficulties[requires.clears].name;
    }
    const chip = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 32,
      paddingX: 10,
      borderRadius: RADIUS_INNER,
      backgroundColor: met ? ui.success : ui.ink,
      flexShrink: 0,
    });
    const glyph = createMenuIcon(icon);
    glyph.setProperties({ width: 16, height: 16, color: ui.white });
    chip.add(glyph, new Text({ text, fontSize: 15, fontWeight: 900, color: ui.white }));
    return chip;
  }

  // ── 实验台 ─────────────────────────────────────────────────────────────────────────────────

  private tileRows: Container[] = [];
  private column = 0;
  /** Instruments to a row: three while each keeps its values clear of the price, else two. */
  private columns = 3;

  private buildBench(window: Container): void {
    window.setProperties({ paddingX: 4, paddingY: 4 });
    const pane = stack(
      new Container({
        flexGrow: 1,
        minHeight: 0,
        flexDirection: "column",
        overflow: "scroll",
        scrollbarWidth: 3,
        scrollbarColor: ui.muted,
      }),
      1,
    );
    window.add(pane);
    this.scroller = pane;
    const sheet = new Container({
      flexDirection: "column",
      flexShrink: 0,
      overflow: "hidden",
      paddingTop: 10,
      paddingBottom: 14,
      paddingX: 10,
      gap: this.compact ? 8 : 10,
    });
    this.sheet = sheet;
    pane.add(sheet);
    for (const group of benchGroups) {
      sheet.add(
        new Text({
          text: group.name,
          fontSize: this.compact ? 14 : 16,
          fontWeight: 900,
          color: ui.muted,
        }),
      );
      this.rows(sheet, group.items);
    }
    sheet.add(this.drawerRow());
    if (this.drawer) {
      this.rows(sheet, drawerItems);
      const slots = archiveSlots(this.progress);
      if (slots > 0) sheet.add(this.archive(slots));
    }
  }

  private sheet = new Container();

  /** Tiles to a row: the bench fits two or three; the shelf's narrower pane keeps two. */
  private get sheetColumns(): number {
    return this.place === "bench" ? this.columns : 2;
  }

  private rows(sheet: Container, ids: readonly LabId[]): void {
    const columns = this.sheetColumns;
    for (let i = 0; i < ids.length; i += columns) {
      const row = new Container({
        flexDirection: "row",
        flexShrink: 0,
        gap: this.compact ? 10 : 16,
      });
      for (let j = 0; j < columns; j++) {
        const id = ids[i + j];
        row.add(
          id ? this.tile(labItem(id)) : new Container({ flexGrow: 1, flexBasis: 0, minWidth: 0 }),
        );
      }
      this.tileRows.push(row);
      sheet.add(row);
    }
  }

  /** The bench's drawer: pulls out the 档案库 and 背包 nodes and the 档案库's toggles. */
  private drawerRow(): Container {
    const panel = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingX: 14,
      marginTop: 6,
      flexShrink: 0,
    });
    this.touchRows.push({ panel, min: 48 });
    const face = new CardFace(panel, { fill: ui.white, border: { color: ui.line, width: 2 } });
    const ring = new OutlineRing(RADIUS, ui.ink, 2.5, 3);
    ring.content.setProperties({ display: "none" });
    const icon = stack(createMenuIcon("drawer"), 1);
    icon.setProperties({ width: 22, height: 22 });
    const label = stack(new Text({ text: "抽屉", fontSize: 16, fontWeight: 900, flexGrow: 1 }), 1);
    const chevron = stack(createMenuIcon("chevron"), 1);
    chevron.setProperties({ width: 18, height: 18, transformRotateZ: this.drawer ? 90 : -90 });
    panel.add(face.content, icon, label, chevron, stack(ring.content, 3));
    this.viewParts.push(face, ring);
    this.viewControls.push({
      kind: "drawer",
      panel,
      tip: () => null,
      locked: () => false,
      activate: () => {
        if (this.drawer) getAudio().sfx("ui-back");
        else getAudio().sfx("ui-confirm");
        this.drawer = !this.drawer;
        this.build(false);
        this.focused = this.controls.findIndex((c) => c.kind === "drawer");
        this.needsReveal = true;
        this.repaint();
      },
      paint: ({ hovered, focused, focusVisible }) => {
        ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
        const open = this.drawer;
        face.set({
          fill: open ? ui.ink : hovered ? ui.mist : ui.white,
          border: open ? ui.ink : ui.line,
        });
        for (const part of [icon, label, chevron])
          part.setProperties({ color: open ? ui.white : ui.ink });
      },
      update: () => {},
      dispose: () => {},
    });
    return panel;
  }

  /** One instrument per upgrade: its icon, name and tick scale, the effect and the price. */
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
    // A partner's research shows the partner; it stays grey while the bond is short of Lv.3.
    const starter = item.starter;
    const art = new Image({
      src: starter
        ? portraitSrc(starters[starter].stages[0].form.id, false)
        : `/art/icons/lab/${item.id}.webp`,
      width: "86%",
      height: "86%",
      panelMaterialClass: GrayscaleImageMaterial,
    });
    well.add(art);
    const body = stack(new Container({ flexDirection: "column", flexGrow: 1, minWidth: 0 }), 1);
    const top = new Container({ flexDirection: "row", alignItems: "center", gap: 12 });
    const name = new Text({ text: item.name, fontWeight: 900, lineHeight: 1.2, color: ui.ink });
    name.setProperties({ flexGrow: 1, flexShrink: 1, minWidth: 0, whiteSpace: "pre" });
    const gauge = new TickGauge(item.max);
    const gaugeBox = new Container({ flexShrink: 0 });
    gaugeBox.add(gauge.content);
    top.add(name, gaugeBox);
    const bottom = new Container({ flexDirection: "row", alignItems: "flex-end", gap: 12 });
    const effectRow = new Container({
      flexDirection: "column",
      alignItems: "flex-start",
      flexGrow: 1,
      minWidth: 0,
    });
    const stat = new Text({ text: item.stat, fontWeight: 700, color: ui.muted, lineHeight: 1.2 });
    stat.setProperties({ flexShrink: 0 });
    // A partly bought upgrade's now → next wraps between the two at the smallest scale.
    const value = new Text({ text: "", fontWeight: 900, color: ui.ink, lineHeight: 1.2 });
    const next = new Text({ text: "", fontWeight: 900, color: ui.ink, lineHeight: 1.2 });
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
    const seal = createMenuIcon("lock");
    seal.setProperties({ width: 16, height: 16, color: ui.muted, marginLeft: 4, display: "none" });
    const amount = new Text({ text: "", fontWeight: 900, lineHeight: 1.2 });
    price.add(coin, check, seal, amount);
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
    this.viewParts.push(face, ring, gauge);
    const level = () => this.progress.lab[item.id] ?? 0;
    const sealed = () =>
      starter !== undefined && bondLevel(this.progress.bonds[starter] ?? 0) < BOND_LAB_LEVEL;
    const lock = () =>
      sealed() ? `羁绊 Lv.${BOND_LAB_LEVEL}` : labLock(item, level(), this.progress.stardust);
    const pose = { lift: 0 };
    let target = "";
    this.viewControls.push({
      kind: "tile",
      panel,
      key: item.id,
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
        const shut = sealed();
        const state = cost === null ? "maxed" : lock() ? "short" : "ready";
        ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
        face.set({ fill: state === "maxed" ? ui.mist : ui.white });
        // The scale: bought ticks in ink (success when full), the next one red while it can be bought.
        gauge.set(now, state === "ready" ? now : -1, state === "maxed" ? ui.success : ui.ink);
        const [current, following] = effect(item, now);
        value.setProperties({ text: current });
        next.setProperties({ text: following ?? "", display: following ? "flex" : "none" });
        amount.setProperties({
          text: shut ? `Lv.${BOND_LAB_LEVEL}` : cost === null ? "满级" : prices.format(cost),
          color: state === "short" ? ui.muted : ui.white,
        });
        setGrayscale(art, shut ? 1 : 0);
        seal.setProperties({ display: shut ? "flex" : "none" });
        coin.setProperties({ display: cost === null || shut ? "none" : "flex" });
        setGrayscale(coin, state === "short" ? 0.7 : 0);
        check.setProperties({ display: cost === null ? "flex" : "none" });
        price.setProperties({
          backgroundColor: state === "maxed" ? ui.success : state === "short" ? ui.mist : ui.ball,
        });
        const lift = state !== "ready" ? 0 : pressed ? -LIFT.press : hovered ? LIFT.hover : 0;
        if (`${lift}` === target) return;
        const duration = target === "" ? 0 : LIFT.ms;
        target = `${lift}`;
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
        gauge.update();
      },
      dispose: () => this.stage.motion.cancel(pose),
    });
    this.sized.push({
      panel,
      well,
      name,
      stat,
      value,
      next,
      amount,
      priceSlot,
      gaugeBox,
      gauge,
      top,
      bottom,
      body,
      price,
      coinSize: (size: number) => coin.setProperties({ width: size, height: size }),
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
    gaugeBox: Container;
    gauge: TickGauge;
    top: Container;
    bottom: Container;
    body: Container;
    price: Container;
    coinSize(size: number): void;
  }[] = [];

  private archiveItems: Container[] = [];
  private archiveLegend: Text | null = null;

  /** The 档案库: every item as a toggle, in rows by card tier; archived ones are struck out of runs. */
  private archive(slots: number): Container {
    const plate = new Container({
      flexDirection: "column",
      alignItems: "flex-start",
      gap: 10,
      marginTop: 6,
      paddingY: 12,
      paddingX: 14,
      flexShrink: 0,
    });
    const card = new CardFace(plate, { fill: ui.white });
    plate.add(card.content);
    this.viewParts.push(card);
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
      this.viewParts.push(face, ring);
      const on = () => this.progress.archive.includes(id);
      const full = () => !on() && this.progress.archive.length >= slots;
      const pose = { lift: 0 };
      let target = "";
      face.set({ depth: 2 });
      this.viewControls.push({
        kind: "archive",
        panel: button,
        key: id,
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
          ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
          face.set({
            fill: archived ? ui.ink : ui.white,
            border: archived ? ui.ink : hovered && !full() ? ui.ink : ui.line,
          });
          fade(icon, archived ? 0.4 : 1);
          setGrayscale(icon, archived ? 1 : 0);
          strike.setProperties({ display: archived ? "flex" : "none" });
          fade(button, full() ? 0.45 : 1);
          const lift = full() ? 0 : pressed ? -LIFT.press : hovered ? LIFT.hover : 0;
          if (`${lift}` === target) return;
          const duration = target === "" ? 0 : LIFT.ms;
          target = `${lift}`;
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
      });
    }
    for (const shelf of shelves) if (shelf.children.length > 1) plate.add(stack(shelf, 1));
    return plate;
  }

  // ── 徽章盒 ─────────────────────────────────────────────────────────────────────────────────

  private badgeLabels: { well: Container; medal: Container; label: Text }[] = [];

  /** The case: eight wells, two rows of four; a held badge sits in its well, the rest show their score. */
  private buildBadges(window: Container): void {
    window.setProperties({ alignItems: "center", justifyContent: "center" });
    const box = new Container({
      flexDirection: "column",
      gap: this.compact ? 8 : 20,
      padding: this.compact ? 14 : 32,
      flexShrink: 0,
    });
    const face = new CardFace(box, { fill: "#1d2a52" });
    face.set({ depth: HARD_SHADOW.offset });
    box.add(face.content);
    this.viewParts.push(face);
    window.add(stack(box, 1));
    for (let r = 0; r < 2; r++) {
      const row = stack(new Container({ flexDirection: "row", gap: this.compact ? 10 : 28 }), 1);
      box.add(row);
      for (const id of badgeIds.slice(r * 4, r * 4 + 4)) row.add(this.badgeSlot(id));
    }
  }

  private badgeSlot(id: BadgeId): Container {
    const owned = this.progress.badges.includes(id);
    const panel = new Container({
      flexDirection: "column",
      alignItems: "center",
      gap: 6,
      padding: 4,
    });
    const ring = new OutlineRing(RADIUS, ui.white, 2.5, 3);
    ring.content.setProperties({ display: "none" });
    const well = new Container({
      borderRadius: 999,
      backgroundColor: WELL,
      alignItems: "center",
      justifyContent: "center",
    });
    const medal = badgeMedal(id, 10, !owned);
    if (!owned) fade(medal, 0.35);
    well.add(medal);
    const label = new Text({
      text: owned ? badges[id].name : String(badges[id].score),
      fontWeight: 900,
      color: owned ? ui.white : ui.line,
    });
    panel.add(well, label, stack(ring.content, 3));
    this.viewParts.push(ring);
    this.badgeLabels.push({ well, medal, label });
    this.viewControls.push({
      kind: "badge",
      panel,
      key: id,
      tip: () => (owned ? null : badges[id].name),
      locked: () => true,
      activate: () => {},
      paint: ({ focused, focusVisible }) =>
        ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" }),
      update: () => {},
      dispose: () => {},
    });
    return panel;
  }

  // ── State ──────────────────────────────────────────────────────────────────────────────────

  /**
   * A buy or a 档案库 toggle changes only levels, the balance and the archive, which the controls
   * paint live; any other change (an imported save) rebuilds what is shown — names, scales,
   * checks, conditions, medals — and keeps focus on the same control.
   */
  update(progress: Progress): void {
    const previous = this.progress;
    this.progress = progress;
    this.balance.set(progress.stardust);
    const painted = new Set<keyof Progress>(["stardust", "lab", "archive"]);
    const rebuild =
      (Object.keys(progress) as (keyof Progress)[]).some(
        (field) => !painted.has(field) && progress[field] !== previous[field],
      ) ||
      (this.place === "bench" && this.drawer && archiveSlots(progress) !== archiveSlots(previous));
    if (!rebuild) {
      this.repaint();
      return;
    }
    const focused = this.controls[this.focused];
    this.build(false);
    if (!focused) return;
    const index = this.controls.findIndex(
      (control) => control.kind === focused.kind && control.key === focused.key,
    );
    this.focused = index >= 0 ? index : Math.min(this.focused, this.controls.length - 1);
    this.needsReveal = true;
    this.repaint();
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
    // The room lights the spot under the pointer, or the focused one.
    const spot =
      this.controls[this.hovered >= 0 ? this.hovered : this.focusVisible ? this.focused : -1];
    this.setLit(spot?.kind === "spot" && !this.compact ? (spot.key as Place) : null);
    this.stage.invalidate();
  }

  private applySizes(): void {
    const c = this.compact;
    for (const face of this.trayFaces) face.fitTouch();
    const gap = c ? 8 : 12;
    for (const part of this.sized) {
      part.panel.setProperties({
        minHeight: c ? 76 : 104,
        gap: c ? 12 : 18,
        paddingY: c ? 10 : 14,
        paddingLeft: c ? 10 : 16,
        paddingRight: c ? 12 : 18,
      });
      const well = c ? 52 : 72;
      part.well.setProperties({ width: well, height: well });
      part.name.setProperties({ fontSize: c ? 16 : 19 });
      part.stat.setProperties({ fontSize: c ? 12 : 14 });
      for (const text of [part.value, part.next]) text.setProperties({ fontSize: c ? 17 : 22 });
      part.amount.setProperties({ fontSize: c ? 14 : 17 });
      part.price.setProperties({ minHeight: c ? 28 : 34 });
      part.coinSize(c ? 22 : 26);
      part.body.setProperties({ gap: c ? 4 : 8 });
      part.top.setProperties({ gap });
      part.bottom.setProperties({ gap });
      part.gauge.setSize(c ? 5 : 7, c ? 14 : 18, c ? 2 : 3);
      part.gaugeBox.setProperties({ width: part.gauge.width(), height: c ? 14 : 18 });
      part.priceSlot.setProperties({ minWidth: part.gauge.width() });
    }
    const minTarget = this.stage.viewport.minTarget;
    for (const { panel, min } of this.touchRows)
      panel.setProperties({ minHeight: Math.max(min, minTarget) });
    const slot = Math.max(c ? 44 : 48, minTarget);
    for (const button of this.archiveItems) button.setProperties({ width: slot, height: slot });
    const well = c ? 64 : 128;
    for (const { well: hole, medal, label } of this.badgeLabels) {
      hole.setProperties({ width: well, height: well });
      medal.setProperties({ width: well * 0.78, height: well * 0.78 });
      (medal.children[0] as Container | undefined)?.setProperties({
        width: well * 0.48,
        height: well * 0.48,
      });
      label.setProperties({ fontSize: c ? 13 : 17 });
    }
  }

  resize(width: number, height: number, scale: number, safe: UiInsets): void {
    this.stage.resize(width, height, scale, safe);
    this.backdrop.resize();
    const v = this.stage.viewport;
    const compact = height <= 480 && width > height;
    const edge = compact ? 16 : 28;
    const columns = this.fitColumns(
      v.width - 2 * Math.max(edge, v.safeArea.left, v.safeArea.right),
      compact,
    );
    const rebuild = compact !== this.compact || columns !== this.columns;
    this.compact = compact;
    this.columns = columns;
    this.frame.resize(compact);
    this.frame.extra.setProperties({ gap: compact ? 12 : 18 });
    this.balance.setCompact(compact);
    this.tray.setProperties({ alignSelf: "flex-start", marginBottom: compact ? 0 : 4 });
    this.body.setProperties({
      gap: compact ? 0 : 10,
      paddingLeft: Math.max(edge, v.safeArea.left),
      paddingRight: Math.max(edge, v.safeArea.right),
      paddingBottom: Math.max(compact ? 8 : 20, v.safeArea.bottom),
    });
    if (rebuild) {
      this.build(false);
      return;
    }
    this.applySizes();
    this.layoutScene();
    this.repaint();
  }

  /** Three instruments to a row when each keeps its well, scale and `now → next` clear, else two. */
  private fitColumns(sheetWidth: number, compact: boolean): number {
    const tile = (sheetWidth - 2 * (compact ? 8 : 12)) / 3;
    return tile >= (compact ? 220 : 320) ? 3 : 2;
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
      if (scrolled.has(control.kind) && this.scroller && !this.contains(this.scroller, x, y))
        continue;
      // A control still rising in (under half shown) is not there to press yet.
      const entering = this.entrance[this.entering.indexOf(control)];
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

  hover(index: number | null): void {
    const next = index ?? -1;
    if (next === this.hovered) return;
    const control = this.controls[next];
    if (
      control &&
      (control.kind === "tile" || control.kind === "spot") &&
      next !== this.focused &&
      !control.locked()
    )
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
    const pane = this.scroller;
    if (!pane) return;
    const [x, y] = pane.scrollPosition.value;
    pane.scrollPosition.value = [
      x,
      Math.max(
        0,
        Math.min(pane.maxScrollPosition.value[1] ?? 0, y + delta / this.stage.viewport.scale),
      ),
    ];
    this.touchTip = -1;
    this.stage.invalidate();
  }

  private reveal(): void {
    const control = this.controls[this.focused];
    if (!control || !this.scroller || !scrolled.has(control.kind)) return;
    revealInScroller(control.panel, this.scroller);
  }

  setFocusVisible(visible: boolean): void {
    if (visible === this.focusVisible) return;
    this.focusVisible = visible;
    this.repaint();
  }

  setCoarsePointer(_coarse: boolean): void {}

  /** Tab stops: the top line, the open place's segment, then every control of the place. */
  private tabStops(): number[] {
    return this.controls
      .map((control, i) => ({ control, i }))
      .filter(({ control }) => control.kind !== "place" || control.key === this.place)
      .map(({ i }) => i);
  }

  private tabAt(stops: number[]): number {
    return this.controls[this.focused]?.kind === "place"
      ? stops.findIndex((i) => this.controls[i]!.kind === "place")
      : stops.indexOf(this.focused);
  }

  tabEdge(shift: boolean): boolean {
    const stops = this.tabStops();
    return this.tabAt(stops) === (shift ? 0 : stops.length - 1);
  }

  private first(): Control | undefined {
    return this.viewControls.find((c) => c.kind !== "spine") ?? this.viewControls[0];
  }

  navigate(action: NavigationAction): boolean {
    if (this.touchTip >= 0) this.touchTip = -1;
    if (action === "previousPage" || action === "nextPage") {
      const step = action === "previousPage" ? -1 : 1;
      const at = this.place ? places.indexOf(this.place) : step > 0 ? -1 : places.length;
      const place = places[(at + step + places.length) % places.length]!;
      this.open(place);
      this.focus(this.controls.findIndex((c) => c.kind === "place" && c.key === place));
      return true;
    }
    if (action === "cancel") {
      this.back();
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
    const current = this.controls[this.focused];
    if (!current) {
      // Arrows from nowhere enter the room at its first spot, a place at its first control.
      const target = this.first();
      if (isNavigationDirection(action) && target) {
        this.focus(this.controls.indexOf(target));
        return true;
      }
      return false;
    }
    if (isNavigationDirection(action)) {
      // Left/right stay in their row group (top line, segments, the place); up/down cross them.
      const group = [this.fixed, this.trayControls, this.viewControls].find((list) =>
        list.includes(current),
      )!;
      const pool = action === "left" || action === "right" ? group : this.controls;
      const target =
        pool[
          gridStep(
            pool.map((control) => control.panel),
            pool.indexOf(current),
            action,
          )
        ];
      const next = target ? this.controls.indexOf(target) : this.focused;
      this.focus(next);
      if (current.kind === "place" && target?.kind === "place") target.activate();
      return true;
    }
    if (action === "first" || action === "last") {
      const list = this.viewControls;
      const target = action === "first" ? list[0] : list.at(-1);
      if (target) this.focus(this.controls.indexOf(target));
      return true;
    }
    if (action === "confirm") {
      const opening = current.kind === "spot";
      current.activate();
      // Opening a place by key lands on its first control.
      if (opening) {
        const target = this.first();
        if (target) this.focus(this.controls.indexOf(target));
      }
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
    if (this.needsReveal && this.scroller?.size.value) {
      this.needsReveal = false;
      this.reveal();
      this.stage.invalidate();
    }
    // `grid-template-columns: repeat(columns, minmax(0, 1fr))`: every column an equal share of the
    // sheet, so a short last row keeps the widths above it.
    const tiled = this.place === "bench" || (this.place === "shelf" && this.binder === "bonds");
    const inner = tiled ? this.sheet.node.layoutInner.value?.[0] : undefined;
    if (inner !== undefined) {
      const gap = this.compact ? 10 : 16;
      const n = this.sheetColumns;
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
    // The species cells share each row's width: as many as fit at their least width, grown evenly.
    const row = this.cellRows[0]?.node.layoutInner.value?.[0];
    if (row !== undefined) {
      const gap = this.compact ? 8 : 10,
        least = this.compact ? 100 : 124;
      const n = Math.max(1, Math.floor((row + gap) / (least + gap)));
      const width = Math.floor((row - (n - 1) * gap) / n);
      if (width !== this.cellWidth) {
        this.cellWidth = width;
        for (const cells of this.cellRows)
          for (const cell of cells.children) (cell as Container).setProperties({ width });
        this.stage.invalidate();
      }
    }
    this.fullscreen.fitTouch();
    this.thumbs.update();
    for (const c of this.controls) c.update(deltaMs);
  }

  /** The species stills' offscreen pass, then the room. */
  render(renderer: WebGLRenderer): void {
    if (this.thumbs.render(renderer)) this.stage.invalidate();
    this.stage.render(renderer);
  }

  releaseUploads(): void {
    this.stage.releaseUploads();
    this.thumbs.releaseUploads();
  }

  dispose(): void {
    for (const control of this.viewControls) control.dispose();
    for (const part of [...this.viewParts, ...this.disposables]) part.dispose();
    this.stage.motion.cancel(this.dim);
    this.stage.motion.cancel(this.light);
    this.balance.dispose();
    this.fullscreen.dispose();
    this.frame.dispose();
    this.tooltip.dispose();
    this.thumbs.dispose();
    this.backdrop.dispose();
    this.stage.dispose();
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
