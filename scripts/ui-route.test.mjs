import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Container, Text } from "@pmndrs/uikit";
import { Texture } from "three";
import { installResources } from "../src/platform/resources.ts";
import { webResources } from "../src/platform/web/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";
import { setGlyphInputMode } from "../src/ui/gpu/input-glyph.ts";
import { UiStage, setUiPixelRatio } from "../src/ui/gpu/stage.ts";
import { routeLights, routeSight } from "../src/run/view/routeLook.ts";

installResources(webResources);
installRuntime({ createAudioDecoder: () => ({}), activateAudio() {} });
globalThis.document ??= {
  createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }),
};
const { bindImages } = await import("../src/prepare/images.ts");
bindImages({
  generation: 0,
  available: false,
  subscribe: () => () => {},
  enqueue() {},
  upload() {},
  resident: () => () => {},
});
globalThis.fetch = () => new Promise(() => {});
const { GpuRunOverlays } = await import("../src/ui/gpu/run-overlays.ts");
const { RunHudInteract } = await import("../src/ui/gpu/run-hud-interact.ts");
const { runWindowSamples } = await import("../src/ui/gpu/run-overlays-samples.ts");
const { MapLayers } = await import("../src/run/view/minimapLayers.ts");

// Committed metrics exercise real Yoga/text layout without a browser or GPU upload.
const core = new URL("../public/fonts/gpu/core/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", core), "utf8"));
const metrics = JSON.parse(readFileSync(new URL(manifest["ui-800"].json, core), "utf8"));
const font = {
  pages: [],
  pageTextures: metrics.pages.map(() => new Texture()),
  pageSizes: metrics.pageSizes,
  chars: metrics.glyphs.map(([id, page, x, y, width, height, xoffset, yoffset, xadvance]) => ({
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
  info: { size: metrics.size },
  common: { lineHeight: metrics.lineHeight },
  distanceField: { distanceRange: metrics.distanceRange },
  kernings: [],
};
const fonts = {
  "Poketone UI": { 500: font, 700: font, 800: font },
  "Poketone Display": { 400: font },
};
const callbacks = {
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
  keepItems: () => true,
  slotCenter: () => null,
};
const safe = { left: 0, right: 0, top: 0, bottom: 0 };
async function settle(stage, view) {
  await new Promise((resolve) => setTimeout(resolve, 60));
  for (let i = 0; i < 40; i++) {
    stage.update(16);
    view?.afterLayout(16);
  }
}
const texts = (root) => {
  const found = [];
  root.traverse((node) => {
    if (node instanceof Text && node.displayed.value) found.push(node.properties.value.text);
  });
  return found;
};

const at = (x, z, extra = {}) => ({
  starter: "bulbasaur",
  stage: 0,
  alive: true,
  departed: false,
  x,
  z,
  px: x,
  pz: z,
  ...extra,
});

test("map marks follow the modifier: all without one, none in fog, only lit ground in a dark cave", () => {
  const players = [at(0, 0), at(30, 0, { alive: false }), at(-30, 0, { departed: true })];
  const plain = routeSight({ modifier: null, players });
  assert.equal(plain(40, 40), true);
  assert.equal(routeSight({ modifier: "boss-sighting", players })(40, 40), true);
  const fog = routeSight({ modifier: "fog", players });
  assert.equal(fog(0, 0), false, "fog keeps no ordinary mark, even underfoot");
  const dark = { modifier: "dark-cave", players };
  const sight = routeSight(dark);
  assert.equal(sight(1, 1), true, "the standing player's own ground is lit");
  assert.equal(sight(30, 0), false, "a downed player carries no light");
  assert.equal(sight(-30, 0), false, "a departed player carries no light");
  const [light] = routeLights(dark);
  assert.equal(routeLights(dark).length, 1);
  assert.equal(sight(light.r * 0.99, 0), true);
  assert.equal(sight(light.r * 1.01, 0), false);
});

test("a fire partner's light reaches further, at its drawn position", () => {
  const dark = {
    modifier: "dark-cave",
    players: [at(0, 0), at(0, 0, { starter: "charmander", px: -10, x: 10 })],
  };
  const [grass, fire] = routeLights(dark, 0.5);
  assert.ok(fire.r > grass.r);
  assert.equal(fire.x, 0, "the light sits where the player is drawn this frame");
  assert.deepEqual(routeLights({ modifier: "fog", players: dark.players }), []);
});

test("the leave prompt names the target and its reward once; the last exit only leaves", async () => {
  setUiPixelRatio(3);
  setGlyphInputMode({ kind: "touch" });
  const stage = new UiStage();
  stage.resize(844, 390, 1, { left: 47, right: 47, top: 0, bottom: 21 });
  stage.root.setProperties({ fontFamilies: { "Poketone UI": { 500: font, 800: font } } });
  const prompt = new RunHudInteract(stage);
  stage.root.add(prompt.row);
  prompt.setCoarsePointer(true);
  try {
    prompt.set("leave", false, 0, null, { x: 0, z: 0, to: "coast", marker: "pokecenter" });
    await settle(stage);
    const shown = texts(prompt.panel);
    assert.ok(shown.includes("前往风暴海岸"));
    assert.equal(shown.filter((text) => text === "宝可梦中心").length, 1);
    const [width] = prompt.panel.size.value;
    assert.ok(width < 844 - 2 * 160, `the widest leave prompt fits between the thumbs (${width})`);
    prompt.set("leave", false, 0, null, { x: 0, z: 0, to: null, marker: null });
    await settle(stage);
    const end = texts(prompt.panel);
    assert.ok(end.includes("离开"));
    assert.ok(!end.some((text) => text.startsWith("前往")));
    assert.ok(!end.includes("宝可梦中心"), "the final exit carries no reward chip");
  } finally {
    prompt.dispose();
    stage.dispose?.();
  }
});

test("each exit names its own target on both maps, even two exits to one map", async () => {
  setUiPixelRatio(1);
  const stage = new UiStage();
  stage.resize(844, 390, 1, safe);
  stage.root.setProperties({ fontFamilies: { "Poketone UI": { 700: font, 800: font } } });
  const parent = new Container({ width: 100, height: 100 });
  stage.root.add(parent);
  const mini = new MapLayers(parent, 1.6, [], 10, 0, new Map());
  const wide = new MapLayers(parent, 2.4, [], 21, 0, new Map());
  const map = { xx: 1, xz: 0, zx: 0, zz: 1, ox: 50, oy: 50 };
  const exits = [
    { x: -4, z: 20, to: "tower", marker: "chests" },
    { x: 4, z: 20, to: "tower", marker: "research" },
  ];
  const world = {
    modifier: null,
    players: [{ ...at(0, 0), id: 0, faceX: 0, faceZ: 1 }],
    partners: [],
    enemies: [],
    pickups: [],
    stations: [],
    bossId: 1,
    zone: { phase: "cleared", exits },
  };
  const labels = () => {
    const found = new Map();
    parent.traverse((node) => {
      if (!(node instanceof Text) || !node.displayed.value) return;
      found.set(node.parent, node.properties.value.text);
    });
    return [...found];
  };
  try {
    for (const [layers, whole] of [
      [mini, false],
      [wide, true],
    ]) {
      layers.update(world, 1, 0, map, 100, 1, 48, 1, whole);
    }
    await settle(stage);
    const shown = labels();
    assert.equal(shown.filter(([, text]) => text === "紫苑塔").length, 4, "two labels per map");
    const tops = () =>
      labels()
        .slice(0, 2)
        .map(([panel]) => panel.properties.value.transformTranslateY);
    let [a, b] = tops();
    assert.ok(Math.abs(a - b) >= 16, `side-by-side names stack apart (${a}, ${b})`);
    // Rings at y 70 (badge radius 8): names over them step further up, never onto the rings.
    assert.ok(Math.max(a, b) + 16 <= 62, `names stay above their rings (${a}, ${b})`);
    for (const exit of exits) exit.z = -20;
    for (const [layers, whole] of [
      [mini, false],
      [wide, true],
    ])
      layers.update(world, 1, 0, map, 100, 1, 48, 1, whole);
    await settle(stage);
    [a, b] = tops();
    assert.ok(Math.min(a, b) >= 38, `names under rings at y 30 step further down (${a}, ${b})`);
    assert.ok(Math.abs(a - b) >= 16);

    // The next zone reuses the pool: one end exit, read with its own name and nothing stale.
    world.zone = { phase: "cleared", exits: [{ x: 0, z: 20, to: null, marker: null }] };
    for (const [layers, whole] of [
      [mini, false],
      [wide, true],
    ])
      layers.update(world, 1, 0, map, 100, 1, 48, 1, whole);
    await settle(stage);
    assert.deepEqual(
      labels().map(([, text]) => text),
      ["离开", "离开"],
    );
  } finally {
    mini.dispose();
    wide.dispose();
    stage.dispose?.();
  }
});

test("exit names stay whole and apart on a 124px minimap and the full map, at the edges too", async () => {
  setUiPixelRatio(1);
  const { ARENA_HALF } = await import("../src/run/sim/state/world.ts");
  const stage = new UiStage();
  stage.resize(844, 390, 1, safe);
  stage.root.setProperties({ fontFamilies: { "Poketone UI": { 700: font, 800: font } } });
  const mini = new Container({ width: 124, height: 124 });
  const full = new Container({ width: 400, height: 400 });
  stage.root.add(mini, full);
  const maps = [
    // Minimap at its smallest fit: 22 world units per half, rim at 0.84 of it.
    { parent: mini, size: 124, unit: 1, k: 62 / 22, radius: 62 * 0.84, whole: false },
    {
      parent: full,
      size: 400,
      unit: 1.5,
      k: 400 / (2 * (ARENA_HALF + 8)),
      radius: Infinity,
      whole: true,
    },
  ].map((m) => ({
    ...m,
    layers: new MapLayers(m.parent, 1.6, [new Texture(), new Texture()], 10, 0, new Map()),
  }));
  const world = {
    modifier: null,
    players: [{ ...at(0, 0), id: 0, faceX: 0, faceZ: 1, moves: [], items: [] }],
    partners: [],
    enemies: [],
    pickups: [],
    stations: [],
    bossId: null,
    zone: { phase: "cleared", exits: [] },
  };
  const drawn = (parent) => {
    const panels = new Set();
    parent.traverse((node) => {
      if (node instanceof Text && node.displayed.value) panels.add(node.parent);
    });
    return [...panels].map((panel) => {
      const { transformTranslateX: left, transformTranslateY: top } = panel.properties.value;
      const [width, height] = panel.size.value;
      const lines = panel.children.map((text) => text.size.value[1]);
      return { left, top, right: left + width, bottom: top + height, lines, height };
    });
  };
  // Three exits to the same tower, side by side, stacked, and pinned at every edge and corner.
  const spots = [
    [
      [-7.25, 0],
      [0, 0],
      [7.25, 0],
    ],
    [
      [-1, -6],
      [0, -6],
      [1, -6],
    ],
    [
      [-1, 6],
      [0, 6],
      [1, 6],
    ],
    [
      [-60, 0],
      [-60, 2],
      [-60, -2],
    ],
    [
      [60, 0],
      [60, 2],
      [60, -2],
    ],
    [
      [0, -60],
      [2, -60],
      [-2, -60],
    ],
    [
      [0, 60],
      [2, 60],
      [-2, 60],
    ],
    [
      [60, 60],
      [55, 60],
      [60, 55],
    ],
    [
      [-60, -60],
      [-55, -60],
      [-60, -55],
    ],
    [
      [ARENA_HALF, ARENA_HALF],
      [ARENA_HALF - 2, ARENA_HALF],
      [ARENA_HALF, ARENA_HALF - 2],
    ],
    [
      [-ARENA_HALF, ARENA_HALF],
      [-ARENA_HALF + 2, ARENA_HALF],
      [-ARENA_HALF, ARENA_HALF - 2],
    ],
  ];
  // One ring under another with Hypno's name below them: no room left downwards, so the stack
  // turns upwards instead of landing on a name.
  const hypno = { id: 90, kind: "hypno", x: 0, z: 18.4, radius: 1, used: [] };
  const cases = [
    ...spots.map((points) => ({ points, stations: [] })),
    {
      points: [
        [0, 0],
        [0, -0.1],
        [0, -0.2],
      ],
      stations: [hypno],
    },
  ];
  try {
    for (const { points, stations } of cases)
      for (const names of [
        ["tower", "tower", "tower"],
        ["glacier", "volcano", null],
      ]) {
        world.zone.exits = points.map(([x, z], i) => ({ x, z, to: names[i], marker: "chests" }));
        world.stations = stations;
        for (const m of maps)
          m.layers.update(
            world,
            1,
            0,
            { xx: m.k, xz: 0, zx: 0, zz: m.k, ox: m.size / 2, oy: m.size / 2 },
            m.size,
            m.unit,
            m.radius,
            1,
            m.whole,
          );
        await settle(stage);
        for (const m of maps) {
          const boxes = drawn(m.parent);
          const where = `${m.size}px ${JSON.stringify(points)} ${JSON.stringify(names)}`;
          assert.equal(boxes.length, 3 + stations.length, where);
          for (const [i, a] of boxes.entries()) {
            assert.ok(
              a.left >= 0 && a.top >= 0 && a.right <= m.size + 0.5 && a.bottom <= m.size + 0.5,
              `whole inside the map: ${where} ${JSON.stringify(a)}`,
            );
            assert.ok(Math.max(...a.lines) <= a.height, `one line: ${where}`);
            for (const b of boxes.slice(i + 1))
              assert.ok(
                a.right <= b.left + 0.5 ||
                  b.right <= a.left + 0.5 ||
                  a.bottom <= b.top + 0.5 ||
                  b.bottom <= a.top + 0.5,
                `names apart as drawn: ${where} ${JSON.stringify([a, b])}`,
              );
          }
        }
      }
  } finally {
    for (const m of maps) m.layers.dispose();
    stage.dispose?.();
  }
});

test("an exit's crown is measured unseen, then shown whole at the screen's edge, and never blinks", async () => {
  setUiPixelRatio(1);
  const { GpuExitLabels } = await import("../src/ui/gpu/run-exit-labels.ts");
  const { PerspectiveCamera } = await import("three");
  const camera = new PerspectiveCamera(60, 844 / 390, 0.1, 300);
  camera.position.set(0, 3.4, 10);
  camera.updateMatrixWorld(true);
  // World x whose crown is centred on screen x `px` (the crown sits level with the camera).
  const worldX = (px) => ((px / 422 - 1) * 10) / camera.projectionMatrix.elements[0];
  const exit = { x: worldX(31), z: 0, to: null, marker: null };
  const world = {
    map: { terrain: { samples: 2, heights: [0, 0, 0, 0], origin: 0, resolution: 1 } },
    players: [{ ...at(-30, 0), id: 0 }],
    zone: { phase: "cleared", exits: [exit] },
  };
  for (const insets of [safe, { left: 47, right: 47, top: 0, bottom: 21 }]) {
    const stage = new UiStage();
    stage.resize(844, 390, 1, insets);
    stage.root.setProperties({ fontFamilies: { "Poketone UI": { 800: font } } });
    const obstacles = [];
    const labels = new GpuExitLabels(stage, () => obstacles);
    const crown = labels.crowns[0].root;
    let visible = true;
    const frame = () => {
      stage.update(16);
      labels.update(world, 0, camera, 0.016, visible);
    };
    const shown = async () => {
      await settle(stage, { afterLayout: () => labels.update(world, 0, camera, 0.016, visible) });
      const left = crown.properties.value.positionLeft;
      return {
        on: crown.displayed.value && crown.properties.value.opacity === 1,
        left,
        right: left + crown.size.value[0],
      };
    };
    const where = `insets ${insets.left}`;
    try {
      labels.update(world, 0, camera, 0.016, true);
      assert.equal(crown.properties.value.opacity, 0, `measured unseen first: ${where}`);
      for (const px of [31, 120, 31]) {
        exit.x = worldX(px);
        const { on, left, right } = await shown();
        assert.ok(on, `shown at x=${px}: ${where}`);
        assert.ok(left >= insets.left && right <= 844 - insets.right, `whole: ${where} ${left}`);
      }
      // Renamed to a wider name with its marker: measured again, still whole at the edge.
      Object.assign(exit, { to: "tower", marker: "chests" });
      const renamed = await shown();
      assert.ok(renamed.on && renamed.left >= insets.left, `renamed: ${where}`);
      // Hidden, it keeps its size, so coming back it fades straight in at the right spot.
      const size = [...crown.size.value];
      visible = false;
      for (let i = 0; i < 5; i++) frame();
      assert.equal(crown.displayed.value, false);
      assert.deepEqual(labels.crowns[0].size, size);
      visible = true;
      frame();
      stage.update(16);
      assert.ok(crown.displayed.value && crown.properties.value.opacity > 0, `back: ${where}`);
      assert.equal(crown.properties.value.positionLeft, renamed.left);
      // Under a HUD piece it stays out, frame after frame.
      const hud = new Container({
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 0,
        width: 300,
        height: 390,
      });
      stage.root.add(hud);
      obstacles.push(hud);
      await shown();
      const seen = [];
      for (let i = 0; i < 40; i++) {
        frame();
        seen.push(crown.displayed.value);
      }
      assert.ok(!seen.includes(true), `covered crown never blinks in: ${where}`);
    } finally {
      labels.dispose();
      stage.dispose?.();
    }
  }
});

test("an unlocked skip is offered on an ordinary card: X or its button spends one, none left skips nothing", async () => {
  setGlyphInputMode({ kind: "keyboardMouse", pointer: false });
  setUiPixelRatio(1);
  const card = runWindowSamples("charmander").find(
    (state) => state.kind === "choice" && !state.pending.offer && state.pending.source === "level",
  );
  assert.ok(card);
  const sent = [];
  const overlays = new GpuRunOverlays(fonts, { ...callbacks, send: (c) => sent.push(c) });
  const key = (code) => ({ code, key: code, repeat: false, shift: false });
  const button = (kind) => {
    const panel = overlays.content.actions.find((action) => action.kind === kind)?.panel;
    return overlays.controls.findIndex((control) => control.panel === panel);
  };
  const skip = { t: "skip", card: card.pending.id };
  try {
    overlays.resize(1280, 800, 1, safe);
    overlays.update({ ...card, skips: 2, dismissible: false });
    await settle(overlays.stage, overlays);
    assert.ok(texts(overlays.stage.root).includes("跳过 2"));
    overlays.physicalKey(key("KeyX"));
    assert.deepEqual(sent, [skip], "X spends a skip on this card");
    sent.length = 0;
    overlays.activate(button("skip"));
    assert.deepEqual(sent, [skip], "the button spends one the same way");

    sent.length = 0;
    overlays.update({ ...card, skips: 0, dismissible: false });
    await settle(overlays.stage, overlays);
    assert.ok(button("skip") >= 0, "a spent skip stays in place");
    overlays.physicalKey(key("KeyX"));
    overlays.activate(button("skip"));
    assert.deepEqual(sent, [], "with none left nothing is sent");

    overlays.update({ ...card, skips: null, dismissible: false });
    await settle(overlays.stage, overlays);
    assert.equal(button("skip"), -1, "no skip before the lab unlocks it");
    overlays.physicalKey(key("KeyX"));
    assert.deepEqual(sent, []);
  } finally {
    overlays.update(null);
  }
});

test("a Gengar deal states its price and closes for free; it never rerolls or skips", async () => {
  setGlyphInputMode({ kind: "keyboardMouse", pointer: false });
  setUiPixelRatio(1);
  const samples = runWindowSamples("charmander");
  const deal = samples.find(
    (state) => state.kind === "choice" && state.pending.offer?.kind === "deal",
  );
  const trophy = samples.find(
    (state) => state.kind === "choice" && state.pending.offer?.kind === "trophy",
  );
  const ordinary = samples.find(
    (state) => state.kind === "choice" && !state.pending.offer && state.pending.source === "level",
  );
  assert.ok(deal && trophy && ordinary);
  const sent = [];
  const overlays = new GpuRunOverlays(fonts, { ...callbacks, send: (c) => sent.push(c) });
  const key = (code) => ({ code, key: code, repeat: false, shift: false });
  try {
    overlays.resize(1280, 800, 1, safe);
    // Solo with automatic cards: an ordinary card cannot be put off, a deal still can be refused.
    overlays.update({ ...deal, dismissible: false });
    await settle(overlays.stage, overlays);
    const shown = texts(overlays.stage.root);
    assert.ok(
      shown.some((text) => /^最大生命 -\d+%$/.test(text)),
      "the price is on the banner",
    );
    assert.ok(shown.includes("放弃"));
    assert.deepEqual(
      overlays.content.actions.map((action) => action.kind),
      ["decline"],
    );
    overlays.physicalKey(key("KeyR"));
    overlays.physicalKey(key("KeyX"));
    overlays.choiceAction("interact");
    assert.deepEqual(sent, [], "no reroll or skip is spent on a deal");
    // Esc, the pad's back and 放弃 all leave this very deal; the run ignores a stale card id.
    const leave = { t: "leave", dialog: deal.pending.id };
    overlays.navigate("cancel");
    assert.deepEqual(sent, [leave]);
    sent.length = 0;
    const decline = overlays.controls.findIndex(
      (control) => control.panel === overlays.content.actions[0].panel,
    );
    overlays.activate(decline);
    assert.deepEqual(sent, [leave], "放弃 closes it without a skip");
    sent.length = 0;
    overlays.update({ ...deal, dismissible: true });
    await settle(overlays.stage, overlays);
    assert.equal(overlays.choiceOpen, true);
    overlays.choiceAction("back");
    assert.deepEqual(sent, [leave], "in co-op the pad's back leaves the deal, not puts it off");

    overlays.update({ ...trophy, dismissible: false });
    await settle(overlays.stage, overlays);
    assert.ok(texts(overlays.stage.root).includes("奖杯"));
    assert.ok(overlays.content.actions.some((action) => action.kind === "reroll"));
    sent.length = 0;
    overlays.physicalKey(key("KeyX"));
    assert.deepEqual(sent, [{ t: "skip", card: trophy.pending.id }], "a trophy can be skipped");
    sent.length = 0;
    overlays.navigate("cancel");
    assert.deepEqual(sent, [], "a trophy card in solo stays until it is answered");

    // In co-op an ordinary card or a trophy is put off as before, and keeps its paid skip.
    for (const card of [trophy, ordinary]) {
      overlays.update({ ...card, dismissible: true, skips: 1 });
      await settle(overlays.stage, overlays);
      sent.length = 0;
      overlays.navigate("cancel");
      const later = overlays.controls.findIndex(
        (control) =>
          control.panel ===
          overlays.content.actions.find((action) => action.kind === "defer")?.panel,
      );
      overlays.activate(later);
      overlays.physicalKey(key("KeyX"));
      assert.deepEqual(sent, [
        { t: "choices", open: false },
        { t: "choices", open: false },
        { t: "skip", card: card.pending.id },
      ]);
    }
  } finally {
    overlays.update(null);
  }
});
