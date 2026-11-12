import { FullscreenIcon } from "./fullscreen-icon";
import type { UiKey } from "../../platform/ui-surface";
import {
  isNavigationDirection,
  type NavigationAction,
  type NavigationDirection,
} from "../../platform/input";
import { currentInputMode } from "./input-glyph";
import {
  abortableEffect,
  Container,
  Content,
  Image,
  Text,
  withOpacity,
  type FontFamilies,
} from "@pmndrs/uikit";
import { Color, Matrix4, Mesh, PlaneGeometry, Vector3, type Texture } from "three";
import { images } from "../../prepare/images";
import { getAudio } from "../../audio/engine";
import { LEGAL_NOTICE } from "../../legalNotice";
import { type LobbyPick } from "../../lobbyPick";
import { STAGE_ROUTE } from "../../run/sim/content/campaign";
import { formatTime, typeNames } from "../../run/labels";
import { difficultyLock, starterLock } from "../../run/locks";
import { starterUnlocked, type Progress } from "../../run/progress";
import { starterUnlocks } from "../../run/sim/content/params/progression";
import { difficulties, type Difficulty } from "../../run/sim/content/difficulties";
import { items, type ItemId } from "../../run/sim/content/items";
import { starterOrder, starters, type StarterId } from "../../run/sim/content/lines/index";
import { type StageId } from "../../run/sim/content/stages/index";
import { BoxShadow, OutlineRing } from "./box-shadow";
import { CodexBall } from "./codex-parts";
import { CURRENCY_NAME, GpuCurrency } from "./currency";
import { cubicBezier, uiEaseOut } from "./focus-mark";
import { GameButton } from "./game-button";
import { HoverPattern } from "./hover-pattern";
import { createMenuIcon } from "./icons";
import { fade, stack } from "./layer";
import { balanceLines, textWidth } from "./line-break";
import type { LobbyScene } from "./lobby-scene";
import { MapSwatch } from "./map-swatch";
import { idleTicked } from "./motion";
import { OutlinedText } from "./outlined-text";
import { themeColors, typeColors } from "./run-choice-surface";
import { createTriangleMark, HatchFill, RadialFace, Silhouette } from "./screen-parts";
import { SlantPlate, slantOf } from "./slant-plate";
import { UiStage } from "./stage";
import { leadTag } from "./tag";
import { GpuTooltip } from "./tooltip";
import { UiShaderMaterial } from "./ui-shader";
import type { UiInsets } from "./viewport";

/** Portraits for the roster's locked silhouettes: views of the image store's shared Sources. */
function artTexture(url: string, onLoad: () => void): Texture {
  return images().texture(url, "art", onLoad);
}

export interface LobbyState {
  progress: Progress;
  /** The host's warm-up copies name no map: they open on the first one. */
  pick: LobbyPick;
}
export interface LobbyCallbacks {
  /** 出发 with the current pick: one press, the run's own loading screen follows. */
  start(pick: LobbyPick): void;
  /** The pick changed (kept by the app for the next visit and the next session). */
  pick(pick: LobbyPick): void;
  lab(): void;
  codex(): void;
  settings(): void;
  multiplayer(): void;
}

const LONG_PRESS_MS = 450;
/** A horizontal drag this long in the hero zone switches partner. */
const SWIPE = 48;
/** Wheel distance per partner switch over the hero zone. */
const WHEEL_STEP = 100;
const NAVY = "#142f50",
  NAVY_DEEP = "#0d233f",
  SURFACE = "#e9f4fb",
  YELLOW = "#ffd45b",
  ICE = "#d8effb",
  BLUE = "#2165a4",
  SEGMENT_EDGE = "#0a1c33";
const ease = (t: number) => cubicBezier(t, 0.25, 0.1, 0.25, 1);

/** DESIGN.md: desktop / compact (logical height ≤ 600, landscape) sizes. */
function tokens(compact: boolean) {
  return {
    edge: compact ? 16 : 28,
    top: compact ? 8 : 20,
    bottom: compact ? 12 : 24,
    bar: compact ? 44 : 48,
    gap: compact ? 8 : 12,
    ribbon: compact ? 40 : 64,
    ribbonIndent: compact ? 8 : 12,
    name: compact ? 26 : 44,
    nameStroke: compact ? 2.5 : 3.5,
    tagsGap: compact ? -6 : 8,
    medalMax: compact ? 56 : 84,
    medalGap: compact ? 10 : 14,
    rosterGap: compact ? 8 : 18,
    trayGap: compact ? 8 : 14,
    trayPad: compact ? 4 : 6,
    segment: compact ? 44 : 46,
    launch: compact ? 56 : 84,
    slot: compact ? 28 : 40,
    switchKey: compact ? 48 : 56,
    legalGap: compact ? 6 : 10,
    zoneGap: compact ? 16 : 24,
  };
}

type ControlKind =
  | "lab"
  | "codex"
  | "settings"
  | "fullscreen"
  | "multiplayer"
  | "prev"
  | "next"
  | "tile"
  | "difficulty"
  | "start"
  | "info";
interface Control {
  kind: ControlKind;
  panel: Container;
  /** Roster or difficulty position. */
  index: number;
  tip(): string | null;
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

/** A locked line's unlock progress: a 4px ring, xp blue from 12 o'clock clockwise on navy-deep. */
class ProgressRing {
  readonly content = new Content({
    positionType: "absolute",
    positionLeft: -4,
    positionTop: -4,
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new UiShaderMaterial("lobby-progress-ring", {
    uniforms: { share: { value: 0 }, opacity: { value: 1 } },
    vertexShader: `
      varying vec2 ringUv;
      #include <clipping_planes_pars_vertex>
      void main() {
        ringUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
        #include <clipping_planes_vertex>
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: `
      uniform float share, opacity;
      varying vec2 ringUv;
      #include <clipping_planes_pars_fragment>
      vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
      void main() {
        #include <clipping_planes_fragment>
        vec2 q = ringUv - .5;
        float r = length(q) * 2.;
        float aa = fwidth(r);
        float band = smoothstep(.86 - aa, .86 + aa, r) * (1. - smoothstep(1. - aa, 1., r));
        if (band <= 0.) discard;
        float angle = fract(atan(q.x, q.y) / 6.2831853 + 1.);
        vec3 ink = angle < share ? vec3(.349, .784, 1.) : vec3(.051, .137, .247);
        gl_FragColor = vec4(toLinear(ink), band * opacity);
        #include <colorspace_fragment>
      }`,
  });
  constructor() {
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
    abortableEffect(() => {
      const parent = this.content.parentContainer.value;
      const size = parent?.size.value;
      const border = parent?.borderInset.value;
      if (!size || !border) return;
      // Follow the resolved border box after layout, including resize and UI scale changes.
      this.content.setProperties({
        positionLeft: -border[3] - 4,
        positionTop: -border[0] - 4,
        width: size[0] + 8,
        height: size[1] + 8,
      });
    }, this.content.abortSignal);
  }
  set(share: number): void {
    this.material.uniforms.share.value = share;
  }
  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * A 研究所 / 图鉴 card (DESIGN.md): a solid face in a 3px navy-deep frame on a 5px hard
 * base, its Magpie illustration standing on the bottom-left corner and rising over the top edge,
 * the name centred in the slot right of it. Hover lifts it (the ball pattern lights, the picture
 * grows and tilts); focus adds the blue ring; a press sinks it onto its base.
 */
class LobbyCard {
  readonly panel = new Container({
    positionType: "absolute",
    borderWidth: 3,
    borderColor: NAVY_DEEP,
    borderRadius: 10,
  });
  private readonly base = new BoxShadow(10, [
    { y: 5, blur: 0, color: NAVY_DEEP, alpha: 1 },
    { y: 10, blur: 16, color: NAVY_DEEP, alpha: 0.28 },
  ]);
  private readonly pattern: HoverPattern;
  private readonly ring = new OutlineRing(10, BLUE, 3, 4);
  private readonly art;
  private readonly artShade: Silhouette;
  private readonly slot = new Container({
    positionType: "absolute",
    positionTop: 0,
    alignItems: "center",
    justifyContent: "center",
  });
  private readonly name: Text;
  private readonly stage: UiStage;
  private readonly pose = { lit: 0, down: 0 };
  private lit = false;
  private down = false;

  constructor(stage: UiStage, label: string, url: string, face: string) {
    this.stage = stage;
    this.panel.setProperties({ backgroundColor: face });
    this.pattern = new HoverPattern(stage.motion, () => stage.invalidate(), face, 7);
    this.ring.content.setProperties({ display: "none" });
    this.art = new Image({ src: url, positionType: "absolute" });
    this.artShade = new Silhouette(
      artTexture(url, () => stage.invalidate()),
      0.35,
    );
    this.artShade.content.setProperties({ positionType: "absolute" });
    this.name = new Text({
      text: label,
      fontWeight: 800,
      color: NAVY_DEEP,
      whiteSpace: "pre",
      wordBreak: "keep-all",
    });
    this.slot.add(this.name);
    this.panel.add(this.base.content, stack(this.pattern.content, 1), stack(this.slot, 2));
    this.panel.add(
      stack(this.artShade.content, 3),
      stack(this.art, 4),
      stack(this.ring.content, 5),
    );
  }

  /** Box (logical units, from the top left) and the illustration's corner inset. */
  place(x: number, y: number, w: number, h: number, inset: number): void {
    const art = 1.1 * h;
    this.panel.setProperties({ positionLeft: x, positionTop: y, width: w, height: h });
    for (const node of [this.art, this.artShade.content])
      node.setProperties({
        width: art,
        height: art,
        positionLeft: inset - 3,
        positionBottom: inset - 3,
      });
    this.artShade.content.setProperties({ transformTranslateY: 3 });
    const left = Math.min(art, 0.6 * w) + inset + 6 - 3;
    this.slot.setProperties({
      positionLeft: left,
      width: Math.max(0, w - 6 - left - 10),
      height: h - 6,
    });
    const size = h >= 90 ? 20 : 16;
    this.name.setProperties({
      fontSize: size,
      letterSpacing: size * 0.06,
      paddingLeft: size * 0.06,
    });
    this.apply();
  }

  paint(state: {
    hovered: boolean;
    focused: boolean;
    focusVisible: boolean;
    pressed: boolean;
  }): void {
    const lit = state.hovered || (state.focused && state.focusVisible);
    this.ring.content.setProperties({
      display: state.focused && state.focusVisible ? "flex" : "none",
    });
    this.pattern.setFocused(lit);
    if (lit !== this.lit || state.pressed !== this.down) {
      this.lit = lit;
      this.down = state.pressed;
      this.stage.motion.animate(
        this.pose,
        { lit: lit ? 1 : 0, down: state.pressed ? 1 : 0 },
        state.pressed ? 60 : 140,
        () => this.apply(),
        ease,
      );
    }
  }

  private apply(): void {
    const { lit, down } = this.pose;
    this.panel.setProperties({
      transformTranslateY: -2 * lit * (1 - down) + 5 * down,
      transformScaleX: 1 + 0.012 * down,
      transformScaleY: 1 - 0.03 * down,
    });
    this.base.set([
      { y: 5 + 2 * lit * (1 - down) - 5 * down, blur: 0, color: NAVY_DEEP, alpha: 1 },
      { y: 10, blur: 16, color: NAVY_DEEP, alpha: 0.28 * (1 - down) },
    ]);
    const grow = 1 + 0.06 * lit;
    // CSS rotate(−3deg) turns counter-clockwise on a y-down screen; UIKit's z turns the other way.
    for (const node of [this.art, this.artShade.content])
      node.setProperties({
        transformScaleX: grow,
        transformScaleY: grow,
        transformRotateZ: 3 * lit,
      });
    this.stage.invalidate();
  }

  update(deltaMs: number): void {
    this.pattern.update(deltaMs);
  }

  dispose(): void {
    this.stage.motion.cancel(this.pose);
    this.base.dispose();
    this.pattern.dispose();
    this.ring.dispose();
    this.artShade.dispose();
  }
}

/**
 * The lobby (DESIGN.md): the root screen over its world scene (`lobby-scene.ts`: backdrop,
 * podium, type light and the live partner). The UI is transparent over the scene: the top bar
 * (brand, balance, 研究所 / 图鉴 / 设置), ‹ › beside the podium, the legal line, and one decision
 * column anchored bottom right — the type ribbon, the tags, the roster, the backpack and the tray
 * with the difficulty and 出发.
 */
export class GpuLobby {
  readonly stage = new UiStage();
  readonly minLayout = { width: 760, height: 360 };
  private readonly callbacks: LobbyCallbacks;
  private readonly topBar = new Container({
    positionType: "absolute",
    flexDirection: "row",
    alignItems: "center",
  });
  private readonly brand = new Container({ flexDirection: "row", alignItems: "center", gap: 10 });
  private readonly mark = new Image({
    src: "/art/portraits/charmander.webp",
    width: 48,
    height: 48,
    flexShrink: 0,
  });
  private readonly word: Text;
  private readonly balance: GpuCurrency;
  private readonly column = new Container({
    positionType: "absolute",
    flexDirection: "column",
    alignItems: "stretch",
  });
  private readonly ribbon = new Container({ flexDirection: "row", alignItems: "center" });
  private readonly tags = new Container({ flexDirection: "row", alignItems: "center" });
  private readonly roster = new Container({
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingX: 6,
  });
  private readonly backpack = new Container({ flexDirection: "row", alignItems: "center", gap: 6 });
  private readonly tray = new Container({
    flexDirection: "column",
    backgroundColor: NAVY_DEEP,
    borderWidth: 3,
    borderColor: NAVY,
    borderRadius: 14,
  });
  private readonly segmentsRow = new Container({ flexDirection: "row", gap: 4 });
  private readonly launch = new Container({
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  });
  private readonly launchPlate: SlantPlate;
  private readonly launchEmblem = new Container({
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 2,
    borderColor: YELLOW,
    backgroundColor: NAVY_DEEP,
    flexShrink: 0,
  });
  private readonly launchText = new Text({
    text: "出发",
    fontWeight: 800,
    color: NAVY_DEEP,
    whiteSpace: "pre",
  });
  /** Centres the word on the whole plate (not between the emblem and the wedges). */
  private readonly launchWord = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  });
  private readonly arrows: Content[] = [];
  private readonly arrowBox = new Container({ flexDirection: "row", alignItems: "center" });
  private readonly legal = new Container({
    positionType: "absolute",
    flexDirection: "row",
    justifyContent: "center",
  });
  /** Map tabs occupy the launch tray above difficulty; the destination labels 出发. */
  private readonly mapSign = new Container({
    flexDirection: "row",
    alignItems: "center",
  });
  private readonly mapName = new Text({
    fontWeight: 800,
    color: NAVY_DEEP,
    whiteSpace: "pre",
    wordBreak: "keep-all",
  });
  private readonly mapTiles: { panel: Container; swatch: MapSwatch }[] = [];
  private readonly legalText: Text;
  private readonly prev: GameButton;
  private readonly next: GameButton;
  private readonly tooltip: GpuTooltip;
  private readonly controls: Control[] = [];
  private readonly tiles: Control[] = [];
  private readonly segments: Control[] = [];
  private readonly buttons: GameButton[] = [];
  private readonly cards: LobbyCard[];
  /** Where the cards sit (§3.1): above the column, or in the top bar on short screens. */
  private cardsInBar = false;
  private readonly medals: { panel: Container; ball: CodexBall; badge: Container }[] = [];
  private readonly segmentBoxes: Container[] = [];
  private readonly disposables: { dispose(): void; update?(): void }[] = [];
  private readonly plateParts: { dispose(): void; update?(): void }[] = [];
  private readonly carryTips: { panel: Container; item: ItemId }[] = [];
  private readonly inverse = new Matrix4();
  private readonly point = new Vector3();
  private scene: LobbyScene | null = null;
  private emblemImage: { setProperties(p: { transformRotateZ: number }): void } | null = null;
  private progress: Progress;
  private selected: StarterId;
  private difficulty: Difficulty;
  private map: StageId;
  private focused = -1;
  private hovered = -1;
  private pressed = -1;
  private focusVisible = false;
  private coarse = false;
  private compact = false;
  private revealed = true;
  private covered = false;
  private departing = false;
  private touchTip = -1;
  private hoveredTip = -1;
  private tipPress: { index: number; at: number; x: number; y: number; fired: boolean } | null =
    null;
  private swipe: { x: number; y: number; done: boolean } | null = null;
  private pointer: { x: number; y: number } | null = null;
  private wheel = 0;
  private elapsed = 0;
  private legalLaid = "";
  private placed = "";
  private zone = { x: 0, y: 0, r: 0, b: 0 };
  /** The launch plate's look, eased between its states. */
  private readonly lit = { value: 0 };
  private readonly press = { value: 0 };
  private readonly spin = { value: 0 };
  private litOn = false;
  private downOn = false;
  private patternPhase = 0;
  private launchPose = "";
  /** The ribbon and tags slide in from 12 to the right on a switch. */
  private readonly slide = { value: 1 };

  constructor(
    fonts: FontFamilies,
    _backdrop: Texture,
    state: LobbyState,
    callbacks: LobbyCallbacks,
  ) {
    this.callbacks = callbacks;
    this.progress = state.progress;
    this.selected = state.pick.starter;
    this.difficulty = state.pick.difficulty;
    this.map = "forest";
    this.stage.root.setProperties({ fontFamilies: fonts, color: NAVY });
    this.tooltip = new GpuTooltip(this.stage);

    // Top bar: brand | balance, 研究所, 图鉴, 设置.
    this.word = new Text({
      text: "poketone",
      fontFamily: "Poketone Display",
      fontWeight: 400,
      fontSize: 30,
      letterSpacing: -1,
      lineHeight: "110%",
      color: NAVY,
    });
    this.brand.add(this.mark, this.word);
    this.balance = new GpuCurrency(this.stage);
    this.balance.set(state.progress.stardust);
    this.balance.solid();
    const settings = new GameButton(this.stage, {
      tone: "scene",
      size: "small",
      square: true,
      flat: true,
      icon: createMenuIcon("settings"),
    });
    const multiplayer = new GameButton(this.stage, {
      tone: "scene",
      size: "small",
      label: "联机",
      flat: true,
    });
    this.buttons.push(multiplayer);
    this.controls.push(
      this.keyControl("multiplayer", multiplayer, () => this.callbacks.multiplayer()),
    );
    this.fullscreen = new GameButton(this.stage, {
      tone: "scene",
      size: "small",
      square: true,
      flat: true,
      icon: this.fullscreenIcon,
    });
    this.fullscreen.panel.setProperties({ display: "none" });
    this.buttons.push(this.fullscreen);
    this.controls.push(
      this.keyControl("fullscreen", this.fullscreen, () => this.toggleFullscreen?.()),
    );
    this.buttons.push(settings);
    this.topBar.add(
      this.brand,
      new Container({ flexGrow: 1 }),
      this.balance.root,
      multiplayer.panel,
      settings.panel,
      this.fullscreen.panel,
    );
    this.controls.push(this.keyControl("settings", settings, () => this.callbacks.settings()));
    // 研究所 / 图鉴: two illustrated cards under 设置 (or in the top bar on short screens, §3.1).
    this.cards = [
      new LobbyCard(this.stage, "研究所", "/art/lobby/card-lab.webp", ICE),
      new LobbyCard(this.stage, "图鉴", "/art/lobby/card-codex.webp", "#fce5e5"),
    ];
    for (const [i, card] of this.cards.entries()) {
      this.stage.root.add(stack(card.panel, 3));
      this.controls.push({
        kind: i === 0 ? "lab" : "codex",
        panel: card.panel,
        index: i,
        tip: () => null,
        locked: () => false,
        activate: () => (i === 0 ? this.callbacks.lab() : this.callbacks.codex()),
        paint: (state) => card.paint(state),
        update: (deltaMs) => card.update(deltaMs),
        dispose: () => card.dispose(),
      });
    }

    // The map sign, then ‹ › beside the podium (placed after layout).
    this.buildMapSign();
    this.prev = this.switchButton(-1);
    this.next = this.switchButton(1);

    // The decision column: ribbon, tags, roster, backpack, tray.
    for (const [index, id] of starterOrder.entries()) this.tile(id, index);
    this.launchPlate = new SlantPlate(
      this.launch,
      { fill: YELLOW, topLine: { color: "#ffe9a3", width: 4 }, pattern: true },
      12,
    );
    this.buildTray();
    this.column.add(
      stack(this.ribbon, 2),
      stack(this.tags, 4),
      stack(this.roster, 1),
      stack(this.backpack, 1),
      stack(this.tray, 1),
    );

    // Quiet legal copy under the brand, outside the decision column and thumb zone.
    this.legalText = new Text({
      text: LEGAL_NOTICE,
      fontSize: 11,
      lineHeight: "145%",
      fontWeight: 700,
      color: ICE,
      textAlign: "center",
      whiteSpace: "pre",
      wordBreak: "keep-all",
      backgroundColor: withOpacity(NAVY_DEEP, 0.62),
      borderRadius: 4,
      paddingX: 8,
      paddingY: 3,
    });
    this.legal.add(this.legalText);
    this.stage.root.add(stack(this.legal, 1), stack(this.column, 2), stack(this.topBar, 3));
    this.buildPartner();
  }

  /** The world scene this lobby lays out and themes (absent on the host's warm-up copies). */
  attachScene(scene: LobbyScene): void {
    this.scene = scene;
    this.placed = "";
    const form = starters[this.selected].stages[0].form;
    scene.show(form.id, form.types[0]!);
    scene.setCovered(this.covered || !this.revealed);
  }

  // ── Controls ────────────────────────────────────────────────────────────────────────────────

  private switchButton(step: -1 | 1): GameButton {
    const icon = createMenuIcon("chevron");
    if (step < 0) icon.setProperties({ transformScaleX: -1 });
    const button = new GameButton(this.stage, {
      tone: "scene",
      size: "normal",
      square: true,
      flat: true,
      icon,
    });
    button.panel.setProperties({ positionType: "absolute" });
    this.buttons.push(button);
    this.stage.root.add(stack(button.panel, 1));
    this.controls.push(this.keyControl(step < 0 ? "prev" : "next", button, () => this.cycle(step)));
    return button;
  }

  private readonly fullscreen: GameButton;
  private toggleFullscreen: (() => void) | undefined;
  private readonly fullscreenIcon = new FullscreenIcon();

  setFullscreenAction(action: (() => void) | undefined, active: boolean): void {
    if (this.fullscreenIcon.setActive(active)) this.stage.invalidate();
    if (this.toggleFullscreen === action) return;
    this.toggleFullscreen = action;
    this.fullscreen.panel.setProperties({ display: action ? "flex" : "none" });
    if (!action && this.controls[this.focused]?.kind === "fullscreen")
      this.focus(this.index("settings"));
    this.stage.invalidate();
  }

  private keyControl(kind: ControlKind, button: GameButton, activate: () => void): Control {
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
        button.setPressed(pressed);
      },
      update: () => {},
      dispose: () => {},
    };
  }

  /**
   * The route sign (§3.9): six ordered map tiles, outside interactive focus navigation.
   */
  private buildMapSign(): void {
    for (const id of STAGE_ROUTE) {
      const panel = new Container({
        borderRadius: 7,
        borderWidth: 2,
        borderColor: NAVY,
        flexShrink: 0,
      });
      const swatch = new MapSwatch(id, 5);
      panel.add(swatch.content);
      this.mapSign.add(panel);
      this.mapTiles.push({ panel, swatch });
      this.disposables.push(swatch);
    }
    this.mapName.setProperties({ text: "6 关探险" });
  }

  private texture(url: string): Texture {
    return artTexture(url, () => this.stage.invalidate());
  }

  /** A roster medal (§3.2 名册): portrait in its type ring; picked, hovered, focused, cleared, locked. */
  private tile(id: StarterId, index: number): void {
    const form = starters[id].stages[0].form;
    const tone = typeColors[form.types[0]!];
    const panel = new Container({
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 999,
      borderWidth: 3,
      borderColor: NAVY,
      flexShrink: 0,
    });
    const shadow = new BoxShadow(999, [
      { y: 3, blur: 0, color: NAVY_DEEP, alpha: 1 },
      { y: 6, blur: 12, color: NAVY_DEEP, alpha: 0.22 },
    ]);
    const outer = new OutlineRing(999, NAVY_DEEP, 2, 0);
    const ring = new OutlineRing(999, BLUE, 3, 3);
    ring.content.setProperties({ display: "none" });
    const face = new RadialFace({ at: [0.5, 0.4], inner: "#ffffff", middle: tone.soft, mid: 0.7 });
    const hatch = new HatchFill(0.35, 999);
    const pattern = new HoverPattern(
      this.stage.motion,
      () => this.stage.invalidate(),
      SURFACE,
      999,
    );
    const portrait = new Image({
      src: `/art/portraits/${form.id}.webp`,
      width: "84%",
      height: "84%",
    });
    const silhouette = new Silhouette(this.texture(`/art/portraits/${form.id}.webp`), 0.4);
    silhouette.content.setProperties({ width: "84%", height: "84%", display: "none" });
    const ball = new CodexBall(this.stage.motion, () => this.stage.invalidate());
    ball.content.setProperties({ positionType: "absolute", positionLeft: -4, positionTop: -4 });
    const progress = new ProgressRing();
    const need = starterUnlocks[id] ?? 1;
    // The corner badge: a success check (cleared) or a lock (not yet joined).
    const badge = new Container({
      positionType: "absolute",
      positionRight: -4,
      positionBottom: -4,
      borderRadius: 999,
      borderWidth: 2,
      borderColor: "#ffffff",
      alignItems: "center",
      justifyContent: "center",
    });
    const check = createMenuIcon("check");
    const lock = createMenuIcon("lock");
    for (const icon of [check, lock])
      icon.setProperties({ width: "62%", height: "62%", color: "#ffffff" });
    badge.add(check, lock);
    panel.add(shadow.content, stack(outer.content, 0), face.content, stack(hatch.content, 1));
    panel.add(stack(pattern.content, 1), stack(portrait, 2), stack(silhouette.content, 2));
    panel.add(stack(progress.content, 3), stack(badge, 4), stack(ball.content, 4));
    panel.add(stack(ring.content, 5));
    this.roster.add(panel);
    this.medals.push({ panel, ball, badge });
    const control: Control = {
      kind: "tile",
      panel,
      index,
      tip: () => starterLock(this.progress, id) ?? form.name,
      locked: () => starterLock(this.progress, id) !== null,
      activate: () => this.pick(id),
      paint: ({ hovered, focused, focusVisible }) => {
        const locked = control.locked();
        const checked = id === this.selected;
        const cleared = !locked && !!this.progress.best[id]?.victory;
        ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
        outer.content.setProperties({ display: checked ? "flex" : "none" });
        ball.set(checked, true);
        panel.setProperties({
          borderWidth: checked ? 4 : 3,
          borderColor: checked ? YELLOW : hovered && !locked ? BLUE : NAVY,
          transformTranslateY: checked ? -3 : 0,
          backgroundColor: locked ? "#c9d6e2" : undefined,
        });
        shadow.set([
          { y: checked ? 5 : 3, blur: 0, color: NAVY_DEEP, alpha: 1 },
          { y: 6, blur: 12, color: NAVY_DEEP, alpha: 0.22 },
        ]);
        pattern.setFocused(hovered && !locked && !checked);
        face.content.setProperties({ display: locked ? "none" : "flex" });
        hatch.content.setProperties({ display: locked ? "flex" : "none" });
        portrait.setProperties({ display: locked ? "none" : "flex" });
        silhouette.content.setProperties({ display: locked ? "flex" : "none" });
        progress.content.setProperties({ display: locked ? "flex" : "none" });
        progress.set(Math.min(1, this.progress.research / need));
        badge.setProperties({
          display: locked || cleared ? "flex" : "none",
          backgroundColor: locked ? NAVY_DEEP : "#2f8f5b",
        });
        check.setProperties({ display: cleared ? "flex" : "none" });
        lock.setProperties({ display: locked ? "flex" : "none" });
      },
      update: (deltaMs) => {
        face.update();
        hatch.update();
        pattern.update(deltaMs);
      },
      dispose: () => {
        shadow.dispose();
        outer.dispose();
        ring.dispose();
        face.dispose();
        hatch.dispose();
        pattern.dispose();
        silhouette.dispose();
        ball.dispose();
        progress.dispose();
      },
    };
    this.controls.push(control);
    this.tiles.push(control);
  }

  // ── Tray: difficulty and 出发 ─────────────────────────────────────────────────────────────────

  private buildTray(): void {
    const shadow = new BoxShadow(14, [{ y: 8, blur: 18, color: NAVY_DEEP, alpha: 0.3 }]);
    this.disposables.push(shadow);
    // `inset 0 3px 0 rgb(0 0 0 / 30%)`: the tray's lip.
    this.tray.add(
      shadow.content,
      new Container({
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 0,
        width: "100%",
        height: 3,
        borderTopLeftRadius: 11,
        borderTopRightRadius: 11,
        backgroundColor: withOpacity("#000000", 0.3),
      }),
    );
    for (const [index, def] of difficulties.entries()) this.segment(def.name, index as Difficulty);
    // 出发: the slanted plate, the type crest at its left end, the word, three wedges.
    for (let i = 0; i < 3; i++) {
      const wedge = createTriangleMark(NAVY_DEEP);
      this.arrows.push(wedge);
      this.arrowBox.add(wedge);
    }
    this.launch.add(
      this.launchPlate.content,
      stack(this.launchEmblem, 2),
      stack(new Container({ flexGrow: 1 }), 2),
      stack(this.arrowBox, 2),
      stack(this.launchWord, 2),
    );
    this.launchWord.setProperties({ flexDirection: "column", gap: 0 });
    this.launchWord.add(this.launchText, this.mapName);
    this.tray.add(stack(this.mapSign, 1), stack(this.segmentsRow, 1), stack(this.launch, 1));
    const control: Control = {
      kind: "start",
      panel: this.launch,
      index: 0,
      tip: () => null,
      locked: () => false,
      activate: () => this.depart(),
      paint: ({ hovered, focused, focusVisible, pressed }) => {
        const lit = hovered || (focused && focusVisible);
        this.launchPlate.set({ focus: focused && focusVisible && !this.departing ? 1 : 0 });
        if (lit !== this.litOn) {
          this.litOn = lit;
          this.stage.motion.animate(
            this.lit,
            { value: lit ? 1 : 0 },
            220,
            () => this.stage.invalidate(),
            ease,
          );
        }
        const down = pressed || this.departing;
        if (down !== this.downOn) {
          this.downOn = down;
          this.stage.motion.animate(this.press, { value: down ? 1 : 0 }, 60, () =>
            this.stage.invalidate(),
          );
        }
      },
      update: () => {},
      dispose: () => {},
    };
    this.controls.push(control);
  }

  /** One press: the pressed plate holds, its crest turns once, and input locks until the cover. */
  private depart(): void {
    if (this.departing) return;
    this.departing = true;
    this.spin.value = 0;
    this.stage.motion.animate(
      this.spin,
      { value: 1 },
      600,
      () => this.stage.invalidate(),
      uiEaseOut,
    );
    this.repaint();
    this.callbacks.start({ starter: this.selected, difficulty: this.difficulty, stage: this.map });
  }

  /** A difficulty segment (§3.2 难度): navy raised, ice when picked, hatched when locked. */
  private segment(label: string, value: Difficulty): void {
    const panel = new Container({
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: 2,
      borderColor: SEGMENT_EDGE,
      borderRadius: 8,
    });
    const base = new BoxShadow(8, [{ y: 3, blur: 0, color: SEGMENT_EDGE, alpha: 1 }]);
    const sheen = new Container({
      positionType: "absolute",
      positionLeft: 2,
      positionRight: 2,
      positionTop: 0,
      height: 1.5,
      backgroundColor: withOpacity("#ffffff", 0.14),
    });
    const hatch = new HatchFill(0.12, 6);
    const pattern = new HoverPattern(this.stage.motion, () => this.stage.invalidate(), NAVY, 6);
    const ring = new OutlineRing(8, BLUE, 3, 3);
    ring.content.setProperties({ display: "none" });
    const ball = new CodexBall(this.stage.motion, () => this.stage.invalidate());
    ball.content.setProperties({ width: 18, height: 18 });
    const lock = createMenuIcon("lock");
    lock.setProperties({ width: 16, height: 16, color: "#9fb3c6" });
    const text = new Text({ text: label, fontSize: 16, fontWeight: 800, whiteSpace: "pre" });
    panel.add(base.content, stack(sheen, 1), stack(hatch.content, 1), stack(pattern.content, 1));
    panel.add(stack(ball.content, 2), stack(lock, 2), stack(text, 2), stack(ring.content, 3));
    this.segmentsRow.add(panel);
    this.segmentBoxes.push(panel);
    const reason = () => difficultyLock(this.progress, value);
    const control: Control = {
      kind: "difficulty",
      panel,
      index: value,
      tip: reason,
      locked: () => reason() !== null,
      activate: () => {
        if (reason() || this.difficulty === value) return;
        this.difficulty = value;
        getAudio().sfx("ui-move");
        this.changed();
      },
      paint: ({ hovered, focused, focusVisible }) => {
        const locked = control.locked();
        const checked = this.difficulty === value;
        ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
        panel.setProperties({ backgroundColor: locked ? "#3a5470" : checked ? SURFACE : NAVY });
        base.content.setProperties({ display: locked ? "none" : "flex" });
        sheen.setProperties({ display: locked ? "none" : "flex" });
        hatch.content.setProperties({ display: locked ? "flex" : "none" });
        pattern.setSurface(checked ? SURFACE : NAVY);
        pattern.setFocused(hovered && !locked);
        ball.content.setProperties({ display: locked ? "none" : "flex" });
        ball.set(checked, true);
        lock.setProperties({ display: locked ? "flex" : "none" });
        text.setProperties({ color: locked ? "#9fb3c6" : checked ? NAVY_DEEP : "#ffffff" });
      },
      update: (deltaMs) => {
        hatch.update();
        pattern.update(deltaMs);
      },
      dispose: () => {
        base.dispose();
        hatch.dispose();
        pattern.dispose();
        ring.dispose();
        ball.dispose();
      },
    };
    this.controls.push(control);
    this.segments.push(control);
  }

  // ── Pick ────────────────────────────────────────────────────────────────────────────────────

  private pick(id: StarterId): void {
    if (starterLock(this.progress, id) !== null || id === this.selected) return;
    this.selected = id;
    getAudio().sfx("ui-move");
    this.buildPartner();
    const form = starters[id].stages[0].form;
    this.scene?.show(form.id, form.types[0]!);
    this.slide.value = 0;
    this.applySlide();
    this.stage.motion.animate(this.slide, { value: 1 }, 200, () => this.applySlide(), uiEaseOut);
    this.changed();
  }

  /** The next (previous) partner that has joined, wrapping. */
  private cycle(step: -1 | 1): void {
    const open = starterOrder.filter((id) => starterUnlocked(this.progress, id));
    if (open.length < 2) return;
    const at = open.indexOf(this.selected);
    this.pick(open[(at + step + open.length) % open.length]!);
  }

  private changed(): void {
    this.callbacks.pick({ starter: this.selected, difficulty: this.difficulty, stage: this.map });
    this.repaint();
  }

  private applySlide(): void {
    const t = this.slide.value;
    for (const node of [this.ribbon, this.tags])
      fade(node, t).setProperties({ transformTranslateX: 12 * (1 - t) });
    this.stage.invalidate();
  }

  /** The selected partner's ribbon and tags, the backpack, and the 出发 emblem. */
  private buildPartner(): void {
    for (let i = this.controls.length - 1; i >= 0; i--)
      if (this.controls[i]!.kind === "info") this.controls.splice(i, 1);
    for (const part of this.plateParts.splice(0)) part.dispose();
    for (const node of [this.ribbon, this.tags, this.backpack])
      for (const child of node.children.slice()) {
        child.removeFromParent();
        (child as { dispose?: () => void }).dispose?.();
      }
    this.carryTips.length = 0;
    const t = tokens(this.compact);
    const starter = starters[this.selected];
    const form = starter.stages[0].form;
    const type = form.types[0]!;
    const { theme, deep, soft } = themeColors(type);
    // The ribbon: the theme band slanted; the outlined name; the crest over its top right corner.
    const plate = new SlantPlate(this.ribbon, { fill: theme, theme: { type, deep } }, 10);
    this.plateParts.push(plate);
    const name = new OutlinedText(
      {
        text: form.name,
        fontSize: t.name,
        fontWeight: 800,
        color: "#ffffff",
        letterSpacing: t.name * 0.04,
      },
      { width: t.nameStroke, color: NAVY_DEEP },
    );
    this.plateParts.push(name);
    name.root.setProperties({ minWidth: 0 });
    this.ribbon.add(plate.content, stack(name.root, 2), new Container({ flexGrow: 1 }));
    const crestMini = new Image({
      src: `/art/icons/crests/${type}.webp`,
      width: this.compact ? 15 : 18,
      height: this.compact ? 15 : 18,
    });
    const ink = `#${new Color(NAVY_DEEP).lerp(new Color(theme), 0.45).getHexString()}`;
    const typeTag = leadTag(
      this.compact,
      { face: soft, ring: { color: theme, width: 2 } },
      [{ text: typeNames[type], color: ink }],
      crestMini,
    );
    this.plateParts.push(typeTag);
    this.ribbon.add(stack(typeTag.tag, 3));
    const record = this.progress.best[this.selected];
    this.tags.setProperties({ display: record && !this.compact ? "flex" : "none" });
    if (record && !this.compact) {
      const best = new Container({
        height: 28,
        paddingX: 10,
        borderRadius: 8,
        alignItems: "center",
        backgroundColor: withOpacity(NAVY_DEEP, 0.72),
        flexShrink: 0,
      });
      best.add(
        new Text({
          text: `最佳 ${difficulties[record.difficulty].name} · ${record.victory ? "通关" : "坚持"} ${formatTime(record.time)}`,
          fontSize: 13,
          fontWeight: 800,
          color: ICE,
          whiteSpace: "pre",
        }),
      );
      this.tags.add(best);
    }
    // The backpack: its badge and only the items packed; nothing when empty.
    const carried = this.progress.backpack;
    const host = this.backpack;
    // Desktop keeps the row's height even when empty, so the column never jumps (§3.2).
    this.backpack.setProperties({ display: carried.length || !this.compact ? "flex" : "none" });
    if (carried.length > 0) {
      const badge = new Container({
        width: t.slot,
        height: t.slot,
        borderRadius: 999,
        borderWidth: 2,
        borderColor: NAVY,
        backgroundColor: NAVY_DEEP,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      });
      const icon = createMenuIcon("backpack");
      icon.setProperties({ width: "62%", height: "62%", color: YELLOW });
      badge.add(icon);
      host.add(badge);
      for (const item of carried) {
        const slot = new Container({
          width: t.slot,
          height: t.slot,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: NAVY,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        });
        const base = new BoxShadow(6, [{ y: 3, blur: 0, color: NAVY_DEEP, alpha: 1 }]);
        const face = new RadialFace({
          at: [0.5, 0.38],
          inner: "#ffffff",
          middle: ICE,
          mid: 0.72,
          radius: 4,
        });
        slot.add(
          base.content,
          face.content,
          stack(
            new Image({ src: `/art/icons/items/${item}.webp`, width: "80%", height: "80%" }),
            1,
          ),
        );
        this.plateParts.push(base, face);
        host.add(slot);
        this.carryTips.push({ panel: slot, item });
        this.infoControl(slot, () => items[item].name);
      }
    }
    // The 出发 emblem: the type crest in a navy-deep disc with a yellow inner ring.
    for (const child of this.launchEmblem.children.slice()) child.removeFromParent();
    const emblem = new Image({
      src: `/art/icons/crests/${type}.webp`,
      width: "72%",
      height: "72%",
    });
    this.emblemImage = emblem;
    this.launchEmblem.add(emblem);
    this.applySizes();
    this.repaint();
  }

  private infoControl(panel: Container, tip: () => string): void {
    panel.setProperties({
      minHeight: this.stage.viewport.minTarget,
      minWidth: this.stage.viewport.minTarget,
    });
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
        panel.setProperties({ borderColor: (focused && focusVisible) || hovered ? BLUE : NAVY }),
      update() {},
      dispose() {},
    };
    this.controls.push(control);
  }

  // ── State ──────────────────────────────────────────────────────────────────────────────────

  update(state: LobbyState): void {
    const changed = state.progress !== this.progress;
    this.progress = state.progress;
    this.balance.set(state.progress.stardust);
    if (state.pick.starter !== this.selected) {
      this.selected = state.pick.starter;
      const form = starters[this.selected].stages[0].form;
      this.scene?.show(form.id, form.types[0]!);
      this.buildPartner();
    } else if (changed) this.buildPartner();
    this.difficulty = state.pick.difficulty;
    this.map = "forest";
    this.mapName.setProperties({ text: "6 关探险" });
    this.repaint();
  }

  /** Before the first screen's text has arrived only the scene shows (the boot screen). */
  setRevealed(revealed: boolean): void {
    if (revealed === this.revealed) return;
    this.revealed = revealed;
    this.stage.root.visible = revealed;
    this.scene?.setCovered(this.covered || !revealed);
    this.stage.invalidate();
  }

  /** A window or screen lies over the lobby: its scene and loops hold still. */
  setCovered(covered: boolean): void {
    if (covered === this.covered) return;
    this.covered = covered;
    this.scene?.setCovered(covered || !this.revealed);
  }

  private repaint(): void {
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
    this.placed = "";
    this.repaint();
  }

  private colW(): number {
    const v = this.stage.viewport;
    const vw = v.width;
    const preferred = this.compact
      ? Math.min(340, Math.max(296, Math.round(0.38 * vw)))
      : Math.min(420, Math.max(360, Math.round(0.31 * vw)));
    return preferred;
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

  /** §3 sizes for the current viewport. */
  private applySizes(): void {
    const v = this.stage.viewport;
    const t = tokens(this.compact);
    const pad = this.pads();
    const colW = this.colW();
    this.topBar.setProperties({
      positionLeft: pad.left,
      positionRight: pad.right,
      positionTop: pad.top,
      // At least the touch minimum (a 44 host px key at 80% is 55 units): the row stays centred.
      height: Math.max(t.bar, v.minTarget),
      gap: t.gap,
    });
    this.mark.setProperties({ width: this.compact ? 36 : 48, height: this.compact ? 36 : 48 });
    this.word.setProperties({ fontSize: this.compact ? 22 : 30 });
    for (const button of this.buttons) button.fitTouch();
    const side = Math.max(t.switchKey, v.minTarget);
    for (const button of [this.prev, this.next])
      button.panel.setProperties({ minWidth: side, minHeight: side });
    this.legal.setProperties({
      positionLeft: pad.left,
      positionTop: pad.top + Math.max(t.bar, v.minTarget) + 16,
      width: Math.max(160, v.width - pad.left - pad.right - colW - t.zoneGap),
    });
    this.column.setProperties({ positionRight: pad.right, width: colW });
    for (const node of [
      this.ribbon,
      this.tags,
      this.roster,
      this.backpack,
      this.tray,
      this.mapSign,
      this.segmentsRow,
      this.launch,
    ])
      node.setProperties({ flexShrink: 0 });
    this.ribbon.setProperties({
      height: t.ribbon,
      marginLeft: t.ribbonIndent,
      marginRight: 6,
      paddingLeft: this.compact ? 16 : 22,
      paddingRight: this.compact ? 12 : 18,
      gap: 12,
    });
    this.tags.setProperties({ marginTop: t.tagsGap, marginLeft: this.compact ? 6 : 8, gap: 8 });
    const medal = Math.min(t.medalMax, Math.floor((colW - 12 - 3 * t.medalGap) / 4));
    const medalSide = Math.max(medal, v.minTarget);
    this.roster.setProperties({ marginTop: t.rosterGap, paddingTop: 3 });
    for (const { panel, ball, badge } of this.medals) {
      panel.setProperties({ width: medalSide, height: medalSide });
      ball.content.setProperties({ width: this.compact ? 18 : 22, height: this.compact ? 18 : 22 });
      badge.setProperties({ width: this.compact ? 20 : 24, height: this.compact ? 20 : 24 });
    }
    this.backpack.setProperties({
      marginTop: 14,
      marginLeft: 4,
      height: Math.max(44, v.minTarget),
    });
    for (const control of this.controls)
      if (control.kind === "info")
        control.panel.setProperties({ minWidth: v.minTarget, minHeight: v.minTarget });
    this.tray.setProperties({
      marginTop: t.trayGap,
      padding: t.trayPad,
      paddingBottom: t.trayPad + 6,
      gap: t.trayPad,
    });
    for (const box of this.segmentBoxes)
      box.setProperties({ height: Math.max(t.segment, v.minTarget) });
    const emblem = this.compact ? 40 : 56;
    const launchH = Math.max(t.launch, v.minTarget);
    this.launch.setProperties({
      height: launchH,
      paddingLeft: (this.compact ? 12 : 16) + slantOf(launchH) / 2,
      paddingRight: (this.compact ? 14 : 22) + slantOf(launchH) / 2,
    });
    this.launchEmblem.setProperties({ width: emblem, height: emblem });
    const word = this.compact ? 26 : 36;
    // The tracking trails the last glyph: the same indent before the first keeps the word centred.
    this.launchText.setProperties({
      fontSize: word,
      letterSpacing: word * 0.24,
      paddingLeft: word * 0.24,
    });
    this.arrowBox.setProperties({ gap: this.compact ? 2 : 3 });
    for (const wedge of this.arrows)
      wedge.setProperties({ width: this.compact ? 12 : 16, height: this.compact ? 17 : 22 });
    const tile = this.compact ? 30 : 40;
    this.mapSign.setProperties({ height: tile, gap: 4 });
    for (const { panel } of this.mapTiles)
      panel.setProperties({ flexGrow: 1, flexBasis: 0, height: tile });
    this.mapName.setProperties({ fontSize: this.compact ? 12 : 15, letterSpacing: 0 });
    this.legalLaid = "";
  }

  /** After layout: the legal line's breaks, then the column's bottom, the scene and ‹ ›. */
  private place(): void {
    const v = this.stage.viewport;
    const t = tokens(this.compact);
    const pad = this.pads();
    const font = this.legalText.fontSignal.value;
    if (font) {
      const size = this.compact ? 10 : 11;
      const room = Math.max(160, v.width - pad.left - pad.right - this.colW() - t.zoneGap) - 16;
      const key = `${room},${size}`;
      if (key !== this.legalLaid) {
        this.legalLaid = key;
        this.legal.setProperties({ justifyContent: "flex-start" });
        this.legalText.setProperties({
          fontSize: size,
          textAlign: "left",
          text:
            textWidth(LEGAL_NOTICE, size, font) <= room
              ? LEGAL_NOTICE
              : balanceLines(LEGAL_NOTICE, room, size, font),
        });
      }
    }
    const legalH = this.legalText.size.value?.[1];
    if (legalH === undefined) return;
    const contentBottom = v.height - pad.bottom;
    const colW = this.colW();
    const colX = v.width - pad.right - colW;
    // The cards (§3.1) need the column's height and the top bar's balance and brand as laid out.
    const colH = this.column.size.value?.[1];
    const balanceM = this.balance.root.globalMatrix.value,
      balanceS = this.balance.root.size.value,
      brandM = this.brand.globalMatrix.value,
      brandS = this.brand.size.value;
    if (colH === undefined || !balanceM || !balanceS || !brandM || !brandS) return;
    const balanceLeft = balanceM.elements[12]! - this.stage.camera.left - balanceS[0] / 2;
    const brandRight = brandM.elements[12]! - this.stage.camera.left + brandS[0] / 2;
    const key = [v.width, v.height, v.scale, legalH, colW, this.compact, colH, balanceLeft].join(
      ",",
    );
    if (key === this.placed) return;
    this.placed = key;
    this.column.setProperties({ positionBottom: pad.bottom });
    const barBottom = pad.top + Math.max(t.bar, v.minTarget);
    const inset = this.compact ? 2 : 4;
    const over = (h: number) => 0.1 * h + inset + 0.066 * h;
    let cardH = this.compact ? 56 : 96;
    const cardGap = this.compact ? 8 : 14;
    const colTop = contentBottom - colH;
    this.cardsInBar = colTop - barBottom - over(cardH) - cardH - cardGap < 0;
    let top: number;
    if (!this.cardsInBar) {
      const w = (colW - cardGap) / 2;
      top = barBottom + over(cardH) + (this.compact ? 2 : 4);
      this.cards.forEach((card, i) => card.place(colX + i * (w + cardGap), top, w, cardH, inset));
    } else {
      // In the top bar, left of the balance (844×390, 760×427).
      cardH = Math.max(44, v.minTarget);
      const w = Math.min(150, (balanceLeft - 12 - brandRight - 16 - 8) / 2);
      top = pad.top + over(cardH) + 1;
      const right = balanceLeft - 12;
      this.cards.forEach((card, i) =>
        card.place(right - w - (1 - i) * (w + 8), top, w, cardH, inset),
      );
    }
    const headBottom = this.cardsInBar ? top + cardH : barBottom;
    this.column.setProperties({
      overflow: "visible",
    });
    // The hero zone (§3.4).
    const zone = {
      x: pad.left,
      y: headBottom + (this.compact ? 4 : 12),
      r: colX - t.zoneGap,
      b: contentBottom,
    };
    this.zone = zone;
    const zoneW = zone.r - zone.x,
      zoneH = zone.b - zone.y;
    const podW = Math.min(zoneW * 0.62, zoneH * 1.05);
    const podH = (podW * 406) / 1200;
    const cx = zone.x + zoneW / 2;
    const podTop = zone.b - podH;
    const feetY = podTop + 0.33 * podH;
    const heroH = Math.min((feetY - zone.y) * 0.82, zoneW * 0.82);
    const side = Math.max(t.switchKey, v.minTarget);
    const offset = Math.min(podW / 2 + (this.compact ? 6 : 10) + side / 2, zoneW / 2 - side / 2);
    const cy = podTop + 0.45 * podH;
    this.prev.panel.setProperties({
      positionLeft: cx - offset - side / 2,
      positionTop: cy - side / 2,
    });
    this.next.panel.setProperties({
      positionLeft: cx + offset - side / 2,
      positionTop: cy - side / 2,
    });
    const k = v.scale;
    this.scene?.setLayout({
      width: v.width * k,
      height: v.height * k,
      podium: { x: (cx - podW / 2) * k, y: podTop * k, w: podW * k, h: podH * k },
      feet: { x: cx * k, y: feetY * k },
      heroH: heroH * k,
    });
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
    for (let i = this.controls.length - 1; i >= 0; i--) {
      const control = this.controls[i]!;
      if (
        ["info", "tile", "map", "difficulty", "start"].includes(control.kind) &&
        !this.contains(this.column, x, y)
      )
        continue;
      if (this.contains(control.panel, x, y)) return i;
    }
    return -1;
  }

  focus(index: number): void {
    if (index === this.focused) return;
    this.focused = index;
    this.repaint();
  }

  hover(index: number | null): void {
    this.hovered = index ?? -1;
    this.repaint();
  }

  setPressed(index: number | null): void {
    this.pressed = index ?? -1;
    this.repaint();
  }

  activate(index: number): void {
    if (this.departing) return;
    this.controls[index]?.activate();
  }

  /** The wheel over the hero zone switches partner, one per step. */
  scroll(delta: number): void {
    const at = this.pointer;
    if (this.departing) return;
    if (currentInputMode().kind === "gamepad" || (at && this.contains(this.column, at.x, at.y)))
      return;
    if (!at || !this.inZone(at.x, at.y)) return;
    this.wheel += delta;
    if (Math.abs(this.wheel) < WHEEL_STEP) return;
    this.cycle(this.wheel > 0 ? 1 : -1);
    this.wheel = 0;
  }

  setFocusVisible(visible: boolean): void {
    if (visible === this.focusVisible) return;
    this.focusVisible = visible;
    this.repaint();
  }

  setCoarsePointer(coarse: boolean): void {
    this.coarse = coarse;
  }

  /** Opens on 出发, the lobby's one action. */
  focusStart(): void {
    this.focus(this.index("start"));
  }

  private index(kind: ControlKind): number {
    return this.controls.findIndex((c) => c.kind === kind);
  }

  private group(control: Control): Control[] | null {
    return control.kind === "tile"
      ? this.tiles
      : control.kind === "difficulty"
        ? this.segments
        : null;
  }

  private picked(list: Control[], index: number): number {
    return this.controls.indexOf(list.find((c) => c.index === index)!);
  }

  /** Tab stops (§4): 设置, 研究所, 图鉴, ‹, ›, the picked
   *  partner, the picked difficulty, 出发. */
  private tabStops(): number[] {
    return [
      this.index("settings"),
      ...(this.toggleFullscreen ? [this.index("fullscreen")] : []),
      this.index("multiplayer"),
      this.index("lab"),
      this.index("codex"),
      this.index("prev"),
      this.index("next"),
      this.picked(this.tiles, starterOrder.indexOf(this.selected)),
      ...this.controls.flatMap((control, index) => (control.kind === "info" ? [index] : [])),
      this.picked(this.segments, this.difficulty),
      this.index("start"),
    ];
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
    const stops = this.tabStops();
    return this.tabAt(stops) === (shift ? 0 : stops.length - 1);
  }

  physicalKey(event: UiKey): boolean {
    if (!["KeyQ", "KeyE"].includes(event.code)) return false;
    if (!this.departing) {
      this.touchTip = -1;
      this.cycle(event.code === "KeyQ" ? -1 : 1);
    }
    return true;
  }

  navigate(action: NavigationAction): boolean {
    if (this.touchTip >= 0) this.touchTip = -1;
    if (this.departing) return true;
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

  /** §4 arrows: 出发 switches partner sideways; the groups pick; up and down walk the column. */
  private arrow(current: Control, action: NavigationDirection): void {
    const sideways = action === "left" || action === "right";
    const step = action === "left" || action === "up" ? -1 : 1;
    const tile = this.picked(this.tiles, starterOrder.indexOf(this.selected));
    const segment = this.picked(this.segments, this.difficulty);
    const infos = this.controls.flatMap((control, index) =>
      control.kind === "info" ? [index] : [],
    );
    const top =
      current.kind === "lab" ||
      current.kind === "codex" ||
      current.kind === "settings" ||
      current.kind === "multiplayer" ||
      current.kind === "fullscreen";
    const group = this.group(current);
    if (sideways) {
      if (group) {
        // A radio arrow moves focus and picks; a locked option takes the focus only.
        const at = group.indexOf(current);
        const next = group[(at + step + group.length) % group.length]!;
        this.focus(this.controls.indexOf(next));
        next.activate();
      } else if (current.kind === "info") {
        const at = infos.indexOf(this.focused);
        this.focus(infos[(at + step + infos.length) % infos.length]!);
      } else if (top) {
        // The cards' row (and, in the top bar, 设置 right of them): ← → walk it, no wrap.
        const row = [this.index("lab"), this.index("codex")];
        row.push(this.index("multiplayer"), this.index("settings"));
        if (this.toggleFullscreen) row.push(this.index("fullscreen"));
        const at = row.indexOf(this.focused);
        if (at >= 0) this.focus(row[Math.min(row.length - 1, Math.max(0, at + step))]!);
      } else if (current.kind === "prev" || current.kind === "next")
        this.focus(this.index(current.kind === "prev" ? "next" : "prev"));
      else this.cycle(step as -1 | 1);
      return;
    }
    const up = action === "up";
    const targets: Record<ControlKind, [number, number]> = {
      start: [segment, this.focused],
      difficulty: [infos.at(-1) ?? tile, this.index("start")],
      tile: [this.index("next"), infos[0] ?? segment],
      info: [tile, segment],
      prev: [this.index("lab"), tile],
      next: [this.index("codex"), tile],
      lab: [this.cardsInBar ? this.focused : this.index("settings"), this.index("next")],
      codex: [this.cardsInBar ? this.focused : this.index("settings"), this.index("next")],
      multiplayer: [this.index("settings"), this.index("next")],
      fullscreen: [this.focused, this.index("settings")],
      settings: [this.focused, this.cardsInBar ? this.index("next") : this.index("lab")],
    };
    this.focus(targets[current.kind][up ? 0 : 1]);
  }

  pointerDown(x: number, y: number, touch: boolean): void {
    const index = this.tipTarget(x, y);
    if (this.touchTip >= 0 && index !== this.touchTip) this.touchTip = -1;
    this.tipPress = touch && index >= 0 ? { index, at: this.elapsed, x, y, fired: false } : null;
    this.swipe = this.hit(x, y) < 0 && this.inZone(x, y) ? { x, y, done: false } : null;
  }

  pointerMove(x: number, y: number): void {
    this.pointer = { x, y };
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

  pointerUp(touch: boolean): boolean {
    this.swipe = null;
    const press = this.tipPress;
    this.tipPress = null;
    if (!press || !touch) return false;
    if (press.fired) return true;
    if (this.tipFor(press.index).locked || this.controls[press.index]?.kind === "info")
      this.touchTip = this.touchTip === press.index ? -1 : press.index;
    return false;
  }

  /** Tip targets: controls, the balance, then the backpack's items. */
  private tipTarget(x: number, y: number): number {
    const control = this.hit(x, y);
    if (control >= 0) {
      const c = this.controls[control]!;
      return c.kind === "tile" || c.tip() ? control : -1;
    }
    if (this.contains(this.balance.root, x, y)) return this.controls.length;
    const item = this.carryTips.findIndex((tip) => this.contains(tip.panel, x, y));
    return item >= 0 ? this.controls.length + 1 + item : -1;
  }

  private tipFor(index: number): {
    panel: Container | null;
    text: string;
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
        column: ["tile", "difficulty", "map", "info"].includes(control.kind),
      };
    }
    if (index === this.controls.length)
      return { panel: this.balance.root, text: CURRENCY_NAME, locked: false, column: false };
    const tip = this.carryTips[index - this.controls.length - 1];
    return tip
      ? { panel: tip.panel, text: items[tip.item].name, locked: false, column: true }
      : none;
  }

  afterLayout(deltaMs: number): void {
    this.elapsed += deltaMs;
    this.place();
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
    const shown =
      this.touchTip >= 0 ? this.touchTip : this.hoveredTip >= 0 ? this.hoveredTip : keyed;
    const tip = this.tipFor(shown);
    this.tooltip.show(
      tip.text ? tip.panel : null,
      tip.text,
      tip.column ? "left" : "auto",
      tip.column ? this.column : null,
      [this.prev.panel, this.next.panel],
    );
    this.tooltip.update();
    for (const control of this.controls) control.update(deltaMs);
    for (const button of this.buttons) button.update(deltaMs);
    for (const part of [...this.disposables, ...this.plateParts]) part.update?.();
    this.launchPlate.update();
    this.animateLaunch(deltaMs);
  }

  /** 出发's states (§3.3): idle wedges light in turn on the 15Hz clock; lit, the pattern drifts. */
  private animateLaunch(deltaMs: number): void {
    const lit = this.lit.value,
      down = this.press.value;
    const hold = this.covered || !this.revealed;
    if (lit > 0 && !hold) this.patternPhase = (this.patternPhase + deltaMs / 24000) % 1;
    const tick = idleTicked(15);
    this.launchPlate.set({
      depth: 6 + 2 * lit * (1 - down) - 6 * down,
      strength: 0.55 + 0.45 * lit,
      phase: this.patternPhase,
      inset: down,
    });
    // Pose and placement change only with the state or the layout; setting them again every frame
    // would mark the stage changed and redraw the canvas each frame (DESIGN 空闲循环).
    const pose = [lit, down, this.spin.value].join(",");
    if (pose !== this.launchPose) {
      this.launchPose = pose;
      this.launch.setProperties({
        transformTranslateY: -2 * lit * (1 - down) + 6 * down,
        transformScaleX: 1 + 0.012 * down,
        transformScaleY: 1 - 0.03 * down,
      });
      this.emblemImage?.setProperties({ transformRotateZ: -360 * this.spin.value });
      this.arrowBox.setProperties({ transformTranslateX: 6 * lit });
    }
    const easing = lit > 0 && lit < 1;
    // Idle loops step on the 15Hz clock only, so the lobby redraws with its scene, not every frame.
    if (hold || !(tick || easing)) return;
    // The wedges light in turn, 0.4 → 1 (1.2s; 0.6s and all lit under a pointer or focus).
    const period = lit > 0.5 ? 600 : 1200;
    const at = ((this.elapsed % period) / period) * 3;
    this.arrows.forEach((wedge, i) => {
      const on =
        lit > 0.5 ? 1 : Math.max(0.4, 1 - 0.6 * Math.min(Math.abs(at - i), 3 - Math.abs(at - i)));
      fade(wedge, on);
    });
    this.stage.invalidate();
  }

  /** Context lost: the stage (the image store releases and restores the shared portraits). */
  releaseUploads(): void {
    this.stage.releaseUploads();
  }

  dispose(): void {
    for (const control of this.controls) control.dispose();
    for (const part of [...this.plateParts, ...this.disposables]) part.dispose();
    for (const button of this.buttons) button.dispose();
    this.launchPlate.dispose();
    this.balance.dispose();
    this.tooltip.dispose();
    this.stage.dispose();
  }
}
