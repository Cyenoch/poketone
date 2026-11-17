import { FullscreenIcon } from "./fullscreen-icon";
import type { UiKey } from "../../platform/ui-surface";
import {
  isNavigationDirection,
  isNavigationAction,
  navigationAction,
  type InputAction,
  type NavigationAction,
  type NavigationDirection,
} from "../../platform/input";
import { InputGlyph } from "./input-glyph";
import { revealInScroller } from "./scroll-reveal";
import { SCROLL_FADE, ScrollFade } from "./scroll-fade";
import { getAudio } from "../../audio/engine";
import { GpuStationContent } from "./run-overlays-station";
import { GpuResultContent } from "./run-overlays-result";
import { GpuRunLoading } from "./run-overlays-loading";
import type { RunOverlayControl } from "./run-overlays-control";
import { Component, Container, Text, type Content, type FontFamilies } from "@pmndrs/uikit";
import { Matrix4, Vector3, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import type { RunResult, StationView } from "../../run/createRun";
import type { LocalCommand } from "../../run/createRun";
import type { FormId, StarterId } from "../../run/sim/content/lines/index";
import type { ItemId } from "../../run/sim/content/items";
import type { ElementType } from "../../run/sim/content/elements";
import { stationNames } from "../../run/sim/content/stations";
import type { PlayerSheet } from "../../run/createRun";
import { UiStage } from "./stage";
import { fade, stack } from "./layer";
import { OutlineRing } from "./box-shadow";
import { GpuTooltip } from "./tooltip";

const easeIn = (t: number) => cubicBezier(t, 0.42, 0, 1, 1);
/** ui/Tooltip.tsx LONG_PRESS_MS. */
const LONG_PRESS_MS = 450;
import { uiEaseOut, cubicBezier } from "./focus-mark";
import { createMenuIcon } from "./icons";
import { WindowSurface } from "./run-overlays-surface";
import { GameButton } from "./game-button";
import { SlantPlate } from "./slant-plate";
import { SNAP } from "./motion";
import { RADIUS_INNER, slantOf, ui } from "./tokens";
import { GpuChoiceContent, type ChoiceState } from "./run-choice-content";
import { ChoiceArt } from "./run-choice-surface";
import { themeColors } from "./run-theme";
import { createRunCommandIcon } from "./run-overlays-icons";
import { createStationArt } from "./station-art";
import type { UiInsets } from "./viewport";
import { GpuStatsContent } from "./run-overlays-stats-panel";
import { gridStep } from "./grid-nav";
import { runWindowSamples } from "./run-overlays-samples";
import { images } from "../../prepare/images";

export type RunOverlayState =
  | null
  | ({ theme: ElementType } & (
      | { kind: "loading"; starter: StarterId }
      | { kind: "error"; message: string }
      | { kind: "save-error"; message: string }
      | { kind: "reconnecting" }
      | { kind: "pause"; form: string; meta: string[]; quitting: boolean; shared: boolean }
      | { kind: "stats"; starter: StarterId; form: FormId; level: number; build: PlayerSheet }
      | { kind: "station"; view: StationView }
      | Omit<ChoiceState, "theme">
      | { kind: "result"; result: RunResult; note: string | null; backpackSize: number | null }
    ));
export interface RunOverlayCallbacks {
  send: (command: LocalCommand) => void;
  resume: () => void;
  closeStats: () => void;
  openSettings: () => void;
  openCodex: () => void;
  /** Ends the run as 放弃冒险 does and starts it again. */
  restart: () => void;
  /** 放弃冒险 asks first: `askQuit` shows the question, `cancelQuit` returns to the pause list. */
  askQuit: () => void;
  cancelQuit: () => void;
  /** Gives the run up and returns to the lobby. */
  quit: () => void;
  retry: () => void;
  exit: () => void;
  /** Answers the card: a pick (after its flight) or, in banish mode, a banish. */
  pick: (index: number, banish: boolean) => void;
  toggleBanish: () => void;
  keepItems: (items: ItemId[]) => boolean;
  slotCenter: (kind: "move" | "item", id: string) => { x: number; y: number } | null;
}

/** All run windows share one GPU input owner and one independently clocked overlay pass. */
const inertCallbacks: RunOverlayCallbacks = {
  send() {},
  resume() {},
  closeStats() {},
  openSettings() {},
  openCodex() {},
  restart() {},
  askQuit() {},
  cancelQuit() {},
  quit() {},
  retry() {},
  exit() {},
  pick() {},
  toggleBanish() {},
  keepItems: () => false,
  slotCenter: () => null,
};

/** What a window's controls are: owned by the window being built, so none outlives it. */
interface ControlSet {
  readonly controls: RunOverlayControl[];
  /** The close key's index, -1 when the window has none. */
  closeIndex: number;
  /** The window's slanted keys (stepped and shown focus with it) and drawn parts. */
  readonly buttons: GameButton[];
  readonly parts: { dispose(): void }[];
}
const noControls = (): ControlSet => ({ controls: [], closeIndex: -1, buttons: [], parts: [] });

export class GpuRunOverlays {
  readonly stage = new UiStage();
  /** Made after the root has its fonts, so its text never resolves a font without them. */
  private readonly tooltip: GpuTooltip;
  private hovered: number | null = null;
  /** A tip opened by touch (long press, or a tap on a locked control); any other press closes it. */
  private touchTip: number | null = null;
  private tipPress: { index: number; at: number; x: number; y: number; fired: boolean } | null =
    null;
  private readonly dimGeometry = new PlaneGeometry(1, 1);
  private readonly dimMaterial = new MeshBasicMaterial({
    color: ui.ink,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  private readonly dimMesh = new Mesh(this.dimGeometry, this.dimMaterial);
  private readonly leavingWindows: { remaining: number; dispose(): void }[] = [];
  private visibleKind: NonNullable<RunOverlayState>["kind"] | null = null;
  private readonly callbacks: RunOverlayCallbacks;
  private readonly fonts: FontFamilies;
  /** {@link runWindowSamples} still to build, from the loading screen on; null before it. */
  private warmSamples: NonNullable<RunOverlayState>[] | null = null;
  /** Unseen copies whose programs are still compiling. */
  private readonly warming = new Set<GpuRunOverlays>();
  private state: RunOverlayState = null;
  private frame: Container | null = null;
  private body: Container | null = null;
  private scrollFades: ScrollFade[] = [];
  private header: Container | null = null;
  private headerCopy: Container | null = null;
  private titlePlate: Container | null = null;
  private titleText: Text | null = null;
  /** The title plate unrolls from the left as its window opens. */
  private titleReveal: { value: number } | null = null;
  private titleSlant: SlantPlate | null = null;
  /** The window's control set: built with the window, dropped with it, never carried over. */
  private window: ControlSet = noControls();
  private get controls(): RunOverlayControl[] {
    return this.window.controls;
  }
  private get closeIndex(): number {
    return this.window.closeIndex;
  }
  private selected = 0;
  private focusVisible = true;
  private pressedIndex: number | null = null;
  private readonly pressMotion = new Map<
    RunOverlayControl,
    { x: number; y: number; shift: number }
  >();
  private initializingFocus = false;
  private signature = "";
  private elapsed = 0;
  private exitLeft = 0;
  private closing = false;
  private coarse = false;
  private content:
    | GpuStationContent
    | GpuResultContent
    | GpuRunLoading
    | GpuChoiceContent
    | GpuStatsContent
    | null = null;
  private readonly cardArt = new ChoiceArt(() => this.stage.invalidate());
  /** The station window's title icon on its plate (`station-art.ts`). */
  private stationArt: ReturnType<typeof createStationArt> | null = null;
  private readonly fade = { opacity: 0 };
  private readonly entrance = { y: 0, scale: 0.95 };
  private readonly point = new Vector3();
  private readonly inverse = new Matrix4();
  private lastLayout = "";
  private needsReveal = false;
  private userScrolled = false;
  private safeArea: UiInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private width = 1;
  private height = 1;
  private scale = 1;

  constructor(fonts: FontFamilies, callbacks: RunOverlayCallbacks) {
    this.callbacks = callbacks;
    this.fonts = fonts;
    this.stage.root.setProperties({
      fontFamilies: fonts,
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
    });
    this.dimMesh.renderOrder = -2;
    this.stage.scene.add(this.dimMesh);
    this.tooltip = new GpuTooltip(this.stage);
  }
  get isModal(): boolean {
    return (
      (this.frame !== null && !this.choiceOpen) ||
      this.content instanceof GpuRunLoading ||
      this.leavingWindows.length > 0
    );
  }
  /** A closing pause window remains drawable, but no longer owns a delayed codex request. */
  get codexHome(): number | null {
    return this.state?.kind === "pause" && !this.state.quitting ? this.revision : null;
  }
  /** Co-op choices share the gameplay input owner and occupy only the bottom build area. */
  get choiceOpen(): boolean {
    return this.content instanceof GpuChoiceContent && this.content.docked;
  }

  update(state: RunOverlayState): void {
    const before = this.state;
    this.state = state;
    if (state === null) {
      // The choice has no exit of its own (the original unmounts it): after a pick everything has
      // already flown or faded; a skip closes it at once.
      if (this.content instanceof GpuRunLoading || this.content instanceof GpuChoiceContent) {
        // A choice closed during its fade-in must not leave the fade running over the dim.
        this.stage.motion.cancel(this.fade);
        this.fade.opacity = 0;
        this.clearFrame();
        this.signature = "";
        this.dimMaterial.opacity = 0;
        return;
      }
      if (this.isModal && !this.closing) {
        this.closing = true;
        this.exitLeft = 160;
        this.animate(false);
      }
      return;
    }
    const choice = this.content instanceof GpuChoiceContent ? this.content : null;
    // A pick in flight (or landed) keeps its cards until the run answers with the next card or none.
    if (choice?.picking && state.kind === "choice" && state.dealKey === choice.dealKey) return;
    const signature = JSON.stringify(state);
    if (signature === this.signature && !this.closing) return;
    const changedKind =
      before?.kind !== state.kind ||
      (before?.kind === "choice" &&
        state.kind === "choice" &&
        before.dismissible !== state.dismissible);
    const newDeal =
      state.kind === "choice" && (before?.kind !== "choice" || before.dealKey !== state.dealKey);
    // After a pick the next card fades the whole window in again (run-fade restarts); a reroll
    // only deals the cards again.
    const reopened = newDeal && choice?.picking === true;
    const oldSelected = this.selected;
    this.signature = signature;
    this.builtOverEmpty = !this.isModal && !this.choiceOpen;
    if (changedKind && before && !["loading", "choice"].includes(before.kind) && this.frame)
      this.retireFrame();
    else this.clearFrame(!changedKind);
    this.closing = false;
    this.exitLeft = 0;
    this.build(state);
    this.needsReveal = true;
    this.userScrolled = false;
    this.resize(this.width, this.height, this.scale, this.safeArea);
    this.initializingFocus = true;
    // 放弃冒险's question opens on 取消; leaving it puts focus back on 放弃冒险.
    const asked =
      before?.kind === "pause" && state.kind === "pause" && before.quitting !== state.quitting;
    const kept =
      changedKind || newDeal
        ? this.initialFocus()
        : asked
          ? state.quitting
            ? this.initialFocus()
            : this.controls.length - 2
          : Math.min(oldSelected, this.controls.length - 1);
    if (state.kind === "stats" && changedKind) this.blur();
    else this.focus(this.controls[kept]?.enabled() ? kept : this.initialFocus());
    this.initializingFocus = false;
    // Loading, and the result (a plain `<dialog open>` with no presence animation), show at once.
    if (state.kind === "loading" || (state.kind === "result" && changedKind)) {
      this.stage.motion.cancel(this.fade);
      this.stage.motion.cancel(this.entrance);
      this.fade.opacity = 1;
      this.entrance.y = 0;
      this.entrance.scale = 1;
      this.applyTransition();
    } else if (changedKind || before === null || reopened) {
      this.fade.opacity = 0;
      this.entrance.y = 0;
      this.entrance.scale = state.kind === "choice" ? 1 : 0.95;
      this.applyTransition();
      this.animate(true);
      this.unrollTitle();
    } else this.applyTransition();
    this.stage.invalidate();
  }

  private text(text: string, fontSize = 16, color: string = ui.ink): Text {
    return stack(
      new Text({
        text,
        fontSize,
        fontWeight: 800,
        color,
        flexShrink: 0,
        minWidth: 0,
        maxWidth: "100%",
      }),
      1,
    );
  }
  /** An upright badge (the pause header's form and run facts). */
  private chip(text: string, face: string, ink: string): Container {
    const chip = new Container({
      height: 25,
      paddingX: 9,
      alignItems: "center",
      flexShrink: 0,
      borderRadius: RADIUS_INNER,
      backgroundColor: face,
    });
    chip.add(this.text(text, 13, ink));
    return chip;
  }
  /** A window command drawing its own hover, focus and press: the primary is the slanted CTA, the
   *  rest stand upright. */
  private button(
    label: string,
    action: () => void,
    options: {
      enabled?: () => boolean;
      tone?: "primary" | "secondary" | "ink";
      size?: "small" | "normal";
      width?: number | "100%";
      icon?: Content;
      square?: boolean;
    } = {},
  ): Container {
    const enabled = options.enabled ?? (() => true);
    const look = {
      size: options.size ?? "normal",
      label: label || undefined,
      icon: options.icon,
      square: options.square,
    } as const;
    const button = new GameButton(this.stage, { ...look, tone: options.tone ?? "secondary" });
    button.panel.setProperties({ width: options.width, maxWidth: "100%" });
    button.setFocusVisible(this.focusVisible);
    button.setDisabled(!enabled());
    this.window.buttons.push(button);
    this.controls.push({
      panel: button.panel,
      enabled,
      action,
      selfDrawn: true,
      setFocused: (focused) => button.setFocused(focused),
      setPointerOver: (over) => button.setHovered(over),
      setPressed: (pressed) => button.setPressed(pressed),
    });
    return button.panel;
  }
  /** Counts window builds; the host compiles a new window's programs before its first draw. */
  revision = 0;
  /** The last build had nothing on screen before it, so holding it back while it compiles shows
   *  no gap; a rebuild over a visible window (reroll, window switch) must keep drawing instead. */
  builtOverEmpty = true;
  private toggleFullscreen: (() => void) | undefined;
  private fullscreenIcon = new FullscreenIcon();
  private fullscreenActive = false;
  private fullscreenPanel: Container | undefined;

  setFullscreenAction(action: (() => void) | undefined, active: boolean): void {
    this.fullscreenActive = active;
    if (this.fullscreenIcon.setActive(active)) this.stage.invalidate();
    if (this.toggleFullscreen === action) return;
    this.toggleFullscreen = action;
    this.fullscreenPanel?.setProperties({ display: action ? "flex" : "none" });
    if (this.controls[this.selected]?.panel === this.fullscreenPanel && !action)
      this.focus(this.initialFocus());
    this.stage.invalidate();
  }

  private build(state: NonNullable<RunOverlayState>): void {
    this.window = noControls();
    this.fullscreenPanel = undefined;
    this.revision++;
    this.visibleKind = state.kind;
    if (state.kind === "loading") {
      if (!(this.content instanceof GpuRunLoading)) this.content = new GpuRunLoading();
      this.stage.root.add(this.content.root);
      return;
    }
    if (state.kind === "choice") {
      if (this.content instanceof GpuChoiceContent) this.content.update(state);
      else
        this.content = new GpuChoiceContent(
          state,
          {
            send: this.callbacks.send,
            pick: this.callbacks.pick,
            toggleBanish: this.callbacks.toggleBanish,
            slotCenter: this.callbacks.slotCenter,
          },
          this.stage,
          this.cardArt,
        );
      this.content.setFocusVisible(this.focusVisible);
      this.content.setCoarsePointer(this.coarse);
      this.frame = this.content.root;
      this.body = this.content.scrollBody;
      // Kept mounted across same-card rebuilds (clearFrame leaves it attached).
      if (this.content.root.parent !== this.stage.root) this.stage.root.add(this.content.root);
      this.controls.push(...this.content.controls);
      // Cards draw their own outline in their surface (with the banish dashes); buttons get the ring.
      for (const control of this.controls) if (!control.selfDrawn) this.ring(control);
      return;
    }
    const colors = themeColors(state.theme);
    const frame = (this.frame = new Container({
      width:
        state.kind === "stats"
          ? 1000
          : state.kind === "station"
            ? 560
            : state.kind === "pause"
              ? 380
              : state.kind === "result"
                ? 540
                : 420,
      maxWidth: "100%",
      maxHeight: "100%",
      minHeight: 0,
      flexDirection: "column",
    }));
    const surface = new WindowSurface(frame);
    this.window.parts.push(surface);
    frame.add(surface.content);
    const title =
      state.kind === "pause"
        ? state.quitting
          ? "放弃冒险"
          : state.shared
            ? "菜单"
            : "暂停"
        : state.kind === "station"
          ? stationNames[state.view.kind]
          : state.kind === "result"
            ? state.result.outcome === "victory"
              ? "守卫已击败"
              : "力竭倒下"
            : state.kind === "error"
              ? "无法开始冒险"
              : state.kind === "save-error"
                ? "记录保存失败"
                : state.kind === "reconnecting"
                  ? "正在重连"
                  : "";
    const stats =
      state.kind === "stats"
        ? (this.content = new GpuStatsContent(state, this.stage, this.cardArt, () =>
            this.statsPageTurned(),
          ))
        : null;
    const header = (this.header =
      stats?.header ??
      new Container({
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingLeft: 14,
        paddingRight: 12,
        paddingTop: 12,
        paddingBottom: 4,
        flexShrink: 0,
        justifyContent: "flex-start",
      }));
    if (!stats) {
      const headerCopy = (this.headerCopy = new Container({
        flexGrow: 1,
        minWidth: 0,
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
      }));
      // The title on a slanted plate: the type's deep colour under its card face, the result's
      // outcome colour (cleared green, fallen ink).
      const plateFill =
        state.kind === "result"
          ? state.result.outcome === "victory"
            ? ui.success
            : ui.ink
          : colors.deep;
      const titlePlate = (this.titlePlate = new Container({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
        flexShrink: 1,
        height: 44,
        // Symmetric: the title sits on the parallelogram's centre.
        paddingX: 18 + slantOf(44) / 2,
      }));
      const plate = new SlantPlate(titlePlate, {
        fill: plateFill,
        stripe: state.kind === "result" ? undefined : { color: colors.theme, width: 8 },
        card:
          state.kind === "result"
            ? undefined
            : { type: state.theme, loaded: () => this.stage.invalidate() },
      });
      this.titleReveal = { value: 1 };
      this.titleSlant = plate;
      this.window.parts.push(plate);
      titlePlate.add(plate.content);
      if (state.kind === "station") {
        this.stationArt = createStationArt(state.view.kind, 30);
        titlePlate.add(stack(this.stationArt.root, 1));
      }
      const titleText = stack(
        new Text({
          text: title,
          fontSize: 22,
          fontWeight: 900,
          letterSpacing: 1,
          color: ui.white,
          minWidth: 0,
          whiteSpace: "pre",
        }),
        1,
      );
      this.titleText = titleText;
      titlePlate.add(titleText);
      headerCopy.add(titlePlate);
      if (state.kind === "pause") {
        const meta = new Container({
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
          paddingLeft: 4,
        });
        meta.add(
          this.chip(state.form, ui.ink, ui.white),
          ...state.meta.map((part) => this.chip(part, ui.mist, ui.ink)),
        );
        headerCopy.add(meta);
      }
      header.add(headerCopy);
    }
    if (["pause", "stats", "station", "error", "reconnecting"].includes(state.kind)) {
      this.window.closeIndex = this.controls.length;
      header.add(this.closeKey());
    }
    frame.add(stack(header, 1));
    const body = (this.body = new Container({
      minHeight: 0,
      flexShrink: 1,
      overflow: "scroll",
      scrollbarWidth: 3,
      scrollbarColor: ui.line,
      flexDirection: "column",
      gap: 12,
      // The space around the controls belongs to the scroll box: plate shadows and the focus ring
      // (clipped to this box) draw into it instead of being cut at the first or last control.
      paddingTop: 12,
      paddingX: 18,
      paddingBottom: 18,
    }));
    if (stats) body.setProperties({ paddingTop: 8, paddingX: 8, paddingBottom: 8 });
    // A body that scrolls fades into the window face at an edge with more beyond it. The fades lie
    // in a box the body's size that does not scroll.
    const scrollBox = new Container({ minHeight: 0, flexShrink: 1, flexDirection: "column" });
    this.scrollFades = [new ScrollFade("top", ui.paper), new ScrollFade("bottom", ui.paper)];
    scrollBox.add(body, ...this.scrollFades.map((f) => stack(f.content, 30)));
    frame.add(stack(scrollBox, 1));
    this.stage.root.add(frame);
    if (state.kind === "pause" && state.quitting) {
      body.add(
        this.button("返回大厅", this.callbacks.quit, { tone: "ink", width: "100%" }),
        this.button("取消", this.callbacks.cancelQuit, { width: "100%" }),
      );
    } else if (state.kind === "pause") {
      body.add(
        this.button("继续", this.callbacks.resume, { tone: "primary", width: "100%" }),
        this.button("图鉴", this.callbacks.openCodex, {
          width: "100%",
          icon: createMenuIcon("cube"),
        }),
        this.button("设置", this.callbacks.openSettings, {
          width: "100%",
          icon: createMenuIcon("settings"),
        }),
      );
      // A shared run goes on for the team; only a solo run restarts from here.
      if (!state.shared)
        body.add(
          this.button("重新开始", this.callbacks.restart, {
            width: "100%",
            icon: createRunCommandIcon("reset"),
          }),
        );
      body.add(
        this.button("放弃冒险", this.callbacks.askQuit, {
          tone: "ink",
          width: "100%",
          size: "small",
          icon: createMenuIcon("close"),
        }),
      );
    } else if (state.kind === "reconnecting") {
      body.add(this.button("返回", this.callbacks.exit));
    } else if (state.kind === "error") {
      body.add(
        this.text(state.message, 16),
        this.button("重试", this.callbacks.retry, { tone: "primary" }),
        this.button("返回", this.callbacks.exit),
      );
    } else if (state.kind === "save-error") {
      body.add(
        this.text(state.message, 16),
        this.button("重试", this.callbacks.retry, { tone: "primary" }),
      );
    } else if (state.kind === "station") {
      if (!(this.content instanceof GpuStationContent))
        this.content = new GpuStationContent(
          state.view,
          { send: this.callbacks.send, invalidate: () => this.rebuild() },
          this.stage,
        );
      else this.content.update(state.view);
      this.content.setFocusVisible(this.focusVisible);
      body.add(this.content.root);
      header.add(this.content.headerCurrency);
      const close = this.controls[this.closeIndex]?.panel;
      if (close) {
        close.removeFromParent();
        header.add(close);
      }
      this.content.resize(this.width, this.height, this.scale);
      this.controls.push(...this.content.controls);
    } else if (state.kind === "result") {
      if (!(this.content instanceof GpuResultContent))
        this.content = new GpuResultContent(
          state,
          {
            keepItems: this.callbacks.keepItems,
            retry: this.callbacks.retry,
            exit: this.callbacks.exit,
            invalidate: () => this.rebuild(),
          },
          this.stage,
        );
      else this.content.update(state);
      this.content.setFocusVisible(this.focusVisible);
      body.add(this.content.root);
      header.add(this.content.headerCurrency);
      this.controls.push(...this.content.controls);
    } else if (stats) {
      body.add(stats.root);
      frame.add(stack(stats.details, 40));
      stats.setFocusVisible(this.focusVisible);
      this.controls.push(...stats.controls);
    }
    this.fullscreenIcon = new FullscreenIcon();
    this.fullscreenIcon.setActive(this.fullscreenActive);
    const fullscreen = this.button("", () => this.toggleFullscreen?.(), {
      size: "small",
      square: true,
      icon: this.fullscreenIcon,
    });
    this.controls.at(-1)!.enabled = () => !!this.toggleFullscreen;
    this.fullscreenPanel = fullscreen;
    fullscreen.setProperties({ display: this.toggleFullscreen ? "flex" : "none" });
    header.add(stack(fullscreen, 30));
    for (const control of this.controls) if (!control.selfDrawn) this.ring(control);
  }

  /** A content control that draws no focus of its own: an ink ring 3px out, shown on keyboard focus. */
  private ring(control: RunOverlayControl): void {
    const ring = new OutlineRing(8, ui.ink);
    ring.content.setProperties({ display: "none" });
    control.panel.add(stack(ring.content, 2));
    control.outline = ring;
  }

  /** The close key: a square ink key with its Esc badge on the lower-right rim (hidden for touch). */
  private closeKey(): Container {
    const icon = createMenuIcon("close");
    const panel = this.button("", () => this.closeAction(), {
      tone: "ink",
      size: "small",
      square: true,
      icon,
    });
    icon.setProperties({ width: 20, height: 20 });
    if (!this.coarse) {
      const badge = stack(
        new Container({
          positionType: "absolute",
          positionRight: 2,
          positionBottom: -6,
          alignItems: "center",
          justifyContent: "center",
        }),
        3,
      );
      badge.add(new InputGlyph("cancel", "Esc"));
      panel.add(badge);
    }
    // The close key only hovers: a pointer over it does not move the window's focus.
    return stack(panel, 30);
  }

  private rebuild(): void {
    if (this.state) {
      this.signature = "";
      this.update(this.state);
    }
  }
  private initialFocus(): number {
    const state = this.state;
    if (state?.kind === "result") return Math.max(0, this.controls.length - 3);
    // The question opens on 取消: a stray Enter keeps the run.
    if (state?.kind === "pause") return state.quitting ? 2 : 1;
    if (state?.kind === "station") {
      // The first control that can act: opening on a locked one would open its tip with it.
      const first = this.controls.findIndex(
        (c, i) => i !== this.closeIndex && c.enabled() && !c.locked?.(),
      );
      return first >= 0 ? first : this.closeIndex;
    }
    return Math.max(
      0,
      this.controls.findIndex((c) => c.enabled()),
    );
  }
  private closeAction(): void {
    const state = this.state;
    if (!state || this.closing || this.picking) return;
    if (["pause", "stats", "station", "error", "reconnecting"].includes(state.kind))
      getAudio().sfx("ui-back");
    if (state.kind === "pause")
      (state.quitting ? this.callbacks.cancelQuit : this.callbacks.resume)();
    else if (state.kind === "choice" && state.dismissible)
      this.callbacks.send({ t: "choices", open: false });
    else if (state.kind === "stats") this.callbacks.closeStats();
    else if (state.kind === "station") this.callbacks.send({ t: "leave", dialog: state.view.id });
    else if (state.kind === "error" || state.kind === "reconnecting") this.callbacks.exit();
  }
  /** The name plate's entrance: a slanted unroll from the left, 0.4s SNAP. */
  private unrollTitle(): void {
    const reveal = this.titleReveal,
      plate = this.titleSlant;
    if (!reveal || !plate) return;
    this.stage.motion.enter(
      reveal,
      { value: 0 },
      { value: 1 },
      400,
      () => {
        plate.set({ reveal: reveal.value });
        this.stage.invalidate();
      },
      SNAP,
      60,
    );
  }
  private applyTransition = (): void => {
    if (this.frame) fade(this.frame, this.fade.opacity);
    this.frame?.setProperties({
      transformTranslateY: this.entrance.y,
      transformScaleX: this.entrance.scale,
      transformScaleY: this.entrance.scale,
    });
    if (this.content instanceof GpuRunLoading) fade(this.content.root, this.fade.opacity);
    this.dimMaterial.opacity = this.dimOpacity();
    if (!this.userScrolled) this.needsReveal = true;
    this.stage.invalidate();
  };
  /** The choice dims at 52% (lifting as a pick flies), other windows at 45%, loading not at all. */
  private dimOpacity(): number {
    if (this.content instanceof GpuRunLoading || this.choiceOpen) return 0;
    if (this.content instanceof GpuChoiceContent)
      return this.fade.opacity * 0.52 * (1 - this.content.lift);
    return this.fade.opacity * 0.45;
  }
  private get picking(): boolean {
    return this.content instanceof GpuChoiceContent && this.content.picking;
  }
  private animate(show: boolean): void {
    // The choice only fades (run-fade 180ms ease-out).
    if (this.visibleKind === "choice") {
      this.stage.motion.animate(
        this.fade,
        { opacity: show ? 1 : 0 },
        180,
        this.applyTransition,
        (t) => cubicBezier(t, 0, 0, 0.58, 1),
      );
      return;
    }
    // motion.css `.ui-presence`: ui-in 200ms var(--ease-out) from opacity 0 / scale .95; ui-out
    // 160ms ease-in to opacity 0 / scale .96. One curve drives both properties.
    this.stage.motion.animate(
      this.fade,
      { opacity: show ? 1 : 0 },
      show ? 200 : 160,
      this.applyTransition,
      show ? uiEaseOut : easeIn,
    );
    this.stage.motion.animate(
      this.entrance,
      { y: 0, scale: show ? 1 : 0.96 },
      show ? 200 : 160,
      this.applyTransition,
      show ? uiEaseOut : easeIn,
    );
  }

  resize(width: number, height: number, scale: number, safeArea: UiInsets): void {
    this.touchTip = this.tipPress = null;
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.safeArea = { ...safeArea };
    this.stage.resize(width, height, scale, safeArea);
    const v = this.stage.viewport;
    const compact = v.height < 480;
    const edge =
      this.content instanceof GpuRunLoading || this.content instanceof GpuChoiceContent ? 0 : 16;
    // stats-panel.css: the screen edge at the sides, `--edge` (8px in short landscape) above and below.
    const edgeY = this.content instanceof GpuStatsContent ? (compact ? 8 : 16) : edge;
    this.stage.root.setProperties({
      paddingLeft: edge ? edge + v.safeArea.left : 0,
      paddingRight: edge ? edge + v.safeArea.right : 0,
      paddingTop: edgeY ? Math.max(edgeY, v.safeArea.top) : 0,
      paddingBottom: edgeY ? Math.max(edgeY, v.safeArea.bottom) : 0,
    });
    this.dimMesh.scale.set(v.width, v.height, 1);
    if (this.state?.kind === "pause") {
      // Five keys in one column outgrow any landscape phone (844×390 at its 80% stage is ~490
      // tall): short landscape lays them out two to a row under a one-line header.
      const compact = v.width > v.height && v.height < 560;
      this.frame?.setProperties({ width: compact ? 520 : 380 });
      this.headerCopy?.setProperties({
        flexDirection: compact ? "row" : "column",
        flexWrap: compact ? "wrap" : "no-wrap",
        alignItems: compact ? "center" : "stretch",
      });
      this.body?.setProperties({
        flexDirection: compact ? "row" : "column",
        flexWrap: compact ? "wrap" : "no-wrap",
        gap: compact ? 10 : 12,
        paddingX: compact ? 16 : 22,
      });
      const apart = !compact && !this.state.quitting;
      this.controls.forEach((c, i) => {
        if (i !== this.closeIndex && c.panel !== this.fullscreenPanel)
          c.panel.setProperties({
            width: compact ? "46%" : "100%",
            flexGrow: compact ? 1 : 0,
            // The danger action stands apart at the end of the list.
            marginTop: apart && i === this.controls.length - 2 ? 8 : 0,
          });
      });
    }
    if (this.content instanceof GpuStationContent) {
      this.frame?.setProperties({ width: compact ? 680 : 560 });
      this.content.resize(width, height, scale);
    }
    if (this.content instanceof GpuChoiceContent) this.content.resize();
    if (this.content instanceof GpuStatsContent) {
      this.content.resize(compact);
      this.body?.setProperties({ paddingTop: compact ? 4 : 8, paddingX: compact ? 4 : 8 });
      this.body?.setProperties({ paddingBottom: compact ? 4 : 8 });
    } else this.header?.setProperties({ paddingTop: compact ? 8 : 12 });
    for (const button of this.window.buttons) button.fitTouch();
    for (const c of this.controls) {
      if (c.selfDrawn) continue;
      if (
        (this.content instanceof GpuStationContent ||
          this.content instanceof GpuResultContent ||
          this.content instanceof GpuChoiceContent ||
          this.content instanceof GpuStatsContent) &&
        this.content.controls.includes(c)
      )
        continue;
      c.panel.setProperties({ minHeight: v.minTarget, minWidth: v.minTarget });
    }
    const result = this.state?.kind === "result";
    this.titleText?.setProperties({ fontSize: result ? (compact ? 20 : 26) : compact ? 18 : 22 });
    this.titlePlate?.setProperties({
      height: compact ? 38 : result ? 50 : 44,
      paddingX: 18 + slantOf(compact ? 38 : result ? 50 : 44) / 2,
    });
    this.needsReveal = true;
    this.stage.invalidate();
  }
  setCoarsePointer(coarse: boolean): void {
    if (this.coarse === coarse) return;
    this.coarse = coarse;
    if (this.content instanceof GpuChoiceContent) this.content.setCoarsePointer(coarse);
    this.rebuild();
  }
  focus(index: number): void {
    // A pointer over something that cannot take focus (a stat row, a disabled card) leaves the
    // focus where it is; only a newly built window falls back to its initial focus.
    if (this.closing || this.picking || !this.controls[index]?.enabled()) return;
    if (this.selected === index && !this.needsReveal) return;
    if (!this.initializingFocus && this.selected !== index) getAudio().sfx("ui-move");
    this.userScrolled = false;
    this.selected = index;
    for (const [i, c] of this.controls.entries()) {
      c.outline?.content.setProperties({
        display: i === index && this.focusVisible ? "flex" : "none",
      });
      c.setFocused?.(i === index);
    }
    this.needsReveal = true;
    this.reveal();
    this.stage.invalidate();
  }
  /** Keyboard focus is outlined; focus a pointer gave is not (`:focus-visible`). */
  setFocusVisible(visible: boolean): void {
    if (this.focusVisible === visible) return;
    this.focusVisible = visible;
    for (const [i, c] of this.controls.entries())
      c.outline?.content.setProperties({
        display: i === this.selected && visible ? "flex" : "none",
      });
    if (
      this.content instanceof GpuChoiceContent ||
      this.content instanceof GpuStatsContent ||
      this.content instanceof GpuStationContent ||
      this.content instanceof GpuResultContent
    )
      this.content.setFocusVisible(visible);
    for (const button of this.window.buttons) button.setFocusVisible(visible);
    this.stage.invalidate();
  }
  /**
   * Touch tips (ui/Tooltip.tsx): a 450ms press shows a control's tip, a tap on a locked control
   * toggles it, and any press anywhere else, a scroll, Esc or a resize closes it.
   */
  pointerDown(x: number, y: number, touch: boolean): void {
    const index = this.hit(x, y);
    const control = index >= 0 ? this.controls[index] : undefined;
    if (this.touchTip !== null && index !== this.touchTip) this.touchTip = null;
    // A press beside the stat rows takes focus off them (the dialog's own focus), closing a detail.
    if (this.content instanceof GpuStatsContent && !control) this.blur();
    this.tipPress = touch && control?.tip ? { index, at: this.elapsed, x, y, fired: false } : null;
  }
  pointerMove(x: number, y: number): void {
    const press = this.tipPress;
    if (press && !press.fired && Math.hypot(x - press.x, y - press.y) > 10) this.tipPress = null;
  }
  /** True when the press only opened a tip (long press) and must not also activate. */
  pointerUp(touch: boolean): boolean {
    const press = this.tipPress;
    this.tipPress = null;
    if (!press || !touch) return false;
    if (press.fired) return true;
    if (this.controls[press.index]?.locked?.())
      this.touchTip = this.touchTip === press.index ? null : press.index;
    return false;
  }
  /** No control focused: the stats panel opens that way, and a press on its background returns there. */
  private blur(): void {
    if (this.selected < 0) return;
    this.selected = -1;
    for (const c of this.controls) {
      c.outline?.content.setProperties({ display: "none" });
      c.setFocused?.(false);
    }
    this.stage.invalidate();
  }
  hover(index: number | null): void {
    // Window commands are command lists (focus follows the pointer); the close key only hovers.
    // Stat rows are not commands: hovering opens a row's detail but leaves the focus.
    if (
      index !== null &&
      index !== this.closeIndex &&
      this.controls[index] &&
      !(this.content instanceof GpuStatsContent)
    )
      this.focus(index);
    this.hovered = index;
    for (const [i, c] of this.controls.entries()) c.setPointerOver?.(i === index);
  }
  setPressed(index: number | null): void {
    const next =
      !this.closing &&
      !this.picking &&
      index !== null &&
      this.controls[index]?.enabled() &&
      !this.controls[index]!.locked?.()
        ? index
        : null;
    if (next === this.pressedIndex) return;
    this.pressedIndex = next;
    this.controls.forEach((c, i) => {
      const pressed = i === next;
      if (c.setPressed) {
        c.setPressed(pressed);
        return;
      }
      if (c.card !== undefined) return;
      let motion = this.pressMotion.get(c);
      if (!motion) {
        motion = { x: 1, y: 1, shift: 0 };
        this.pressMotion.set(c, motion);
      }
      const close = i === this.closeIndex;
      const target = {
        x: pressed ? (close ? 0.94 : 1.012) : 1,
        y: pressed ? (close ? 0.94 : 0.97) : 1,
        shift: pressed && !close ? 3 : 0,
      };
      const values = motion;
      this.stage.motion.animate(
        values,
        target,
        pressed ? 60 : 140,
        () => {
          c.panel.setProperties({
            transformScaleX: values.x,
            transformScaleY: values.y,
            transformTranslateY: values.shift,
          });
          this.stage.invalidate();
        },
        uiEaseOut,
      );
    });
    this.stage.invalidate();
  }
  activate(index: number): void {
    if (this.closing || this.picking || this.state === null) return;
    if (index === this.controls.length && this.state.kind === "stats") {
      this.closeAction();
      return;
    }
    if (!this.controls[index]?.enabled()) return;
    this.focus(index);
    if (this.controls[index]!.locked?.()) return;
    if (index !== this.closeIndex && !["choice", "stats"].includes(this.state.kind))
      getAudio().sfx("ui-confirm");
    this.controls[index]!.action();
  }
  private contains(node: Container, x: number, y: number): boolean {
    const m = node.globalMatrix.value,
      size = node.size.value;
    if (!m || !size || !node.isVisible.value || node.isClipped.value) return false;
    this.point
      .set(x / this.scale + this.stage.camera.left, this.stage.camera.top - y / this.scale, 0)
      .applyMatrix4(this.inverse.copy(m).invert());
    return Math.abs(this.point.x) <= size[0] / 2 && Math.abs(this.point.y) <= size[1] / 2;
  }
  hit(x: number, y: number): number {
    if (!this.frame || this.closing) return -1;
    if (this.choiceOpen && !this.contains(this.frame, x, y)) return -1;
    // A flying card still owns its dock: another finger must not start a stick through it.
    if (this.picking) return this.choiceOpen ? this.controls.length + 1 : -1;
    const close = this.controls[this.closeIndex];
    if (close && this.contains(close.panel, x, y)) return this.closeIndex;
    const fullscreen = this.controls.findIndex((c) => c.panel === this.fullscreenPanel);
    if (
      fullscreen >= 0 &&
      this.controls[fullscreen]!.enabled() &&
      this.contains(this.fullscreenPanel!, x, y)
    )
      return fullscreen;
    if (!this.contains(this.frame, x, y)) return this.controls.length;
    for (let i = this.controls.length - 1; i >= 0; i--)
      if (
        ((this.choiceOpen && this.controls[i]!.card === undefined) ||
          i === this.closeIndex ||
          (this.content instanceof GpuStatsContent && this.content.isTab(this.controls[i]!)) ||
          (this.body && this.contains(this.body, x, y))) &&
        this.contains(this.controls[i]!.panel, x, y)
      )
        return i;
    if (this.choiceOpen && this.body && !this.contains(this.body, x, y)) return -1;
    return this.controls.length + 1;
  }
  /** A new page starts at its top; focus left on the hidden page moves to the page's tab. */
  private statsPageTurned(): void {
    if (!(this.content instanceof GpuStatsContent) || !this.body) return;
    this.body.scrollPosition.value = [0, 0];
    if (this.selected >= 0 && !this.controls[this.selected]?.enabled())
      this.focus(this.controls.indexOf(this.content.pageTab));
    this.stage.invalidate();
  }
  scroll(delta: number): void {
    if (!this.body || this.closing || this.picking) return;
    this.touchTip = this.tipPress = null;
    this.userScrolled = true;
    const target = this.body;
    const [x, y] = target.scrollPosition.value;
    target.scrollPosition.value = [
      x,
      Math.max(0, Math.min(target.maxScrollPosition.value[1] ?? 0, y + delta / this.scale)),
    ];
    this.stage.invalidate();
  }
  private reveal(): void {
    const c = this.controls[this.selected],
      body = this.body;
    if (!c || !body || this.selected === this.closeIndex || c.panel === this.fullscreenPanel)
      return;
    if (this.choiceOpen) {
      // A card may be taller than the dock. Focus starts at its name; scrolling reads its effects.
      if (c.card !== undefined && !this.userScrolled) body.scrollPosition.value = [0, 0];
      return;
    }
    revealInScroller(c.panel, body, SCROLL_FADE);
  }
  private gridStep(indices: number[], direction: NavigationDirection): number {
    const at = gridStep(
      indices.map((index) => this.controls[index]!.panel),
      indices.indexOf(this.selected),
      direction,
    );
    return indices[at] ?? indices[0]!;
  }

  physicalKey(event: UiKey): boolean {
    if (!this.isModal && !this.choiceOpen) return false;
    if (this.closing || this.picking) return true;
    if (this.state?.kind === "stats" && event.code === "KeyC") {
      this.closeAction();
      return true;
    }
    return this.content instanceof GpuChoiceContent && this.content.physicalKey(event);
  }

  /** The dock leaves movement, camera and skill keys to gameplay, including Space and arrows. */
  choiceKey(event: UiKey): boolean {
    if (!this.choiceOpen) return false;
    const navigation = [
      "Tab",
      "Enter",
      "NumpadEnter",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "Escape",
    ];
    const shortcut = /^(Digit[1-4]|Key[RXZ])$/.test(event.code);
    if (!shortcut && !navigation.includes(event.code)) return false;
    if (!event.repeat) {
      if (shortcut) this.physicalKey(event);
      else this.navigate(navigationAction(event.code, event.shift)!);
    }
    return true;
  }

  /** Called for a frame sampled with the dock open; consume its commands even if it just closed. */
  choiceAction(action: InputAction): boolean {
    if (
      action !== "interact" &&
      action !== "choiceConfirm" &&
      action !== "back" &&
      !isNavigationAction(action)
    )
      return false;
    if (!this.choiceOpen) return true;
    if (action === "interact") {
      if (this.content instanceof GpuChoiceContent) this.content.actionPressed("reroll");
    } else if (action === "choiceConfirm") this.navigate("confirm");
    else if (action === "back") this.navigate("cancel");
    else if (isNavigationAction(action)) this.navigate(action);
    return true;
  }

  navigate(action: NavigationAction): boolean {
    if (!this.isModal && !this.choiceOpen) return false;
    if (this.closing || this.picking) return true;
    // An open touch tip takes the first Esc; the window keeps its own for the next one.
    if (action === "cancel" && this.touchTip !== null) {
      this.touchTip = null;
      return true;
    }
    if (action === "cancel" || (this.state?.kind === "pause" && action === "resume")) {
      this.closeAction();
      return true;
    }
    if (action === "previousPage" || action === "nextPage") {
      const step = action === "previousPage" ? -1 : 1;
      if (this.content instanceof GpuStatsContent) this.content.turn(step);
      else this.scroll(step * 220);
      return true;
    }
    if (
      this.choiceOpen &&
      (action === "down" || action === "up") &&
      this.controls[this.selected]?.card !== undefined &&
      this.body
    ) {
      const y = this.body.scrollPosition.value[1];
      const max = this.body.maxScrollPosition.value[1] ?? 0;
      if ((action === "down" && y < max) || (action === "up" && y > 0)) {
        this.scroll((action === "down" ? 1 : -1) * 44 * this.scale);
        return true;
      }
    }
    if (action === "confirm") this.activate(this.selected);
    else if (
      ["next", "previous", "down", "up", "left", "right", "first", "last"].includes(action)
    ) {
      const enabled = this.controls.map((c, i) => (c.enabled() ? i : -1)).filter((i) => i >= 0);
      if (!enabled.length) return true;
      const navigation = enabled;
      if (isNavigationDirection(action)) this.focus(this.gridStep(navigation, action));
      else if (action === "first") this.focus(navigation[0]!);
      else if (action === "last") this.focus(navigation.at(-1)!);
      else {
        const at = enabled.indexOf(this.selected),
          step = action === "previous" ? -1 : 1;
        this.focus(enabled[(at + step + enabled.length) % enabled.length]!);
      }
    }
    return true;
  }
  afterLayout(deltaMs = 0): void {
    this.elapsed += deltaMs;
    // `Tooltip`: the control under a resting pointer, else the keyboard-focused one.
    const press = this.tipPress;
    if (press && !press.fired && this.elapsed - press.at >= LONG_PRESS_MS) {
      press.fired = true;
      this.touchTip = press.index;
    }
    const touched = this.touchTip !== null ? this.controls[this.touchTip] : undefined;
    const pointed = this.hovered !== null ? this.controls[this.hovered] : undefined;
    const keyed = this.focusVisible ? this.controls[this.selected] : undefined;
    const tipped =
      this.closing || this.picking ? undefined : (touched ?? (pointed?.tip ? pointed : keyed));
    this.tooltip.show(tipped?.tip ? tipped.panel : null, tipped?.tip ?? "");
    this.tooltip.update();
    for (let i = this.leavingWindows.length - 1; i >= 0; i--) {
      const window = this.leavingWindows[i]!;
      window.remaining -= deltaMs;
      if (window.remaining <= 0) {
        window.dispose();
        this.leavingWindows.splice(i, 1);
      }
    }
    if (this.closing) {
      this.exitLeft = Math.max(0, this.exitLeft - deltaMs);
      if (this.exitLeft === 0) {
        this.clearFrame();
        this.signature = "";
        this.dimMaterial.opacity = 0;
      }
    }
    for (const button of this.window.buttons) button.update(deltaMs);
    for (const f of this.scrollFades) if (this.body && f.update(this.body)) this.stage.invalidate();
    if (this.content instanceof GpuChoiceContent) {
      this.content.afterLayout(deltaMs);
      this.dimMaterial.opacity = this.dimOpacity();
    }
    if (this.content instanceof GpuResultContent) this.content.afterLayout(deltaMs);
    if (this.content instanceof GpuStationContent && this.content.afterLayout(deltaMs))
      this.stage.invalidate();
    if (this.content instanceof GpuStatsContent && this.frame) this.content.afterLayout(this.frame);
    const layout = [
      this.body?.size.value,
      this.body?.maxScrollPosition.value,
      ...(!this.userScrolled
        ? [
            this.body?.globalMatrix.value?.elements,
            this.controls[this.selected]?.panel.globalMatrix.value?.elements,
          ]
        : []),
    ]
      .map((x) => x?.join(",") ?? "")
      .join("|");
    if (layout !== this.lastLayout) {
      this.lastLayout = layout;
      this.needsReveal = true;
    }
    if (this.needsReveal) {
      this.reveal();
      this.needsReveal = false;
    }
  }

  private retireFrame(): void {
    const frame = this.frame!;
    const matrix = frame.globalMatrix.value;
    const size = frame.size.value;
    if (matrix && size)
      frame.setProperties({
        positionType: "absolute",
        positionLeft: matrix.elements[12]! - this.stage.camera.left - size[0] / 2,
        positionTop: this.stage.camera.top - matrix.elements[13]! - size[1] / 2,
        width: size[0],
        height: size[1],
      });
    const controls = this.controls;
    const content = this.content;
    const stationArt = this.stationArt;
    this.stationArt = null;
    const window = this.window;
    if (this.titleReveal) this.stage.motion.cancel(this.titleReveal);
    const presses = [...this.pressMotion.values()];
    const opacity = { alpha: this.fade.opacity, y: this.entrance.y, scale: this.entrance.scale };
    const density = 0.45;
    const material = new MeshBasicMaterial({
      color: ui.ink,
      transparent: true,
      opacity: density * opacity.alpha,
      depthTest: false,
      depthWrite: false,
    });
    const dim = new Mesh(this.dimGeometry, material);
    dim.renderOrder = -2;
    dim.scale.copy(this.dimMesh.scale);
    this.stage.scene.add(dim);
    const apply = () => {
      fade(frame, opacity.alpha).setProperties({
        transformTranslateY: opacity.y,
        transformScaleX: opacity.scale,
        transformScaleY: opacity.scale,
      });
      material.opacity = density * opacity.alpha;
      this.stage.invalidate();
    };
    // ui-out: 160ms ease-in to opacity 0 / scale .96, from wherever the window was.
    const leave = { alpha: opacity.alpha, scale: opacity.scale };
    this.stage.motion.animate(
      leave,
      { alpha: 0, scale: 0.96 },
      160,
      () => {
        opacity.alpha = leave.alpha;
        opacity.scale = leave.scale;
        apply();
      },
      easeIn,
    );
    this.leavingWindows.push({
      remaining: 160,
      dispose: () => {
        this.stage.motion.cancel(leave);
        for (const press of presses) this.stage.motion.cancel(press);
        for (const c of controls) {
          c.outline?.content.removeFromParent();
          c.outline?.dispose();
        }
        if (content) {
          content.root.removeFromParent();
          if (content instanceof GpuStationContent || content instanceof GpuResultContent)
            content.headerCurrency.removeFromParent();
          content.dispose();
        }
        stationArt?.dispose();
        for (const button of window.buttons) button.dispose();
        for (const part of window.parts) part.dispose();
        frame.removeFromParent();
        const parts: { dispose(): void }[] = [];
        frame.traverse((o) => {
          if (o instanceof Component) parts.push(o);
        });
        for (const part of parts.reverse()) part.dispose();
        dim.removeFromParent();
        material.dispose();
      },
    });
    this.frame = null;
    this.body = null;
    this.header = null;
    this.headerCopy = null;
    this.titlePlate = null;
    this.titleText = null;
    this.titleReveal = null;
    this.window = noControls();
    this.fullscreenPanel = undefined;
    this.content = null;
    this.pressMotion.clear();
    this.pressedIndex = null;
    apply();
  }

  private clearFrame(preserveContent = false): void {
    this.tooltip.clear();
    this.hovered = this.touchTip = this.tipPress = null;
    // The choice's root is its own frame; its content disposes it.
    const ownFrame = this.frame !== null && this.frame !== this.content?.root;
    this.pressedIndex = null;
    for (const [control, motion] of this.pressMotion) {
      this.stage.motion.cancel(motion);
      control.panel.setProperties({
        transformScaleX: 1,
        transformScaleY: 1,
        transformTranslateY: 0,
      });
    }
    this.pressMotion.clear();
    for (const c of this.controls) {
      c.outline?.content.removeFromParent();
      c.outline?.dispose();
      c.outline = undefined;
    }
    if (this.content) {
      if (!(preserveContent && this.content instanceof GpuChoiceContent))
        this.content.root.removeFromParent();
      if (this.content instanceof GpuStationContent || this.content instanceof GpuResultContent)
        this.content.headerCurrency.removeFromParent();
      if (!preserveContent) {
        this.content.dispose();
        this.content = null;
      }
    }
    for (const f of this.scrollFades.splice(0)) f.dispose();
    this.stationArt?.dispose();
    this.stationArt = null;
    if (this.titleReveal) this.stage.motion.cancel(this.titleReveal);
    for (const button of this.window.buttons) button.dispose();
    for (const part of this.window.parts) part.dispose();
    this.window = noControls();
    this.fullscreenPanel = undefined;
    if (this.frame && ownFrame) {
      const list: { dispose(): void }[] = [];
      this.frame.traverse((o) => {
        if (o instanceof Component) list.push(o);
      });
      for (const c of list.reverse()) c.dispose();
      this.frame.removeFromParent();
    }
    this.frame = null;
    this.body = null;
    this.header = null;
    this.headerCopy = null;
    this.titlePlate = null;
    this.titleText = null;
    this.titleReveal = null;
  }
  /** Context lost: free GPU copies, including card art no mounted card holds right now. */
  releaseUploads(): void {
    this.stage.releaseUploads();
  }
  /**
   * From the loading screen on, builds the next sample window in its own unseen copy (one a frame)
   * and hands its stage to `compile`, so no window compiles a program when it first opens. A copy
   * lives until its programs are ready.
   */
  warmUp(compile: (stage: UiStage) => Promise<unknown>): void {
    if (!this.warmSamples && this.state?.kind === "loading")
      this.warmSamples = runWindowSamples(this.state.starter);
    const sample = this.warmSamples?.shift();
    if (!sample) return;
    const copy = new GpuRunOverlays(this.fonts, inertCallbacks);
    copy.resize(this.width, this.height, this.scale, this.safeArea);
    copy.update(sample);
    copy.stage.update(0);
    copy.afterLayout(0);
    this.warming.add(copy);
    const done = () => {
      if (this.warming.delete(copy)) copy.dispose();
    };
    // An Image compiles its textured program only once its texture has arrived: the copy's
    // pictures first, then a layout pass with them, then the compile and warm draw.
    void images()
      .uploaded()
      .then(() => {
        copy.stage.update(0);
        return compile(copy.stage);
      })
      .then(done, done);
  }

  dispose(): void {
    // A copy still compiling is released with its run; its programs are already retained.
    for (const copy of this.warming) copy.dispose();
    this.warming.clear();
    this.clearFrame();
    for (const window of this.leavingWindows) window.dispose();
    this.leavingWindows.length = 0;
    this.dimMesh.removeFromParent();
    this.dimGeometry.dispose();
    this.dimMaterial.dispose();
    this.cardArt.dispose();
    this.tooltip.dispose();
    this.stage.dispose();
  }
}
