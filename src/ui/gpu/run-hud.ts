import { MAX_ITEM_SLOTS } from "../../run/sim/content/params/cards";
import { STAGE_ROUTE } from "../../run/sim/content/campaign";
import { stageDefs } from "../../run/sim/content/stages/index";
import { FullscreenIcon } from "./fullscreen-icon";
import { type NavigationAction } from "../../platform/input";
import { InputGlyph } from "./input-glyph";
import { GpuDamageNumbers } from "./run-damage-numbers";
import { softOf, themeColors } from "./run-choice-surface";
import { GpuEdgeGlow } from "./run-edge-glow";
import { GpuEdgeIndicators } from "./run-edge-indicators";
import type { World } from "../../run/sim/state/world";
import type { PlayerId } from "../../run/sim/state/entities";
import type { PerspectiveCamera } from "three";
import { GpuDevReadout } from "./run-dev-readout";
import {
  Container,
  Image,
  Text,
  withOpacity,
  type ImageOutProperties,
  type FontFamilies,
} from "@pmndrs/uikit";
import { Color, Matrix4, Vector3 } from "three";
import type { RunSnapshot } from "../../run/createRun";
import { formatTime } from "../../run/labels";
import { moves } from "../../run/sim/content/moves";
import type { ElementType } from "../../run/sim/content/elements";
import type { StarterId } from "../../run/sim/content/lines/index";
import { UiStage } from "./stage";
import type { UiInsets } from "./viewport";
import { RunHudArt, RunHudSurface } from "./run-hud-surface";
import { RunHeaderSurface, themeGrain } from "./run-overlays-surface";
import { RunHudInteract } from "./run-hud-interact";
import { OutlinedText } from "./outlined-text";
import { uiEaseOut, cubicBezier } from "./focus-mark";

const cssEase = (t: number) => cubicBezier(t, 0.25, 0.1, 0.25, 1);
import { HoverPattern } from "./hover-pattern";
import { fade, stack } from "./layer";
import { CURRENCY_ICON } from "./currency";
import { createMenuIcon } from "./icons";
import { createRunCommandIcon } from "./run-overlays-icons";
import { playerColors } from "../player-colors";
import { typeTag } from "./tag";
import { formDefs } from "../../run/sim/content/lines/index";

export interface RunHudNotice {
  id: number;
  text: string;
  tone: "info" | "danger" | "reward";
}
export interface RunHudState {
  snapshot: RunSnapshot | null;
  theme: ElementType;
  visible: boolean;
  blocked: boolean;
  notice: RunHudNotice | null;
}
export interface RunHudCallbacks {
  pause(): void;
  stats(): void;
  dash(): void;
  ultimate(): void;
  interact(): void;
  turn(direction: -1 | 0 | 1): void;
}
interface Slot {
  /** The slot and, for a move, its name label under it. */
  cell: Container;
  panel: Container;
  label: Text | null;
  face: RunHudSurface;
  image: Image<ImageOutProperties<unknown>>;
  badge: Text;
  cooldown: RunHudSurface | null;
  id: string | null;
  /** The cooldown sweep: the last snapshot's reading, advanced at 1/cd a second until the next. */
  sweep: { ready: number; cd: number; since: number; shown: number };
}

/** A teammate's compact line: portrait in their player colour, P tag, level, HP bar. */
interface Mate {
  row: Container;
  face: Image<ImageOutProperties<unknown>>;
  tag: Text;
  level: Text;
  fill: Container;
  form: string | null;
}

/** The HUD snapshot's period: the sweep runs ahead of a reading by at most this much. */
const SNAPSHOT_MS = 100;
interface Control {
  panel: Container;
  action: "fullscreen" | "pause" | "stats" | "dash" | "ultimate" | "left" | "right" | "interact";
  enabled: boolean;
  /** The ball pattern while hovered or keyboard-focused; none on the ultimate, whose face is art. */
  pattern?: HoverPattern;
}

/** Persistent HUD nodes consume the existing 10Hz snapshot; only GPU properties animate per frame. */
/** The HUD's idle loops redraw at 15Hz (see `afterLayout`). */
const IDLE_STEP_MS = 1000 / 15;
/** `--stick-zone`: the bottom-left span the floating stick's thumb owns on touch. */
const STICK_ZONE = 150;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
/**
 * The player's HP bar curve `k` (DESIGN.md 生命条曲线): length L(h) = h·(1 − k + k·h) for the true
 * fraction h. A point of damage moves the bar (1 + k)× near full and (1 − k)× near empty; the bar
 * never reads longer than the truth. Display only: the number, the danger state and the sim use h.
 */
const PLAYER_HP_CURVE = 0.5;
export const healthLength = (h: number, curve: number): number => h * (1 - curve + curve * h);
/** A heal at least this share of max HP eases in over `HEAL_MS` with a glow; smaller ones follow. */
const HEAL_BIG = 0.03;
const HEAL_MS = 420;
/** Below this share of real HP the bar takes the low-HP look and the screen edge breathes. */
const LOW_HP = 0.3;
/** XP ring chase, in levels: ease-out time constant, the slowest and fastest it moves (laps/s). */
const XP_TAU_MS = 120;
const XP_MIN_SPEED = 0.35;
const XP_MAX_SPEED = 3;
/** The gained arc's tail follows the head with this time constant. */
const XP_TRAIL_TAU_MS = 260;
/** Level beat: the full ring holds and flashes before it resets. */
const XP_BEAT_HOLD_MS = 160;
const XP_GLOW_MS = 420;

interface HealthBar {
  readonly surface: RunHudSurface;
  readonly chip: RunHudSurface;
  /** `k` of `healthLength`; 0 draws the bar linear. */
  readonly curve: number;
  /** True HP fractions: the fill drawn, the chip's right edge, a heal's target. */
  readonly state: { fill: number; trail: number; lead: number };
  readonly chipAge: { t: number };
  readonly glow: { t: number };
  target: number | null;
}

export class GpuRunHud {
  readonly stage = new UiStage();
  /** Floating combat text over the world, under the controls; the run spawns and moves it. */
  readonly numbers: GpuDamageNumbers;
  private readonly edges = new GpuEdgeGlow(this.stage);
  private readonly indicators: GpuEdgeIndicators;
  private devReadout: GpuDevReadout | null = null;
  readonly compassSlot = new Container({ height: 36, width: "100%", justifyContent: "center" });
  readonly mapSlot = new Container({
    positionType: "absolute",
    positionTop: "100%",
    positionLeft: 0,
    width: "100%",
    minHeight: 0,
  });
  // The top and bottom rows retain their size; the open battlefield takes the remaining space.
  private readonly top = new Container({
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    flexShrink: 0,
  });
  private readonly left = new Container({
    flexDirection: "column",
    alignItems: "flex-start",
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
  });
  private readonly vitals = new Container({
    flexDirection: "row",
    alignItems: "center",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 300,
  });
  /** The portrait medal: the form's portrait on the theme disc inside the XP ring. */
  private readonly medal = new Container({
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  });
  private readonly portrait = new Image({
    positionType: "absolute",
    width: "84%",
    height: "84%",
  });
  private portraitForm: string | null = null;
  /** The level pill on the medal's lower-left rim. */
  private readonly level = new OutlinedText(
    { text: "1", fontSize: 15, fontWeight: 800, color: "#ffffff" },
    { width: 3, color: "#0d233f" },
  );
  private readonly levelPill = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionBottom: -4,
    height: 20,
    paddingX: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#d8effb",
    backgroundColor: "#0d233f",
  });
  /** The name plate right of the medal: the form's name and types over the HP bar. */
  private readonly plate = new Container({
    flexDirection: "column",
    justifyContent: "center",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: 4,
  });
  private readonly plateFace = new RunHudSurface("plate");
  private readonly nameRow = new Container({
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  });
  private readonly formName = new Text({
    text: "",
    fontSize: 16,
    fontWeight: 800,
    color: "#ffffff",
    whiteSpace: "pre",
    flexShrink: 1,
    minWidth: 0,
  });
  private readonly formTypes = new Container({ flexDirection: "row", gap: 3, flexShrink: 0 });
  private typeTags: Container[] = [];
  /** Compact lines for the other players, under the vitals. */
  private readonly team = new Container({
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    display: "none",
  });
  private readonly mates: Mate[] = [];
  private readonly xp = new RunHudSurface("ring");
  private readonly medalFace = new RunHudSurface("medal");
  private readonly hpPlate = new Container({
    width: "100%",
    minWidth: 55,
    height: 22,
    padding: 3,
    borderWidth: 2,
    borderColor: "#0d233f",
    borderRadius: 6,
  });
  private readonly hp = new RunHudSurface("hp");
  private readonly hpChip = new RunHudSurface("chip");
  /** `.run-meter--hp > b`: the HP at caption size, then `/max` at badge size, 700, 85%. */
  private readonly hpText = stack(
    new Container({
      positionType: "absolute",
      positionRight: 8,
      positionTop: 0,
      positionBottom: 0,
      flexDirection: "row",
      alignItems: "center",
    }),
    4,
  );
  // `.run-meter--hp > b`: -webkit-text-stroke 3px navy-deep on both parts.
  private readonly hpNow = new OutlinedText(
    { text: "", fontSize: 13, fontWeight: 800, color: "#ffffff" },
    { width: 3, color: "#0d233f" },
  );
  private readonly hpMax = new OutlinedText(
    { text: "", fontSize: 11, fontWeight: 700, color: "#ffffff" },
    { width: 3, color: "#0d233f" },
  );
  private readonly center = new Container({
    flexDirection: "column",
    alignItems: "center",
    flexShrink: 0,
    width: 260,
    gap: 4,
  });
  private readonly clockStack = new Container({ alignItems: "center" });
  /** The readout under the compass, faded out while a run window is open (see `setWindowOpen`). */
  private readonly readout = { opacity: 1 };
  /** `.run-clock__time`: white, -webkit-text-stroke 6px navy-deep (rampage: pink on wine). */
  private readonly clock = new OutlinedText(
    { text: "00:00", fontSize: 32, fontWeight: 800, color: "#ffffff" },
    { width: 6, color: "#0d233f" },
  );
  private readonly meta = new Text({
    text: "",
    fontSize: 13,
    fontWeight: 800,
    color: "#d8effb",
    backgroundColor: withOpacity("#0d233f", 0.55),
    paddingX: 10,
    borderRadius: 12,
  });
  private readonly boss = new Container({
    width: "100%",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    display: "none",
  });
  /** The guardian's name, set when it changes (each zone has its own guardian). */
  private readonly bossName = new Text({
    text: "",
    fontSize: 16,
    fontWeight: 800,
    color: "#ffffff",
  });
  private readonly bossHp = new RunHudSurface("hp");
  private readonly bossChip = new RunHudSurface("chip");
  private readonly right = new Container({
    flexDirection: "column",
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    alignItems: "flex-end",
    minWidth: 64,
  });
  private readonly stardust = new Text({
    text: "0",
    fontSize: 20,
    fontWeight: 800,
    color: "#ffd45b",
    paddingX: 10,
    paddingY: 0,
  });
  private readonly bottom = new Container({
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 16,
    justifyContent: "flex-end",
    flexShrink: 0,
  });
  private readonly slots = new Container({
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 12,
  });
  private choiceOpen = false;
  private readonly moveRow = new Container({
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-end",
  });
  /** Keyboard and mouse: the moves, then the ultimate and dash, as one bar in the lower left. */
  private readonly skillRow = new Container({
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 14,
  });
  private readonly itemRow = new Container({ flexDirection: "row", flexWrap: "wrap", gap: 6 });
  private readonly actions = new Container({
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 10,
    flexShrink: 0,
  });
  private readonly turnRow = new Container({ flexDirection: "row", gap: 8 });
  private readonly thumbs = new Container({ flexDirection: "row", gap: 12, alignItems: "center" });
  private readonly interact = new RunHudInteract(this.stage);
  private readonly noticePanel = new Container({
    width: "100%",
    maxWidth: 300,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingTop: 6,
    flexShrink: 0,
    display: "none",
  });
  private readonly noticeText = new OutlinedText(
    {
      text: "",
      fontSize: 16,
      fontWeight: 800,
      lineHeight: 1.4,
      color: "#ffffff",
      whiteSpace: "normal",
    },
    { width: 3, color: "#0d233f" },
  );
  private readonly noticeIcons = {
    info: createMenuIcon("arrow"),
    danger: createMenuIcon("danger"),
    reward: createMenuIcon("spark"),
  };
  private readonly noticePose = { opacity: 0, y: -4 };
  private noticeId: number | null = null;
  private leftHeight = 0;
  private readonly moves: Slot[] = [];
  private readonly items: Slot[] = [];
  private readonly surfaces: RunHudSurface[] = [];
  private readonly controls: Control[] = [];
  private focusVisible = true;
  private readonly held = new Map<number, number>();
  private readonly point = new Vector3();
  private readonly inverse = new Matrix4();
  private readonly hpBar: HealthBar = {
    surface: this.hp,
    chip: this.hpChip,
    curve: PLAYER_HP_CURVE,
    state: { fill: 1, trail: 1, lead: 1 },
    chipAge: { t: 0 },
    glow: { t: 0 },
    target: null,
  };
  /** Shield as an ice band over the top of the HP bar, its length the share of the max left. */
  private readonly shieldBar = stack(
    new Container({
      positionType: "absolute",
      positionLeft: 0,
      positionTop: 0,
      height: "45%",
      width: "0%",
      borderRadius: 3,
      borderWidth: 1,
      borderColor: "#0d233f",
      backgroundColor: "#bfe9ff",
      display: "none",
    }),
    1,
  );
  private readonly shieldState = { fill: 0 };
  private shieldTarget = -1;
  /** Dash charges as pips over the dash key, shown only when there is more than one. */
  private readonly dashPips = stack(
    new Container({
      positionType: "absolute",
      positionTop: -6,
      positionLeft: 0,
      positionRight: 0,
      flexDirection: "row",
      justifyContent: "center",
      gap: 3,
      display: "none",
    }),
    4,
  );
  private dashPipDots: Container[] = [];
  private dashPipsReady = -1;
  private dashPipsMax = -1;
  /** The guardian's bar stays linear: the curve is a device for the player's own tension. */
  private readonly bossBar: HealthBar = {
    surface: this.bossHp,
    chip: this.bossChip,
    curve: 0,
    state: { fill: 1, trail: 1, lead: 1 },
    chipAge: { t: 0 },
    glow: { t: 0 },
    target: null,
  };
  /**
   * The XP ring in levels (level + xp share): `progress` chases `goal` with an ease-out, `trail` is
   * the gained arc's tail, `hold` the level beat's pause at full. -1 until the first snapshot.
   */
  private readonly xpShown = { progress: -1, goal: 0, trail: 0, hold: 0, glow: 0 };
  private readonly medalPose = { scale: 1 };
  private state: RunHudState | null = null;
  // Nothing in the HUD holds focus until the keyboard moves into it (Tab).
  private hovered: number | null = null;
  private selected = -1;
  private turn: -1 | 0 | 1 = 0;
  private coarse = false;
  private compact = false;
  private mapHeight = -1;
  private readonly dash: RunHudSurface;
  private readonly ultimate: RunHudSurface;
  private readonly halo = new RunHudSurface("halo");
  private elapsed = 0;
  private readonly dashPose = { scale: 1 };
  private bottomHeight = 0;
  private readonly ultPose = { scale: 1 };
  private readonly crest: Image<ImageOutProperties<unknown>>;
  private readonly stick = new Container({
    positionType: "absolute",
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 3,
    borderColor: withOpacity("#ffffff", 0.65),
    backgroundColor: withOpacity("#0d233f", 0.22),
    alignItems: "center",
    justifyContent: "center",
    display: "none",
  });
  private readonly knob = new Container({
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffd45b",
    borderBottomWidth: 2,
    borderColor: "#0d233f",
  });

  private readonly callbacks: RunHudCallbacks;
  constructor(fonts: FontFamilies, starter: StarterId, callbacks: RunHudCallbacks) {
    this.callbacks = callbacks;
    this.stage.root.setProperties({
      fontFamilies: fonts,
      flexDirection: "column",
      color: "#ffffff",
    });
    this.numbers = new GpuDamageNumbers(this.stage);
    this.indicators = new GpuEdgeIndicators(this.stage, [
      this.top,
      this.mapSlot,
      this.bottom,
      this.interact.row,
    ]);
    this.surfaces.push(this.xp, this.hp, this.hpChip, this.bossHp, this.bossChip);
    this.xp.uniforms.hudLight.value.set("#a9e6ff");
    // One notch where the bar turns to the low-HP look (30% real HP), placed through the curve.
    this.hp.uniforms.hudTicks.value.set(healthLength(LOW_HP, PLAYER_HP_CURVE), -1, -1);
    this.medal.add(this.xp.content);
    this.medalFace.content.setProperties({
      positionLeft: 6,
      positionTop: 6,
      width: 46,
      height: 46,
    });
    this.surfaces.push(this.medalFace);
    this.medal.add(stack(this.medalFace.content, 1), stack(this.portrait, 2));
    this.levelPill.add(
      stack(
        new OutlinedText(
          { text: "Lv", fontSize: 10, fontWeight: 800, color: "#d8effb" },
          { width: 2.5, color: "#0d233f" },
        ).root,
        1,
      ),
      stack(this.level.root, 1),
    );
    this.medal.add(stack(this.levelPill, 4));
    this.crest = stack(
      new Image({
        src: "/art/icons/crests/fire.webp",
        width: 28,
        height: 28,
        positionType: "absolute",
        positionTop: -8,
        positionLeft: -2,
      }),
      3,
    );
    this.medal.add(this.crest);
    const hpBox = new Container({ height: "100%", width: "100%", justifyContent: "center" });
    stack(this.hpChip.content, 1);
    fade(this.hpMax.root, 0.85);
    this.hpText.add(this.hpNow.root, this.hpMax.root);
    hpBox.add(this.hp.content, this.hpChip.content, this.shieldBar, this.hpText);
    this.hpPlate.add(hpBox);
    this.surfaces.push(this.plateFace);
    this.nameRow.add(stack(this.formName, 1), stack(this.formTypes, 1));
    this.plate.add(this.plateFace.content, this.nameRow, stack(this.hpPlate, 1));
    // The medal overlaps the plate's square end and draws over it.
    this.vitals.add(stack(this.medal, 3), this.plate);
    for (let i = 0; i < 3; i++) this.mates.push(this.addMate());
    this.clockStack.add(this.clock.root);
    this.center.add(this.compassSlot, this.clockStack, this.meta);
    const bossBar = new Container({ width: "100%", height: 14 });
    stack(this.bossChip.content, 1);
    bossBar.add(this.bossHp.content, this.bossChip.content);
    this.boss.add(
      // The hit chip swells past the bar's top edge; the name stays above it (DESIGN.md 掉血段).
      stack(this.bossName, 2),
      bossBar,
    );
    this.center.add(this.boss);
    const purse = new Container({
      width: "100%",
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "flex-end",
      alignItems: "center",
      gap: 12,
    });
    const pursePlate = new Container({
      flexDirection: "row",
      alignItems: "center",
      height: 32,
      paddingRight: 4,
      backgroundColor: withOpacity("#0d233f", 0.55),
      borderColor: withOpacity("#ffd45b", 0.7),
      borderWidth: 2,
      borderRadius: 999,
    });
    const purseIcon = stack(
      new Image({
        src: CURRENCY_ICON,
        width: 40,
        height: 40,
        marginLeft: -10,
        marginRight: 4,
      }),
      1,
    );
    pursePlate.add(purseIcon, this.stardust);
    const fullscreen = this.addControl("fullscreen", 48, 5).panel;
    const icon = this.fullscreenIcon;
    icon.setProperties({ width: 24, height: 24, color: "#d8effb" });
    fullscreen.add(stack(icon, 1));
    fullscreen.setProperties({ display: "none" });
    // The build panel's touch entry (C / LB elsewhere); glyph 5 is the plain button face.
    const stats = this.addControl("stats", 48, 5).panel;
    const statsIcon = createRunCommandIcon("chart");
    statsIcon.setProperties({ color: "#d8effb" });
    stats.add(stack(statsIcon, 1), this.keycap("C", "stats"));
    purse.add(pursePlate, stats, this.addControl("pause", 48, 1).panel, fullscreen);
    this.right.add(purse, this.mapSlot);
    this.noticeText.root.setProperties({ flexGrow: 1, flexShrink: 1, minWidth: 0 });
    for (const icon of Object.values(this.noticeIcons)) {
      icon.setProperties({
        width: 18,
        height: 18,
        marginTop: 2,
        color: "#ffd45b",
        display: "none",
      });
      this.noticePanel.add(icon);
    }
    this.noticePanel.add(this.noticeText.root);
    this.left.add(this.vitals, this.team, this.noticePanel);
    this.top.add(this.left, this.center, this.right);
    for (let i = 0; i < 4; i++) this.moves.push(this.addSlot(this.moveRow, true));
    for (let i = 0; i < MAX_ITEM_SLOTS + 1; i++) this.items.push(this.addSlot(this.itemRow, false));
    this.turnRow.add(this.addControl("left", 48, 3).panel, this.addControl("right", 48, 4).panel);
    const ultimate = this.addControl("ultimate", 64, 0);
    this.ultimate = ultimate.surface;
    stack(this.halo.content, -1).setProperties({
      positionLeft: "-25%",
      positionTop: "-25%",
      width: "150%",
      height: "150%",
      display: "none",
    });
    this.surfaces.push(this.halo);
    ultimate.panel.add(this.halo.content);
    this.ultArt = new RunHudArt(`/art/icons/ultimates/${starter}.webp`, () =>
      this.stage.invalidate(),
    );
    this.ultArt.uniforms.artGray.value = this.ultLook.gray;
    this.ultArt.uniforms.artBright.value = this.ultLook.bright;
    this.ultArt.content.setProperties({ width: "62%", height: "62%" });
    ultimate.panel.add(stack(this.ultArt.content, 1), this.keycap("F", "ult"));
    const dash = this.addControl("dash", 64, 2);
    this.dash = dash.surface;
    // `.run-thumb` --ring-fill: var(--ice).
    this.dash.uniforms.hudColor.value.set("#d8effb");
    dash.panel.add(this.keycap("Space", "dash"), this.dashPips);
    this.thumbs.add(ultimate.panel, dash.panel);
    this.placeBar();
    this.bottom.add(this.slots, this.actions);
    const interactPattern = new HoverPattern(
      this.stage.motion,
      () => this.stage.invalidate(),
      "#142f50",
      8,
      false,
    );
    this.interact.panel.add(interactPattern.content);
    this.controls.push({
      panel: this.interact.panel,
      action: "interact",
      enabled: false,
      pattern: interactPattern,
    });
    this.stage.root.add(
      this.top,
      new Container({ flexGrow: 1, flexBasis: 0 }),
      this.bottom,
      this.interact.row,
    );
    this.stick.add(this.knob);
    this.stage.root.add(this.stick);
  }
  private addControl(
    action: Control["action"],
    size: number,
    glyph: number,
  ): { panel: Container; surface: RunHudSurface } {
    const panel = new Container({
      width: size,
      height: size,
      minWidth: 44,
      minHeight: 44,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: size / 2,
    });
    const surface = new RunHudSurface("button", glyph);
    panel.add(surface.content);
    this.surfaces.push(surface);
    const pattern =
      action === "ultimate"
        ? undefined
        : new HoverPattern(
            this.stage.motion,
            () => this.stage.invalidate(),
            "#0d233f",
            size / 2,
            false,
          );
    if (pattern) panel.add(pattern.content);
    this.controls.push({ panel, action, enabled: true, pattern });
    return { panel, surface };
  }
  private addMate(): Mate {
    const row = new Container({
      height: 28,
      paddingLeft: 2,
      paddingRight: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 999,
      backgroundColor: withOpacity("#0d233f", 0.62),
      display: "none",
    });
    const face = new Image({
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      backgroundColor: "#d8effb",
      flexShrink: 0,
    });
    const tag = new Text({ text: "", fontSize: 12, fontWeight: 800 });
    const level = new Text({ text: "", fontSize: 12, fontWeight: 800, color: "#d8effb" });
    const track = new Container({
      width: 84,
      height: 8,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: "#0d233f",
      backgroundColor: "#22364f",
      overflow: "hidden",
    });
    const fill = new Container({ height: "100%", width: "100%", borderRadius: 3 });
    track.add(fill);
    row.add(face, tag, level, track);
    this.team.add(row);
    return { row, face, tag, level, fill, form: null };
  }
  private updateTeam(team: RunSnapshot["team"]): void {
    this.team.setProperties({ display: team.length > 0 ? "flex" : "none" });
    this.mates.forEach((mate, i) => {
      const data = team[i];
      mate.row.setProperties({ display: data ? "flex" : "none" });
      if (!data) return;
      if (mate.form !== data.form) {
        mate.form = data.form;
        mate.face.setProperties({ src: `/art/portraits/${data.form}.webp` });
      }
      const color = playerColors[data.slot] ?? "#ffffff";
      const share = data.alive ? Math.max(0, Math.min(1, data.hp / data.maxHp)) : 0;
      mate.face.setProperties({ borderColor: color, opacity: data.alive ? 1 : 0.4 });
      // On the wine row of a downed teammate the player colour stays on the ring only.
      mate.tag.setProperties({ text: `P${data.slot + 1}`, color: data.alive ? color : "#ffffff" });
      mate.level.setProperties({
        text: `Lv ${data.level}`,
        color: data.alive ? "#d8effb" : "#ffffff",
      });
      mate.fill.setProperties({
        width: `${share * 100}%`,
        backgroundColor: share < LOW_HP ? "#ff6f7d" : "#7fd96a",
      });
      mate.row.setProperties({
        // Down and waiting for a rescue: the line turns wine like the rampage clock.
        backgroundColor: data.alive ? withOpacity("#0d233f", 0.62) : withOpacity("#96182e", 0.75),
      });
    });
  }
  private addSlot(row: Container, move: boolean): Slot {
    const panel = new Container({
      width: move ? 60 : 40,
      height: move ? 60 : 40,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      overflow: "hidden",
    });
    const face = new RunHudSurface("slot");
    face.uniforms.hudColor.value.set("#e9f4fb");
    this.surfaces.push(face);
    panel.add(face.content);
    const image = stack(new Image({ width: "74%", height: "74%", display: "none" }), 1);
    const badge = stack(
      new Text({
        text: "",
        positionType: "absolute",
        positionRight: 0,
        positionTop: 0,
        fontSize: 11,
        fontWeight: 800,
        backgroundColor: "#0d233f",
        color: "#ffffff",
        paddingX: 3,
        // `.run-badge`: a theme-deep tab in the corner, its free corner rounded.
        borderBottomLeftRadius: 4,
      }),
      3,
    );
    panel.add(image);
    let cooldown: RunHudSurface | null = null;
    if (move) {
      cooldown = new RunHudSurface("cooldown");
      stack(cooldown.content, 2);
      panel.add(cooldown.content);
      this.surfaces.push(cooldown);
    }
    panel.add(badge);
    const cell = new Container({ flexDirection: "column", alignItems: "center", flexShrink: 0 });
    cell.add(panel);
    let label: Text | null = null;
    if (move) {
      // Keyboard and mouse only (`placeBar`): the name on a navy tab over the slot's lower rim.
      label = new Text({
        text: "",
        fontSize: 11,
        fontWeight: 800,
        color: "#ffffff",
        whiteSpace: "pre",
        wordBreak: "keep-all",
        paddingX: 6,
        marginTop: -8,
        borderRadius: 999,
        backgroundColor: "#0d233f",
        borderWidth: 1.5,
        borderColor: withOpacity("#d8effb", 0.6),
        display: "none",
        visibility: "hidden",
      });
      cell.add(stack(label, 4));
    }
    row.add(cell);
    return {
      cell,
      panel,
      label,
      face,
      image,
      badge,
      cooldown,
      id: null,
      sweep: { ready: 1, cd: 1, since: 0, shown: 1 },
    };
  }
  resize(width: number, height: number, scale: number, safe: UiInsets): void {
    this.stage.resize(width, height, scale, safe);
    this.slotsTwoRows = null;
    this.bottomHeight = 0;
    this.bottom.setProperties({ minHeight: 0 });
    const v = this.stage.viewport;
    this.compact = v.height <= 480;
    const edge = this.compact ? 12 : 16;
    const padLeft = Math.max(edge, v.safeArea.left),
      padRight = Math.max(edge, v.safeArea.right);
    this.stage.root.setProperties({
      // --edge-hud: 16px, 12px in short landscape; never inside the safe area.
      paddingTop: Math.max(edge, v.safeArea.top),
      paddingRight: padRight,
      paddingBottom: Math.max(edge, v.safeArea.bottom),
      paddingLeft: padLeft,
    });
    const gap = this.compact ? 6 : 12;
    // `grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)`: equal sides, so the clock and the
    // compass sit on the row's centre whatever each side holds. Flex growth alone let the vitals'
    // percentage width pull the sides apart (50px at 1280). The centre column is `auto`: as wide as
    // the compass, min(420px, 46vw), in whole device pixels.
    // The column's left edge is placed on the device pixel nearest the row's centre and the sides
    // take what is left, so how the paddings round never moves it.
    const grid = this.stage.pixelGrid;
    const rowCentre = ((padLeft + v.width - padRight) / 2) * grid;
    let centreDevice = Math.round(Math.min(420, v.width * 0.46) * grid);
    // A width whose half lands the edge on a half pixel gives up one pixel to sit exactly on it.
    const half = (((rowCentre - centreDevice / 2) % 1) + 1) % 1;
    if (Math.abs(half - 0.5) < 0.25) centreDevice -= 1;
    const centreLeft = Math.round(rowCentre - centreDevice / 2) / grid,
      centre = centreDevice / grid;
    const sides = [
      [this.left, Math.max(0, centreLeft - padLeft - gap)],
      [this.right, Math.max(0, v.width - padRight - gap - centreLeft - centre)],
    ] as const;
    this.top.setProperties({ gap });
    this.center.setProperties({ width: centre, gap: this.compact ? 2 : 4 });
    for (const [column, side] of sides)
      column.setProperties({ width: side, flexGrow: 0, flexShrink: 0, flexBasis: side });
    // The vitals never leave their own column, so they cannot reach the compass column's gap; on
    // short phones the column, not the cap, sets the width, and the bar grows only in height.
    this.vitals.setProperties({ width: "100%", maxWidth: this.compact ? 220 : 300 });
    this.placeDevReadout();
    const medal = this.compact ? 52 : 64;
    this.medal.setProperties({ width: medal, height: medal });
    // The face sits inside the xp ring: 2px border and 4px padding on each side.
    this.medalFace.content.setProperties({ width: medal - 12, height: medal - 12 });
    // The plate's square end runs under the medal's right half; its leaning end keeps 20px clear.
    this.plate.setProperties({
      marginLeft: -medal / 2,
      paddingLeft: medal / 2 + (this.compact ? 8 : 10),
      // 16px clear of the leaning end at the plate's foot (lean 0.3 × the plate's height).
      paddingRight: this.compact ? 30 : 36,
      paddingY: this.compact ? 4 : 6,
      gap: this.compact ? 3 : 4,
    });
    this.formName.setProperties({ fontSize: this.compact ? 14 : 16 });
    this.hpPlate.setProperties({ height: this.compact ? 20 : 24 });
    this.hpNow.set({ fontSize: this.compact ? 12 : 14 });
    this.hpMax.set({ fontSize: this.compact ? 10 : 11 });
    // Clear of the Lv pill, which hangs 4px under the medal.
    this.team.setProperties({ marginTop: this.compact ? 10 : 12, gap: this.compact ? 3 : 4 });
    for (const mate of this.mates) {
      mate.row.setProperties({ height: this.compact ? 24 : 28 });
      mate.level.setProperties({ width: this.compact ? 36 : 40 });
    }
    this.clock.set({ fontSize: this.compact ? 24 : 32 });
    this.meta.setProperties({ fontSize: this.compact ? 11 : 13 });
    this.stardust.setProperties({
      fontSize: this.compact ? 15 : 20,
      paddingX: this.compact ? 5 : 10,
    });
    this.bottom.setProperties({
      flexDirection: "column",
      alignItems: "stretch",
      gap: this.compact ? 6 : 16,
    });
    this.slots.setProperties({ flexGrow: 0 });
    this.layoutSlots();
    this.actions.setProperties({
      positionType: "absolute",
      positionRight: 0,
      positionBottom: 0,
      alignSelf: "flex-end",
      flexDirection: "column",
      alignItems: "flex-end",
      gap: 8,
    });
    this.turnRow.setProperties({ display: this.coarse ? "flex" : "none" });
    for (const slot of this.moves)
      slot.panel.setProperties({ width: this.compact ? 48 : 60, height: this.compact ? 48 : 60 });
    for (const slot of this.items)
      slot.panel.setProperties({ width: this.compact ? 34 : 40, height: this.compact ? 34 : 40 });
    for (const control of this.controls) {
      const thumb = control.action === "dash" || control.action === "ultimate";
      const target = thumb ? (this.coarse ? 76 : 64) : 48;
      control.panel.setProperties({
        minWidth: v.minTarget,
        minHeight: v.minTarget,
        // --size-thumb 64 (76 under a coarse pointer) and --size-icon-button 48 keep their size in
        // short landscape; only slots and type shrink there.
        ...(control.action !== "interact" ? { width: target, height: target } : {}),
      });
    }
    this.stage.invalidate();
  }
  /** `game-coin-pop`: the count springs from 1.3× in white back to its gold over 240ms. */
  private popStardust(): void {
    this.stardustPop.t = 1;
    this.stage.motion.animate(
      this.stardustPop,
      { t: 0 },
      240,
      () => {
        const t = this.stardustPop.t;
        this.stardust.setProperties({
          transformScaleX: 1 + 0.3 * t,
          transformScaleY: 1 + 0.3 * t,
          // A new Color each frame: UIKit compares by reference and would keep the first one.
          color: new Color("#ffd45b").lerp(this.white, t),
        });
        this.stage.invalidate();
      },
      uiEaseOut,
    );
  }
  /** A hurt: the vitals shake (`run-vitals-hit` 300ms) and the HP frame flashes red (`run-hp-flash`). */
  flinch(): void {
    this.edges.flash();
    this.flinchAge.t = 0;
    this.stage.motion.animate(
      this.flinchAge,
      { t: 1 },
      420,
      () => {
        const t = this.flinchAge.t * 420;
        // Keyframes at 20/45/70% of 300ms, linear between, ease-out overall.
        const k = uiEaseOut(Math.min(1, t / 300));
        const keys: [number, number, number][] = [
          [0, 0, 0],
          [0.2, -3, 1],
          [0.45, 3, -1],
          [0.7, -1, 0],
          [1, 0, 0],
        ];
        let x = 0,
          y = 0;
        for (let i = 1; i < keys.length; i++) {
          const [a, ax, ay] = keys[i - 1]!,
            [b, bx, by] = keys[i]!;
          if (k <= b) {
            const f = (k - a) / (b - a);
            x = ax + (bx - ax) * f;
            y = ay + (by - ay) * f;
            break;
          }
        }
        this.vitals.setProperties({ transformTranslateX: x, transformTranslateY: y });
        const flash = 1 - uiEaseOut(Math.min(1, t / 420));
        this.hpPlate.setProperties({
          borderColor: new Color("#0d233f").lerp(this.hurtRed, flash),
        });
        this.stage.invalidate();
      },
      (v) => v,
    );
  }
  /**
   * A run window's top edge would cut through the clock, meta line and guardian bar on a short
   * screen; the windows show the run's time themselves, so the readout fades with the window's
   * 140ms fade instead of being sliced. The compass above stays.
   */
  setWindowOpen(open: boolean): void {
    this.stage.motion.animate(this.readout, { opacity: open ? 0 : 1 }, 140, () => {
      for (const part of [this.clockStack, this.meta, this.boss]) fade(part, this.readout.opacity);
      this.stage.invalidate();
    });
  }
  setChoiceOpen(open: boolean): void {
    if (this.choiceOpen === open) return;
    this.choiceOpen = open;
    // Keep the slot geometry for card flights and for the unchanged touch action layout.
    fade(this.slots, open ? 0 : 1);
    this.stage.invalidate();
  }
  setCoarsePointer(coarse: boolean): void {
    if (coarse !== this.coarse) {
      this.coarse = coarse;
      this.placeBar();
    }
    this.slotsTwoRows = null;
    this.turnRow.setProperties({ display: coarse ? "flex" : "none" });
    for (const cap of this.keycaps) cap.setProperties({ display: coarse ? "none" : "flex" });
    this.interact.setCoarsePointer(coarse);
  }
  /**
   * Touch: moves and items share one bar between the stick's corner and the thumbs, which keep the
   * right corner with the turn pair above them. Keyboard and mouse: items above, moves with their
   * names then the ultimate and dash in one bar in the lower left, the right corner left open.
   */
  private placeBar(): void {
    for (const node of [this.moveRow, this.itemRow, this.thumbs, this.skillRow, this.turnRow])
      node.removeFromParent();
    if (this.coarse) {
      this.slots.add(this.moveRow, this.itemRow);
      this.actions.add(this.turnRow, this.thumbs);
    } else {
      this.skillRow.add(this.moveRow, this.thumbs);
      this.slots.add(this.itemRow, this.skillRow);
      this.actions.add(this.turnRow);
    }
    for (const slot of this.moves)
      slot.label?.setProperties({ display: this.coarse ? "none" : "flex" });
    // Keyboard and mouse: lifted by the name label's overhang so the circles centre on the slots.
    this.thumbs.setProperties({
      alignItems: this.coarse ? "center" : "flex-end",
      marginBottom: this.coarse ? 0 : 8,
    });
    this.bottom.setProperties({ justifyContent: this.coarse ? "flex-end" : "flex-start" });
    this.layoutSlots();
    this.stage.invalidate();
  }
  /** The slot bar's own layout: centred and full width on touch, packed to the left otherwise. */
  private layoutSlots(): void {
    const gap = this.compact ? 8 : 12;
    this.slots.setProperties(
      this.coarse
        ? { width: "100%", flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap", gap }
        : {
            width: "auto",
            alignSelf: "flex-start",
            flexDirection: "column",
            alignItems: "flex-start",
            flexWrap: "no-wrap",
            gap: this.compact ? 6 : 8,
          },
    );
    this.skillRow.setProperties({ gap: this.compact ? 10 : 14 });
  }
  /** `.run-thumb kbd`: an ice Tag badge on the lower-right rim (keyboard only). */
  private keycap(key: string, action: "ult" | "dash" | "stats"): Container {
    const cap = stack(
      new Container({
        positionType: "absolute",
        positionRight: -4,
        positionBottom: -2,
        height: 16,
        minWidth: 16,
        paddingX: 4,
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: "#0d233f",
        backgroundColor: "#d8effb",
        alignItems: "center",
        justifyContent: "center",
        display: this.coarse ? "none" : "flex",
      }),
      4,
    );
    cap.add(new InputGlyph(action, key));
    this.keycaps.push(cap);
    return cap;
  }
  update(state: RunHudState): void {
    const previous = this.state?.snapshot;
    this.state = state;
    this.stage.root.setProperties({ display: state.visible ? "flex" : "none" });
    if (state.blocked) this.cancel();
    const snap = state.snapshot;
    if (!snap) return;
    const low = snap.hp / snap.maxHp < LOW_HP;
    this.edges.setLowHp(low && snap.outcome === "playing");
    const colors = themeColors(state.theme);
    const palette = [colors.theme, colors.deep, colors.light] as const;
    if (this.plateTheme !== state.theme) {
      // The vitals plate is the theme band: theme fill under the theme grain.
      this.plateTheme = state.theme;
      this.hpGrain?.content.removeFromParent();
      this.hpGrain?.dispose();
      this.hpGrain = new RunHeaderSurface(state.theme, palette[0], palette[0], false);
      this.hpPlate.add(stack(this.hpGrain.content, -1));
    }
    this.xp.uniforms.hudDeep.value.set(palette[1]);
    this.medalFace.uniforms.hudColor.value.set(palette[0]);
    this.medalFace.uniforms.hudDeep.value.set(palette[1]);
    this.medalFace.uniforms.hudLight.value.set(palette[2]);
    const grain = themeGrain(state.theme);
    this.medalFace.uniforms.hudGrain.value.set(grain.color);
    this.medalFace.uniforms.hudKind.value = Math.min(3, grain.kind);
    this.xp.uniforms.hudColor.value.set("#59c8ff");
    this.ultimate.uniforms.hudColor.value.set(palette[2]);
    this.ultimate.uniforms.hudLight.value.set(palette[2]);
    this.ultimate.uniforms.hudTheme.value.set(palette[0]);
    this.ultimate.uniforms.hudThemeDeep.value.set(palette[1]);
    this.ultimate.uniforms.hudGrain.value.set(grain.color);
    this.ultimate.uniforms.hudKind.value = Math.min(3, grain.kind);
    this.halo.uniforms.hudColor.value.set(palette[2]);
    this.crest.setProperties({ src: `/art/icons/crests/${state.theme}.webp` });
    this.plateFace.uniforms.hudDeep.value.set(palette[1]);
    if (snap.form !== this.portraitForm) {
      this.portraitForm = snap.form;
      const def = formDefs[snap.form];
      this.portrait.setProperties({ src: `/art/portraits/${snap.form}.webp` });
      this.formName.setProperties({ text: def.name });
      for (const tag of this.typeTags) {
        tag.removeFromParent();
        tag.dispose();
      }
      this.typeTags = def.types.map(typeTag);
      this.formTypes.add(...this.typeTags);
    }
    this.updateTeam(snap.team);
    const goal = snap.level + Math.max(0, Math.min(1, snap.xp / snap.xpNext));
    const xp = this.xpShown;
    if (xp.progress < 0 || goal < xp.progress) {
      // The first reading (or a new run's lower one) is where the ring starts, not a gain.
      Object.assign(xp, { progress: goal, goal, trail: goal, hold: 0, glow: 0 });
      this.level.set({ text: String(snap.level) });
      this.drawXp();
    } else xp.goal = goal;
    this.updateHealth(
      this.hpBar,
      snap.hp / snap.maxHp,
      previous?.hp !== undefined && snap.hp < previous.hp,
    );
    this.hp.uniforms.hudReady.value = low ? 1 : 0;
    this.hp.uniforms.hudColor.value.set(low ? "#ff9a88" : "#9be884");
    this.hp.uniforms.hudDeep.value.set(low ? "#c22f45" : "#3a9a45");
    this.hpNow.set({ text: String(Math.ceil(snap.hp)) });
    this.hpMax.set({ text: `/${Math.round(snap.maxHp)}` });
    this.clock.set({ text: formatTime(snap.time), color: snap.rampage ? "#ffc2c2" : "#ffffff" });
    this.clock.setStrokeColor(snap.rampage ? "#5c0f1f" : "#0d233f");
    this.meta.setProperties({
      // `.run-clock[data-rampage] .run-clock__meta`: wine, rgb(150 24 46 / 82%).
      backgroundColor: snap.rampage ? withOpacity("#96182e", 0.82) : withOpacity("#0d233f", 0.55),
      text: `${STAGE_ROUTE.indexOf(snap.stage) + 1}/6 ${stageDefs[snap.stage].name} ${zoneState(snap)} · ${snap.kills}`,
    });
    if (previous && previous.stardust !== snap.stardust) this.popStardust();
    // This run's earnings, written as a gain (the banked total shows only in the lobby).
    this.stardust.setProperties({ text: `+${snap.stardust}` });
    this.boss.setProperties({ display: snap.boss ? "flex" : "none" });
    if (snap.boss) {
      if (snap.boss.name !== previous?.boss?.name)
        this.bossName.setProperties({ text: snap.boss.name });
      this.updateHealth(
        this.bossBar,
        snap.boss.hp / snap.boss.max,
        Boolean(previous?.boss && snap.boss.hp < previous.boss.hp),
      );
      this.bossHp.uniforms.hudColor.value.set("#ff9a88");
      this.bossHp.uniforms.hudDeep.value.set("#b92640");
    }
    for (let i = 0; i < this.moves.length; i++) {
      const slot = this.moves[i]!,
        move = snap.moves[i];
      this.updateSlot(
        slot,
        move?.id ?? null,
        move ? (moves[move.id].fusion ? `★${move.level}` : String(move.level)) : "",
        i < snap.moveSlots,
        "moves",
      );
      // `.run-move`: the move's own type face, rimmed in the current theme.
      slot.face.uniforms.hudColor.value.set(move ? softOf(moves[move.id].type) : "#e9f4fb");
      slot.face.uniforms.hudDeep.value.set(palette[0]);
      if (move)
        // `Tag tone="theme"`: the run theme's deep step, whatever the move's own type.
        slot.badge.setProperties({ backgroundColor: palette[1] });
      const ready = move ? Math.max(0, Math.min(1, move.ready)) : 1,
        sweep = slot.sweep;
      // A new cast (the reading falls back) restarts the sweep; otherwise it only moves forward.
      if (ready < sweep.shown - 0.25) sweep.shown = ready;
      Object.assign(sweep, { ready, cd: move?.cd ?? 1, since: 0 });
    }
    for (let i = 0; i < this.items.length; i++) {
      const item = snap.items[i];
      this.items[i]!.face.uniforms.hudDeep.value.set(palette[2]);
      this.items[i]!.badge.setProperties({ backgroundColor: palette[1] });
      const tm = i === snap.itemSlots && snap.tmCase;
      this.updateSlot(
        this.items[i]!,
        tm ? "tm-case" : (item?.id ?? null),
        item ? String(item.level) : "",
        i < snap.itemSlots || tm,
        "items",
      );
    }
    this.dash.uniforms.hudFill.value = Math.max(0, Math.min(1, snap.dash));
    this.updateDashPips(snap.dashes, snap.dashMax);
    this.updateShield(snap.shield, snap.shieldMax);
    this.dash.uniforms.hudReady.value = snap.dash >= 1 ? 1 : 0;
    this.ultimate.uniforms.hudReady.value = snap.ult >= 1 ? 1 : 0;
    this.ultimate.uniforms.hudFill.value = Math.max(0, Math.min(1, snap.ult));
    this.halo.content.setProperties({ display: snap.ult >= 1 && !snap.casting ? "flex" : "none" });
    if (snap.dash >= 1 && previous && previous.dash < 1)
      this.readyPulse("dash", this.dashPose, 260);
    if (snap.ult >= 1 && !snap.casting && previous && (previous.ult < 1 || previous.casting))
      this.readyPulse("ultimate", this.ultPose, 320);
    const ultReady = snap.ult >= 1 && !snap.casting;
    if (ultReady !== this.ultReady) {
      this.ultReady = ultReady;
      this.stage.motion.animate(
        this.ultLook,
        { gray: ultReady ? 0 : 0.75, bright: ultReady ? 1 : 0.75 },
        160,
        () => {
          this.ultArt.uniforms.artGray.value = this.ultLook.gray;
          this.ultArt.uniforms.artBright.value = this.ultLook.bright;
          this.stage.invalidate();
        },
        cssEase,
      );
    }
    const ult = this.controls.find((c) => c.action === "ultimate")!;
    fade(ult.panel, snap.casting ? 0.6 : 1);
    this.interact.set(
      snap.prompt,
      state.blocked || this.choiceOpen,
      snap.pendingCount,
      snap.rescueProgress,
      snap.stage === "tower"
        ? "完成探险"
        : `前往${stageDefs[STAGE_ROUTE[STAGE_ROUTE.indexOf(snap.stage) + 1]!].name}`,
    );
    this.controls.find((c) => c.action === "interact")!.enabled =
      Boolean(snap.prompt) && !this.choiceOpen;
    const notice = state.notice;
    this.noticePanel.setProperties({ display: notice ? "flex" : "none" });
    if (notice && notice.id !== this.noticeId) {
      this.noticeId = notice.id;
      this.noticeText.set({ text: notice.text });
      for (const [tone, icon] of Object.entries(this.noticeIcons))
        icon.setProperties({ display: tone === notice.tone ? "flex" : "none" });
      Object.assign(this.noticePose, { opacity: 0, y: -4 });
      this.stage.motion.animate(
        this.noticePose,
        { opacity: 1, y: 0 },
        180,
        () =>
          fade(this.noticePanel, this.noticePose.opacity).setProperties({
            transformTranslateY: this.noticePose.y,
          }),
        uiEaseOut,
      );
    }
    this.stage.invalidate();
  }
  private updateSlot(
    slot: Slot,
    id: string | null,
    badge: string,
    visible: boolean,
    folder: string,
  ): void {
    slot.cell.setProperties({ display: visible ? "flex" : "none" });
    slot.face.uniforms.hudReady.value = id ? 1 : 0;
    if (slot.id !== id) {
      slot.id = id;
      slot.label?.setProperties({
        text: id ? moves[id as keyof typeof moves].name : "",
        visibility: id ? "visible" : "hidden",
      });
      slot.image.setProperties({
        src: id ? `/art/icons/${folder}/${id}.webp` : undefined,
        display: id ? "flex" : "none",
      });
    }
    slot.badge.setProperties({ text: badge, display: badge ? "flex" : "none" });
  }
  private updateHealth(bar: HealthBar, fill: number, hit: boolean): void {
    fill = Math.max(0, Math.min(1, fill));
    if (bar.target === fill && !hit) return;
    const state = bar.state;
    // The first value is where the bar starts, not damage: no chip for HP the bar never showed.
    if (bar.target === null) Object.assign(state, { fill, trail: fill, lead: fill });
    bar.target = fill;
    // A hit while the chip is still holding or draining joins that cycle: the chip drains to whatever
    // the fill is by then. Restarting the hold on every hit would pin the chip at the pre-fight value,
    // swollen, for as long as damage keeps arriving.
    if (hit && state.trail <= state.fill) {
      const previous = state.fill;
      this.stage.motion.cancel(state);
      this.stopGlow(bar);
      state.trail = Math.max(previous, fill);
      const age = bar.chipAge;
      this.stage.motion.cancel(age);
      age.t = 0;
      this.stage.motion.animate(
        age,
        { t: 950 },
        950,
        () => {
          // Hold, then drain fast first and slow into the current value.
          state.trail =
            age.t < 350
              ? previous
              : previous +
                (state.fill - previous) *
                  easeOutCubic(Math.max(0, Math.min(1, (age.t - 350) / 420)));
          bar.chip.uniforms.hudChip.value = Math.max(0, 1 - age.t / 200);
          bar.chip.uniforms.hudSwell.value = age.t < 350 ? 1 : Math.max(0, 1 - (age.t - 350) / 180);
          this.drawHealth(bar);
        },
        (t) => t,
      );
    } else if (state.trail <= fill) {
      // A heal past the trail ends it; a smaller change (regen during the hold) lets the hit's chip
      // play out, as the original's chip animation runs on regardless of later HP values.
      this.stage.motion.cancel(bar.chipAge);
      state.trail = Math.min(state.fill, fill);
      bar.chip.uniforms.hudChip.value = 0;
      bar.chip.uniforms.hudSwell.value = 0;
    }
    state.lead = fill;
    const big = !hit && fill - state.fill >= HEAL_BIG;
    if (big) {
      if (bar === this.hpBar) this.healFlash();
      bar.glow.t = 1;
      this.stage.motion.animate(
        bar.glow,
        { t: 0 },
        HEAL_MS + 100,
        () => {
          bar.surface.uniforms.hudGlow.value = bar.glow.t;
          this.stage.invalidate();
        },
        (t) => t,
      );
    }
    const fillState: { fill: number } = state;
    this.stage.motion.animate(
      fillState,
      { fill },
      // A hit drops the fill at once, so the lost chip shows at its full width straight away; a big
      // heal shows its gain at once ahead of the fill (`lead`) and the fill eases out into it.
      hit ? 0 : big ? HEAL_MS : 120,
      () => this.drawHealth(bar),
      easeOutCubic,
    );
  }
  /** A big heal: the HP frame flashes hp-light, the counterpart of the hurt's hit-flash. */
  private healFlash(): void {
    this.healAge.t = 0;
    this.stage.motion.animate(
      this.healAge,
      { t: 1 },
      HEAL_MS,
      () => {
        this.hpPlate.setProperties({
          borderColor: new Color("#0d233f").lerp(this.healLight, 1 - this.healAge.t),
        });
        this.stage.invalidate();
      },
      uiEaseOut,
    );
  }
  private stopGlow(bar: HealthBar): void {
    this.stage.motion.cancel(bar.glow);
    bar.glow.t = 0;
    bar.surface.uniforms.hudGlow.value = 0;
  }
  private drawHealth(bar: HealthBar): void {
    const { fill, trail, lead } = bar.state;
    const length = (h: number) => healthLength(h, bar.curve);
    bar.surface.uniforms.hudFill.value = length(fill);
    bar.surface.uniforms.hudLead.value = length(Math.max(fill, lead));
    bar.chip.uniforms.hudFill.value = length(fill);
    bar.chip.uniforms.hudTrail.value = length(trail);
    this.stage.invalidate();
  }
  /**
   * Advances the XP ring toward its goal: an ease-out chase (fast first, then slow) capped at
   * `XP_MAX_SPEED` laps a second so each lap of a burst reads. Crossing a level end holds the ring
   * full, flashes it and bumps the medal, then the next lap starts from empty.
   */
  private stepXp(deltaMs: number): void {
    const xp = this.xpShown;
    if (xp.progress < 0) return;
    const before = [xp.progress, xp.trail, xp.hold, xp.glow].join();
    if (xp.hold > 0) {
      xp.hold = Math.max(0, xp.hold - deltaMs);
      if (xp.hold === 0) xp.trail = xp.progress;
    } else if (xp.progress < xp.goal) {
      const lap = Math.floor(xp.progress);
      const step = Math.min(
        (XP_MAX_SPEED * deltaMs) / 1000,
        Math.max(
          (XP_MIN_SPEED * deltaMs) / 1000,
          (xp.goal - xp.progress) * (1 - Math.exp(-deltaMs / XP_TAU_MS)),
        ),
      );
      xp.progress = Math.min(xp.goal, xp.progress + step);
      if (xp.progress >= lap + 1) {
        xp.progress = lap + 1;
        xp.hold = XP_BEAT_HOLD_MS;
        xp.glow = 1;
        this.levelBeat(lap + 1);
      }
    }
    if (xp.hold <= 0) {
      xp.trail += (xp.progress - xp.trail) * (1 - Math.exp(-deltaMs / XP_TRAIL_TAU_MS));
      if (xp.progress - xp.trail < 0.002) xp.trail = xp.progress;
    }
    xp.glow = Math.max(0, xp.glow - deltaMs / XP_GLOW_MS);
    if ([xp.progress, xp.trail, xp.hold, xp.glow].join() !== before) this.drawXp();
  }
  private drawXp(): void {
    const xp = this.xpShown;
    const lap = Math.floor(xp.progress);
    const fill = xp.hold > 0 ? 1 : xp.progress - lap;
    this.xp.uniforms.hudFill.value = fill;
    this.xp.uniforms.hudTrail.value = xp.hold > 0 ? 1 : Math.max(0, xp.trail - lap);
    this.xp.uniforms.hudGlow.value = xp.glow;
    this.stage.invalidate();
  }
  /** The level beat: the medal shows the new level and pops (420ms). */
  private levelBeat(level: number): void {
    this.level.set({ text: String(level) });
    const pose = this.medalPose;
    pose.scale = 1.35;
    this.stage.motion.animate(
      pose,
      { scale: 1 },
      420,
      () => this.medal.setProperties({ transformScaleX: pose.scale, transformScaleY: pose.scale }),
      uiEaseOut,
    );
  }
  private readyPulse(action: "dash" | "ultimate", pose: { scale: number }, duration: number): void {
    this.stage.motion.cancel(pose);
    pose.scale = 1.14;
    const panel = this.controls.find((c) => c.action === action)!.panel;
    this.stage.motion.animate(
      pose,
      { scale: 1 },
      duration,
      () => panel.setProperties({ transformScaleX: pose.scale, transformScaleY: pose.scale }),
      uiEaseOut,
    );
  }
  private crestPose: readonly number[] = [];
  private interactBottom = -1;
  private readonly stardustPop = { t: 0 };
  private readonly flinchAge = { t: 1 };
  private idleWait = 0;
  private slotsTwoRows: boolean | null = null;
  private itemSpan = -1;
  private readonly white = new Color("#ffffff");
  private readonly hurtRed = new Color("#ff6f7d");
  private readonly healLight = new Color("#9be884");
  private readonly healAge = { t: 1 };
  private plateTheme: string | null = null;
  private hpGrain: RunHeaderSurface | null = null;
  private readonly keycaps: Container[] = [];
  private ultArt!: RunHudArt;
  /** `.run-ult img` filter: saturate(.25) brightness(.75) until ready, 160ms transition. */
  private readonly ultLook = { gray: 0.75, bright: 0.75 };
  private ultReady: boolean | null = null;
  get inputBlocked(): boolean {
    return !this.state?.visible || this.state.blocked;
  }
  updateIndicators(
    world: World,
    local: PlayerId,
    camera: PerspectiveCamera,
    alpha: number,
    delta: number,
  ) {
    this.indicators.update(
      world,
      local,
      camera,
      alpha,
      delta,
      !!this.state?.visible && !this.state.blocked,
    );
  }
  afterLayout(deltaMs: number): void {
    // The left column holds the vitals, the teammates and the notice: the readout goes under all.
    const leftHeight = this.left.size.value?.[1] ?? 0;
    if (Math.abs(leftHeight - this.leftHeight) > 0.5) {
      this.leftHeight = leftHeight;
      this.placeDevReadout();
    }
    this.elapsed += deltaMs / 1000;
    // The idle loops (low-HP pulse and edges, ready halo, the crest's breathing) move a few px a
    // second, so they step together 15 times a second: a full-rate redraw would repaint the HUD,
    // and any window open over it, every frame while nothing else changes.
    // Under an open window (pause, cards, stats, a station, settings, the map) they hold still:
    // the window sits over them, and a step would repaint it with them.
    this.idleWait -= this.state?.blocked ? 0 : deltaMs;
    const idleStep = this.idleWait <= 0 && !this.state?.blocked;
    if (idleStep) this.idleWait = Math.max(this.idleWait + IDLE_STEP_MS, 0);
    this.edges.update(deltaMs, idleStep);
    // `.run-interact`: bottom = hud-bottom + slot height + 16px, i.e. 16px above the slot row.
    const slotsMatrix = this.slots.globalMatrix.value,
      slotsSize = this.slots.size.value;
    if (slotsMatrix && slotsSize) {
      const bottom =
        this.stage.viewport.height / 2 + slotsMatrix.elements[13]! + slotsSize[1] / 2 + 16;
      if (Math.abs(bottom - this.interactBottom) > 0.1) {
        this.interactBottom = bottom;
        this.interact.place(bottom);
      }
    }
    const slotSize = this.slots.size.value,
      actionSize = this.actions.size.value,
      bottomWidth = this.bottom.size.value?.[0];
    const moveWidth = this.moveRow.size.value?.[0],
      itemWidth = this.itemRow.size.value?.[0];
    if (
      slotSize &&
      actionSize &&
      bottomWidth !== undefined &&
      moveWidth !== undefined &&
      itemWidth !== undefined
    ) {
      const gap = this.compact ? 8 : 12;
      // Touch (run-screen.css `@media (pointer: coarse)`): the thumbs own the right corner with the
      // turn pair above them, the stick owns 150px on the left, and the slot bar lives between the
      // two. When moves and items do not fit that span side by side, moves go above items, so the
      // bar never reaches under either thumb and the station prompt keeps its room above it.
      const span = bottomWidth - (this.coarse ? STICK_ZONE + actionSize[0] + gap : 0);
      const itemSpan = this.coarse ? Math.max(0, span) : this.stage.viewport.width - 32;
      if (Math.abs(itemSpan - this.itemSpan) > 0.5) {
        this.itemSpan = itemSpan;
        this.itemRow.setProperties({
          maxWidth: itemSpan,
          justifyContent: this.coarse ? "center" : "flex-start",
        });
      }
      const twoRows = this.coarse && moveWidth + itemWidth + gap > span;
      if (this.coarse && twoRows !== this.slotsTwoRows) {
        this.slotsTwoRows = twoRows;
        this.slots.setProperties({
          flexDirection: twoRows ? "column" : "row",
          alignItems: twoRows ? "center" : "flex-end",
          flexWrap: twoRows ? "no-wrap" : "wrap",
          gap: twoRows ? 6 : gap,
        });
      }
      this.bottom.setProperties({
        paddingLeft: this.coarse ? STICK_ZONE : 0,
        paddingRight: this.coarse ? actionSize[0] + gap : 0,
      });
      const height = Math.max(slotSize[1], actionSize[1]);
      if (Math.abs(height - this.bottomHeight) > 0.1) {
        this.bottomHeight = height;
        this.bottom.setProperties({ minHeight: height });
      }
    }

    const mapMatrix = this.mapSlot.globalMatrix.value,
      mapSize = this.mapSlot.size.value;
    const bottomMatrix = this.bottom.globalMatrix.value,
      bottomSize = this.bottom.size.value;
    if (mapMatrix && mapSize && bottomMatrix && bottomSize) {
      const available = Math.max(
        0,
        mapMatrix.elements[13]! +
          mapSize[1] / 2 -
          bottomMatrix.elements[13]! -
          bottomSize[1] / 2 -
          8,
      );
      if (Math.abs(available - this.mapHeight) > 0.1) {
        this.mapHeight = available;
        this.mapSlot.setProperties({ maxHeight: available });
      }
    }
    for (const surface of this.surfaces) surface.afterLayout();
    // Under an open window (the level-up cards) the ring holds, so its beat plays on return.
    if (this.state?.visible && !this.state.blocked) this.stepXp(deltaMs);
    for (const slot of this.moves) this.sweepSlot(slot, deltaMs);
    for (const control of this.controls) control.pattern?.update(deltaMs);
    this.hpGrain?.update();
    if (!this.state?.visible) return;
    if (!idleStep) return;
    if (this.hp.uniforms.hudReady.value > 0) {
      this.hp.uniforms.hudTime.value = this.elapsed;
      this.stage.invalidate();
    }
    if (this.halo.content.properties.peek().display !== "none") {
      this.halo.uniforms.hudTime.value = (this.elapsed % 1.2) / 1.2;
      this.stage.invalidate();
    }
    const theme = this.state.theme;
    const duration = theme === "grass" ? 2.6 : theme === "water" ? 2.2 : 1.4;
    const progress = (this.elapsed % (duration * 2)) / duration;
    const phase = cubicBezier(progress < 1 ? progress : 2 - progress, 0.42, 0, 0.58, 1);
    const zapPhase = (this.elapsed % 2.4) / 2.4;
    const zap = theme === "electric" && ((zapPhase >= 0.9 && zapPhase < 0.94) || zapPhase >= 0.97);
    const scale =
      theme === "fire" ? 1 + phase * 0.08 : theme === "water" ? 1 + phase * 0.04 : zap ? 1.12 : 1;
    const pose = [
      theme === "grass" ? -9 + phase * 16 : theme === "fire" ? -3 + phase * 6 : zap ? -6 : 0,
      scale,
      theme === "water" ? 1 - phase * 3 : theme === "fire" ? -phase : 0,
    ] as const;
    if (pose.some((value, i) => value !== this.crestPose[i])) {
      this.crestPose = pose;
      this.crest.setProperties({
        transformRotateZ: pose[0],
        transformScaleX: pose[1],
        transformScaleY: pose[1],
        transformTranslateY: pose[2],
      });
      this.stage.invalidate();
    }
  }
  hit(x: number, y: number): number {
    if (!this.state?.visible || this.state.blocked) return -1;
    return this.controls.findIndex((c) => c.enabled && this.contains(c.panel, x, y));
  }
  private contains(panel: Container, x: number, y: number): boolean {
    const m = panel.globalMatrix.value,
      size = panel.size.value;
    if (!m || !size || panel.isClipped.value || !panel.displayed.value) return false;
    this.point
      .set(
        x / this.stage.viewport.scale + this.stage.camera.left,
        this.stage.camera.top - y / this.stage.viewport.scale,
        0,
      )
      .applyMatrix4(this.inverse.copy(m).invert());
    return Math.abs(this.point.x) <= size[0] / 2 && Math.abs(this.point.y) <= size[1] / 2;
  }
  focus(index: number): void {
    if (this.state?.blocked || !this.controls[index]?.enabled) return;
    this.selected = index;
    this.paintFocus();
  }
  /** Eases the shield band to its share over 120ms; nothing to draw while it holds still. */
  private updateShield(shield: number, max: number): void {
    const target = max > 0 ? Math.max(0, Math.min(1, shield / max)) : 0;
    if (target === this.shieldTarget) return;
    this.shieldTarget = target;
    this.shieldBar.setProperties({ display: max > 0 ? "flex" : "none" });
    this.stage.motion.animate(
      this.shieldState,
      { fill: target },
      120,
      () => {
        this.shieldBar.setProperties({ width: `${this.shieldState.fill * 100}%` });
        this.stage.invalidate();
      },
      uiEaseOut,
    );
  }

  /** One pip per charge (ready ones lit), only when the max is above one. */
  private updateDashPips(ready: number, max: number): void {
    if (max === this.dashPipsMax && ready === this.dashPipsReady) return;
    this.dashPipsReady = ready;
    if (max !== this.dashPipsMax) {
      this.dashPipsMax = max;
      for (const dot of this.dashPipDots) dot.removeFromParent();
      this.dashPipDots =
        max > 1
          ? Array.from({ length: max }, () => {
              const dot = new Container({
                width: 9,
                height: 9,
                borderRadius: 5,
                borderWidth: 1.5,
                borderColor: "#0d233f",
              });
              this.dashPips.add(dot);
              return dot;
            })
          : [];
      this.dashPips.setProperties({ display: max > 1 ? "flex" : "none" });
    }
    this.dashPipDots.forEach((dot, i) =>
      dot.setProperties({ backgroundColor: i < ready ? "#ffd45b" : "#536b82" }),
    );
  }

  /** Between snapshots a cooling slot sweeps on at its cooldown's rate (never backwards, never
   *  past one snapshot period ahead); a ready one stays full. */
  private sweepSlot(slot: Slot, deltaMs: number): void {
    const sweep = slot.sweep;
    sweep.since = Math.min(SNAPSHOT_MS, sweep.since + deltaMs);
    const target = Math.min(1, sweep.ready + sweep.since / 1000 / sweep.cd);
    const next = Math.max(sweep.shown, target);
    if (next === sweep.shown && slot.cooldown!.uniforms.hudFill.value === next) return;
    sweep.shown = next;
    slot.cooldown!.uniforms.hudFill.value = next;
    this.stage.invalidate();
  }
  /** A mouse over a control (null: over none): it lights with the ball pattern like every control. */
  hover(index: number | null): void {
    if (index === this.hovered) return;
    this.hovered = index;
    this.interact.setHovered(index !== null && this.controls[index]?.action === "interact");
    this.paintFocus();
  }
  /** Keyboard focus is outlined (`:focus-visible`); hover and focus light the ball pattern. */
  setFocusVisible(visible: boolean): void {
    this.focusVisible = visible;
    this.paintFocus();
  }
  private paintFocus(): void {
    this.controls.forEach((c, i) => {
      const ringed = i === this.selected && this.focusVisible;
      if (c.action === "interact") this.interact.setFocusRing(ringed);
      else c.panel.setProperties({ borderWidth: ringed ? 2 : 0, borderColor: "#ffd45b" });
      c.pattern?.setFocused(ringed || i === this.hovered);
    });
    this.stage.invalidate();
  }
  private toggleFullscreen: (() => void) | undefined;
  private readonly fullscreenIcon = new FullscreenIcon();

  setFullscreenAction(action: (() => void) | undefined, active: boolean): void {
    if (this.fullscreenIcon.setActive(active)) this.stage.invalidate();
    if (this.toggleFullscreen === action) return;
    this.toggleFullscreen = action;
    const control = this.controls.find((c) => c.action === "fullscreen")!;
    control.enabled = !!action;
    control.panel.setProperties({ display: action ? "flex" : "none" });
    if (!action && this.controls[this.selected] === control) this.selected = -1;
    this.paintFocus();
  }

  activate(index: number): void {
    if (this.state?.blocked || !this.state?.visible) return;
    const action = this.controls[index]?.action;
    if (action === "fullscreen") this.toggleFullscreen?.();
    else if (action === "pause") this.callbacks.pause();
    else if (action === "stats") this.callbacks.stats();
    else if (action === "dash") this.callbacks.dash();
    else if (action === "ultimate") this.callbacks.ultimate();
    else if (action === "interact") this.callbacks.interact();
  }
  down(id: number, x: number, y: number): boolean {
    const index = this.hit(x, y);
    if (index < 0) return false;
    this.held.set(id, index);
    this.focus(index);
    if (this.controls[index]!.action === "interact") this.interact.setPressed(true);
    else this.controls[index]!.panel.setProperties({ transformTranslateY: 2 });
    const action = this.controls[index]!.action;
    if (action === "left" || action === "right") this.updateTurn();
    else if (action === "dash" || action === "ultimate") this.activate(index);
    return true;
  }
  move(id: number, x: number, y: number): void {
    const index = this.held.get(id);
    if (index === undefined) return;
    if (this.hit(x, y) !== index) this.up(id, x, y, true);
  }
  up(id: number, x: number, y: number, cancel = false): void {
    const index = this.held.get(id);
    if (index === undefined) return;
    this.held.delete(id);
    const c = this.controls[index]!;
    if (c.action === "interact") this.interact.setPressed(false);
    else c.panel.setProperties({ transformTranslateY: 0 });
    if (c.action === "left" || c.action === "right") this.updateTurn();
    else if (!cancel && this.hit(x, y) === index && c.action !== "dash" && c.action !== "ultimate")
      this.activate(index);
  }
  private updateTurn(): void {
    let value = 0;
    for (const index of this.held.values()) {
      const action = this.controls[index]!.action;
      if (action === "left") value--;
      else if (action === "right") value++;
    }
    const direction = Math.sign(value) as -1 | 0 | 1;
    if (direction !== this.turn) {
      this.turn = direction;
      this.callbacks.turn(direction);
    }
  }
  cancel(id?: number): void {
    for (const pointer of this.held.keys())
      if (id === undefined || id === pointer) this.up(pointer, -1, -1, true);
  }
  navigate(action: NavigationAction): boolean {
    if (this.state?.blocked || !this.state?.visible) return false;
    if (action === "next" || action === "previous") {
      const enabled = this.controls
        .map((c, i) => (c.enabled && c.panel.displayed.value ? i : -1))
        .filter((i) => i >= 0);
      const current = enabled.indexOf(this.selected);
      this.focus(
        enabled[(current + (action === "previous" ? -1 : 1) + enabled.length) % enabled.length]!,
      );
      return true;
    }
    if (action === "confirm") {
      this.activate(this.selected);
      return true;
    }
    return false;
  }
  setStick(origin: { x: number; y: number } | null, dx = 0, dy = 0): void {
    this.stick.setProperties({
      display: origin ? "flex" : "none",
      positionLeft: origin ? origin.x / this.stage.viewport.scale - 52 : 0,
      positionTop: origin ? origin.y / this.stage.viewport.scale - 52 : 0,
      width: 104,
      height: 104,
    });
    this.knob.setProperties({
      transformTranslateX: dx / this.stage.viewport.scale,
      transformTranslateY: dy / this.stage.viewport.scale,
    });
    this.stage.invalidate();
  }
  slotCenter(kind: "move" | "item", id: string): { x: number; y: number } | null {
    const slots = kind === "move" ? this.moves : this.items;
    const slot =
      slots.find((s) => s.id === id) ?? slots.find((s) => s.id === null && s.panel.displayed.value);
    const matrix = slot?.panel.globalMatrix.value;
    if (!matrix) return null;
    return {
      x: (matrix.elements[12]! - this.stage.camera.left) * this.stage.viewport.scale,
      y: (this.stage.camera.top - matrix.elements[13]!) * this.stage.viewport.scale,
    };
  }
  /** Developer mode's readout under the vitals; built on its first text. */
  setDevReadout(text: string): void {
    if (!text) {
      this.devReadout?.dispose();
      this.devReadout = null;
      return;
    }
    if (!this.devReadout) {
      this.devReadout = new GpuDevReadout();
      this.stage.root.add(this.devReadout.root);
      this.placeDevReadout();
    }
    this.devReadout.set(text);
  }

  private placeDevReadout(): void {
    const v = this.stage.viewport;
    const edge = this.compact ? 12 : 16;
    this.devReadout?.place(
      Math.max(edge, v.safeArea.top) + this.leftHeight + 12,
      Math.max(edge, v.safeArea.left),
    );
  }

  dispose(): void {
    this.indicators.dispose();
    this.numbers.dispose();
    this.edges.dispose();
    this.devReadout?.dispose();
    this.cancel();
    this.interact.dispose();
    this.stage.motion.cancel(this.shieldState);
    for (const control of this.controls) control.pattern?.dispose();
    this.hpGrain?.dispose();
    this.ultArt.dispose();
    for (const surface of this.surfaces) surface.dispose();
    this.stage.dispose();
  }
}

/** Where the zone stands, for the clock's meta line: the final swarm's countdown until the guardian is up. */
function zoneState(snap: RunSnapshot): string {
  const { zone } = snap;
  if (zone.phase !== "active") return "出口";
  if (snap.rampage) return "暴走";
  if (snap.boss) return "守卫战";
  return `暴走 ${formatTime(Math.max(0, zone.finalSwarm - zone.time))}`;
}
