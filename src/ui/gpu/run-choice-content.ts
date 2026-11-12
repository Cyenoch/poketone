import type { UiKey } from "../../platform/ui-surface";
import { currentInputMode, InputGlyph } from "./input-glyph";
import { Component, Container, Content, Image, Text } from "@pmndrs/uikit";
import { Box3, Mesh, MeshBasicMaterial, Path, Shape, ShapeGeometry, Vector3 } from "three";
import { getAudio } from "../../audio/engine";
import type { Choice, PendingChoice } from "../../run/sim/state/entities";
import type { LocalCommand } from "../../run/createRun";
import { typeNames, type ElementType } from "../../run/sim/content/elements";
import { moves } from "../../run/sim/content/moves";
import { items } from "../../run/sim/content/items";
import {
  TRAIN,
  MAX_FUSION_STARS,
  MAX_MOVE_LEVEL,
  TM_CASE,
} from "../../run/sim/content/params/cards";
import { banishKey, describeRoll, rarityNames } from "../../run/sim/upgrades";
import { archetypeNames } from "../../run/labels";
import { itemIcon, moveIcon } from "../../screens/runArt";
import type { RunOverlayControl } from "./run-overlays-control";
import type { UiStage } from "./stage";
import { cubicBezier, FocusMark, uiEaseOut } from "./focus-mark";
import {
  ChoiceArt,
  ChoiceBannerPlate,
  ChoiceBannerTail,
  ChoiceButtonSkin,
  ChoiceCardSurface,
  ChoiceIconPlate,
  ChoiceSpark,
  srgb,
  toneColor,
  type CardKind,
  type ChoiceCardStyle,
  themeColors,
} from "./run-choice-surface";
import { HoverPattern } from "./hover-pattern";
import { gameTag, rarityTag, typeTag } from "./tag";
import { balanceLines, breakLines, textWidth } from "./line-break";
import { createMenuIcon } from "./icons";
import { actionTerms } from "../../run/glossary";
import { createRunCommandIcon } from "./run-overlays-icons";
import { fade, inheritedOpacity, stack } from "./layer";
import { idleTicked } from "./motion";

export interface ChoiceState {
  kind: "choice";
  theme: ElementType;
  pending: PendingChoice;
  dealKey: string;
  level: number;
  rerolls: number;
  /** Remaining skips / banishes; null when the lab has not unlocked them. */
  skips: number | null;
  banishes: number | null;
  banishing: boolean;
  dismissible?: boolean;
}
export interface ChoiceCallbacks {
  send(command: LocalCommand): void;
  /** The card is answered: a pick once the chosen card has landed, or a banish at once. */
  pick(index: number, banish: boolean): void;
  toggleBanish(): void;
  /** A HUD slot's centre in host pixels. */
  slotCenter(kind: "move" | "item", id: string): { x: number; y: number } | null;
}

/** RunScreen PICK_GUARD_MS: a pick this soon after a deal was meant for the game. */
const PICK_GUARD_MS = 150;
/** run-screen.css `run-card-picked`; the pick is answered as the card lands. */
const PICK_MS = 280;
/** The deal (last card 60ms × 3 + 200ms) and the banner stamp (unfurl ends at 340ms), with room. */
const SETTLE_MS = 600;
const easeIn = (t: number) => cubicBezier(t, 0.42, 0, 1, 1);
const easeInOut = (t: number) => cubicBezier(t, 0.42, 0, 0.58, 1);
const cssEase = (t: number) => cubicBezier(t, 0.25, 0.1, 0.25, 1);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** CSS `line-height: normal` for the UI font: Chrome rounds its ascent and descent (1095 / 353). */
const lineBox = (size: number) => Math.round(1.095 * size) + Math.round(0.353 * size);
/** UIKit reads a numeric line height as a multiple of the font size. */
const lineHeight = (size: number, px: number) => px / size;

const chestTheme = { face: "#ffd45b", deep: "#9c6a1d", light: "#fff0b0" };
const kindNames: Record<CardKind, string> = { move: "招式", item: "道具", train: "训练" };
const trainNames = { dmg: "伤害", hp: "HP", speed: "速度", area: "范围", cd: "冷却" };
const trainIcons = {
  dmg: "life-orb",
  hp: "hp-up",
  speed: "choice-scarf",
  area: "wide-lens",
  cd: "quick-claw",
} as const;
const rarityTones = ["common", "rare", "epic", "legendary"] as const;

interface Copy extends ChoiceCardStyle {
  title: string;
  icon: string;
  lines: string[];
  /** Rarity (or 新) under the title; training carries none. */
  tag?: string;
  /** A type booster's element, chipped beside its rarity. */
  boosts?: ElementType;
}
function choiceCopy(choice: Choice): Copy {
  switch (choice.kind) {
    case "move": {
      const move = moves[choice.move];
      return {
        kind: "move",
        tone: "new",
        type: move.type,
        tag: "新",
        title: move.name,
        lines: [archetypeNames[move.archetype]],
        icon: moveIcon(move.id),
      };
    }
    case "upgrade": {
      const move = moves[choice.move];
      return {
        kind: "move",
        tone: rarityTones[choice.rarity],
        type: move.type,
        tag: rarityNames[choice.rarity],
        title: move.name,
        lines: choice.rolls.map((roll) => describeRoll(roll.stat, roll.value)),
        icon: moveIcon(move.id),
      };
    }
    case "item": {
      const item = items[choice.item];
      // Rarity as on upgrade cards: the tier's colour and its name; a type booster adds its type.
      const boosts = item.boosts && item.boosts in typeNames ? (item.boosts as ElementType) : null;
      return {
        kind: "item",
        tone: rarityTones[item.rarity],
        type: null,
        tag: rarityNames[item.rarity],
        ...(boosts ? { boosts } : {}),
        title: item.name,
        lines: [item.desc],
        icon: itemIcon(choice.item),
      };
    }
    case "tm-case":
      return {
        kind: "item",
        tone: "legendary",
        type: null,
        title: "招式学习器盒",
        lines: [
          `招式 Lv ${MAX_MOVE_LEVEL + TM_CASE.moveLevels}`,
          `融合 ★${MAX_FUSION_STARS + TM_CASE.stars}`,
        ],
        icon: itemIcon("tm-case"),
      };
    case "train":
      return {
        kind: "train",
        tone: "train",
        type: null,
        title: trainNames[choice.stat],
        lines: [
          choice.stat === "hp"
            ? `+${TRAIN.hp}`
            : `${choice.stat === "cd" ? "-" : "+"}${Math.round(TRAIN[choice.stat] * 100)}%`,
        ],
        icon: itemIcon(trainIcons[choice.stat]),
      };
  }
}

/** The layout the original's media queries pick (run-screen.css, short landscape). */
interface Metrics {
  compact: boolean;
  /** ≤380 px tall: ribbon and actions stand in a column beside the cards. */
  side: boolean;
  frame: number;
  band: number;
  icon: number;
  title: number;
  line: number;
}
function metrics(stage: UiStage): Metrics {
  const { width, height } = stage.viewport;
  const compact = height <= 480 && width > height;
  const vh = (share: number, min: number, max: number) =>
    Math.round(Math.min(max, Math.max(min, height * share)));
  return {
    compact,
    side: compact && height <= 380,
    frame: compact ? 2 : 3,
    band: compact ? vh(0.07, 22, 30) : 34,
    icon: compact ? vh(0.14, 40, 76) : 64,
    title: compact ? vh(0.06, 16, 27) : 22,
    line: compact ? vh(0.046, 13, 19) : 15,
  };
}

interface CardPose {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}
interface Card {
  choice: Choice;
  copy: Copy;
  panel: Container;
  surface: ChoiceCardSurface;
  plate: ChoiceIconPlate | null;
  icon: Container;
  head: Container;
  title: Text;
  tagRow: Container | null;
  lines: Text[];
  kind: Container;
  glyph: Content;
  key: Container;
  lift: { value: number };
  veil: { value: number };
  focused: boolean;
  /** Lifted and veiled: focused, and either keyboard focus is visible or the pointer is on it. */
  shown: boolean;
  pointer: boolean;
  pattern: { x: number; y: number };
  born: number;
  pose: CardPose;
  /** The pose a pick started from. */
  from: CardPose | null;
  applied: string;
  dimmed: boolean;
}
type Action = "reroll" | "skip" | "banish" | "defer";
interface ActionButton {
  kind: Action;
  panel: Container;
  skin: ChoiceButtonSkin;
  pattern: HoverPattern;
  cursor: FocusMark;
  glyph: Content;
  label: Text;
  badge: Container;
  focused: boolean;
  pointer: boolean;
  pressed: boolean;
  /** 0 → its own paint, 1 → the lit (yellow) paint; hover raises, press sinks. */
  motion: { lit: number; hover: number; press: number };
  control: RunOverlayControl | null;
}
interface Banner {
  root: Container;
  plate: Container;
  plateSkin: ChoiceBannerPlate;
  tails: ChoiceBannerTail[];
  kicker: { row: Container; compact: boolean | null } | null;
  line: Container;
  words: { box: Container; texts: Text[]; size: "word" | "number" | "chest"; small: number }[];
  sparks: { content: ChoiceSpark; size: number }[];
  born: number;
}
interface Flight {
  index: number;
  elapsed: number;
  dx: number;
  dy: number;
  landed: boolean;
}

/**
 * The level-up / chest choice (RunScreen ChoiceOverlay). It fills the screen like the original
 * dialog: the root is the only scroll box and covers the viewport, so nothing the cards draw
 * outside themselves (lift, glow, outline, pick flight) is clipped short of the screen edge.
 */
export class GpuChoiceContent {
  readonly root = new Container({
    width: "100%",
    height: "100%",
    flexDirection: "column",
    // place-content: center — content taller than the screen spills evenly past both edges.
    justifyContent: "center",
    overflow: "scroll",
    // The original window never scrolls; overflow only spills past the screen edges.
    scrollbarWidth: 0,
  });
  controls: RunOverlayControl[] = [];
  private readonly page = new Container({
    width: "100%",
    minHeight: "100%",
    flexShrink: 0,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  });
  private readonly bannerBox = new Container({ flexShrink: 0, alignItems: "center" });
  private readonly cardsBox = new Container({
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "stretch",
    flexShrink: 0,
  });
  private readonly actionsBox = new Container({
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  });
  private readonly rail = new Container({
    flexDirection: "column",
    alignItems: "center",
    flexShrink: 0,
  });
  private state: ChoiceState;
  private readonly callbacks: ChoiceCallbacks;
  private readonly stage: UiStage;
  private readonly art: ChoiceArt;
  private cards: Card[] = [];
  private actions: ActionButton[] = [];
  private banner: Banner | null = null;
  private bannerCard = "";
  private elapsed = 0;
  private dealtAt = 0;
  private flight: Flight | null = null;
  private focusVisible = true;
  private coarse = false;
  private readonly keycaps = new Set<Container>();
  private layoutKey = "";
  private metrics: Metrics;
  /** Which arrangement the page holds: ribbon and actions beside the cards (true) or stacked. */
  private arranged: "side" | "strip" | "stack" | "dock" | null = null;
  /** Short landscape where the side rail would squeeze the cards: ribbon and actions on top. */
  private strip = false;
  private cardRow = -1;

  constructor(state: ChoiceState, callbacks: ChoiceCallbacks, stage: UiStage, art: ChoiceArt) {
    this.state = state;
    this.callbacks = callbacks;
    this.stage = stage;
    this.art = art;
    this.metrics = metrics(stage);
    this.root.add(this.page);
    this.buildBanner();
    this.buildCards();
    this.buildActions();
    this.rebuildControls();
    this.paint();
  }

  get dealKey(): string {
    return this.state.dealKey;
  }
  get docked(): boolean {
    return this.state.dismissible === true;
  }
  get scrollBody(): Container {
    return this.docked ? this.cardsBox : this.root;
  }
  /** A pick is flying (or has landed and waits for the run to answer); nothing else can happen. */
  get picking(): boolean {
    return this.flight !== null;
  }
  /** `run-choice-lift`: the dim lifts over the flight (0 → 1). */
  get lift(): number {
    return this.flight ? easeIn(clamp01(this.flight.elapsed / PICK_MS)) : 0;
  }

  /** Same card: counts and banish mode change in place. A new deal (or reroll) deals the cards
   *  again; a new card (pending id) stamps the ribbon again (the original keys both). */
  update(state: ChoiceState): void {
    const before = this.state;
    this.state = state;
    // The run rerolls a card in place (new id, same object), so compare the id the ribbon was built for.
    if (this.bannerCard !== `${state.pending.id}:${state.pending.source}`) {
      this.clearBanner();
      this.buildBanner();
    }
    if (before.dealKey !== state.dealKey) {
      this.clearCards();
      this.flight = null;
      this.dealtAt = this.elapsed;
      this.root.scrollPosition.value = [0, 0];
      this.buildCards();
    }
    if (
      (before.skips === null) !== (state.skips === null) ||
      (before.banishes === null) !== (state.banishes === null)
    ) {
      this.clearActions();
      this.buildActions();
    }
    this.rebuildControls();
    this.paint();
    this.layoutKey = "";
  }

  // ---------------------------------------------------------------- building blocks

  /** `kbd` badges are keyboard hints: hidden under a coarse pointer, as `(pointer: coarse)` does. */
  private keycap(badge: Container): void {
    this.keycaps.add(badge);
    badge.setProperties({ display: this.coarse ? "none" : "flex" });
  }
  setCoarsePointer(coarse: boolean): void {
    this.coarse = coarse;
    for (const badge of this.keycaps) badge.setProperties({ display: coarse ? "none" : "flex" });
  }
  private text(text: string, size: number, color = "#0d233f", weight = 800): Text {
    return new Text({
      text,
      fontSize: size,
      fontWeight: weight,
      lineHeight: lineHeight(size, lineBox(size)),
      color,
      flexShrink: 0,
      minWidth: 0,
    });
  }
  /** ui/tag.css: badge 11 px in 16, chip 12 px in 21; the box centres the font's line box. */
  private tag(
    text: string,
    size: "badge" | "chip",
    face: string,
    ink: string,
    ring?: { color: string; width: number },
  ): Container {
    return gameTag(text, { size, face, ink, ring });
  }
  /** `box-shadow: 0 0 0 2px <color>` around a chip: a ring that takes no layout space. */
  private ringed(chip: Container, color: string, radius: number): Container {
    const ring = new Container({
      padding: 2,
      borderRadius: radius,
      backgroundColor: color,
      flexShrink: 0,
    });
    ring.add(stack(chip, 1));
    return ring;
  }
  /** The kind chip's 16-unit glyph (run-screen.css `--glyph`), a filled shape. */
  private kindGlyph(kind: CardKind, size: number): Content {
    const outline = (points: number[]) => {
      const shape = new Shape().moveTo(points[0]!, points[1]!);
      for (let i = 2; i < points.length; i += 2) shape.lineTo(points[i]!, points[i + 1]!);
      return shape.closePath();
    };
    let shapes: Shape[];
    if (kind === "move")
      shapes = [outline([8, 0, 10.2, 5.8, 16, 8, 10.2, 10.2, 8, 16, 5.8, 10.2, 0, 8, 5.8, 5.8])];
    else if (kind === "item") {
      // M5 4V3a3 3 0 0 1 6 0v1h2.5a1 1 0 0 1 1 1.1l-.8 8.9a1 1 0 0 1-1 1H3.3a1 1 0 0 1-1-1l-.8-8.9a1 1 0 0 1 1-1.1z
      // with the handle's hole m1.6 0h2.8V3a1.4 1.4 0 0 0-2.8 0z.
      const bag = new Shape()
        .moveTo(5, 4)
        .lineTo(5, 3)
        .absarc(8, 3, 3, Math.PI, Math.PI * 2, false)
        .lineTo(11, 4)
        .lineTo(13.5, 4)
        .quadraticCurveTo(14.5, 4, 14.5, 5.1)
        .lineTo(13.7, 14)
        .quadraticCurveTo(13.6, 15, 12.7, 15)
        .lineTo(3.3, 15)
        .quadraticCurveTo(2.4, 15, 2.3, 14)
        .lineTo(1.5, 5.1)
        .quadraticCurveTo(1.5, 4, 2.5, 4)
        .closePath();
      bag.holes.push(
        new Path()
          .moveTo(6.6, 4)
          .lineTo(9.4, 4)
          .lineTo(9.4, 3)
          .absarc(8, 3, 1.4, 0, Math.PI, true)
          .closePath(),
      );
      shapes = [bag];
    } else
      // M0 6h2V4h2.5v8H2v-2H0zm16 0h-2V4h-2.5v8H14v-2h2zM5.5 7h5v2h-5z
      shapes = [
        outline([0, 6, 2, 6, 2, 4, 4.5, 4, 4.5, 12, 2, 12, 2, 10, 0, 10]),
        outline([16, 6, 14, 6, 14, 4, 11.5, 4, 11.5, 12, 14, 12, 14, 10, 16, 10]),
        outline([5.5, 7, 10.5, 7, 10.5, 9, 5.5, 9]),
      ];
    const geometry = new ShapeGeometry(shapes);
    geometry.translate(-8, -8, 0);
    geometry.boundingBox = new Box3(new Vector3(-8, -8, 0), new Vector3(8, 8, 0));
    const material = new MeshBasicMaterial({
      color: "#0d233f",
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    // SVG y runs down; keep the flip in the object matrix so Three also flips the winding.
    mesh.scale.y = -1;
    const content = new Content({ width: size, height: size, flexShrink: 0, depthTest: false });
    content.add(mesh);
    content.notifyAncestorsChanged();
    content.abortSignal.addEventListener("abort", () => {
      geometry.dispose();
      material.dispose();
    });
    return content;
  }

  // ---------------------------------------------------------------- tooltip

  // ---------------------------------------------------------------- banner

  private buildBanner(): void {
    const chest = this.state.pending.source === "chest";
    const theme = themeColors(this.state.theme);
    const colors = chest ? chestTheme : { face: theme.theme, deep: theme.deep, light: theme.light };
    const root = new Container({ flexDirection: "row", flexShrink: 0 });
    const tails = (["start", "end"] as const).map((side) => {
      const tail = new ChoiceBannerTail(side, colors.face, colors.deep);
      tail.content.setProperties({
        positionLeft: side === "start" ? 0 : undefined,
        positionRight: side === "end" ? 0 : undefined,
        transformOriginX: side === "start" ? "right" : "left",
      });
      root.add(tail.content);
      return tail;
    });
    const plate = stack(
      new Container({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }),
      1,
    );
    const plateSkin = new ChoiceBannerPlate(
      chest ? "chest" : this.state.theme,
      colors.face,
      colors.light,
    );
    plate.add(plateSkin.content);
    const line = stack(new Container({ flexDirection: "row", alignItems: "flex-start" }), 1);
    const words: Banner["words"] = [];
    const word = (text: string, size: Banner["words"][number]["size"]) => {
      const box = new Container({ flexShrink: 0 });
      const texts: Text[] = [];
      // -webkit-text-stroke 6px navy-deep under the fill (paint-order stroke): 3px shows outside.
      for (let i = 0; i < 12; i++) {
        const stroke = this.text(text, 22, "#0d233f");
        stroke.setProperties({ positionType: "absolute", positionLeft: 0, positionTop: 0 });
        box.add(stroke);
        texts.push(stroke);
      }
      const ink = stack(this.text(text, 22, "#ffffff"), 1);
      box.add(ink);
      texts.push(ink);
      line.add(box);
      words.push({ box, texts, size, small: 0 });
    };
    let kicker: Banner["kicker"] = null;
    if (chest) word("宝箱", "chest");
    else {
      // `.game-tag` (ui.css, later in the cascade) keeps its own inset ring over the kicker's.
      const chip = this.tag("升级", "chip", "#ffd45b", "#0d233f", { color: "#142f50", width: 1.5 });
      const row = stack(new Container({ flexDirection: "row", justifyContent: "center" }), 2);
      row.add(chip);
      kicker = { row, compact: null };
      word("Lv", "word");
      word(String(this.state.level), "number");
    }
    plate.add(line);
    root.add(plate);
    const sparks = [
      { fill: "#ffffff", size: 14 },
      { fill: "#ffd45b", size: 10 },
      { fill: "#ffd45b", size: 18 },
      { fill: "#ffffff", size: 10 },
    ].map(({ fill, size }) => {
      const content = new ChoiceSpark(fill, colors.light);
      stack(content.content, 2);
      root.add(content.content);
      return { content, size };
    });
    this.bannerBox.add(root);
    this.banner = {
      root,
      plate,
      plateSkin,
      tails,
      kicker,
      line,
      words,
      sparks,
      born: this.elapsed,
    };
    this.bannerCard = `${this.state.pending.id}:${this.state.pending.source}`;
  }

  private layoutBanner(m: Metrics): void {
    const b = this.banner;
    if (!b) return;
    const chest = this.state.pending.source === "chest";
    const height = m.compact ? 32 : 64,
      tail = m.compact ? 34 : 58,
      under = m.compact ? 12 : 18,
      notch = m.compact ? 9 : 14,
      top = m.compact ? 9 : 16,
      bottom = m.compact ? 6 : 10;
    b.root.setProperties({ paddingX: tail, height, marginBottom: m.compact ? 2 : 6 });
    for (const t of b.tails) {
      t.content.setProperties({
        positionTop: top,
        width: tail + under,
        height: height - top + bottom,
      });
      t.setMetrics(m.frame, notch);
    }
    b.plate.setProperties({
      height,
      minWidth: m.compact ? 0 : 200,
      paddingLeft: m.frame + (m.compact ? (chest ? 12 : 4) : 24),
      paddingRight: m.frame + (m.compact ? 12 : 24),
      gap: m.compact ? 8 : 0,
    });
    b.plateSkin.setMetrics(m.frame, m.compact ? 3 : 5, !m.compact);
    // Re-parent only when the layout changes: UIKit drops a panel re-added in the same pass.
    if (b.kicker && b.kicker.compact !== m.compact) {
      const { row } = b.kicker;
      b.kicker.compact = m.compact;
      row.removeFromParent();
      if (m.compact) {
        // Inline before the level.
        b.plate.add(row);
        row.setProperties({ positionType: "relative", positionTop: undefined, width: undefined });
        b.line.removeFromParent();
        b.plate.add(b.line);
      } else {
        // top: round(down, -tag-h / 2 - frame / 2) of the padding box.
        row.setProperties({
          positionType: "absolute",
          positionTop: m.frame + Math.floor(-21 / 2 - m.frame / 2),
          positionLeft: 0,
          width: "100%",
        });
        b.plate.add(row);
      }
    }
    const stroke = m.compact ? 2.5 : 3;
    const sizes = {
      word: m.compact ? 15 : 22,
      number: m.compact ? 26 : 44,
      chest: m.compact ? 26 : 32,
    };
    // Baselines line up: the smaller "Lv" sits lower in the level's taller line box.
    const lineTall = Math.max(...b.words.map((w) => lineBox(sizes[w.size])));
    const ascent = Math.max(...b.words.map((w) => Math.round(1.095 * sizes[w.size])));
    for (const w of b.words) {
      const size = sizes[w.size];
      w.box.setProperties({
        marginTop: ascent - Math.round(1.095 * size) + (w.size === "chest" ? 1 : 0),
        marginLeft: w.size === "number" ? Math.round(size * 0.26 * 0.5) : 0,
      });
      w.texts.forEach((t, i) => {
        const angle = (i / 12) * Math.PI * 2;
        t.setProperties({
          fontSize: size,
          lineHeight: lineHeight(size, lineBox(size)),
          ...(i < 12
            ? {
                positionLeft: Math.cos(angle) * stroke,
                positionTop: Math.sin(angle) * stroke,
              }
            : {}),
        });
      });
    }
    b.line.setProperties({ height: lineTall });
    const spark = (i: number) => (m.compact ? (i === 2 ? 12 : 9) : b.sparks[i]!.size);
    const place = [
      { left: tail - 10, top: -14 },
      { left: tail + 14, bottom: -4 },
      { right: tail - 14, top: -6 },
      { right: tail + 20, bottom: -10 },
    ];
    b.sparks.forEach((s, i) =>
      s.content.content.setProperties({
        width: spark(i),
        height: spark(i),
        positionLeft: place[i]!.left,
        positionRight: place[i]!.right,
        positionTop: place[i]!.top,
        positionBottom: place[i]!.bottom,
      }),
    );
  }

  private animateBanner(): void {
    const b = this.banner;
    if (!b) return;
    const age = this.elapsed - b.born;
    // choice-banner-stamp 300ms: scale 1.7 → .94 (55%, opaque) → 1, ease-out per segment.
    const t = clamp01(age / 300);
    const scale =
      t < 0.55 ? lerp(1.7, 0.94, uiEaseOut(t / 0.55)) : lerp(0.94, 1, uiEaseOut((t - 0.55) / 0.45));
    fade(b.plate, t < 0.55 ? uiEaseOut(t / 0.55) : 1).setProperties({
      transformScaleX: scale,
      transformScaleY: scale,
    });
    // choice-banner-unfurl 220ms after 120ms, from under the plate.
    const unfurl = uiEaseOut(clamp01((age - 120) / 220));
    for (const tail of b.tails)
      tail.content.setProperties({ transformScaleX: Math.max(1e-3, unfurl) });
    // ui-fade-in 200ms after 260ms; twinkle 1.6s alternate, each a quarter period apart.
    b.sparks.forEach((s, i) => {
      const cycle = age / 1600 + i * 0.25;
      const leg = cycle % 2;
      const k = easeInOut(leg < 1 ? leg : 2 - leg);
      fade(s.content.content, cssEase(clamp01((age - 260) / 200))).setProperties({
        transformScaleX: lerp(0.55, 1, k),
        transformScaleY: lerp(0.55, 1, k),
        transformRotateZ: -lerp(-20, 20, k),
      });
    });
  }

  // ---------------------------------------------------------------- cards

  private buildCards(): void {
    for (const [index, choice] of this.state.pending.options.entries()) {
      const copy = choiceCopy(choice);
      const surface = new ChoiceCardSurface(copy, this.art);
      const panel = new Container({ flexDirection: "column", flexShrink: 1, minWidth: 0 });
      panel.add(surface.content);
      // `.game-tag--light` keeps its inset navy ring and 4px corners over `.run-card__kind`; only
      // the item chip's own rule (more specific) swaps it for a 2px leather ring outside.
      const item = copy.kind === "item";
      const chip = this.tag(
        kindNames[copy.kind],
        "chip",
        "#ffffff",
        "#0d233f",
        item ? undefined : { color: "#142f50", width: 1.5 },
      );
      const glyph = stack(this.kindGlyph(copy.kind, 14), 1);
      const label = chip.children[0]!;
      label.removeFromParent();
      chip.add(glyph, label);
      const kind = stack(item ? this.ringed(chip, "#4a3218", 6) : chip, 2);
      kind.setProperties({ positionType: "absolute" });
      const key = stack(
        new InputGlyph(this.docked ? "choiceConfirm" : "confirm", String(index + 1)),
        2,
      );
      key.setProperties({ positionType: "absolute" });
      this.keycap(key);
      // Full card width: a Text wrapped in a shrink-to-fit box is measured at one width and laid out
      // at another, so its second line would overlap whatever follows.
      const head = stack(
        new Container({ alignItems: "flex-start", width: "100%", minWidth: 0, flexShrink: 0 }),
        1,
      );
      const icon = new Container({ flexShrink: 0 });
      const plate = copy.kind === "train" ? null : new ChoiceIconPlate(copy.kind, copy.type);
      if (plate) icon.add(plate.content);
      icon.add(stack(new Image({ src: copy.icon, width: "100%", height: "100%" }), 1));
      const title = this.text(copy.title, 22, "#142f50");
      // CJK titles break between any two characters, as the browser breaks them.
      title.setProperties({ flexShrink: 1, wordBreak: "keep-all", whiteSpace: "pre" });
      head.add(icon, title);
      let tagRow: Container | null = null;
      if (copy.tag) {
        const tag = rarityTag(copy.tag, toneColor(copy));
        tagRow = stack(new Container({ flexDirection: "row", flexShrink: 0, gap: 4 }), 1);
        tagRow.add(tag);
        if (copy.boosts) tagRow.add(typeTag(copy.boosts));
      }
      const lines = copy.lines.map((line) => {
        const text = stack(this.text(line, 15, "#142f50", 700), 1);
        text.setProperties({
          width: "100%",
          flexShrink: 0,
          wordBreak: "keep-all",
          whiteSpace: "pre",
        });
        return text;
      });
      panel.add(kind, key, head);
      if (tagRow) panel.add(tagRow);
      for (const line of lines) panel.add(line);
      this.cardsBox.add(panel);
      this.cards.push({
        choice,
        copy,
        panel,
        surface,
        plate,
        icon,
        head,
        title,
        tagRow,
        lines,
        kind,
        glyph,
        key,
        lift: { value: 0 },
        veil: { value: 0 },
        focused: false,
        shown: false,
        pointer: false,
        pattern: { x: 0, y: 0 },
        born: this.elapsed,
        pose: { x: 0, y: 28, scale: 0.94, rotation: -3, opacity: 0 },
        from: null,
        applied: "",
        dimmed: false,
      });
    }
  }

  private layoutCards(m: Metrics, width: number): void {
    const n = this.cards.length;
    const gap = 12;
    const cardWidth = Math.max(0, Math.min(m.compact ? 300 : 220, (width - gap * (n - 1)) / n));
    this.cardsBox.setProperties({ gap });
    const font = this.cards[0]?.title.fontSignal.value;
    // Texts are broken by measured glyph widths (line-break.ts); until the atlas is in, retry.
    if (!font) this.layoutKey = "";
    const inner = cardWidth - 2 * (m.frame + (m.compact ? 12 : 16));
    for (const card of this.cards) {
      // Short landscape puts the icon beside the title, as the original does, when the title fits
      // there on one line; otherwise the icon goes above it so the title gets the full width,
      // stepping its size down before it would wrap (no one-character orphan lines).
      const titleWidth = font ? textWidth(card.copy.title, m.title, font) : 0;
      const beside = m.compact && inner - m.icon - 12 >= titleWidth;
      let titleSize = m.title;
      while (
        font &&
        !beside &&
        titleSize > 14 &&
        textWidth(card.copy.title, titleSize, font) > inner
      )
        titleSize -= 1;
      const { kind } = card.copy;
      card.surface.setMetrics(m.band, m.frame);
      card.panel.setProperties({
        width: cardWidth,
        minHeight: m.compact ? 0 : 190,
        paddingTop: m.frame + m.band + (m.compact ? 8 : 12),
        paddingX: m.frame + (m.compact ? 12 : 16),
        paddingBottom: m.frame + (m.compact ? 12 : 16),
        gap: m.compact ? 2 : 6,
        justifyContent: m.compact ? "center" : "flex-start",
      });
      // Chip and badge centred in the band on whole pixels: round(up, (band - tag-h) / 2).
      const ring = card.copy.kind === "item" ? 2 : 0;
      card.kind.setProperties({
        positionLeft: m.frame + 8 - ring,
        positionTop: m.frame + Math.ceil((m.band - 21) / 2) - ring,
      });
      card.key.setProperties({
        positionRight: m.frame + 8,
        positionTop: undefined,
        positionBottom: m.frame + 8,
      });
      card.glyph.setProperties({ width: m.compact ? 12 : 14, height: m.compact ? 12 : 14 });
      const padded = kind !== "train";
      card.icon.setProperties({
        width: m.icon,
        height: m.icon,
        padding: padded ? 6 + (kind === "item" ? 2 : 0) : 0,
        marginLeft: beside ? 0 : -4,
        marginTop: beside ? 0 : -4,
        marginBottom: beside ? 0 : 2,
      });
      card.title.setProperties({
        alignSelf: beside ? "auto" : "stretch",
        flexGrow: beside ? 1 : 0,
        flexBasis: beside ? 0 : "auto",
      });
      card.head.setProperties({
        flexDirection: beside ? "row" : "column",
        alignItems: beside ? "center" : "flex-start",
        gap: beside ? 12 : 6,
      });
      card.title.setProperties({
        text: font
          ? balanceLines(card.copy.title, beside ? inner - m.icon - 12 : inner, titleSize, font)
          : card.copy.title,
        fontSize: titleSize,
        lineHeight: lineHeight(titleSize, Math.round(titleSize * 1.2)),
      });
      card.tagRow?.setProperties({
        positionType: "absolute",
        positionRight: m.frame + 8,
        positionTop: m.frame + Math.ceil((m.band - 21) / 2),
        paddingLeft: 0,
      });
      card.lines.forEach((line, i) =>
        line.setProperties({
          text: font ? breakLines(card.copy.lines[i]!, inner, m.line, font) : card.copy.lines[i]!,
          fontSize: m.line,
          lineHeight: m.compact ? 1.35 : lineHeight(m.line, lineBox(m.line)),
        }),
      );
    }
  }

  // ---------------------------------------------------------------- actions

  private count(kind: Action): number {
    if (kind === "defer") return 1;
    return kind === "reroll"
      ? this.state.rerolls
      : kind === "skip"
        ? (this.state.skips ?? 0)
        : (this.state.banishes ?? 0);
  }
  private buildActions(): void {
    const kinds: Action[] = ["reroll"];
    if (this.state.dismissible) kinds.push("defer");
    if (this.state.banishes !== null) kinds.push("banish");
    for (const kind of kinds) {
      const panel = new Container({
        minHeight: 44,
        minWidth: 44,
        paddingX: 18,
        paddingY: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        flexShrink: 0,
      });
      const skin = new ChoiceButtonSkin();
      const pattern = new HoverPattern(this.stage.motion, () => this.stage.invalidate(), "#ffd45b");
      const glyph =
        kind === "reroll"
          ? createRunCommandIcon("reset")
          : createMenuIcon(kind === "skip" ? "chevron" : "close");
      const label = stack(this.text("", 16, "#142f50"), 1);
      const badge = stack(
        new InputGlyph(
          kind === "defer" ? "back" : this.docked ? "choiceConfirm" : "confirm",
          kind === "reroll" ? "R" : kind === "skip" ? "X" : kind === "defer" ? "Esc" : "Z",
        ),
        1,
      );
      this.keycap(badge);
      const group = stack(
        new Container({ flexDirection: "row", alignItems: "center", gap: 10 }),
        1,
      );
      badge.setProperties({ marginLeft: 6 });
      group.add(label, badge);
      panel.add(skin.content, pattern.content, stack(glyph, 1), group);
      const cursor = new FocusMark(this.stage.motion, () => this.stage.invalidate());
      cursor.mesh.renderOrder = 30;
      cursor.setParentScale(18 / 22);
      this.stage.scene.add(cursor.mesh);
      this.actionsBox.add(panel);
      this.actions.push({
        kind,
        panel,
        skin,
        pattern,
        cursor,
        glyph,
        label,
        badge,
        focused: false,
        pointer: false,
        pressed: false,
        motion: { lit: 0, hover: 0, press: 0 },
        control: null,
      });
    }
  }

  /** `.game-button` paint: lit while focused, hovered or armed (aria-pressed); hatched when spent. */
  private paintAction(action: ActionButton): void {
    const disabled = this.count(action.kind) <= 0;
    const { lit, hover, press } = action.motion;
    const own = disabled
      ? { fill: "#d0dfeb", ink: "#657b91", border: "#9fb5c7", base: "#9fb5c7" }
      : // Armed banish is `aria-pressed`: it only lights (yellow), from its normal paint.
        { fill: "#e9f4fb", ink: "#142f50", border: "#142f50", base: "#0d233f" };
    const mix = (a: string, b: string) => srgb(a).lerp(srgb(b), disabled ? 0 : lit);
    const ink = mix(own.ink, "#0d233f");
    action.skin.setPaint(
      mix(own.fill, "#ffd45b"),
      mix(own.border, "#142f50"),
      mix(own.base, "#0d233f"),
      disabled,
    );
    const depth = disabled ? 1 : lerp(lerp(2, 3, hover), 0, press);
    action.skin.setDepth(depth, press);
    const color = `rgb(${Math.round(ink.x * 255)},${Math.round(ink.y * 255)},${Math.round(ink.z * 255)})`;
    action.label.setProperties({ color });
    action.glyph.setProperties({ color });
    action.panel.setProperties({
      transformTranslateY: lerp(-hover, 2, press),
      transformScaleX: lerp(1, 1.012, press),
      transformScaleY: lerp(1, 0.96, press),
    });
    this.stage.invalidate();
  }
  private refreshAction(action: ActionButton): void {
    action.badge.setProperties({
      display:
        this.coarse || (currentInputMode().kind === "gamepad" && !action.focused) ? "none" : "flex",
    });
    const available = this.count(action.kind) > 0;
    const armed = action.kind === "banish" && this.state.banishing;
    const lit = available && (action.focused || action.pointer || armed);
    const hover = available && action.pointer;
    const press = available && action.pressed;
    action.cursor.setFocused(lit);
    action.pattern.setFocused(available && (action.focused || action.pointer));
    const target = { lit: lit ? 1 : 0, hover: hover ? 1 : 0, press: press ? 1 : 0 };
    if (
      target.lit === action.motion.lit &&
      target.hover === action.motion.hover &&
      target.press === action.motion.press
    )
      return this.paintAction(action);
    this.stage.motion.animate(
      action.motion,
      target,
      press ? 60 : 140,
      () => this.paintAction(action),
      press || hover ? uiEaseOut : cssEase,
    );
  }

  // ---------------------------------------------------------------- controls and state

  private rebuildControls(): void {
    this.controls = [];
    for (const [index, card] of this.cards.entries())
      this.controls.push({
        panel: card.panel,
        card: index,
        enabled: () => !this.flight && this.cardEnabled(index),
        action: () => this.pick(index),
        setFocused: (focused) => this.setCardFocus(card, focused),
        setPointerOver: (over) => {
          card.pointer = over;
          this.applyCardFocus(card);
        },
      });
    for (const action of this.actions) {
      const control: RunOverlayControl = {
        panel: action.panel,
        // aria-disabled, not disabled: a spent action stays focusable and says why in its tip.
        enabled: () => !this.flight,
        locked: () => this.count(action.kind) <= 0,
        tip:
          this.count(action.kind) > 0
            ? action.kind === "defer"
              ? "保留选择机会"
              : actionTerms[action.kind]
            : "本局已用完",
        action: () => this.actionPressed(action.kind),
        setFocused: (focused) => {
          action.focused = focused;
          this.refreshAction(action);
        },
        setPointerOver: (over) => {
          action.pointer = over;
          this.refreshAction(action);
        },
        setPressed: (pressed) => {
          action.pressed = pressed;
          this.refreshAction(action);
        },
      };
      action.control = control;
      this.controls.push(control);
    }
  }
  private cardEnabled(index: number): boolean {
    return !this.state.banishing || banishKey(this.state.pending.options[index]!) !== null;
  }
  private setCardFocus(card: Card, focused: boolean): void {
    if (card.focused === focused) return;
    card.focused = focused;
    this.applyCardFocus(card);
  }

  /** `:hover` / `:focus-visible`: the card lifts under a resting pointer or keyboard focus, and
   *  only keyboard focus draws the outline. Focus that only the pointer gave stays invisible. */
  setFocusVisible(visible: boolean): void {
    this.focusVisible = visible;
    for (const card of this.cards) this.applyCardFocus(card);
  }
  private applyCardFocus(card: Card): void {
    card.key.setProperties({
      display:
        this.coarse || (currentInputMode().kind === "gamepad" && !card.focused) ? "none" : "flex",
    });
    card.surface.setFocusRing(card.focused && this.focusVisible && !this.state.banishing);
    const shown = card.focused && (this.focusVisible || card.pointer);
    if (shown === card.shown) return;
    card.shown = shown;
    // transform 140ms var(--ease-out); --veil 140ms ease.
    const redraw = () => this.stage.invalidate();
    this.stage.motion.animate(
      card.lift,
      { value: shown ? (this.docked ? -2 : -6) : 0 },
      140,
      redraw,
      uiEaseOut,
    );
    this.stage.motion.animate(card.veil, { value: shown ? 1 : 0 }, 140, redraw, cssEase);
  }

  private paint(): void {
    for (const [index, card] of this.cards.entries()) {
      const enabled = this.cardEnabled(index);
      card.surface.setBanish(this.state.banishing && enabled);
      card.surface.setFocusRing(card.focused && this.focusVisible && !this.state.banishing);
    }
    for (const action of this.actions) {
      const count = this.count(action.kind);
      action.label.setProperties({
        text:
          action.kind === "defer"
            ? "稍后"
            : `${action.kind === "reroll" ? "重抽" : action.kind === "skip" ? "跳过" : "放逐"} ${count}`,
      });
      this.refreshAction(action);
    }
    this.stage.invalidate();
  }

  // ---------------------------------------------------------------- input

  private pick(index: number): void {
    if (this.flight || this.elapsed - this.dealtAt < PICK_GUARD_MS) return;
    const card = this.cards[index];
    if (!card || !this.cardEnabled(index)) return;
    getAudio().sfx("ui-confirm");
    if (this.state.banishing) {
      this.callbacks.pick(index, true);
      return;
    }
    const choice = card.choice;
    const target =
      choice.kind === "move" || choice.kind === "upgrade"
        ? this.callbacks.slotCenter("move", choice.move)
        : choice.kind === "item"
          ? this.callbacks.slotCenter("item", choice.item)
          : null;
    // --fly-x/y: from the card's laid-out centre (its transform aside) to the slot.
    const matrix = card.panel.globalMatrix.value;
    let dx = 0,
      dy = 48;
    if (target && matrix) {
      const { scale } = this.stage.viewport;
      const x = matrix.elements[12]! - this.stage.camera.left - card.pose.x,
        y = this.stage.camera.top - matrix.elements[13]! - card.pose.y;
      dx = target.x / scale - x;
      dy = target.y / scale - y;
    }
    for (const other of this.cards) {
      this.stage.motion.cancel(other.lift);
      other.from = { ...other.pose };
      // The pick focuses its card (a click or 1–3 key), so no other card keeps its focus outline.
      other.surface.setFocusRing(other === card);
    }
    stack(card.panel, 10);
    this.flight = { index, elapsed: 0, dx, dy, landed: false };
    this.stage.invalidate();
  }
  actionPressed(kind: Action): void {
    if (this.flight || this.count(kind) <= 0) return;
    getAudio().sfx("ui-confirm");
    if (kind === "defer") this.callbacks.send({ t: "choices", open: false });
    else if (kind === "banish") this.callbacks.toggleBanish();
    else this.callbacks.send({ t: kind, card: this.state.pending.id });
  }
  /** 1–4 pick, R reroll, X skip, Z banish mode. */
  physicalKey({ key, code }: UiKey): boolean {
    const digit = /^Digit[1-4]$/.test(code)
      ? Number(code.slice(5))
      : /^[1-4]$/.test(key)
        ? Number(key)
        : 0;
    if (digit) {
      if (digit <= this.cards.length) this.pick(digit - 1);
      return true;
    }
    const letter = code.startsWith("Key") ? code.slice(3) : key.toUpperCase();
    const action =
      letter === "R" ? "reroll" : letter === "X" ? "skip" : letter === "Z" ? "banish" : null;
    if (!action) return false;
    if (this.actions.some((a) => a.kind === action)) this.actionPressed(action);
    return true;
  }

  // ---------------------------------------------------------------- layout and frame

  resize(): void {
    this.layoutKey = "";
  }
  private layoutDock(): void {
    const v = this.stage.viewport;
    const edge = v.height <= 480 ? 12 : 16;
    const left = Math.max(edge, v.safeArea.left) + (this.coarse ? 150 : 152);
    const right = Math.max(edge, v.safeArea.right) + (this.coarse ? 176 : 152);
    const width = Math.min(920, v.width - left - right);
    const bottom = Math.max(edge, v.safeArea.bottom);
    const gap = 6;
    const compactHeader = v.height * v.scale <= 480 || width < 680;
    const stackedHeader = width < (this.coarse ? 560 : 650) && this.actions.length > 2;
    const headerHeight = stackedHeader
      ? Math.max(44, v.minTarget) + 48
      : compactHeader
        ? Math.max(44, v.minTarget)
        : 86;
    const cardHeight = Math.max(100, v.height * 0.5 - bottom - headerHeight - gap - 8);
    if (this.arranged !== "dock") {
      for (const box of [this.bannerBox, this.cardsBox, this.actionsBox, this.rail])
        box.removeFromParent();
      this.rail.add(this.bannerBox, this.actionsBox);
      this.page.add(this.rail, this.cardsBox);
      this.arranged = "dock";
    }
    this.root.setProperties({
      positionType: "absolute",
      positionLeft: left + (v.width - left - right - width) / 2,
      positionBottom: bottom,
      width,
      height: undefined,
      maxHeight: undefined,
      justifyContent: "flex-end",
      overflow: "visible",
    });
    this.page.setProperties({
      minHeight: undefined,
      minWidth: 0,
      flexShrink: 1,
      gap,
    });
    const actionHeight = Math.max(44, v.minTarget);
    this.rail.setProperties({
      flexDirection: stackedHeader ? "column" : "row",
      width: "100%",
      alignItems: stackedHeader ? "flex-end" : "center",
      justifyContent: "space-between",
      gap: 8,
    });
    this.layoutBanner({ ...this.metrics, compact: compactHeader });
    this.actionsBox.setProperties({
      gap: 8,
      flexWrap: "no-wrap",
      width: undefined,
      justifyContent: "flex-end",
    });
    for (const action of this.actions) {
      action.panel.setProperties({
        minWidth: v.minTarget,
        minHeight: actionHeight,
        paddingX: 12,
        paddingY: 8,
        gap: 8,
        flexShrink: 1,
      });
      action.label.setProperties({ fontSize: 16, whiteSpace: "pre" });
      action.glyph.setProperties({ display: "flex", width: 20, height: 20 });
      action.badge.setProperties({ marginLeft: 0 });
    }
    // Only the cards scroll when a long description needs room; Later and reroll stay visible.
    this.cardsBox.setProperties({
      width: "100%",
      gap,
      paddingTop: 4,
      paddingBottom: 4,
      overflow: "scroll",
      alignItems: "stretch",
      scrollbarWidth: 2,
      maxHeight: cardHeight,
      flexShrink: 1,
    });
    const cardWidth = (width - gap * (this.cards.length - 1)) / this.cards.length;
    const inner = cardWidth - 16;
    const detailSize = 12;
    const font = this.cards[0]?.title.fontSignal.value;
    if (!font) this.layoutKey = "";
    for (const card of this.cards) {
      card.surface.setMetrics(22, 2);
      card.panel.setProperties({
        width: cardWidth,
        minHeight: Math.min(150, cardHeight - 8),
        paddingTop: 28,
        paddingX: 8,
        paddingBottom: this.coarse ? 12 : 26,
        gap: 4,
        flexShrink: 0,
      });
      card.kind.setProperties({
        display: "flex",
        positionLeft: 4,
        positionTop: 2,
      });
      card.key.setProperties({ positionRight: 5, positionTop: undefined, positionBottom: 5 });
      card.icon.setProperties({ width: 24, height: 24, padding: 2 });
      card.head.setProperties({ flexDirection: "row", alignItems: "center", gap: 4 });
      card.title.setProperties({
        text: font ? balanceLines(card.copy.title, inner - 28, 14, font) : card.copy.title,
        fontSize: 14,
        lineHeight: 1.2,
        flexGrow: 1,
        flexBasis: 0,
      });
      card.tagRow?.setProperties({
        positionType: "absolute",
        positionRight: 4,
        positionTop: 2,
        paddingLeft: 0,
      });
      card.lines.forEach((line, index) =>
        line.setProperties({
          text: font
            ? breakLines(card.copy.lines[index]!, inner, detailSize, font)
            : card.copy.lines[index]!,
          fontSize: detailSize,
          lineHeight: 1.25,
        }),
      );
    }
    this.stage.invalidate();
  }
  private layout(): void {
    const v = this.stage.viewport;
    const key = [
      v.width,
      v.height,
      v.scale,
      ...Object.values(v.safeArea),
      this.cards.length,
      this.coarse,
    ].join(",");
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    if (this.docked) {
      this.layoutDock();
      return;
    }
    const m = (this.metrics = metrics(this.stage));
    // Touch targets: the viewport's minimum at every scale (44 host px), as the HUD's.
    for (const action of this.actions)
      action.panel.setProperties({ minHeight: v.minTarget, minWidth: v.minTarget });
    const hudTop = Math.max(12, v.safeArea.top),
      hudLeft = Math.max(12, v.safeArea.left),
      hudRight = Math.max(12, v.safeArea.right),
      hudBottom = Math.max(12, v.safeArea.bottom);
    const mode = m.side ? (this.strip ? "strip" : "side") : "stack";
    const arrange = this.arranged !== mode;
    this.arranged = mode;
    this.cardRow = -1;
    if (arrange)
      for (const box of [this.bannerBox, this.cardsBox, this.actionsBox, this.rail])
        box.removeFromParent();
    if (m.compact) {
      this.page.setProperties({
        // Stacked: the cards' row fills the height. Beside: the cards span the full height,
        // growing past it (with the page) when their content needs more.
        height: m.side ? undefined : "100%",
        minHeight: m.side ? "100%" : undefined,
        flexDirection: mode === "side" ? "row" : "column",
        alignItems: mode === "side" ? "stretch" : "center",
        justifyContent: "center",
        gap: mode === "side" ? 12 : 8,
        paddingTop: hudTop + (mode === "strip" ? 8 : m.side ? (v.height <= 340 ? 66 : 88) : 56),
        paddingLeft: hudLeft,
        paddingRight: hudRight,
        paddingBottom: hudBottom + 48 + 12,
      });
    } else
      this.page.setProperties({
        height: undefined,
        minHeight: "100%",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 20,
      });
    // The cards' row takes the rest (1fr) but never less than its content: a grid track's automatic
    // minimum. When that overflows, the original's centred grid spills evenly above and below.
    this.cardsBox.setProperties({
      flexGrow: m.compact ? 1 : 0,
      flexShrink: 0,
      width: m.compact ? (mode === "side" ? undefined : "100%") : undefined,
      alignSelf: m.compact && mode !== "side" ? "stretch" : "auto",
    });
    this.actionsBox.setProperties({
      flexDirection: mode === "side" ? "column" : "row",
      flexWrap: mode === "side" ? "no-wrap" : "wrap",
      alignItems: "center",
    });
    this.rail.setProperties({ flexDirection: mode === "strip" ? "row" : "column" });
    if (mode === "strip") {
      this.rail.setProperties({ alignItems: "center", justifyContent: "center", gap: 16 });
      for (const box of [this.bannerBox, this.actionsBox])
        box.setProperties({
          flexGrow: 0,
          flexBasis: "auto",
          minHeight: undefined,
          justifyContent: "center",
        });
      if (arrange) {
        this.rail.add(this.bannerBox, this.actionsBox);
        this.page.add(this.rail, this.cardsBox);
      }
    } else if (mode === "side") {
      // grid "cards title" / "cards reroll", rows 1fr 1fr: ribbon on the first half's floor,
      // actions from the second half's top; a row never gets less than its content (the grid's
      // automatic minimum), so a tall action column takes room from the ribbon's half.
      const n = this.actions.length;
      this.rail.setProperties({ gap: 12, justifyContent: "flex-start" });
      this.bannerBox.setProperties({
        flexGrow: 1,
        flexBasis: 0,
        minHeight: 32 + 2,
        justifyContent: "flex-end",
      });
      this.actionsBox.setProperties({
        flexGrow: 1,
        flexBasis: 0,
        minHeight: n * 44 + (n - 1) * 8,
        justifyContent: "flex-start",
      });
      if (arrange) {
        this.rail.add(this.bannerBox, this.actionsBox);
        this.page.add(this.cardsBox, this.rail);
      }
    } else {
      this.bannerBox.setProperties({
        flexGrow: 0,
        flexBasis: "auto",
        minHeight: undefined,
        justifyContent: "center",
      });
      this.actionsBox.setProperties({
        flexGrow: 0,
        flexBasis: "auto",
        minHeight: undefined,
        justifyContent: "center",
      });
      if (arrange) this.page.add(this.bannerBox, this.cardsBox, this.actionsBox);
    }
    this.layoutBanner(m);
    const inner = v.width - (m.compact ? hudLeft + hudRight : 40);
    this.layoutCards(m, mode === "side" ? inner - 12 - this.railWidth(m) : inner);
    this.stage.invalidate();
  }
  /** The rail column is as wide as its widest item: the ribbon or the widest action. */
  private railWidth(m: Metrics): number {
    const plate = this.banner?.plate.size.value?.[0] ?? (m.compact ? 110 : 200);
    const tails = (m.compact ? 34 : 58) * 2;
    const action = Math.max(0, ...this.actions.map((a) => a.panel.size.value?.[0] ?? 120));
    return Math.max(plate + tails, action);
  }

  afterLayout(deltaMs: number): void {
    for (const card of this.cards)
      card.key.setProperties({
        display:
          this.coarse || (currentInputMode().kind === "gamepad" && !card.focused) ? "none" : "flex",
      });
    this.elapsed += deltaMs;
    this.layout();
    // The rail's width is only known after its first layout.
    if (!this.docked && this.metrics.side) {
      const width = this.railWidth(this.metrics);
      const v = this.stage.viewport;
      const inner = v.width - Math.max(12, v.safeArea.left) - Math.max(12, v.safeArea.right);
      // Beside the cards the rail may squeeze them below a readable line (9 CJK characters at
      // the description size, measured): then the ribbon and actions share one strip above the
      // cards (in the clock's band, as the original's short-landscape ribbon does) and the cards
      // get the full width.
      const font = this.cards[0]?.title.fontSignal.value;
      const n = Math.max(1, this.cards.length);
      const text = (row: number) => (row - 12 * (n - 1)) / n - 2 * (this.metrics.frame + 12);
      const minLine = font ? 9 * font.getGlyphInfo("汉").xadvance * this.metrics.line : 0;
      const strip = text(inner - 12 - width) < minLine && text(inner) > text(inner - 12 - width);
      if (strip !== this.strip) {
        this.strip = strip;
        this.layoutKey = "";
        this.layout();
      }
      const row = this.strip ? inner : inner - 12 - width;
      if (row !== this.cardRow) {
        this.cardRow = row;
        this.layoutCards(this.metrics, row);
      }
    }
    const flight = this.flight;
    if (flight) flight.elapsed += deltaMs;
    for (const [index, card] of this.cards.entries()) {
      this.poseCard(card, index, flight);
      this.animateCardSurface(card, deltaMs);
    }
    this.animateBanner();
    const chrome = flight ? 1 - easeIn(clamp01(flight.elapsed / 140)) : 1;
    fade(this.bannerBox, chrome);
    fade(this.actionsBox, chrome);
    for (const action of this.actions) {
      action.pattern.update(deltaMs);
      const matrix = action.panel.globalMatrix.value,
        size = action.panel.size.value;
      if (matrix && size) {
        action.cursor.mesh.position.set(
          matrix.elements[12]! - size[0] / 2,
          matrix.elements[13]!,
          0.1,
        );
        action.cursor.setParentOpacity(inheritedOpacity(action.panel));
      }
    }
    if (flight && !flight.landed && flight.elapsed >= PICK_MS) {
      flight.landed = true;
      this.callbacks.pick(flight.index, false);
    }
    // Entrances (deal, banner stamp) and a pick's flight draw every frame; after that the window
    // is idle: sparks, the pointer's card drift and the legendary sweep step on the page's idle
    // clock (DESIGN.md 空闲循环: 15Hz; the sweep 30Hz while it crosses, so it does not stutter).
    const settling =
      flight !== null ||
      this.elapsed - this.dealtAt < SETTLE_MS ||
      (this.banner !== null && this.elapsed - this.banner.born < SETTLE_MS);
    if (settling || idleTicked(this.sweeping() ? 30 : 15)) this.stage.invalidate();
  }

  /** Whether a legendary card's sweep is crossing it now (the first 55% of its 3.2s cycle). */
  private sweeping(): boolean {
    return this.cards.some((card) => {
      if (card.copy.kind !== "move" || card.copy.tone !== "legendary") return false;
      const age = this.elapsed - card.born - 500;
      return age >= 0 && (age % 3200) / 3200 < 0.55;
    });
  }

  private poseCard(card: Card, index: number, flight: Flight | null): void {
    const enabled = this.cardEnabled(index);
    let pose: CardPose;
    if (flight && card.from) {
      const from = card.from;
      if (index === flight.index) {
        const t = clamp01(flight.elapsed / PICK_MS);
        if (t < 0.28) {
          const e = uiEaseOut(t / 0.28);
          pose = {
            x: lerp(from.x, 0, e),
            y: lerp(from.y, -8, e),
            scale: lerp(from.scale, 1.08, e),
            rotation: lerp(from.rotation, 0, e),
            opacity: lerp(from.opacity, 1, e),
          };
        } else if (t < 0.75) {
          const e = uiEaseOut((t - 0.28) / 0.47);
          pose = {
            x: lerp(0, flight.dx * 0.8, e),
            y: lerp(-8, flight.dy * 0.8, e),
            scale: lerp(1.08, 0.32, e),
            rotation: 0,
            opacity: 1,
          };
        } else {
          const e = uiEaseOut((t - 0.75) / 0.25);
          pose = {
            x: lerp(flight.dx * 0.8, flight.dx, e),
            y: lerp(flight.dy * 0.8, flight.dy, e),
            scale: lerp(0.32, 0.16, e),
            rotation: 0,
            opacity: 1 - e,
          };
        }
        card.surface.setPick(t < 0.28 ? uiEaseOut(t / 0.28) : 1 - uiEaseOut((t - 0.28) / 0.72));
      } else {
        // run-card-out 180ms ease-in.
        const e = easeIn(clamp01(flight.elapsed / 180));
        pose = {
          x: from.x,
          y: lerp(from.y, 28, e),
          scale: lerp(from.scale, 0.94, e),
          rotation: lerp(from.rotation, 0, e),
          opacity: lerp(from.opacity, 0, e),
        };
      }
    } else {
      // run-card-in 200ms ease-out, 60ms apart, from below with a slight tilt.
      const e = uiEaseOut(clamp01((this.elapsed - this.dealtAt - index * 60) / 200));
      const lift = enabled ? card.lift.value : 0;
      pose = {
        x: 0,
        y: lerp(28, lift, e),
        scale: lerp(0.94, 1, e),
        rotation: lerp(-3, 0, e),
        opacity: e,
      };
    }
    card.pose = pose;
    // `.run-card:disabled { opacity: .5 }` fades the card as one picture. Per-layer alpha would
    // let the half-transparent face show through the half-transparent text, so the face takes the
    // 50% and the content above it 80%, which reads as the same group fade over the scene.
    if (card.dimmed !== !enabled) {
      card.dimmed = !enabled;
      for (const child of card.panel.children)
        if (child instanceof Component)
          fade(child as Component, !enabled ? (child === card.surface.content ? 0.5 : 0.8) : 1);
    }
    const applied = `${pose.x.toFixed(3)},${pose.y.toFixed(3)},${pose.scale.toFixed(4)},${pose.rotation.toFixed(3)},${pose.opacity.toFixed(3)}`;
    if (applied === card.applied) return;
    card.applied = applied;
    fade(card.panel, pose.opacity).setProperties({
      transformTranslateX: pose.x,
      transformTranslateY: pose.y,
      transformScaleX: pose.scale,
      transformScaleY: pose.scale,
      // CSS rotate() turns clockwise on a y-down screen; UIKit's z rotation turns the other way.
      transformRotateZ: -pose.rotation,
    });
  }

  private animateCardSurface(card: Card, deltaMs: number): void {
    const index = this.cards.indexOf(card);
    // The picked card keeps its :hover look while it pops; the others leave it as they fall.
    const lit =
      card.shown && this.cardEnabled(index) && (!this.flight || this.flight.index === index);
    card.surface.setVeil(card.veil.value);
    // --card-fx drifts one tile per 24s, only under a resting pointer (DESIGN.md).
    if (lit && card.pointer) {
      card.pattern.x = (card.pattern.x + (84 * deltaMs) / 24000) % 84;
      card.pattern.y = (card.pattern.y + (42 * deltaMs) / 24000) % 42;
    }
    card.surface.setPattern(lit, card.pattern.x, card.pattern.y);
    if (card.copy.kind === "move" && card.copy.tone === "legendary") {
      // run-card-sweep 3.2s ease-in-out after .5s: across in the first 55%, then rest.
      const age = this.elapsed - card.born - 500;
      const phase = age < 0 ? 0 : (age % 3200) / 3200;
      card.surface.setSweep(
        age < 0 ? -1.3 : phase < 0.55 ? lerp(-1.3, 3.3, easeInOut(phase / 0.55)) : 3.3,
      );
    }
  }

  // ---------------------------------------------------------------- teardown

  private disposeTree(root: Container): void {
    root.removeFromParent();
    const parts: { dispose(): void }[] = [];
    root.traverse((node) => {
      if (node instanceof Component) parts.push(node);
    });
    for (const part of parts.reverse()) part.dispose();
  }
  private clearCards(): void {
    for (const card of this.cards) {
      this.stage.motion.cancel(card.lift);
      this.stage.motion.cancel(card.veil);
      card.surface.dispose();
      card.plate?.dispose();
      this.keycaps.delete(card.key);
      this.disposeTree(card.panel);
    }
    this.cards = [];
  }
  private clearActions(): void {
    for (const action of this.actions) {
      this.stage.motion.cancel(action.motion);
      action.pattern.dispose();
      action.cursor.dispose();
      action.skin.dispose();
      this.keycaps.delete(action.badge);
      this.disposeTree(action.panel);
    }
    this.actions = [];
  }
  private clearBanner(): void {
    const b = this.banner;
    if (!b) return;
    for (const tail of b.tails) tail.dispose();
    b.plateSkin.dispose();
    for (const spark of b.sparks) spark.content.dispose();
    if (b.kicker && !b.kicker.row.parent) this.disposeTree(b.kicker.row);
    this.disposeTree(b.root);
    this.banner = null;
  }
  dispose(): void {
    this.clearCards();
    this.clearActions();
    this.clearBanner();
    this.controls = [];
    // Boxes the current arrangement left detached (or not yet placed) are disposed on their own.
    for (const box of [this.rail, this.bannerBox, this.cardsBox, this.actionsBox, this.page])
      if (!box.parent) this.disposeTree(box);
    this.disposeTree(this.root);
  }
}
