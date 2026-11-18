// Actual host, MenuInput, ActionInput, image/fetch stores and LobbyScene. GPU widgets and
// renderer calls are substitutes; this checks ownership, not rendered appearance or devices.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { BoxGeometry, Mesh, MeshBasicMaterial, Texture } from "three";
import { fileURLToPath } from "node:url";

const noop = () => {};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => Promise.withResolvers();
const source = (path) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
const backdrop = "/art/lobby/backdrop.webp";
const hashedBackdrop = "/art/lobby/backdrop.fixture-hash.webp";
globalThis.__ASSET_URLS__ = { [backdrop]: hashedBackdrop };

function stage() {
  return {
    scene: { traverse: noop },
    renders: 0,
    update: () => false,
    compileAsync: async () => {},
    render() {
      this.renders++;
    },
    invalidate: noop,
    releaseUploads: noop,
  };
}
class Screen {
  stage = stage();
  minLayout = { width: 667, height: 375 };
  navigation = [];
  activations = [];
  selected = 0;
  constructor(_fonts, options) {
    this.options = options;
  }
  resize() {}
  afterLayout() {}
  setFocusVisible() {}
  setCoarsePointer() {}
  setFullscreenAction() {}
  setCovered() {}
  setRevealed() {}
  showPlace() {}
  pointerDown() {}
  pointerMove() {}
  pointerUp() {
    return false;
  }
  hit() {
    return 1;
  }
  hover() {}
  focus(index) {
    this.selected = index;
  }
  activate(index) {
    this.activations.push(index);
  }
  navigate(action) {
    this.navigation.push(action);
    if (action === "next" || action === "down") this.selected++;
    if (action === "confirm") this.activate(this.selected);
    return true;
  }
  scroll() {}
  setPressed() {}
  releaseUploads() {}
  dispose() {}
}
class Dialog extends Screen {
  closing = false;
  exitFinished = false;
  age = 0;
  close() {
    this.closing = true;
  }
  afterLayout(ms) {
    if (this.closing) this.exitFinished = (this.age += ms) >= 220;
  }
  navigate(action) {
    if (this.closing) return false;
    return super.navigate(action);
  }
}
class Codex extends Screen {
  render(renderer) {
    this.stage.render(renderer);
  }
  closeWindow() {}
}
class Shell extends Screen {
  static last;
  portrait = false;
  phase = "idle";
  fullscreenAction;
  constructor(...args) {
    super(...args);
    Shell.last = this;
  }
  get blocking() {
    return this.portrait || this.phase !== "idle";
  }
  setPortrait(value) {
    this.portrait = value;
  }
  // The notice's fullscreen key: the only control, shown while the host hands it an action.
  setFullscreenAction(action) {
    this.fullscreenAction = action;
  }
  hit() {
    return this.portrait && this.fullscreenAction ? 0 : -1;
  }
  activate() {
    if (!this.portrait || !this.fullscreenAction) return false;
    this.fullscreenAction();
    return true;
  }
  setTransition(phase) {
    this.phase = phase;
  }
  update() {}
}
class Toast extends Screen {
  visible = false;
  setMessage() {}
  setHovered() {}
  hit() {
    return -1;
  }
}
const released = [];
await mock.module(source("ui/gpu/fonts.ts"), () => ({
  uiFonts: () => ({
    families: {},
    readyNow: (target) => !target.wait,
    ready: async (target) => target.wait,
    release: (target) => released.push(target),
    prefetch: noop,
    pagesOf: () => [],
    registry: { pages: new Map() },
  }),
}));
await mock.module(source("audio/engine.ts"), () => ({
  UI_SOUNDS: [],
  getAudio: () => ({
    acquire: () => ({ result: Promise.resolve(), release: noop }),
    sfx: noop,
  }),
}));
await mock.module(source("ui/gpu/app-shell.ts"), () => ({ GpuShell: Shell }));
await mock.module(source("ui/gpu/toast.ts"), () => ({ GpuToast: Toast }));
const launchers = [];
/** Its wordmark's font page (null: in at once). */
let launcherFont = null;
await mock.module(source("ui/gpu/launcher.ts"), () => ({
  GpuLauncher: class {
    stage = stage();
    progress = [];
    wordmark = [];
    bar = { set: (value) => this.progress.push(value) };
    exiting = false;
    disposed = false;
    constructor() {
      launchers.push(this);
      if (launcherFont) this.stage.wait = launcherFont.promise;
    }
    // The exit is over on the frame after it starts.
    update() {
      return this.exiting;
    }
    get gone() {
      return this.exiting;
    }
    exit() {
      this.exiting = true;
    }
    resize() {}
    setPartner() {}
    showWordmark(shown) {
      this.wordmark.push({ shown, disposed: this.disposed });
    }
    dispose() {
      this.disposed = true;
    }
  },
}));
await mock.module(source("ui/gpu/lobby.ts"), () => ({ GpuLobby: Screen }));
await mock.module(source("ui/gpu/lab.ts"), () => ({ GpuLab: Screen }));
await mock.module(source("ui/gpu/settings-dialog.ts"), () => ({ SettingsDialog: Dialog }));
await mock.module(source("ui/gpu/codex.ts"), () => ({ GpuCodex: Codex }));

const { installResources } = await import("../src/platform/resources.ts");
const reads = [];
installResources({
  read: async (url) => {
    reads.push(url);
    return new Response(new Uint8Array([0]));
  },
  decodeImage: async () => ({
    source: { width: 1, height: 1, data: new Uint8Array(4) },
    width: 1,
    height: 1,
    release: noop,
  }),
  createTexture: () => new Texture(),
});
const { createGpuAppHost } = await import("../src/ui/gpu/app-host.ts");
const { ActionInput } = await import("../src/platform/input.ts");
const { images } = await import("../src/prepare/images.ts");

/** `boot`: the screen the launcher covers; `part`: the run it also waits for; `handoff`: false
 *  leaves the launcher up for the scenario. */
async function setup({ boot = new Screen(), part, handoff = true } = {}) {
  let events, ui, world;
  const errors = [],
    notes = [],
    modals = [],
    draws = [];
  const pad = {
    token: "fixture",
    family: "generic",
    name: "fixture",
    mapped: true,
    axes: [0, 0, 0, 0],
    buttons: new Set(),
  };
  const actions = new ActionInput({ sample: () => [pad], dispose: noop });
  const app = {
    available: true,
    generation: 0,
    renderer: {
      info: { programs: [] },
      createProgramRetention: () => ({ retain: noop, dispose: noop }),
      setPixelRatio: noop,
      setSize: noop,
      initTexture: noop,
      getRenderTarget: () => null,
      setRenderTarget: noop,
      compileAsync: async () => {},
      setClearColor: noop,
      clear: noop,
      clearDepth: noop,
      render: (scene) => draws.push(scene),
    },
    resident: () => noop,
    subscribe: () => noop,
    enqueue: (task) => queueMicrotask(task),
    invalidate: noop,
    inWorldTarget: (run) => run(),
    setUi: (client) => ((ui = client), noop),
    setWorld: (client) => ((world = client), noop),
  };
  const platform = {
    base: new URL("https://fixture.invalid/"),
    inputFocused: true,
    display: {
      width: 1280,
      height: 800,
      pixelRatio: 1,
      coarsePointer: false,
      portrait: false,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    listen: (next) => ((events = next), noop),
    focus: noop,
    capture: noop,
    release: noop,
    dispose: noop,
    setCursor: noop,
  };
  let state = {
    settings: { sound: true, devMode: false, uiScale: 1 },
    settingsOpen: false,
    canSave: true,
    busy: false,
    transition: "idle",
    notification: null,
  };
  const save = new Screen();
  save.modal = true;
  const host = await createGpuAppHost(
    app,
    platform,
    actions,
    {
      error: (error) => errors.push(error),
      notify: (message) => notes.push(message),
      modalActive: (value) => modals.push(value),
      openSettings: noop,
      closeSettings: () => update({ settingsOpen: false }),
      changeSettings: noop,
      dismissNotification: noop,
      openSave: () => host.registerScreen(save),
    },
    new AbortController().signal,
  );
  function update(next) {
    host.update((state = { ...state, ...next }));
  }
  update({});
  // Boot as the session does it: the lobby registered under the launcher, the opening run held.
  const unregisterBoot = host.registerScreen(boot);
  if (part) host.hold(part, "fixture");
  let launched = false;
  void host.launched.then(() => (launched = true));
  const pump = async (frames, until = () => false) => {
    for (let i = 0; i < frames && !until(); i++) {
      ui.advance(16);
      ui.draw();
      await flush();
    }
  };
  if (handoff) {
    // Its needs in, the launcher leaves by itself; scenarios then register their own screens.
    await pump(50, () => launched && launchers.at(-1).disposed);
    assert.ok(launchers.at(-1).disposed, "the launcher leaves once the first screen is in");
    unregisterBoot();
  }
  function run() {
    const hud = Object.assign(new Screen(), {
      inputBlocked: false,
      cancel: noop,
      setStick: noop,
      setWindowOpen: noop,
    });
    const overlays = Object.assign(new Screen(), {
      isModal: true,
      codexHome: 0,
      choiceOpen: false,
      revision: 0,
      warmUp: noop,
      choiceKey: () => false,
      navigate(action) {
        this.navigation.push(action);
        if (action === "cancel") this.codexHome = null;
        return true;
      },
    });
    const controller = {
      bindInput: noop,
      cancelInput: noop,
      resizeUi: noop,
      afterUiLayout: noop,
      sampleInput: noop,
      keyDown: () => false,
    };
    return host.registerRun(hud, overlays, controller);
  }
  return {
    host,
    app,
    platform,
    notes,
    modals,
    save,
    draws,
    update,
    run,
    events: () => events,
    launched: () => launched,
    pump,
    frame: () => {
      ui.advance(50);
      ui.draw();
    },
    world: () => world,
    press(button) {
      pad.buttons.add(button);
      host.sampleInput();
      pad.buttons.clear();
      host.sampleInput();
    },
    key(code) {
      events.keyDown({ code, key: code, shift: false, repeat: false });
      events.keyUp({ code, key: code, shift: false, repeat: false });
    },
    dispose() {
      host.dispose();
      actions.dispose();
      assert.deepEqual(errors, []);
    },
  };
}

const scenario = process.argv[2];
const compile = deferred();
const options = {
  "launch-waits-lobby": {
    handoff: false,
    // The lobby's programs compile asynchronously and take a while.
    boot: Object.assign(new Screen(), {
      stage: Object.assign(stage(), {
        compileAsync(renderer) {
          renderer.info.programs.push({});
          return compile.promise;
        },
      }),
    }),
  },
  "launch-progress-cancelled": {
    // The opening run's part, cancelled after a tenth of its work.
    part: {
      state: "cancelled",
      settled: Promise.resolve("cancelled"),
      setLane: noop,
      progress: () => ({
        network: { done: 1, total: 10, bytes: 0, bytesTotal: null },
        cpu: { done: 0, total: 0 },
        gpu: { done: 0, total: 0 },
      }),
    },
  },
  "dispose-during-boot": { handoff: false },
}[scenario];
if (scenario === "dispose-during-boot") launcherFont = deferred();
const s = await setup(options);
try {
  if (scenario === "launch-waits-lobby") {
    await s.pump(30);
    assert.equal(s.launched(), false, "the launcher waits for the lobby's programs");
    assert.equal(
      launchers[0].disposed,
      false,
      "the launcher still covers a lobby that cannot draw",
    );
    compile.resolve();
    await s.pump(10, () => launchers[0].disposed);
    assert.ok(s.launched() && launchers[0].disposed, "the launcher leaves once the lobby can draw");
  } else if (scenario === "launch-progress-cancelled") {
    assert.ok(launchers[0].progress.length > 0);
    assert.ok(
      Math.max(...launchers[0].progress) < 0.5,
      "a cancelled part counts the work it did, not all of it",
    );
  } else if (scenario === "dispose-during-boot") {
    const [launcher] = launchers;
    s.host.dispose();
    assert.ok(launcher.disposed);
    assert.ok(released.includes(launcher.stage), "its wordmark's font page is released");
    launcherFont.resolve();
    await flush();
    assert.deepEqual(
      launcher.wordmark.filter((call) => call.disposed),
      [],
      "a page arriving after the host went never touches the disposed launcher",
    );
  } else if (scenario === "codex-resumed-run") {
    s.run();
    s.host.openCodex();
    s.key("Escape");
    const overlays = s.host.inspect().run.overlays;
    assert.equal(overlays.codexHome, null);
    assert.equal(overlays.isModal, true, "the old pause frame is still drawing its exit");
    await flush();
    assert.equal(s.host.inspect().codex, undefined, "resuming invalidates the old pause request");
    assert.deepEqual(s.modals, []);
    overlays.codexHome = ++overlays.revision;
    s.host.openCodex();
    await flush();
    assert.ok(s.host.inspect().codex, "the new pause can still open the codex");
  } else if (scenario.startsWith("codex-")) {
    // Outside a run the 图鉴 is a page (app session); the window opens over a paused run only.
    const unregister = s.run();
    s.host.openCodex();
    // Finish the entire cover/commit/reveal before the import's continuation gets to run.
    s.update({ busy: true, transition: "cover" });
    unregister();
    s.run();
    s.update({ busy: false, transition: "idle" });
    await flush();
    assert.equal(
      s.host.inspect().codex,
      undefined,
      "the old request must not cover its replacement",
    );
    assert.deepEqual(s.modals, [], "a stale request must not block the replacement run's input");
    s.host.openCodex();
    await flush();
    assert.ok(s.host.inspect().codex, "a request from the current owner still opens normally");
  } else if (scenario === "settings-save-input") {
    s.host.registerScreen(new Screen());
    await images().uploaded();
    s.press("south"); // Claim the pad on the screen below; the settings tree starts clean.
    s.update({ settingsOpen: true });
    s.host.sampleInput();
    const settings = s.host.inspect().dialog;
    const ready = deferred();
    s.save.stage.wait = ready.promise;
    settings.options.onSave();
    s.frame();
    s.key("Tab");
    s.press("down");
    assert.deepEqual(s.save.navigation, [], "the preparing save window cannot take input");
    ready.resolve();
    await flush();
    const firstPress = { id: 3, x: 20, y: 20, kind: "mouse", button: 0 };
    s.events().down(firstPress);
    s.host.sampleInput();
    s.events().up(firstPress);
    assert.deepEqual(
      s.save.activations,
      [1],
      "a ready window owns its first press before the next sample",
    );
    s.save.activations.length = 0;
    s.save.selected = 0;
    s.key("Tab");
    assert.equal(
      s.save.selected,
      1,
      "keyboard focus reaches the entering window during settings exit",
    );
    s.press("down");
    assert.equal(s.save.selected, 2, "the same window receives gamepad navigation");
    const point = { id: 1, x: 20, y: 20, kind: "mouse", button: 0 };
    s.events().down(point);
    s.events().up(point);
    assert.deepEqual(s.save.activations, [1], "pointer activation reaches the same window");
    s.key("Escape");
    assert.equal(s.save.navigation.at(-1), "cancel");
    assert.deepEqual(settings.navigation, [], "the closing tree receives no navigation");
    assert.ok(settings.stage.renders > 0, "the exit tree remains drawn");
    assert.equal(s.host.inspect().dialog, settings);
    s.events().down(point);
    for (let i = 0; i < 5; i++) s.frame();
    assert.equal(s.host.inspect().dialog, undefined, "exit cleanup still completes");
    s.events().up(point);
    assert.deepEqual(
      s.save.activations,
      [1, 1],
      "retiring the old tree preserves the new window's press",
    );
  } else if (scenario === "backdrop-url") {
    await images().uploaded();
    assert.deepEqual(reads, [hashedBackdrop], "the actual host request uses the release mapping");
    const view = images().texture(backdrop, "art", noop);
    assert.equal(view.source, s.host.backdrop.source);
    assert.deepEqual(reads, [hashedBackdrop], "later screens reuse the same hashed source");
    view.dispose();
  } else if (scenario === "lobby-retry") {
    const { LobbyScene } = await import("../src/ui/gpu/lobby-scene.ts");
    const { models, canonicalModel, formModels } = await import("../src/run/view/assets.ts");
    const acquired = [];
    const acquire = models.acquire;
    models.acquire = (url) => {
      const request = { ...deferred(), url, releases: 0 };
      acquired.push(request);
      return {
        result: request.promise,
        setLane: noop,
        release: () => request.releases++,
      };
    };
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    mesh.name = "loaded-partner";
    const canonical = canonicalModel("/models/fixture.glb", { root: mesh, animations: [] });
    const scene = new LobbyScene(s.app, (message) => s.notes.push(message));
    scene.setLayout({
      width: 1280,
      height: 800,
      slab: 560,
      trainer: { x: 250, y: 96, h: 1060, right: 527 },
      feet: { x: 665, y: 532 },
      rx: 200,
      heroW: 260,
      heroH: 300,
    });
    try {
      scene.show("charmander", "fire");
      acquired[0].reject(new Error("temporary model download failure"));
      await flush();
      assert.equal(acquired[0].releases, 1);
      assert.equal(s.notes.length, 1, "current failure reaches the existing notification callback");
      scene.show("squirtle", "water");
      acquired[1].resolve(canonical);
      await flush();
      scene.show("charmander", "fire");
      assert.equal(
        acquired.length,
        3,
        "selecting the failed partner again starts a fresh acquisition",
      );
      assert.equal(acquired[2].url, formModels.charmander.url);
      acquired[2].resolve(canonical);
      await flush();
      s.world().advance(50);
      s.world().draw(s.app.renderer);
      assert.ok(
        s.draws.some((draw) => draw.getObjectByName(mesh.name)),
        "the retry reaches the world draw",
      );
      scene.show("squirtle", "water");
      scene.show("charmander", "fire");
      await flush();
      assert.equal(acquired.length, 3, "successful partners remain cached");
      scene.show("bulbasaur", "grass");
      scene.show("squirtle", "water");
      acquired[3].reject(new Error("late abandoned selection failure"));
      await flush();
      assert.equal(acquired[3].releases, 1);
      assert.equal(s.notes.length, 1, "an old selection does not notify over the new one");
      scene.show("pikachu", "electric");
      scene.dispose();
      acquired[4].reject(new Error("late unmounted lobby failure"));
      await flush();
      assert.equal(s.notes.length, 1);
      assert.ok(
        acquired.every((request) => request.releases === 1),
        "each hold releases once",
      );
    } finally {
      scene.dispose();
      models.acquire = acquire;
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  } else if (scenario === "portrait-fullscreen") {
    const below = new Screen();
    s.host.registerScreen(below);
    const calls = [];
    let releasing = false;
    const enter = async () => (calls.push(releasing), true);
    s.platform.landscapeFullscreen = enter;
    s.platform.display.portrait = true;
    s.events().displayChanged();
    const touch = { id: 5, x: 20, y: 20, kind: "touch", button: 0 };
    s.events().down(touch);
    assert.deepEqual(calls, [], "the press waits for its release");
    releasing = true;
    s.events().up(touch);
    releasing = false;
    assert.deepEqual(calls, [true], "fullscreen is asked inside the release, the touch's gesture");
    s.key("Enter");
    assert.equal(calls.length, 2, "Enter on the notice asks too");
    // A slow map load covers the app: the key still answers, the scene stays blocked.
    s.update({ busy: true, transition: "cover" });
    s.events().down(touch);
    releasing = true;
    s.events().up(touch);
    releasing = false;
    s.key("Space");
    assert.deepEqual(calls.slice(2), [true, false], "touch and Space ask while the scene is busy");
    s.update({ busy: false, transition: "idle" });
    s.platform.landscapeFullscreen = undefined;
    s.events().displayChanged();
    assert.equal(Shell.last.fullscreenAction, undefined, "fullscreen on: no key");
    s.events().down(touch);
    s.events().up(touch);
    s.key("Enter");
    assert.equal(calls.length, 4);
    assert.deepEqual(below.activations, [], "the notice keeps every press from the screen below");
  } else {
    throw new Error(`Unknown host lifecycle scenario: ${scenario}`);
  }
} finally {
  s.dispose();
}
