import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Texture } from "three";
import { setImageLoader } from "@pmndrs/uikit/dist/components/image.js";
import { installResources } from "../src/platform/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";
import { bindImages } from "../src/prepare/images.ts";
import { emptyProgress } from "../src/run/progress.ts";
import { badgeIds, badges } from "../src/run/sim/content/badges.ts";
import { RULE_DANGER, DANGER_STARDUST } from "../src/run/sim/content/params/rules.ts";
import { ruleIds, rules } from "../src/run/sim/content/rules.ts";
import { DEFAULT_TRAINER } from "../src/run/sim/content/trainers.ts";
import { menuIconGeometry } from "../src/ui/gpu/icons.ts";
import { GpuLobby } from "../src/ui/gpu/lobby.ts";
import { GpuMultiplayer } from "../src/ui/gpu/multiplayer.ts";
import { GpuResultContent } from "../src/ui/gpu/run-overlays-result.ts";
import { UiStage, setUiPixelRatio } from "../src/ui/gpu/stage.ts";
import { fitScale } from "../src/ui/gpu/viewport.ts";
import { MapLayers } from "../src/run/view/minimapLayers.ts";

// Real Yoga and committed glyph metrics, without raster decoding or GPU uploads: the rules' input
// and wiring. Their look, the badge colours and the real pages need the formal App.
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
  difficulty: 1,
  stage: "forest",
  trainer: DEFAULT_TRAINER,
};
const text = (node) => String(node.properties.value.text);
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

test("six rule and eight badge icons are drawn inside the shared 24 box", () => {
  for (const name of [
    ...ruleIds.map((id) => `rule-${id}`),
    ...badgeIds.map((id) => `badge-${id}`),
  ]) {
    const geometry = menuIconGeometry(name);
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    assert.ok(geometry.getAttribute("position").count > 0, `${name} has strokes`);
    assert.ok(min.x >= -12.5 && min.y >= -12.5 && max.x <= 12.5 && max.y <= 12.5, name);
    geometry.dispose();
  }
});

test("the lobby's 规则 opens only after the first clear; every input reaches every board", async () => {
  install();
  try {
    for (const { width, height, dpr, safe } of [
      { width: 1280, height: 800, dpr: 1, safe: { left: 0, right: 0, top: 0, bottom: 0 } },
      { width: 844, height: 390, dpr: 3, safe: { left: 47, right: 47, top: 0, bottom: 21 } },
    ]) {
      setUiPixelRatio(dpr);
      const where = `${width}x${height}`;
      // Before the first 普通 clear: no key, no stop.
      const closed = new GpuLobby(
        fonts,
        new Texture(),
        { progress: emptyProgress(), pick, rules: [] },
        lobbyCallbacks(),
      );
      closed.resize(width, height, fitScale(1, width, height, safe, closed.minLayout), safe);
      await settle(closed);
      const shut = closed.controls.find((c) => c.kind === "rules");
      assert.equal(shut.panel.isVisible.value, false, `no 规则 before a clear: ${where}`);
      assert.ok(!closed.tabStops().includes(closed.controls.indexOf(shut)), where);
      closed.dispose();

      const drafts = [];
      const progress = {
        ...emptyProgress(),
        clears: [1, 1, 0],
        badges: ["boulder"],
        unlocks: ["nuzlocke", "alpha-elites"],
      };
      const lobby = new GpuLobby(
        fonts,
        new Texture(),
        { progress, pick, rules: ["wild-weather"] },
        lobbyCallbacks({ rules: (next) => drafts.push(next) }),
      );
      try {
        lobby.resize(width, height, fitScale(1, width, height, safe, lobby.minLayout), safe);
        await settle(lobby);
        const index = lobby.controls.findIndex((c) => c.kind === "rules");
        const key = lobby.controls[index];
        assert.ok(key.panel.isVisible.value, `规则 shows after the first clear: ${where}`);
        const k = box(lobby.stage, key.panel);
        assert.ok(k.h >= 43.5, `规则 is a touch target: ${where} ${JSON.stringify(k)}`);
        assert.ok(k.x + k.w / 2 <= width - safe.right + 1 && k.y + k.h / 2 <= height, where);
        assert.ok(lobby.tabStops().includes(index), `Tab reaches 规则: ${where}`);
        // Keys: ↑ from the tray reaches 规则 (no partner or difficulty change on the way).
        lobby.setFocusVisible(true);
        lobby.focus(lobby.controls.indexOf(lobby.segments[1]));
        lobby.navigate("up");
        assert.equal(lobby.focused, index, `↑ from the tray: ${where}`);
        lobby.navigate("left");
        assert.equal(lobby.selected, "charmander", `sideways keeps the partner: ${where}`);
        // Pointer / touch: the press opens the window over the lobby.
        lobby.activate(lobby.hit(k.x, k.y));
        assert.ok(lobby.challenge.open, where);
        await settle(lobby, 0);
        const window = lobby.challenge;
        assert.equal(window.boards.length, ruleIds.length);
        for (const board of window.boards) {
          const b = box(lobby.stage, board.panel);
          assert.ok(b.w >= 43.5 && b.h >= 43.5, `board ${board.id} touch target: ${where}`);
          assert.ok(
            b.x - b.w / 2 >= safe.left - 1 && b.x + b.w / 2 <= width - safe.right + 1,
            `board ${board.id} inside: ${where} ${JSON.stringify(b)}`,
          );
          assert.ok(b.y - b.h / 2 >= 0 && b.y + b.h / 2 <= height - safe.bottom + 1, where);
          assert.equal(lobby.hit(b.x, b.y), window.boards.indexOf(board), `hit ${board.id}`);
          // Each name fits its board (no clipped text).
          const n = box(lobby.stage, board.name);
          assert.ok(n.x + n.w / 2 <= b.x + b.w / 2, `${board.id} name fits: ${where}`);
        }
        // The tray's numbers come from the tables: danger, multiplier, next badge and score.
        const danger = RULE_DANGER["wild-weather"];
        assert.equal(text(window.dangerValue), String(danger));
        assert.equal(text(window.multiplier), `×${(1 + DANGER_STARDUST * danger).toFixed(1)}`);
        assert.equal(text(window.badgeName), badges.cascade.name, "boulder owned: cascade next");
        assert.equal(text(window.badgeScore), `${3 + danger} / ${badges.cascade.score}`);
        // Pad / keys: grid moves, confirm toggles; the total updates at once.
        lobby.navigate("confirm");
        assert.deepEqual(drafts.at(-1), ["nuzlocke", "wild-weather"], `confirm toggles: ${where}`);
        assert.equal(text(window.dangerValue), String(danger + RULE_DANGER.nuzlocke));
        lobby.navigate("right");
        assert.equal(window.focused, 1, "→ moves along the row");
        lobby.navigate("down");
        assert.equal(window.focused, 4, "↓ moves down the column");
        // A tap on a board toggles it too.
        const b = box(lobby.stage, window.boards[2].panel);
        lobby.activate(lobby.hit(b.x, b.y));
        assert.deepEqual(drafts.at(-1), ["nuzlocke", "no-items", "wild-weather"]);
        // The effect is the tip of the focused board only.
        lobby.focus(0);
        await settle(lobby, 0);
        assert.equal(window.tooltip.want, window.boards[0].panel, `focus shows the tip: ${where}`);
        // Q / E keep the partner while the window is open; Esc closes back onto 规则.
        lobby.physicalKey({ key: "e", code: "KeyE", shift: false, repeat: false });
        assert.equal(lobby.selected, "charmander");
        lobby.navigate("cancel");
        await settle(lobby, 200);
        assert.equal(window.open, false, `Esc closes: ${where}`);
        assert.equal(lobby.focused, index, `focus back on 规则: ${where}`);
        assert.equal(
          lobby.rulesKey.danger,
          danger + RULE_DANGER.nuzlocke + RULE_DANGER["no-items"],
        );
        assert.deepEqual(progress.rules, [], "the lobby never writes progress");
      } finally {
        lobby.dispose();
      }
    }
  } finally {
    setImageLoader(null);
    setUiPixelRatio(1);
  }
});

test("a locked rule shows but does not toggle", async () => {
  install();
  setUiPixelRatio(1);
  const stage = new UiStage();
  stage.resize(1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 });
  stage.root.setProperties({ fontFamilies: fonts });
  const { ChallengeWindow } = await import("../src/ui/gpu/challenge-rules.ts");
  const changes = [];
  const window = new ChallengeWindow(
    stage,
    (next) => changes.push(next),
    () => {},
  );
  stage.root.add(window.root);
  try {
    window.resize(false, false, 1248, 768);
    window.show({
      selected: [],
      difficulty: 0,
      owned: [],
      available: (id) => id !== "nuzlocke",
    });
    window.activate(0);
    assert.deepEqual(changes, [], "locked: no change");
    window.activate(1);
    assert.deepEqual(changes, [["level-cap"]]);
  } finally {
    window.dispose();
    stage.dispose();
    setImageLoader(null);
  }
});

const roomState = (self, mission, revision, ready) => ({
  room: {
    code: "123456",
    players: [
      { starter: "charmander", trainer: DEFAULT_TRAINER, shiny: false },
      { starter: "squirtle", trainer: DEFAULT_TRAINER, shiny: false },
    ],
    mission,
    missionRevision: revision,
    started: false,
    ready,
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

test("the room: the host sets rules, a guest reads them and confirms a change", async () => {
  install();
  setUiPixelRatio(1);
  const sent = { rules: [], confirm: 0, start: 0 };
  const make = (progress) =>
    new GpuMultiplayer(
      fonts,
      {
        create() {},
        join() {},
        start: () => sent.start++,
        cancel() {},
        close() {},
        settings() {},
        copy() {},
        pick() {},
        rules: (next) => sent.rules.push(next),
        confirm: () => sent.confirm++,
      },
      progress,
      pick,
      ["mono-type"],
    );
  const mission = (rules) => ({ mode: "expedition", stage: "forest", difficulty: 1, rules });
  const host = make({ ...emptyProgress(), clears: [1, 0, 0], unlocks: ["nuzlocke"] });
  // A guest that has not cleared anything: it still reads and plays the host's rules.
  const guest = make(emptyProgress());
  try {
    for (const room of [host, guest])
      room.resize(1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 });
    host.update(roomState(0, mission(["mono-type"]), 0, [0, 1]));
    await settle(host);
    const key = host.controls.find((c) => c.panel === host.rulesKey.panel);
    assert.ok(host.active().includes(host.controls.indexOf(key)), "the host has 规则");
    key.action();
    assert.ok(host.challenge.open);
    host.challenge.activate(0);
    assert.deepEqual(sent.rules.at(-1), ["nuzlocke", "mono-type"], "the host's edit is sent");
    host.navigate("cancel");

    guest.update(roomState(1, mission(["mono-type"]), 0, [0, 1]));
    await settle(guest);
    const chips = guest.ruleChips.chips.filter((c) => c.panel.isVisible.value).map((c) => c.id);
    assert.deepEqual(chips, ["mono-type"], "the guest sees the room's rules");
    assert.ok(
      !guest.active().includes(guest.controls.findIndex((c) => c.panel === guest.rulesKey.panel)),
    );
    const chip = guest.controls.find((c) => c.group === "rules" && c.enabled());
    assert.equal(chip.tip(), `${rules["mono-type"].name}：${rules["mono-type"].effect}`);
    assert.equal(text(guest.launch.label), "等待房主");
    // The host changes the rules: Harbor clears the guest's readiness; the guest confirms again.
    guest.update(roomState(1, mission(["nuzlocke", "mono-type"]), 1, [0]));
    assert.equal(text(guest.launch.label), "确认规则");
    assert.equal(guest.launchSpinner.properties.value.display, "none", "no waiting spinner");
    assert.ok(
      guest.active().includes(guest.controls.findIndex((c) => c.panel === guest.launch.panel)),
    );
    guest.controls.find((c) => c.panel === guest.launch.panel).action();
    assert.equal(sent.confirm, 1);
    assert.equal(sent.start, 0, "confirming never starts");
    assert.equal(text(guest.launch.label), "等待房主");
    guest.update(roomState(1, mission(["nuzlocke", "mono-type"]), 1, [0, 1]));
    assert.equal(text(guest.launch.label), "等待房主");
    assert.deepEqual(sent.rules.length, 1, "a guest never sends rules");
  } finally {
    host.dispose();
    guest.dispose();
    setImageLoader(null);
  }
});

test("room rule chips: 44 host px squares that never overlap; a removed rule takes its tip", async () => {
  install();
  setUiPixelRatio(1);
  const guest = new GpuMultiplayer(
    fonts,
    {
      create() {},
      join() {},
      start() {},
      cancel() {},
      close() {},
      settings() {},
      copy() {},
      pick() {},
      rules() {},
      confirm() {},
    },
    emptyProgress(),
    pick,
    [],
  );
  const mission = (rules) => ({ mode: "expedition", stage: "forest", difficulty: 1, rules });
  try {
    for (const [width, height] of [
      [1280, 800],
      [844, 390],
    ])
      for (const scale of [0.8, 1]) {
        guest.resize(width, height, scale, { left: 0, right: 0, top: 0, bottom: 0 });
        guest.update(roomState(1, mission([...ruleIds]), 0, [0]));
        await settle(guest, 0);
        const boxes = guest.ruleChips.chips.map((chip) => box(guest.stage, chip.panel));
        const at = `${width}×${height}@${scale}`;
        for (const b of boxes)
          assert.ok(b.w >= 44 - 0.01 && b.h >= 44 - 0.01, `${at}: ${b.w}×${b.h}`);
        for (let i = 1; i < boxes.length; i++)
          assert.ok(
            boxes[i].x - boxes[i].w / 2 >= boxes[i - 1].x + boxes[i - 1].w / 2 - 0.01,
            `${at}: chips ${i - 1} and ${i} overlap`,
          );
      }
    // A tap shows a chip's tip; the host dropping that rule takes the tip away.
    const index = guest.controls.findIndex((c) => c.panel === guest.ruleChips.chips[0].panel);
    const b = box(guest.stage, guest.controls[index].panel);
    guest.pointerDown(b.x, b.y, true);
    guest.pointerUp(true);
    await settle(guest, 0);
    assert.equal(guest.tooltip.want, guest.controls[index].panel, "the tap shows the tip");
    guest.update(roomState(1, mission(ruleIds.slice(1)), 1, [0]));
    await settle(guest, 0);
    assert.equal(guest.tooltip.want, null, "no tip over a removed rule");
  } finally {
    guest.dispose();
    setImageLoader(null);
  }
});

test("Nuzlocke: a permanent knockout draws no rescue ring on the mini or full map", () => {
  install();
  const stage = new UiStage();
  stage.resize(844, 390, 1, { top: 0, bottom: 0, left: 0, right: 0 });
  stage.root.setProperties({ fontFamilies: fonts });
  const local = { id: 0, x: 0, z: 0, px: 0, pz: 0, faceX: 0, faceZ: 1, alive: true, revives: 0 };
  const mate = { ...local, id: 1, x: 4, px: 4, alive: false };
  const world = {
    modifier: null,
    rules: [],
    players: [local, mate],
    partners: [],
    enemies: [],
    pickups: [],
    stations: [],
    bossId: null,
    zone: { phase: "cleared", exits: [] },
  };
  const map = { xx: 1, xz: 0, zx: 0, zz: 1, ox: 62, oy: 62 };
  const ripples = (full) => {
    const layers = new MapLayers(stage.root, 1.6, [new Texture(), new Texture()], 10, 0, new Map());
    try {
      let count = 0;
      const add = layers.markers.add.bind(layers.markers);
      // Shape 4 is the spreading ring (minimapLayers `ring`).
      layers.markers.add = (...args) => ((count += args[4] === 4 ? 1 : 0), add(...args));
      layers.update(world, 1, 0, map, 124, 1, 52, 1, full);
      return count;
    } finally {
      layers.dispose();
    }
  };
  try {
    assert.deepEqual([ripples(false), ripples(true)], [1, 1], "a rescuable teammate is ringed");
    world.rules = ["nuzlocke"];
    assert.deepEqual([ripples(false), ripples(true)], [0, 0]);
  } finally {
    stage.dispose();
  }
});

test("the result shows new badges and the run's danger with its multiplier", async () => {
  install();
  setUiPixelRatio(1);
  const stage = new UiStage();
  stage.resize(1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 });
  stage.root.setProperties({ fontFamilies: fonts });
  const result = {
    danger: 7,
    outcome: "victory",
    starter: "charmander",
    difficulty: 2,
    time: 900,
    level: 40,
    kills: 900,
    dex: {},
    stardust: 1700,
    moves: [{ id: "ember", level: 3, damage: 100 }],
    items: [],
  };
  const content = new GpuResultContent(
    { result, note: null, badges: ["boulder", "cascade"], backpackSize: null },
    { keepItems: () => true, retry() {}, exit() {}, invalidate() {} },
    stage,
  );
  try {
    const texts = [];
    content.root.traverse((node) => {
      const value = node.properties?.peek?.().text;
      if (typeof value === "string") texts.push(value);
    });
    assert.ok(texts.includes(badges.boulder.name) && texts.includes(badges.cascade.name));
    assert.ok(texts.some((t) => t.endsWith(`危险度 7 ×${(1 + DANGER_STARDUST * 7).toFixed(1)}`)));
    content.update({
      result: { ...result, danger: 0 },
      note: null,
      badges: [],
      backpackSize: null,
    });
    const plain = [];
    content.root.traverse((node) => {
      const value = node.properties?.peek?.().text;
      if (typeof value === "string") plain.push(value);
    });
    assert.ok(!plain.some((t) => t.includes("危险度") || t.includes("徽章")), "no rules: no extra");
  } finally {
    content.dispose();
    stage.dispose();
    setImageLoader(null);
  }
});
