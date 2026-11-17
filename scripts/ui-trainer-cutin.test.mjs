import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Texture } from "three";
import { installResources } from "../src/platform/resources.ts";
import { webResources } from "../src/platform/web/resources.ts";

installResources(webResources);
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
const { UiStage } = await import("../src/ui/gpu/stage.ts");
const { GpuTrainerCutin } = await import("../src/ui/gpu/trainer-cutin.ts");
const { deployCall, ultimateCall } = await import("../src/run/trainer-cues.ts");
const { trainers, trainerOrder } = await import("../src/trainers.ts");
const { starters, lineForms } = await import("../src/run/sim/content/lines/index.ts");

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
const safe = { left: 0, right: 0, top: 0, bottom: 0 };

/** Every string a trainer band can draw: names, every line, every opening and teammate call. */
function cueStrings() {
  const strings = ["P1", "P2", "P3", "P4"];
  for (const id of trainerOrder) {
    const { name, lines, ultimate, clear, evolve, revive } = trainers[id];
    strings.push(name, ...lines, ultimate, clear, evolve, revive);
  }
  for (const line of Object.keys(starters)) {
    for (const form of lineForms(line)) strings.push(deployCall(form.name));
    for (let stage = 0; stage < starters[line].stages.length; stage++)
      strings.push(ultimateCall(line, stage));
  }
  return strings;
}

// The band draws with ui-800 on the HUD, whose preparation holds every core page: a string with a
// character outside core would fall to a base page loaded on demand and open with a gap.
test("every trainer band string is in the core UI font it draws with", () => {
  const glyphs = new Set(metrics.glyphs.map(([code]) => String.fromCodePoint(code)));
  const missing = new Set(
    cueStrings().flatMap((text) => Array.from(text).filter((c) => c.trim() && !glyphs.has(c))),
  );
  assert.deepEqual([...missing], [], "rerun bun run fonts:core");
});

/** A page source whose one page arrives when the test says so. */
function pagesLater() {
  let arrived = false,
    arrive;
  const result = new Promise((done) => (arrive = done));
  return {
    glyphs: {
      pagesFor: (text) => new Set(text ? ["ui-800/9"] : []),
      registry: {
        resident: (keys) => arrived || keys.length === 0,
        acquire: () => ({ result, release() {} }),
      },
    },
    arrive() {
      arrived = true;
      arrive();
    },
  };
}

function mount(glyphs) {
  const stage = new UiStage();
  stage.root.setProperties({ fontFamilies: { "Poketone UI": { 800: font } } });
  stage.resize(1280, 800, 1, safe);
  return { stage, cutin: new GpuTrainerCutin(stage, glyphs) };
}

const cue = {
  kind: "deploy",
  trainer: "yewei",
  text: deployCall("杰尼龟"),
  type: "water",
  seat: null,
  local: true,
};

test("a cue's strings are set only once their font pages are resident", async () => {
  const pages = pagesLater();
  const { stage, cutin } = mount(pages.glyphs);
  try {
    assert.equal(cutin.show(cue), true);
    cutin.frame({ bottom: 120, top: 100 });
    stage.update(16);
    assert.equal(cutin.showing, null, "nothing draws while a page is on its way");
    assert.equal(cutin.root.properties.peek().display, "none");
    pages.arrive();
    await new Promise((done) => setTimeout(done, 0));
    cutin.frame({ bottom: 120, top: 100 });
    assert.equal(cutin.showing?.text, cue.text);
    assert.equal(cutin.root.properties.peek().display, "flex");
    let line = null;
    cutin.root.traverse((o) => {
      if (o.constructor.name === "Text" && o.properties.peek().text === cue.text) line = o;
    });
    assert.ok(line, "the line is set on the band");
  } finally {
    cutin.dispose();
  }
});

test("a cue that outlives its time while pages load never plays late", async () => {
  const pages = pagesLater();
  const { cutin } = mount(pages.glyphs);
  try {
    // A teammate's ultimate already 900 of its 950 ms old when it reaches this screen.
    cutin.show({ ...cue, kind: "ultimate", local: false, seat: 2 }, 900);
    cutin.frame({ bottom: 120, top: 100 });
    await new Promise((done) => setTimeout(done, 80));
    pages.arrive();
    await new Promise((done) => setTimeout(done, 0));
    cutin.frame({ bottom: 120, top: 100 });
    assert.equal(cutin.showing, null);
  } finally {
    cutin.dispose();
  }
});

test("prepare settles only when the opening line's pages are resident", async () => {
  const pages = pagesLater();
  const { cutin } = mount(pages.glyphs);
  try {
    let ready = false;
    const prepared = cutin.prepare(cue).then(() => (ready = true));
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(ready, false);
    pages.arrive();
    await prepared;
    // Shown after preparation, it commits on its first frame.
    cutin.show(cue);
    cutin.frame({ bottom: 120, top: 100 });
    assert.equal(cutin.showing?.text, cue.text);
  } finally {
    cutin.dispose();
  }
});
