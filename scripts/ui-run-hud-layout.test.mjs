import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Text } from "@pmndrs/uikit";
import { PerspectiveCamera, Texture, Vector3 } from "three";
import { UiStage, setUiPixelRatio } from "../src/ui/gpu/stage.ts";
import { RunHudInteract } from "../src/ui/gpu/run-hud-interact.ts";
import { GpuEdgeIndicators } from "../src/ui/gpu/run-edge-indicators.ts";
import { setGlyphInputMode } from "../src/ui/gpu/input-glyph.ts";
import { formOf } from "../src/run/sim/evolution.ts";

// Committed metrics exercise real Yoga/text layout without a browser or GPU upload.
const core = new URL("../public/fonts/gpu/core/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", core), "utf8"));
const paged = JSON.parse(readFileSync(new URL(manifest["ui-800"].json, core), "utf8"));
const font = {
  pages: [],
  pageTextures: paged.pages.map(() => new Texture()),
  pageSizes: paged.pageSizes,
  chars: paged.glyphs.map(([id, page, x, y, width, height, xoffset, yoffset, xadvance]) => ({
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
  info: { size: paged.size },
  common: { lineHeight: paged.lineHeight },
  distanceField: { distanceRange: paged.distanceRange },
  kernings: [],
};
function stageFor(width, height, scale, safe) {
  const stage = new UiStage();
  stage.resize(width, height, scale, safe);
  stage.root.setProperties({
    fontFamilies: { "Poketone UI": { 500: font, 800: font } },
    paddingLeft: Math.max(12, stage.viewport.safeArea.left),
    paddingRight: Math.max(12, stage.viewport.safeArea.right),
    paddingTop: 12,
    paddingBottom: Math.max(12, stage.viewport.safeArea.bottom),
  });
  return stage;
}
const settle = async (stage, update = () => {}) => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (let frame = 0; frame < 16; frame++) {
    update();
    stage.update(16);
  }
};
const safe = { left: 44, right: 44, top: 0, bottom: 21 };

test("touch interact prompts stay on one line and release keyboard space when input switches", async () => {
  setUiPixelRatio(3);
  const stage = stageFor(844, 390, 0.8, safe);
  const prompt = new RunHudInteract(stage);
  stage.root.add(prompt.row);
  prompt.place(90);
  try {
    for (const count of [1, 12]) {
      const widths = [];
      for (const touch of [false, true, false]) {
        setGlyphInputMode(touch ? { kind: "touch" } : { kind: "keyboardMouse", pointer: false });
        prompt.setCoarsePointer(touch);
        prompt.set("choices", false, count, null, "前往第 2 区");
        await settle(stage);
        const texts = [];
        prompt.panel.traverse((node) => {
          if (node instanceof Text && node.properties.value.text === `选择构筑 · ${count}`)
            texts.push(node);
        });
        assert.equal(texts.length, 2, "caption and its shadow both use the same label");
        for (const text of texts)
          assert.equal(text.textLayout.value.lines.length, 1, "the count stays beside the caption");
        widths.push(prompt.panel.size.value[0]);
        const caption = texts.find((text) => text.properties.value.positionType !== "absolute");
        if (touch) {
          const center = caption.globalMatrix.value.elements[12];
          assert.ok(
            Math.abs(center - prompt.panel.globalMatrix.value.elements[12]) < 1 / stage.pixelGrid,
            "touch caption is centered without a reserved keycap column",
          );
        }
        const visibleR = [];
        prompt.panel.traverse((node) => {
          if (node instanceof Text && node.properties.value.text === "R" && node.displayed.value)
            visibleR.push(node);
        });
        assert.equal(visibleR.length, touch ? 0 : 1);
      }
      assert.ok(widths[1] < widths[0], "touch panel shrinks to its content");
      assert.equal(widths[2], widths[0], "desktop geometry returns after switching back");
    }
  } finally {
    prompt.dispose();
    stage.dispose();
    setGlyphInputMode({ kind: "keyboardMouse", pointer: false });
    setUiPixelRatio(1);
  }
});

test("player nameplates track world projection across safe areas and UI scales", async () => {
  const players = [-2, 0, 2].map((x, index) => ({
    id: index + 1,
    starter: "charmander",
    stage: 0,
    px: x - 0.5,
    x,
    pz: 0,
    z: 0,
    alive: true,
  }));
  const world = {
    players,
    enemies: [],
    map: { terrain: { origin: -10, resolution: 0.1, samples: 3, heights: new Float32Array(9) } },
  };
  for (const { width, height, scale, insets, dpr } of [
    {
      width: 1280,
      height: 800,
      scale: 1,
      insets: { left: 0, right: 0, top: 0, bottom: 0 },
      dpr: 1,
    },
    { width: 844, height: 390, scale: 0.8, insets: safe, dpr: 3 },
    { width: 844, height: 390, scale: 1.5, insets: { ...safe, right: 0 }, dpr: 2 },
  ]) {
    setUiPixelRatio(dpr);
    const stage = stageFor(width, height, scale, insets);
    const indicators = new GpuEdgeIndicators(stage, []);
    // Portrait loading is unrelated to the projection contract; these forms are already mounted.
    players.forEach((player, index) => {
      indicators.players[index].form = formOf(player).id;
    });
    const camera = new PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(0, 8, 12);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    try {
      for (const alpha of [0, 0.5, 1]) {
        await settle(stage, () => indicators.update(world, 1, camera, alpha, 0.016, true));
        players.forEach((player, slot) => {
          const head = new Vector3(
            player.px + (player.x - player.px) * alpha,
            formOf(player).height + 0.35,
            0,
          ).project(camera);
          const tag = indicators.names[slot];
          assert.ok(tag.displayed.value);
          const matrix = tag.globalMatrix.value.elements;
          const actualX = (matrix[12] - stage.camera.left) * scale;
          const actualBottom = (stage.camera.top - matrix[13] + tag.size.value[1] / 2) * scale;
          assert.ok(
            Math.abs(actualX - ((head.x + 1) * width) / 2) <= 1 / dpr,
            `P${slot + 1} horizontal projection at ${width}x${height}, scale ${scale}`,
          );
          assert.ok(
            Math.abs(actualBottom - ((1 - head.y) * height) / 2) <= 1 / dpr,
            `P${slot + 1} vertical projection at ${width}x${height}, scale ${scale}`,
          );
        });
      }
    } finally {
      indicators.dispose();
      stage.dispose();
      setUiPixelRatio(1);
    }
  }
});
