import { test } from "node:test";
import assert from "node:assert/strict";
import { seatView } from "../src/ui/gpu/multiplayer-view.ts";
import { readFileSync } from "node:fs";

test("room seats keep ownership and gate departure on shared link readiness", () => {
  const player = { starter: "bulbasaur" };
  const state = {
    room: null,
    self: 0,
    mode: "connecting",
    starting: false,
    canStart: false,
    peers: {},
    error: "",
  };
  assert.equal(seatView(state).start.enabled, false);
  state.room = { code: "123456", players: [player], started: false, ready: [] };
  let view = seatView(state);
  assert.equal(view.seats[0].self, true);
  assert.equal(view.seats[1].chip, "等待加入");
  assert.equal(view.start.enabled, false);
  state.room.players.push(player);
  view = seatView(state);
  assert.equal(view.seats[1].chip, "已加入");
  assert.equal(view.start.pending, true);
  assert.equal(view.start.enabled, false);
  for (const mode of ["direct", "relay"]) {
    state.mode = mode;
    state.room.ready = [0, 1];
    state.canStart = true;
    view = seatView(state);
    assert.equal(view.link, "ready");
    assert.equal(view.start.enabled, true);
    assert.equal(view.seats[1].chip, "就绪");
  }
  state.starting = true;
  state.canStart = false;
  assert.equal(seatView(state).start.enabled, false);
  assert.equal(seatView(state).start.pending, true);
  state.starting = false;
  state.self = 1;
  view = seatView(state);
  assert.equal(view.seats[0].label, "P1");
  assert.equal(view.seats[0].self, false);
  assert.equal(view.seats[1].self, true);
  assert.equal(view.start.enabled, false);
  for (const [code, label] of Object.entries({
    "no-room": "房间不存在",
    full: "房间已满",
    started: "已出发",
    version: "版本不同",
  })) {
    assert.equal(seatView({ ...state, error: "server error", errorCode: code }).error, label);
  }
  for (const error of ["队友已离开", "房主已离开", "连接中断", "unknown"]) {
    view = seatView({ ...state, self: 0, error });
    assert.equal(view.error, error);
    assert.equal(view.start.enabled, false);
  }
});

test("room readiness follows each occupied seat and the session departure permission", () => {
  const state = {
    room: {
      code: "123456",
      players: ["bulbasaur", "charmander", "squirtle"].map((starter) => ({ starter })),
      ready: [0, 1],
      started: false,
    },
    self: 0,
    mode: "relay",
    canStart: false,
    peers: { 1: "relay", 2: "relay" },
    starting: false,
    error: "",
  };
  const pending = seatView(state);
  assert.deepEqual(
    pending.seats.map((seat) => seat.chip),
    ["房主", "就绪", "已加入", "等待加入"],
  );
  assert.equal(pending.link, "connecting");
  assert.equal(pending.start.enabled, false, "local transport alone does not authorize departure");
  state.room.ready.push(2);
  assert.equal(seatView(state).start.enabled, false, "session permission remains authoritative");
  state.canStart = true;
  assert.equal(seatView(state).start.enabled, true);
  assert.equal(seatView({ ...state, error: "连接中断" }).start.enabled, false);
});

test("two to four joined players can depart without filling the empty seats", () => {
  const players = ["bulbasaur", "charmander", "squirtle", "pikachu"].map((starter) => ({
    starter,
  }));
  for (const count of [2, 3, 4]) {
    const state = {
      room: { code: "123456", players: players.slice(0, count), started: false },
      self: 0,
      mode: "relay",
      starting: false,
      error: "",
      canStart: true,
      peers: {},
    };
    state.room.ready = Array.from({ length: count }, (_, index) => index);
    let view = seatView(state);
    assert.equal(view.start.enabled, true, `${count} players can depart`);
    assert.deepEqual(
      view.seats.map((seat) => seat.starter),
      [...players.slice(0, count).map((player) => player.starter), ...Array(4 - count).fill(null)],
    );
    for (const seat of view.seats.slice(count)) {
      assert.equal(seat.chip, "等待加入");
      assert.equal(seat.pending, false, "empty seats do not pretend to be connecting");
    }
    state.mode = "connecting";
    state.canStart = false;
    state.room.ready = [0];
    view = seatView(state);
    assert.equal(view.start.enabled, false);
    assert.equal(view.link, "connecting");
    for (const seat of view.seats.slice(1, count)) {
      assert.equal(seat.chip, "已加入");
      assert.equal(seat.pending, true);
    }
    for (let self = 1; self < count; self++) {
      state.self = self;
      state.mode = "relay";
      state.room.ready = Array.from({ length: count }, (_, index) => index);
      view = seatView(state);
      assert.deepEqual(
        view.seats.filter((seat) => seat.self).map((seat) => seat.label),
        [`P${self + 1}`],
      );
      assert.equal(view.start.enabled, false, "only the host can depart");
      assert.equal(view.start.pending, true);
    }
  }
});

test("room keypad confirms its focused digit on gamepad but physical Enter submits the code", async () => {
  const { installResources } = await import("../src/platform/resources.ts");
  const { webResources } = await import("../src/platform/web/resources.ts");
  installResources(webResources);
  const { bindImages } = await import("../src/prepare/images.ts");
  bindImages({
    generation: 0,
    available: false,
    subscribe: () => () => {},
    enqueue() {},
    upload() {},
    resident: () => () => {},
  });
  const { GpuMultiplayer } = await import("../src/ui/gpu/multiplayer.ts");
  const { ActionInput, navigationAction } = await import("../src/platform/input.ts");
  const { setGlyphInputMode } = await import("../src/ui/gpu/input-glyph.ts");
  const never = () => new Promise(() => {});
  const fonts = { "Poketone UI": { 500: never, 700: never, 800: never } };
  const joined = [];
  const room = new GpuMultiplayer(
    fonts,
    { create() {}, join: (code) => joined.push(code), start() {}, cancel() {}, close() {} },
    { starter: "charmander", difficulty: 0, stage: "forest" },
  );
  const pad = {
    token: "pad:1",
    name: "test",
    family: "generic",
    mapped: true,
    axes: [0, 0, 0, 0],
    buttons: new Set(),
  };
  const input = new ActionInput({ sample: () => [pad], dispose() {} });
  const keyboard = (key, code) => {
    const event = { key, code, shift: false, repeat: false };
    setGlyphInputMode({ kind: "keyboardMouse", pointer: false });
    if (!room.physicalKey(event)) {
      const action = navigationAction(code, false);
      if (action) room.navigate(action);
    }
  };
  try {
    // Create is the initial focus; Tab then Enter opens Join.
    keyboard("Tab", "Tab");
    keyboard("Enter", "Enter");
    keyboard("1", "Digit1");
    keyboard("Enter", "Enter");
    assert.deepEqual(joined, [], "an incomplete code cannot submit or append the focused digit");
    pad.buttons.add("south");
    input.sample(0, "navigation"); // Claim consumes the first press.
    pad.buttons.clear();
    input.sample(1, "navigation");
    setGlyphInputMode({ kind: "gamepad", family: "generic", token: pad.token });
    pad.buttons.add("south");
    for (const action of input.sample(2, "navigation").actions) room.navigate(action);
    for (const digit of "2345") keyboard(digit, `Digit${digit}`);
    assert.deepEqual(joined, [], "six digits focus Join without submitting");
    keyboard("Enter", "Enter");
    assert.deepEqual(joined, ["112345"], "South appended the focused 1; Enter submitted");
    keyboard("Backspace", "Backspace");
    keyboard("9", "Digit9");
    keyboard("Enter", "NumpadEnter");
    assert.deepEqual(joined, ["112345", "112349"]);
  } finally {
    input.dispose();
    room.dispose();
    setGlyphInputMode({ kind: "keyboardMouse", pointer: false });
  }
});

test("room choices, keypad and four seats remain reachable inside the scaled safe area", async () => {
  const { Container, Text } = await import("@pmndrs/uikit");
  const { Texture } = await import("three");
  const { setImageLoader } = await import("@pmndrs/uikit/dist/components/image.js");
  setImageLoader(() => new Promise(() => {}));
  const { installResources } = await import("../src/platform/resources.ts");
  const { webResources } = await import("../src/platform/web/resources.ts");
  installResources(webResources);
  const { bindImages } = await import("../src/prepare/images.ts");
  bindImages({
    generation: 0,
    available: false,
    subscribe: () => () => {},
    enqueue() {},
    upload() {},
    resident: () => () => {},
  });
  const { GpuMultiplayer } = await import("../src/ui/gpu/multiplayer.ts");
  const { fitScale } = await import("../src/ui/gpu/viewport.ts");
  // Real committed metrics; no image upload, font build, browser or server.
  const core = new URL("../public/fonts/gpu/core/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", core), "utf8"));
  const textures = [];
  const weights = {};
  for (const weight of [500, 800]) {
    const font = JSON.parse(readFileSync(new URL(manifest[`ui-${weight}`].json, core), "utf8"));
    const pageTextures = font.pages.map(() => new Texture());
    textures.push(...pageTextures);
    weights[weight] = {
      pages: font.pages,
      pageSizes: font.pageSizes,
      pageTextures,
      chars: font.glyphs.map(([id, page, x, y, width, height, xoffset, yoffset, xadvance]) => ({
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
      info: { size: font.size },
      common: { lineHeight: font.lineHeight },
      distanceField: { distanceRange: font.distanceRange },
      kernings: [],
    };
  }
  const fonts = { "Poketone UI": weights };
  const settle = async (room) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (let frame = 0; frame < 12; frame++) {
      room.stage.update(16);
      room.afterLayout(16);
    }
  };
  const labelPanel = (room, label) => {
    let panel;
    room.stage.root.traverse((node) => {
      if (node instanceof Text && node.properties.value.text === label)
        panel = node.parentContainer.value;
    });
    assert.ok(panel, `label ${label} is present`);
    return panel;
  };
  const box = (room, panel) => {
    const { width, height, scale } = room.stage.viewport;
    const matrix = panel.globalMatrix.value.elements;
    const [w, h] = panel.size.value;
    return {
      x: (matrix[12] + width / 2) * scale,
      y: (height / 2 - matrix[13]) * scale,
      w: w * scale,
      h: h * scale,
    };
  };
  const inside = (room, panel, width, height, safe) => {
    const b = box(room, panel);
    assert.ok(
      b.x - b.w / 2 >= safe.left - 1 && b.x + b.w / 2 <= width - safe.right + 1,
      `horizontal fit ${JSON.stringify(b)}`,
    );
    assert.ok(
      b.y - b.h / 2 >= safe.top - 1 && b.y + b.h / 2 <= height - safe.bottom + 1,
      `vertical fit ${JSON.stringify(b)}`,
    );
    return b;
  };
  try {
    for (const [width, height] of [
      [1280, 800],
      [844, 390],
      [1361, 471],
    ]) {
      for (const userScale of [1, 1.5]) {
        const safe = {
          top: 0,
          right: width === 844 ? 44 : 0,
          bottom: width === 844 ? 21 : 0,
          left: width === 844 ? 44 : 0,
        };
        let joined = "";
        let cancelled = 0;
        const room = new GpuMultiplayer(
          fonts,
          {
            create() {},
            join: (code) => {
              joined = code;
            },
            start() {},
            cancel: () => {
              cancelled++;
            },
            close() {},
            rejoin: { code: "123456", action() {} },
          },
          { starter: "charmander", stage: "forest", difficulty: 0 },
        );
        try {
          const scale = fitScale(userScale, width, height, safe, room.minLayout);
          room.resize(width, height, scale, safe);
          await settle(room);
          const create = inside(room, labelPanel(room, "创建房间"), width, height, safe);
          const joinPanel = labelPanel(room, "加入房间");
          const join = inside(room, joinPanel, width, height, safe);
          assert.ok(
            create.x + create.w / 2 < join.x - join.w / 2,
            "entry choices are side by side",
          );
          assert.ok(Math.abs(create.w - join.w) <= 1, "entry choices have equal weight");
          for (const b of [create, join]) assert.ok(b.w >= 44 && b.h >= 44, "entry touch targets");
          if (width === 1280 && userScale === 1) {
            room.setFocusVisible(true);
            room.navigate("right");
            room.navigate("confirm");
          } else room.activate(room.hit(join.x, join.y));
          await settle(room);
          for (const key of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "加入"]) {
            const b = inside(room, labelPanel(room, key), width, height, safe);
            assert.ok(b.w >= 43.99 && b.h >= 43.99, `keypad touch target ${JSON.stringify(b)}`);
            if (key !== "加入") assert.ok(room.hit(b.x, b.y) >= 0, `key ${key} can be tapped`);
          }
          for (const key of "123456") room.physicalKey({ key, code: `Digit${key}` });
          room.physicalKey({ key: "Enter", code: "Enter" });
          assert.equal(joined, "123456");
          room.update({
            room: null,
            self: 0,
            mode: "connecting",
            starting: false,
            canStart: false,
            peers: {},
            error: "房间不存在",
            errorCode: "no-room",
          });
          await settle(room);
          inside(room, labelPanel(room, "房间不存在"), width, height, safe);
          room.physicalKey({ key: "Backspace", code: "Backspace" });
          room.physicalKey({ key: "9", code: "Digit9" });
          room.physicalKey({ key: "Enter", code: "Enter" });
          assert.equal(joined, "123459", "a failed join can be edited and retried");
          assert.equal(cancelled, 1);
          room.update({
            room: {
              code: "123459",
              players: ["bulbasaur", "charmander", "squirtle", "pikachu"].map((starter) => ({
                starter,
              })),
              started: false,
              ready: [0, 1, 2, 3],
            },
            self: 0,
            mode: "relay",
            starting: false,
            canStart: true,
            peers: { 1: "relay", 2: "relay", 3: "relay" },
            error: "",
          });
          await settle(room);
          const seats = ["妙蛙种子", "小火龙", "杰尼龟", "皮卡丘"].map((name) =>
            inside(room, labelPanel(room, name), width, height, safe),
          );
          for (let i = 1; i < seats.length; i++)
            assert.ok(
              seats[i - 1].x + seats[i - 1].w / 2 < seats[i].x - seats[i].w / 2,
              "four seats do not overlap",
            );
          const launch = inside(room, labelPanel(room, "出发"), width, height, safe);
          assert.ok(room.hit(launch.x, launch.y) >= 0, "host departure remains reachable");
          room.stage.root.traverse((node) => {
            if (node instanceof Container && node.isVisible.value && node.size.value)
              inside(room, node, width, height, { top: 0, right: 0, bottom: 0, left: 0 });
          });
        } finally {
          room.dispose();
        }
      }
    }
  } finally {
    setImageLoader(null);
    for (const texture of textures) texture.dispose();
  }
});
