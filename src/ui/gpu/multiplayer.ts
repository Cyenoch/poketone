import type { UiKey } from "../../platform/ui-surface";
import { isNavigationDirection, type NavigationAction } from "../../platform/input";
import { gridStep } from "./grid-nav";
import { Container, Text, type FontFamilies } from "@pmndrs/uikit";
import { Matrix4, Vector3 } from "three";
import type { SessionState } from "../../network/session";
import type { LobbyPick } from "../../lobbyPick";
import { difficulties } from "../../run/sim/content/difficulties";
import { GameButton } from "./game-button";
import { DialogBackdrop } from "./dialog-backdrop";
import { DialogSurface } from "./dialog-surface";
import { UiStage } from "./stage";
import { stack, fade } from "./layer";
import { uiEaseOut } from "./focus-mark";
import { createMenuIcon } from "./icons";
import { InputGlyph, currentInputMode } from "./input-glyph";
import { gameTag } from "./tag";
import { MultiplayerSeat } from "./multiplayer-seat";
import { seatView } from "./multiplayer-view";
import type { UiInsets } from "./viewport";

export interface MultiplayerCallbacks {
  rejoin?: { code: string; action: () => void };
  create: () => void;
  join: (code: string) => void;
  start: () => void;
  cancel: () => void;
  close: () => void;
}
interface Control {
  button: GameButton;
  action: () => void;
  enabled: boolean;
}
type Page = "menu" | "entry" | "room" | "error";

/** All room pages are built once. Network updates and digit input only change their properties. */
export class GpuMultiplayer {
  readonly stage = new UiStage();
  readonly minLayout = { width: 600, height: 350 };
  readonly modal = true;
  private readonly panel = new Container({
    width: 400,
    maxWidth: "100%",
    flexShrink: 0,
    flexDirection: "column",
    borderWidth: 3,
    borderRadius: 12,
    borderColor: "#0d233f",
    backgroundColor: "#e9f4fb",
  });
  private readonly header = new Container({
    paddingX: 16,
    paddingY: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  });
  private readonly title = new Text({
    text: "联机",
    fontSize: 22,
    fontWeight: 800,
    color: "#ffffff",
  });
  private readonly band = new DialogSurface("header");
  private readonly body = new Container({ padding: 20, flexDirection: "column" });
  private readonly backdrop = new DialogBackdrop();
  private readonly pages = {
    menu: new Container({
      width: "100%",
      flexDirection: "column",
      alignItems: "stretch",
      gap: 12,
    }),
    entry: new Container({
      width: "100%",
      flexDirection: "row",
      gap: 20,
      alignItems: "center",
      justifyContent: "space-between",
    }),
    room: new Container({ width: "100%", flexDirection: "column", gap: 12 }),
    error: new Container({
      width: "100%",
      flexDirection: "column",
      gap: 28,
      alignItems: "flex-end",
    }),
  };
  private readonly controls: Control[] = [];
  private readonly entryChoices = new Container({ width: "100%", flexDirection: "row", gap: 12 });
  private readonly groups: Record<Page, number[]> = { menu: [], entry: [], room: [], error: [] };
  private readonly digits: Container[] = [];
  private readonly digitText: Text[] = [];
  private readonly errorChip = gameTag(" ", { face: "#fce5e5", ink: "#a83243" });
  private readonly errorText = new Text({
    text: "",
    fontSize: 22,
    fontWeight: 800,
    color: "#a83243",
  });
  private readonly codeLabel = new Text({
    text: "——————",
    fontSize: 30,
    fontWeight: 800,
    whiteSpace: "pre",
    wordBreak: "keep-all",
  });
  private readonly count = gameTag("0/4", { face: "#142f50", ink: "#ffffff" });
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
  private readonly launchWrap = new Container();
  private readonly hostFacts = new Container({ flexDirection: "row", gap: 8 });
  private readonly point = new Vector3();
  private readonly inverse = new Matrix4();
  private readonly entrance = { opacity: 0, y: 14 };
  private readonly pulse = { scale: 1 };
  private readonly errorPose = { opacity: 1 };
  private readonly launch: number;
  private readonly join: number;
  private readonly retry: number;
  private readonly closeIndex: number;
  private state: SessionState | null = null;
  private entering = false;
  private code = "";
  private page: Page = "menu";
  private focused = -1;
  private focusVisible = false;
  private hovered = -1;
  private pressed = -1;
  private ready = false;
  private clock = 0;
  private idle = 0;
  private lastError = "";
  private readonly callbacks: MultiplayerCallbacks;
  constructor(fonts: FontFamilies, callbacks: MultiplayerCallbacks, pick: LobbyPick) {
    this.callbacks = callbacks;
    this.stage.root.setProperties({
      fontFamilies: fonts,
      color: "#142f50",
      justifyContent: "center",
      alignItems: "center",
    });
    this.stage.scene.add(this.backdrop.dim, this.backdrop.shadow);
    this.header.add(this.band.content, stack(this.title, 1));
    this.closeIndex = this.button(this.header, "", () => this.back(), false, "close");
    const close = this.controls[this.closeIndex]!.button.panel;
    stack(close, 1);
    const cap = new InputGlyph("cancel", "Esc");
    cap.setProperties({ positionType: "absolute", positionRight: -3, positionBottom: -5 });
    close.add(stack(cap, 3));
    this.panel.add(this.header, this.body);
    this.stage.root.add(this.panel);
    for (const page of Object.values(this.pages)) this.body.add(page);
    this.pages.menu.add(this.entryChoices);
    this.groups.menu.push(this.button(this.entryChoices, "创建房间", () => this.create(), true));
    this.groups.menu.push(
      this.button(this.entryChoices, "加入房间", () => {
        this.entering = true;
        this.refresh();
      }),
    );
    for (const index of this.groups.menu)
      this.controls[index]!.button.panel.setProperties({
        flexGrow: 1,
        flexBasis: 0,
        minHeight: 64,
        paddingX: 12,
      });
    if (callbacks.rejoin)
      this.groups.menu.push(
        this.button(this.pages.menu, `重返 ${callbacks.rejoin.code}`, callbacks.rejoin.action),
      );

    const entryLeft = new Container({ flexDirection: "column", gap: 12, flexShrink: 0 });
    const codeRow = new Container({ flexDirection: "row", gap: 4 });
    for (let i = 0; i < 6; i++) {
      const cell = new Container({
        width: 40,
        height: 52,
        flexShrink: 0,
        borderWidth: 2,
        borderColor: "#92b8d1",
        borderRadius: 6,
        backgroundColor: "#ffffff",
        alignItems: "center",
        justifyContent: "center",
      });
      const text = new Text({ text: "", fontSize: 30, fontWeight: 800 });
      cell.add(text);
      codeRow.add(cell);
      this.digits.push(cell);
      this.digitText.push(text);
    }
    entryLeft.add(
      new Text({ text: "房间码", fontSize: 16, fontWeight: 800 }),
      codeRow,
      this.errorChip,
    );
    const keypad = new Container({ flexDirection: "column", gap: 8 });
    for (const row of ["123", "456", "789", "x0j"]) {
      const keys = new Container({ flexDirection: "row", gap: 8 });
      for (const key of row) {
        const index = this.button(
          keys,
          key === "j" ? "加入" : key === "x" ? "" : key,
          () => (key === "j" ? this.submit() : key === "x" ? this.erase() : this.digit(key)),
          key === "j",
          key === "x" ? "erase" : undefined,
        );
        this.controls[index]!.button.panel.setProperties({ width: 60, paddingX: 6 });
        this.groups.entry.push(index);
      }
      keypad.add(keys);
    }
    this.join = this.groups.entry.at(-1)!;
    this.joinSpinner.setProperties({ width: 16, height: 16, display: "none" });
    this.controls[this.join]!.button.panel.add(stack(this.joinSpinner, 2));
    this.pages.entry.add(entryLeft, keypad);

    this.seats = [0, 1, 2, 3].map((slot) => new MultiplayerSeat(this.stage, slot));
    const seatRow = new Container({
      flexDirection: "row",
      width: "100%",
      gap: 12,
      alignItems: "center",
    });
    this.linkCheck.setProperties({
      width: 24,
      height: 24,
      color: "#287a58",
    });
    this.linkSpinner.setProperties({ width: 20, height: 20, color: "#2165a4" });
    this.link.add(this.linkCheck, this.linkSpinner);
    seatRow.add(...this.seats.map((seat) => seat.root));
    const roomCode = new Container({ flexDirection: "row", alignItems: "center", gap: 12 });
    roomCode.add(new Text({ text: "房间码", fontSize: 14, fontWeight: 800 }), this.codeLabel);
    const roomStatus = new Container({ flexDirection: "row", alignItems: "center", gap: 8 });
    roomStatus.add(this.link, this.count);
    const roomHead = new Container({
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    });
    roomHead.add(roomCode, roomStatus);
    const footer = new Container({
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      width: "100%",
      gap: 12,
    });
    this.hostFacts.add(
      gameTag("6 关探险", { face: "#d8effb", ink: "#142f50" }),
      gameTag(difficulties[pick.difficulty].name, { face: "#d8effb", ink: "#142f50" }),
    );
    this.launch = this.button(this.launchWrap, "出发", callbacks.start, true);
    this.launchSpinner.setProperties({ width: 18, height: 18, display: "none" });
    this.controls[this.launch]!.button.panel.add(stack(this.launchSpinner, 2));
    this.groups.room.push(this.launch);
    footer.add(this.hostFacts, this.launchWrap);
    this.pages.room.add(roomHead, seatRow, footer);
    const errorRow = new Container({
      width: "100%",
      minHeight: 100,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 14,
    });
    const warning = createMenuIcon("danger");
    warning.setProperties({ width: 40, height: 40, color: "#a83243" });
    errorRow.add(warning, this.errorText);
    this.pages.error.add(errorRow);
    this.retry = this.button(
      this.pages.error,
      "返回",
      () => (this.state?.self === 0 && !this.entering ? this.create() : this.menu()),
      true,
    );
    this.groups.error.push(this.retry);
    this.refresh();
    this.stage.motion.animate(
      this.entrance,
      { opacity: 1, y: 0 },
      180,
      () => {
        fade(this.panel, this.entrance.opacity).setProperties({
          transformTranslateY: this.entrance.y,
        });
        this.backdrop.setOpacity(this.entrance.opacity);
        this.stage.invalidate();
      },
      uiEaseOut,
    );
  }
  private button(
    parent: Container,
    label: string,
    action: () => void,
    primary = false,
    icon?: "close" | "erase",
  ) {
    const button = new GameButton(this.stage, {
      label,
      tone: icon === "close" ? "close" : primary ? "primary" : "secondary",
      size: "small",
      square: !!icon,
      icon: icon ? createMenuIcon(icon) : undefined,
    });
    parent.add(button.panel);
    return this.controls.push({ button, action, enabled: true }) - 1;
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
    if (this.code.length === 6 && (!this.state || this.state.error)) this.callbacks.join(this.code);
  }
  private back() {
    if (this.entering && !this.state?.room) {
      if (this.state && !this.state.error) {
        this.callbacks.cancel();
        this.state = null;
        this.refresh();
      } else this.menu();
    } else this.callbacks.close();
  }
  private digit(digit: string) {
    if (this.code.length >= 6 || (this.state && !this.state.error)) return;
    this.code += digit;
    this.clearError();
    this.refresh();
    if (this.code.length === 6) this.focus(this.join);
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
  private enable(index: number, enabled: boolean) {
    const control = this.controls[index]!;
    control.enabled = enabled;
    control.button.setDisabled(!enabled);
  }
  private active() {
    return [...this.groups[this.page].filter((i) => this.controls[i]!.enabled), this.closeIndex];
  }
  private refresh() {
    const state = this.state;
    const view = state ? seatView(state) : null;
    const entryError = !!state?.error && !state.room && this.entering;
    const next: Page =
      state?.error && !entryError
        ? "error"
        : this.entering && !state?.room
          ? "entry"
          : state
            ? "room"
            : "menu";
    const changed = next !== this.page;
    this.page = next;
    this.panel.setProperties({ width: next === "room" ? 680 : next === "entry" ? 560 : 400 });
    for (const [key, page] of Object.entries(this.pages))
      page.setProperties({ display: key === next ? "flex" : "none" });
    this.title.setProperties({ text: next === "entry" ? "加入房间" : "联机" });
    const joining = next === "entry" && !!state && !state.error;
    this.groups.entry.forEach((i) =>
      this.enable(i, !joining && (i !== this.join || this.code.length === 6)),
    );
    this.joinSpinner.setProperties({ display: joining ? "flex" : "none" });
    const error = entryError ? view!.error : "";
    this.errorChip.setProperties({ display: error ? "flex" : "none" });
    (this.errorChip.children[0] as Text).setProperties({ text: error });
    if (error && error !== this.lastError) {
      this.errorPose.opacity = 0;
      this.stage.motion.animate(
        this.errorPose,
        { opacity: 1 },
        180,
        () => fade(this.errorChip, this.errorPose.opacity),
        uiEaseOut,
      );
    }
    this.lastError = error;
    this.digits.forEach((cell, i) => {
      cell.setProperties({
        borderColor: error ? "#a83243" : i === this.code.length ? "#2165a4" : "#92b8d1",
        backgroundColor: joining ? "#d0dfeb" : "#ffffff",
      });
      this.digitText[i]!.setProperties({ text: this.code[i] ?? "" });
    });
    if (view && next === "room") {
      this.codeLabel.setProperties({ text: state!.room?.code ?? "——————" });
      (this.count.children[0] as Text).setProperties({ text: `${view.count}/4` });
      this.seats.forEach((seat, i) => seat.update(view.seats[i]!));
      this.hostFacts.setProperties({ display: state!.self === 0 ? "flex" : "none" });
      this.launchWrap.setProperties({ display: state!.room ? "flex" : "none", marginLeft: "auto" });
      this.controls[this.launch]!.button.setLabel(state!.self === 0 ? "出发" : "等待房主");
      this.enable(this.launch, view.start.enabled);
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
            uiEaseOut,
          );
        }
        this.ready = ready;
      }
    }
    if (next === "error") {
      this.errorText.setProperties({ text: view!.error });
      this.controls[this.retry]!.button.setLabel(
        state!.self === 0 && !this.entering ? "重新创建" : "返回",
      );
    }
    const active = this.active();
    if (changed || !active.includes(this.focused)) this.focused = active[0]!;
    this.hovered = -1;
    this.pressed = -1;
    this.paint();
  }
  private paint() {
    const active = this.active();
    this.controls.forEach(({ button }, i) => {
      button.setHovered(active.includes(i) && i === this.hovered);
      button.setFocused(active.includes(i) && i === this.focused);
      button.setFocusVisible(this.focusVisible && active.includes(i) && i === this.focused);
      button.setPressed(active.includes(i) && i === this.pressed);
    });
    this.stage.invalidate();
  }
  resize(width: number, height: number, scale: number, safe: UiInsets) {
    this.stage.resize(width, height, scale, safe);
    const v = this.stage.viewport;
    this.stage.root.setProperties({
      paddingLeft: Math.max(16, v.safeArea.left),
      paddingRight: Math.max(16, v.safeArea.right),
      paddingTop: Math.max(12, v.safeArea.top),
      paddingBottom: Math.max(12, v.safeArea.bottom),
    });
    const availableHeight =
      v.height - Math.max(12, v.safeArea.top) - Math.max(12, v.safeArea.bottom);
    const compact = availableHeight <= 430;
    this.body.setProperties({ padding: compact ? 12 : 20 });
    this.pages.room.setProperties({ gap: compact ? 8 : 12 });
    this.seats.forEach((seat) => seat.resize(compact));
    this.controls.forEach(({ button }) => button.fitTouch());
    for (const index of this.groups.menu.slice(0, 2))
      this.controls[index]!.button.panel.setProperties({ minHeight: Math.max(64, v.minTarget) });
    this.backdrop.resize(v.width, v.height);
  }
  hit(x: number, y: number) {
    const v = this.stage.viewport;
    return (
      this.active().find((i) => {
        const panel = this.controls[i]!.button.panel,
          matrix = panel.globalMatrix.value,
          size = panel.size.value;
        if (!matrix || !size || !panel.displayed.value) return false;
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
    if (this.page !== "entry") return false;
    if (/^\d$/.test(event.key)) this.digit(event.key);
    else if (event.code === "Backspace") this.erase();
    else if (event.key === "Enter") this.submit();
    else return false;
    return true;
  }

  navigate(action: NavigationAction): boolean {
    if (action === "cancel") {
      if (
        this.page === "entry" &&
        currentInputMode().kind === "gamepad" &&
        (!this.state || this.state.error) &&
        this.code
      )
        this.erase();
      else this.back();
    } else if (isNavigationDirection(action)) {
      const active = this.active();
      this.focus(
        active[
          gridStep(
            active.map((i) => this.controls[i]!.button.panel),
            active.indexOf(this.focused),
            action,
          )
        ]!,
      );
    } else if (action === "next" || action === "previous") {
      const active = this.active();
      this.focus(
        active[
          (active.indexOf(this.focused) + (action === "previous" ? -1 : 1) + active.length) %
            active.length
        ]!,
      );
    } else if (action === "confirm") this.activate(this.focused);
    return true;
  }
  setFocusVisible(visible: boolean) {
    this.focusVisible = visible;
    this.paint();
  }
  setCoarsePointer(_coarse: boolean) {}
  scroll(_delta: number) {}
  pointerDown() {}
  pointerMove() {}
  pointerUp() {
    return false;
  }
  afterLayout(deltaMs: number) {
    this.band.update(deltaMs);
    this.controls.forEach(({ button }) => button.update(deltaMs));
    if (this.page === "room") this.seats.forEach((seat) => seat.updateMotion(deltaMs));
    this.clock += deltaMs;
    this.idle += deltaMs;
    if (this.idle >= 1000 / 15) {
      this.idle %= 1000 / 15;
      if (this.page === "entry" && this.state && !this.state.error)
        this.joinSpinner.setProperties({ transformRotateZ: this.clock * 0.3 });
      if (this.page === "room") {
        if (this.state && seatView(this.state).start.pending)
          this.launchSpinner.setProperties({ transformRotateZ: this.clock * 0.3 });
        if (this.state && seatView(this.state).link === "connecting")
          this.linkSpinner.setProperties({ transformRotateZ: this.clock * 0.3 });
      }
    }
    const matrix = this.panel.globalMatrix.value,
      size = this.panel.size.value;
    if (matrix && size) this.backdrop.updatePanel(matrix, size[0], size[1]);
  }
  releaseUploads() {
    this.stage.releaseUploads();
  }
  dispose() {
    this.controls.forEach(({ button }) => button.dispose());
    this.seats.forEach((seat) => seat.dispose());
    this.band.dispose();
    this.backdrop.dispose();
    this.stage.dispose();
  }
}
