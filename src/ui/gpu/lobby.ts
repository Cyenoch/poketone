import { FullscreenIcon } from "./fullscreen-icon";
import type { UiKey } from "../../platform/ui-surface";
import {
  isNavigationDirection,
  navigationAction,
  type NavigationAction,
  type NavigationDirection,
} from "../../platform/input";
import { currentInputMode } from "./input-glyph";
import { Component, Container, Image, Text, type FontFamilies } from "@pmndrs/uikit";
import { Matrix4, Vector3, type Object3D, type Texture } from "three";
import { getAudio } from "../../audio/engine";
import { LEGAL_NOTICE } from "../../legalNotice";
import { COMMUNITY_LINKS } from "../../community";
import { type LobbyPick } from "../../lobbyPick";
import {
  trainerArt,
  trainerOrder,
  trainers,
  kitTip,
  trainerUnlocked,
  XIAQING_UNLOCK_KILLS,
  type TrainerId,
} from "../../trainers";
import { formatTime } from "../../run/labels";
import { difficultyLock, starterLock } from "../../run/locks";
import { ruleAvailable, starterUnlocked, type Progress } from "../../run/progress";
import { ruleIds, totalDanger, type RuleId } from "../../run/sim/content/rules";
import { ChallengeWindow, RulesKey } from "./challenge-rules";
import { modeKeys, modeOrder, towerLock, TowerRecord } from "./tower-mode";
import { difficulties, type Difficulty } from "../../run/sim/content/difficulties";
import { items, type ItemId } from "../../run/sim/content/items";
import { starterOrder, starters, type StarterId } from "../../run/sim/content/lines/index";
import { type StageId } from "../../run/sim/content/stages/index";
import { BallBadge, portraitSrc } from "./ball";
import { BondMeter, bondTip } from "./bond-meter";
import { CURRENCY_ICON, CURRENCY_NAME } from "./currency";
import { GameButton } from "./game-button";
import { createMenuIcon } from "./icons";
import { LockChip } from "./lock-chip";
import { fade, stack } from "./layer";
import { balanceLines, textWidth } from "./line-break";
import type { LobbyScene } from "./lobby-scene";
import { RouteMap } from "./route-map";
import { EASE, LIFT, SNAP, stagger } from "./motion";
import { themeColors } from "./run-theme";
import { revealInScroller } from "./scroll-reveal";
import { createTriangleMark } from "./screen-parts";
import { ArrowButton, SlantTab } from "./slant-controls";
import { SlantPlate } from "./slant-plate";
import { segmentTray, SegmentFace } from "./segment-face";
import { UiStage } from "./stage";
import { slantTag } from "./tag";
import { HARD_SHADOW, slantOf, ui } from "./tokens";
import { GpuTooltip, type TipContent } from "./tooltip";
import { TrainerKit } from "./trainer-kit";
import type { UiInsets } from "./viewport";
import { typeTag } from "./type-icon";

export interface LobbyState {
  progress: Progress;
  /** The host's warm-up copies name no map: they open on the first one. */
  pick: LobbyPick;
  /** The challenge rules the next run starts with (the app's draft, already filtered). */
  rules: readonly RuleId[];
}
export interface LobbyCallbacks {
  /** 出发 with the current pick: one press, the run's own loading screen follows. */
  start(pick: LobbyPick): void;
  /** The pick changed (kept by the app for the next visit and the next session). */
  pick(pick: LobbyPick): void;
  /** The rules window changed the draft (kept by the app, saved only when a run starts). */
  rules(next: readonly RuleId[]): void;
  /**
   * The player asks for `line`'s shiny look: `worn` from a direction (← off, → on), sent even when
   * it matches the saved look (it may cancel a look still loading); a press or click leaves it out
   * to toggle, against a look still loading if there is one, else against the saved look. The app
   * saves the result and updates the lobby's progress; the key only ever shows the saved look, and
   * pops only when the app reports a saved request (`lookSaved`).
   */
  shiny(line: StarterId, worn?: boolean): void;
  lab(): void;
  codex(): void;
  settings(): void;
  multiplayer(): void;
  openLink(url: string): void;
}

const LONG_PRESS_MS = 450;
/** A horizontal drag this long over the stage switches partner. */
const SWIPE = 48;
/** Wheel distance per partner switch over the stage. */
const WHEEL_STEP = 100;
/** Keeps badge lift, plate shadows and focus rings inside the clipped decision column. */
const COLUMN_ROOM = 12;
/** Partners per roster row. */
const PER_ROW = 5;
/** The evolution chain's arrows. */
const CHAIN_ARROW = "#b9bec8";
const counts = new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 21 });

/** Disposes a detached subtree, children before parents, as `UiStage.dispose` does: a component's
 *  own dispose does not reach its children (their materials and text would leak). */
function disposeTree(root: Object3D): void {
  const components: { dispose(): void }[] = [];
  root.traverse((object) => {
    if (object instanceof Component) components.push(object);
  });
  for (const component of components.reverse()) component.dispose();
}

/** Desktop / compact (logical height ≤ 600, landscape) sizes. */
function tokens(compact: boolean) {
  return {
    edge: compact ? 16 : 28,
    top: compact ? 8 : 24,
    bottom: compact ? 10 : 24,
    gap: compact ? 8 : 10,
    ribbon: compact ? 44 : 68,
    name: compact ? 26 : 44,
    plate: compact ? 36 : 44,
    plateText: compact ? 18 : 22,
    avatar: compact ? 48 : 60,
    badge: compact ? 48 : 64,
    badgeGap: compact ? 8 : 16,
    chain: compact ? 30 : 52,
    slot: compact ? 40 : 40,
    swatch: compact ? 22 : 34,
    tierGap: compact ? 14 : 22,
    pairGap: compact ? 4 : 6,
    brand: compact ? 30 : 38,
    section: compact ? 8 : 14,
  };
}

type ControlKind =
  | "lab"
  | "codex"
  | "settings"
  | "fullscreen"
  | "multiplayer"
  | "link"
  | "prev"
  | "next"
  | "tile"
  | "shiny"
  | "bond"
  | "rules"
  | "mode"
  | "trainer"
  | "kit"
  | "difficulty"
  | "start"
  | "info";
interface PaintState {
  hovered: boolean;
  focused: boolean;
  focusVisible: boolean;
  pressed: boolean;
}
interface Control {
  kind: ControlKind;
  panel: Container;
  /** Roster, trainer, link or difficulty position. */
  index: number;
  tip(): TipContent | null;
  locked(): boolean;
  activate(): void;
  paint(state: PaintState): void;
  update(deltaMs: number): void;
  dispose(): void;
}
/** Anything with the shared pointer/keyboard/gamepad setters (GameButton, SlantTab, ArrowButton). */
interface Keyed {
  panel: Container;
  setHovered(hovered: boolean): void;
  setFocused(focused: boolean): void;
  setFocusVisible(visible: boolean): void;
  setPressed(pressed: boolean): void;
  fitTouch(): void;
  update?(deltaMs: number): void;
  dispose(): void;
}

/**
 * A name plate (trainer, partner): a slanted plate with its name centred on the parallelogram,
 * unrolling from the left (400ms SNAP) as the name fades in.
 */
class NamePlate {
  readonly panel = new Container({
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    alignSelf: "flex-start",
  });
  private readonly plate: SlantPlate;
  private readonly word = new Container({ flexShrink: 0 });
  private readonly text: Text;
  private readonly shade: Text | null;
  private readonly pose = { reveal: 1 };
  private readonly stage: UiStage;

  constructor(
    stage: UiStage,
    style: ConstructorParameters<typeof SlantPlate>[1],
    name: string,
    shade: string | null,
  ) {
    this.stage = stage;
    this.plate = new SlantPlate(this.panel, style);
    this.plate.set({ depth: HARD_SHADOW.offset });
    const look = { text: name, fontWeight: 800, whiteSpace: "pre", wordBreak: "keep-all" } as const;
    this.text = new Text({ ...look, color: ui.white });
    // A hard copy in the type's deep colour behind the name.
    this.shade = shade
      ? new Text({ ...look, color: shade, positionType: "absolute", positionTop: 3 })
      : null;
    if (this.shade) this.word.add(stack(this.shade, 1));
    this.word.add(stack(this.text, 2));
    this.panel.add(this.plate.content, stack(this.word, 1));
  }

  /** Height and type size; the padding is even on both sides, so the name sits on the centre. */
  size(height: number, font: number, padding: number): void {
    const lean = slantOf(height) / 2;
    const spacing = font * 0.06;
    this.panel.setProperties({ height, paddingX: padding + lean });
    for (const text of [this.text, this.shade])
      text?.setProperties({
        fontSize: font,
        letterSpacing: spacing,
        // The tracking trails the last glyph: the same indent before the first keeps it centred.
        paddingLeft: spacing,
      });
    this.shade?.setProperties({ positionLeft: Math.max(2, font * 0.07) });
  }

  setName(name: string): void {
    this.text.setProperties({ text: name });
    this.shade?.setProperties({ text: name });
  }

  /** Unrolls from the left (the plate), the name fading in with it. */
  enter(delay: number): void {
    this.stage.motion.enter(
      this.pose,
      { reveal: 0 },
      { reveal: 1 },
      400,
      () => {
        this.plate.set({ reveal: this.pose.reveal });
        fade(this.word, Math.min(1, this.pose.reveal * 1.4));
        this.stage.invalidate();
      },
      SNAP,
      delay,
    );
  }

  dispose(): void {
    this.stage.motion.cancel(this.pose);
    this.plate.dispose();
  }
}

/**
 * The partner's shiny look, before its name plate: a slanted key of the ‹ › family (white face,
 * ink frame, hard shadow) with an ink spark. Worn, it reads as a checked segment does: the face
 * turns ink, the spark white, and a second small twinkle joins it, so the state shows by fill and
 * mark; putting it on pops the spark as a picked ball mark pops (1.35 → 1, 220ms). Hover lifts
 * it, a press sinks it, keyboard focus rings it.
 */
class ShinyKey implements Keyed {
  readonly panel = new Container({
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 40 + slantOf(44),
    minHeight: 44,
  });
  private readonly plate = new SlantPlate(this.panel, {
    fill: ui.white,
    border: { color: ui.ink, width: 2 },
  });
  private readonly spark = createMenuIcon("spark");
  private readonly twinkle = createMenuIcon("spark");
  private readonly pose = { y: 0, depth: HARD_SHADOW.offset - 1 };
  private readonly pop = { scale: 1 };
  private readonly stage: UiStage;
  private hovered = false;
  private focused = false;
  private focusVisible = false;
  private pressed = false;
  private on = false;

  constructor(stage: UiStage) {
    this.stage = stage;
    this.plate.set({ depth: this.pose.depth });
    this.spark.setProperties({ width: 24, height: 24 });
    this.twinkle.setProperties({
      positionType: "absolute",
      width: 11,
      height: 11,
      positionTop: 6,
      positionRight: 12,
    });
    this.panel.add(this.plate.content, stack(this.spark, 1), stack(this.twinkle, 1));
    this.paintLook();
  }

  /** Worn or not, as saved. */
  setOn(on: boolean): void {
    this.on = on;
    this.paintLook();
  }

  /** The spark pops as a picked ball mark pops: the player's own request has been saved. */
  popSpark(): void {
    this.stage.motion.enter(
      this.pop,
      { scale: 1.35 },
      { scale: 1 },
      220,
      () => {
        this.spark.setProperties({
          transformScaleX: this.pop.scale,
          transformScaleY: this.pop.scale,
        });
        this.stage.invalidate();
      },
      EASE,
    );
  }

  private paintLook(): void {
    this.plate.set({ fill: this.on ? ui.ink : ui.white });
    this.spark.setProperties({ color: this.on ? ui.white : ui.ink });
    this.twinkle.setProperties({ color: ui.white, display: this.on ? "flex" : "none" });
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
    const min = this.stage.viewport.minTarget;
    this.panel.setProperties({
      minHeight: Math.max(44, min),
      minWidth: Math.max(40 + slantOf(44), min),
    });
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
    this.stage.motion.cancel(this.pop);
    this.plate.dispose();
  }
}

/**
 * The lobby: the root screen over its world scene (`lobby-scene.ts`: paper stage, trainer slab and
 * full-body art, line-drawn ball stage and the live partner). Left: the trainer — name plate and
 * three portraits bottom left. Right: the partner — ‹ › beside the stage, the decision column (type
 * name plate, type tag and best record, evolution chain, roster, backpack), the route and the
 * difficulty with 出发 bottom right. Top: 研究所 / 图鉴 / 联机 and the balance; the wordmark, the
 * community links, 设置 and 全屏 top right.
 */
export class GpuLobby {
  readonly stage = new UiStage();
  readonly minLayout = { width: 760, height: 360 };
  private readonly callbacks: LobbyCallbacks;
  private readonly tabs = new Container({
    positionType: "absolute",
    flexDirection: "row",
    alignItems: "center",
  });
  private readonly balance = new Container({
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 8,
    paddingRight: 12,
    flexShrink: 0,
  });
  private readonly balancePlate: SlantPlate;
  private readonly balanceText = new Text({
    fontSize: 16,
    fontWeight: 800,
    color: ui.white,
    whiteSpace: "pre",
  });
  /** Top right: the wordmark before the keys, one row centred on the tabs' row. */
  private readonly corner = new Container({
    positionType: "absolute",
    flexDirection: "row",
    alignItems: "center",
  });
  private readonly brand = new Container({ flexDirection: "row", flexShrink: 0 });
  private readonly brandWords: Text[];
  private readonly keys = new Container({ flexDirection: "row", alignItems: "center" });
  private readonly trainerBox = new Container({
    positionType: "absolute",
    flexDirection: "column",
    alignItems: "flex-start",
  });
  private readonly trainerPlate: NamePlate;
  /** Beside the plate while a locked trainer is previewed: a padlock and the KO count. */
  private readonly trainerLock = new LockChip();
  private readonly trainerHead = new Container({ flexDirection: "row", alignItems: "center" });
  /** Under the name: the previewed trainer's item and passive. */
  private readonly trainerKit: TrainerKit;
  private readonly avatars = new Container({ flexDirection: "row", alignItems: "flex-end" });
  private readonly avatarBoxes: Container[] = [];
  private readonly column = new Container({
    positionType: "absolute",
    flexDirection: "column",
    alignItems: "stretch",
    padding: COLUMN_ROOM,
    scrollbarColor: ui.line,
    scrollbarWidth: 3,
  });
  private readonly columnContent = new Container({
    flexDirection: "column",
    alignItems: "stretch",
    flexShrink: 0,
  });
  // The partner's rows end on the column's right edge, as the roster and the block below do.
  private readonly ribbon = new Container({
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  });
  private readonly meta = new Container({
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
  });
  private readonly chain = new Container({
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
  });
  private readonly divider = new Container({ height: 2, backgroundColor: ui.ink, flexShrink: 0 });
  private readonly roster = new Container({ flexDirection: "row", flexWrap: "wrap" });
  private readonly backpack = new Container({
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
  });
  /** Wraps on a narrow column: the tower record then sits under the mode keys. */
  private readonly route = new Container({
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gapRow: 6,
  });
  /** Compact: the route and the backpack share the column's last row (wrapping when full). */
  private readonly belt = new Container({
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0,
  });
  private readonly routeMap = new RouteMap();
  /** In 对战塔 the partner's best floor stands where the route map does. */
  private readonly towerRecord = new TowerRecord();
  private readonly modes: Control[] = [];
  private readonly go = new Container({
    positionType: "absolute",
    flexDirection: "row",
    alignItems: "center",
  });
  private readonly startButton: GameButton;
  private readonly legal = new Text({
    text: LEGAL_NOTICE,
    fontWeight: 700,
    lineHeight: "145%",
    color: ui.muted,
    whiteSpace: "pre",
    wordBreak: "keep-all",
  });
  private readonly prev: ArrowButton;
  private readonly next: ArrowButton;
  private readonly fullscreen: GameButton;
  private toggleFullscreen: (() => void) | undefined;
  private readonly fullscreenIcon = new FullscreenIcon();
  private readonly tooltip: GpuTooltip;
  private readonly controls: Control[] = [];
  private readonly tiles: Control[] = [];
  private readonly segments: Control[] = [];
  private readonly trainerControls: Control[] = [];
  private readonly keyed: Keyed[] = [];
  private readonly badges: { badge: BallBadge; entry: { x: number; o: number } }[] = [];
  private readonly disposables: { dispose(): void; update?(): void }[] = [];
  /** The selected partner's parts (rebuilt on a switch). */
  private readonly partnerParts: { dispose(): void }[] = [];
  private ribbonPlate: NamePlate | null = null;
  /** Before the name plate while the picked partner's shiny look is owned. */
  private readonly shinyKey: ShinyKey;
  /** The picked partner's bond: before the evolution chain (in the tag row when compact). */
  private readonly bondMeter: BondMeter;
  /** 规则 by the route, once the first clear opens the rules; the window it opens. */
  private readonly rulesKey: RulesKey;
  private readonly challenge: ChallengeWindow;
  private rules: readonly RuleId[];
  private readonly carryTips: { panel: Container; item: ItemId }[] = [];
  private readonly inverse = new Matrix4();
  private readonly point = new Vector3();
  private scene: LobbyScene | null = null;
  private progress: Progress;
  private selected: StarterId;
  private trainer: TrainerId;
  private trainerPreview: TrainerId | null = null;
  private difficulty: Difficulty;
  private map: StageId;
  private mode: LobbyPick["mode"];
  private focused = -1;
  private hovered = -1;
  private pressed = -1;
  private focusVisible = false;
  private coarse = false;
  private compact = false;
  private revealed = true;
  private covered = false;
  private departing = false;
  /** The list entrance runs once, on the first frame the lobby shows. */
  private entered = false;
  private touchTip = -1;
  private hoveredTip = -1;
  private tipPress: { index: number; at: number; x: number; y: number; fired: boolean } | null =
    null;
  private swipe: { x: number; y: number; done: boolean } | null = null;
  private pointer: { x: number; y: number } | null = null;
  private columnDrag = false;
  private wheel = 0;
  private elapsed = 0;
  private placed = "";
  private legalLaid = "";
  /** Where the legal line sits: between the trainer and 出发, or (narrow) at the column's end. */
  private legalInColumn = false;
  private zone = { x: 0, y: 0, r: 0, b: 0 };

  constructor(
    fonts: FontFamilies,
    _backdrop: Texture,
    state: LobbyState,
    callbacks: LobbyCallbacks,
  ) {
    this.callbacks = callbacks;
    this.progress = state.progress;
    this.rules = state.rules;
    this.challenge = new ChallengeWindow(
      this.stage,
      (next) => {
        // A draft: the app keeps it for 出发; the key reads it at once.
        this.rules = next;
        this.callbacks.rules(next);
        this.paintRules();
      },
      () => {
        this.coverScene();
        this.focus(this.index("rules"));
        this.repaint();
      },
    );
    this.selected = state.pick.starter;
    this.mode = state.pick.mode;
    this.trainer = state.pick.trainer;
    this.difficulty = state.pick.difficulty;
    this.map = "forest";
    this.stage.root.setProperties({ fontFamilies: fonts, color: ui.ink });
    this.tooltip = new GpuTooltip(this.stage);

    // Top left: 研究所 / 图鉴 / 联机, then the balance (an upright ink chip).
    const tabs: [ControlKind, string, () => void][] = [
      ["lab", "研究所", () => this.callbacks.lab()],
      ["codex", "图鉴", () => this.callbacks.codex()],
      ["multiplayer", "联机", () => this.callbacks.multiplayer()],
    ];
    for (const [kind, label, activate] of tabs) {
      const tab = new SlantTab(this.stage, label);
      this.tabs.add(tab.panel);
      this.controls.push(this.keyControl(kind, tab, activate));
    }
    this.balancePlate = new SlantPlate(this.balance, { fill: ui.ink, upright: true });
    this.balancePlate.set({ depth: 3 });
    this.balance.add(
      this.balancePlate.content,
      stack(new Image({ src: CURRENCY_ICON, width: 24, height: 24 }), 1),
      stack(this.balanceText, 1),
    );
    this.balanceText.setProperties({ text: counts.format(state.progress.stardust) });
    this.tabs.add(this.balance);

    // Top right: the wordmark ("poke" ink, "tone" ball red), the links, 设置 and 全屏.
    this.brandWords = [
      ["poke", ui.ink],
      ["tone", ui.ball],
    ].map(
      ([text, color]) =>
        new Text({
          text,
          color,
          fontFamily: "Poketone Display",
          fontWeight: 400,
          lineHeight: "110%",
          letterSpacing: -0.5,
        }),
    );
    this.brand.add(...this.brandWords);
    for (const [i, link] of COMMUNITY_LINKS.entries()) {
      const button = new GameButton(this.stage, {
        tone: "secondary",
        size: "small",
        label: link.label,
      });
      this.keys.add(button.panel);
      this.controls.push({
        ...this.keyControl("link", button, () => this.callbacks.openLink(link.url)),
        index: i,
      });
    }
    const settings = new GameButton(this.stage, {
      tone: "secondary",
      size: "small",
      square: true,
      icon: createMenuIcon("settings"),
    });
    this.keys.add(settings.panel);
    this.controls.push(this.keyControl("settings", settings, () => this.callbacks.settings()));
    this.fullscreen = new GameButton(this.stage, {
      tone: "secondary",
      size: "small",
      square: true,
      icon: this.fullscreenIcon,
    });
    this.fullscreen.panel.setProperties({ display: "none" });
    this.keys.add(this.fullscreen.panel);
    this.controls.push(
      this.keyControl("fullscreen", this.fullscreen, () => this.toggleFullscreen?.()),
    );
    this.corner.add(this.brand, this.keys);

    // Bottom left: the trainer's name plate over the three portraits.
    this.trainerPlate = new NamePlate(
      this.stage,
      { fill: ui.ink },
      trainers[this.trainer].name,
      null,
    );
    this.disposables.push(this.trainerPlate);
    this.buildTrainers();
    this.trainerHead.add(stack(this.trainerPlate.panel, 2), stack(this.trainerLock.panel, 2));
    this.trainerKit = new TrainerKit(this.stage);
    this.trainerKit.set(this.trainer);
    this.disposables.push(this.trainerKit);
    this.controls.push({
      kind: "kit",
      panel: this.trainerKit.panel,
      index: 0,
      tip: () => kitTip(this.trainerPreview ?? this.trainer),
      locked: () => false,
      activate: () => {},
      paint: ({ focused, focusVisible }) => this.trainerKit.paint(focused && focusVisible),
      update: () => {},
      dispose: () => {},
    });
    this.trainerBox.add(this.trainerHead, stack(this.trainerKit.panel, 2), this.avatars);

    // ‹ › beside the stage.
    this.prev = this.switchButton(-1);
    this.next = this.switchButton(1);

    // The decision column: shiny key and name plate, tag and record, chain, roster, backpack.
    this.shinyKey = new ShinyKey(this.stage);
    this.controls.push({
      ...this.keyControl("shiny", this.shinyKey, () => this.requestShiny()),
      tip: () => "异色",
    });
    this.bondMeter = new BondMeter(this.stage);
    this.disposables.push(this.bondMeter);
    this.controls.push({
      kind: "bond",
      panel: this.bondMeter.panel,
      index: 0,
      tip: () => bondTip(this.bondMeter.points),
      locked: () => false,
      activate: () => {},
      paint: ({ focused, focusVisible }) => this.bondMeter.paint(focused && focusVisible),
      update: () => {},
      dispose: () => {},
    });
    for (const [index, id] of starterOrder.entries()) this.tile(id, index);
    this.columnContent.add(
      stack(this.ribbon, 2),
      stack(this.meta, 3),
      stack(this.chain, 1),
      this.divider,
      stack(this.roster, 1),
      stack(this.belt, 1),
    );
    this.belt.add(this.backpack);
    this.rulesKey = new RulesKey(this.stage);
    this.rulesKey.panel.setProperties({ marginRight: "auto" });
    const modes = modeKeys(this.stage);
    modes.row.setProperties({ marginLeft: 10, marginRight: 10 });
    this.route.add(this.rulesKey.panel, modes.row, this.routeMap.panel, this.towerRecord.panel);
    this.controls.push(this.keyControl("rules", this.rulesKey, () => this.openRules()));
    for (const [index, key] of modes.keys.entries()) {
      const mode = modeOrder[index]!;
      const reason = () => (mode === "tower" ? towerLock(this.progress) : null);
      const base = this.keyControl("mode", key, () => {
        if (reason() || this.mode === mode) return;
        this.mode = mode;
        getAudio().sfx("ui-move");
        this.paintMode();
        this.changed();
      });
      const control: Control = {
        ...base,
        index,
        tip: reason,
        locked: () => reason() !== null,
        paint: (state) => {
          key.set(this.mode === mode, reason() !== null);
          base.paint(state);
        },
      };
      this.controls.push(control);
      this.modes.push(control);
    }
    this.column.add(this.columnContent);

    // Bottom right: the route, then the difficulty tray and 出发.
    const tray = segmentTray();
    this.disposables.push(tray);
    for (const [index, def] of difficulties.entries())
      this.segment(tray.tray, def.name, index as Difficulty);
    this.startButton = new GameButton(this.stage, { tone: "primary", size: "cta", label: "出发" });
    this.keyed.push(this.startButton);
    this.go.add(tray.tray, this.startButton.panel);
    this.controls.push(this.keyControl("start", this.startButton, () => this.depart()));

    this.stage.root.add(
      stack(this.trainerBox, 1),
      stack(this.legal, 1),
      stack(this.route, 1),
      stack(this.go, 2),
      stack(this.column, 2),
      stack(this.corner, 3),
      stack(this.tabs, 3),
      stack(this.challenge.root, 10),
    );
    this.buildPartner();
    this.paintRules();
    this.paintMode();
  }

  /** The world scene this lobby lays out and themes (absent on the host's warm-up copies). */
  attachScene(scene: LobbyScene): void {
    this.scene = scene;
    this.placed = "";
    const form = starters[this.selected].stages[0].form;
    scene.show(form.id, form.types[0]!, this.wears(this.selected));
    scene.showTrainer(this.trainer);
    scene.setCovered(this.covered || !this.revealed);
  }

  // ── Controls ────────────────────────────────────────────────────────────────────────────────

  private switchButton(step: -1 | 1): ArrowButton {
    const button = new ArrowButton(this.stage, step < 0 ? "left" : "right");
    button.panel.setProperties({ positionType: "absolute" });
    this.stage.root.add(stack(button.panel, 1));
    this.controls.push(this.keyControl(step < 0 ? "prev" : "next", button, () => this.cycle(step)));
    return button;
  }

  setFullscreenAction(action: (() => void) | undefined, active: boolean): void {
    if (this.fullscreenIcon.setActive(active)) this.stage.invalidate();
    if (this.toggleFullscreen === action) return;
    this.toggleFullscreen = action;
    this.fullscreen.panel.setProperties({ display: action ? "flex" : "none" });
    if (!action && this.controls[this.focused]?.kind === "fullscreen")
      this.focus(this.index("settings"));
    this.stage.invalidate();
  }

  private keyControl(kind: ControlKind, button: Keyed, activate: () => void): Control {
    if (!this.keyed.includes(button)) this.keyed.push(button);
    return {
      kind,
      panel: button.panel,
      index: 0,
      tip: () => null,
      locked: () => false,
      activate,
      paint: ({ hovered, focused, focusVisible, pressed }) => {
        button.setHovered(hovered);
        button.setFocused(focused);
        button.setFocusVisible(focusVisible);
        // Departing holds 出发 down until the run's cover takes the screen.
        button.setPressed(pressed || (kind === "start" && this.departing));
      },
      update: () => {},
      dispose: () => {},
    };
  }

  /** Trainer portraits stay visible; a locked tile previews its silhouette without selecting it. */
  private buildTrainers(): void {
    for (const [index, id] of trainerOrder.entries()) {
      const panel = new Container({
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        padding: 4,
      });
      const plate = new SlantPlate(panel, {
        fill: trainers[id].color,
        border: { color: ui.ink, width: 2 },
        upright: true,
      });
      const portrait = new Image({
        src: trainerArt(id),
        width: "100%",
        height: "100%",
        borderRadius: 3,
      });
      panel.add(plate.content, stack(portrait, 1));
      this.avatars.add(panel);
      this.avatarBoxes.push(panel);
      const pose = { lift: 0 };
      let target = -1;
      const control: Control = {
        kind: "trainer",
        panel,
        index,
        tip: () => null,
        locked: () => !trainerUnlocked(this.progress, id),
        activate: () => {
          if (!trainerUnlocked(this.progress, id)) {
            this.trainerPreview = id;
            this.showTrainer();
            return;
          }
          if (this.trainer === id && !this.trainerPreview) return;
          this.trainerPreview = null;
          this.trainer = id;
          getAudio().sfx("ui-confirm");
          this.showTrainer();
          this.changed();
        },
        paint: ({ hovered, focused, focusVisible, pressed }) => {
          const chosen = this.trainer === id;
          const locked = !trainerUnlocked(this.progress, id);
          portrait.setProperties({ src: trainerArt(id, locked ? "portrait-locked" : "portrait") });
          plate.set({
            fill: chosen ? ui.white : locked ? ui.line : trainers[id].color,
            focus: focused && focusVisible ? 1 : 0,
          });
          const lift = pressed ? -LIFT.press : chosen ? LIFT.picked : hovered ? LIFT.hover : 0;
          if (lift === target) return;
          target = lift;
          this.stage.motion.animate(
            pose,
            { lift },
            LIFT.ms,
            () => {
              panel.setProperties({ transformTranslateY: -pose.lift });
              plate.set({ depth: HARD_SHADOW.offset + pose.lift });
              this.stage.invalidate();
            },
            SNAP,
          );
        },
        update: () => {},
        dispose: () => {
          this.stage.motion.cancel(pose);
          plate.dispose();
        },
      };
      this.trainerControls.push(control);
      this.controls.push(control);
    }
  }

  /** A roster badge: the partner's portrait over a Poké Ball; its silhouette until it joins. */
  private tile(id: StarterId, index: number): void {
    const form = starters[id].stages[0].form;
    const type = themeColors(form.types[0]!).theme;
    const badge = new BallBadge(this.stage.motion, () => this.stage.invalidate(), 56);
    badge.portrait(portraitSrc(form.id, this.wears(id)));
    const entry = { x: 0, o: 1 };
    this.badges.push({ badge, entry });
    this.roster.add(badge.panel);
    const control: Control = {
      kind: "tile",
      panel: badge.panel,
      index,
      // A partner not yet joined says what it still needs.
      tip: () => starterLock(this.progress, id) ?? form.name,
      locked: () => !starterUnlocked(this.progress, id),
      activate: () => this.pick(id),
      paint: ({ hovered, focused, focusVisible, pressed }) => {
        const locked = control.locked();
        const cleared = !locked && !!this.progress.best[id]?.victory;
        badge.setPortrait(portraitSrc(form.id, this.wears(id)));
        badge.set({
          selected: id === this.selected,
          silhouette: locked,
          hovered,
          focused,
          focusVisible,
          pressed,
          type,
          mark: cleared ? "clear" : null,
        });
      },
      update: () => {},
      dispose: () => badge.dispose(),
    };
    this.controls.push(control);
    this.tiles.push(control);
  }

  /** A difficulty option on the ink tray. */
  private segment(tray: Container, label: string, value: Difficulty): void {
    const face = new SegmentFace(this.stage, label);
    tray.add(stack(face.panel, 1));
    const reason = () => difficultyLock(this.progress, value);
    const control: Control = {
      kind: "difficulty",
      panel: face.panel,
      index: value,
      tip: reason,
      locked: () => reason() !== null,
      activate: () => {
        if (reason() || this.difficulty === value) return;
        this.difficulty = value;
        getAudio().sfx("ui-move");
        this.changed();
      },
      paint: (state) =>
        face.paint({ ...state, checked: this.difficulty === value, locked: control.locked() }),
      update: (deltaMs) => face.update(deltaMs),
      dispose: () => face.dispose(),
    };
    this.keyed.push({
      panel: face.panel,
      fitTouch: () => face.fitTouch(),
      setHovered() {},
      setFocused() {},
      setFocusVisible() {},
      setPressed() {},
      dispose() {},
    });
    this.controls.push(control);
    this.segments.push(control);
  }

  /** One press: 出发 holds down and input locks until the run's cover. */
  private depart(): void {
    if (this.departing || this.previewing()) return;
    this.departing = true;
    this.repaint();
    this.callbacks.start({
      mode: this.mode,
      starter: this.selected,
      difficulty: this.difficulty,
      stage: this.map,
      trainer: this.trainer,
    });
  }

  // ── Pick ────────────────────────────────────────────────────────────────────────────────────

  /** A joined partner becomes the pick; one not yet joined cannot be picked. */
  private pick(id: StarterId): void {
    if (id === this.selected || !starterUnlocked(this.progress, id)) return;
    this.selected = id;
    getAudio().sfx("ui-move");
    this.showPartner();
    this.ribbonPlate?.enter(0);
    this.changed();
  }

  /** A locked trainer is on show: 出发 waits, as the stage is not what would leave. */
  private previewing(): boolean {
    return this.trainerPreview !== null;
  }

  /** The selected partner's plate, column and model (in the look it wears). */
  private showPartner(): void {
    const form = starters[this.selected].stages[0].form;
    this.buildPartner();
    this.paintMode();
    this.scene?.show(form.id, form.types[0]!, this.wears(this.selected));
  }

  private owns(id: StarterId): boolean {
    return this.progress.looks.owned.includes(id);
  }

  private wears(id: StarterId): boolean {
    return this.progress.looks.worn.includes(id);
  }

  /** Asks for the picked partner's shiny look (`worn` from a direction, none to toggle); the app
   *  saves it once its pictures are in and the new progress repaints the stage, medal and chain. */
  private requestShiny(worn?: boolean): void {
    const line = this.selected;
    if (!this.owns(line)) return;
    this.callbacks.shiny(line, worn);
  }

  /**
   * The app saved a look this lobby asked for (after its pictures loaded): the key pops once it
   * shows that look. Imports, failures and cancels never call it, so they change without a pop.
   */
  lookSaved(line: StarterId, worn: boolean): void {
    if (worn && line === this.selected && this.wears(line)) this.shinyKey.popSpark();
  }

  /** The next (previous) partner that has joined, wrapping. */
  private cycle(step: -1 | 1): void {
    const open = starterOrder.filter((id) => starterUnlocked(this.progress, id));
    if (open.length < 2) return;
    const at = open.indexOf(this.selected);
    this.pick(open[(at + step + open.length) % open.length]!);
  }

  private changed(): void {
    this.callbacks.pick({
      mode: this.mode,
      starter: this.selected,
      difficulty: this.difficulty,
      stage: this.map,
      trainer: this.trainer,
    });
    this.repaint();
  }

  /** The trainer's name, the scene's slab and art; their entrance replays. */
  private showTrainer(): void {
    const id = this.trainerPreview ?? this.trainer;
    const locked = !trainerUnlocked(this.progress, id);
    this.trainerPlate.setName(trainers[id].name);
    const count = (n: number) => n.toLocaleString("en-US");
    this.trainerLock.set(
      locked ? `${count(this.progress.kills)} / ${count(XIAQING_UNLOCK_KILLS)}` : null,
    );
    this.trainerPlate.enter(180);
    this.scene?.showTrainer(id, locked);
    this.trainerKit.set(id);
    this.repaint();
  }

  /** The selected partner's name plate, tag and record, evolution chain and the backpack. */
  private buildPartner(): void {
    for (let i = this.controls.length - 1; i >= 0; i--)
      if (this.controls[i]!.kind === "info") this.controls.splice(i, 1);
    for (const part of this.partnerParts.splice(0)) part.dispose();
    // The shiny key and the bond outlive the partner's parts.
    this.shinyKey.panel.removeFromParent();
    this.bondMeter.panel.removeFromParent();
    for (const node of [this.ribbon, this.meta, this.chain, this.backpack])
      for (const child of node.children.slice()) {
        child.removeFromParent();
        disposeTree(child);
      }
    this.carryTips.length = 0;
    const t = tokens(this.compact);
    const shown = this.selected;
    const starter = starters[shown];
    const form = starter.stages[0].form;
    const type = form.types[0]!;
    const { theme, deep } = themeColors(type);
    // The name plate: the type colour with its card face, the name in white over a deep copy.
    const plate = new NamePlate(
      this.stage,
      { fill: theme, card: { type, loaded: () => this.stage.invalidate() } },
      form.name,
      deep,
    );
    plate.size(t.ribbon, t.name, this.compact ? 18 : 24);
    this.partnerParts.push(plate);
    this.ribbonPlate = plate;
    // The shiny key stands before the name it recolours, only once the look is owned.
    const owned = this.owns(shown);
    this.shinyKey.panel.setProperties({ display: owned ? "flex" : "none" });
    this.shinyKey.setOn(owned && this.wears(shown));
    this.ribbon.add(this.shinyKey.panel, plate.panel);
    if (!owned && this.controls[this.focused]?.kind === "shiny")
      this.focused = this.picked(this.tiles, starterOrder.indexOf(shown));
    // The bond leads the chain's row (the tag row when compact), across from the forms.
    this.bondMeter.panel.setProperties({ marginRight: "auto" });
    if (this.compact) this.meta.add(this.bondMeter.panel);
    else this.chain.add(this.bondMeter.panel);
    this.bondMeter.set(this.progress.bonds[shown] ?? 0);
    // The type tag (crest + name), then the best record on desktop.
    const tag = typeTag(type, this.compact ? 12 : 14);
    this.partnerParts.push(tag);
    this.meta.add(tag.tag);
    const record = this.progress.best[shown];
    if (record && !this.compact)
      this.meta.add(
        new Text({
          text: `最佳 ${difficulties[record.difficulty].name} · ${record.victory ? "通关" : "坚持"} ${formatTime(record.time)}`,
          fontSize: 15,
          fontWeight: 800,
          color: ui.ink,
          whiteSpace: "pre",
        }),
      );
    // The evolution chain: the line's forms in circles, the partner's own ringed in its colour.
    const forms = starter.stages.flatMap((s) => (s.kind === "evolve" && s.form ? [s.form] : []));
    // One block, so a tight row (a long bond title) moves the whole chain onto a line of its own.
    const chainHost = new Container({
      flexDirection: "row",
      alignItems: "center",
      flexShrink: 0,
      marginLeft: "auto",
      gap: 8,
    });
    (this.compact ? this.meta : this.chain).add(chainHost);
    this.chain.setProperties({ display: this.compact ? "none" : "flex" });
    for (const [i, step] of forms.entries()) {
      if (i > 0) {
        const arrow = createTriangleMark(CHAIN_ARROW);
        arrow.setProperties({ width: 6, height: 9 });
        chainHost.add(arrow);
      }
      const circle = new Container({
        width: t.chain,
        height: t.chain,
        borderRadius: 999,
        borderWidth: i === 0 ? 3 : 2,
        borderColor: i === 0 ? theme : ui.line,
        backgroundColor: ui.white,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      });
      circle.add(
        new Image({ src: portraitSrc(step.id, this.wears(shown)), width: "84%", height: "84%" }),
      );
      chainHost.add(circle);
    }
    // The backpack: its label and only the items packed; nothing when empty.
    const carried = this.progress.backpack;
    this.backpack.setProperties({ display: carried.length ? "flex" : "none" });
    if (carried.length > 0) {
      const label = slantTag("背包", { face: ui.ink, size: 12, upright: true });
      this.partnerParts.push(label);
      this.backpack.add(label.tag);
      for (const item of carried) {
        const slot = new Container({
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        });
        const face = new SlantPlate(slot, {
          fill: ui.white,
          border: { color: ui.line, width: 2 },
          upright: true,
        });
        face.set({ depth: 3 });
        this.partnerParts.push(face);
        slot.add(
          face.content,
          stack(new Image({ src: `/art/icons/items/${item}.webp`, width: 30, height: 30 }), 1),
        );
        this.backpack.add(slot);
        this.carryTips.push({ panel: slot, item });
        this.infoControl(slot, face, () => items[item].name);
      }
    }
    this.applySizes();
    this.repaint();
  }

  private infoControl(panel: Container, face: SlantPlate, tip: () => string): void {
    const control: Control = {
      kind: "info",
      panel,
      index: 0,
      tip,
      locked: () => false,
      activate: () => {
        this.touchTip = this.controls.indexOf(control);
      },
      paint: ({ focused, focusVisible, hovered }) =>
        face.set({
          focus: focused && focusVisible ? 1 : 0,
          border: hovered ? ui.ink : ui.line,
        }),
      update() {},
      dispose() {},
    };
    this.controls.push(control);
  }

  // ── State ──────────────────────────────────────────────────────────────────────────────────

  update(state: LobbyState): void {
    const changed = state.progress !== this.progress;
    this.progress = state.progress;
    this.balanceText.setProperties({ text: counts.format(state.progress.stardust) });
    if (state.pick.starter !== this.selected) {
      this.selected = state.pick.starter;
      this.showPartner();
    } else if (changed) this.showPartner();
    this.difficulty = state.pick.difficulty;
    this.mode = state.pick.mode;
    this.map = "forest";
    this.rules = state.rules;
    this.paintRules();
    this.paintMode();
    if (state.pick.trainer !== this.trainer || (changed && this.trainerPreview)) {
      this.trainerPreview = null;
      this.trainer = state.pick.trainer;
      this.showTrainer();
    }
    this.repaint();
  }

  /** Before the first screen's text has arrived only the scene shows (the boot screen). */
  setRevealed(revealed: boolean): void {
    if (revealed === this.revealed) return;
    this.revealed = revealed;
    this.stage.root.visible = revealed;
    this.coverScene();
    this.stage.invalidate();
  }

  /** A window or screen lies over the lobby: its scene and loops hold still. */
  setCovered(covered: boolean): void {
    if (covered === this.covered) return;
    this.covered = covered;
    this.coverScene();
  }

  /** The scene holds still under a screen, before the reveal and under the rules window. */
  private coverScene(): void {
    this.scene?.setCovered(this.covered || !this.revealed || this.challenge.open);
  }

  /** The rules are open once the first 普通 clear makes any of them available. */
  private rulesOpen(): boolean {
    return ruleIds.some((id) => ruleAvailable(this.progress, id));
  }

  private paintRules(): void {
    const open = this.rulesOpen();
    this.rulesKey.panel.setProperties({ display: open ? "flex" : "none" });
    this.rulesKey.setDanger(totalDanger(this.rules));
    if (!open && this.controls[this.focused]?.kind === "rules") this.focused = this.index("start");
    this.challenge.update(this.context());
    this.stage.invalidate();
  }

  /** The route map in 探险; the partner's best floor in 对战塔. */
  private paintMode(): void {
    const tower = this.mode === "tower";
    this.routeMap.panel.setProperties({ display: tower ? "none" : "flex" });
    this.towerRecord.set(this.progress, this.selected, tower);
    this.stage.invalidate();
  }

  private context() {
    return {
      selected: this.rules,
      difficulty: this.difficulty,
      owned: this.progress.badges,
      available: (id: RuleId) => ruleAvailable(this.progress, id),
    };
  }

  private openRules(): void {
    if (!this.rulesOpen() || this.challenge.open) return;
    getAudio().sfx("ui-confirm");
    this.tooltip.show(null, "");
    this.challenge.setFocusVisible(this.focusVisible);
    this.challenge.show(this.context());
    this.coverScene();
    this.repaint();
  }

  private repaint(): void {
    this.startButton.setDisabled(this.previewing());
    for (const [i, control] of this.controls.entries())
      control.paint({
        hovered: i === this.hovered,
        focused: i === this.focused,
        focusVisible: this.focusVisible,
        pressed: i === this.pressed,
      });
    this.stage.invalidate();
  }

  resize(width: number, height: number, scale: number, safe: UiInsets): void {
    this.stage.resize(width, height, scale, safe);
    const v = this.stage.viewport;
    const compact = v.height <= 600 && v.width > v.height;
    const rebuild = compact !== this.compact;
    this.compact = compact;
    if (rebuild) this.buildPartner();
    this.applySizes();
    this.sizeChallenge();
    this.placed = "";
    this.repaint();
  }

  /** Roster badge size and gap: touch-sized, five to a row. */
  private rosterSize(): { badge: number; gap: number } {
    const t = tokens(this.compact);
    return { badge: Math.max(t.badge, this.stage.viewport.minTarget), gap: t.badgeGap };
  }

  private colW(): number {
    const { badge, gap } = this.rosterSize();
    return PER_ROW * badge + (PER_ROW - 1) * gap;
  }

  private pads() {
    const t = tokens(this.compact);
    const s = this.stage.viewport.safeArea;
    return {
      left: Math.max(t.edge, s.left),
      right: Math.max(t.edge, s.right),
      top: Math.max(t.top, s.top),
      bottom: Math.max(t.bottom, s.bottom),
    };
  }

  /** Sizes for the current viewport; positions that depend on measured boxes follow in `place`. */
  private applySizes(): void {
    const v = this.stage.viewport;
    const t = tokens(this.compact);
    const pad = this.pads();
    const min = v.minTarget;
    for (const button of this.keyed) button.fitTouch();
    for (const button of [this.prev, this.next])
      button.panel.setProperties({ minWidth: Math.max(40 + slantOf(44), min) });
    // The tabs and the corner share one top inset and one row height (set in `place`).
    this.tabs.setProperties({
      positionLeft: pad.left,
      positionTop: pad.top,
      gap: t.gap,
      minHeight: 0,
    });
    this.balance.setProperties({ height: this.compact ? 34 : 38 });
    for (const word of this.brandWords) word.setProperties({ fontSize: t.brand });
    this.corner.setProperties({
      positionRight: pad.right,
      positionTop: pad.top,
      gap: this.compact ? 14 : 18,
      minHeight: 0,
    });
    this.keys.setProperties({ gap: 8 });
    this.trainerPlate.size(t.plate, t.plateText, this.compact ? 18 : 22);
    this.trainerBox.setProperties({ positionLeft: pad.left, positionBottom: pad.bottom, gap: 10 });
    this.avatars.setProperties({ gap: this.compact ? 8 : 10 });
    this.trainerHead.setProperties({ gap: this.compact ? 8 : 10 });
    this.trainerLock.size(t.plate, this.compact);
    this.trainerKit.size(t.plate, this.compact, min);
    const avatar = Math.max(t.avatar, min);
    for (const box of this.avatarBoxes) box.setProperties({ width: avatar, height: avatar });
    const colW = this.colW();
    this.column.setProperties({
      positionRight: pad.right - COLUMN_ROOM,
      width: colW + COLUMN_ROOM * 2,
    });
    this.ribbonPlate?.size(t.ribbon, t.name, this.compact ? 18 : 24);
    // Its row's height: the compact tag row's forms, or the desktop chain.
    this.bondMeter.size(this.compact, min, t.chain);
    this.meta.setProperties({
      marginTop: t.section,
      flexShrink: 0,
      flexWrap: "wrap",
      gapColumn: this.compact ? 8 : 10,
      gapRow: t.section,
    });
    this.chain.setProperties({
      marginTop: t.section,
      flexShrink: 0,
      flexWrap: "wrap",
      gapRow: t.section,
    });
    this.divider.setProperties({ marginTop: t.section, marginBottom: t.section + 4 });
    const { badge, gap } = this.rosterSize();
    this.roster.setProperties({ width: colW, gap, flexShrink: 0 });
    for (const { badge: b } of this.badges)
      b.panel.setProperties({ width: badge, height: badge, minWidth: badge, minHeight: badge });
    this.backpack.setProperties({ flexShrink: 0 });
    for (const control of this.controls)
      if (control.kind === "info")
        control.panel.setProperties({
          width: Math.max(t.slot, min),
          height: Math.max(t.slot, min),
        });
    this.towerRecord.size(this.compact);
    // The row keeps the route map's height in 对战塔 too, so the mode keys hold still under a press.
    this.route.setProperties({ minHeight: 2 * t.swatch + t.pairGap });
    this.routeMap.resize({ swatch: t.swatch, column: t.tierGap, row: t.pairGap, links: true });
    // The tray and 出发 span the column's width: one block with the column above it.
    this.go.setProperties({
      positionRight: pad.right,
      positionBottom: pad.bottom,
      gap: 12,
      minWidth: this.compact ? 0 : colW,
    });
    this.startButton.panel.setProperties({ flexGrow: 1 });
    // Compact: the route shares the column's last row with the backpack (no room above the tray).
    const routeHome = this.compact ? this.belt : this.stage.root;
    if (this.route.parentContainer.value !== routeHome) {
      this.route.removeFromParent();
      this.backpack.removeFromParent();
      if (this.compact) this.belt.add(this.route, this.backpack);
      else {
        this.belt.add(this.backpack);
        this.stage.root.add(stack(this.route, 1));
      }
    }
    // The belt carries the backpack's old top margin; a packed backpack keeps to the right.
    this.belt.setProperties({
      display: this.compact || this.progress.backpack.length > 0 ? "flex" : "none",
      width: colW,
      marginTop: t.section + 2,
      gapRow: 6,
      gapColumn: 8,
    });
    this.backpack.setProperties({ marginTop: 0, marginLeft: "auto" });
    this.route.setProperties(
      this.compact
        ? { positionType: "relative", positionRight: 0, marginTop: 0, flexShrink: 0, minWidth: 0 }
        : { positionType: "absolute", positionRight: pad.right, marginTop: 0, minWidth: colW },
    );
    this.legalLaid = "";
  }

  /** After layout: the legal line, the column's height, ‹ › and the scene's layout. */
  private place(): void {
    const v = this.stage.viewport;
    const t = tokens(this.compact);
    const pad = this.pads();
    const goS = this.go.size.value,
      boxS = this.trainerBox.size.value,
      cornerS = this.corner.size.value,
      tabsS = this.tabs.size.value,
      routeS = this.route.size.value,
      contentS = this.columnContent.size.value;
    const font = this.legal.fontSignal.value;
    if (!goS || !boxS || !cornerS || !tabsS || !routeS || !contentS || !font) return;
    const colW = this.colW();
    const colX = v.width - pad.right - colW;
    const goTop = v.height - pad.bottom - goS[1];
    const routeTop = goTop - 12 - routeS[1];
    // The legal line: in the gap between the trainer and the bottom-right block, else (narrow)
    // at the column's end.
    const legalSize = this.compact ? 10 : 11;
    const blockLeft = v.width - pad.right - Math.max(goS[0], this.compact ? 0 : routeS[0]);
    // Clear of the trainer's portraits and of the slab, whose edge leans left going down.
    const slab = Math.round(v.width * (this.compact ? 0.3 : 0.4375));
    const slabFoot = slab - v.height * Math.tan((14 * Math.PI) / 180) + 28;
    const legalLeft = Math.max(pad.left + boxS[0], slabFoot) + 2 * t.gap + 8;
    const legalRoom = blockLeft - 2 * t.gap - 8 - legalLeft;
    const inColumn = legalRoom < 180;
    const legalWidth = inColumn ? colW : legalRoom;
    const legalKey = `${inColumn},${Math.round(legalWidth)},${legalSize}`;
    if (legalKey !== this.legalLaid) {
      this.legalLaid = legalKey;
      this.legalInColumn = inColumn;
      const home = inColumn ? this.columnContent : this.stage.root;
      if (this.legal.parentContainer.value !== home) {
        this.legal.removeFromParent();
        home.add(this.legal);
      }
      this.legal.setProperties({
        fontSize: legalSize,
        textAlign: inColumn ? "right" : "center",
        text:
          textWidth(LEGAL_NOTICE, legalSize, font) <= legalWidth
            ? LEGAL_NOTICE
            : balanceLines(LEGAL_NOTICE, legalWidth, legalSize, font),
        ...(inColumn
          ? {
              positionType: "relative",
              positionLeft: 0,
              positionBottom: 0,
              marginTop: t.section + 4,
              width: colW,
            }
          : {
              positionType: "absolute",
              marginTop: 0,
              width: legalRoom,
              positionLeft: legalLeft,
              positionBottom: pad.bottom,
            }),
      });
      return;
    }
    const legalS = this.legal.size.value;
    if (!legalS) return;
    const key = [
      v.width,
      v.height,
      v.scale,
      colW,
      this.compact,
      ...goS,
      ...boxS,
      ...cornerS,
      ...tabsS,
      ...routeS,
      ...contentS,
      ...legalS,
    ].join(",");
    if (key === this.placed) return;
    this.placed = key;
    // One row height for the tabs and the corner, so their centres line up.
    const barH = Math.max(tabsS[1], cornerS[1]);
    if (tabsS[1] !== barH) this.tabs.setProperties({ minHeight: barH });
    if (cornerS[1] !== barH) this.corner.setProperties({ minHeight: barH });
    const barBottom = pad.top + barH;
    // The column's box reaches COLUMN_ROOM past its rows and clips there: both edges stay 4 or
    // more clear of the top bar and of the block below (出发 on a phone, the route otherwise), so
    // scrolled rows never draw over them.
    const top = barBottom + (this.compact ? COLUMN_ROOM + 4 : 20);
    const bottom = (this.compact ? goTop : routeTop) - COLUMN_ROOM - 4;
    const maxH = bottom - top + 2 * COLUMN_ROOM;
    this.column.setProperties({
      positionTop: top - COLUMN_ROOM,
      maxHeight: maxH,
      overflow: contentS[1] + COLUMN_ROOM * 2 > maxH ? "scroll" : "visible",
    });
    if (!this.compact) this.route.setProperties({ positionTop: routeTop });
    this.reveal();
    // The scene: the slab, the trainer, the ball stage between the slab and the column.
    const floor = this.legalInColumn ? v.height - pad.bottom : v.height - pad.bottom - legalS[1];
    const lean = Math.tan((14 * Math.PI) / 180);
    const clear = 28;
    const zoneR = colX - (this.compact ? 16 : 24);
    const side = Math.max(44, v.minTarget);
    const arrowW = Math.max(40 + slantOf(44), v.minTarget);
    // The partner fills the height down to the ball, which stands above the legal line.
    let feetY = Math.min((this.compact ? 0.66 : 0.68) * v.height, floor - 34);
    const heroH = Math.min(0.46 * v.height, (feetY - barBottom - 12) * 0.9);
    // ‹ › flank the partner's lower body, clear of the slab's edge at their own height and of
    // the trainer's reach above it; the stage is centred between them.
    const arrowY = feetY - 0.2 * heroH - side / 2;
    const zoneL = slab - arrowY * lean + clear;
    const cx = (zoneL + zoneR) / 2;
    // The ball's dashed rim (1.22 rx) stays clear of the slab at the ball's own height.
    const rx = Math.min(
      220,
      (cx - (slab - feetY * lean) - clear) / 1.22,
      (zoneR - zoneL) / 2 / (this.compact ? 1.12 : 1),
    );
    feetY = Math.min(feetY, floor - 0.42 * rx);
    // The partner may pass behind half of each arrow: its widest part is rarely at their height.
    const heroW = zoneR - zoneL - arrowW - 16;
    this.zone = { x: zoneL, y: barBottom + 8, r: zoneR, b: v.height - pad.bottom };
    this.prev.panel.setProperties({ positionLeft: zoneL, positionTop: arrowY });
    this.next.panel.setProperties({ positionLeft: zoneR - arrowW, positionTop: arrowY });
    const s = v.scale;
    this.scene?.setLayout({
      width: v.width * s,
      height: v.height * s,
      slab: slab * s,
      trainer: {
        x: slab * (this.compact ? 0.38 : 0.45) * s,
        y: (this.compact ? 0.14 : 0.12) * v.height * s,
        h: (this.compact ? 1.3 : 1.325) * v.height * s,
        // A reaching hand stays out of the partner's space beyond the arrows.
        right: (zoneL + arrowW) * s,
      },
      feet: { x: cx * s, y: feetY * s },
      rx: rx * s,
      heroW: heroW * s,
      heroH: heroH * s,
    });
  }

  /** The first frame the lobby shows: the plates unroll, the column's rows slide in. */
  private enter(): void {
    this.entered = true;
    this.trainerPlate.enter(180);
    this.ribbonPlate?.enter(180);
    const rows = [this.meta, this.chain, this.backpack];
    for (const [i, row] of rows.entries()) this.slideIn(row, { x: 0, o: 1 }, stagger(i, 45, 120));
    for (const [i, { badge, entry }] of this.badges.entries())
      this.slideIn(badge.panel, entry, stagger(i, 45, 200));
  }

  private slideIn(node: Container, pose: { x: number; o: number }, delay: number): void {
    this.stage.motion.enter(
      pose,
      { x: -60, o: 0 },
      { x: 0, o: 1 },
      380,
      () => {
        fade(node, pose.o).setProperties({ transformTranslateX: pose.x });
        this.stage.invalidate();
      },
      EASE,
      delay,
    );
  }

  // ── Input ──────────────────────────────────────────────────────────────────────────────────

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

  private inZone(x: number, y: number): boolean {
    const k = this.stage.viewport.scale;
    const z = this.zone;
    return x / k >= z.x && x / k <= z.r && y / k >= z.y && y / k <= z.b;
  }

  hit(x: number, y: number): number {
    if (!this.revealed || this.departing) return -1;
    if (this.challenge.open) return this.challenge.hit(x, y);
    for (let i = this.controls.length - 1; i >= 0; i--) {
      const control = this.controls[i]!;
      // The column clips its rows: one scrolled out of it is not there.
      if (this.columnRow(control.kind) && !this.contains(this.column, x, y)) continue;
      if (this.contains(control.panel, x, y)) return i;
    }
    return this.contains(this.column, x, y) && (this.column.maxScrollPosition.value[1] ?? 0) > 0
      ? this.controls.length
      : -1;
  }

  focus(index: number): void {
    if (this.challenge.open) return this.challenge.focus(index);
    if (index === this.focused) return;
    this.focused = index;
    this.reveal();
    this.repaint();
  }

  hover(index: number | null): void {
    if (this.challenge.open) return this.challenge.hover(index);
    this.hovered = index ?? -1;
    this.repaint();
  }

  setPressed(index: number | null): void {
    if (this.challenge.open) return this.challenge.setPressed(index);
    this.pressed = index ?? -1;
    this.repaint();
  }

  activate(index: number): void {
    if (this.departing) return;
    if (this.challenge.open) return this.challenge.activate(index);
    this.controls[index]?.activate();
  }

  private reveal(): void {
    const control = this.controls[this.focused];
    if (control && this.columnRow(control.kind))
      revealInScroller(control.panel, this.column, COLUMN_ROOM);
  }

  /** Rows inside the clipped column: the roster and backpack, and on short screens the route row
   *  (规则 with it). */
  private columnRow(kind: ControlKind): boolean {
    return inColumn(kind) || ((kind === "rules" || kind === "mode") && this.compact);
  }

  /** The column scrolls; the wheel over the stage switches partner, one per step. */
  scroll(delta: number): void {
    const at = this.pointer;
    if (this.departing || this.challenge.open) return;
    if (
      this.columnDrag ||
      currentInputMode().kind === "gamepad" ||
      (at && this.contains(this.column, at.x, at.y))
    ) {
      const [x, y] = this.column.scrollPosition.value;
      this.column.scrollPosition.value = [
        x,
        Math.max(
          0,
          Math.min(
            this.column.maxScrollPosition.value[1] ?? 0,
            y + delta / this.stage.viewport.scale,
          ),
        ),
      ];
      // The rows moved under the resting mouse: its tip waits for the next move.
      this.touchTip = this.hoveredTip = -1;
      this.tipPress = null;
      this.stage.invalidate();
      return;
    }
    if (!at || !this.inZone(at.x, at.y)) return;
    this.wheel += delta;
    if (Math.abs(this.wheel) < WHEEL_STEP) return;
    this.cycle(this.wheel > 0 ? 1 : -1);
    this.wheel = 0;
  }

  setFocusVisible(visible: boolean): void {
    this.challenge.setFocusVisible(visible);
    if (visible === this.focusVisible) return;
    this.focusVisible = visible;
    // Keyboard or pad took over: the tip follows focus, not where the mouse last rested.
    if (visible) this.hoveredTip = -1;
    this.repaint();
  }

  setCoarsePointer(coarse: boolean): void {
    if (coarse !== this.coarse) {
      this.coarse = coarse;
      this.hoveredTip = -1;
      this.sizeChallenge();
    }
  }

  /** The rules window inside the safe area, with room for its focus ring. */
  private sizeChallenge(): void {
    const v = this.stage.viewport;
    const s = v.safeArea;
    this.challenge.resize(
      this.compact,
      this.coarse,
      v.width - Math.max(16, s.left) - Math.max(16, s.right),
      v.height - Math.max(16, s.top) - Math.max(16, s.bottom),
    );
  }

  /** Opens on 出发, the lobby's one action. */
  focusStart(): void {
    this.focus(this.index("start"));
  }

  /** Back from the 图鉴 page: on the key that opened it. */
  focusCodex(): void {
    this.focus(this.index("codex"));
  }

  private stops(kind: ControlKind): number[] {
    return this.controls.flatMap((control, index) => (control.kind === kind ? [index] : []));
  }

  private index(kind: ControlKind): number {
    return this.controls.findIndex((c) => c.kind === kind);
  }

  private group(control: Control): Control[] | null {
    return control.kind === "tile"
      ? this.tiles
      : control.kind === "difficulty"
        ? this.segments
        : control.kind === "trainer"
          ? this.trainerControls
          : control.kind === "mode"
            ? this.modes
            : null;
  }

  private picked(list: Control[], index: number): number {
    return this.controls.indexOf(list.find((c) => c.index === index)!);
  }

  /** The top row, left to right: the tabs, the links, 设置, 全屏. */
  private topRow(): number[] {
    return [
      this.index("lab"),
      this.index("codex"),
      this.index("multiplayer"),
      ...this.stops("link"),
      this.index("settings"),
      ...(this.toggleFullscreen ? [this.index("fullscreen")] : []),
    ];
  }

  /** The shiny key, while the picked partner's look is owned. */
  private shinyStop(): number[] {
    return this.owns(this.selected) ? [this.index("shiny")] : [];
  }

  /** Tab stops: the top row, the trainer's kit, the picked trainer, ‹ ›, the shiny key, the picked partner, the
   *  backpack, the picked difficulty, 出发. */
  private tabStops(): number[] {
    return [
      ...this.topRow(),
      this.index("kit"),
      this.picked(this.trainerControls, trainerOrder.indexOf(this.trainer)),
      this.index("prev"),
      this.index("next"),
      ...this.shinyStop(),
      this.index("bond"),
      this.picked(this.tiles, starterOrder.indexOf(this.selected)),
      ...this.stops("info"),
      ...this.rulesStop(),
      this.picked(this.modes, modeOrder.indexOf(this.mode)),
      this.picked(this.segments, this.difficulty),
      this.index("start"),
    ];
  }

  /** 规则, once the rules are open. */
  private rulesStop(): number[] {
    return this.rulesOpen() ? [this.index("rules")] : [];
  }

  private tabAt(stops: number[]): number {
    const current = this.controls[this.focused];
    if (!current) return -1;
    const group = this.group(current);
    return stops.findIndex((stop) =>
      group ? this.group(this.controls[stop]!) === group : stop === this.focused,
    );
  }

  tabEdge(shift: boolean): boolean {
    if (this.challenge.open) return false;
    const stops = this.tabStops();
    return this.tabAt(stops) === (shift ? 0 : stops.length - 1);
  }

  physicalKey(event: UiKey): boolean {
    // A held Enter / Space repeats: only a fresh press toggles the shiny key (a held key would
    // otherwise toggle back and forth, or cancel the look it just asked for).
    if (
      event.repeat &&
      this.controls[this.focused]?.kind === "shiny" &&
      navigationAction(event.code, event.shift) === "confirm"
    )
      return true;
    if (!["KeyQ", "KeyE"].includes(event.code)) return false;
    // The window over the lobby keeps its partner.
    if (this.challenge.open) return true;
    if (!this.departing) {
      this.touchTip = -1;
      this.cycle(event.code === "KeyQ" ? -1 : 1);
    }
    return true;
  }

  navigate(action: NavigationAction): boolean {
    this.touchTip = this.hoveredTip = -1;
    if (this.departing) return true;
    if (this.challenge.open) return this.challenge.navigate(action);
    if (action === "previousPage" || action === "nextPage") {
      this.cycle(action === "previousPage" ? -1 : 1);
      return true;
    }
    // The root screen: Esc goes nowhere; it only clears a shown focus.
    if (action === "cancel") {
      if (this.focusVisible) this.setFocusVisible(false);
      return true;
    }
    if (action === "next" || action === "previous") {
      const stops = this.tabStops();
      const at = this.tabAt(stops);
      const next =
        at < 0
          ? action === "previous"
            ? stops.length - 1
            : 0
          : (at + (action === "previous" ? -1 : 1) + stops.length) % stops.length;
      this.focus(stops[next]!);
      return true;
    }
    const current = this.controls[this.focused];
    if (!current) {
      if (isNavigationDirection(action) || action === "confirm") {
        this.focusStart();
        return true;
      }
      return false;
    }
    if (isNavigationDirection(action)) {
      this.arrow(current, action);
      return true;
    }
    if (action === "confirm") {
      current.activate();
      return true;
    }
    return false;
  }

  /** Arrows: the groups pick sideways, 出发 switches partner sideways; up and down walk the
   *  screen's regions (top row, trainer, stage, column, tray). ↑ from below the roster reaches the
   *  shiny key (the look owned) or the bond, so a partner in the roster's second row keeps its pick. */
  private arrow(current: Control, action: NavigationDirection): void {
    const sideways = action === "left" || action === "right";
    const step = action === "left" || action === "up" ? -1 : 1;
    const tile = this.picked(this.tiles, starterOrder.indexOf(this.selected));
    const segment = this.picked(this.segments, this.difficulty);
    const trainer = this.picked(this.trainerControls, trainerOrder.indexOf(this.trainer));
    const infos = this.stops("info");
    const row = this.topRow();
    const group = this.group(current);
    const mode = this.picked(this.modes, modeOrder.indexOf(this.mode));
    const rules = this.rulesStop()[0];
    if (sideways) {
      if (current.kind === "mode" && current.index === 0 && step < 0 && rules !== undefined) {
        // 规则 stands left of the mode keys in their row.
        this.focus(rules);
      } else if (current.kind === "rules") {
        // → reaches the mode keys; ← keeps the partner (and so the run) as it is.
        if (step > 0) this.focus(mode);
      } else if (group) {
        // A radio arrow moves focus and picks; a locked option takes the focus only.
        const at = group.indexOf(current);
        const next = group[(at + step + group.length) % group.length]!;
        this.focus(this.controls.indexOf(next));
        next.activate();
      } else if (current.kind === "info") {
        const at = infos.indexOf(this.focused);
        this.focus(infos[(at + step + infos.length) % infos.length]!);
      } else if (current.kind === "shiny") {
        // ← asks for the look off, → on, even while the saved look already matches: a look still
        // loading is cancelled that way (the app drops a repeat).
        this.requestShiny(step > 0);
      } else if (row.includes(this.focused)) {
        const at = row.indexOf(this.focused);
        this.focus(row[Math.min(row.length - 1, Math.max(0, at + step))]!);
      } else if (current.kind === "prev" || current.kind === "next")
        this.focus(this.index(current.kind === "prev" ? "next" : "prev"));
      else this.cycle(step as -1 | 1);
      return;
    }
    const up = action === "up";
    if (group === this.tiles) {
      // The roster's rows: up and down cross between them (and pick), then leave the roster.
      const at = this.tiles.indexOf(current);
      const rowAt = Math.floor(at / PER_ROW);
      const lastRow = Math.floor((this.tiles.length - 1) / PER_ROW);
      if (up ? rowAt > 0 : rowAt < lastRow) {
        const to = Math.min(this.tiles.length - 1, at + (up ? -1 : 1) * PER_ROW);
        const next = this.tiles[to]!;
        this.focus(this.controls.indexOf(next));
        next.activate();
        return;
      }
    }
    const shiny = this.shinyStop()[0];
    const bond = this.index("bond");
    // The route row (规则, then the modes) stands between the column and the tray: ↓ from the
    // column, ↑ from the tray.
    const route = rules ?? mode;
    const below = infos[0] ?? route;
    const targets: Record<ControlKind, [number, number]> = {
      lab: [this.focused, this.index("kit")],
      codex: [this.focused, this.index("kit")],
      multiplayer: [this.focused, this.index("prev")],
      link: [this.focused, tile],
      settings: [this.focused, tile],
      fullscreen: [this.focused, tile],
      kit: [this.index("lab"), trainer],
      trainer: [this.index("kit"), this.focused],
      prev: [this.index("multiplayer"), trainer],
      next: [this.index("multiplayer"), segment],
      shiny: [this.index("settings"), bond],
      bond: [shiny ?? this.index("settings"), tile],
      tile: [bond, below],
      // ↑ from below the roster skips its rows (which pick): it reaches the owned look's key, else
      // the bond, so both stay the picked partner's; their ↓ returns to the medal.
      info: [shiny ?? bond, route],
      rules: [shiny ?? infos.at(-1) ?? bond, segment],
      mode: [shiny ?? infos.at(-1) ?? bond, segment],
      difficulty: [route, this.index("start")],
      start: [segment, this.focused],
    };
    this.focus(targets[current.kind][up ? 0 : 1]);
  }

  pointerDown(x: number, y: number, touch: boolean): void {
    this.pointer = { x, y };
    if (this.challenge.open) {
      this.tipPress = this.swipe = null;
      return this.challenge.pointerDown(x, y, touch);
    }
    this.columnDrag = touch && this.contains(this.column, x, y);
    const index = this.tipTarget(x, y);
    if (this.touchTip >= 0 && index !== this.touchTip) this.touchTip = -1;
    this.tipPress = touch && index >= 0 ? { index, at: this.elapsed, x, y, fired: false } : null;
    this.swipe = this.hit(x, y) < 0 && this.inZone(x, y) ? { x, y, done: false } : null;
  }

  pointerMove(x: number, y: number): void {
    this.pointer = { x, y };
    if (this.challenge.open) return this.challenge.pointerMove(x, y);
    const press = this.tipPress;
    if (press && !press.fired && Math.hypot(x - press.x, y - press.y) > 10) this.tipPress = null;
    if (!this.coarse) this.hoveredTip = this.tipTarget(x, y);
    const swipe = this.swipe;
    if (swipe && !swipe.done) {
      const k = this.stage.viewport.scale;
      const dx = (x - swipe.x) / k,
        dy = (y - swipe.y) / k;
      if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) {
        swipe.done = true;
        // Dragging left brings the next partner in, as a carousel.
        this.cycle(dx < 0 ? 1 : -1);
      }
    }
  }

  pointerLeave(): void {
    this.hoveredTip = -1;
  }

  pointerUp(touch: boolean): boolean {
    this.columnDrag = false;
    this.swipe = null;
    if (this.challenge.open) return this.challenge.pointerUp();
    const press = this.tipPress;
    this.tipPress = null;
    if (!press || !touch) return false;
    if (press.fired) return true;
    const kind = this.controls[press.index]?.kind;
    if (this.tipFor(press.index).locked || kind === "info" || kind === "bond" || kind === "kit")
      this.touchTip = this.touchTip === press.index ? -1 : press.index;
    return false;
  }

  /** Tip targets: controls, the balance, then the backpack's items. */
  private tipTarget(x: number, y: number): number {
    const control = this.hit(x, y);
    if (control >= 0 && control < this.controls.length) {
      const c = this.controls[control]!;
      return c.kind === "tile" || c.tip() ? control : -1;
    }
    if (this.contains(this.balance, x, y)) return this.controls.length;
    const item = this.carryTips.findIndex((tip) => this.contains(tip.panel, x, y));
    return item >= 0 ? this.controls.length + 1 + item : -1;
  }

  private tipFor(index: number): {
    panel: Container | null;
    text: TipContent;
    locked: boolean;
    column: boolean;
  } {
    const none = { panel: null, text: "", locked: false, column: false };
    if (index < 0) return none;
    if (index < this.controls.length) {
      const control = this.controls[index]!;
      return {
        panel: control.panel,
        text: control.tip() ?? "",
        locked: control.locked(),
        column: inColumn(control.kind),
      };
    }
    if (index === this.controls.length)
      return { panel: this.balance, text: CURRENCY_NAME, locked: false, column: false };
    const tip = this.carryTips[index - this.controls.length - 1];
    return tip
      ? { panel: tip.panel, text: items[tip.item].name, locked: false, column: true }
      : none;
  }

  afterLayout(deltaMs: number): void {
    this.elapsed += deltaMs;
    this.place();
    if (!this.entered && this.revealed && !this.covered) this.enter();
    const press = this.tipPress;
    if (press && !press.fired && this.elapsed - press.at >= LONG_PRESS_MS) {
      press.fired = true;
      this.touchTip = press.index;
    }
    const current = this.controls[this.focused];
    const keyed =
      this.focusVisible && current && (current.tip() || current.kind === "tile")
        ? this.focused
        : -1;
    const shown = this.challenge.open
      ? -1
      : this.touchTip >= 0
        ? this.touchTip
        : this.hoveredTip >= 0
          ? this.hoveredTip
          : keyed;
    const tip = this.tipFor(shown);
    this.tooltip.show(
      tip.text ? tip.panel : null,
      tip.text,
      tip.column ? "left" : tip.panel === this.trainerKit.panel ? "right" : "auto",
      tip.column ? this.column : tip.panel === this.trainerKit.panel ? this.trainerBox : null,
      [this.prev.panel, this.next.panel],
    );
    this.tooltip.update();
    this.challenge.afterLayout(deltaMs);
    for (const control of this.controls) control.update(deltaMs);
    this.routeMap.update();
    // 出发's light sweep steps on the idle clock while the lobby shows.
    if (!this.covered && this.revealed) this.startButton.update(deltaMs);
  }

  /** Context lost: the stage (the image store releases and restores the shared portraits). */
  releaseUploads(): void {
    this.stage.releaseUploads();
  }

  dispose(): void {
    for (const control of this.controls) control.dispose();
    for (const part of [...this.partnerParts, ...this.disposables, this.routeMap]) part.dispose();
    for (const button of this.keyed) button.dispose();
    for (const { entry } of this.badges) this.stage.motion.cancel(entry);
    this.balancePlate.dispose();
    this.challenge.dispose();
    this.tooltip.dispose();
    this.stage.dispose();
  }
}

/** Rows of the scrolling decision column (hit-tested and revealed inside it). */
function inColumn(kind: ControlKind): boolean {
  return kind === "tile" || kind === "info" || kind === "shiny" || kind === "bond";
}
