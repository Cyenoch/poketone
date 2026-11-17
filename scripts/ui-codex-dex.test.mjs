import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Texture } from "three";
import { Text } from "@pmndrs/uikit";
import { setImageLoader } from "@pmndrs/uikit/dist/components/image.js";
import { installResources } from "../src/platform/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";
import { bindImages } from "../src/prepare/images.ts";
import { codexSections } from "../src/run/codex.ts";
import { emptyProgress } from "../src/run/progress.ts";
import { GpuCodex } from "../src/ui/gpu/codex.ts";
import { setUiPixelRatio } from "../src/ui/gpu/stage.ts";

// Real Yoga, committed glyph metrics and the real 图鉴 input paths, without raster decoding or GPU
// uploads: the shiny model's colours themselves still need the formal App.
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

async function settle(codex) {
  // Yoga lays out off the first frames: give it a turn before stepping frames.
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (let frame = 0; frame < 32; frame++) {
    codex.stage.update(16);
    codex.afterLayout(16);
  }
}
const box = (codex, panel) => {
  const v = codex.stage.viewport;
  const m = panel.globalMatrix.value.elements;
  return {
    x: (m[12] - codex.stage.camera.left) * v.scale,
    y: (codex.stage.camera.top - m[13]) * v.scale,
  };
};
/** The page's texts in reading order. */
function pageTexts(codex) {
  const out = [];
  codex.detail.root.traverse((node) => {
    if (node instanceof Text) out.push(String(node.properties.value.text ?? "").replace(/\n/g, ""));
  });
  return out;
}
/** The record block's label / value pairs. */
function record(codex) {
  const texts = pageTexts(codex);
  const at = texts.indexOf("记录");
  assert.ok(at >= 0, `no 记录 on the page: ${texts.join(" ")}`);
  return Object.fromEntries([1, 3, 5].map((i) => [texts[at + i], texts[at + i + 1]]));
}
const looks = (codex) => codex.details.filter((control) => control.region === "look");
const shown = (codex) => codex.model.wanted ?? "";

async function open(codex, key) {
  const section = codexSections().findIndex((s) => s.id === "enemies");
  codex.activate(codex.controls.indexOf(codex.tabs[section]));
  codex.activate(codex.controls.indexOf(codex.entries.find((row) => row.key === key)));
  await settle(codex);
}

test("enemy pages show the player's record, and a defeated shiny can be viewed without saving anything", async () => {
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
  try {
    for (const { width, height, dpr, safe } of [
      { width: 1280, height: 800, dpr: 1, safe: { left: 0, right: 0, top: 0, bottom: 0 } },
      { width: 844, height: 390, dpr: 3, safe: { left: 47, right: 47, top: 0, bottom: 21 } },
    ]) {
      setUiPixelRatio(dpr);
      const progress = {
        ...emptyProgress(),
        // Heracross and Magikarp only appear in field events.
        dex: {
          heracross: { seen: 3, defeated: 2, shiny: 1 },
          magikarp: { seen: 5, defeated: 4, shiny: 0 },
        },
      };
      const before = structuredClone(progress);
      const codex = new GpuCodex(fonts, { progress, onClose() {} });
      try {
        codex.resize(width, height, 1, safe);
        await settle(codex);
        const where = `${width}×${height}`;

        await open(codex, "enemy:heracross");
        assert.deepEqual(record(codex), { 见过: "3", 击败: "2", 异色: "1" }, where);
        assert.equal(looks(codex).length, 2, `${where}: 普通 / 异色 offered`);
        assert.doesNotMatch(shown(codex), /#shiny/, `${where}: opens in its own colours`);

        // Keys / pad: row → stage → palette; ←→ pick like the section segments.
        codex.focus(codex.controls.indexOf(codex.entries.find((r) => r.key === "enemy:heracross")));
        codex.navigate("right");
        assert.equal(codex.controls[codex.focusIndex].region, "model");
        codex.navigate("down");
        assert.equal(codex.controls[codex.focusIndex], looks(codex)[0]);
        codex.navigate("right");
        assert.match(shown(codex), /#shiny:heracross$/, `${where}: → picks 异色`);
        assert.equal(codex.controls[codex.focusIndex], looks(codex)[1]);
        codex.navigate("left");
        assert.doesNotMatch(shown(codex), /#shiny/, `${where}: ← back to 普通`);
        codex.navigate("up");
        assert.equal(codex.controls[codex.focusIndex].region, "model", `${where}: ↑ to the stage`);

        // Pointer / touch: the 异色 segment is on screen and takes the press.
        const shinyFace = looks(codex)[1].panel;
        assert.equal(shinyFace.isClipped.value, false, `${where}: 异色 visible`);
        const at = box(codex, shinyFace);
        assert.equal(codex.hit(at.x, at.y), codex.controls.indexOf(looks(codex)[1]), where);
        codex.activate(codex.hit(at.x, at.y));
        assert.match(shown(codex), /#shiny:heracross$/, `${where}: click picks 异色`);

        // Another page starts in its own colours; no shiny record, no palette choice.
        await open(codex, "enemy:magikarp");
        assert.deepEqual(record(codex), { 见过: "5", 击败: "4", 异色: "0" }, where);
        assert.equal(looks(codex).length, 0, `${where}: no shiny defeated, no choice`);
        assert.doesNotMatch(shown(codex), /#shiny/);
        await open(codex, "enemy:munchlax");
        assert.deepEqual(record(codex), { 见过: "0", 击败: "0", 异色: "0" }, `${where}: unmet`);
        await open(codex, "enemy:heracross");
        assert.doesNotMatch(shown(codex), /#shiny/, `${where}: coming back starts normal`);

        assert.deepEqual(progress, before, `${where}: browsing never writes progress`);
      } finally {
        codex.dispose();
      }
    }
  } finally {
    for (const texture of textures) texture.dispose();
  }
});
