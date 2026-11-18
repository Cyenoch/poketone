import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Text, Image } from "@pmndrs/uikit";
import { Texture } from "three";
import { installResources } from "../src/platform/resources.ts";
import { webResources } from "../src/platform/web/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";
import { setUiPixelRatio } from "../src/ui/gpu/stage.ts";
import { fitScale } from "../src/ui/gpu/viewport.ts";

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
const { GpuRunHud } = await import("../src/ui/gpu/run-hud.ts");
const { formDefs } = await import("../src/run/sim/content/lines/index.ts");

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
const glyphs = {
  pagesFor: () => new Set(),
  registry: { resident: () => true, acquire: () => ({ result: Promise.resolve(), release() {} }) },
};
const callbacks = {
  pause() {},
  stats() {},
  interact() {},
  turn() {},
  dash() {},
  ultimate() {},
  assist() {},
};

function snapshot(form) {
  return {
    abilitySlot: 0,
    trainer: "chengxi",
    assistReady: 0,
    rules: [],
    stage: "forest",
    routeStep: 0,
    exit: null,
    time: 0,
    hp: 100,
    maxHp: 155,
    shield: 0,
    shieldMax: 0,
    level: 1,
    xp: 0,
    xpNext: 10,
    kills: 0,
    moves: [],
    items: [],
    dash: 1,
    dashes: 1,
    dashMax: 1,
    boss: null,
    pending: null,
    pendingCount: 0,
    rescueProgress: null,
    siteProgress: null,
    weather: null,
    cardLevel: 1,
    evolution: 0,
    rerolls: 0,
    skips: 0,
    banishes: 0,
    moveSlots: 4,
    itemSlots: 4,
    stardust: 0,
    ult: 0,
    casting: false,
    ultWindup: 0,
    ultProtection: 0,
    form,
    shiny: false,
    rampage: false,
    zone: { index: 0, count: 3, phase: "active", time: 0, finalSwarm: 300 },
    outcome: "playing",
    tmCase: false,
    dialog: null,
    prompt: null,
    team: [],
  };
}
/** A node's box (left, top, width, height) in stage units. */
function box(stage, node) {
  const [w, h] = node.size.value;
  const m = node.globalMatrix.value.elements;
  return { x: m[12] - stage.camera.left - w / 2, y: stage.camera.top - m[13] - h / 2, w, h };
}
const notchInsets = { left: 47, right: 47, top: 0, bottom: 21 };
/** A node's horizontal extent in stage units. */
function span(node) {
  const width = node.size.value[0];
  const centre = node.globalMatrix.value.elements[12];
  return [centre - width / 2, centre + width / 2];
}

// The run HUD's first line: the form's full name, then its type chips, inside the plate's straight
// part. A long name (mega forms) must never run under the chips at any phone size or UI scale.
test("the vitals name row keeps the full name clear of the type chips", async () => {
  const notch = { left: 47, right: 47, top: 0, bottom: 21 };
  const island = { left: 59, right: 59, top: 0, bottom: 21 };
  const none = { left: 0, right: 0, top: 0, bottom: 0 };
  const screens = [
    { width: 1280, height: 800, users: [1], insets: none },
    { width: 844, height: 390, users: [0.8, 1, 1.2], insets: notch },
    { width: 844, height: 390, users: [0.8, 1, 1.2], insets: none },
    { width: 760, height: 320, users: [0.8, 1, 1.2], insets: none },
    { width: 852, height: 393, users: [1], insets: island },
    { width: 932, height: 430, users: [1], insets: island },
    { width: 667, height: 375, users: [1], insets: none },
  ];
  // The host's scale for the run (app-host.ts `runLayout`): the user's, held back to fit the screen.
  const configs = screens.flatMap(({ users, ...screen }) =>
    users.map((user) => ({
      ...screen,
      user,
      scale: fitScale(user, screen.width, screen.height, screen.insets, {
        width: 667,
        height: 375,
      }),
    })),
  );
  for (const { width, height, user, scale, insets } of configs) {
    setUiPixelRatio(2);
    const hud = new GpuRunHud(fonts, "charmander", callbacks, glyphs);
    try {
      hud.resize(width, height, scale, insets);
      const compact = hud.stage.viewport.height <= 480;
      for (const [id, def] of Object.entries(formDefs)) {
        hud.update({
          snapshot: snapshot(id),
          theme: def.types[0],
          visible: true,
          blocked: false,
          notice: null,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (let frame = 0; frame < 6; frame++) {
          hud.stage.update(16);
          hud.afterLayout(16);
        }
        const where = `${id} at ${width}×${height} ×${user} (${scale})`;
        const row = span(hud.nameRow);
        const name = span(hud.formName.fill);
        const chips = span(hud.formTypes);
        assert.ok(name[1] <= chips[0] + 0.01, `${where}: the name runs under the type chips`);
        assert.ok(chips[1] <= row[1] + 0.01, `${where}: the type chips leave the plate`);
        const fontSize = hud.formName.fill.properties.value.fontSize;
        assert.ok(fontSize >= 12, `${where}: the name stays at 12px or more`);
        // The name is cut only once it is down to 12px and still does not fit beside the crests.
        const text = hud.formName.fill.properties.value.text;
        if (text !== def.name) {
          assert.equal(fontSize, 12, `${where}: cut before reaching 12px`);
          assert.ok(
            text.endsWith("…") && def.name.startsWith(text.slice(0, -1)),
            `${where}: cut to ${JSON.stringify(text)}`,
          );
        }
        let labels = 0,
          crests = 0;
        hud.formTypes.traverse((node) => {
          if (node instanceof Text && node.properties.value.text) labels++;
          if (node instanceof Image) crests++;
        });
        assert.equal(labels + crests, def.types.length, `${where}: one label or crest per type`);
        // The mega forms' Ｘ / Ｙ ending tells them apart: it shows on the smallest real phone.
        if (width === 667 && def.name.startsWith("超级"))
          assert.equal(text, def.name, `${where}: the mega name shows in full`);
        // A short single-type name keeps its chip's label and its size.
        if (id === "charmander") {
          assert.equal(labels, def.types.length, `${where}: a short name keeps the type labels`);
          assert.equal(fontSize, compact ? 14 : 16, `${where}: a short name keeps its size`);
        }
      }
    } finally {
      hud.dispose();
      setUiPixelRatio(1);
    }
  }
});

// The trainer's item (design: one size smaller beside the ultimate, greyed while it cools, the
// bottom-left kept free for the thumb): on a phone it must stay a touch target.
test("the trainer item key sits beside the ultimate, smaller, and greys while it cools", async () => {
  setUiPixelRatio(3);
  const hud = new GpuRunHud(fonts, "charmander", callbacks, glyphs);
  try {
    hud.setCoarsePointer(true);
    hud.resize(
      844,
      390,
      fitScale(1, 844, 390, notchInsets, { width: 667, height: 375 }),
      notchInsets,
    );
    const settle = async (snap) => {
      hud.update({ snapshot: snap, theme: "fire", visible: true, blocked: false, notice: null });
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (let frame = 0; frame < 6; frame++) {
        hud.stage.update(16);
        hud.afterLayout(16);
      }
    };
    const cooling = { ...snapshot("charmander"), time: 30, assistReady: 75 };
    await settle(cooling);
    const panel = (action) => hud.controls.find((control) => control.action === action).panel;
    const assist = box(hud.stage, panel("assist")),
      ult = box(hud.stage, panel("ultimate"));
    const min = hud.stage.viewport.minTarget;
    assert.ok(
      assist.w >= min - 0.5 && assist.h >= min - 0.5,
      `touch target: ${JSON.stringify(assist)}`,
    );
    assert.ok(assist.w < ult.w && assist.h < ult.h, "one size smaller than the ultimate");
    assert.ok(assist.x > hud.stage.viewport.width / 2, "on the right, clear of the bottom-left");
    assert.ok(Math.abs(assist.x + assist.w - ult.x) <= 24, "beside the ultimate");
    assert.equal(hud.assistArt.uniforms.artGray.value > 0, true, "greyed while cooling");
    assert.equal(hud.assistTime.root.isVisible.value, true);
    // Run time is summed tick by tick and can sit a hair either side of the grid: the HUD reads
    // the sim's ticks, so one tick left shows 1 and the ready tick shows the item ready.
    await settle({ ...cooling, time: 75 - 1 / 30 + 1e-9 });
    assert.equal(hud.assistTime.fill.properties.peek().text, "1");
    await settle({ ...cooling, time: 75 - 1e-9 });
    assert.equal(hud.assistArt.uniforms.artGray.value, 0, "full colour once ready");
    assert.equal(hud.assistTime.root.isVisible.value, false, "no 1 on a ready item");
  } finally {
    hud.dispose();
    setUiPixelRatio(1);
  }
});
