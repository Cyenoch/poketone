import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

// Run module substitutions in a separate process so they cannot replace other UI tests' modules.
if (!process.argv.includes("--run-session-fixture")) {
  for (const [name, contract] of [
    [
      "result",
      "failed run records survive retry, return and natural results without double credit",
    ],
    ["backpack", "a refused backpack write blocks activation and retry consumes it once"],
    [
      "migration",
      "startup upgrades save once and a refused upgrade preserves the old record for retry",
    ],
    ["fatal", "GPU host failure terminates preparing and active sessions"],
    ["notices", "run notices prioritize danger without duplicates, stale timers or queued replay"],
    [
      "notice-lifecycle",
      "hidden run notices expire and waiting or terminal states retain no backlog",
    ],
    ["curtain", "the loading curtain names the map each load enters and shows its real progress"],
    [
      "codex-page",
      "outside a run the 图鉴 is a page under the curtain, and back returns focus to its lobby key",
    ],
  ])
    test(contract, () => {
      const child = spawnSync(
        process.execPath,
        [import.meta.filename, "--run-session-fixture", name],
        { encoding: "utf8", timeout: 15000 },
      );
      assert.equal(child.status, 0, child.stdout + child.stderr);
    });
} else {
  const { mock } = await import("bun:test");
  const root = process.cwd();
  const at = (p) => `${root}/${p}`;
  const noop = () => {};
  let lobby, hud, overlays, controller, hostCallbacks, hostState, room;
  let codexPage;
  const screens = [];
  let codexWindows = 0;
  let failHostDuringCreation = false,
    failRunOnCreate = false;
  const hostStates = [];
  const audio = { music: { play: noop }, sfx: noop, setEnabled: noop, onError: () => noop };
  await mock.module(at("src/audio/engine.ts"), () => ({ getAudio: () => audio }));
  await mock.module(at("src/run/prefetch.ts"), () => ({
    depart: noop,
    launch: () => ({ cancel: noop }),
    open: noop,
    select: noop,
  }));
  class Lobby {
    constructor(fonts, backdrop, state, callbacks) {
      this.state = state;
      this.callbacks = callbacks;
      lobby = this;
    }
    update(state) {
      this.state = state;
    }
    attachScene() {}
    focusStart() {
      this.focused = "start";
    }
    focusCodex() {
      this.focused = "codex";
    }
    dispose() {}
  }
  class Lab {
    update() {}
    dispose() {}
  }
  class Hud {
    trainers = { clear: noop };
    constructor() {
      hud = this;
      this.updates = 0;
    }
    update(state) {
      this.state = state;
      this.updates++;
    }
    setChoiceOpen() {}
    dispose() {}
    slotCenter() {}
  }
  class Overlays {
    constructor(fonts, callbacks) {
      this.callbacks = callbacks;
      this.isModal = false;
      this.choiceOpen = false;
      overlays = this;
    }
    update(state) {
      this.state = state;
    }
    dispose() {}
  }
  await mock.module(at("src/ui/gpu/lobby.ts"), () => ({ GpuLobby: Lobby }));
  await mock.module(at("src/ui/gpu/lab.ts"), () => ({ GpuLab: Lab }));
  await mock.module(at("src/ui/gpu/codex.ts"), () => ({
    GpuCodexPage: class {
      constructor(fonts, progress, callbacks) {
        this.progress = progress;
        this.callbacks = callbacks;
        codexPage = this;
      }
      dispose() {}
    },
  }));
  await mock.module(at("src/ui/gpu/lobby-scene.ts"), () => ({
    LobbyScene: class {
      dispose() {}
    },
  }));
  await mock.module(at("src/ui/gpu/run-dev-readout.ts"), () => ({ GpuDevReadout: class {} }));
  await mock.module(at("src/ui/gpu/save-dialog.ts"), () => ({ GpuSaveDialog: class {} }));
  await mock.module(at("src/ui/gpu/multiplayer-session.ts"), () => ({
    mountMultiplayer: (...args) => {
      room = args[4];
      return noop;
    },
  }));
  await mock.module(at("src/ui/gpu/run-hud.ts"), () => ({ GpuRunHud: Hud }));
  await mock.module(at("src/ui/gpu/run-overlays.ts"), () => ({ GpuRunOverlays: Overlays }));
  await mock.module(at("src/ui/gpu/app-host.ts"), () => ({
    createGpuAppHost: async (_app, _surface, _input, callbacks) => {
      hostCallbacks = callbacks;
      if (failHostDuringCreation) callbacks.error(new Error("font preparation failed"));
      return {
        fonts: {},
        backdrop: {},
        revealed: new Promise(() => {}),
        launched: new Promise(() => {}),
        hold: noop,
        update: (state) => hostStates.push((hostState = state)),
        registerScreen(shown) {
          screens.push(shown);
          return () => screens.splice(screens.indexOf(shown), 1);
        },
        registerRun: () => noop,
        nextScreenReady: () => Promise.resolve(),
        sampleInput: noop,
        openCodex: () => codexWindows++,
        dispose: noop,
      };
    },
  }));
  const endedResult = (dust) => ({
    outcome: "defeat",
    starter: "charmander",
    difficulty: 0,
    time: 300,
    level: 10,
    kills: 100,
    stardust: dust,
    moves: [],
    items: [],
  });
  await mock.module(at("src/run/createRun.ts"), () => ({
    RUN_NOTICE_MS: { info: 900, danger: 2600, reward: 2600 },
    createRun: (app, hud, config, callbacks) => {
      let reported = false;
      let active = false;
      let disposed = false;
      const world = createWorld({
        stage: config.stage,
        seed: 7,
        difficulty: config.difficulty,
        players: [{ starter: config.starter }],
      });
      if (failRunOnCreate) callbacks.onError(new Error("injected load failure"));
      controller = {
        config,
        callbacks,
        result: endedResult(123),
        world,
        activate() {
          try {
            callbacks.onReady();
            if (!disposed) active = true;
          } catch (error) {
            callbacks.onError(error);
          }
        },
        frame() {
          if (active) stepWorld(world, []);
        },
        send(command) {
          if (command.t === "forfeit" && !reported) {
            reported = true;
            callbacks.onEnd(this.result);
          }
        },
        setPaused: noop,
        setPauseOnBlur: noop,
        setAutoOpenCards: noop,
        stats: () => ({}),
        setSound: noop,
        setDevMode: noop,
        dispose() {
          disposed = true;
          active = false;
        },
      };
      return controller;
    },
  }));
  const { installRuntime } = await import(at("src/platform/runtime.ts"));
  installRuntime({ nextFrame: () => Promise.resolve() });
  const { createAppSession } = await import(at("src/app/session.ts"));
  const { createWorld, stepWorld } = await import(at("src/run/sim/world.ts"));
  const { emptyProgress, parseProgress } = await import(at("src/run/progress.ts"));
  const settings = { sound: false, devMode: false, uiScale: 1 };
  async function setup(initial, { needsSave = false, failWrite = false } = {}) {
    let disk = structuredClone(initial),
      failNext = failWrite;
    const writes = [];
    const errors = [];
    const storage = {
      load: () => ({
        progress: { status: "ready", progress: parseProgress(structuredClone(disk)), needsSave },
        settings,
        pick: {},
      }),
      saveProgress(progress) {
        writes.push({ progress: structuredClone(progress), failed: failNext });
        if (failNext) {
          failNext = false;
          throw new Error("injected one-time write refusal");
        }
        disk = structuredClone(progress);
      },
      savePick: noop,
      saveSettings: noop,
    };
    const app = { setInput: () => noop };
    const surface = { createGamepads: () => ({ sample: () => [], dispose: noop }) };
    const session = await createAppSession(
      app,
      surface,
      storage,
      {
        harbor: "",
        error: (e) => errors.push(e),
      },
      new AbortController().signal,
    );
    const idle = async () => {
      for (let i = 0; i < 80 && session.state().busy; i++)
        await new Promise((r) => setTimeout(r, 10));
      assert.equal(session.state().busy, false);
    };
    // A run navigation holds its curtain until the run has loaded: wait for the new run only.
    const next = async (before) => {
      for (let i = 0; i < 80 && controller === before; i++)
        await new Promise((r) => setTimeout(r, 10));
      assert.notEqual(controller, before);
    };
    return {
      session,
      errors,
      idle,
      next,
      writes,
      fail: () => (failNext = true),
      disk: () => disk,
      start: async () => {
        const before = controller;
        lobby.callbacks.start(lobby.state.pick);
        await next(before);
      },
      /** The run loads; its curtain opens. */
      activate: async () => {
        controller.activate();
        await idle();
      },
    };
  }
  const which = process.argv.at(-1);
  if (which === "migration") {
    const { readFileSync } = await import("node:fs");
    const raw = atob(readFileSync(at("scripts/fixtures/save-v3-progress-v4.txt"), "utf8").trim());
    const legacy = JSON.parse(raw.slice(raw.indexOf(".") + 1, raw.lastIndexOf("."))).progress;
    for (const failWrite of [false, true]) {
      const t = await setup(legacy, { needsSave: true, failWrite });
      try {
        assert.equal(t.writes.length, 1);
        assert.equal(lobby.state.progress.version, 5);
        if (failWrite) {
          assert.deepEqual(t.disk(), legacy);
          assert.match(hostState.notification.message, /存档升级保存失败/);
          assert.equal(
            t.session.change("重试存档升级", (progress) => progress),
            true,
          );
        }
        assert.deepEqual(t.disk(), parseProgress(legacy));
        assert.equal(t.errors.length, 0);
      } finally {
        t.session.dispose();
      }
    }
  } else if (which === "result") {
    for (const intent of ["retry", "lobby", "natural"]) {
      const t = await setup(emptyProgress());
      try {
        await t.start();
        const first = controller;
        await t.activate();
        t.fail();
        if (intent === "natural") first.callbacks.onEnd(first.result);
        else overlays.callbacks[intent === "retry" ? "restart" : "quit"]();
        assert.equal(t.session.state().screen, "run");
        assert.equal(t.session.state().busy, false);
        assert.equal(overlays.state.kind, "save-error");
        assert.equal(t.disk().runs, 0);
        t.fail();
        overlays.callbacks.retry();
        assert.equal(overlays.state.kind, "save-error");
        assert.equal(t.disk().stardust, 0);
        overlays.callbacks.retry();
        if (intent === "lobby") await t.idle();
        else if (intent === "retry") await t.next(first);
        assert.equal(t.disk().runs, 1);
        assert.equal(t.disk().stardust, 123);
        if (intent === "natural") {
          assert.equal(overlays.state.kind, "result");
          overlays.callbacks.retry();
          await t.next(first);
        } else if (intent === "lobby") await t.start();
        assert.notEqual(controller, first);
        await t.activate();
        controller.result = endedResult(7);
        overlays.callbacks.quit();
        await t.idle();
        assert.equal(t.disk().runs, 2);
        assert.equal(t.disk().stardust, 130);
      } finally {
        t.session.dispose();
      }
    }
  } else if (which === "curtain") {
    const { stageDefs } = await import(at("src/run/sim/content/stages/index.ts"));
    const { nextField } = await import(at("src/run/sim/content/campaign.ts"));
    const settle = () => new Promise((r) => setTimeout(r, 0));
    /** Every curtain the host drew since `from`, until it opened: one map and one progress. */
    const drawn = (from) => {
      const shown = hostStates.slice(from).filter((state) => state.transition !== "idle");
      return new Set(shown.map((state) => `${state.transitionTitle}:${state.transitionProgress}`));
    };
    const t = await setup(emptyProgress());
    try {
      await t.start();
      const first = controller.config.stage,
        next = nextField(controller.world).stage;
      assert.equal(hostState.transition, "covering");
      assert.equal(hostState.transitionTitle, stageDefs[first].name);
      controller.callbacks.onLoadProgress(0.4);
      await settle();
      assert.equal(hostState.transitionProgress, 0.4);
      let from = hostStates.length;
      await t.activate();
      assert.equal(hostState.transition, "idle");
      // The ended load keeps its map and bar on the curtain while it opens.
      assert.deepEqual(drawn(from), new Set([`${stageDefs[first].name}:0.4`]));
      controller.callbacks.onZoneLoading(true, next);
      await settle();
      assert.equal(hostState.transition, "covering");
      assert.equal(hostState.transitionTitle, stageDefs[next].name);
      assert.equal(hostState.transitionProgress, 0);
      controller.callbacks.onLoadProgress(1);
      await settle();
      from = hostStates.length;
      controller.callbacks.onZoneLoading(false);
      await t.idle();
      assert.equal(hostState.transition, "idle");
      assert.deepEqual(drawn(from), new Set([`${stageDefs[next].name}:1`]));
    } finally {
      t.session.dispose();
    }
    // A load that fails before it reports any cover still opens the curtain onto its error.
    const failed = await setup(emptyProgress());
    try {
      failRunOnCreate = true;
      const before = controller;
      lobby.callbacks.start(lobby.state.pick);
      await failed.next(before);
      failRunOnCreate = false;
      await failed.idle();
      assert.equal(overlays.state.kind, "error");
    } finally {
      failRunOnCreate = false;
      failed.session.dispose();
    }
    // A rejoin names the map its world enters, not the room's first one.
    const rejoin = await setup(emptyProgress());
    try {
      lobby.callbacks.multiplayer();
      await rejoin.idle();
      const pick = lobby.state.pick;
      const before = controller;
      room.start({
        config: {
          stage: pick.stage,
          difficulty: pick.difficulty,
          players: [{ starter: pick.starter, trainer: pick.trainer }],
        },
        player: 0,
        session: { restored: true },
        suspended: false,
        reconnecting: false,
        dispose: noop,
      });
      await rejoin.next(before);
      await settle();
      const later = nextField(controller.world).stage;
      assert.notEqual(later, pick.stage);
      assert.equal(hostState.transition, "covering");
      assert.notEqual(hostState.transitionTitle, stageDefs[pick.stage].name);
      controller.callbacks.onLoadStage(later);
      await settle();
      assert.equal(hostState.transitionTitle, stageDefs[later].name);
      await rejoin.activate();
    } finally {
      rejoin.session.dispose();
    }
  } else if (which === "backpack") {
    const t = await setup({ ...emptyProgress(), backpack: ["hp-up"] });
    try {
      await t.start();
      const first = controller;
      assert.deepEqual(first.config.loadout.backpack, ["hp-up"]);
      t.fail();
      await t.activate();
      assert.equal(overlays.state.kind, "error");
      first.frame();
      assert.equal(first.world.tick, 0);
      assert.deepEqual(t.disk().backpack, ["hp-up"]);
      overlays.callbacks.retry();
      await t.next(first);
      await t.activate();
      assert.deepEqual(t.disk().backpack, []);
      controller.frame();
      assert.ok(controller.world.tick > 0);
      const second = controller;
      overlays.callbacks.restart();
      await t.next(second);
      assert.deepEqual(controller.config.loadout.backpack, []);
    } finally {
      t.session.dispose();
    }
  } else if (which === "fatal") {
    for (const ready of [false, true]) {
      const t = await setup(emptyProgress());
      await t.start();
      const first = controller;
      if (ready) {
        first.activate();
        first.frame();
      }
      const tick = first.world.tick;
      hostCallbacks.error(new Error("GPU update failed"));
      if (!ready) first.activate();
      for (let i = 0; i < 6; i++) first.frame();
      assert.equal(first.world.tick, tick);
      assert.equal(t.errors.length, 1);
      t.session.dispose();
    }
    failHostDuringCreation = true;
    await assert.rejects(setup(emptyProgress()), /font preparation failed/);
  } else if (which === "notices" || which === "notice-lifecycle") {
    const { createRunSession } = await import(at("src/run/session.ts"));
    const { NO_LAB } = await import(at("src/run/sim/stats.ts"));
    const { formOf } = await import(at("src/run/sim/evolution.ts"));
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const realNow = performance.now.bind(performance);
    const timers = new Map();
    let now = 0;
    let nextTimer = 0;
    performance.now = () => now;
    globalThis.setTimeout = (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { at: now + delay, callback });
      return id;
    };
    globalThis.clearTimeout = (id) => timers.delete(id);
    const advance = async (ms) => {
      now += ms;
      for (const [id, timer] of timers)
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      await Promise.resolve();
    };
    const mount = () => {
      const multiplayer = { session: { restored: false } };
      const session = createRunSession({
        multiplayer,
        stage: "forest",
        starter: "charmander",
        difficulty: 0,
        lab: NO_LAB,
        loadout: { archive: [], backpack: [] },
        backpack: null,
        app: {},
        gpuHost: { fonts: {}, registerRun: () => noop },
        modalActive: false,
        sound: false,
        devMode: false,
        onStarted: () => true,
        onFinish: () => ({ ok: true, note: null }),
        onRetry: noop,
        onLobby: noop,
        onSettings: noop,
        onCover: noop,
      });
      const callbacks = controller.callbacks;
      const snap = {
        form: formOf(controller.world.players[0]).id,
        pending: null,
        dialog: null,
        zone: { index: 0, count: 3 },
      };
      controller.activate();
      callbacks.onSnapshot(snap);
      const emit = async (text, tone, ageMs = 0) => {
        callbacks.onBanner(text, tone, ageMs);
        await Promise.resolve();
      };
      return { session, callbacks, snap, emit, multiplayer };
    };
    try {
      if (which === "notices") {
        const t = mount();
        try {
          await t.emit("区域", "info");
          const first = hud.state.notice;
          await advance(500);
          await t.emit("区域", "info");
          assert.deepEqual(hud.state.notice, first, "the same notice keeps its original identity");
          await advance(450);
          assert.equal(hud.state.notice, null, "duplicate delivery does not extend the deadline");

          await t.emit("区域", "info");
          await advance(400);
          await t.emit("捕获", "reward");
          await advance(400);
          await t.emit("冲锋", "danger");
          const danger = hud.state.notice;
          await t.emit("捕获", "reward");
          await t.emit("区域", "info");
          assert.deepEqual(hud.state.notice, danger, "lower priorities cannot displace danger");
          await advance(300);
          assert.deepEqual(hud.state.notice, danger, "the replaced info timer cannot erase danger");
          await t.emit("喷发", "danger");
          const replacement = hud.state.notice;
          assert.equal(replacement.text, "喷发", "a different same-priority notice replaces");
          await advance(2000);
          await t.emit("喷发", "danger");
          await advance(500);
          assert.deepEqual(
            hud.state.notice,
            replacement,
            "replaced deadlines cannot clear the current notice",
          );
          await advance(200);
          assert.equal(hud.state.notice, null, "no dropped reward or info is replayed");
          assert.equal(timers.size, 0);

          await t.emit("积压危险", "danger", 3000);
          assert.equal(hud.state.notice, null, "network age does not restart an expired notice");
          await t.emit("仍有效的危险", "danger", 2000);
          assert.equal(hud.state.notice.text, "仍有效的危险");
          await advance(700);
          assert.equal(hud.state.notice, null, "network age reduces the remaining lifetime");

          await t.emit("同文", "info");
          await t.emit("同文", "reward");
          assert.equal(
            hud.state.notice.tone,
            "reward",
            "the same text with a higher tone is a new notice",
          );
        } finally {
          t.session.dispose();
        }
      } else {
        const t = mount();
        try {
          const snapshot = (fields) => {
            Object.assign(t.snap, fields);
            t.callbacks.onSnapshot(t.snap);
          };
          const modal = (active) =>
            t.session.update({
              modalActive: active,
              sound: false,
              devMode: false,
              pauseOnBlur: true,
              autoOpenCards: true,
            });
          for (const cover of [
            "choice",
            "pause",
            "stats",
            "station",
            "modal",
            "closing",
            "map",
            "reconnecting",
            "suspended",
          ]) {
            const show = (active) => {
              if (cover === "choice") snapshot({ pending: active ? { id: 1, options: [] } : null });
              else if (cover === "pause") {
                if (active) t.callbacks.onPauseRequest("pause");
                else overlays.callbacks.resume();
              } else if (cover === "stats") {
                if (active) t.callbacks.onStatsRequest();
                else overlays.callbacks.closeStats();
              } else if (cover === "station")
                snapshot({ dialog: active ? { kind: "bill" } : null });
              else if (cover === "modal") modal(active);
              else if (cover === "closing") {
                overlays.isModal = active;
                snapshot({});
              } else if (cover === "map") t.callbacks.onMapChange(active);
              else {
                t.multiplayer[cover] = active;
                t.multiplayer.onConnectionChange();
              }
            };
            await t.emit("冲锋", "danger");
            show(true);
            assert.equal(hud.state.notice, null, `${cover} hides an existing notice`);
            await t.emit("喷发", "danger");
            assert.equal(hud.state.notice, null, `${cover} hides new notices too`);
            await advance(3000);
            show(false);
            assert.equal(hud.state.notice, null, `${cover} does not replay expired notices`);
          }
          await t.emit("冲锋", "danger");
          assert.equal(hud.state.notice.tone, "danger");
          await advance(3000);
          assert.equal(hud.state.notice, null, "a timed message expires");
          assert.equal(timers.size, 0);
          await t.emit("窗口里的旧消息", "danger");
          modal(true);
          now += 3000;
          modal(false);
          assert.equal(
            hud.state.notice,
            null,
            "closing a cover before a delayed timer runs cannot reveal expired text",
          );
        } finally {
          t.session.dispose();
        }
        for (const end of ["zone", "error", "end", "dispose"]) {
          const t = mount();
          await t.emit("上一状态", "danger");
          if (end === "zone") {
            t.callbacks.onZoneLoading(true);
            await t.emit("加载中的旧消息", "reward");
            t.callbacks.onZoneLoading(false);
          } else if (end === "error") t.callbacks.onError(new Error("zone failed"));
          else if (end === "end") t.callbacks.onEnd(endedResult(0));
          else t.session.dispose();
          assert.equal(timers.size, 0, `${end} releases the deadline`);
          if (end !== "dispose") assert.equal(hud.state.notice, null, `${end} clears the notice`);
          if (end !== "dispose") t.session.dispose();
          const updates = hud.updates;
          t.callbacks.onBanner("过期回调", "danger", 0);
          await advance(3000);
          assert.equal(hud.updates, updates, "disposal cancels late notice refreshes");
        }
      }
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
      performance.now = realNow;
    }
  } else if (which === "codex-page") {
    const progress = { ...emptyProgress(), research: 42 };
    const t = await setup(progress);
    try {
      lobby.callbacks.codex();
      await t.idle();
      for (let i = 0; i < 80 && !screens.includes(codexPage); i++)
        await new Promise((r) => setTimeout(r, 10));
      assert.equal(t.session.state().screen, "codex");
      assert.deepEqual(screens, [codexPage], "the page replaces the lobby, not a window over it");
      assert.equal(codexWindows, 0);
      assert.equal(codexPage.progress.research, 42, "locked partners read the player's progress");
      codexPage.callbacks.back();
      await t.idle();
      assert.equal(t.session.state().screen, "lobby");
      assert.deepEqual(screens, [lobby]);
      assert.equal(lobby.focused, "codex");
    } finally {
      t.session.dispose();
    }
  } else throw new Error(`Unknown fixture ${which}`);
}
