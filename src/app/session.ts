import { getAudio } from "../audio/engine";
import type { AppRenderer } from "../rendering/app-renderer";
import { createRunSession, type RunCover } from "../run/session";
import { stageDefs } from "../run/sim/content/stages/index";
import {
  availableSelection,
  recordRun,
  partnerBondSetup,
  setBackpack,
  backpackSlots,
  buyLab,
  setArchive,
  setShinyLook,
  starterUnlocked,
  type Progress,
} from "../run/progress";
import { labBonuses } from "../run/lab";
import { runUnlocks } from "../run/unlocks";
import type { RuleId } from "../run/sim/content/rules";
import { lineForms, starters } from "../run/sim/content/lines/index";
import { validPick, type LobbyPick } from "../lobbyPick";
import { depart, launch, open as openPrefetch, select } from "../run/prefetch";
import { allOf, type Handle } from "../prepare/handle";
import { images } from "../prepare/images";
import { portraitSrc } from "../ui/gpu/ball";
import { shinyMapNeed } from "../run/view/assets";
import { encodeSave, decodeSave } from "../run/save";
import { GpuSaveDialog } from "../ui/gpu/save-dialog";
import type { Settings } from "../settings";
import type { MultiplayerRun } from "../network/run";
import { createGpuAppHost, type GpuAppHost } from "../ui/gpu/app-host";
import { GpuDevReadout } from "../ui/gpu/run-dev-readout";
import { GpuLobby } from "../ui/gpu/lobby";
import { LobbyScene } from "../ui/gpu/lobby-scene";
import { GpuLab, type LabAt } from "../ui/gpu/lab";
import type { GpuCodexPage } from "../ui/gpu/codex";
import { mountMultiplayer } from "../ui/gpu/multiplayer-session";
import {
  SCENE_TRANSITION_TIMING,
  SceneTransition,
  type SceneTransitionPhase,
} from "../ui/scene-transition";
import type { AppStorage } from "../platform/app-storage";
import type { UiSurface } from "../platform/ui-surface";
import { ActionInput } from "../platform/input";
import type { DirectPeerFactory } from "../platform/direct-peer";

export type AppScreen = "lobby" | "lab" | "codex" | "room" | "run";
/** The page name the curtain shows on its way to each screen. */
const SCREEN_TITLES: Record<AppScreen, string> = {
  lobby: "大厅",
  lab: "研究所",
  codex: "图鉴",
  room: "联机",
  run: "出发",
};
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
  let screen: GpuLobby | GpuLab | GpuCodexPage | undefined;
  let devBadge: GpuDevReadout | undefined;
  let unmount: (() => void) | undefined;
  let saveWindow: (() => void) | undefined;
  let network: MultiplayerRun | undefined;
  let pick = validPick(progressLoad.progress, initial.pick);
  let selectedRules = availableSelection(progressLoad.progress);
  let pendingLook: { worn: boolean; hold: Handle<void> } | null = null;
  let runPick = pick;
  let route: AppScreen = "lobby";
  /** A 图鉴 entry opened from the 研究所, and where to return there. */
  let labCodex: { key: string; at: LabAt } | undefined;
  let disposed = false;
  let failure: Error | undefined;
  let revealed = false;
  /** The launcher's share of the opening run, until the lobby's holds take it over. */
  let launching: { cancel(): void } | undefined;
  let modalActive = false;
  let settingsOpen = false;
  let notification: { id: number; message: string } | null = null;
  let noteId = 0;
  let quietUntil = 0;
  /** The run's load under the curtain (its start, a zone, teammates), as it last reported it. */
  let runCover: RunCover | null = null;
  let coverQueued = false;
  /** Opens the curtain on a run that has loaded (pending while the run navigation holds). */
  let runLoaded: (() => void) | undefined;
  const transition = new SceneTransition(
    (destination) => show(destination as AppScreen),
    (destination) =>
      destination === "run"
        ? new Promise<void>((done) => (runLoaded = done))
        : host!.nextScreenReady(),
    (phase) => {
      if (phase === "covering" && performance.now() >= quietUntil)
        audio.sfx("ui-transition", { keyMs: SCENE_TRANSITION_TIMING.cover });
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
  /** The run's input waits for the curtain: its opening plays only once the curtain is open. */
  const runModal = () => modalActive || settingsOpen || transition.phase !== "idle";
  /** Coalesced to a microtask: a cover that ends in the same turn (a step's barrier) never flashes. */
  function coverRun(cover: RunCover | null) {
    const same = cover?.title === runCover?.title && cover?.progress === runCover?.progress;
    // A held run navigation opens on any uncovered report, its first one included.
    if (same && (cover || !runLoaded)) return;
    runCover = cover;
    if (coverQueued) return;
    coverQueued = true;
    queueMicrotask(() => {
      coverQueued = false;
      if (disposed || !run) return;
      if (!runCover && runLoaded) {
        const done = runLoaded;
        runLoaded = undefined;
        done();
      } else if (!runLoaded) {
        if (runCover) transition.cover();
        else transition.uncover();
      }
      sync();
    });
  }
  /** The curtain names the page coming on; for a run, the map it enters, with its load's progress. */
  function curtain(): { title: string; progress: number | null } {
    const destination = transition.destination as AppScreen | null;
    if (destination && destination !== "run")
      return { title: SCREEN_TITLES[destination], progress: null };
    if (runCover) return runCover;
    // A rejoin's map, and a tower's seeded first floor, are known only once the world exists.
    if (destination === "run") {
      const mode = network?.config.mode ?? runPick.mode;
      const known = !network?.session.restored && mode !== "tower";
      return { title: known ? stageDefs[runPick.stage].name : "", progress: 0 };
    }
    return { title: "", progress: null };
  }
  /** What the curtain last showed: it keeps it while opening, and a run's last report after its
   *  load ends until then. */
  let shown: { title: string; progress: number | null } = { title: "", progress: null };
  let runShown = false;
  function sync() {
    if (disposed) return;
    if (transition.phase === "idle") runShown = false;
    const runEnded = runShown && !runCover && (transition.destination ?? "run") === "run";
    if (transition.phase !== "revealing" && !runEnded) {
      shown = curtain();
      runShown = shown === runCover;
    }
    host?.update({
      settingsOpen,
      settings,
      canSave: route !== "run" && route !== "room",
      solo: route !== "room" && !network,
      busy: transition.phase !== "idle",
      transition: transition.phase,
      transitionTitle: shown.title,
      transitionProgress: shown.progress,
      notification,
      progress: progressLoad.progress,
    });
    run?.update({
      modalActive: runModal(),
      sound: settings.sound,
      devMode: settings.devMode,
      pauseOnBlur: settings.pauseOnBlur,
      autoOpenCards: settings.autoOpenCards,
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
  function withAppearance(selection: LobbyPick) {
    return { ...selection, shiny: progressLoad.progress.looks.worn.includes(selection.starter) };
  }
  function cancelLook() {
    pendingLook?.hold.release();
    pendingLook = null;
  }
  async function wearLook(line: LobbyPick["starter"], target?: boolean) {
    if (route !== "lobby" || transition.destination || pick.starter !== line) return;
    const currentWorn = progressLoad.progress.looks.worn.includes(line);
    const worn = target ?? !(pendingLook?.worn ?? currentWorn);
    if ((pendingLook?.worn ?? currentWorn) === worn) return;
    if (target === undefined) audio.sfx("ui-confirm");
    else audio.sfx("ui-move");
    cancelLook();
    if (worn === currentWorn) return;
    const save = () => {
      if (
        change("异色外观", (current) => setShinyLook(current, line, worn)) &&
        screen instanceof GpuLobby
      )
        screen.lookSaved(line, worn);
    };
    if (progressLoad.status === "locked") {
      save();
      return;
    }
    const parts: Handle<unknown>[] = lineForms(line).map(({ id }) =>
      images().acquire(portraitSrc(id, worn), "art", "interactive"),
    );
    const map = worn && shinyMapNeed(starters[line].stages[0].form.id);
    if (map) parts.push(map.acquire("interactive"));
    const hold = allOf(`look:${line}`, parts);
    pendingLook = { worn, hold };
    try {
      await hold.result;
      if (pendingLook?.hold === hold && !transition.destination) save();
    } catch (error) {
      if (pendingLook?.hold === hold && !transition.destination) {
        console.error("异色外观载入失败", line, error);
        notify("模型载入失败，请检查网络后再试。");
      }
    } finally {
      hold.release();
      if (pendingLook?.hold === hold) pendingLook = null;
    }
  }
  function refreshScreen() {
    pick = validPick(progressLoad.progress, pick);
    if (screen instanceof GpuLab) screen.update(progressLoad.progress);
    else if (screen instanceof GpuLobby) {
      select(withAppearance(pick));
      screen.update({ progress: progressLoad.progress, pick, rules: selectedRules });
    } else screen?.update(progressLoad.progress);
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
      progressLoad = { status: "ready", progress, needsSave: false };
      refreshScreen();
      sync();
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
          cancelLook();
          progressLoad = { status: "ready", progress: save.progress, needsSave: false };
          selectedRules = availableSelection(save.progress);
          settings = save.settings;
          audio.setEnabled(settings.sound);
          refreshScreen();
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
  /** The player's own choice, from the lobby or the room page. */
  function choose(next: LobbyPick) {
    if (next.starter !== pick.starter) cancelLook();
    pick = next;
    try {
      storage.savePick(next);
    } catch (error) {
      notify((error as Error).message);
    }
    select(withAppearance(next));
  }
  function chooseRules(next: readonly RuleId[]) {
    selectedRules = availableSelection(progressLoad.progress, next);
  }
  function start(next: LobbyPick, multiplayer?: MultiplayerRun) {
    if (transition.phase !== "idle") return;
    if (!starterUnlocked(progressLoad.progress, next.starter))
      throw new Error(`${starters[next.starter].stages[0].form.name} 尚未加入。`);
    runPick = next;
    network = multiplayer;
    depart(withAppearance(next));
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
    runCover = null;
    devBadge?.dispose();
    devBadge = undefined;
    unmount?.();
    unmount = undefined;
    screen = undefined;
    const from = route;
    route = destination;
    const progress = progressLoad.progress;
    if (destination === "run") {
      const rules = network?.config.rules ?? availableSelection(progress, selectedRules);
      const carried = rules.includes("no-items") ? [] : progress.backpack;
      run = createRunSession({
        rules,
        ...withAppearance(runPick),
        multiplayer: network,
        lab: labBonuses(progress.lab),
        ...partnerBondSetup(progress, runPick.starter),
        loadout: { archive: progress.archive, backpack: carried, unlocks: progress.unlocks },
        backpack:
          progressLoad.status === "ready" && !rules.includes("no-items")
            ? {
                size: backpackSlots(progress),
                onKeep: (items) => change("背包", (current) => setBackpack(current, items)),
              }
            : null,
        app,
        gpuHost: host!,
        modalActive: runModal(),
        sound: settings.sound,
        devMode: settings.devMode,
        pauseOnBlur: settings.pauseOnBlur,
        autoOpenCards: settings.autoOpenCards,
        onStarted() {
          if (network?.session.restored) return true;
          const remember = (!network || network.host) && rules.join() !== progress.rules.join();
          if (!remember && !carried.length) return true;
          return change("出发", (current) => ({
            ...(carried.length ? setBackpack(current, []) : current),
            rules: remember ? [...rules] : current.rules,
          }));
        },
        onFinish(result) {
          if (progressLoad.status === "locked") return { ok: false, error: progressLoad.message };
          const previous = progressLoad.progress;
          if (!change("记录保存", (current) => recordRun(current, result)))
            return { ok: false, error: "记录保存失败。" };
          return {
            ok: true,
            note: runUnlocks(previous, progressLoad.progress),
            badges: progressLoad.progress.badges.filter((id) => !previous.badges.includes(id)),
            bond: {
              before: previous.bonds[result.starter] ?? 0,
              after: progressLoad.progress.bonds[result.starter] ?? 0,
              look:
                !previous.looks.owned.includes(result.starter) &&
                progressLoad.progress.looks.owned.includes(result.starter),
            },
          };
        },
        onRetry(note) {
          if (network) {
            network.dispose();
            network = undefined;
            if (note) notify(note);
            transition.navigate("room");
          } else {
            if (note) notify(note);
            start(runPick);
          }
        },
        onLobby: back,
        onSettings: openSettings,
        onCover: coverRun,
      });
    } else if (destination === "lobby") {
      pick = validPick(progress, pick);
      select(withAppearance(pick));
      const lobby = new GpuLobby(
        host!.fonts,
        host!.backdrop,
        { progress, pick, rules: selectedRules },
        {
          pick: choose,
          rules: chooseRules,
          shiny: (line, worn) => void wearLook(line, worn),
          start,
          lab: () => transition.navigate("lab"),
          codex: () => {
            labCodex = undefined;
            transition.navigate("codex");
          },
          settings: openSettings,
          multiplayer: () => transition.navigate("room"),
          openLink: (url) => surface.openUrl(url),
        },
      );
      const scene = new LobbyScene(app, notify);
      lobby.attachScene(scene);
      const unregister = host!.registerScreen(lobby);
      screen = lobby;
      // Back from the 图鉴 page, focus returns to the key that opened it.
      if (from === "codex") lobby.focusCodex();
      else lobby.focusStart();
      unmount = () => {
        cancelLook();
        unregister();
        scene.dispose();
        lobby.dispose();
      };
      if (revealed) audio.music.play("menu");
    } else if (destination === "room") {
      pick = validPick(progress, pick);
      unmount = mountMultiplayer(
        host!,
        options.harbor,
        progress,
        pick,
        selectedRules,
        {
          close: () => transition.navigate("lobby"),
          settings: openSettings,
          pick: choose,
          rules: chooseRules,
          copy(code) {
            void Promise.resolve()
              .then(() => surface.text.writeClipboard(code))
              .then(
                () => notify("房间码已复制"),
                (error: Error) => notify(`复制失败：${error.message}`),
              );
          },
          start(multiplayer) {
            const self = multiplayer.config.players[multiplayer.player]!;
            start(
              {
                stage: multiplayer.config.stage,
                mode: multiplayer.config.mode,
                difficulty: multiplayer.config.difficulty,
                starter: self.starter,
                trainer: self.trainer,
              },
              multiplayer,
            );
          },
        },
        storage,
        { directPeer: options.directPeer, signal },
        notify,
      );
      if (revealed) audio.music.play("menu");
    } else if (destination === "lab") {
      const at = from === "codex" ? labCodex?.at : undefined;
      labCodex = undefined;
      const lab = new GpuLab(
        host!.fonts,
        host!.backdrop,
        progress,
        {
          buy: (id) => change("购买", (current) => buyLab(current, id)),
          archive: (items) => change("档案库", (current) => setArchive(current, items)),
          codex: (key, at) => {
            labCodex = { key, at };
            transition.navigate("codex");
          },
          back: () => transition.navigate("lobby"),
          settings: openSettings,
        },
        at,
      );
      const unregister = host!.registerScreen(lab);
      screen = lab;
      unmount = () => {
        unregister();
        lab.dispose();
      };
      if (revealed) audio.music.play("menu");
    } else if (destination === "codex") {
      // The 图鉴 and its content tables load on first use, under the curtain (it holds on the
      // page being ready); a missing chunk returns to the lobby and the next try downloads again.
      void import("../ui/gpu/codex").then(
        ({ GpuCodexPage }) => {
          if (disposed || route !== "codex" || unmount) return;
          const codex = new GpuCodexPage(
            host!.fonts,
            progressLoad.progress,
            {
              back: () => transition.navigate(labCodex ? "lab" : "lobby"),
              settings: openSettings,
            },
            labCodex?.key,
          );
          const unregister = host!.registerScreen(codex);
          screen = codex;
          unmount = () => {
            unregister();
            codex.dispose();
          };
          sync();
        },
        (error: unknown) => {
          if (disposed || route !== "codex") return;
          console.error("图鉴载入失败", error);
          notify("图鉴载入失败，请检查网络后再试。");
          transition.navigate("lobby");
        },
      );
      if (revealed) audio.music.play("menu");
    }
    sync();
  }
  const stopErrors = audio.onError((error) => notify(error.message));
  function dispose() {
    if (disposed) return;
    disposed = true;
    launching?.cancel();
    transition.dispose();
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
    if (progressLoad.status === "ready" && progressLoad.needsSave) {
      try {
        storage.saveProgress(progressLoad.progress);
        progressLoad = { ...progressLoad, needsSave: false };
      } catch (error) {
        console.error("存档升级保存失败", error);
        notify(`存档升级保存失败：${(error as Error).message}`);
      }
    }
    sync();
    show("lobby");
    // The launcher waits for the opening pick's run too; the lobby's holds take it over before it goes.
    const opening = launch(withAppearance(pick));
    launching = opening;
    host.hold(opening, starters[pick.starter].stages[0].form.id);
    void host.launched.then(() => {
      if (disposed) return;
      openPrefetch(notify);
      opening.cancel();
      launching = undefined;
    });
    void host.revealed.then(() => {
      if (disposed) return;
      revealed = true;
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
