import type { UiKey } from "../../platform/ui-surface";
import { isNavigationDirection, type NavigationAction } from "../../platform/input";
import { gridStep } from "./grid-nav";
import { Container, Image, Text, type FontFamilies } from "@pmndrs/uikit";
import { Matrix4, Vector3 } from "three";
import { getAudio } from "../../audio/engine";
import type { SessionState } from "../../network/session";
import type { LobbyPick } from "../../lobbyPick";
import { difficultyLock, starterLock, trainerLock } from "../../run/locks";
import { starterUnlocked, type Progress } from "../../run/progress";
import { difficulties, type Difficulty } from "../../run/sim/content/difficulties";
import { starterOrder, starters, type StarterId } from "../../run/sim/content/lines/index";
import { trainerArt, trainerOrder, trainers, trainerUnlocked } from "../../trainers";
import { BallBadge } from "./ball";
import { GameButton } from "./game-button";
import { InnerScreenFrame } from "./inner-screen";
import { RouteMap } from "./route-map";
import { ROUTE_TIERS } from "../../run/sim/content/campaign";
import { UiStage } from "./stage";
import { stack, fade } from "./layer";
import { EASE, LIFT, POP, SNAP } from "./motion";
import { createMenuIcon } from "./icons";
import { currentInputMode } from "./input-glyph";
import { themeColors } from "./run-theme";
import { segmentTray, SegmentFace } from "./segment-face";
import { RING_ROOM, SlantPlate } from "./slant-plate";
import { slantTag } from "./tag";
import { HARD_SHADOW, RADIUS_INNER, ui } from "./tokens";
import { GpuTooltip } from "./tooltip";
import { MultiplayerSeat } from "./multiplayer-seat";
import { seatView } from "./multiplayer-view";
import type { UiInsets } from "./viewport";

const DANGER = "#a83243";
/** The route every expedition takes (lobby's route name). */
const ROUTE = `${ROUTE_TIERS.length} 关探险`;

export interface MultiplayerCallbacks {
  rejoin?: { code: string; action: () => void };
  create: () => void;
  join: (code: string) => void;
  start: () => void;
  /** Drops the current connection; the page stays. */
  cancel: () => void;
  /** Leaves the page. */
  close: () => void;
  settings: () => void;
  copy: (code: string) => void;
  /** The player's own choice changed (the difficulty only as the host, or before a room). */
  pick: (next: LobbyPick) => void;
}
type Page = "menu" | "room" | "error";
/** Which part of the page a control belongs to; only the shown parts take input. */
type Group = Page | "frame" | "pick" | "mission" | "launch";
interface PaintState {
  hovered: boolean;
  focused: boolean;
  focusVisible: boolean;
  pressed: boolean;
}
interface Control {
  group: Group;
  panel: Container;
  action(): void;
  /** Shown but not usable now (a key still waiting, a locked difficulty). */
  enabled(): boolean;
  tip(): string | null;
  /** Its tip says why it does nothing (a touch tap shows it). */
  locked?(): boolean;
  paint(state: PaintState): void;
  update(deltaMs: number): void;
  fitTouch(): void;
  dispose(): void;
}

/**
 * 联机: a page past the lobby (the shared frame: back, the 联机 plate, settings). Before a room it
 * shows two cards: the player's partner over 创建房间 (and 重返), and the room code cells over
 * 加入房间 beside a keypad (digits type straight in). In a room the ball-red code
 * plate (code, 复制, head count) heads the page, the four seats fill it, and a dock at the foot holds
 * the player's own trainer and partner and, as in the lobby, the route over the difficulty and
 * 出发 (a guest sees the host's difficulty). All nodes are built once; network updates and input
 * only change their properties.
 */
export class GpuMultiplayer {
  readonly stage = new UiStage();
  readonly minLayout = { width: 760, height: 360 };
  private readonly frame: InnerScreenFrame;
  private readonly callbacks: MultiplayerCallbacks;
  private readonly progress: Progress;
  private pick: LobbyPick;
  private readonly body = new Container({ flexGrow: 1, minHeight: 0, flexDirection: "column" });
  private readonly stageArea = new Container({
    flexGrow: 1,
    minHeight: 0,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  });
  private readonly pages: Record<Page, Container> = {
    menu: new Container({ flexDirection: "row", alignItems: "stretch" }),
    room: new Container({
      width: "100%",
      flexGrow: 1,
      minHeight: 0,
      flexDirection: "row",
      alignItems: "stretch",
      gap: 16,
    }),
    error: new Container({ flexDirection: "column", alignItems: "center", gap: 28 }),
  };
  /** The dock: trainer | partner | route over difficulty and 出发. */
  private readonly dock = new Container({ flexDirection: "row", alignItems: "stretch" });
  private readonly dockPlate: SlantPlate;
  private readonly trainerGrid = new Container({ flexDirection: "row", flexWrap: "wrap" });
  private readonly roster = new Container({ flexDirection: "row", flexWrap: "wrap" });
  private readonly divider = new Container({ width: 2, backgroundColor: ui.line, flexShrink: 0 });
  private readonly headers: Text[] = [];
  private readonly missionGroup = new Container({
    flexDirection: "column",
    alignItems: "flex-end",
    justifyContent: "space-between",
    flexGrow: 1,
    flexShrink: 0,
  });
  /** Its right edge meets 出发's plate, which sits RING_ROOM inside the button's box. */
  private readonly route = new Container({
    flexDirection: "row",
    alignItems: "center",
    marginRight: RING_ROOM,
  });
  private readonly routeName: Text;
  private readonly routeMap = new RouteMap();
  private readonly go = new Container({ flexDirection: "row", alignItems: "center", gap: 12 });
  private readonly tray = segmentTray();
  private readonly hostMission: ReturnType<typeof slantTag>;
  private readonly launchWrap = new Container({ flexShrink: 0 });
  private readonly controls: Control[] = [];
  private readonly digits: Container[] = [];
  private readonly digitText: Text[] = [];
  private readonly errorChip = new Text({
    text: "",
    fontSize: 14,
    fontWeight: 800,
    color: DANGER,
    whiteSpace: "pre",
  });
  private readonly errorText = new Text({ text: "", fontSize: 22, fontWeight: 800, color: DANGER });
  private readonly codeLabel = new Text({
    text: "——————",
    fontWeight: 900,
    color: ui.white,
    whiteSpace: "pre",
    wordBreak: "keep-all",
  });
  private readonly codeCaption = new Text({
    text: "房间码",
    fontWeight: 800,
    color: ui.white,
    opacity: 0.8,
    whiteSpace: "pre",
  });
  private readonly count = slantTag("0/4", { size: 13, upright: true });
  /** Centres the code plate in the top line. */
  private readonly roomInfo = new Container({
    flexGrow: 1,
    flexDirection: "row",
    justifyContent: "center",
    minWidth: 0,
  });
  private readonly codeBox = new Container({
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  });
  private readonly codePlate: SlantPlate;
  private readonly seats: MultiplayerSeat[];
  private readonly link = new Container({
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  });
  private readonly linkCheck = createMenuIcon("check");
  private readonly linkSpinner = createMenuIcon("spinner");
  private readonly launchSpinner = createMenuIcon("spinner");
  private readonly joinSpinner = createMenuIcon("spinner");
  private readonly tooltip: GpuTooltip;
  private readonly point = new Vector3();
  private readonly inverse = new Matrix4();
  private readonly entrance = { opacity: 0, y: 10 };
  private readonly pulse = { scale: 1 };
  private readonly errorPose = { opacity: 1 };
  private readonly launch: GameButton;
  private readonly joinKey: number;
  /** One past the last keypad key; 加入房间 and the keypad sit in [joinKey, entryEnd). */
  private readonly entryEnd: number;
  private readonly joinButton: GameButton;
  private readonly joinCard: Container;
  private readonly keys: { panel: Container; span: number }[] = [];
  private readonly cards: { content: Container; plate: SlantPlate }[] = [];
  /** The player's partner over 创建房间 (a picture, not a control). */
  private readonly partner: BallBadge;
  private readonly retry: GameButton;
  private readonly createButton: GameButton;
  private readonly trainerTiles: Container[] = [];
  private readonly badges: BallBadge[] = [];
  private state: SessionState | null = null;
  private entering = false;
  private code = "";
  private page: Page = "menu";
  private focused = -1;
  private focusVisible = false;
  private hovered = -1;
  private touchPress = -1;
  private touchTip = -1;
  private pressed = -1;
  private ready = false;
  private clock = 0;
  private idle = 0;
  private lastError = "";

  constructor(
    fonts: FontFamilies,
    callbacks: MultiplayerCallbacks,
    progress: Progress,
    pick: LobbyPick,
  ) {
    this.callbacks = callbacks;
    this.progress = progress;
    this.pick = pick;
    this.stage.root.setProperties({ fontFamilies: fonts, flexDirection: "column", color: ui.ink });
    this.frame = new InnerScreenFrame(this.stage, "联机");
    this.tooltip = new GpuTooltip(this.stage);
    this.frame.extra.add(this.roomInfo);
    this.stage.root.add(this.frame.topline, this.frame.body);
    this.frame.body.add(this.body);
    this.keyed("frame", this.frame.back, () => this.back());
    this.keyed("frame", this.frame.settings, () => {
      getAudio().sfx("ui-confirm");
      callbacks.settings();
    });

    // ── Landing: the create card (the player's partner over 创建房间, 重返) beside the join card
    // (the code cells over 加入房间, the keypad) ──
    const createCard = this.card("column");
    createCard.setProperties({ alignItems: "center", justifyContent: "center" });
    const form = starters[pick.starter].stages[0].form;
    this.partner = new BallBadge(this.stage.motion, () => this.stage.invalidate(), 96);
    this.partner.portrait(`/art/portraits/${form.id}.webp`);
    this.partner.set({ selected: true, type: themeColors(form.types[0]!).theme });
    createCard.add(stack(this.partner.panel, 1));
    this.createButton = this.button(
      "menu",
      createCard,
      "创建房间",
      () => this.create(),
      true,
      "cta",
      undefined,
      () => !this.joining(),
    );
    if (callbacks.rejoin) {
      const rejoin = callbacks.rejoin;
      this.button("menu", createCard, `重返 ${rejoin.code}`, rejoin.action);
    }
    const joinCard = this.card("row");
    this.joinCard = joinCard;
    // The cells' top meets the keypad's first row, 加入房间's foot its last; 房间码 sits above.
    const entryLeft = new Container({
      flexDirection: "column",
      justifyContent: "space-between",
      flexShrink: 0,
    });
    const caption = new Container({
      positionType: "absolute",
      positionBottom: "100%",
      positionLeft: 0,
      marginBottom: 6,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    });
    caption.add(
      new Text({ text: "房间码", fontSize: 14, fontWeight: 800, color: ui.muted }),
      this.errorChip,
    );
    const codeRow = new Container({ flexDirection: "row", gap: 6 });
    for (let i = 0; i < 6; i++) {
      const cell = new Container({
        flexShrink: 0,
        borderWidth: 2,
        borderColor: ui.line,
        borderRadius: RADIUS_INNER,
        backgroundColor: ui.white,
        alignItems: "center",
        justifyContent: "center",
      });
      const text = new Text({ text: "", fontWeight: 800, color: ui.ink });
      cell.add(text);
      codeRow.add(cell);
      this.digits.push(cell);
      this.digitText.push(text);
    }
    const cellsBox = new Container({ flexShrink: 0 });
    cellsBox.add(stack(caption, 1), stack(codeRow, 1));
    entryLeft.add(stack(cellsBox, 1));
    this.joinButton = this.button(
      "menu",
      entryLeft,
      "加入房间",
      () => this.submit(),
      true,
      "cta",
      undefined,
      () => !this.joining() && this.code.length === 6,
    );
    this.joinKey = this.controls.length - 1;
    this.joinSpinner.setProperties({ width: 16, height: 16, display: "none" });
    this.joinButton.panel.add(stack(this.joinSpinner, 2));
    const keypad = new Container({ flexDirection: "column", gap: 6, flexShrink: 0 });
    for (const row of ["123", "456", "789", "0x"]) {
      const keys = new Container({ flexDirection: "row", gap: 6 });
      for (const key of row) {
        const button = this.button(
          "menu",
          keys,
          key === "x" ? "" : key,
          () => (key === "x" ? this.erase() : this.digit(key)),
          false,
          "small",
          key === "x" ? "erase" : undefined,
          () => !this.joining(),
        );
        // 0 takes two columns, the erase key the third.
        this.keys.push({ panel: button.panel, span: key === "0" ? 2 : 1 });
      }
      keypad.add(keys);
    }
    this.entryEnd = this.controls.length;
    joinCard.add(stack(entryLeft, 1), stack(keypad, 1));
    this.pages.menu.add(createCard, joinCard);

    // ── Room: four seats ──
    this.seats = [0, 1, 2, 3].map((slot) => new MultiplayerSeat(this.stage, slot));
    this.pages.room.add(...this.seats.map((seat) => seat.root));
    this.linkCheck.setProperties({ width: 22, height: 22, color: ui.white });
    this.linkSpinner.setProperties({ width: 18, height: 18, color: ui.white });
    this.link.add(this.linkCheck, this.linkSpinner);
    this.codePlate = new SlantPlate(this.codeBox, { fill: ui.ball, upright: true });
    this.codePlate.set({ depth: HARD_SHADOW.offset });
    this.codeBox.add(
      this.codePlate.content,
      stack(this.codeCaption, 1),
      stack(this.codeLabel, 1),
      stack(this.link, 1),
      stack(this.count.tag, 1),
    );
    this.button("room", this.codeBox, "复制", () => {
      const code = this.state?.room?.code;
      if (!code) return;
      getAudio().sfx("ui-confirm");
      callbacks.copy(code);
    });
    this.roomInfo.add(this.codeBox);

    // ── Error ──
    const errorRow = new Container({ flexDirection: "row", alignItems: "center", gap: 14 });
    const warning = createMenuIcon("danger");
    warning.setProperties({ width: 40, height: 40, color: DANGER });
    errorRow.add(warning, this.errorText);
    this.pages.error.add(errorRow);
    this.retry = this.button("error", this.pages.error, "返回", () =>
      this.state?.self === 0 && !this.entering ? this.create() : this.menu(),
    );
    this.retry.panel.setProperties({ width: 160 });

    for (const page of Object.values(this.pages)) this.stageArea.add(stack(page, 1));

    // ── The dock: the player's own trainer and partner, then the mission and 出发 ──
    this.dockPlate = new SlantPlate(this.dock, {
      fill: ui.white,
      border: { color: ui.ink, width: 2 },
      upright: true,
    });
    this.dockPlate.set({ depth: HARD_SHADOW.offset });
    this.buildTrainers();
    for (const id of starterOrder) this.tile(id);
    this.routeName = this.header(ROUTE);
    this.headers.pop();
    this.route.add(this.routeName);
    this.route.add(this.routeMap.panel);
    for (const [value, def] of Object.entries(difficulties))
      this.segment(Number(value) as Difficulty, def.name);
    this.hostMission = slantTag(difficulties[pick.difficulty].name, {
      face: ui.ink,
      ink: ui.white,
      size: 15,
    });
    this.launch = this.button("launch", this.launchWrap, "出发", callbacks.start, true, "normal");
    this.launchSpinner.setProperties({ width: 18, height: 18, display: "none" });
    this.launch.panel.add(stack(this.launchSpinner, 2));
    this.go.add(this.tray.tray, stack(this.hostMission.tag, 1), this.launchWrap);
    this.missionGroup.add(stack(this.route, 1), this.go);
    this.dock.add(
      this.dockPlate.content,
      stack(this.group("训练师", this.trainerGrid), 1),
      stack(this.divider, 1),
      stack(this.group("伙伴", this.roster), 1),
      stack(this.missionGroup, 1),
    );

    this.body.add(this.stageArea, stack(this.dock, 1));
    this.refresh();
    this.stage.motion.animate(
      this.entrance,
      { opacity: 1, y: 0 },
      220,
      () => {
        fade(this.body, this.entrance.opacity).setProperties({
          transformTranslateY: this.entrance.y,
        });
        this.stage.invalidate();
      },
      EASE,
    );
  }

  // ── Builders ───────────────────────────────────────────────────────────────────────────────

  private add(control: Control): Control {
    this.controls.push(control);
    return control;
  }

  /** A shared key (GameButton) as a control. */
  private keyed(
    group: Group,
    button: GameButton,
    action: () => void,
    enabled: () => boolean = () => true,
  ): void {
    this.add({
      group,
      panel: button.panel,
      action,
      enabled,
      tip: () => null,
      paint: ({ hovered, focused, focusVisible, pressed }) => {
        button.setDisabled(!enabled());
        button.setHovered(hovered);
        button.setFocused(focused);
        button.setFocusVisible(focusVisible);
        button.setPressed(pressed);
      },
      update: (deltaMs) => button.update(deltaMs),
      fitTouch: () => button.fitTouch(),
      dispose: () => {
        if (group !== "frame") button.dispose();
      },
    });
  }

  /** A landing card: white, ink-edged, upright with the hard shadow (as the dock). */
  private card(direction: "row" | "column"): Container {
    const content = new Container({ flexDirection: direction, flexShrink: 0 });
    const plate = new SlantPlate(content, {
      fill: ui.white,
      border: { color: ui.ink, width: 2 },
      upright: true,
    });
    plate.set({ depth: HARD_SHADOW.offset });
    content.add(plate.content);
    this.cards.push({ content, plate });
    return content;
  }

  private button(
    group: Group,
    parent: Container,
    label: string,
    action: () => void,
    primary = false,
    size: "small" | "normal" | "cta" = "small",
    icon?: "erase",
    enabled?: () => boolean,
  ): GameButton {
    const button = new GameButton(this.stage, {
      label,
      tone: primary ? "primary" : "secondary",
      upright: !primary,
      size,
      square: !!icon,
      icon: icon ? createMenuIcon(icon) : undefined,
    });
    parent.add(button.panel);
    this.keyed(group, button, action, enabled);
    return button;
  }

  /** Trainer portraits share the lobby's local unlocks; remote seats show their own identity. */
  /** A dock group's name, in the lobby route name's small muted type. */
  private header(text: string): Text {
    const header = new Text({
      text,
      fontWeight: 800,
      color: ui.muted,
      whiteSpace: "pre",
      wordBreak: "keep-all",
    });
    this.headers.push(header);
    return header;
  }

  private group(name: string, content: Container): Container {
    const group = new Container({ flexDirection: "column", flexShrink: 0 });
    group.add(this.header(name), content);
    return group;
  }

  private buildTrainers(): void {
    for (const id of trainerOrder) {
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
        src: trainerArt(id, trainerUnlocked(this.progress, id) ? "portrait" : "portrait-locked"),
        width: "100%",
        height: "100%",
        borderRadius: 3,
      });
      panel.add(plate.content, stack(portrait, 1));
      this.trainerGrid.add(panel);
      this.trainerTiles.push(panel);
      const pose = { lift: 0 };
      let target = Number.NaN;
      this.add({
        group: "pick",
        panel,
        action: () => this.choose({ trainer: id }),
        enabled: () => this.canPick(),
        locked: () => !trainerUnlocked(this.progress, id),
        tip: () => trainerLock(this.progress, id),
        paint: ({ hovered, focused, focusVisible, pressed }) => {
          const chosen = this.pick.trainer === id;
          plate.set({
            fill: chosen
              ? ui.white
              : trainerUnlocked(this.progress, id)
                ? trainers[id].color
                : ui.line,
            focus: focused && focusVisible ? 1 : 0,
          });
          fade(portrait, this.canPick() || chosen ? 1 : 0.45);
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
        fitTouch: () => {},
        dispose: () => {
          this.stage.motion.cancel(pose);
          plate.dispose();
        },
      });
    }
  }

  /** A partner: its portrait over a Poké Ball, as in the lobby's roster; a locked one is its
   *  silhouette, focusable for its unlock condition but never chosen. */
  private tile(id: StarterId): void {
    const form = starters[id].stages[0].form;
    const type = themeColors(form.types[0]!).theme;
    const badge = new BallBadge(this.stage.motion, () => this.stage.invalidate(), 56);
    badge.portrait(`/art/portraits/${form.id}.webp`);
    this.roster.add(badge.panel);
    this.badges.push(badge);
    const lock = () => starterLock(this.progress, id);
    this.add({
      group: "pick",
      panel: badge.panel,
      action: () => this.choose({ starter: id }),
      enabled: () => this.canPick(),
      locked: () => lock() !== null,
      tip: () => lock() ?? form.name,
      paint: (state) => {
        const selected = this.pick.starter === id;
        fade(badge.panel, this.canPick() || selected ? 1 : 0.45);
        badge.set({
          ...state,
          selected,
          locked: false,
          silhouette: lock() !== null,
          type,
          mark: null,
        });
      },
      update: () => {},
      fitTouch: () => badge.fitTouch(this.stage.viewport.minTarget),
      dispose: () => badge.dispose(),
    });
  }

  /** A difficulty on the ink tray: the host's (or, before a room, the player's own) choice. */
  private segment(value: Difficulty, label: string): void {
    const face = new SegmentFace(this.stage, label);
    this.tray.tray.add(stack(face.panel, 1));
    const reason = () => difficultyLock(this.progress, value);
    this.add({
      group: "mission",
      panel: face.panel,
      action: () => {
        if (!reason()) this.choose({ difficulty: value });
      },
      enabled: () => this.canPick(),
      tip: reason,
      locked: () => reason() !== null,
      paint: (state) =>
        face.paint({
          ...state,
          checked: this.pick.difficulty === value,
          locked: reason() !== null || !this.canPick(),
        }),
      update: (deltaMs) => face.update(deltaMs),
      fitTouch: () => face.fitTouch(),
      dispose: () => face.dispose(),
    });
  }

  // ── Choices and connection ─────────────────────────────────────────────────────────────────

  /** Choices stay open outside a connection and in a room until it starts. */
  private canPick(): boolean {
    const state = this.state;
    return !state || !!state.error || (!!state.room && !state.starting && !state.room.started);
  }

  private choose(change: Partial<LobbyPick>): void {
    if (!this.canPick()) return;
    if (change.trainer && !trainerUnlocked(this.progress, change.trainer)) return;
    if (change.starter && !starterUnlocked(this.progress, change.starter)) return;
    const next = { ...this.pick, ...change };
    if (
      next.trainer === this.pick.trainer &&
      next.starter === this.pick.starter &&
      next.difficulty === this.pick.difficulty
    )
      return;
    if (change.trainer) getAudio().sfx("ui-confirm");
    else getAudio().sfx("ui-move");
    this.pick = next;
    this.callbacks.pick(next);
    this.refresh();
  }

  /** A code was sent and the room has not answered yet. */
  private joining(): boolean {
    return this.page === "menu" && this.entering && !!this.state && !this.state.error;
  }

  update(state: SessionState | null) {
    this.state = state;
    this.refresh();
  }

  private create() {
    this.entering = false;
    this.callbacks.create();
  }

  private menu() {
    this.callbacks.cancel();
    this.state = null;
    this.entering = false;
    this.refresh();
  }

  private submit() {
    if (this.code.length !== 6 || (this.state && !this.state.error)) return;
    this.entering = true;
    this.callbacks.join(this.code);
  }

  /** Out of a join under way or a room, back to the landing; out of the landing, off the page. */
  private back() {
    getAudio().sfx("ui-back");
    if (this.page === "menu" && !this.joining()) this.callbacks.close();
    else this.menu();
  }

  private digit(digit: string) {
    if (this.code.length >= 6 || (this.state && !this.state.error)) return;
    this.code += digit;
    this.clearError();
    this.refresh();
    if (this.code.length === 6) this.focus(this.joinKey);
  }

  private erase() {
    if (this.state && !this.state.error) return;
    this.code = this.code.slice(0, -1);
    this.clearError();
    this.refresh();
  }

  private clearError() {
    if (this.state?.error) {
      this.callbacks.cancel();
      this.state = null;
    }
  }

  // ── State → nodes ──────────────────────────────────────────────────────────────────────────

  private shown(group: Group): boolean {
    const page = this.page;
    switch (group) {
      case "frame":
        return true;
      case "pick":
      case "launch":
        return page === "room";
      case "mission":
        return page === "room" && this.state?.self === 0;
      default:
        return group === page;
    }
  }

  private active(): number[] {
    return this.controls.flatMap((control, i) =>
      this.shown(control.group) && control.enabled() ? [i] : [],
    );
  }

  private refresh() {
    const state = this.state;
    const view = state ? seatView(state) : null;
    const entryError = !!state?.error && !state.room && this.entering;
    const next: Page =
      state?.error && !entryError
        ? "error"
        : this.entering && !state?.room
          ? "menu"
          : state
            ? "room"
            : "menu";
    const changed = next !== this.page;
    this.page = next;
    for (const [key, page] of Object.entries(this.pages))
      page.setProperties({ display: key === next ? "flex" : "none" });
    this.roomInfo.setProperties({ display: next === "room" && state?.room ? "flex" : "none" });
    const host = next === "room" && state?.self === 0;
    this.dock.setProperties({ display: next === "room" ? "flex" : "none" });
    this.tray.tray.setProperties({ display: host ? "flex" : "none" });
    const guestMission = next === "room" && !host ? state?.room?.mission : undefined;
    this.hostMission.tag.setProperties({ display: guestMission ? "flex" : "none" });
    if (guestMission)
      (this.hostMission.tag.children.at(-1) as Text).setProperties({
        text: difficulties[guestMission.difficulty].name,
      });

    const joining = this.joining();
    this.joinSpinner.setProperties({ display: joining ? "flex" : "none" });
    const error = entryError ? view!.error : "";
    this.errorChip.setProperties({ display: error ? "flex" : "none", text: error });
    if (error && error !== this.lastError) {
      this.errorPose.opacity = 0;
      this.stage.motion.animate(
        this.errorPose,
        { opacity: 1 },
        180,
        () => fade(this.errorChip, this.errorPose.opacity),
        EASE,
      );
    }
    this.lastError = error;
    this.digits.forEach((cell, i) => {
      cell.setProperties({
        borderColor: error ? DANGER : i === this.code.length ? ui.ink : ui.line,
        backgroundColor: joining ? ui.mist : ui.white,
      });
      this.digitText[i]!.setProperties({ text: this.code[i] ?? "" });
    });
    if (view && next === "room") {
      this.codeLabel.setProperties({ text: state!.room?.code ?? "——————" });
      (this.count.tag.children.at(-1) as Text).setProperties({ text: `${view.count}/4` });
      this.seats.forEach((seat, i) => seat.update(view.seats[i]!));
      this.launch.setLabel(state!.self === 0 ? "出发" : "等待房主");
      this.launchSpinner.setProperties({ display: view.start.pending ? "flex" : "none" });
      const ready = view.link === "ready";
      this.linkCheck.setProperties({ display: ready ? "flex" : "none" });
      this.linkSpinner.setProperties({ display: view.link === "connecting" ? "flex" : "none" });
      if (ready !== this.ready) {
        if (ready && view.start.enabled) {
          this.pulse.scale = 1.05;
          this.stage.motion.animate(
            this.pulse,
            { scale: 1 },
            220,
            () =>
              this.launchWrap.setProperties({
                transformScaleX: this.pulse.scale,
                transformScaleY: this.pulse.scale,
              }),
            POP,
          );
        }
        this.ready = ready;
      }
    }
    if (next === "error") {
      this.errorText.setProperties({ text: view!.error });
      this.retry.setLabel(state!.self === 0 && !this.entering ? "重新创建" : "返回");
    }
    const active = this.active();
    if (changed || !active.includes(this.focused)) this.focused = this.firstFocus(active);
    this.hovered = -1;
    this.pressed = -1;
    this.paint();
  }

  /** The page's own first control (create, the first key, 出发, 返回), else the back key. */
  private firstFocus(active: number[]): number {
    const own = active.find((i) => {
      const group = this.controls[i]!.group;
      return group === this.page || (this.page === "room" && group === "launch");
    });
    return own ?? active[0] ?? -1;
  }

  private paint() {
    const active = this.active();
    this.controls.forEach((control, i) => {
      const on = active.includes(i);
      control.paint({
        hovered: on && i === this.hovered,
        focused: on && i === this.focused,
        focusVisible: this.focusVisible && on && i === this.focused,
        pressed: on && i === this.pressed,
      });
    });
    this.launch.setDisabled(!(this.state && seatView(this.state).start.enabled));
    this.stage.invalidate();
  }

  // ── Layout ─────────────────────────────────────────────────────────────────────────────────

  resize(width: number, height: number, scale: number, safe: UiInsets) {
    this.stage.resize(width, height, scale, safe);
    const v = this.stage.viewport;
    // By the logical size (a phone, or a large UI scale): the desktop dock needs ~1040 × 600.
    const compact = v.height <= 600 || v.width < 1040;
    const edge = compact ? 16 : 28;
    this.frame.resize(compact);
    this.body.setProperties({
      gap: compact ? 10 : 18,
      paddingLeft: Math.max(edge, v.safeArea.left),
      paddingRight: Math.max(edge, v.safeArea.right),
      paddingBottom: Math.max(compact ? 10 : 24, v.safeArea.bottom),
    });
    // Seats fill the height between the code plate and the dock, up to a card's full height.
    this.pages.room.setProperties({ gap: compact ? 10 : 16, maxHeight: compact ? 220 : 340 });
    this.seats.forEach((seat) => seat.resize(compact));
    // The code plate: the room's first read.
    const plate = compact ? 40 : 52;
    this.codeBox.setProperties({
      minHeight: plate,
      paddingY: 4,
      gap: compact ? 8 : 12,
      paddingLeft: compact ? 14 : 20,
      paddingRight: 4,
    });
    this.codeCaption.setProperties({ fontSize: compact ? 12 : 13 });
    this.codeLabel.setProperties({ fontSize: compact ? 22 : 30, letterSpacing: compact ? 3 : 5 });
    // The dock: trainers two by two, partners five to a row, so the two groups share a height.
    const tile = Math.max(compact ? 44 : 56, v.minTarget);
    const gap = compact ? 6 : 10;
    this.dock.setProperties({
      gap: compact ? 14 : 22,
      paddingX: compact ? 12 : 18,
      paddingY: compact ? 8 : 12,
    });
    for (const header of this.headers)
      header.setProperties({ fontSize: compact ? 11 : 12, marginBottom: compact ? 4 : 6 });
    this.trainerGrid.setProperties({ width: 2 * tile + gap, gap });
    for (const panel of this.trainerTiles) panel.setProperties({ width: tile, height: tile });
    this.roster.setProperties({ width: 5 * tile + 4 * gap, gap });
    for (const badge of this.badges) badge.panel.setProperties({ width: tile, height: tile });
    // Compact: the stacked rings alone (the dots would push the route past a 667 dock).
    this.routeMap.resize(
      compact
        ? { swatch: 20, column: 4, row: 3, links: false }
        : { swatch: 22, column: 12, row: 4, links: true },
    );
    this.routeName.setProperties({ fontSize: compact ? 11 : 12, marginRight: compact ? 4 : 6 });
    // The landing: two cards of one height; the code cells set the join column's width.
    this.pages.menu.setProperties({ gap: compact ? 16 : 28 });
    for (const { content } of this.cards)
      content.setProperties({ padding: compact ? 16 : 28, gap: compact ? 16 : 28 });
    const cell = compact ? 40 : 48;
    for (const digit of this.digits) digit.setProperties({ width: cell, height: cell + 12 });
    for (const text of this.digitText) text.setProperties({ fontSize: compact ? 26 : 30 });
    const cells = 6 * cell + 5 * 6;
    this.joinButton.panel.setProperties({ width: cells });
    // The join card's top padding holds 房间码 over the cells.
    this.joinCard.setProperties({ paddingTop: (compact ? 16 : 28) + 22 });
    this.createButton.panel.setProperties({ width: compact ? 200 : 240 });
    const partner = compact ? 88 : 120;
    this.partner.panel.setProperties({ width: partner, height: partner });
    const key = Math.max(compact ? 52 : 60, v.minTarget);
    for (const { panel, span } of this.keys)
      panel.setProperties({ width: key * span + 6 * (span - 1), height: key });
    this.controls.forEach((control) => control.fitTouch());
    this.stage.invalidate();
  }

  // ── Input ──────────────────────────────────────────────────────────────────────────────────

  hit(x: number, y: number) {
    const v = this.stage.viewport;
    return (
      this.active().find((i) => {
        const panel = this.controls[i]!.panel,
          matrix = panel.globalMatrix.value,
          size = panel.size.value;
        if (!matrix || !size || !panel.isVisible.value) return false;
        this.point
          .set(x / v.scale + this.stage.camera.left, this.stage.camera.top - y / v.scale, 0)
          .applyMatrix4(this.inverse.copy(matrix).invert());
        return Math.abs(this.point.x) <= size[0] / 2 && Math.abs(this.point.y) <= size[1] / 2;
      }) ?? -1
    );
  }

  focus(index: number) {
    if (this.active().includes(index)) this.focused = index;
    this.paint();
  }

  hover(index: number | null) {
    this.hovered = index ?? -1;
    this.paint();
  }

  setPressed(index: number | null) {
    this.pressed = index ?? -1;
    this.paint();
  }

  activate(index: number) {
    if (this.active().includes(index)) this.controls[index]!.action();
  }

  physicalKey(event: UiKey): boolean {
    if (this.page !== "menu") return false;
    if (/^\d$/.test(event.key)) this.digit(event.key);
    else if (event.code === "Backspace") this.erase();
    else if (event.key === "Enter" && this.focused >= this.joinKey && this.focused < this.entryEnd)
      this.submit();
    else return false;
    return true;
  }

  navigate(action: NavigationAction): boolean {
    const active = this.active();
    if (action === "cancel") {
      if (
        this.page === "menu" &&
        currentInputMode().kind === "gamepad" &&
        (!this.state || this.state.error) &&
        this.code
      )
        this.erase();
      else this.back();
    } else if (isNavigationDirection(action)) {
      this.focus(
        active[
          gridStep(
            active.map((i) => this.controls[i]!.panel),
            active.indexOf(this.focused),
            action,
          )
        ]!,
      );
    } else if (action === "next" || action === "previous") {
      this.focus(
        active[
          (active.indexOf(this.focused) + (action === "previous" ? -1 : 1) + active.length) %
            active.length
        ]!,
      );
    } else if (action === "confirm") this.activate(this.focused);
    else return false;
    return true;
  }

  setFocusVisible(visible: boolean) {
    this.focusVisible = visible;
    this.paint();
  }

  setCoarsePointer(_coarse: boolean) {}
  pointerDown(x: number, y: number, touch: boolean) {
    this.touchPress = touch ? this.hit(x, y) : -1;
    if (this.touchPress !== this.touchTip) this.touchTip = -1;
  }
  pointerMove() {}
  pointerUp(touch: boolean) {
    const index = this.touchPress;
    this.touchPress = -1;
    if (touch && index >= 0 && this.controls[index]!.locked?.())
      this.touchTip = this.touchTip === index ? -1 : index;
    return false;
  }
  scroll() {}

  afterLayout(deltaMs: number) {
    for (const control of this.controls) control.update(deltaMs);
    this.frame.update();
    this.routeMap.update();
    if (this.page === "room") this.seats.forEach((seat) => seat.updateMotion(deltaMs));
    const tipped =
      this.hovered >= 0
        ? this.hovered
        : this.touchTip >= 0
          ? this.touchTip
          : this.focusVisible
            ? this.focused
            : -1;
    const control = this.controls[tipped];
    const text = control?.tip() ?? "";
    this.tooltip.show(text ? control!.panel : null, text);
    this.tooltip.update();
    this.clock += deltaMs;
    this.idle += deltaMs;
    if (this.idle >= 1000 / 15) {
      this.idle %= 1000 / 15;
      const turn = this.clock * 0.3;
      if (this.joining()) this.joinSpinner.setProperties({ transformRotateZ: turn });
      if (this.page === "room" && this.state) {
        const view = seatView(this.state);
        if (view.start.pending) this.launchSpinner.setProperties({ transformRotateZ: turn });
        if (view.link === "connecting") this.linkSpinner.setProperties({ transformRotateZ: turn });
      }
    }
  }

  releaseUploads() {
    this.stage.releaseUploads();
  }

  dispose() {
    this.stage.motion.cancel(this.entrance);
    this.stage.motion.cancel(this.pulse);
    this.stage.motion.cancel(this.errorPose);
    for (const control of this.controls) control.dispose();
    this.seats.forEach((seat) => seat.dispose());
    this.count.dispose();
    this.codePlate.dispose();
    this.dockPlate.dispose();
    for (const { plate } of this.cards) plate.dispose();
    this.partner.dispose();
    this.routeMap.dispose();
    this.hostMission.dispose();
    this.tray.dispose();
    this.tooltip.dispose();
    this.frame.dispose();
    this.stage.dispose();
  }
}
