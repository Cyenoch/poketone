import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Texture } from "three";
import { installResources } from "../src/platform/resources.ts";
import { webResources } from "../src/platform/web/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";
import { setGlyphInputMode } from "../src/ui/gpu/input-glyph.ts";

installResources(webResources);
setGlyphInputMode({ kind: "keyboardMouse", pointer: false });
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
const { runWindowSamples } = await import("../src/ui/gpu/run-overlays-samples.ts");
const { abilities, abilityText } = await import("../src/run/sim/content/abilities.ts");

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
const sample = runWindowSamples("charmander").find((state) => state.kind === "choice");
const safe = { left: 0, right: 0, top: 0, bottom: 0 };
async function settle(view) {
  await new Promise((resolve) => setTimeout(resolve, 60));
  for (let i = 0; i < 40; i++) {
    view.stage.update(16);
    view.afterLayout(16);
  }
}
function box(stage, panel) {
  const [width, height] = panel.size.value;
  const m = panel.globalMatrix.value.elements;
  const scale = stage.viewport.scale;
  return {
    x: (m[12] - stage.camera.left - width / 2) * scale,
    y: (stage.camera.top - m[13] - height / 2) * scale,
    width: width * scale,
    height: height * scale,
  };
}

const ability = (slot, id) => ({ kind: "ability", slot, ability: id });
/** Abra's first evolution: a scaling ability against a fixed one. */
const abilityCard = (dismissible) => ({
  ...sample,
  theme: "psychic",
  dismissible,
  dealKey: `ability:${dismissible}`,
  pending: {
    id: 7,
    source: "ability",
    options: [ability(0, "synchronize"), ability(1, "inner-focus")],
  },
});
const key = (code) => ({ code, key: code, repeat: false, shift: false });
const text = (node) => node.properties.value.text.replace(/\s/g, "");

test("ability cards name the ability and show the reached stage's effect", async () => {
  for (const id of Object.keys(abilities)) {
    const overlays = new GpuRunOverlays(fonts, callbacks);
    try {
      overlays.resize(1280, 800, 1, safe);
      overlays.update({
        ...abilityCard(false),
        evolution: 1,
        dealKey: id,
        pending: { id: 1, source: "ability", options: [ability(0, id)] },
      });
      await settle(overlays);
      const [card] = overlays.content.cards;
      assert.equal(text(card.title), abilities[id].name);
      // The card shows the effect at the stage the player has reached.
      assert.equal(
        card.lines.map(text).join("；"),
        abilityText(abilities[id], 1).replace(/\s/g, ""),
        id,
      );
    } finally {
      overlays.dispose();
    }
  }
});

test("an ability pick offers no reroll, skip or banish, and only co-op can put it off", async () => {
  for (const [width, height, scale] of [
    [1280, 800, 1],
    [844, 390, 0.8],
  ])
    for (const dismissible of [false, true]) {
      const sent = [],
        picked = [];
      const overlays = new GpuRunOverlays(fonts, {
        ...callbacks,
        send: (command) => sent.push(command),
        pick: (...args) => picked.push(args),
      });
      try {
        overlays.resize(width, height, scale, safe);
        overlays.update(abilityCard(dismissible));
        await settle(overlays);
        assert.deepEqual(
          overlays.content.actions.map((action) => action.kind),
          dismissible ? ["defer"] : [],
        );
        for (const code of ["KeyR", "KeyX", "KeyZ"]) overlays.physicalKey(key(code));
        overlays.choiceAction("interact");
        overlays.navigate("cancel");
        assert.deepEqual(sent, dismissible ? [{ t: "choices", open: false }] : []);
        // Pointer and touch: each card is hit where it is drawn.
        const cards = overlays.content.cards.map((card) => box(overlays.stage, card.panel));
        assert.equal(cards.length, 2);
        for (const [i, b] of cards.entries()) {
          assert.ok(b.x >= 0 && b.x + b.width <= width && b.y >= 0 && b.y + b.height <= height);
          assert.equal(
            overlays.controls[overlays.hit(b.x + b.width / 2, b.y + b.height / 2)]?.card,
            i,
          );
        }
        // Gamepad: move to the second card and confirm it.
        overlays.navigate("first");
        overlays.navigate("right");
        overlays.navigate("confirm");
        await settle(overlays);
        assert.deepEqual(picked, [[1, false]]);
      } finally {
        overlays.dispose();
      }
    }
});
