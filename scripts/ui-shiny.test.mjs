import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PerspectiveCamera, Texture } from "three";
import { setImageLoader } from "@pmndrs/uikit/dist/components/image.js";
import { installResources } from "../src/platform/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";
import { bindImages } from "../src/prepare/images.ts";
import { emptyProgress, setShinyLook } from "../src/run/progress.ts";
import { navigationAction } from "../src/platform/input.ts";
import { formOf } from "../src/run/sim/evolution.ts";
import { DEFAULT_TRAINER } from "../src/run/sim/content/trainers.ts";
import { GpuLobby } from "../src/ui/gpu/lobby.ts";
import { GpuEdgeIndicators } from "../src/ui/gpu/run-edge-indicators.ts";
import { MultiplayerSeat } from "../src/ui/gpu/multiplayer-seat.ts";
import { UiStage, setUiPixelRatio } from "../src/ui/gpu/stage.ts";
import { themeColors } from "../src/ui/gpu/run-theme.ts";

// Real Yoga and committed glyph metrics, without raster decoding or GPU uploads: this protects the
// shiny look's input and wiring; its colours and the real portraits need the formal App.
const core = new URL("../public/fonts/gpu/core/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", core), "utf8"));
const textures = [];
function font(key) {
  const p = JSON.parse(readFileSync(new URL(manifest[key].json, core), "utf8"));
  const pageTextures = p.pages.map(() => new Texture());
  textures.push(...pageTextures);
  return {
    pages: p.pages,
    pageSizes: p.pageSizes,
    pageTextures,
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

/** Records image requests instead of decoding them. */
const requested = [];
function install() {
  installRuntime({ createAudioDecoder: () => ({}), activateAudio() {} });
  setImageLoader((src) => {
    requested.push(src);
    return new Promise(() => {});
  });
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

const box = (lobby, panel) => {
  const v = lobby.stage.viewport;
  const [w, h] = panel.size.value;
  const m = panel.globalMatrix.value.elements;
  return {
    x: (m[12] - lobby.stage.camera.left) * v.scale,
    y: (lobby.stage.camera.top - m[13]) * v.scale,
    w: w * v.scale,
    h: h * v.scale,
  };
};
async function settle(lobby, delay = 50) {
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  for (let frame = 0; frame < 32; frame++) {
    lobby.stage.update(16);
    lobby.afterLayout(16);
  }
}
const pick = (starter) => ({
  mode: "expedition",
  starter,
  difficulty: 0,
  stage: "forest",
  trainer: DEFAULT_TRAINER,
});
/** The app's answer to a request with nothing loading: a missing `worn` toggles the saved look, a
 *  repeat of the saved look changes nothing. */
const settleLook = (progress, line, worn) => {
  const was = progress.looks.worn.includes(line);
  const target = worn ?? !was;
  return target === was ? progress : setShinyLook(progress, line, target);
};

test("the lobby's shiny key: only for an owned look, every input wears it, the stage follows", async () => {
  install();
  try {
    for (const [width, height, dpr] of [
      [1280, 800, 1],
      [844, 390, 3],
    ]) {
      setUiPixelRatio(dpr);
      let progress = {
        ...emptyProgress(),
        research: 50000,
        looks: { owned: ["charmander"], worn: [] },
      };
      const worn = [];
      const shows = [];
      let lobby;
      // The app's side: save the choice, then hand the lobby its new progress.
      const callbacks = {
        pick() {},
        rules() {},
        start() {},
        lab() {},
        codex() {},
        settings() {},
        multiplayer() {},
        openLink() {},
        shiny(line, on) {
          worn.push([line, on]);
          const next = settleLook(progress, line, on);
          if (next === progress) return;
          progress = next;
          lobby.update({ progress, rules: [], pick: pick(lobby.selected) });
        },
      };
      lobby = new GpuLobby(
        fonts,
        new Texture(),
        { progress, rules: [], pick: pick("charmander") },
        callbacks,
      );
      try {
        lobby.attachScene({
          show: (...args) => shows.push(args),
          showTrainer() {},
          setCovered() {},
          setLayout() {},
        });
        lobby.resize(width, height, 1, { left: 0, right: 0, top: 0, bottom: 0 });
        await settle(lobby);
        const where = `${width}x${height}`;
        const key = lobby.controls.find((c) => c.kind === "shiny");
        const index = lobby.controls.indexOf(key);
        assert.deepEqual(shows.at(-1), ["charmander", "fire", false], where);
        assert.ok(key.panel.isVisible.value, `owned look shows its key: ${where}`);
        const b = box(lobby, key.panel);
        assert.ok(b.w >= 43.5 && b.h >= 43.5, `touch target: ${where} ${JSON.stringify(b)}`);
        const plate = box(lobby, lobby.ribbonPlate.panel);
        assert.ok(b.x < plate.x - plate.w / 2, `key stands before the name plate: ${where}`);

        // Touch / mouse: a press on the key wears the look; the stage recolours, medal and chain follow.
        lobby.activate(lobby.hit(b.x, b.y));
        assert.deepEqual(worn.at(-1), ["charmander", undefined], `a press toggles: ${where}`);
        assert.deepEqual(progress.looks.worn, ["charmander"], where);
        assert.deepEqual(shows.at(-1), ["charmander", "fire", true], where);
        await settle(lobby, 0);
        assert.ok(
          requested.includes("/art/portraits/charmander-shiny.webp") &&
            requested.includes("/art/portraits/charmeleon-shiny.webp"),
          `shiny medal and chain portraits are requested: ${where}`,
        );

        // Keyboard: Tab reaches the key between ‹ › and the medal; Enter takes it off.
        lobby.setFocusVisible(true);
        lobby.focus(lobby.index("next"));
        lobby.navigate("next");
        assert.equal(lobby.focused, index, `Tab order: ${where}`);
        lobby.navigate("confirm");
        assert.deepEqual(worn.at(-1), ["charmander", undefined], where);
        assert.deepEqual(progress.looks.worn, [], where);
        assert.deepEqual(shows.at(-1), ["charmander", "fire", false], where);
        assert.equal(lobby.focused, index, `focus stays on the key after the rebuild: ${where}`);

        // Gamepad / arrows: up from the medal, past the bond, reaches the key; → and ← always say
        // which look.
        lobby.focus(lobby.controls.indexOf(lobby.tiles[0]));
        lobby.navigate("up");
        assert.equal(lobby.controls[lobby.focused]?.kind, "bond", `up from the roster: ${where}`);
        lobby.navigate("up");
        assert.equal(lobby.focused, index, `up from the bond: ${where}`);
        const count = worn.length;
        lobby.navigate("right");
        lobby.navigate("right");
        assert.deepEqual(
          worn.slice(count),
          [
            ["charmander", true],
            ["charmander", true],
          ],
          where,
        );
        assert.deepEqual(progress.looks.worn, ["charmander"], where);
        lobby.navigate("left");
        assert.deepEqual(worn.at(-1), ["charmander", false], where);
        assert.deepEqual(progress.looks.worn, [], where);

        // A partner whose look is not owned: no key, no stop, focus leaves it.
        lobby.focus(index);
        lobby.update({ progress, rules: [], pick: pick("squirtle") });
        await settle(lobby, 0);
        assert.equal(key.panel.isVisible.value, false, `no key without the look: ${where}`);
        assert.notEqual(lobby.focused, index, `focus leaves the hidden key: ${where}`);
        assert.ok(!lobby.tabStops().includes(index), `no tab stop: ${where}`);
        assert.notEqual(lobby.hit(b.x, b.y), index, `no hit: ${where}`);
        assert.deepEqual(shows.at(-1), ["squirtle", "water", false], where);
      } finally {
        lobby.dispose();
      }
    }
  } finally {
    setImageLoader(null);
    setUiPixelRatio(1);
  }
});

test("a second-row partner wears its look by direction and confirm, keeping pick and difficulty", async () => {
  install();
  setUiPixelRatio(1);
  try {
    // 困难 and 噩梦, without and with a backpack (whose row sits between the roster and the tray).
    for (const difficulty of [1, 2])
      for (const backpack of [[], ["magnet"]]) {
        const where = `difficulty ${difficulty}, backpack ${backpack.length}`;
        let progress = {
          ...emptyProgress(),
          research: 10000000,
          clears: [1, 1, 0],
          backpack,
          looks: { owned: ["geodude"], worn: [] },
        };
        const picks = [];
        let lobby;
        const at = { ...pick("geodude"), difficulty };
        lobby = new GpuLobby(
          fonts,
          new Texture(),
          { progress, rules: [], pick: at },
          {
            pick: (p) => picks.push(p),
            rules() {},
            start() {},
            lab() {},
            codex() {},
            settings() {},
            multiplayer() {},
            openLink() {},
            shiny(line, on) {
              const next = settleLook(progress, line, on);
              if (next === progress) return;
              progress = next;
              lobby.update({ progress, rules: [], pick: { ...at, starter: lobby.selected } });
            },
          },
        );
        try {
          lobby.resize(1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 });
          await settle(lobby);
          const kind = () => lobby.controls[lobby.focused]?.kind;
          const tile = lobby.tiles.at(-1);
          assert.ok(lobby.tiles.indexOf(tile) >= 5, "Geodude stands in the second row");
          /** Medal ↓ (through the backpack) to the tray, ↑ to the key: vertical moves only. */
          const route = () => {
            lobby.focus(lobby.controls.indexOf(tile));
            lobby.navigate("down");
            if (backpack.length) {
              assert.equal(kind(), "info", `↓ reaches the backpack: ${where}`);
              lobby.navigate("down");
            }
            // With the rules open, 规则 stands between the column and the tray.
            assert.equal(kind(), "rules", `↓ reaches 规则 above the tray: ${where}`);
            lobby.navigate("up");
            assert.equal(kind(), "shiny", `↑ from 规则 reaches the shiny key: ${where}`);
          };
          route();
          lobby.navigate("confirm");
          assert.deepEqual(progress.looks.worn, ["geodude"], where);
          lobby.navigate("down");
          assert.equal(kind(), "bond", `↓ passes the bond: ${where}`);
          lobby.navigate("down");
          assert.equal(
            lobby.focused,
            lobby.controls.indexOf(tile),
            `↓ returns to the medal: ${where}`,
          );
          route();
          lobby.navigate("confirm");
          assert.deepEqual(progress.looks.worn, [], where);
          assert.equal(lobby.selected, "geodude", where);
          assert.equal(lobby.difficulty, difficulty, where);
          assert.deepEqual(picks, [], `no pick or difficulty was saved on the way: ${where}`);
          // The roster's rows still pick by ↑ ↓, and the tray still reaches the roster via the key.
          lobby.focus(lobby.controls.indexOf(tile));
          lobby.navigate("up");
          assert.equal(lobby.selected, "pikachu", where);
          lobby.navigate("down");
          assert.equal(lobby.selected, "geodude", where);
        } finally {
          lobby.dispose();
        }
      }
  } finally {
    setImageLoader(null);
  }
});

test("a look still loading: ← → name the look, a second press cancels, the key shows the saved look", async () => {
  install();
  setUiPixelRatio(1);
  let progress = { ...emptyProgress(), looks: { owned: ["charmander"], worn: [] } };
  // The app's side holds every request (its pictures are still loading) until the test lands one.
  const asked = [];
  const shows = [];
  const lobby = new GpuLobby(
    fonts,
    new Texture(),
    { progress, rules: [], pick: pick("charmander") },
    {
      pick() {},
      rules() {},
      start() {},
      lab() {},
      codex() {},
      settings() {},
      multiplayer() {},
      openLink() {},
      shiny: (line, worn) => asked.push([line, worn]),
    },
  );
  try {
    lobby.attachScene({
      show: (...args) => shows.push(args),
      showTrainer() {},
      setCovered() {},
      setLayout() {},
    });
    lobby.resize(1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 });
    await settle(lobby);
    const key = lobby.shinyKey;
    const index = lobby.controls.findIndex((c) => c.kind === "shiny");
    const medal = () => lobby.badges[0].badge.portraitImage.src;
    const saved = () => [key.on, shows.at(-1)[2], medal()];
    const normal = [false, false, "/art/portraits/charmander.webp"];
    lobby.setFocusVisible(true);
    lobby.focus(index);

    lobby.navigate("confirm");
    assert.deepEqual(asked.at(-1), ["charmander", undefined], "a press toggles");
    assert.deepEqual(saved(), normal, "while it loads, key, stage and medal show the saved look");
    lobby.navigate("left");
    assert.deepEqual(
      asked.at(-1),
      ["charmander", false],
      "← asks for normal though normal is saved",
    );
    lobby.navigate("right");
    assert.deepEqual(asked.at(-1), ["charmander", true]);
    lobby.navigate("confirm");
    assert.deepEqual(asked.at(-1), ["charmander", undefined], "a second press reaches the app");
    assert.deepEqual(saved(), normal);
    assert.deepEqual(progress.looks.worn, [], "the lobby never writes the look itself");

    // The app lands the look once its pictures are in: the stage recolours, and the key pops when
    // the app reports the save as this lobby's request.
    progress = setShinyLook(progress, "charmander", true);
    lobby.update({ progress, rules: [], pick: pick("charmander") });
    assert.deepEqual(saved(), [true, true, "/art/portraits/charmander-shiny.webp"]);
    assert.equal(key.pop.scale, 1, "a progress update alone never pops");
    lobby.lookSaved("charmander", true);
    assert.equal(key.pop.scale, 1.35, "the reported save pops the spark, however late");
    assert.equal(lobby.focused, index, "focus stays on the key");
    await settle(lobby, 0);
    assert.equal(key.pop.scale, 1);

    // A change nobody asked for here (an imported save) shows without the pop.
    progress = setShinyLook(progress, "charmander", false);
    lobby.update({ progress, rules: [], pick: pick("charmander") });
    progress = setShinyLook(progress, "charmander", true);
    lobby.update({ progress, rules: [], pick: pick("charmander") });
    assert.equal(key.on, true);
    assert.equal(key.pop.scale, 1, "no pop for a look the player did not ask for");
  } finally {
    lobby.dispose();
    setImageLoader(null);
  }
});

test("the 图鉴 asks for a failed shiny model again from the same 异色 segment, writing nothing", async () => {
  install();
  setUiPixelRatio(1);
  // Every model and map answers 503.
  const reads = [];
  installResources({
    read: (url) => {
      reads.push(String(url));
      return Promise.resolve(new Response(null, { status: 503 }));
    },
    createTexture: () => new Texture(),
  });
  const { GpuCodex } = await import("../src/ui/gpu/codex.ts");
  const { codexSections } = await import("../src/run/codex.ts");
  const progress = { ...emptyProgress(), looks: { owned: ["charmander"], worn: [] } };
  const before = structuredClone(progress);
  // The stage reports each failed load; keep them as the test's evidence instead of noise.
  const logged = [];
  const error = console.error;
  console.error = (cause) => logged.push(String(cause?.message ?? cause));
  const codex = new GpuCodex(fonts, { progress, onClose() {} });
  const until = async (done) => {
    for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(done(), `model state stayed ${codex.model.state}`);
  };
  const glb = () => reads.filter((url) => url.includes("/models/charmander")).length;
  try {
    codex.resize(1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 });
    await settle(codex);
    const section = codexSections().findIndex((s) => s.id === "pokemon");
    codex.activate(codex.controls.indexOf(codex.tabs[section]));
    codex.activate(
      codex.controls.indexOf(codex.entries.find((row) => row.key === "form:charmander")),
    );
    await settle(codex);
    const looks = codex.details.filter((control) => control.region === "look");
    assert.equal(looks.length, 2, "the owned look offers 普通 / 异色");
    await until(() => codex.model.state === "error");

    const shiny = looks[1];
    codex.activate(codex.controls.indexOf(shiny));
    assert.match(codex.model.wanted, /#shiny:charmander$/);
    await until(() => codex.model.state === "error");
    assert.equal(codex.modelNote.properties.value.text, "模型载入失败");
    const first = glb();

    // The same segment, pressed again (pointer, or confirm on it), asks again in place.
    codex.focus(codex.controls.indexOf(shiny));
    codex.navigate("confirm");
    assert.equal(codex.model.state, "loading", "the press starts a new load");
    assert.equal(
      codex.modelNote.properties.value.text,
      "",
      "the failure text clears while it loads",
    );
    assert.match(codex.model.wanted, /#shiny:charmander$/, "still the shiny picture");
    await until(() => codex.model.state === "error");
    assert.ok(glb() > first, `the model was fetched again (${first} → ${glb()})`);
    assert.deepEqual(progress, before, "browsing never writes the worn look");
    assert.ok(
      logged.every((m) => m.includes("HTTP 503")),
      logged.join("; "),
    );
  } finally {
    console.error = error;
    codex.dispose();
    setImageLoader(null);
  }
});

test("a held Enter / Space toggles the shiny key once; a fresh press toggles again", async () => {
  install();
  setUiPixelRatio(1);
  const progress = { ...emptyProgress(), looks: { owned: ["charmander"], worn: [] } };
  const asked = [];
  const lobby = new GpuLobby(
    fonts,
    new Texture(),
    { progress, rules: [], pick: pick("charmander") },
    {
      pick() {},
      rules() {},
      start() {},
      lab() {},
      codex() {},
      settings() {},
      multiplayer() {},
      openLink() {},
      shiny: (line, worn) => asked.push([line, worn]),
    },
  );
  // The host's order for a key: the screen's physicalKey first, then shared navigation.
  const key = (code, repeat) => {
    const event = { key: code === "Space" ? " " : code, code, shift: false, repeat };
    if (!lobby.physicalKey(event)) {
      const action = navigationAction(code, false);
      if (action) lobby.navigate(action);
    }
  };
  try {
    lobby.resize(1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 });
    await settle(lobby);
    const index = lobby.controls.findIndex((c) => c.kind === "shiny");
    lobby.setFocusVisible(true);
    lobby.focus(index);
    for (const code of ["Enter", "NumpadEnter", "Space"]) {
      asked.length = 0;
      key(code, false);
      for (let i = 0; i < 5; i++) key(code, true);
      assert.deepEqual(asked, [["charmander", undefined]], `${code}: held, one request`);
      key(code, false);
      assert.deepEqual(asked.length, 2, `${code}: released and pressed again, a second one`);
    }
    // Held arrows still name the look; repeats on other keys keep their own behaviour.
    asked.length = 0;
    key("ArrowRight", false);
    key("ArrowRight", true);
    assert.deepEqual(asked, [
      ["charmander", true],
      ["charmander", true],
    ]);
    lobby.focus(lobby.controls.indexOf(lobby.tiles[0]));
    asked.length = 0;
    key("Enter", true);
    assert.equal(lobby.focused, lobby.controls.indexOf(lobby.tiles[0]), "other keys unchanged");
  } finally {
    lobby.dispose();
    setImageLoader(null);
  }
});

test("a failed or cancelled look leaves nothing behind: a later import shows without a pop", async () => {
  install();
  setUiPixelRatio(1);
  let progress = { ...emptyProgress(), looks: { owned: ["charmander"], worn: [] } };
  const asked = [];
  const lobby = new GpuLobby(
    fonts,
    new Texture(),
    { progress, rules: [], pick: pick("charmander") },
    {
      pick() {},
      rules() {},
      start() {},
      lab() {},
      codex() {},
      settings() {},
      multiplayer() {},
      openLink() {},
      shiny: (line, worn) => asked.push([line, worn]),
    },
  );
  try {
    lobby.resize(1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 });
    await settle(lobby);
    const key = lobby.shinyKey;
    lobby.setFocusVisible(true);
    lobby.focus(lobby.controls.findIndex((c) => c.kind === "shiny"));
    // Asked, then its load fails (the app saves nothing, reports nothing).
    lobby.navigate("confirm");
    lobby.navigate("right");
    assert.equal(asked.length, 2);
    // Later an imported save wears the look: shown, no pop.
    progress = setShinyLook(progress, "charmander", true);
    lobby.update({ progress, rules: [], pick: pick("charmander") });
    assert.equal(key.on, true);
    assert.equal(key.pop.scale, 1, "an import after a failed request does not pop");
    // A save the app reports for another partner, or for taking the look off, pops nothing.
    lobby.lookSaved("squirtle", true);
    lobby.lookSaved("charmander", false);
    assert.equal(key.pop.scale, 1);
  } finally {
    lobby.dispose();
    setImageLoader(null);
  }
});

test("the room's create card follows a partner picked in the room", async () => {
  install();
  setUiPixelRatio(1);
  const { GpuMultiplayer } = await import("../src/ui/gpu/multiplayer.ts");
  const progress = {
    ...emptyProgress(),
    research: 10000000,
    looks: { owned: ["squirtle"], worn: ["squirtle"] },
  };
  const room = new GpuMultiplayer(
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
    progress,
    pick("charmander"),
    [],
  );
  try {
    const card = () => [room.partner.portraitImage.src, room.partner.state.type];
    assert.deepEqual(card(), ["/art/portraits/charmander.webp", themeColors("fire").theme]);
    room.choose({ starter: "squirtle" });
    assert.equal(room.pick.starter, "squirtle");
    assert.deepEqual(card(), ["/art/portraits/squirtle-shiny.webp", themeColors("water").theme]);
  } finally {
    room.dispose();
    setImageLoader(null);
  }
});

test("room seats and off-screen markers show each player's own look", async () => {
  install();
  setUiPixelRatio(1);
  const stage = new UiStage();
  stage.resize(1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 });
  stage.root.setProperties({ fontFamilies: fonts });
  try {
    const seat = new MultiplayerSeat(stage, 1);
    stage.root.add(seat.root);
    const view = {
      label: "P2",
      starter: "gastly",
      trainer: DEFAULT_TRAINER,
      self: false,
      chip: "已加入",
      pending: false,
    };
    const src = () => seat.portrait.properties.value.src;
    seat.update(view, true);
    assert.equal(src(), "/art/portraits/gastly-shiny.webp");
    seat.update(view, false);
    assert.equal(src(), "/art/portraits/gastly.webp", "the seat follows its player's change");
    seat.dispose();

    const indicators = new GpuEdgeIndicators(stage, []);
    const world = {
      players: [0, 1].map((id) => ({
        id,
        starter: "charmander",
        stage: 0,
        px: 0,
        x: id * 80,
        pz: 0,
        z: 0,
        alive: true,
      })),
      enemies: [],
      map: {
        terrain: { origin: -100, resolution: 0.01, samples: 3, heights: new Float32Array(9) },
      },
    };
    const camera = new PerspectiveCamera(42, 1.6, 0.5, 120);
    camera.position.set(0, 16, 13);
    camera.lookAt(0, 0.6, 0);
    camera.updateMatrixWorld();
    const portrait = () => indicators.players[1].portrait.properties.value.src;
    indicators.update(world, 0, camera, 1, 1 / 60, true, (slot) => slot === 1);
    assert.equal(portrait(), `/art/portraits/${formOf(world.players[1]).id}-shiny.webp`);
    indicators.update(world, 0, camera, 1, 1 / 60, true, () => false);
    assert.equal(portrait(), `/art/portraits/${formOf(world.players[1]).id}.webp`);
    indicators.dispose();
  } finally {
    stage.dispose();
    setImageLoader(null);
    for (const texture of textures) texture.dispose();
  }
});
