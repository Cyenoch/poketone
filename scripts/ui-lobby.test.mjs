import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Texture } from "three";
import { setImageLoader } from "@pmndrs/uikit/dist/components/image.js";
import { installResources } from "../src/platform/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";
import { bindImages } from "../src/prepare/images.ts";
import { emptyProgress } from "../src/run/progress.ts";
import { starterOrder } from "../src/run/sim/content/lines/index.ts";
import { DEFAULT_TRAINER } from "../src/run/sim/content/trainers.ts";
import { trainerOrder } from "../src/trainers.ts";
import { GpuLobby } from "../src/ui/gpu/lobby.ts";
import { fitScale } from "../src/ui/gpu/viewport.ts";
import { setUiPixelRatio } from "../src/ui/gpu/stage.ts";

// Real Yoga and committed glyph metrics, without raster decoding or GPU uploads.
// This protects input/layout; missing portraits and models still need formal App verification.
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
const box = (lobby, panel) => {
  const v = lobby.stage.viewport;
  const [w, h] = panel.size.value;
  const m = panel.globalMatrix.value.elements;
  const x = (m[12] - lobby.stage.camera.left) * v.scale;
  const y = (lobby.stage.camera.top - m[13]) * v.scale;
  return { x, y, w: w * v.scale, h: h * v.scale };
};
async function settle(lobby, delay = 50) {
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  for (let frame = 0; frame < 32; frame++) {
    lobby.stage.update(16);
    lobby.afterLayout(16);
  }
}

test("all roster choices and a full backpack remain reachable across lobby sizes and scales", async () => {
  installRuntime({ createAudioDecoder: () => ({}), activateAudio() {} });
  setImageLoader(() => new Promise(() => {}));
  installResources({
    read: () => new Promise(() => {}),
    createTexture: () => new Texture(),
  });
  bindImages({
    generation: 0,
    available: false,
    subscribe: () => () => {},
    enqueue() {},
    upload() {},
    resident: () => () => {},
  });
  try {
    for (const [width, height, dpr] of [
      [1280, 800, 1],
      [844, 390, 3],
      [667, 375, 2],
      [869, 303, 3],
    ]) {
      for (const userScale of [0.8, 1, 1.5]) {
        setUiPixelRatio(dpr);
        const safe = {
          left: width === 844 || width === 869 ? 47 : 0,
          right: width === 844 || width === 869 ? 47 : 0,
          top: 0,
          bottom: width === 844 || width === 869 ? 21 : 0,
        };
        const cleared = { difficulty: 1, victory: true, time: 900, kills: 900 };
        const progress = {
          ...emptyProgress(),
          research: 50000,
          clears: [1, 1, 0],
          best: { charmander: cleared, bulbasaur: cleared, squirtle: cleared, pikachu: cleared },
          backpack: ["magnet", "leftovers", "charcoal"],
          lab: { bag: 1 },
        };
        const picked = [];
        const lobby = new GpuLobby(
          fonts,
          new Texture(),
          {
            progress,
            rules: [],
            pick: {
              mode: "expedition",
              starter: "charmander",
              difficulty: 0,
              stage: "forest",
              trainer: DEFAULT_TRAINER,
            },
          },
          {
            pick: (p) => picked.push(p.starter),
            rules() {},
            start() {},
            lab() {},
            codex() {},
            settings() {},
            multiplayer() {},
            openLink() {},
          },
        );
        try {
          let sceneLayout;
          const trainerViews = [];
          const shows = [];
          lobby.attachScene({
            show: (...args) => shows.push(args),
            showTrainer: (...args) => trainerViews.push(args),
            setCovered() {},
            setLayout(layout) {
              sceneLayout = layout;
            },
          });
          lobby.resize(
            width,
            height,
            fitScale(userScale, width, height, safe, lobby.minLayout),
            safe,
          );
          await settle(lobby);
          // The scrolling column clips its rows (the route map among them on a phone) at its own
          // edges: they stay below the top bar and, with the route row, above 出发 and the difficulty tray.
          const top = (b) => b.y - b.h / 2,
            bottom = (b) => b.y + b.h / 2;
          const go = box(lobby, lobby.go),
            column = box(lobby, lobby.column),
            route = box(lobby, lobby.route);
          const at = `${width}x${height}@${userScale}`;
          assert.ok(bottom(column) <= top(go), `${at}: the column runs under 出发`);
          for (const bar of [lobby.tabs, lobby.corner])
            assert.ok(
              top(column) >= bottom(box(lobby, bar)),
              `${at}: the column runs under the top bar`,
            );
          if (!lobby.compact) {
            assert.ok(bottom(route) <= top(go), `${at}: the route runs under 出发`);
            assert.ok(bottom(column) <= top(route), `${at}: the column runs under the route`);
          }
          if (!lobby.legalInColumn) {
            const legal = box(lobby, lobby.legal);
            assert.ok(
              sceneLayout.feet.y <= legal.y - legal.h / 2,
              "the partner's stage stands above the legal notice",
            );
          }
          const controls = lobby.controls.filter((c) => c.panel.isVisible.value);
          for (const c of controls) {
            lobby.focus(lobby.controls.indexOf(c));
            await settle(lobby, 0);
            const b = box(lobby, c.panel);
            const where = `${width}x${height}@${userScale} ${c.kind}:${c.index} ${JSON.stringify(b)}`;
            assert.ok(b.w >= 43.5 && b.h >= 43.5, `touch target: ${where}`);
            assert.ok(
              b.x - b.w / 2 >= safe.left - 1 && b.x + b.w / 2 <= width - safe.right + 1,
              `horizontal: ${where}`,
            );
            assert.ok(
              b.y - b.h / 2 >= safe.top - 1 && b.y + b.h / 2 <= height - safe.bottom + 1,
              `vertical: ${where}`,
            );
            assert.equal(lobby.hit(b.x, b.y), lobby.controls.indexOf(c), `hit target: ${where}`);
            if (c.kind === "tile")
              for (const dx of [-0.3, 0.3])
                assert.equal(
                  lobby.hit(b.x + b.w * dx, b.y),
                  lobby.controls.indexOf(c),
                  `medal edges: ${where}`,
                );
          }
          // Physical input addresses every registered starter, including the final two medals.
          for (const c of lobby.tiles) {
            lobby.focus(lobby.controls.indexOf(c));
            await settle(lobby, 0);
            const b = box(lobby, c.panel);
            lobby.activate(lobby.hit(b.x, b.y));
          }
          assert.deepEqual(
            picked,
            starterOrder.filter((id, i) => i || id !== "charmander"),
          );
          const locked = lobby.trainerControls.find((c) => trainerOrder[c.index] === "xiaqing");
          const pickedBeforePreview = picked.length;
          lobby.activate(lobby.controls.indexOf(locked));
          assert.equal(
            lobby.trainer,
            DEFAULT_TRAINER,
            "silhouette preview keeps the chosen trainer",
          );
          assert.equal(
            picked.length,
            pickedBeforePreview,
            "preview never persists a locked identity",
          );
          assert.deepEqual(trainerViews.at(-1), ["xiaqing", true]);
          lobby.activate(lobby.controls.indexOf(lobby.trainerControls[0]));
          assert.deepEqual(
            trainerViews.at(-1),
            [DEFAULT_TRAINER, false],
            "pressing the current choice exits preview",
          );
          lobby.update({
            progress: { ...progress, kills: 5000 },
            rules: [],
            pick: {
              mode: "expedition",
              trainer: DEFAULT_TRAINER,
              starter: lobby.selected,
              difficulty: 0,
              stage: "forest",
            },
          });
          lobby.activate(lobby.controls.indexOf(locked));
          assert.equal(lobby.trainer, "xiaqing", "the same visible tile selects once unlocked");
          assert.deepEqual(trainerViews.at(-1), ["xiaqing", false]);
          lobby.focus(lobby.controls.indexOf(lobby.tiles[0]));
          lobby.navigate("down");
          assert.equal(
            lobby.controls[lobby.focused].kind,
            "tile",
            "down reaches the second roster row",
          );
          lobby.navigate("down");
          assert.equal(
            lobby.controls[lobby.focused].kind,
            "info",
            "down then reaches the backpack",
          );
          if (height === 303) {
            assert.ok(lobby.column.maxScrollPosition.value[1] > 0, "short column scrolls");
            const column = box(lobby, lobby.column);
            lobby.pointerDown(column.x, column.y, true);
            lobby.scroll(-10000);
            assert.equal(lobby.column.scrollPosition.value[1], 0);
            lobby.scroll(10000);
            assert.equal(
              lobby.column.scrollPosition.value[1],
              lobby.column.maxScrollPosition.value[1],
            );
            lobby.pointerUp(true);
            await settle(lobby);
            for (const c of controls.filter((c) =>
              ["settings", "multiplayer", "start"].includes(c.kind),
            )) {
              const b = box(lobby, c.panel);
              assert.equal(
                lobby.hit(b.x, b.y),
                lobby.controls.indexOf(c),
                `scrolled ${c.kind} remains clickable`,
              );
            }
          }
          // A partner not yet joined cannot be picked: no pick, no stage change.
          lobby.update({
            progress: { ...emptyProgress(), backpack: [] },
            rules: [],
            pick: {
              mode: "expedition",
              trainer: DEFAULT_TRAINER,
              starter: "charmander",
              difficulty: 0,
              stage: "forest",
            },
          });
          const before = [picked.length, shows.length];
          lobby.activate(lobby.controls.indexOf(lobby.tiles[starterOrder.indexOf("dratini")]));
          assert.deepEqual(
            [picked.length, shows.length],
            before,
            "a locked partner cannot be picked",
          );
        } finally {
          lobby.dispose();
        }
      }
    }
  } finally {
    setImageLoader(null);
    setUiPixelRatio(1);
    for (const texture of textures) texture.dispose();
  }
});

test("the picked partner's bond: title on the scale, the next level on focus, hover or a tap", async () => {
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
  const tipText = (lobby) => String(lobby.tooltip.text.properties.value.text ?? "");
  const shownTexts = (panel) => {
    const out = [];
    panel.traverse((node) => {
      if (node.properties?.value?.text !== undefined && node.isVisible?.value)
        out.push(String(node.properties.value.text));
    });
    return out;
  };
  try {
    for (const [width, height, dpr] of [
      [1280, 800, 1],
      [844, 390, 3],
    ]) {
      const where = `${width}×${height}`;
      setUiPixelRatio(dpr);
      const progress = { ...emptyProgress(), bonds: { charmander: 35 } };
      const lobby = new GpuLobby(
        fonts,
        new Texture(),
        {
          progress,
          rules: [],
          pick: {
            mode: "expedition",
            starter: "charmander",
            difficulty: 0,
            stage: "forest",
            trainer: DEFAULT_TRAINER,
          },
        },
        {
          pick() {},
          rules() {},
          start() {},
          lab() {},
          codex() {},
          settings() {},
          multiplayer() {},
          openLink() {},
        },
      );
      try {
        lobby.resize(width, height, 1, { left: 0, right: 0, top: 0, bottom: 0 });
        await settle(lobby);
        const index = lobby.index("bond");
        const meter = lobby.controls[index];
        assert.ok(shownTexts(meter.panel).includes("熟悉"), `the earned title shows: ${where}`);
        assert.equal(lobby.tooltip.want, null, `no standing explanation: ${where}`);
        const b = box(lobby, meter.panel);
        assert.ok(b.w >= 43.5 && b.h >= 43.5, `touch target: ${where} ${JSON.stringify(b)}`);
        const next = "Lv.3 信赖 · 羁绊研究\n还差 25 点";

        // Gamepad / arrows: up from the medal reaches the scale and shows the next level.
        lobby.setFocusVisible(true);
        lobby.focus(lobby.controls.indexOf(lobby.tiles[0]));
        lobby.navigate("up");
        assert.equal(lobby.focused, index, `up from the roster: ${where}`);
        await settle(lobby, 0);
        assert.equal(lobby.tooltip.want, meter.panel, `focus shows the tip: ${where}`);
        assert.equal(meter.tip(), next, where);
        assert.ok(tipText(lobby).includes("还差 25 点"), `${where}: ${tipText(lobby)}`);
        lobby.setFocusVisible(false);
        lobby.focus(-1);
        await settle(lobby, 0);
        assert.equal(lobby.tooltip.want, null, where);

        // Mouse: hovering the scale shows it.
        lobby.pointerMove(b.x, b.y);
        await settle(lobby, 0);
        assert.equal(lobby.tooltip.want, meter.panel, `hover shows the tip: ${where}`);
        lobby.pointerMove(0, 0);

        // Touch: a tap toggles it.
        lobby.setCoarsePointer(true);
        lobby.pointerDown(b.x, b.y, true);
        lobby.pointerUp(true);
        await settle(lobby, 0);
        assert.equal(lobby.tooltip.want, meter.panel, `a tap shows the tip: ${where}`);
        lobby.pointerDown(b.x, b.y, true);
        lobby.pointerUp(true);
        await settle(lobby, 0);
        assert.equal(lobby.tooltip.want, null, `a second tap hides it: ${where}`);
        lobby.setCoarsePointer(false);

        // A partner without a bond yet: the empty scale, no title.
        lobby.update({
          progress,
          rules: [],
          pick: {
            mode: "expedition",
            starter: "squirtle",
            difficulty: 0,
            stage: "forest",
            trainer: DEFAULT_TRAINER,
          },
        });
        await settle(lobby, 0);
        const titles = shownTexts(lobby.controls[lobby.index("bond")].panel);
        assert.deepEqual(titles, [], `no title before Lv.1: ${where}`);
        assert.equal(lobby.controls[lobby.index("bond")].tip(), "Lv.1 初识\n还差 10 点", where);
      } finally {
        lobby.dispose();
      }
    }
  } finally {
    setImageLoader(null);
    setUiPixelRatio(1);
  }
});

function installLobbyMocks() {
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
const lobbyCallbacks = (picks = []) => ({
  pick: (p) => picks.push(p),
  rules() {},
  start() {},
  lab() {},
  codex() {},
  settings() {},
  multiplayer() {},
  openLink() {},
});
const pickOf = (starter, trainer = DEFAULT_TRAINER) => ({
  mode: "expedition",
  starter,
  difficulty: 0,
  stage: "forest",
  trainer,
});
const tipText = (lobby) => String(lobby.tooltip.text.properties.value.text ?? "");

test("the bond stays the picked partner's: reached from below, its tip follows RB, a long title keeps the chain in the column", async () => {
  installLobbyMocks();
  try {
    for (const [width, height, dpr] of [
      [1280, 800, 1],
      [844, 390, 3],
    ]) {
      for (const backpack of [[], ["magnet"]]) {
        const where = `${width}×${height}, backpack ${backpack.length}`;
        setUiPixelRatio(dpr);
        const progress = {
          ...emptyProgress(),
          research: 10000000,
          clears: [1, 1, 0],
          backpack,
          bonds: { geodude: 160, charmander: 160, squirtle: 35 },
        };
        const picks = [];
        const lobby = new GpuLobby(
          fonts,
          new Texture(),
          { progress, rules: [], pick: pickOf("geodude") },
          lobbyCallbacks(picks),
        );
        try {
          lobby.resize(width, height, 1, { left: 0, right: 0, top: 0, bottom: 0 });
          await settle(lobby);
          const kind = () => lobby.controls[lobby.focused]?.kind;
          const tile = lobby.tiles.at(-1);
          assert.ok(lobby.tiles.indexOf(tile) >= 5, "Geodude stands in the second row");

          // Gamepad / arrows: from the medal down to the tray, then ↑ reaches the bond directly.
          lobby.setFocusVisible(true);
          lobby.focus(lobby.controls.indexOf(tile));
          for (let step = 0; step < 4 && !["mode", "rules"].includes(kind()); step++)
            lobby.navigate("down");
          assert.ok(["mode", "rules"].includes(kind()), `↓ reaches the route row: ${where}`);
          lobby.navigate("up");
          if (backpack.length) {
            assert.equal(kind(), "info", `↑ from the tray reaches the backpack: ${where}`);
            lobby.navigate("up");
          }
          assert.equal(kind(), "bond", `↑ from below the roster reaches the bond: ${where}`);
          assert.equal(lobby.selected, "geodude", `no partner changed on the way: ${where}`);
          assert.deepEqual(picks, [], where);
          await settle(lobby, 0);
          assert.ok(
            tipText(lobby).includes("16"),
            `Geodude's own bond: ${where} ${tipText(lobby)}`,
          );

          // A long title (Lv.5): the evolution chain stays inside the column.
          for (const starter of ["geodude", "charmander"]) {
            if (lobby.selected !== starter) {
              lobby.update({ progress, rules: [], pick: pickOf(starter) });
              await settle(lobby, 0);
            }
            const host = (lobby.compact ? lobby.meta : lobby.chain).children.at(-1);
            const chain = box(lobby, host),
              content = box(lobby, lobby.columnContent),
              meter = box(lobby, lobby.controls[lobby.index("bond")].panel);
            assert.ok(
              chain.x + chain.w / 2 <= content.x + content.w / 2 + 0.5,
              `${starter}: the chain ends inside the column: ${where} ${JSON.stringify({ chain, content })}`,
            );
            assert.ok(meter.h >= 43.5, `${starter}: the bond keeps its touch target: ${where}`);
          }

          // RB with the bond focused: the tip follows the new partner, without a new entrance.
          lobby.update({ progress, rules: [], pick: pickOf("bulbasaur") });
          await settle(lobby, 0);
          lobby.focus(lobby.index("bond"));
          await settle(lobby, 0);
          assert.ok(tipText(lobby).includes("Lv.1"), `${where}: ${tipText(lobby)}`);
          lobby.navigate("nextPage");
          assert.equal(lobby.selected, "squirtle", where);
          await settle(lobby, 0);
          assert.equal(kind(), "bond", where);
          assert.ok(tipText(lobby).includes("还差 25 点"), `RB refreshes the tip: ${where}`);
        } finally {
          lobby.dispose();
        }
      }
    }
  } finally {
    setImageLoader(null);
    setUiPixelRatio(1);
  }
});

test("the trainer card names its item and passive; what they do shows on focus, hover or a tap", async () => {
  installLobbyMocks();
  const shownTexts = (panel) => {
    const out = [];
    panel.traverse((node) => {
      if (node.properties?.value?.text !== undefined && node.isVisible?.value)
        out.push(String(node.properties.value.text));
    });
    return out;
  };
  try {
    for (const [width, height, dpr] of [
      [1280, 800, 1],
      [844, 390, 3],
    ]) {
      const where = `${width}×${height}`;
      setUiPixelRatio(dpr);
      const lobby = new GpuLobby(
        fonts,
        new Texture(),
        { progress: emptyProgress(), rules: [], pick: pickOf("charmander", "shuoye") },
        lobbyCallbacks(),
      );
      try {
        lobby.resize(width, height, 1, { left: 0, right: 0, top: 0, bottom: 0 });
        await settle(lobby);
        const index = lobby.index("kit");
        const kit = lobby.controls[index];
        assert.deepEqual(shownTexts(kit.panel), ["好伤药", "巧修"], where);
        assert.equal(lobby.tooltip.want, null, `no standing explanation: ${where}`);
        const b = box(lobby, kit.panel);
        assert.ok(b.w >= 43.5 && b.h >= 43.5, `touch target: ${where} ${JSON.stringify(b)}`);
        const v = lobby.stage.viewport;
        assert.ok(
          b.x - b.w / 2 >= 0 && b.x + b.w / 2 <= v.width / 2,
          `on the trainer's side: ${where}`,
        );
        assert.ok(lobby.tabStops().includes(index), `Tab reaches it: ${where}`);

        // Keys / pad: ↑ from the picked trainer reaches it and shows what the kit does.
        lobby.setFocusVisible(true);
        lobby.focus(lobby.controls.findIndex((c) => c.kind === "trainer" && c.index === 1));
        lobby.navigate("up");
        assert.equal(lobby.focused, index, `↑ from the trainer: ${where}`);
        await settle(lobby, 0);
        assert.equal(lobby.tooltip.want, kit.panel, where);
        assert.ok(tipText(lobby).includes("冷却 90 秒") && tipText(lobby).includes("巧修"), where);
        lobby.navigate("down");
        assert.equal(lobby.controls[lobby.focused].kind, "trainer", `↓ back: ${where}`);
        lobby.setFocusVisible(false);
        lobby.focus(-1);
        await settle(lobby, 0);

        // Mouse: hover shows it.
        lobby.pointerMove(b.x, b.y);
        await settle(lobby, 0);
        assert.equal(lobby.tooltip.want, kit.panel, `hover: ${where}`);
        lobby.pointerMove(0, 0);

        // Touch: a tap toggles it.
        lobby.setCoarsePointer(true);
        lobby.pointerDown(b.x, b.y, true);
        lobby.pointerUp(true);
        await settle(lobby, 0);
        assert.equal(lobby.tooltip.want, kit.panel, `a tap shows it: ${where}`);
        lobby.pointerDown(b.x, b.y, true);
        lobby.pointerUp(true);
        await settle(lobby, 0);
        assert.equal(lobby.tooltip.want, null, `a second tap hides it: ${where}`);
        lobby.setCoarsePointer(false);

        // Previewing the locked trainer shows that trainer's kit.
        lobby.controls.find((c) => c.kind === "trainer" && c.index === 3).activate();
        await settle(lobby, 0);
        assert.deepEqual(shownTexts(kit.panel), ["万灵药", "照料"], where);
      } finally {
        lobby.dispose();
      }
    }
  } finally {
    setImageLoader(null);
    setUiPixelRatio(1);
  }
});

test("a mouse tip never outlasts the mouse: leaving, scrolling or keys hand the tip back to focus", async () => {
  installLobbyMocks();
  const lobby = new GpuLobby(
    fonts,
    new Texture(),
    { progress: emptyProgress(), rules: [], pick: pickOf("charmander", "shuoye") },
    lobbyCallbacks(),
  );
  try {
    lobby.resize(1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 });
    await settle(lobby);
    const kit = lobby.controls[lobby.index("kit")];
    const tileIndex = lobby.controls.findIndex((c) => c.kind === "tile");
    const tile = lobby.controls[tileIndex];
    const rest = async (panel) => {
      const b = box(lobby, panel);
      lobby.pointerMove(b.x, b.y);
      await settle(lobby, 0);
      assert.equal(lobby.tooltip.want, panel, "the hover tip shows");
    };

    await rest(kit.panel);
    lobby.pointerLeave();
    await settle(lobby, 0);
    assert.equal(lobby.tooltip.want, null, "leaving the canvas drops it");

    await rest(tile.panel);
    lobby.scroll(40);
    await settle(lobby, 0);
    assert.equal(lobby.tooltip.want, null, "the rows moved under it");

    await rest(kit.panel);
    lobby.setFocusVisible(true);
    lobby.focus(tileIndex);
    await settle(lobby, 0);
    assert.equal(lobby.tooltip.want, tile.panel, "keys or a pad show the focused control's tip");
  } finally {
    lobby.dispose();
    setImageLoader(null);
  }
});
