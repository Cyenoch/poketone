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
import { DEFAULT_TRAINER, trainerOrder } from "../src/trainers.ts";
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
            pick: {
              starter: "charmander",
              difficulty: 0,
              stage: "forest",
              trainer: DEFAULT_TRAINER,
            },
          },
          {
            pick: (p) => picked.push(p.starter),
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
            pick: {
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
            pick: {
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
