import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Text } from "@pmndrs/uikit";
import { Texture } from "three";
import { UiStage, setUiPixelRatio } from "../src/ui/gpu/stage.ts";
import { RunHudInteract } from "../src/ui/gpu/run-hud-interact.ts";
import { setGlyphInputMode } from "../src/ui/gpu/input-glyph.ts";

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
        prompt.set("choices", false, count, null, null);
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
