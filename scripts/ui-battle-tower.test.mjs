import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Texture } from "three";
import { setImageLoader } from "@pmndrs/uikit/dist/components/image.js";
import { installResources } from "../src/platform/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";
import { bindImages } from "../src/prepare/images.ts";
import { emptyProgress } from "../src/run/progress.ts";
import { DEFAULT_TRAINER } from "../src/run/sim/content/trainers.ts";
import { GpuLobby } from "../src/ui/gpu/lobby.ts";
import { GpuMultiplayer } from "../src/ui/gpu/multiplayer.ts";
import { GpuResultContent } from "../src/ui/gpu/run-overlays-result.ts";
import { UiStage, setUiPixelRatio } from "../src/ui/gpu/stage.ts";
import { fitScale } from "../src/ui/gpu/viewport.ts";

// Real Yoga and committed glyph metrics, without raster decoding or GPU uploads: the battle tower's
// mode choice, its lock, the partner's best floor and the floors passed. The look needs the App.
const core = new URL("../public/fonts/gpu/core/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", core), "utf8"));
function font(key) {
  const p = JSON.parse(readFileSync(new URL(manifest[key].json, core), "utf8"));
  return {
    pages: p.pages,
    pageSizes: p.pageSizes,
    pageTextures: p.pages.map(() => new Texture()),
    chars: p.glyphs.map(([id, page, x, y, width, height, xoffset, yoffset, xadvance]) => ({
      id,
      char: String.fromCodePoint(id),
      page,
      x,
      y,
      width,
      height,
      xoffset,
      yoffset,
      xadvance,
    })),
    info: { size: p.size },
    common: { lineHeight: p.lineHeight },
    distanceField: { distanceRange: p.distanceRange },
    kernings: [],
  };
}
const fonts = {
  "Poketone UI": { 500: font("ui-500"), 700: font("ui-700"), 800: font("ui-800") },
  "Poketone Display": { 400: font("display") },
};
function install() {
  installRuntime({ createAudioDecoder: () => ({}), activateAudio() {} });
  setImageLoader(() => new Promise(() => {}));
  installResources({ read: () => new Promise(() => {}), createTexture: () => new Texture() });
  bindImages({
    generation: 0,
    available: false,
    subscribe: () => () => {},
    enqueue() {},
    upload() {},
    resident: () => () => {},
  });
}
async function settle(screen, delay = 50) {
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  for (let frame = 0; frame < 32; frame++) {
    screen.stage.update(16);
    screen.afterLayout(16);
  }
}
const box = (stage, panel) => {
  const v = stage.viewport;
  const [w, h] = panel.size.value;
  const m = panel.globalMatrix.value.elements;
  return {
    x: (m[12] - stage.camera.left) * v.scale,
    y: (stage.camera.top - m[13]) * v.scale,
    w: w * v.scale,
    h: h * v.scale,
  };
};
const pick = {
  mode: "expedition",
  starter: "charmander",
  difficulty: 0,
  stage: "forest",
  trainer: DEFAULT_TRAINER,
};
const texts = (root) => {
  const out = [];
  root.traverse((node) => {
    const value = node.properties?.peek?.().text;
    if (typeof value === "string") out.push(value);
  });
  return out;
};
const lobbyCallbacks = (extra) => ({
  pick() {},
  start() {},
  lab() {},
  codex() {},
  settings() {},
  multiplayer() {},
  openLink() {},
  shiny() {},
  rules() {},
  ...extra,
});
const unlocked = () => ({
  ...emptyProgress(),
  clears: [1, 0, 0],
  tower: { charmander: { floor: 12, difficulty: 1 } },
});

test("the lobby's 对战塔 stays locked before a clear, then picks and shows the best floor", async () => {
  install();
  try {
    for (const { width, height, dpr, safe } of [
      { width: 1280, height: 800, dpr: 1, safe: { left: 0, right: 0, top: 0, bottom: 0 } },
      { width: 844, height: 390, dpr: 3, safe: { left: 47, right: 47, top: 0, bottom: 21 } },
    ]) {
      setUiPixelRatio(dpr);
      const where = `${width}x${height}`;
      const picks = [];
      const closed = new GpuLobby(
        fonts,
        new Texture(),
        { progress: emptyProgress(), pick, rules: [] },
        lobbyCallbacks({ pick: (p) => picks.push(p) }),
      );
      try {
        closed.resize(width, height, fitScale(1, width, height, safe, closed.minLayout), safe);
        await settle(closed);
        const [, tower] = closed.controls.filter((c) => c.kind === "mode");
        assert.ok(tower.locked(), `locked before a clear: ${where}`);
        assert.ok(tower.tip(), "the lock says how it opens");
        const t = box(closed.stage, tower.panel);
        closed.activate(closed.hit(t.x, t.y));
        assert.deepEqual(picks, [], `a locked tower is never picked: ${where}`);
        // ↑ from the tray reaches the picked mode while 规则 is still closed.
        closed.setFocusVisible(true);
        closed.focus(closed.controls.indexOf(closed.segments[0]));
        closed.navigate("up");
        assert.equal(closed.controls[closed.focused].kind, "mode", where);
      } finally {
        closed.dispose();
      }

      const lobby = new GpuLobby(
        fonts,
        new Texture(),
        { progress: unlocked(), pick, rules: [] },
        lobbyCallbacks({ pick: (p) => picks.push(p) }),
      );
      try {
        lobby.resize(width, height, fitScale(1, width, height, safe, lobby.minLayout), safe);
        await settle(lobby);
        const modes = lobby.controls.filter((c) => c.kind === "mode");
        const record = lobby.towerRecord.panel;
        assert.equal(record.isVisible.value, false, "探险 shows the route, not the record");
        // Keys / pad: ↑ to 规则, → onto the picked mode, → picks 对战塔, ← back to 探险 then 规则.
        lobby.setFocusVisible(true);
        lobby.focus(lobby.controls.indexOf(lobby.segments[1]));
        lobby.navigate("up");
        assert.equal(lobby.controls[lobby.focused].kind, "rules", `↑ from the tray: ${where}`);
        lobby.navigate("right");
        assert.equal(lobby.focused, lobby.controls.indexOf(modes[0]), `→ to the mode: ${where}`);
        lobby.navigate("right");
        assert.equal(picks.at(-1)?.mode, "tower", `→ picks 对战塔: ${where}`);
        await settle(lobby, 0);
        assert.ok(record.isVisible.value, `对战塔 shows the best floor: ${where}`);
        assert.ok(texts(record).includes("12") && texts(record).includes("· 困难"), where);
        const r = box(lobby.stage, record);
        assert.ok(r.x + r.w / 2 <= width - safe.right + 1, `record inside: ${where}`);
        for (const c of modes) {
          const b = box(lobby.stage, c.panel);
          assert.ok(b.w >= 43.5 && b.h >= 43.5, `mode touch target: ${where}`);
          assert.equal(lobby.hit(b.x, b.y), lobby.controls.indexOf(c), `mode hit: ${where}`);
        }
        lobby.navigate("left");
        assert.equal(picks.at(-1)?.mode, "expedition", `← picks 探险: ${where}`);
        lobby.navigate("left");
        assert.equal(lobby.controls[lobby.focused].kind, "rules", `← reaches 规则: ${where}`);
        assert.equal(lobby.selected, "charmander", "sideways keeps the partner");
      } finally {
        lobby.dispose();
      }
    }
  } finally {
    setImageLoader(null);
    setUiPixelRatio(1);
  }
});

const roomState = (self, mission) => ({
  room: {
    code: "123456",
    players: [
      { starter: "charmander", trainer: DEFAULT_TRAINER, shiny: false },
      { starter: "squirtle", trainer: DEFAULT_TRAINER, shiny: false },
    ],
    mission,
    missionRevision: 0,
    started: false,
    ready: [0, 1],
    online: [0, 1],
    departed: [],
  },
  self,
  mode: "relay",
  starting: false,
  canStart: false,
  peers: {},
  error: "",
});

test("the room: the host picks 对战塔, a guest reads it and sees its own best floor", async () => {
  install();
  setUiPixelRatio(1);
  const picks = [];
  const make = (progress, starter) =>
    new GpuMultiplayer(
      fonts,
      {
        create() {},
        join() {},
        start() {},
        cancel() {},
        close() {},
        settings() {},
        copy() {},
        pick: (p) => picks.push(p),
        rules() {},
        confirm() {},
      },
      progress,
      { ...pick, starter },
      [],
    );
  const host = make(unlocked(), "charmander");
  const guest = make(
    { ...emptyProgress(), tower: { squirtle: { floor: 3, difficulty: 0 } } },
    "squirtle",
  );
  const mission = (mode) => ({ mode, stage: "forest", difficulty: 0, rules: [] });
  try {
    for (const room of [host, guest])
      room.resize(844, 390, 1, { left: 0, right: 0, top: 0, bottom: 0 });
    host.update(roomState(0, mission("expedition")));
    await settle(host);
    const keys = host.controls.filter((c) => host.modeRow.children.includes(c.panel));
    assert.equal(keys.length, 2);
    assert.ok(host.modeRow.isVisible.value, "the host has the mode keys");
    assert.equal(host.routeName.isVisible.value, false);
    keys[1].action();
    assert.equal(picks.at(-1)?.mode, "tower", "the host picks 对战塔");

    guest.update(roomState(1, mission("tower")));
    await settle(guest);
    assert.equal(guest.modeRow.isVisible.value, false, "a guest has no mode keys");
    assert.equal(String(guest.routeName.properties.peek().text), "对战塔");
    assert.equal(guest.routeMap.panel.isVisible.value, false);
    assert.ok(texts(guest.towerRecord.panel).includes("3"), "the guest's own best floor");
    const before = picks.length;
    const guestKeys = guest.controls.filter((c) => guest.modeRow.children.includes(c.panel));
    guestKeys[0].action();
    assert.equal(picks.length, before, "a guest cannot change the mode");
  } finally {
    host.dispose();
    guest.dispose();
    setImageLoader(null);
  }
});

test("the result shows the floors passed only after a tower run", async () => {
  install();
  setUiPixelRatio(1);
  const stage = new UiStage();
  stage.resize(1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 });
  stage.root.setProperties({ fontFamilies: fonts });
  const result = {
    danger: 0,
    outcome: "defeat",
    starter: "charmander",
    difficulty: 0,
    time: 600,
    level: 12,
    kills: 300,
    dex: {},
    stardust: 0,
    moves: [{ id: "ember", level: 3, damage: 100 }],
    items: [],
  };
  const state = (r) => ({ result: r, note: null, badges: [], backpackSize: null });
  const callbacks = { keepItems: () => true, retry() {}, exit() {}, invalidate() {} };
  const content = new GpuResultContent(state({ ...result, floor: 7 }), callbacks, stage);
  try {
    const tower = texts(content.root);
    assert.ok(tower.includes("通过") && tower.includes("7") && tower.includes("层"));
    content.update(state(result));
    assert.ok(!texts(content.root).includes("通过"), "an expedition shows no floors");
  } finally {
    content.dispose();
    stage.dispose();
    setImageLoader(null);
  }
});
