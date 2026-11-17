import { MAX_ITEM_SLOTS } from "../../run/sim/content/params/cards";
import { ULT_INVULNERABLE } from "../../run/sim/content/params/ultimates";
import { STAGE_ROUTE } from "../../run/sim/content/campaign";
import { stageDefs } from "../../run/sim/content/stages/index";
import { FullscreenIcon } from "./fullscreen-icon";
import { type NavigationAction } from "../../platform/input";
import { InputGlyph } from "./input-glyph";
import { GpuDamageNumbers } from "./run-damage-numbers";
import { softOf } from "./run-choice-surface";
import { crestPose, themeColors, themeGrain } from "./run-theme";
import { SlantPlate } from "./slant-plate";
import { LIFT, SNAP } from "./motion";
import { RADIUS_INNER, slantOf, ui } from "./tokens";
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
import { formatTime, typeNames } from "../../run/labels";
import { moves } from "../../run/sim/content/moves";
import type { ElementType } from "../../run/sim/content/elements";
import type { StarterId } from "../../run/sim/content/lines/index";
import { UiStage } from "./stage";
import type { UiInsets } from "./viewport";
import { RunHudArt, RunHudSurface } from "./run-hud-surface";
import { RunHudInteract } from "./run-hud-interact";
import { OutlinedText } from "./outlined-text";
import { uiEaseOut, cubicBezier } from "./focus-mark";

const cssEase = (t: number) => cubicBezier(t, 0.25, 0.1, 0.25, 1);
import { fade, stack } from "./layer";
import { CURRENCY_ICON } from "./currency";
import { createMenuIcon } from "./icons";
import { createRunCommandIcon } from "./run-overlays-icons";
import { playerColors } from "../player-colors";
import { slantTag } from "./tag";
import { formDefs } from "../../run/sim/content/lines/index";
import { GpuTrainerCutin, type CueGlyphs } from "./trainer-cutin";
import { WeatherChip } from "../../run/view/weatherChip";

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
  /** The move's name on a small ink plate under the slot (keyboard and mouse). */
  label: { box: Container; text: Text; plate: SlantPlate } | null;
  face: RunHudSurface;
  image: Image<ImageOutProperties<unknown>>;
  badge: Text;
  cooldown: RunHudSurface | null;
  id: string | null;
  /** The cooldown sweep: the last snapshot's reading, advanced at 1/cd a second until the next. */
  sweep: { ready: number; cd: number; since: number; shown: number };
}

/** A teammate's slanted line: portrait in their player colour, P tag, level, HP gauge. */
interface Mate {
  row: Container;
  plate: SlantPlate;
  face: Image<ImageOutProperties<unknown>>;
  tag: Text;
  level: Text;
  bar: RunHudSurface;
  form: string | null;
}

/** The HUD snapshot's period: the sweep runs ahead of a reading by at most this much. */
const SNAPSHOT_MS = 100;
interface Control {
  panel: Container;
  action: "fullscreen" | "pause" | "stats" | "dash" | "ultimate" | "left" | "right" | "interact";
  enabled: boolean;
  /** The slanted ink face of a square key; the round thumbs and the prompt have none. */
  plate?: SlantPlate;
  /** Hover lift / press sink (px, down positive). */
  pose: { y: number };
}

/** A slanted key's ink face, and its face under the pointer. */
const KEY_FACE = ui.ink;
const KEY_HOVER = "#2e2e3a";

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
/** The ultimate key's ring while the cast protects the player: warm yellow, apart from the charge. */
const PROTECT = "#ffd45b";
/** One gathering of the ultimate's halo into its key while the cast prepares (s). */
const WINDUP_PULSE = 0.6;
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
  readonly trainers: GpuTrainerCutin;
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
  /** The portrait medal: the form's portrait on the theme disc. */
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
  /** The level on an ink badge over the medal's lower-left rim. */
  private readonly level = new Text({ text: "1", fontSize: 15, fontWeight: 800, color: ui.white });
  private readonly levelTag = new Container({
    positionType: "absolute",
    positionLeft: -4,
    positionBottom: -6,
    height: 20,
    paddingX: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  });
  private readonly levelPlate = new SlantPlate(
    this.levelTag,
    { fill: ui.ink, upright: true },
    RADIUS_INNER,
  );
  /** The name plate right of the medal: the form's name and types over the HP and XP bars, on
   *  the theme's slanted card face, centred between its leaning ends (see `fitPlateEnds`). */
  private readonly plate = new Container({
    flexDirection: "column",
    justifyContent: "center",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: 4,
  });
  private plateFace: SlantPlate | null = null;
  private plateEnd = 0;
  private readonly nameRow = new Container({
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  });
  private readonly formName = new OutlinedText(
    { text: "", fontSize: 16, fontWeight: 800, color: ui.white },
    { width: 3, color: ui.ink },
  );
  private readonly formTypes = new Container({ flexDirection: "row", gap: 2, flexShrink: 0 });
  private typeTags: { tag: Container; dispose(): void }[] = [];
  /** Compact lines for the other players, under the vitals. */
  private readonly team = new Container({
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    display: "none",
  });
  private readonly mates: Mate[] = [];
  /** XP: a thin gauge under the HP bar. */
  private readonly xp = new RunHudSurface("bar");
  private readonly xpBar = new Container({ width: "100%", height: 6, flexShrink: 0 });
  private readonly medalFace = new RunHudSurface("medal");
  private readonly hpPlate = new Container({ width: "100%", minWidth: 55, height: 22 });
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
  // The HP in white on a 3px ink stroke, `/max` smaller.
  private readonly hpNow = new OutlinedText(
    { text: "", fontSize: 13, fontWeight: 800, color: ui.white },
    { width: 3, color: ui.ink },
  );
  private readonly hpMax = new OutlinedText(
    { text: "", fontSize: 11, fontWeight: 800, color: ui.white },
    { width: 3, color: ui.ink },
  );
  private readonly center = new Container({
    flexDirection: "column",
    alignItems: "center",
    flexShrink: 0,
    width: 260,
    gap: 4,
  });
  /** The clock on its slanted ink plate (rampage: pink on wine). */
  private readonly clockStack = new Container({ alignItems: "center", justifyContent: "center" });
  private readonly clockPlate = new SlantPlate(this.clockStack, { fill: ui.ink });
  /** The readout under the compass, faded out while a run window is open (see `setWindowOpen`). */
  private readonly readout = { opacity: 1 };
  private readonly clock = new OutlinedText(
    { text: "00:00", fontSize: 30, fontWeight: 800, color: ui.white },
    { width: 2, color: ui.ink },
  );
  /** Stage, zone state and knockouts on a smaller ink chip under the clock. */
  private readonly meta = new Container({ alignItems: "center", justifyContent: "center" });
  private readonly metaPlate = new SlantPlate(this.meta, { fill: ui.ink, upright: true });
  private readonly metaText = new Text({
    text: "",
    fontSize: 13,
    fontWeight: 800,
    color: ui.mist,
    whiteSpace: "pre",
  });
  private readonly boss = new Container({
    width: "100%",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    display: "none",
  });
  /** The guardian's name, set when it changes (each zone has its own guardian). */
  private readonly bossName = new OutlinedText(
    { text: "", fontSize: 16, fontWeight: 800, color: ui.white },
    { width: 3, color: ui.ink },
  );
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
  private readonly pursePlate = new Container({
    flexDirection: "row",
    alignItems: "center",
    height: 32,
    paddingLeft: 4,
    paddingRight: 4,
  });
  private readonly purseFace = new SlantPlate(this.pursePlate, { fill: ui.ink, upright: true });
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
  private windowOpen = false;
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
      color: ui.white,
      whiteSpace: "normal",
    },
    { width: 3, color: ui.ink },
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
  /** Shield as an ice band along the top of the HP bar (drawn by its surface). */
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
  /** The weather's glyph and time bar, first in the purse row. */
  private readonly weatherChip = new WeatherChip();
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
    borderColor: withOpacity(ui.white, 0.65),
    backgroundColor: withOpacity(ui.ink, 0.22),
    alignItems: "center",
    justifyContent: "center",
    display: "none",
  });
  private readonly knob = new Container({
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: ui.white,
    borderWidth: 2,
    borderBottomWidth: 4,
    borderColor: ui.ink,
  });

  private readonly callbacks: RunHudCallbacks;
  constructor(
    fonts: FontFamilies,
    starter: StarterId,
    callbacks: RunHudCallbacks,
    glyphs: CueGlyphs,
  ) {
    this.callbacks = callbacks;
    this.stage.root.setProperties({
      fontFamilies: fonts,
      flexDirection: "column",
      color: "#ffffff",
    });
    // After the families: its texts resolve "Poketone UI" as they mount.
    this.trainers = new GpuTrainerCutin(this.stage, glyphs);
    this.numbers = new GpuDamageNumbers(this.stage);
    this.indicators = new GpuEdgeIndicators(this.stage, [
      this.top,
      this.mapSlot,
      this.bottom,
      this.interact.row,
    ]);
    this.surfaces.push(this.xp, this.hp, this.hpChip, this.bossHp, this.bossChip);
    this.xp.uniforms.hudColor.value.set("#59c8ff");
    this.xp.uniforms.hudLight.value.set("#a9e6ff");
    this.xpBar.add(this.xp.content);
    // One notch where the bar turns to the low-HP look (30% real HP), placed through the curve.
    this.hp.uniforms.hudTicks.value.set(healthLength(LOW_HP, PLAYER_HP_CURVE), -1, -1);
    this.medalFace.content.setProperties({ width: "100%", height: "100%" });
    this.surfaces.push(this.medalFace);
    this.medal.add(stack(this.medalFace.content, 1), stack(this.portrait, 2));
    this.levelPlate.set({ depth: 3 });
    this.levelTag.add(
      this.levelPlate.content,
      stack(new Text({ text: "Lv", fontSize: 10, fontWeight: 800, color: ui.muted }), 1),
      stack(this.level, 1),
    );
    this.medal.add(stack(this.levelTag, 4));
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
    hpBox.add(this.hp.content, this.hpChip.content, this.hpText);
    this.hpPlate.add(hpBox);
    this.formName.root.setProperties({ flexShrink: 1, minWidth: 0 });
    this.nameRow.add(stack(this.formName.root, 1), stack(this.formTypes, 1));
    this.plate.add(stack(this.nameRow, 1), stack(this.hpPlate, 1), stack(this.xpBar, 1));
    // The medal overlaps the plate's left end and draws over it.
    this.vitals.add(stack(this.medal, 3), this.plate);
    for (let i = 0; i < 3; i++) this.mates.push(this.addMate());
    this.clockPlate.set({ depth: 4 });
    this.clockStack.add(this.clockPlate.content, stack(this.clock.root, 1));
    this.metaPlate.set({ depth: 3 });
    this.meta.add(this.metaPlate.content, stack(this.metaText, 1));
    this.center.add(this.compassSlot, this.clockStack, this.meta);
    const bossBar = new Container({ width: "100%", height: 16 });
    stack(this.bossChip.content, 1);
    bossBar.add(this.bossHp.content, this.bossChip.content);
    this.boss.add(
      // The hit chip swells past the bar's top edge; the name stays above it (DESIGN.md 掉血段).
      stack(this.bossName.root, 2),
      bossBar,
    );
    this.center.add(this.boss);
    const purse = new Container({
      width: "100%",
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "flex-end",
      alignItems: "center",
      gap: 8,
    });
    const purseIcon = stack(
      new Image({
        src: CURRENCY_ICON,
        width: 40,
        height: 40,
        marginLeft: -12,
        marginRight: 0,
      }),
      1,
    );
    this.purseFace.set({ depth: 3 });
    this.pursePlate.add(this.purseFace.content, purseIcon, stack(this.stardust, 1));
    const fullscreen = this.addControl("fullscreen", 48).panel;
    const icon = this.fullscreenIcon;
    icon.setProperties({ width: 24, height: 24, color: ui.white });
    fullscreen.add(stack(icon, 1));
    fullscreen.setProperties({ display: "none" });
    // The build panel's touch entry (C / LB elsewhere).
    const stats = this.addControl("stats", 48).panel;
    const statsIcon = createRunCommandIcon("chart");
    statsIcon.setProperties({ color: ui.white });
    stats.add(stack(statsIcon, 1), this.keycap("C", "stats"));
    this.surfaces.push(this.weatherChip.bar);
    purse.add(
      this.weatherChip.root,
      this.pursePlate,
      stats,
      this.addControl("pause", 48, 1).panel,
      fullscreen,
    );
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
    const ultimate = this.addThumb("ultimate", 0);
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
    const dash = this.addThumb("dash", 2);
    this.dash = dash.surface;
    // The dash gauge stays ice: distinct from every type colour.
    this.dash.uniforms.hudColor.value.set("#d8effb");
    dash.panel.add(this.keycap("Space", "dash"), this.dashPips);
    this.thumbs.add(ultimate.panel, dash.panel);
    this.placeBar();
    this.bottom.add(this.slots, this.actions);
    this.controls.push({
      panel: this.interact.panel,
      action: "interact",
      enabled: false,
      pose: { y: 0 },
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
  /** A square HUD key (pause, build panel, fullscreen, turn): an ink face, a white icon. */
  private addControl(action: Control["action"], size: number, glyph = 0): { panel: Container } {
    const panel = new Container({
      width: size,
      height: size,
      minWidth: 44,
      minHeight: 44,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
    });
    const plate = new SlantPlate(panel, { fill: KEY_FACE, upright: true });
    plate.set({ depth: 3 });
    panel.add(plate.content);
    if (glyph) {
      const surface = new RunHudSurface("glyph", glyph);
      panel.add(stack(surface.content, 1));
      this.surfaces.push(surface);
    }
    this.controls.push({ panel, action, enabled: true, plate, pose: { y: 0 } });
    return { panel };
  }
  /** A round thumb key (dash, ultimate): its outer ring is the gauge. */
  private addThumb(
    action: "dash" | "ultimate",
    glyph: number,
  ): { panel: Container; surface: RunHudSurface } {
    const panel = new Container({
      width: 64,
      height: 64,
      minWidth: 44,
      minHeight: 44,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 32,
      borderColor: ui.ink,
    });
    const surface = new RunHudSurface("ring", glyph);
    surface.uniforms.hudDeep.value.set("#3a3a46");
    panel.add(surface.content);
    this.surfaces.push(surface);
    this.controls.push({ panel, action, enabled: true, pose: { y: 0 } });
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
      display: "none",
    });
    const plate = new SlantPlate(row, { fill: ui.ink, upright: true });
    plate.set({ depth: 3 });
    const face = new Image({
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      backgroundColor: ui.mist,
      flexShrink: 0,
    });
    const tag = new Text({ text: "", fontSize: 12, fontWeight: 800 });
    const level = new Text({ text: "", fontSize: 12, fontWeight: 800, color: ui.white });
    const track = new Container({ width: 84, height: 8 });
    const bar = new RunHudSurface("bar");
    track.add(bar.content);
    this.surfaces.push(bar);
    row.add(plate.content, stack(face, 1), stack(tag, 1), stack(level, 1), stack(track, 1));
    this.team.add(row);
    return { row, plate, face, tag, level, bar, form: null };
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
      const color = playerColors[data.slot] ?? ui.white;
      const share = data.alive ? Math.max(0, Math.min(1, data.hp / data.maxHp)) : 0;
      mate.face.setProperties({ borderColor: color, opacity: data.alive ? 1 : 0.4 });
      // On the wine line of a downed teammate the player colour stays on the ring only.
      mate.tag.setProperties({ text: `P${data.slot + 1}`, color: data.alive ? color : ui.white });
      mate.level.setProperties({ text: `Lv ${data.level}` });
      mate.bar.uniforms.hudFill.value = share;
      mate.bar.uniforms.hudColor.value.set(share < LOW_HP ? "#ff6f7d" : "#7fd96a");
      mate.bar.uniforms.hudLight.value.copy(mate.bar.uniforms.hudColor.value);
      // Down and waiting for a rescue: the line turns wine like the rampage clock.
      mate.plate.set({ fill: data.alive ? ui.ink : "#96182e" });
    });
  }
  private addSlot(row: Container, move: boolean): Slot {
    const panel = new Container({
      width: move ? 60 : 40,
      height: move ? 60 : 40,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
    });
    const face = new RunHudSurface("slot");
    face.uniforms.hudColor.value.set(ui.mist);
    this.surfaces.push(face);
    panel.add(face.content);
    const image = stack(new Image({ width: 44, height: 44, display: "none" }), 1);
    const badge = stack(
      new Text({
        text: "",
        positionType: "absolute",
        positionRight: 3,
        positionTop: 0,
        fontSize: 11,
        fontWeight: 800,
        backgroundColor: ui.ink,
        color: ui.white,
        paddingX: 3,
        // A theme-deep tab in the top-right corner, its free corner rounded.
        borderBottomLeftRadius: RADIUS_INNER,
        borderTopRightRadius: RADIUS_INNER,
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
    let label: Slot["label"] = null;
    if (move) {
      // Keyboard and mouse only (`placeBar`): the name on an ink tag over the slot's foot.
      const box = new Container({
        height: 18,
        paddingX: 6,
        marginTop: -7,
        alignItems: "center",
        justifyContent: "center",
        display: "none",
        visibility: "hidden",
      });
      const plate = new SlantPlate(box, { fill: ui.ink, upright: true }, RADIUS_INNER);
      plate.set({ depth: 2 });
      const text = new Text({
        text: "",
        fontSize: 11,
        fontWeight: 800,
        color: ui.white,
        whiteSpace: "pre",
        wordBreak: "keep-all",
      });
      box.add(plate.content, stack(text, 1));
      cell.add(stack(box, 4));
      label = { box, text, plate };
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
    // The plate's left end runs under the medal's right half. Both ends keep half the lean plus
    // the same gap, so the upright rows sit on the face's centre line between the medal and the cut.
    this.plateEnd = (this.compact ? 10 : 12) + slantOf(this.compact ? 56 : 72) / 2;
    this.plate.setProperties({
      marginLeft: -medal / 2,
      paddingLeft: medal / 2 + this.plateEnd,
      paddingRight: this.plateEnd,
      paddingY: this.compact ? 5 : 7,
      gap: this.compact ? 3 : 4,
    });
    this.formName.set({ fontSize: this.compact ? 14 : 16 });
    const hpHeight = this.compact ? 18 : 22;
    this.hpPlate.setProperties({ height: hpHeight });
    this.xpBar.setProperties({ height: this.compact ? 5 : 6 });
    this.hpNow.set({ fontSize: this.compact ? 12 : 14 });
    this.hpMax.set({ fontSize: this.compact ? 10 : 11 });
    // Clear of the Lv tag, which hangs 6px under the medal.
    this.team.setProperties({ marginTop: this.compact ? 10 : 12, gap: this.compact ? 3 : 4 });
    for (const mate of this.mates) {
      const h = this.compact ? 22 : 26;
      mate.row.setProperties({ height: h });
      mate.face.setProperties({ width: h - 4, height: h - 4, borderRadius: (h - 4) / 2 });
      mate.level.setProperties({ width: this.compact ? 36 : 40 });
    }
    const clockHeight = this.compact ? 30 : 40;
    this.clockStack.setProperties({
      height: clockHeight,
      paddingX: (this.compact ? 12 : 16) + slantOf(clockHeight) / 2,
    });
    this.clock.set({ fontSize: this.compact ? 22 : 30 });
    const metaHeight = this.compact ? 18 : 22;
    this.meta.setProperties({ height: metaHeight, paddingX: this.compact ? 8 : 10 });
    this.metaText.setProperties({ fontSize: this.compact ? 11 : 13 });
    const purseHeight = this.compact ? 28 : 32;
    this.pursePlate.setProperties({ height: purseHeight });
    this.stardust.setProperties({
      fontSize: this.compact ? 15 : 20,
      paddingX: this.compact ? 5 : 8,
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
    const sizeSlots = (slots: Slot[], size: number) => {
      for (const slot of slots) {
        slot.panel.setProperties({ width: size, height: size });
        slot.image.setProperties({
          width: Math.round(size * 0.72),
          height: Math.round(size * 0.72),
        });
      }
    };
    sizeSlots(this.moves, this.compact ? 48 : 60);
    sizeSlots(this.items, this.compact ? 34 : 40);
    for (const control of this.controls) {
      const thumb = control.action === "dash" || control.action === "ultimate";
      // The thumbs are 64 (76 under a coarse pointer) and the keys 48 tall in short landscape too;
      // only slots and type shrink there.
      const target = thumb ? (this.coarse ? 76 : 64) : 48;
      control.panel.setProperties({
        minWidth: v.minTarget,
        minHeight: v.minTarget,
        ...(control.action === "interact"
          ? {}
          : thumb
            ? { width: target, height: target, borderRadius: target / 2 }
            : { width: target, height: target }),
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
        this.hp.uniforms.hudFrame.value.copy(this.ink).lerp(this.hurtRed, flash);
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
    // Called on every input sample: only a change restarts the fade (a restart redraws each frame).
    if (open === this.windowOpen) return;
    this.windowOpen = open;
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
      slot.label?.box.setProperties({ display: this.coarse ? "none" : "flex" });
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
        borderColor: ui.ink,
        backgroundColor: ui.white,
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
    this.trainers.cues.suppress(
      !state.visible || state.blocked
        ? "blocked"
        : state.notice?.tone === "danger"
          ? "danger"
          : "open",
    );
    if (state.blocked) this.cancel();
    const snap = state.snapshot;
    if (!snap) return;
    const low = snap.hp / snap.maxHp < LOW_HP;
    this.edges.setLowHp(low && snap.outcome === "playing");
    const colors = themeColors(state.theme);
    const palette = [colors.theme, colors.deep, colors.light] as const;
    if (this.plateTheme !== state.theme) {
      // The name plate is the theme's slanted card: theme fill with its card face over it.
      this.plateTheme = state.theme;
      this.plateFace?.dispose();
      this.plateFace = new SlantPlate(this.plate, {
        fill: palette[0],
        card: { type: state.theme, loaded: () => this.stage.invalidate() },
      });
      this.plate.add(this.plateFace.content);
    }
    this.medalFace.uniforms.hudColor.value.set(palette[0]);
    this.medalFace.uniforms.hudDeep.value.set(palette[1]);
    this.medalFace.uniforms.hudLight.value.set(palette[2]);
    const grain = themeGrain(state.theme);
    this.medalFace.uniforms.hudGrain.value.set(grain.color);
    this.medalFace.uniforms.hudKind.value = grain.kind;
    this.ultimate.uniforms.hudColor.value.set(palette[2]);
    this.ultimate.uniforms.hudLight.value.set(palette[2]);
    this.ultimate.uniforms.hudTheme.value.set(palette[0]);
    this.ultimate.uniforms.hudThemeDeep.value.set(palette[1]);
    this.ultimate.uniforms.hudGrain.value.set(grain.color);
    this.ultimate.uniforms.hudKind.value = grain.kind;
    this.halo.uniforms.hudColor.value.set(palette[2]);
    this.crest.setProperties({ src: `/art/icons/crests/${state.theme}.webp` });
    if (snap.form !== this.portraitForm) {
      this.portraitForm = snap.form;
      const def = formDefs[snap.form];
      this.portrait.setProperties({ src: `/art/portraits/${snap.form}.webp` });
      this.formName.set({ text: def.name });
      for (const tag of this.typeTags) {
        tag.tag.removeFromParent();
        tag.dispose();
        tag.tag.dispose();
      }
      this.typeTags = def.types.map((type) => slantTag(typeNames[type], { size: 11 }));
      this.formTypes.add(...this.typeTags.map((tag) => tag.tag));
    }
    this.updateTeam(snap.team);
    const goal = snap.level + Math.max(0, Math.min(1, snap.xp / snap.xpNext));
    const xp = this.xpShown;
    if (xp.progress < 0 || goal < xp.progress) {
      // The first reading (or a new run's lower one) is where the ring starts, not a gain.
      Object.assign(xp, { progress: goal, goal, trail: goal, hold: 0, glow: 0 });
      this.level.setProperties({ text: String(snap.level) });
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
    // Rampage: pink figures on wine plates.
    const plateInk = snap.rampage ? "#96182e" : ui.ink;
    this.clock.set({ text: formatTime(snap.time), color: snap.rampage ? "#ffc2c2" : ui.white });
    this.clock.setStrokeColor(plateInk);
    this.clockPlate.set({ fill: plateInk });
    this.metaPlate.set({ fill: plateInk });
    this.metaText.setProperties({
      text: `${STAGE_ROUTE.indexOf(snap.stage) + 1}/6 ${stageDefs[snap.stage].name} ${zoneState(snap)} · ${snap.kills}`,
    });
    if (previous && previous.stardust !== snap.stardust) this.popStardust();
    // This run's earnings, written as a gain (the banked total shows only in the lobby).
    this.stardust.setProperties({ text: `+${snap.stardust}` });
    this.boss.setProperties({ display: snap.boss ? "flex" : "none" });
    if (snap.boss) {
      if (snap.boss.name !== previous?.boss?.name) this.bossName.set({ text: snap.boss.name });
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
      slot.face.uniforms.hudColor.value.set(move ? softOf(moves[move.id].type) : ui.mist);
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
    // While the cast protects the player, the ring is that protection draining in warm yellow and
    // the halo gathers into the key until the release; the charge ring returns after.
    const protection = Math.max(0, snap.ultProtection);
    const windup = Math.max(0, snap.ultWindup);
    this.ultimate.uniforms.hudReady.value = snap.ult >= 1 ? 1 : 0;
    this.ultimate.uniforms.hudFill.value = Math.max(
      0,
      Math.min(1, protection > 0 ? protection / ULT_INVULNERABLE : snap.ult),
    );
    if (protection > 0) this.ultimate.uniforms.hudColor.value.set(PROTECT);
    this.halo.content.setProperties({
      display: (snap.ult >= 1 && !snap.casting) || windup > 0 ? "flex" : "none",
    });
    if (previous && previous.ultWindup > 0 && windup === 0 && protection > 0)
      this.readyPulse("ultimate", this.ultPose, 320);
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
    fade(ult.panel, snap.casting && protection === 0 ? 0.6 : 1);
    this.weatherChip.set(snap.weather, this.compact);
    this.interact.set(
      snap.prompt,
      state.blocked || this.choiceOpen,
      snap.pendingCount,
      snap.rescueProgress ?? snap.siteProgress,
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
      slot.label?.text.setProperties({ text: id ? moves[id as keyof typeof moves].name : "" });
      slot.label?.box.setProperties({ visibility: id ? "visible" : "hidden" });
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
        this.hp.uniforms.hudFrame.value.copy(this.ink).lerp(this.healLight, 1 - this.healAge.t);
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
    this.level.setProperties({ text: String(level) });
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
  private readonly ink = new Color(ui.ink);
  private readonly hurtRed = new Color("#ff6f7d");
  private readonly healLight = new Color("#9be884");
  private readonly healAge = { t: 1 };
  private plateTheme: string | null = null;
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
    // Under the left column (vitals, teammates, the notice): its foot from the stage top.
    const leftMatrix = this.left.globalMatrix.value;
    this.trainers.frame({
      bottom: this.interactBottom,
      top: leftMatrix
        ? this.stage.viewport.height / 2 -
          leftMatrix.elements[13]! +
          (this.left.size.value?.[1] ?? 0) / 2
        : 0,
    });
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
    this.fitPlateEnds();
    if (!this.state?.visible) return;
    if (!idleStep) return;
    if (this.hp.uniforms.hudReady.value > 0) {
      this.hp.uniforms.hudTime.value = this.elapsed;
      this.stage.invalidate();
    }
    if (this.weatherChip.tick(this.elapsed)) this.stage.invalidate();
    if (this.halo.content.properties.peek().display !== "none") {
      this.halo.uniforms.hudTime.value =
        (this.state.snapshot?.ultWindup ?? 0) > 0
          ? 1 - (this.elapsed % WINDUP_PULSE) / WINDUP_PULSE
          : (this.elapsed % 1.2) / 1.2;
      this.stage.invalidate();
    }
    const pose = crestPose(this.state.theme, this.elapsed);
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
    const target = max > 0 ? Math.max(0, Math.min(1, shield / max)) : -1;
    if (target === this.shieldTarget) return;
    this.shieldTarget = target;
    if (target < 0) {
      this.stage.motion.cancel(this.shieldState);
      this.shieldState.fill = 0;
      this.hp.uniforms.hudShield.value = -1;
      this.stage.invalidate();
      return;
    }
    this.stage.motion.animate(
      this.shieldState,
      { fill: target },
      120,
      () => {
        this.hp.uniforms.hudShield.value = this.shieldState.fill;
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
                borderColor: ui.ink,
              });
              this.dashPips.add(dot);
              return dot;
            })
          : [];
      this.dashPips.setProperties({ display: max > 1 ? "flex" : "none" });
    }
    this.dashPipDots.forEach((dot, i) =>
      dot.setProperties({ backgroundColor: i < ready ? "#ffd45b" : "#5a5a66" }),
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
  /** A mouse over a control (null: over none): it lifts and lightens. */
  hover(index: number | null): void {
    if (index === this.hovered) return;
    this.hovered = index;
    this.interact.setHovered(index !== null && this.controls[index]?.action === "interact");
    this.paintFocus();
  }
  /** Keyboard focus is ringed in ink, following each key's shape; the pointer shows none. */
  setFocusVisible(visible: boolean): void {
    this.focusVisible = visible;
    this.paintFocus();
  }
  private paintFocus(): void {
    const pressed = new Set(this.held.values());
    this.controls.forEach((c, i) => {
      const ringed = i === this.selected && this.focusVisible;
      const hovered = i === this.hovered;
      if (c.action === "interact") {
        this.interact.setFocusRing(ringed);
        return;
      }
      if (c.plate) c.plate.set({ focus: ringed ? 1 : 0, fill: hovered ? KEY_HOVER : KEY_FACE });
      else c.panel.setProperties({ borderWidth: ringed ? 3 : 0 });
      // Hover lifts, a press sinks; the pose eases over the shared 160ms snap.
      const y = pressed.has(i) ? LIFT.press : hovered ? -LIFT.hover : 0;
      if (y !== c.pose.y)
        this.stage.motion.animate(
          c.pose,
          { y },
          LIFT.ms,
          () => {
            c.panel.setProperties({ transformTranslateY: c.pose.y });
            c.plate?.set({ depth: 3 - c.pose.y });
            this.stage.invalidate();
          },
          SNAP,
        );
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
    else this.paintFocus();
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

  /**
   * The name plate's ends: half its measured lean plus the same gap on both sides (the left one
   * past the medal's overlap), so the upright rows sit on the slanted face's centre line.
   */
  private fitPlateEnds(): void {
    const size = this.plate.size.value;
    if (!size) return;
    const end = (this.compact ? 10 : 12) + slantOf(size[1]) / 2;
    if (Math.abs(end - this.plateEnd) < 0.05) return;
    this.plateEnd = end;
    const medal = this.compact ? 52 : 64;
    this.plate.setProperties({ paddingLeft: medal / 2 + end, paddingRight: end });
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
    this.trainers.dispose();
    this.indicators.dispose();
    this.numbers.dispose();
    this.edges.dispose();
    this.devReadout?.dispose();
    this.cancel();
    this.interact.dispose();
    this.weatherChip.dispose();
    this.stage.motion.cancel(this.shieldState);
    for (const control of this.controls) {
      this.stage.motion.cancel(control.pose);
      control.plate?.dispose();
    }
    for (const mate of this.mates) mate.plate.dispose();
    for (const tag of this.typeTags) tag.dispose();
    for (const slot of this.moves) slot.label?.plate.dispose();
    this.plateFace?.dispose();
    this.levelPlate.dispose();
    this.clockPlate.dispose();
    this.metaPlate.dispose();
    this.purseFace.dispose();
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
