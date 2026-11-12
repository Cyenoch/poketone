import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Texture } from "three";
import { installResources } from "../src/platform/resources.ts";
import { webResources } from "../src/platform/web/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";
import { setGlyphInputMode } from "../src/ui/gpu/input-glyph.ts";
import { setUiPixelRatio } from "../src/ui/gpu/stage.ts";

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
const { GpuRunHud } = await import("../src/ui/gpu/run-hud.ts");
const { runWindowSamples } = await import("../src/ui/gpu/run-overlays-samples.ts");
const { items } = await import("../src/run/sim/content/items.ts");

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

test("co-op cards leave the center and touch corners open, with persistent 44px actions", async () => {
  const longItems = Object.entries(items)
    .sort((a, b) => b[1].desc.length - a[1].desc.length)
    .slice(0, 4);
  for (const { width, height, scale, touch, insets } of [
    { width: 667, height: 375, scale: 0.8, touch: true, insets: safe },
    {
      width: 844,
      height: 390,
      scale: 0.8,
      touch: true,
      insets: { left: 44, right: 44, top: 0, bottom: 21 },
    },
    { width: 1280, height: 800, scale: 1, touch: false, insets: safe },
    { width: 1280, height: 800, scale: 1.5, touch: false, insets: safe },
  ]) {
    setGlyphInputMode(touch ? { kind: "touch" } : { kind: "keyboardMouse", pointer: false });
    setUiPixelRatio(touch ? 2 : 1);
    const overlays = new GpuRunOverlays(fonts, callbacks);
    try {
      overlays.resize(width, height, scale, insets);
      overlays.setCoarsePointer(touch);
      overlays.update({
        ...sample,
        dismissible: true,
        pending: {
          ...sample.pending,
          options: longItems.map(([item]) => ({ kind: "item", item })),
        },
      });
      await settle(overlays);
      assert.equal(overlays.isModal, false);
      assert.equal(overlays.dimMaterial.opacity, 0);
      assert.equal(overlays.hit(width / 2, height / 2), -1);
      assert.equal(overlays.hit(60, height - 50), -1);
      assert.equal(overlays.hit(width - 60, height - 50), -1);
      const frame = box(overlays.stage, overlays.frame);
      for (const card of overlays.content.cards) {
        const panel = box(overlays.stage, card.panel);
        const kind = box(overlays.stage, card.kind);
        const rarity = box(overlays.stage, card.tagRow);
        assert.ok(kind.x < panel.x + panel.width / 2, "type stays in the left corner");
        assert.ok(
          rarity.x + rarity.width > panel.x + panel.width / 2,
          "rarity stays in the right corner",
        );
        assert.ok(kind.x + kind.width <= rarity.x + 1, "the two corner labels do not overlap");
      }
      assert.ok(
        box(overlays.stage, overlays.body).y > height / 2,
        `candidate cards stay below combat center at ${width}/${scale}`,
      );
      assert.equal(
        overlays.content.actions.some((action) => action.kind === "skip"),
        false,
      );
      assert.equal(
        overlays.content.actions.some((action) => action.kind === "banish"),
        true,
        "unlocked banish remains available in co-op",
      );
      const actions = overlays.controls.filter((control) => control.card === undefined);
      for (const control of actions) {
        const action = box(overlays.stage, control.panel);
        assert.ok(action.width >= 43.9 && action.height >= 43.9, "actions retain touch targets");
        assert.ok(
          action.x >= frame.x - 1 && action.x + action.width <= frame.x + frame.width + 1,
          JSON.stringify({ width, scale, action, frame }),
        );
        assert.ok(action.y + action.height <= height - insets.bottom + 1);
        assert.ok(action.y + action.height <= box(overlays.stage, overlays.body).y + 1);
        assert.equal(
          overlays.hit(action.x + action.width / 2, action.y + action.height / 2),
          overlays.controls.indexOf(control),
        );
      }
      for (const card of overlays.content.cards)
        assert.equal(
          card.lines.map((line) => line.properties.value.text.replace(/\s/g, "")).join(""),
          card.copy.lines.join("").replace(/\s/g, ""),
          "long effects remain complete in the scrollable card row",
        );
      if ((overlays.body.maxScrollPosition.value[1] ?? 0) > 0) {
        overlays.navigate("first");
        overlays.navigate("down");
        assert.ok(overlays.body.scrollPosition.value[1] > 0, "the D-pad can read long effects");
        overlays.navigate("up");
        assert.equal(overlays.body.scrollPosition.value[1], 0);
      }
    } finally {
      overlays.dispose();
      setUiPixelRatio(1);
    }
  }
  setGlyphInputMode({ kind: "keyboardMouse", pointer: false });
});

test("dock keys keep combat bindings and reuse reroll, defer, pick guard and single-pick behavior", async () => {
  const sent = [],
    picked = [];
  const overlays = new GpuRunOverlays(fonts, {
    ...callbacks,
    send: (command) => sent.push(command),
    pick: (...args) => picked.push(args),
  });
  const key = (code, repeat = false) => ({ code, key: code, repeat, shift: false });
  try {
    overlays.resize(1280, 800, 1, safe);
    overlays.update({ ...sample, dismissible: true });
    assert.equal(overlays.choiceKey(key("Digit1")), true);
    assert.deepEqual(picked, [], "the opening press cannot accidentally select");
    for (const code of [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "KeyQ",
      "KeyE",
      "KeyF",
      "Space",
      "ArrowLeft",
    ])
      assert.equal(overlays.choiceKey(key(code)), false, `${code} stays with gameplay`);
    await settle(overlays);
    overlays.choiceKey(key("KeyR"));
    overlays.choiceKey(key("KeyR", true));
    assert.deepEqual(sent, [{ t: "reroll", card: sample.pending.id }]);
    overlays.choiceAction("interact");
    assert.deepEqual(sent.at(-1), { t: "reroll", card: sample.pending.id });
    for (const action of ["dash", "ult", "stats", "map"])
      assert.equal(overlays.choiceAction(action), false);
    overlays.choiceKey(key("Escape"));
    assert.deepEqual(sent.at(-1), { t: "choices", open: false });
    overlays.choiceKey(key("Digit1"));
    overlays.choiceKey(key("Digit2"));
    assert.equal(overlays.hit(640, 400), -1, "the center remains gameplay during the pick flight");
    await settle(overlays);
    assert.deepEqual(picked, [[0, false]]);
    overlays.update(null);
    const sentAfterClose = sent.length;
    assert.equal(overlays.choiceAction("interact"), true);
    assert.equal(
      sent.length,
      sentAfterClose,
      "a second button from the old frame cannot reopen choices",
    );
    overlays.update(sample);
    assert.equal(overlays.isModal, true, "solo retains its modal");
    assert.equal(overlays.choiceOpen, false);
  } finally {
    overlays.dispose();
  }
});

test("opening co-op cards keeps a held touch turn and the skill controls available", async () => {
  const turns = [],
    skills = [];
  const hud = new GpuRunHud(fonts, "charmander", {
    pause() {},
    stats() {},
    interact() {},
    turn: (direction) => turns.push(direction),
    dash: () => skills.push("dash"),
    ultimate: () => skills.push("ultimate"),
  });
  try {
    hud.setCoarsePointer(true);
    hud.resize(844, 390, 0.8, safe);
    const state = {
      snapshot: null,
      theme: "fire",
      visible: true,
      blocked: false,
      notice: null,
    };
    hud.update(state);
    await settle(hud);
    const press = (action, id) => {
      const panel = hud.controls.find((control) => control.action === action).panel;
      const b = box(hud.stage, panel);
      assert.equal(hud.down(id, b.x + b.width / 2, b.y + b.height / 2), true);
    };
    press("right", 1);
    assert.deepEqual(turns, [1]);
    hud.setChoiceOpen(true);
    hud.update(state);
    assert.equal(hud.inputBlocked, false);
    assert.deepEqual(turns, [1], "opening choices must not release the held right control");
    press("dash", 2);
    press("ultimate", 3);
    assert.deepEqual(skills, ["dash", "ultimate"]);
    hud.setChoiceOpen(false);
    hud.update(state);
    assert.deepEqual(turns, [1], "closing choices must not release the turn either");
  } finally {
    hud.dispose();
  }
});
