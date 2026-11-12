import { setGlyphInputMode } from "./input-glyph";
import { advanceIdleClock } from "./motion";
import { setImageLoader } from "@pmndrs/uikit";
import { SRGBColorSpace, WebGLRenderTarget, type Material, type Texture } from "three";
import { bindImages, type ImageStore } from "../../prepare/images";
import type { FontFamilies } from "@pmndrs/uikit";
import type { RunHandle } from "../../run/createRun";
import type { GpuRunHud } from "./run-hud";
import type { GpuRunOverlays } from "./run-overlays";
import { getAudio, UI_SOUNDS } from "../../audio/engine";
import type { Settings } from "../../settings";
import { uiFonts } from "./fonts";
import type { GpuCodex } from "./codex";
import { MenuInput, type MenuInputTarget } from "./menu-input";
import { SettingsDialog } from "./settings-dialog";
import { setUiPixelRatio, UiStage } from "./stage";
import type { AppRenderer } from "../../rendering/app-renderer";
import { fitScale, type UiInsets } from "./viewport";
import { GpuShell } from "./app-shell";
import { GpuLobby } from "./lobby";
import { playableStages } from "../../lobbyPick";
import { GpuLab } from "./lab";
import { emptyProgress } from "../../run/progress";
import { starterOrder } from "../../run/sim/content/lines/index";
import { GpuToast } from "./toast";
import type { UiSurface, UiPointer, UiKey } from "../../platform/ui-surface";
import type { SceneTransitionPhase } from "../scene-transition";
import {
  isNavigationAction,
  navigationAction,
  type NavigationAction,
  type ActionInput,
  type GameplayAction,
  type InputMode,
} from "../../platform/input";

const INSTALL_HINT = "添加到主屏幕，隐藏浏览器栏";

export interface GpuAppCallbacks {
  openSettings(): void;
  closeSettings(): void;
  changeSettings(settings: Settings): void;
  openSave?(): void;
  error(error: Error): void;
  modalActive(active: boolean): void;
  /** The toast's close key, or its time ran out. */
  dismissNotification(): void;
  /** A local failure the player should hear about (the app keeps running). */
  notify(message: string): void;
}
export interface GpuAppState {
  settingsOpen: boolean;
  settings: Settings;
  canSave: boolean;
  busy: boolean;
  transition: SceneTransitionPhase;
  /** A new `id` shows the message again, even when the text repeats. */
  notification: { id: number; message: string } | null;
}
/** A full screen (大厅, 研究所, the save window): the host draws it, routes input to it and keeps it sized. */
export interface GpuScreen extends MenuInputTarget {
  readonly stage: UiStage;
  /** The smallest logical size (CSS px at 100%) its layout is drawn for. The host holds the UI
   *  scale back so the screen never gets less; in-run windows keep the user's scale. */
  readonly minLayout: { width: number; height: number };
  navigate(action: NavigationAction): boolean;
  /** Literal text and screen-specific physical shortcuts, before shared navigation. */
  physicalKey?(event: UiKey): boolean;
  resize(width: number, height: number, scale: number, insets: UiInsets): void;
  afterLayout(deltaMs: number): void;
  setFocusVisible(visible: boolean): void;
  setCoarsePointer(coarse: boolean): void;
  setFullscreenAction?(action: (() => void) | undefined, active: boolean): void;
  pointerDown(x: number, y: number, touch: boolean): void;
  pointerMove(x: number, y: number): void;
  /** The next Tab (Shift+Tab) would wrap; a shown toast's close key is the stop past it. */
  tabEdge?(shift: boolean): boolean;
  /** True when the press only opened a tip and must not also activate. */
  pointerUp(touch: boolean): boolean;
  releaseUploads(): void;
  /** Given a way to hand the keyboard back to the canvas (a screen with a native field). */
  bindFocus?(focus: () => void): void;
  /** A window (the save window): drawn over the toast and the settings window, which it blocks. */
  readonly modal?: boolean;
  /** Anything is drawn over it (portrait notice, curtain, a window or screen above): a native
   *  field it owns must not show through. */
  setCovered?(covered: boolean): void;
  /** Until the first screen's text has arrived only its backdrop shows (the boot screen). */
  setRevealed?(revealed: boolean): void;
}
export interface GpuAppHost {
  readonly inputMode: InputMode;
  sampleInput(): void;
  inspect(): {
    dialog: SettingsDialog | undefined;
    codex: GpuCodex | undefined;
    screens: readonly GpuScreen[];
    lobby: GpuLobby | undefined;
    run: { hud: GpuRunHud; overlays: GpuRunOverlays } | undefined;
  };
  readonly fonts: FontFamilies;
  /** The coastal art the screens paint, one upload for all of them. */
  readonly backdrop: Texture;
  /** Shows `screen` over any screen already shown (the save window over 研究所) until the
   *  returned function is called; the top one takes input. Its owner disposes it. */
  registerScreen(screen: GpuScreen): () => void;
  /**
   * Settles once the next screen registered after this call is ready to draw (programs compiled,
   * font pages and images uploaded), or the host fails or goes. The scene curtain holds on it.
   */
  nextScreenReady(): Promise<void>;
  /** Settles once the first screen (the lobby) is revealed with its text and images: what loads
   *  only for later (the lobby's run prefetch, the menu music) starts then, off the first screen's link. */
  readonly revealed: Promise<void>;
  registerRun(hud: GpuRunHud, overlays: GpuRunOverlays, controller: RunHandle | null): () => void;
  /** Opens the 图鉴 over whatever is shown (the lobby, or a paused run's window). */
  openCodex(): void;
  update(state: GpuAppState): void;
  dispose(): void;
}

/** Application-lifetime UI: the app renderer's UI client, drawn over the world on its one canvas. */
/** An aborted creation (its owner went away while the backdrop loaded) rejects with an AbortError
 *  and never touches the canvas or registers with `app`. */
export async function createGpuAppHost(
  app: AppRenderer,
  platform: UiSurface,
  actions: ActionInput,
  callbacks: GpuAppCallbacks,
  signal: AbortSignal,
): Promise<GpuAppHost> {
  let renderer = app.renderer;
  const base = platform.base;
  // Until the host is up, a font failure is a failed start like any other.
  let fail: (error: Error) => void = (error) => callbacks.error(error);
  const fonts = uiFonts(base, app, (error) => fail(error));
  const images = imageStoreOf(app);
  // The sounds every screen plays: part of the first screen's needs, held for the host's life.
  const uiSounds = getAudio().acquire(UI_SOUNDS, "interactive");
  // Every uikit Image with a URL source draws a view of the shared Source: one upload per image,
  // held for the page, instead of a texture (and an upload) per Image instance.
  setImageLoader(
    (src) =>
      new Promise((resolve) => {
        const view = images.texture(src, "art", () => resolve(view));
      }),
  );
  // A view right away; the screens that paint it are held until it is uploaded (`prepare`).
  const texture = images.texture("/art/lobby/backdrop.webp", "art", () => app.invalidate());
  await Promise.resolve();
  if (signal.aborted) {
    texture.dispose();
    uiSounds.release();
    platform.dispose();
    throw signal.reason;
  }
  // Over everything: the scene transition and the portrait notice; under the windows: the toast.
  platform.present?.(false, false, 40);
  const shell = new GpuShell(fonts.families);
  // The 添加到主屏幕 hint is the host's own toast: shown once the lobby is up in landscape, until
  // it is closed, times out or a notification takes its place.
  let hint: "due" | "shown" | "done" = "done";
  const toast = new GpuToast(fonts.families, () => {
    if (hint !== "shown") return callbacks.dismissNotification();
    hint = "done";
    toast.setMessage(null);
  });
  let toastId = -1;
  let portrait = platform.display.portrait;
  const showHint = () => {
    if (hint !== "due" || portrait || destroyed || failed) return;
    hint = "done";
    if (!platform.claimInstallHint?.()) return;
    hint = "shown";
    toast.setMessage(INSTALL_HINT, 8000, "hint");
    syncCanvas();
    forceDraw = true;
  };
  shell.setPortrait(portrait);
  let coarse = platform.display.coarsePointer;
  let inputMode: InputMode = coarse ? { kind: "touch" } : { kind: "keyboardMouse", pointer: false };
  let state: GpuAppState | undefined;
  let dialog: SettingsDialog | undefined;
  let dialogSettings: Settings | undefined;
  let dialogCanSave = false;
  let codex: GpuCodex | undefined;
  let codexLoading = false;
  /** Shown screens, bottom first; the last takes input. */
  const screens: GpuScreen[] = [];
  const prepared = new WeakSet<GpuScreen>();
  let screen: GpuScreen | undefined;
  let closing = false;
  let destroyed = false;
  let contextLost = false;
  let failed = false;
  let forceDraw = true;
  let modalActive = false;
  const notifyModal = (active: boolean) => {
    if (modalActive === active) return;
    modalActive = active;
    callbacks.modalActive(active);
  };
  let lastSize = "";
  const pointers = new Set<number>();
  const hudPointers = new Set<number>();
  const mapPointers = new Map<number, { x: number; y: number }>();
  let worldPointer: { id: number; x: number; y: number; moved: boolean } | undefined;
  let runLayer:
    | { hud: GpuRunHud; overlays: GpuRunOverlays; controller: RunHandle | null }
    | undefined;
  let runModal = false;
  let runBlocked = false;
  /** The full map blocks the HUD's controls, not movement: opening it keeps held input. */
  const runInputBlocked = () => !!runLayer?.hud.inputBlocked && !runLayer.controller?.mapOpen;
  // `:focus-visible`: focus is drawn after keyboard input and hidden after pointer input. Starts
  // shown, as a browser shows a page's initial programmatic focus before any pointer use.
  let focusVisible = true;
  const showFocus = (visible: boolean) => {
    if (focusVisible === visible) return;
    focusVisible = visible;
    dialog?.setFocusVisible(visible);
    codex?.setFocusVisible(visible);
    for (const shown of screens) shown.setFocusVisible(visible);
    runLayer?.hud.setFocusVisible(visible);
    runLayer?.overlays.setFocusVisible(visible);
  };
  const setInputMode = (mode: InputMode) => {
    const wasTouch = inputMode.kind === "touch";
    inputMode = mode;
    setGlyphInputMode(mode);
    const touch = mode.kind === "touch";
    showFocus(mode.kind === "gamepad" || (mode.kind === "keyboardMouse" && !mode.pointer));
    platform.setCursor(mode.kind === "keyboardMouse" && mode.pointer);
    if (wasTouch !== touch) {
      cancelInput();
      dialog?.setCoarsePointer(touch);
      codex?.setCoarsePointer(touch);
      for (const shown of screens) shown.setCoarsePointer(touch);
      runLayer?.overlays.setCoarsePointer(touch);
      runLayer?.hud.setCoarsePointer(touch);
    }
  };
  actions.onActivity = setInputMode;
  actions.onUnsupported = (name) => {
    console.warn("Gamepad has no standard mapping:", name);
    callbacks.notify("手柄尚无映射");
  };
  // A surface still compiling its programs is not drawn yet, so it cannot take input either.
  const activeTarget = () => {
    if (shell.blocking) return undefined;
    // A closing settings window is only an exit animation (the save window may already be over it).
    const target =
      (closing ? undefined : dialog) ??
      codex ??
      (!state?.busy && (runLayer?.overlays.isModal || runLayer?.overlays.choiceOpen)
        ? runLayer.overlays
        : screen && !state?.busy
          ? screen
          : undefined);
    const stage =
      target === dialog
        ? dialog?.stage
        : target && target === codex
          ? codex.stage
          : target && target === runLayer?.overlays
            ? runLayer.overlays.stage
            : target && target === screen
              ? screen.stage
              : undefined;
    return stage && compiling.has(stage) ? undefined : target;
  };
  let hovered: ReturnType<typeof activeTarget>;
  let pressedTarget: ReturnType<typeof activeTarget>;
  let pressedRevision = -1;
  const targetRevision = (target: ReturnType<typeof activeTarget>) =>
    target && target === runLayer?.overlays ? target.revision : -1;
  // Set by a wheel scroll: the next frame hit-tests the resting mouse again on the moved content.
  let rehover = false;
  const input = new MenuInput({
    hit: (x, y) => activeTarget()?.hit(x, y) ?? -1,
    hover: (index) => {
      const target = activeTarget();
      if (hovered !== target) hovered?.hover(null);
      hovered = index === null ? undefined : target;
      target?.hover(index);
    },
    focus: (index) => activeTarget()?.focus(index),
    activate: (index) => activeTarget()?.activate(index),
    scroll: (delta) => activeTarget()?.scroll(delta),
    setPressed: (index) => activeTarget()?.setPressed(index),
  });
  // The toast takes its own presses; it is not modal, so the surface under it keeps its input. It
  // lies under every window, so a window takes the presses over it.
  const toastInput = new MenuInput({
    hit: (x, y) => (dialog || codex || shell.blocking || screen?.modal ? -1 : toast.hit(x, y)),
    hover: (index) => toast.setHovered(index),
    focus: () => {},
    activate: (index) => toast.activate(index),
    scroll: () => {},
    setPressed: (index) => toast.setPressed(index),
  });
  const cancelInput = () => {
    actions.cancel();
    toastInput.cancel();
    toast.setHovered(null);
    input.cancel();
    codex?.pointerUp(undefined, false);
    for (const shown of screens) shown.pointerUp(false);
    runLayer?.overlays.pointerUp(false);
    hovered?.hover(null);
    hovered = undefined;
    runLayer?.hud.cancel();
    runLayer?.hud.setStick(null);
    runLayer?.controller?.cancelInput();
    hudPointers.clear();
    mapPointers.clear();
    worldPointer = undefined;
    for (const id of pointers) platform.release(id);
    pointers.clear();
  };
  /** The user's UI scale, held back where it would leave a screen less than its `minLayout`. */
  // Never under the settings' 80% floor: where even that does not fit, the screen takes its
  // dense layout (touch targets stay ≥ 44px).
  // A run's HUD, its windows and the world's map overlays share one scale: the smallest phone
  // landscape the HUD is laid out for keeps its rows and windows apart.
  const runLayout = { minLayout: { width: 667, height: 375 } };
  let runScale = 1;
  const screenScale = (
    target: Pick<GpuScreen, "minLayout">,
    width: number,
    height: number,
    insets: UiInsets,
  ) => fitScale(state?.settings.uiScale ?? 1, width, height, insets, target.minLayout);
  const syncCanvas = () => {
    const owns = !!(dialog || codex || runLayer || screen) || shell.blocking;
    const visible = !failed && (owns || toast.visible);
    platform.present?.(visible, visible && owns, shell.blocking ? 1000 : dialog || codex ? 80 : 40);
  };
  const safeArea = (): UiInsets => platform.display.insets;
  const resize = () => {
    if (!state || destroyed) return;
    const fullscreen = platform.fullscreen;
    dialog?.setFullscreenAction(fullscreen?.toggle, fullscreen?.active ?? false);
    for (const shown of screens)
      shown.setFullscreenAction?.(fullscreen?.toggle, fullscreen?.active ?? false);
    runLayer?.hud.setFullscreenAction(fullscreen?.toggle, fullscreen?.active ?? false);
    runLayer?.overlays.setFullscreenAction(fullscreen?.toggle, fullscreen?.active ?? false);
    const { width, height, pixelRatio: dpr } = platform.display;
    const insets = safeArea(),
      size = [width, height, dpr, state.settings.uiScale, ...Object.values(insets)].join(",");
    if (size === lastSize) return;
    lastSize = size;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    setUiPixelRatio(dpr);
    dialog?.resize(width, height, insets);
    codex?.resize(width, height, screenScale(codex, width, height, insets), insets);
    for (const shown of screens)
      shown.resize(width, height, screenScale(shown, width, height, insets), insets);
    shell.resize(width, height, state.settings.uiScale, insets);
    toast.resize(width, height, state.settings.uiScale, insets);
    runScale = screenScale(runLayout, width, height, insets);
    runLayer?.hud.resize(width, height, runScale, insets);
    runLayer?.overlays.resize(width, height, runScale, insets);
    runLayer?.controller?.resizeUi(width, height, runScale, insets);
    forceDraw = true;
  };
  const closeDialog = () => {
    if (!dialog || closing) return;
    cancelInput();
    dialog.close();
    closing = true;
    forceDraw = true;
  };
  const sameSettings = (a: Settings | undefined, b: Settings) =>
    a?.sound === b.sound && a.devMode === b.devMode && a.uiScale === b.uiScale;
  const createDialog = () => {
    if (!state) return;
    dialogSettings = { ...state.settings };
    dialogCanSave = state.canSave;
    closing = false;
    dialog = new SettingsDialog(fonts.families, {
      settings: state.settings,
      onFocusChange: () => getAudio().sfx("ui-move"),
      onChange(next) {
        if (!state) return;
        if (!sameSettings(dialogSettings, next)) getAudio().sfx("ui-confirm");
        dialogSettings = { ...next };
        state = { ...state, settings: { ...next } };
        callbacks.changeSettings(next);
        lastSize = "";
        resize();
      },
      onClose: () => {
        getAudio().sfx("ui-back");
        closeDialog();
        callbacks.closeSettings();
      },
      ...(state.canSave && callbacks.openSave
        ? {
            // Settings leaves as the save window enters: no wait between them.
            onSave: () => {
              getAudio().sfx("ui-confirm");
              closeDialog();
              callbacks.closeSettings();
              callbacks.openSave!();
            },
          }
        : {}),
    });
    dialog.setFullscreenAction(platform.fullscreen?.toggle, platform.fullscreen?.active ?? false);
    notifyModal(true);
    dialog.setCoarsePointer(inputMode.kind === "touch");
    dialog.setFocusVisible(focusVisible);
    const insets = safeArea();
    dialog.resize(platform.display.width, platform.display.height, insets);
    forceDraw = true;
  };
  // From the lobby, or over a paused run's window (the run waits under it and takes input back).
  const codexHome = () => !!screen || runLayer?.overlays.codexHome != null;
  const openCodex = () => {
    if (!state || state.busy || !codexHome() || dialog || codex || codexLoading) return;
    cancelInput();
    getAudio().sfx("ui-confirm");
    codexLoading = true;
    const homeScreen = screen;
    const homeRun = runLayer;
    const homeWindow = homeRun?.overlays.codexHome;
    const stillHome = () =>
      !destroyed &&
      !failed &&
      screen === homeScreen &&
      runLayer === homeRun &&
      homeRun?.overlays.codexHome === homeWindow;
    // The 图鉴 and its content tables load on first use, never with the first screen.
    void import("./codex").then(
      ({ GpuCodex }) => {
        codexLoading = false;
        if (!stillHome() || !state || state.busy || dialog) return;
        const opened = new GpuCodex(fonts.families, {
          onClose: () => {
            getAudio().sfx("ui-back");
            cancelInput();
            opened.closeWindow();
            forceDraw = true;
          },
        });
        codex = opened;
        notifyModal(true);
        opened.setCoarsePointer(inputMode.kind === "touch");
        opened.setFocusVisible(focusVisible);
        const { width, height } = platform.display;
        const insets = safeArea();
        opened.resize(width, height, screenScale(opened, width, height, insets), insets);
        syncCanvas();
        forceDraw = true;
        platform.focus();
      },
      // A missing chunk (offline, a new deploy) is the 图鉴's own failure: the lobby stays, the
      // player is told, and the next 图鉴 tries the download again.
      (error: unknown) => {
        codexLoading = false;
        if (!stillHome()) return;
        console.error("图鉴载入失败", error);
        callbacks.notify("图鉴载入失败，请检查网络后再试。");
      },
    );
  };
  const capture = (id: number) => {
    pointers.add(id);
    platform.capture(id);
  };
  const onDown = (event: UiPointer) => {
    const takeTouch = event.kind !== "mouse" && inputMode.kind !== "touch" && !!runLayer;
    setInputMode(
      event.kind === "mouse" ? { kind: "keyboardMouse", pointer: true } : { kind: "touch" },
    );
    if (takeTouch) return true;
    showFocus(false);
    if (!state || failed || event.button !== 0 || contextLost || state.busy) return false;
    platform.focus();
    const { x, y } = event;
    if (shell.blocking) return true;
    syncInputOwner();
    if (toastInput.down(event.id, x, y)) {
      capture(event.id);
      return true;
    }
    const target = activeTarget();
    const dock = !!runLayer && target === runLayer.overlays && runLayer.overlays.choiceOpen;
    if (target && (!dock || target.hit(x, y) >= 0)) {
      if (target === runLayer?.overlays)
        runLayer.overlays.pointerDown(x, y, event.kind !== "mouse");
      if (target === codex) codex.pointerDown(event.id, x, y, event.kind !== "mouse");
      if (target === screen) screen.pointerDown(x, y, event.kind !== "mouse");
      if (input.down(event.id, x, y)) {
        pressedTarget = target;
        pressedRevision = targetRevision(target);
        capture(event.id);
        return true;
      }
      // A second touch in the dock is consumed even while another finger owns its card.
      if (dock) return true;
    }
    if ((!target || dock) && runLayer) {
      const controller = runLayer.controller;
      // The open map keeps the stick: a touch steers, and only a tap closes it.
      if (controller?.mapHit(x, y) && (event.kind === "mouse" || !controller.mapOpen)) {
        mapPointers.set(event.id, { x, y });
        capture(event.id);
      } else if (runLayer.hud.down(event.id, x, y)) {
        hudPointers.add(event.id);
        capture(event.id);
      } else if (event.kind !== "mouse" && !worldPointer) {
        worldPointer = { id: event.id, x, y, moved: false };
        capture(event.id);
        runLayer.hud.setStick({ x, y });
        actions.move(0, 0);
      }
      return true;
    }
    return false;
  };
  const onMove = (event: UiPointer) => {
    if (event.kind === "mouse" && event.moved)
      setInputMode({ kind: "keyboardMouse", pointer: true });
    if (contextLost || state?.busy) return;
    const { x, y } = event;
    toastInput.move(event.id, x, y, event.kind === "mouse");
    if (hudPointers.has(event.id)) {
      runLayer?.hud.move(event.id, x, y);
    } else if (worldPointer?.id === event.id && runLayer) {
      let dx = x - worldPointer.x,
        dy = y - worldPointer.y;
      const length = Math.hypot(dx, dy),
        radius = 52 * runScale;
      if (length > radius) {
        dx *= radius / length;
        dy *= radius / length;
      }
      if (length > 8) worldPointer.moved = true;
      runLayer.hud.setStick(worldPointer, dx, dy);
      actions.move(length < 8 ? 0 : dx / radius, length < 8 ? 0 : dy / radius);
    } else if (activeTarget()) {
      if (activeTarget() === runLayer?.overlays) runLayer!.overlays.pointerMove(x, y);
      if (activeTarget() === codex) codex!.pointerMove(event.id, x, y);
      if (activeTarget() === screen) screen!.pointerMove(x, y);
      input.move(event.id, x, y, event.kind === "mouse");
    } else if (event.kind === "mouse" && runLayer) {
      const index = runLayer.hud.hit(x, y);
      runLayer.hud.hover(index >= 0 ? index : null);
      if (index >= 0) runLayer.hud.focus(index);
    }
  };
  const releasedOnTip = (
    target: ReturnType<typeof activeTarget>,
    pointerId: number,
    touch: boolean,
  ): boolean => {
    if (!target) return false;
    if (target === runLayer?.overlays) return target.pointerUp(touch);
    if (target === codex) return codex.pointerUp(pointerId, touch);
    if (target === screen) return screen.pointerUp(touch);
    return false;
  };
  const release = (event: UiPointer, cancelled: boolean) => {
    const { x, y } = event;
    if (cancelled) toastInput.cancel(event.id);
    else toastInput.up(event.id, x, y);
    const mapPress = mapPointers.get(event.id);
    if (mapPress) {
      mapPointers.delete(event.id);
      if (!cancelled && Math.hypot(x - mapPress.x, y - mapPress.y) <= 8)
        runLayer?.controller?.mapActivate(x, y);
    } else if (hudPointers.delete(event.id)) runLayer?.hud.up(event.id, x, y, cancelled);
    else if (worldPointer?.id === event.id) {
      if (!cancelled && !worldPointer.moved && runLayer?.controller?.mapOpen)
        runLayer.controller.mapActivate(x, y);
      worldPointer = undefined;
      runLayer?.hud.setStick(null);
      actions.move(0, 0);
    } else if (
      // A long press that opened a tip must not also activate its control. No target (a scene
      // change began under the press) is not "the run window" or "the screen", which may be gone.
      releasedOnTip(activeTarget(), event.id, !cancelled && event.kind !== "mouse") ||
      activeTarget() !== pressedTarget ||
      targetRevision(activeTarget()) !== pressedRevision ||
      cancelled
    )
      input.cancel(event.id);
    else input.up(event.id, x, y);
    // A cancelled press never reaches the codex above; it must still stop turning the model.
    codex?.pointerUp(event.id, false);
    pointers.delete(event.id);
    platform.release(event.id);
  };
  const onUp = (event: UiPointer) => release(event, false);
  const onCancel = (event: UiPointer) => release(event, true);
  const onLeave = () => {
    platform.setCursor(true);
    toastInput.leave();
    input.leave();
  };
  // The toast's close key follows the last control of the surface under it in Tab order, as the
  // original's DOM order put it; it never takes focus by itself. Windows and runs keep their own.
  const toastRing = () =>
    !toast.visible || dialog || codex || runLayer || state?.busy || contextLost
      ? undefined
      : screen && !screen.modal
        ? screen
        : undefined;
  let toastOwner: ReturnType<typeof toastRing>;
  const leaveToast = () => {
    if (!toastOwner) return;
    toast.focus(null);
    toastOwner.setFocusVisible(focusVisible);
    toastOwner = undefined;
  };
  /** True when navigation belonged to the toast. */
  const toastNavigation = (action: NavigationAction): boolean => {
    const ring = toastRing();
    if (toastOwner && toastOwner !== ring) leaveToast();
    if (!ring) return false;
    if (toast.keyed) {
      if (toast.navigate(action)) return true;
      // Any other key goes back to the surface; Tab wraps there to its first (last) control.
      leaveToast();
      return false;
    }
    if ((action !== "next" && action !== "previous") || !ring.tabEdge?.(action === "previous"))
      return false;
    toastOwner = ring;
    ring.setFocusVisible(false);
    toast.focus(0);
    return true;
  };
  const keyboardNavigation = (
    target: { navigate(action: NavigationAction): boolean; physicalKey?(event: UiKey): boolean },
    event: UiKey,
    action: NavigationAction | undefined,
  ): boolean => target.physicalKey?.(event) || (action !== undefined && target.navigate(action));
  const onKey = (event: UiKey) => {
    if (!state || failed) return false;
    if (!event.repeat) setInputMode({ kind: "keyboardMouse", pointer: false });
    syncInputOwner();
    if (!actions.observeKey(event.code, event.repeat)) return true;
    if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) showFocus(true);
    if (event.code === "F8" && !state.busy && !contextLost && !shell.blocking) {
      if (!event.repeat)
        callbacks.changeSettings({ ...state.settings, devMode: !state.settings.devMode });
      return true;
    }
    const action = navigationAction(event.code, event.shift);
    if (
      state.busy ||
      contextLost ||
      shell.blocking ||
      (action !== undefined && toastNavigation(action))
    )
      return true;
    if (action === undefined) leaveToast();
    const target = activeTarget();
    if (target && target !== runLayer?.overlays)
      return keyboardNavigation(target, event, action) || target === dialog || target === codex;
    // A window waiting for its resources still blocks what is underneath. Exit trees do not.
    if (!target && ((!closing && dialog) || codex || (!runLayer && screen))) return true;
    if (runLayer) {
      return runLayer.overlays.isModal
        ? (event.repeat &&
            [
              "Digit1",
              "Digit2",
              "Digit3",
              "Digit4",
              "KeyR",
              "KeyX",
              "KeyZ",
              "Escape",
              "KeyP",
              "KeyC",
              "ArrowUp",
              "ArrowDown",
              "ArrowLeft",
              "ArrowRight",
              "Home",
              "End",
            ].includes(event.code)) ||
            !target ||
            keyboardNavigation(target, event, action)
        : (target === runLayer.overlays && runLayer.overlays.choiceKey(event)) ||
            (!runLayer.overlays.choiceOpen &&
              (event.key === "Tab" || event.key === "Enter") &&
              action !== undefined &&
              runLayer.hud.navigate(action)) ||
            (runLayer.controller?.keyDown(event.code, event.repeat) ?? false) ||
            actions.keyDown(event.code, event.repeat);
    }
    return false;
  };
  const onKeyUp = (event: UiKey) => {
    actions.keyUp(event.code);
  };
  const onBlur = () => {
    platform.setCursor(true);
    cancelInput();
    runLayer?.controller?.blur();
  };
  const onWheel = (delta: number) => {
    if (delta) setInputMode({ kind: "keyboardMouse", pointer: true });
    if (contextLost) return true;
    if (!activeTarget()) return false;
    activeTarget()?.scroll(delta);
    rehover = true;
    return true;
  };
  const onPortrait = () => {
    shell.setPortrait(portrait);
    showHint();
    cancelInput();
    syncCanvas();
    forceDraw = true;
    if (portrait) platform.focus();
  };
  const onPointerKind = () => {
    dialog?.setCoarsePointer(inputMode.kind === "touch");
    codex?.setCoarsePointer(inputMode.kind === "touch");
    for (const shown of screens) shown.setCoarsePointer(inputMode.kind === "touch");
    runLayer?.hud.setCoarsePointer(inputMode.kind === "touch");
    runLayer?.overlays.setCoarsePointer(inputMode.kind === "touch");
  };
  const onContextLost = () => {
    contextLost = true;
    retention.dispose();
    // Nothing is drawn until the restore: no native field floats over a blank canvas.
    for (const shown of screens) shown.setCovered?.(true);
    // Release while the old context is lost, before Three replaces its upload managers.
    // Traversal includes hidden stages and still-mounted exit animations; it never detaches UI.
    shell.releaseUploads();
    toast.stage.releaseUploads();
    dialog?.stage.releaseUploads();
    codex?.releaseUploads();
    for (const shown of screens) shown.releaseUploads();
    runLayer?.hud.stage.releaseUploads();
    runLayer?.overlays.releaseUploads();
    // Programs die with the context: nothing is compiling any more, and every surface is
    // prepared again (and its programs retained again) once the restored context draws.
    compiling.clear();
    preparing.clear();
    preparedHud = undefined;
    preparedOverlays = -1;
    preparedDialog = undefined;
    preparedCodex = undefined;
    for (const shown of screens) prepared.delete(shown);
    cancelInput();
    syncCanvas();
  };
  const onContextRestored = () => {
    renderer = app.renderer;
    retention = renderer.createProgramRetention();
    contextLost = false;
    lastSize = "";
    resize();
    shell.stage.invalidate();
    toast.stage.invalidate();
    dialog?.stage.invalidate();
    codex?.stage.invalidate();
    for (const shown of screens) shown.stage.invalidate();
    runLayer?.hud.stage.invalidate();
    runLayer?.overlays.stage.invalidate();
    forceDraw = true;
    syncCanvas();
  };
  const unregisterResident = app.resident({ release: onContextLost, restore: onContextRestored });
  const stopInput = platform.listen({
    down: onDown,
    move: onMove,
    up: onUp,
    cancel: onCancel,
    leave: onLeave,
    keyDown: onKey,
    keyUp: onKeyUp,
    wheel: onWheel,
    cancelInput,
    blur: onBlur,
    displayChanged() {
      const display = platform.display;
      if (portrait !== display.portrait) {
        portrait = display.portrait;
        onPortrait();
      }
      if (coarse !== display.coarsePointer) {
        coarse = display.coarsePointer;
        onPointerKind();
      }
      resize();
    },
  });
  // UI programs form a small fixed set. Three deletes a program with its last material, so every
  // window would recompile on each open; the host keeps them for the application instead. Kept by
  // attribution: every program a UI stage's materials have linked (a material whose program key
  // changes between runs keeps each one), never the world's, which go with its run.
  let retention = renderer.createProgramRetention();
  const seenPrograms = new WeakSet<object>();
  const retainPrograms = (stage: UiStage) =>
    stage.scene.traverse((object) => {
      const material = (object as { material?: Material | Material[] }).material;
      for (const one of Array.isArray(material) ? material : material ? [material] : [])
        retention.retain(one);
    });
  // A newly built surface compiles its new programs before its first draw; meanwhile its clock
  // holds, so a compile stall can neither show as a frozen frame nor eat its entrance.
  const compiling = new Set<UiStage>();
  /** Each held target's current preparation: only it may release the hold. */
  const preparing = new Map<UiStage, { token: symbol; done: Promise<void> }>();
  const failure = (error: unknown) => {
    // A stage released while it waited (its owner went) is not a failure.
    if (error instanceof DOMException && error.name === "AbortError") return;
    fail(error instanceof Error ? error : new Error(String(error)));
  };
  // A surface is not drawn before every font page its text uses (fonts.ready, readiness design
  // §6a) and every image asked for so far (images.uploaded, §5.3) are uploaded in this context:
  // `first` waits for the first screen's own pages only.
  /** Holds `target` until it can draw; the returned promise settles then (now, when nothing waits). */
  const prepare = (target: UiStage, hold: boolean, first = false): Promise<void> => {
    const programs = renderer.info.programs?.length ?? 0;
    const ready = target.compileAsync(renderer);
    const compiles = hold && (renderer.info.programs?.length ?? 0) !== programs;
    const pages = !fonts.readyNow(target, first);
    const pictures = !images.allUploaded();
    retainPrograms(target);
    if (!compiles && !pages && !pictures) return Promise.resolve();
    compiling.add(target);
    // An older preparation (a superseded overlay revision, a compile that resolved because its
    // materials were disposed during a loss) never releases a newer hold: only the target's
    // current preparation does, in the generation it started in, with the context available.
    const token = Symbol();
    const generation = app.generation;
    const done = Promise.all([
      ready,
      pages ? fonts.ready(target, first) : null,
      pictures ? images.uploaded() : null,
    ]).then(async () => {
      const current = preparing.get(target);
      if (current?.token !== token) return current?.done;
      if (!app.available || app.generation !== generation) return;
      preparing.delete(target);
      compiling.delete(target);
      forceDraw = true;
    }, failure);
    preparing.set(target, { token, done });
    return done;
  };
  /** Callers of `nextScreenReady` waiting for the next screen to be prepared, and those whose
   *  screen is preparing: a failure or the host going settles both (the curtain never sticks). */
  const screenWaiters: (() => void)[] = [];
  const preparingWaiters = new Set<() => void>();
  const settleWaiters = () => {
    for (const settle of screenWaiters.splice(0)) settle();
    for (const settle of preparingWaiters) settle();
    preparingWaiters.clear();
  };
  /** Where unseen copies draw once: sRGB like the canvas, so its programs are the canvas's. */
  const warmTarget = new WebGLRenderTarget(16, 16, { stencilBuffer: true });
  warmTarget.texture.colorSpace = SRGBColorSpace;
  const unregisterWarmTarget = app.resident({ release: () => warmTarget.dispose() });
  /** Compiles a surface that is never shown, then draws it once off screen (readiness design §3.1):
   *  uniform and attribute discovery, buffer uploads and link completion happen here, not on
   *  the real one's first visible frame. Its programs are kept for the real one. */
  const warmUi = async (target: UiStage) => {
    await target.compileAsync(renderer);
    if (!app.available || destroyed) return;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(warmTarget);
    target.render(renderer);
    renderer.setRenderTarget(previous);
    retainPrograms(target);
  };
  /** The windows the lobby opens (settings, toast, shell, other partners, 研究所) compile once the
   *  lobby is up, each copy after its images are uploaded (an Image compiles a textured program
   *  only once its texture has arrived). */
  const warmSurfaces = () => {
    if (!state) return;
    const warm = new SettingsDialog(fonts.families, {
      settings: state.settings,
      onChange() {},
      onClose() {},
      onSave() {},
    });
    warm.resize(platform.display.width, platform.display.height, safeArea());
    warm.stage.update(0);
    warm.afterLayout(0);
    void warmUi(warm.stage).then(
      () => warm.dispose(),
      () => warm.dispose(),
    );
    // The first toast and the first transition sweep compile nothing either.
    const warmToast = new GpuToast(fonts.families, () => {});
    warmToast.resize(platform.display.width, platform.display.height, 1, safeArea());
    warmToast.setMessage(" ");
    warmToast.stage.update(0);
    warmToast.afterLayout(0);
    void warmUi(warmToast.stage).then(
      () => warmToast.dispose(),
      () => warmToast.dispose(),
    );
    void warmUi(shell.stage);
    // The lobby switches between all four partners: one unseen copy per starter (its stage takes
    // that type's grain); the locked line and difficulties of a fresh record bring the silhouette,
    // gauge and hatch.
    const insets = safeArea();
    for (const starter of starterOrder) {
      const progress = { ...emptyProgress(), research: starter === "pikachu" ? 1e6 : 0 };
      const warm = new GpuLobby(
        fonts.families,
        texture,
        { progress, pick: { starter, difficulty: 0, stage: playableStages[0]! } },
        { start() {}, pick() {}, lab() {}, codex() {}, settings() {}, multiplayer() {} },
      );
      const width = platform.display.width,
        height = platform.display.height;
      warm.resize(width, height, screenScale(warm, width, height, insets), insets);
      warm.stage.update(0);
      warm.afterLayout(0);
      // After UIKit's deferred clipping pass and the copy's images.
      void images.uploaded().then(
        () => {
          warm.stage.update(0);
          void warmUi(warm.stage).then(
            () => warm.dispose(),
            () => warm.dispose(),
          );
        },
        () => warm.dispose(),
      );
    }
    // 研究所 on 系统 with an archive: every tile state (ready, short, maxed) and the archive toggles.
    const lab = new GpuLab(
      fonts.families,
      texture,
      { ...emptyProgress(), stardust: 100, lab: { dmg: 8, archive: 1 }, archive: [] },
      { buy() {}, archive() {}, back() {}, settings() {} },
    );
    const width = platform.display.width,
      height = platform.display.height;
    lab.resize(width, height, screenScale(lab, width, height, insets), insets);
    for (const tab of ["combat", "system"] as const) {
      lab.showSection(tab);
      lab.stage.update(0);
      lab.afterLayout(0);
    }
    void images.uploaded().then(
      () => {
        lab.stage.update(0);
        void warmUi(lab.stage).then(
          () => lab.dispose(),
          () => lab.dispose(),
        );
      },
      () => lab.dispose(),
    );
  };
  let preparedOverlays = -1;
  let preparedHud: UiStage | undefined;
  let preparedDialog: SettingsDialog | undefined;
  let preparedCodex: GpuCodex | undefined;
  let prefetched = false;
  // The first screen (the lobby) shows only its backdrop until the text its first frame asked for
  // has arrived.
  let firstScreenReady = false;
  let reveal = () => {};
  const revealed = new Promise<void>((resolve) => (reveal = resolve));
  fail = (error: Error) => {
    if (failed || destroyed) return;
    failed = true;
    settleWaiters();
    notifyModal(false);
    cancelInput();
    syncCanvas();
    callbacks.error(error);
  };
  // A long frame (shader compile, GC, tab switch) must not jump an animation to its end.
  const MAX_FRAME_MS = 50;
  const idle = () =>
    destroyed ||
    failed ||
    contextLost ||
    !state ||
    (!dialog && !codex && !runLayer && !screen && !shell.blocking && !toast.visible);
  /** Advances every surface; true when the UI picture changed. */
  const advance = (frameMs: number): boolean => {
    const deltaMs = Math.min(frameMs, MAX_FRAME_MS);
    advanceIdleClock(deltaMs);
    if (idle() || !state) return false;
    try {
      let screenChanged = false;
      for (const [i, shown] of screens.entries()) {
        // A screen under a window's full-screen dim (settings, the 图鉴, the save window, a
        // screen above) holds still: its own idle loop asks for no frames. The window's redraws
        // still draw it, as it stands.
        const dimmed = i < screens.length - 1 || !!codex || (!!dialog && !closing && !shown.modal);
        shown.setCovered?.(shell.blocking || dimmed);
        const screenDelta = compiling.has(shown.stage) || dimmed ? 0 : deltaMs;
        const changed = shown.stage.update(screenDelta);
        if (!dimmed) screenChanged = changed || screenChanged;
        shown.afterLayout(screenDelta);
        if (!prepared.has(shown)) {
          prepared.add(shown);
          const waiting = screenWaiters.splice(0);
          for (const settle of waiting) preparingWaiters.add(settle);
          // Ready or failed (`fail` takes the error), the curtain may lift: it never waits on a
          // surface that cannot draw.
          const settle = () => {
            for (const waiter of waiting) if (preparingWaiters.delete(waiter)) waiter();
          };
          prepare(shown.stage, true, i === 0 && !firstScreenReady).then(settle, settle);
        }
      }
      let runChanged = false;
      if (runLayer) {
        if (runBlocked !== runInputBlocked()) {
          runBlocked = runInputBlocked();
          cancelInput();
        }
        if (runModal !== runLayer.overlays.isModal) {
          runModal = runLayer.overlays.isModal;
          runLayer.hud.setWindowOpen(runModal);
          cancelInput();
        }
        const hud = runLayer.hud,
          overlays = runLayer.overlays;
        const hudDelta = compiling.has(hud.stage) ? 0 : deltaMs;
        runChanged = hud.stage.update(hudDelta);
        hud.afterLayout(hudDelta);
        if (preparedHud !== hud.stage) {
          preparedHud = hud.stage;
          void prepare(hud.stage, true);
        }
        runLayer.controller?.afterUiLayout();
        const overlaysDelta = compiling.has(overlays.stage) ? 0 : deltaMs;
        runChanged = overlays.stage.update(overlaysDelta) || runChanged;
        overlays.afterLayout(overlaysDelta);
        if (preparedOverlays !== overlays.revision) {
          preparedOverlays = overlays.revision;
          void prepare(overlays.stage, overlays.builtOverEmpty);
        }
        overlays.warmUp(warmUi);
      }
      let codexChanged = false;
      if (codex) {
        const codexDelta = compiling.has(codex.stage) ? 0 : deltaMs;
        codexChanged = codex.stage.update(codexDelta);
        codex.afterLayout(codexDelta);
        if (preparedCodex !== codex) {
          preparedCodex = codex;
          void prepare(codex.stage, true);
        }
        if (codex.exitFinished) {
          cancelInput();
          fonts.release(codex.stage);
          codex.dispose();
          codex = undefined;
          preparedCodex = undefined;
          notifyModal(false);
          syncCanvas();
          forceDraw = true;
        }
      }
      // After layout, so the hit-test sees where the scroll moved the content.
      if (rehover) {
        rehover = false;
        input.refresh();
      }
      const toastShown = toast.visible;
      let shellChanged = toast.stage.update(deltaMs);
      toast.afterLayout(deltaMs);
      if (toastShown !== toast.visible) syncCanvas();
      // A dismissed or expired toast hands the keyboard back to the surface it came from.
      if (toastOwner && !toast.keyed) leaveToast();
      shell.update(deltaMs);
      shellChanged = shell.stage.update(deltaMs) || shellChanged;
      const dialogDelta = dialog && compiling.has(dialog.stage) ? 0 : deltaMs;
      const dialogChanged = dialog?.stage.update(dialogDelta) ?? false;
      dialog?.afterLayout(dialogDelta);
      if (dialog && preparedDialog !== dialog) {
        preparedDialog = dialog;
        void prepare(dialog.stage, true);
      }
      if (dialog?.exitFinished) {
        fonts.release(dialog.stage);
        dialog.dispose();
        dialog = undefined;
        dialogSettings = undefined;
        closing = false;
        notifyModal(false);
        syncCanvas();
        forceDraw = true;
        if (state.settingsOpen) createDialog();
        syncCanvas();
      }
      return (
        forceDraw || screenChanged || dialogChanged || runChanged || codexChanged || shellChanged
      );
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  };
  /** Draws every shown surface over what the frame drew so far (the world, when a run shows). */
  const draw = () => {
    if (idle()) return;
    try {
      forceDraw = false;
      // A modal screen (the save window) is a window: over the toast and the settings window.
      const drawScreens = (modal: boolean) => {
        for (const shown of screens)
          if (!!shown.modal === modal && !compiling.has(shown.stage)) shown.stage.render(renderer);
      };
      drawScreens(false);
      for (const layer of [runLayer?.hud.stage, runLayer?.overlays.stage])
        if (layer && !compiling.has(layer)) layer.render(renderer);
      if (toast.visible) toast.stage.render(renderer);
      if (codex && !compiling.has(codex.stage)) codex.render(renderer);
      if (dialog && !compiling.has(dialog.stage)) dialog.stage.render(renderer);
      drawScreens(true);
      if (shell.blocking) shell.stage.render(renderer);
      // A program none of these draws had linked before: attribute it to the stages just drawn.
      if ((renderer.info.programs ?? []).some((program) => !seenPrograms.has(program))) {
        for (const program of renderer.info.programs ?? []) seenPrograms.add(program);
        for (const stage of [
          ...screens.map((shown) => shown.stage),
          runLayer?.hud.stage,
          runLayer?.overlays.stage,
          toast.stage,
          codex?.stage,
          dialog?.stage,
          shell.stage,
        ])
          if (stage) retainPrograms(stage);
      }
      const first = screens[0];
      if (!prefetched && first) {
        // The first screen's own pages come first (chrome page 0 holds every lobby glyph); the
        // other core pages are fetched after it, ahead of the surfaces that draw them.
        prefetched = true;
        void Promise.all([fonts.ready(first.stage, true), images.uploaded(), uiSounds.result]).then(
          () => {
            if (destroyed || failed) return;
            firstScreenReady = true;
            reveal();
            hint = "due";
            showHint();
            for (const shown of screens) shown.setRevealed?.(true);
            forceDraw = true;
            fonts.prefetch();
            warmSurfaces();
          },
          (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))),
        );
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const releaseUi = app.setUi({ advance, draw });
  let inputOwner: unknown;
  let inputRevision = -1;
  const owner = () => {
    if (!platform.inputFocused || idle() || state?.busy || shell.blocking) return null;
    const target = activeTarget();
    return target === runLayer?.overlays && runLayer?.overlays.choiceOpen
      ? runLayer.controller
      : (target ?? ((!closing && dialog) || codex || screen ? null : runLayer?.controller));
  };
  let choiceRevision = -1;
  const syncInputOwner = () => {
    const target = owner();
    const revision = target === runLayer?.overlays ? (runLayer?.overlays.revision ?? -1) : -1;
    if (target !== inputOwner || revision !== inputRevision) {
      cancelInput();
      inputOwner = target;
      inputRevision = revision;
    }
    const nextChoiceRevision = runLayer?.overlays.choiceOpen ? runLayer.overlays.revision : -1;
    if (choiceRevision !== nextChoiceRevision) {
      // Reroll/open/close invalidates only card gestures; held movement and both sticks continue.
      input.cancel();
      runLayer?.overlays.pointerUp(false);
      choiceRevision = nextChoiceRevision;
    }
    return target;
  };
  let previousInputTime = performance.now();
  const sampleInput = () => {
    const now = performance.now();
    const inputDelta = Math.min(50, now - previousInputTime);
    previousInputTime = now;
    const target = syncInputOwner();
    if (runLayer) {
      runModal = runLayer.overlays.isModal;
      runBlocked = runInputBlocked();
      runLayer.hud.setWindowOpen(runModal);
    }
    const gameplay = !!target && target === runLayer?.controller;
    const choosing = !!runLayer?.overlays.choiceOpen && !compiling.has(runLayer.overlays.stage);
    const frame = actions.sample(
      performance.now(),
      !target ? "blocked" : gameplay ? (choosing ? "choice" : "gameplay") : "navigation",
    );
    if (frame.disconnected) {
      onBlur();
      return;
    }
    if (!target) return;
    if (gameplay) {
      const controller = runLayer!.controller!;
      controller.sampleInput(frame.move, frame.turn);
      const overlays = runLayer!.overlays;
      for (const action of frame.actions) {
        if (
          !(choosing && overlays.choiceAction(action)) &&
          !isNavigationAction(action) &&
          action !== "choiceConfirm"
        )
          runLayer!.controller!.action(action as GameplayAction);
        if (owner() !== target) {
          cancelInput();
          break;
        }
      }
    } else {
      const ui = activeTarget();
      if (!ui) return;
      if (frame.scroll) ui.scroll(frame.scroll * inputDelta * 0.6);
      if (frame.navigationTurn && ui === codex)
        codex.turnModel(frame.navigationTurn * inputDelta * 0.0024);
      for (const action of frame.actions) {
        if (isNavigationAction(action)) {
          if (!toastNavigation(action)) ui.navigate(action);
          if (action === "confirm" || action === "cancel" || action === "resume") {
            actions.cancel();
            break;
          }
        }
        if (owner() !== target) break;
      }
    }
  };
  return {
    get inputMode() {
      return inputMode;
    },
    sampleInput,
    inspect: () => ({
      dialog,
      codex,
      screens,
      lobby: screens.find((shown) => shown instanceof GpuLobby),
      run: runLayer,
    }),
    fonts: fonts.families,
    backdrop: texture,
    openCodex,
    registerScreen(next) {
      cancelInput();
      screens.push(next);
      screen = next;
      next.bindFocus?.(() => platform.focus());
      next.setCoarsePointer(inputMode.kind === "touch");
      next.setFocusVisible(focusVisible);
      next.setRevealed?.(firstScreenReady);
      lastSize = "";
      resize();
      syncCanvas();
      forceDraw = true;
      platform.focus();
      return () => {
        cancelInput();
        screens.splice(screens.indexOf(next), 1);
        screen = screens.at(-1);
        prepared.delete(next);
        fonts.release(next.stage);
        syncCanvas();
        forceDraw = true;
        // Whatever is underneath (a screen, the menu, a run) takes the keyboard back.
        platform.focus();
      };
    },
    registerRun(hud, overlays, controller) {
      if (runLayer) throw new Error("冒险UI已注册。");
      runLayer = { hud, overlays, controller };
      controller?.bindInput(actions);
      runModal = overlays.isModal;
      hud.setWindowOpen(runModal);
      hud.setCoarsePointer(inputMode.kind === "touch");
      overlays.setCoarsePointer(inputMode.kind === "touch");
      overlays.setFocusVisible(focusVisible);
      hud.setFocusVisible(focusVisible);
      lastSize = "";
      resize();
      syncCanvas();
      forceDraw = true;
      platform.focus();
      return () => {
        cancelInput();
        if (runLayer)
          for (const layer of [runLayer.hud.stage, runLayer.overlays.stage]) fonts.release(layer);
        runLayer = undefined;
        runModal = false;
        syncCanvas();
        forceDraw = true;
      };
    },
    update(next) {
      if (destroyed) return;
      const previousState = state;
      const openingDialog = next.settingsOpen && !dialog;
      state = { ...next, settings: { ...next.settings } };
      shell.setTransition(next.transition);
      const note = next.notification;
      if (!note) {
        if (hint !== "shown") toast.setMessage(null);
      } else if (note.id !== toastId) {
        if (hint === "shown") hint = "done";
        // Remounting the DOM Toast replayed its entrance for every new notification.
        toast.setMessage(null);
        toast.setMessage(note.message);
      }
      toastId = note?.id ?? toastId;
      if (next.settingsOpen && !dialog) {
        cancelInput();
        createDialog();
      } else if (!next.settingsOpen) closeDialog();
      else if (
        dialog &&
        !closing &&
        (!sameSettings(dialogSettings, next.settings) || dialogCanSave !== next.canSave)
      ) {
        cancelInput();
        fonts.release(dialog.stage);
        dialog.dispose();
        createDialog();
      }
      if (previousState?.busy !== next.busy) {
        cancelInput();
        forceDraw = true;
      }
      syncCanvas();
      resize();
      if (openingDialog || (runLayer && !next.busy && previousState?.busy)) platform.focus();
    },
    revealed,
    nextScreenReady() {
      if (destroyed || failed) return Promise.resolve();
      return new Promise<void>((resolve) => screenWaiters.push(resolve));
    },
    dispose() {
      if (destroyed) return;
      destroyed = true;
      settleWaiters();
      notifyModal(false);
      releaseUi();
      stopInput();
      cancelInput();
      unregisterResident();
      unregisterWarmTarget();
      warmTarget.dispose();
      uiSounds.release();
      dialog?.dispose();
      codex?.dispose();
      shell.dispose();
      toast.dispose();
      texture.dispose();
      retention.dispose();
      platform.dispose();
    },
  };
}

/** The app's image store over its renderer (one per page, like the fonts). */
function imageStoreOf(app: AppRenderer): ImageStore {
  return bindImages({
    get generation() {
      return app.generation;
    },
    get available() {
      return app.available;
    },
    subscribe: (listener) => app.subscribe(listener),
    enqueue: (task) => app.enqueue(task),
    resident: (resident) => app.resident(resident),
    upload: (texture) => app.renderer.initTexture(texture),
  });
}
