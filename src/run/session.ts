import type { MultiplayerRun } from "../network/run";
import {
  createRun,
  RUN_NOTICE_MS,
  type PlayerSheet,
  type RunHandle,
  type RunResult,
  type RunSnapshot,
} from "./createRun";
import { difficulties, type Difficulty } from "./sim/content/difficulties";
import { formDefs, starters, type StarterId } from "./sim/content/lines/index";
import type { ItemId } from "./sim/content/items";
import type { StageId } from "./sim/content/stages/index";
import type { LabBonuses } from "./sim/state/entities";
import type { Loadout } from "./sim/world";
import { formatTime } from "./labels";
import { GpuRunHud, type RunHudNotice } from "../ui/gpu/run-hud";
import { GpuRunOverlays, type RunOverlayState } from "../ui/gpu/run-overlays";
import type { FontFamilies } from "@pmndrs/uikit";
import type { AppRenderer } from "../rendering/app-renderer";
import { getAudio } from "../audio/engine";

export interface RunUiHost {
  readonly fonts: FontFamilies;
  registerRun(hud: GpuRunHud, overlays: GpuRunOverlays, controller: RunHandle): () => void;
  openCodex(): void;
}

export interface RunSessionOptions {
  multiplayer?: MultiplayerRun;
  stage: StageId;
  starter: StarterId;
  difficulty: Difficulty;
  lab: LabBonuses;
  loadout: Loadout;
  backpack: { size: number; onKeep: (items: ItemId[]) => boolean } | null;
  onStarted: () => boolean;
  app: AppRenderer;
  gpuHost: RunUiHost;
  modalActive: boolean;
  sound: boolean;
  devMode: boolean;
  onFinish: (result: RunResult) => { ok: true; note: string | null } | { ok: false; error: string };
  /** `note`: what the ended run unlocked, when it ends without its result window. */
  onRetry: (note?: string | null) => void;
  /** Back to the lobby; `note` as for `onRetry`. */
  onLobby: (note: string | null) => void;
  onSettings: () => void;
}

const noticePriority = { info: 0, reward: 1, danger: 2 };

/** Run flow belongs to the game; React and SDL only mount and update this session. */
export function createRunSession(options: RunSessionOptions) {
  const { stage, starter, difficulty, lab, loadout, backpack, app, gpuHost, devMode } = options;
  let run: RunHandle;
  let snap: RunSnapshot | null = null;
  let status: "loading" | "ready" | "error" = "loading";
  let zoneLoading = false;
  let error = "";
  let paused = false;
  let quitting = false;
  let leaving: "retry" | "lobby" | null = null;
  let stats: PlayerSheet | null = null;
  let result: { result: RunResult; note: string | null; saved: boolean } | null = null;
  let notice: RunHudNotice | null = null;
  let banishing: number | null = null;
  let mapOpen = false;
  let modalActive = options.modalActive;
  let sound = options.sound;
  let noticeId = 0;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeExpiresAt = 0;
  let disposed = false;
  let refreshQueued = false;

  function clearNotice() {
    clearTimeout(noticeTimer);
    noticeTimer = undefined;
    notice = null;
  }

  function refreshNotice() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      if (!disposed) refresh();
    });
  }

  function refresh() {
    if (notice && noticeExpiresAt <= performance.now()) clearNotice();
    const pending = snap?.pending ?? null;
    const form = snap ? formDefs[snap.form] : starters[starter].stages[0].form;
    const theme = form.types[0]!;
    let overlay: RunOverlayState = null;
    if (result && !result.saved) overlay = { kind: "save-error", message: error, theme };
    else if (status === "error") overlay = { kind: "error", message: error, theme };
    else if (result)
      overlay = { kind: "result", ...result, backpackSize: backpack?.size ?? null, theme };
    else if (options.multiplayer?.reconnecting) overlay = { kind: "reconnecting", theme };
    else if (status === "loading" || zoneLoading || options.multiplayer?.suspended)
      overlay = {
        kind: "loading",
        starter,
        stage,
        zone: zoneLoading && snap ? { number: snap.zone.index + 2, count: snap.zone.count } : null,
        theme,
      };
    else if (pending && (!options.multiplayer || (!stats && !paused && !mapOpen)))
      overlay = {
        kind: "choice",
        dismissible: Boolean(options.multiplayer),
        pending,
        dealKey: `${pending.id}:${JSON.stringify(pending.options)}`,
        level: snap!.cardLevel,
        rerolls: snap!.rerolls,
        skips: (lab.rules.skips ?? 0) > 0 ? snap!.skips : null,
        banishes: (lab.rules.banishes ?? 0) > 0 ? snap!.banishes : null,
        banishing: banishing === pending.id,
        theme,
      };
    else if (stats && snap)
      overlay = {
        kind: "stats",
        starter,
        form: snap.form,
        level: snap.level,
        build: stats,
        theme,
      };
    else if (paused)
      overlay = {
        kind: "pause",
        form: form.name,
        meta: [difficulties[difficulty].name, formatTime(snap?.time ?? 0)],
        quitting,
        shared: Boolean(options.multiplayer),
        theme,
      };
    else if (snap?.dialog) overlay = { kind: "station", view: snap.dialog, theme };
    overlays.update(overlay);
    hud.setChoiceOpen(overlays.choiceOpen);
    const blocked = modalActive || overlays.isModal || mapOpen;
    hud.update({
      snapshot: snap,
      theme,
      visible: status === "ready" && snap !== null,
      blocked,
      notice: overlay || blocked ? null : notice,
    });
  }
  function setPaused(value: boolean) {
    paused = value;
    run.setPaused(paused || stats !== null);
    refresh();
  }
  function leave(to: "retry" | "lobby") {
    if (leaving) return;
    leaving = to;
    if (status !== "ready") {
      if (to === "retry") options.onRetry();
      else options.onLobby(null);
    } else run.send({ t: "forfeit" });
  }
  function saveResult() {
    if (!result) return;
    if (!result.saved) {
      const saved = options.onFinish(result.result);
      if (!saved.ok) {
        error = saved.error;
        refresh();
        return;
      }
      result.saved = true;
      result.note = saved.note;
    }
    if (leaving === "retry") options.onRetry(result.note);
    else if (leaving === "lobby") options.onLobby(result.note);
    else refresh();
  }
  function openStats() {
    if (modalActive || mapOpen) return;
    stats = run.stats();
    run.setPaused(true);
    refresh();
  }
  const hud = new GpuRunHud(gpuHost.fonts, starter, {
    pause() {
      getAudio().sfx("ui-confirm");
      quitting = false;
      setPaused(true);
    },
    stats: () => run.action("stats"),
    dash: () => run.send({ t: "dash" }),
    ultimate: () => run.send({ t: "ult" }),
    interact() {
      getAudio().sfx("ui-confirm");
      run.send({ t: "interact" });
    },
    turn: (direction) => run.setTurn(direction),
  });
  const overlays = new GpuRunOverlays(gpuHost.fonts, {
    send: (command) => run.send(command),
    resume: () => setPaused(false),
    openCodex: () => gpuHost.openCodex(),
    restart: () => leave("retry"),
    askQuit() {
      quitting = true;
      refresh();
    },
    cancelQuit() {
      quitting = false;
      refresh();
    },
    quit: () => leave("lobby"),
    closeStats() {
      stats = null;
      run.setPaused(paused);
      refresh();
    },
    openSettings: () => options.onSettings(),
    retry() {
      if (result && !result.saved) saveResult();
      else options.onRetry();
    },
    exit: () => options.onLobby(null),
    pick(index, banish) {
      const pending = snap?.pending;
      if (!pending) return;
      run.send({ t: banish ? "banish" : "pick", card: pending.id, index });
      if (banish) banishing = null;
      refresh();
    },
    toggleBanish() {
      const pending = snap?.pending;
      if (pending) banishing = banishing === pending.id ? null : pending.id;
      refresh();
    },
    keepItems: (items) => backpack?.onKeep(items) ?? false,
    slotCenter: (kind, id) => hud.slotCenter(kind, id),
  });
  if (options.multiplayer) options.multiplayer.onConnectionChange = refresh;
  refresh();
  run = createRun(
    app,
    hud,
    { stage, starter, difficulty, lab, loadout, sound, devMode, multiplayer: options.multiplayer },
    {
      inputBlocked: () => modalActive || overlays.isModal,
      onReady() {
        if (!options.onStarted()) throw new Error("背包保存失败。");
        status = "ready";
        run.setSound(sound);
        refresh();
      },
      onError(cause) {
        clearNotice();
        error = cause.message;
        status = "error";
        refresh();
      },
      onSnapshot(value) {
        snap = value;
        refresh();
      },
      onBanner(text, tone, ageMs) {
        if (disposed || status !== "ready" || zoneLoading || result) return;
        const now = performance.now();
        const remainingMs = RUN_NOTICE_MS[tone] - ageMs;
        if (remainingMs <= 0) return;
        if (notice && noticeExpiresAt <= now) clearNotice();
        if (
          notice &&
          ((notice.text === text && notice.tone === tone) ||
            noticePriority[tone] < noticePriority[notice.tone])
        )
          return;
        clearNotice();
        notice = { id: ++noticeId, text, tone };
        noticeExpiresAt = now + remainingMs;
        noticeTimer = setTimeout(() => {
          clearNotice();
          refresh();
        }, remainingMs);
        refreshNotice();
      },
      onPauseRequest(mode) {
        if (modalActive || (snap?.pending && !options.multiplayer) || snap?.dialog || result)
          return;
        quitting = false;
        setPaused(mode === "pause" || !paused);
      },
      onStatsRequest: openStats,
      onMapChange(open) {
        mapOpen = open;
        refresh();
      },
      onZoneLoading(loading) {
        if (loading) clearNotice();
        zoneLoading = loading;
        refresh();
      },
      onEnd(end) {
        clearNotice();
        result = { result: end, note: null, saved: false };
        saveResult();
      },
    },
  );
  const unregister = gpuHost.registerRun(hud, overlays, run);
  return {
    hud,
    overlays,
    update(next: { modalActive: boolean; sound: boolean; devMode: boolean }) {
      modalActive = next.modalActive;
      run.setDevMode(next.devMode);
      if (sound !== next.sound) {
        sound = next.sound;
        run.setSound(sound);
      }
      refresh();
    },
    dispose() {
      disposed = true;
      if (options.multiplayer) options.multiplayer.onConnectionChange = () => {};
      unregister();
      clearNotice();
      run.dispose();
      overlays.dispose();
      hud.dispose();
    },
  };
}
