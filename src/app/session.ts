import { getAudio } from "../audio/engine";
import type { AppRenderer } from "../rendering/app-renderer";
import { createRunSession } from "../run/session";
import {
  recordRun,
  setBackpack,
  backpackSlots,
  buyLab,
  setArchive,
  starterUnlocked,
  type Progress,
} from "../run/progress";
import { labBonuses } from "../run/lab";
import { runUnlocks } from "../run/unlocks";
import { starters } from "../run/sim/content/lines/index";
import { validPick, type LobbyPick } from "../lobbyPick";
import { depart, open as openPrefetch, select } from "../run/prefetch";
import { encodeSave, decodeSave } from "../run/save";
import { GpuSaveDialog } from "../ui/gpu/save-dialog";
import type { Settings } from "../settings";
import type { MultiplayerRun } from "../network/run";
import { createGpuAppHost, type GpuAppHost } from "../ui/gpu/app-host";
import { GpuDevReadout } from "../ui/gpu/run-dev-readout";
import { GpuLobby } from "../ui/gpu/lobby";
import { LobbyScene } from "../ui/gpu/lobby-scene";
import { GpuLab } from "../ui/gpu/lab";
import { mountMultiplayer } from "../ui/gpu/multiplayer-session";
import { SceneTransition, type SceneTransitionPhase } from "../ui/scene-transition";
import type { AppStorage } from "../platform/app-storage";
import type { UiSurface } from "../platform/ui-surface";
import { ActionInput } from "../platform/input";
import type { DirectPeerFactory } from "../platform/direct-peer";

export type AppScreen = "lobby" | "lab" | "run";
export interface AppState {
  screen: AppScreen;
  transition: SceneTransitionPhase;
  busy: boolean;
  modalActive: boolean;
  settings: Settings;
}
export interface AppSessionOptions {
  harbor: string;
  directPeer: DirectPeerFactory;
  error: (error: Error) => void;
  changed?: (state: AppState) => void;
}

/** Navigation, progression, audio and GPU screen lifetimes are identical on Web and native. */
export async function createAppSession(
  app: AppRenderer,
  surface: UiSurface,
  storage: AppStorage,
  options: AppSessionOptions,
  signal: AbortSignal,
) {
  const initial = storage.load();
  const input = new ActionInput(surface.createGamepads());
  let releaseInput = () => {};
  let progressLoad = initial.progress;
  let settings = initial.settings;
  const audio = getAudio();
  let host: GpuAppHost | undefined;
  let run: ReturnType<typeof createRunSession> | undefined;
  let screen: GpuLobby | GpuLab | undefined;
  let devBadge: GpuDevReadout | undefined;
  let unmount: (() => void) | undefined;
  let room: (() => void) | undefined;
  let saveWindow: (() => void) | undefined;
  let network: MultiplayerRun | undefined;
  let pick = validPick(progressLoad.progress, initial.pick);
  let runPick = pick;
  let route: AppScreen = "lobby";
  let disposed = false;
  let failure: Error | undefined;
  let revealed = false;
  let modalActive = false;
  let settingsOpen = false;
  let reopenRoom = false;
  let notification: { id: number; message: string } | null = null;
  let noteId = 0;
  let quietUntil = 0;
  const transition = new SceneTransition(
    (destination) => show(destination as AppScreen),
    (destination) => (destination === "run" ? null : host!.nextScreenReady()),
    (phase) => {
      if (phase === "covering" && performance.now() >= quietUntil)
        audio.sfx("ui-transition", { keyMs: 293 });
      sync();
    },
  );
  function state(): AppState {
    return {
      screen: route,
      transition: transition.phase,
      busy: transition.phase !== "idle",
      modalActive: modalActive || settingsOpen,
      settings,
    };
  }
  function sync() {
    if (disposed) return;
    host?.update({
      settingsOpen,
      settings,
      canSave: route !== "run",
      busy: transition.phase !== "idle",
      transition: transition.phase,
      notification,
    });
    run?.update({
      modalActive: modalActive || settingsOpen,
      sound: settings.sound,
      devMode: settings.devMode,
    });
    if (settings.devMode && screen) {
      if (!devBadge) {
        devBadge = new GpuDevReadout();
        screen.stage.root.add(devBadge.root);
        devBadge.root.setProperties({ positionTop: 155, positionLeft: 24 });
        devBadge.set("DEV   F8 toggle");
      }
    } else {
      devBadge?.dispose();
      devBadge = undefined;
    }
    options.changed?.(state());
  }
  function notify(message: string) {
    notification = { id: ++noteId, message };
    sync();
  }
  function refreshScreen() {
    pick = validPick(progressLoad.progress, pick);
    if (screen instanceof GpuLab) screen.update(progressLoad.progress);
    else screen?.update({ progress: progressLoad.progress, pick });
  }
  /** Disk/browser refusal or locked data leaves the in-memory progress untouched too. */
  function change(label: string, apply: (progress: Progress) => Progress): boolean {
    if (progressLoad.status === "locked") {
      notify(progressLoad.message);
      return false;
    }
    try {
      const progress = apply(progressLoad.progress);
      storage.saveProgress(progress);
      progressLoad = { status: "ready", progress };
      refreshScreen();
      return true;
    } catch (error) {
      console.error(`${label}失败`, error);
      notify(`${label}失败：${(error as Error).message}`);
      return false;
    }
  }
  function openSave() {
    if (saveWindow || route === "run") return;
    const initial =
      progressLoad.status === "locked"
        ? { text: "", error: progressLoad.message }
        : { text: encodeSave({ progress: progressLoad.progress, settings }), error: "" };
    const dialog = new GpuSaveDialog(
      host!.fonts,
      initial,
      {
        notify,
        load(text) {
          const save = decodeSave(text);
          storage.save(save);
          progressLoad = { status: "ready", progress: save.progress };
          settings = save.settings;
          audio.setEnabled(settings.sound);
          refreshScreen();
          if (route === "lobby") select(pick);
          notify("存档已导入");
        },
        closed() {
          saveWindow?.();
        },
      },
      surface.text,
    );
    const unregister = host!.registerScreen(dialog);
    saveWindow = () => {
      saveWindow = undefined;
      unregister();
      dialog.dispose();
    };
  }
  function openSettings() {
    settingsOpen = true;
    sync();
  }
  function closeRoom() {
    room?.();
    room = undefined;
  }
  function openRoom() {
    if (room) return;
    const progress = progressLoad.progress;
    room = mountMultiplayer(
      host!,
      options.harbor,
      pick,
      {
        starter: pick.starter,
        lab: labBonuses(progress.lab),
        archive: progress.archive,
        backpack: progress.backpack,
      },
      closeRoom,
      (multiplayer) => {
        closeRoom();
        const self = multiplayer.config.players[multiplayer.player]!;
        start(
          {
            stage: multiplayer.config.stage,
            difficulty: multiplayer.config.difficulty,
            starter: self.starter,
          },
          multiplayer,
        );
      },
      storage,
      { directPeer: options.directPeer, signal },
      notify,
    );
  }
  function start(next: LobbyPick, multiplayer?: MultiplayerRun) {
    if (transition.phase !== "idle") return;
    if (!starterUnlocked(progressLoad.progress, next.starter))
      throw new Error(`${starters[next.starter].stages[0].form.name} 尚未加入。`);
    runPick = next;
    network = multiplayer;
    depart(next);
    audio.sfx("ui-start", { keyMs: 371 });
    quietUntil = performance.now() + 150;
    transition.navigate("run");
  }
  function back(note?: string | null) {
    network?.dispose();
    network = undefined;
    if (note) notify(note);
    transition.navigate("lobby");
  }
  function show(destination: AppScreen) {
    run?.dispose();
    run = undefined;
    devBadge?.dispose();
    devBadge = undefined;
    unmount?.();
    unmount = undefined;
    screen = undefined;
    route = destination;
    const progress = progressLoad.progress;
    if (destination === "run") {
      const carried = progress.backpack;
      run = createRunSession({
        ...runPick,
        multiplayer: network,
        lab: labBonuses(progress.lab),
        loadout: { archive: progress.archive, backpack: carried },
        backpack:
          progressLoad.status === "ready"
            ? {
                size: backpackSlots(progress),
                onKeep: (items) => change("背包", (current) => setBackpack(current, items)),
              }
            : null,
        app,
        gpuHost: host!,
        modalActive,
        sound: settings.sound,
        devMode: settings.devMode,
        onStarted() {
          if (!network?.session.restored && carried.length)
            return change("背包", (current) => setBackpack(current, []));
          return true;
        },
        onFinish(result) {
          if (progressLoad.status === "locked") return { ok: false, error: progressLoad.message };
          const previous = progressLoad.progress;
          if (!change("记录保存", (current) => recordRun(current, result)))
            return { ok: false, error: "记录保存失败。" };
          return { ok: true, note: runUnlocks(previous, progressLoad.progress) };
        },
        onRetry(note) {
          if (network) {
            reopenRoom = true;
            back(note);
          } else {
            if (note) notify(note);
            start(runPick);
          }
        },
        onLobby: back,
        onSettings: openSettings,
      });
    } else if (destination === "lobby") {
      pick = validPick(progress, pick);
      select(pick);
      const lobby = new GpuLobby(
        host!.fonts,
        host!.backdrop,
        { progress, pick },
        {
          pick(next) {
            pick = next;
            try {
              storage.savePick(next);
            } catch (error) {
              notify((error as Error).message);
            }
            select(next);
          },
          start,
          lab: () => transition.navigate("lab"),
          codex: () => host!.openCodex(),
          settings: openSettings,
          multiplayer: openRoom,
        },
      );
      const scene = new LobbyScene(app, notify);
      lobby.attachScene(scene);
      const unregister = host!.registerScreen(lobby);
      screen = lobby;
      lobby.focusStart();
      unmount = () => {
        unregister();
        scene.dispose();
        lobby.dispose();
      };
      if (revealed) audio.music.play("menu");
      if (reopenRoom) {
        reopenRoom = false;
        openRoom();
      }
    } else if (destination === "lab") {
      const lab = new GpuLab(host!.fonts, host!.backdrop, progress, {
        buy: (id) => change("购买", (current) => buyLab(current, id)),
        archive: (items) => change("档案库", (current) => setArchive(current, items)),
        back: () => transition.navigate("lobby"),
        settings: openSettings,
      });
      const unregister = host!.registerScreen(lab);
      screen = lab;
      unmount = () => {
        unregister();
        lab.dispose();
      };
      if (revealed) audio.music.play("menu");
    }
    sync();
  }
  const stopErrors = audio.onError((error) => notify(error.message));
  function dispose() {
    if (disposed) return;
    disposed = true;
    transition.dispose();
    closeRoom();
    saveWindow?.();
    run?.dispose();
    network?.dispose(network.host);
    devBadge?.dispose();
    devBadge = undefined;
    unmount?.();
    host?.dispose();
    releaseInput();
    input.dispose();
    stopErrors();
  }
  try {
    host = await createGpuAppHost(
      app,
      surface,
      input,
      {
        openSettings,
        closeSettings: () => {
          settingsOpen = false;
          sync();
        },
        changeSettings(next) {
          settings = next;
          audio.setEnabled(settings.sound);
          try {
            storage.saveSettings(next);
          } catch (error) {
            console.error("设置保存失败", error);
            notify("设置保存失败");
          }
          sync();
        },
        openSave,
        modalActive(active) {
          modalActive = active;
          sync();
        },
        dismissNotification: () => {
          notification = null;
          sync();
        },
        notify,
        error(error) {
          if (disposed) return;
          failure = error;
          dispose();
          options.error(error);
        },
      },
      signal,
    );
    if (failure) {
      host.dispose();
      throw failure;
    }
    releaseInput = app.setInput(() => host?.sampleInput());
    audio.setEnabled(settings.sound);
    sync();
    show("lobby");
    void host.revealed.then(() => {
      if (disposed) return;
      revealed = true;
      openPrefetch(notify);
      if (route !== "run") audio.music.play("menu");
    });
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    host,
    state,
    dispose,
    notify,
    change,
    get pick() {
      return pick;
    },
  };
}
export type AppSession = Awaited<ReturnType<typeof createAppSession>>;
