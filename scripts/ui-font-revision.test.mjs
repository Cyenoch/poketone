import { installResources } from "../src/platform/resources.ts";
import { webResources } from "../src/platform/web/resources.ts";
installResources(webResources);
import assert from "node:assert/strict";
import test from "node:test";
import { Texture } from "three";
import { PageRegistry, RevisionGate } from "../src/ui/gpu/fonts.ts";

// The font surface hold (readiness design §6a): a value commits only when every page it draws from
// is decoded and uploaded in the current context generation, and only the latest one commits.
// Real gate, registry and preparations; the GPU context and the page decoder are fakes.

function fakeGpu() {
  const listeners = new Set();
  const residents = new Set();
  const gpu = {
    generation: 0,
    available: true,
    queue: [],
    uploads: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enqueue(task) {
      gpu.queue.push(task);
    },
    upload(texture) {
      gpu.uploads.push(texture);
    },
    resident(resident) {
      residents.add(resident);
      return () => residents.delete(resident);
    },
    /** Runs queued GPU work (the frame loop's warm queue). */
    async flush() {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setImmediate(resolve));
        const tasks = gpu.queue.splice(0);
        for (const task of tasks) await task();
      }
    },
    lose() {
      gpu.available = false;
      gpu.generation++;
      gpu.queue.length = 0;
      for (const resident of residents) resident.release();
      for (const listener of listeners) listener();
    },
    restore() {
      for (const resident of residents) resident.restore?.();
      gpu.available = true;
      for (const listener of listeners) listener();
    },
  };
  return gpu;
}

/** A registry over pages a, b, c whose decodes the test completes by hand. */
function setup() {
  const gpu = fakeGpu();
  const decodes = new Map();
  const decodeCalls = [];
  const errors = [];
  const registry = new PageRegistry({
    gpu,
    report: (error) => errors.push(error),
    setImage(page, image) {
      page.texture.image = image;
    },
    decode(page, lane) {
      decodeCalls.push(page.key);
      let resolve, reject;
      const result = new Promise((res, rej) => ((resolve = res), (reject = rej)));
      const entry = { resolve, reject, lanes: [lane], released: false };
      decodes.set(page.key, entry);
      return {
        result,
        setLane: (next) => entry.lanes.push(next),
        release: () => (entry.released = true),
      };
    },
  });
  for (const [index, key] of ["a", "b", "c"].entries())
    registry.add({
      key,
      font: "ui-500",
      index,
      url: key,
      sha256: key,
      size: [1, 1],
      bytes: 1,
      set: key === "c" ? "base" : "core",
      texture: new Texture(),
      state: "absent",
      uploadedIn: null,
      lastUsed: 0,
    });
  const committed = [];
  const pagesOf = { A: ["a"], AB: ["a", "b"], C: ["c"] };
  const gate = new RevisionGate(registry, (value) => {
    // The invariant: whatever commits has every page resident right now.
    assert.ok(
      registry.resident(pagesOf[value]),
      `${value} committed before its pages were resident`,
    );
    committed.push(value);
  });
  const complete = async (key) => {
    decodes.get(key).resolve({ source: { width: 1, height: 1 }, release() {} });
    await gpu.flush();
  };
  return { gpu, registry, gate, committed, pagesOf, complete, decodeCalls, errors, decodes };
}

const orders = (items) =>
  items.length <= 1
    ? [items]
    : items.flatMap((item, i) =>
        orders([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
      );

test("A → A+B → C: only C commits, whatever order the pages arrive in", async () => {
  for (const order of orders(["a", "b", "c"])) {
    const { gate, committed, pagesOf, complete } = setup();
    for (const value of ["A", "AB", "C"]) gate.set(value, pagesOf[value]);
    for (const key of order) await complete(key);
    assert.deepEqual(committed, ["C"], `order ${order}`);
  }
});

test("A's page arriving never shows A+B: the label keeps A until B is resident too", async () => {
  const { gate, committed, pagesOf, complete } = setup();
  gate.set("A", pagesOf.A);
  await complete("a");
  assert.deepEqual(committed, ["A"]);
  gate.set("AB", pagesOf.AB);
  assert.deepEqual(committed, ["A"], "A+B must wait for b");
  await complete("b");
  assert.deepEqual(committed, ["A", "AB"]);
});

test("a resident set commits at once", async () => {
  const { gate, committed, pagesOf, complete } = setup();
  gate.set("A", pagesOf.A);
  await complete("a");
  gate.set("A", pagesOf.A);
  assert.deepEqual(committed, ["A", "A"]);
});

test("dispose mid-flight: nothing commits afterwards and the pending hold is released", async () => {
  const { gate, committed, pagesOf, complete, registry } = setup();
  gate.set("AB", pagesOf.AB);
  gate.dispose();
  await complete("a");
  await complete("b");
  assert.deepEqual(committed, []);
  gate.set("A", pagesOf.A);
  assert.deepEqual(committed, [], "a disposed gate takes no new revision");
  // Released before it finished, the decode was abandoned: a new acquire starts its own.
  const again = registry.acquire(["a"]);
  await complete("a");
  await again.result;
  again.release();
});

test("loss mid-flight: no commit until the restore uploads again, then the latest commits", async () => {
  const { gpu, gate, committed, pagesOf, complete } = setup();
  gate.set("AB", pagesOf.AB);
  await complete("a");
  gpu.lose();
  await complete("b");
  assert.deepEqual(committed, [], "decoded but not uploaded in the current generation");
  gpu.restore();
  await gpu.flush();
  assert.deepEqual(committed, ["AB"]);
});

test("a restore uploads every decoded page again, and loss leaves no page resident", async () => {
  const { gpu, registry, gate, pagesOf, complete } = setup();
  gate.set("AB", pagesOf.AB);
  await complete("a");
  await complete("b");
  const c = registry.acquire(["c"]);
  await complete("c");
  await c.result;
  gpu.uploads.length = 0;
  gpu.lose();
  assert.ok(!registry.resident(["a"]) && !registry.resident(["c"]));
  gpu.restore();
  await gpu.flush();
  const uploaded = new Set(gpu.uploads);
  for (const page of registry.pages.values()) assert.ok(uploaded.has(page.texture), page.key);
  assert.ok(registry.resident(["a", "b", "c"]));
  c.release();
});

test("concurrent acquires of one page share one decode", async () => {
  const { registry, complete, decodeCalls } = setup();
  const first = registry.acquire(["a", "b"]);
  const second = registry.acquire(["a"]);
  await complete("a");
  await complete("b");
  await Promise.all([first.result, second.result]);
  assert.deepEqual(new Set(decodeCalls), new Set(["a", "b"]));
  assert.equal(decodeCalls.length, 2);
  first.release();
  second.release();
});

test("a failed page is reported and commits nothing", async () => {
  const { gpu, gate, committed, pagesOf, errors, decodes } = setup();
  gate.set("A", pagesOf.A);
  decodes.get("a").reject(new Error("HTTP 404"));
  await gpu.flush();
  assert.deepEqual(committed, []);
  assert.deepEqual(
    errors.map((error) => error.message),
    ["HTTP 404"],
  );
});

test("a failed latest revision is reported to the gate's owner; an older one is not", async () => {
  const { gpu, registry, decodes } = setup();
  const failures = [];
  const gate = new RevisionGate(
    registry,
    () => {},
    (value, error) => failures.push([value, error.message]),
  );
  gate.set("A", ["a"]);
  gate.set("B", ["b"]);
  decodes.get("a").reject(new Error("old"));
  decodes.get("b").reject(new Error("HTTP 404"));
  await gpu.flush();
  assert.deepEqual(failures, [["B", "HTTP 404"]]);
});

test("a page decoded after its last holder left is closed, not kept", async () => {
  const { gpu, registry, decodes } = setup();
  const acquired = registry.acquire(["a"]);
  acquired.release();
  let closed = 0;
  decodes.get("a").resolve({ source: { width: 1, height: 1 }, release: () => closed++ });
  await gpu.flush();
  assert.equal(closed, 1);
  assert.equal(registry.pages.get("a").state, "absent");
});

test("a disposed registry releases its held pages and hears no more losses", async () => {
  const { gpu, registry, decodes } = setup();
  registry.hold(["a"], "background");
  registry.dispose();
  assert.equal(decodes.get("a").released, true, "the held, unfinished decode is abandoned");
  gpu.lose();
  gpu.restore();
  await gpu.flush();
  assert.deepEqual(gpu.uploads, []);
});

test("a raised lane reaches the page's download", () => {
  const { registry, decodes } = setup();
  registry.hold(["a"], "keep");
  const raised = registry.acquire(["a"], "critical");
  // Started at keep (nothing downloads); the critical waiter raises it.
  assert.equal(decodes.get("a").lanes[0], "keep");
  assert.equal(decodes.get("a").lanes.at(-1), "critical");
  raised.release();
});

// fonts.ready() through the real paged fonts (committed core and generated base metrics, read
// through a fetch stub): every waiter settles. A failed page rejects it (the 研究所 curtain must
// not stick), releasing the stage rejects it as aborted, and a metrics failure rejects it too.
async function pagedFonts({ failManifest = false, failPage = () => false } = {}) {
  const { readFileSync, existsSync } = await import("node:fs");
  await import("@pmndrs/uikit");
  const { Container, Text } = await import("@pmndrs/uikit");
  const { createPagedFonts } = await import("../src/ui/gpu/fonts.ts");
  const publicDir = new URL("../public/", import.meta.url);
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const { pathname } = new URL(input instanceof Request ? input.url : String(input));
    const file = new URL(`.${pathname}`, publicDir);
    if ((failManifest && pathname.endsWith("core/manifest.json")) || !existsSync(file))
      return new Response("missing", { status: 404 });
    return new Response(readFileSync(file));
  };
  const gpu = fakeGpu();
  const errors = [];
  const fonts = createPagedFonts(
    new URL("http://local/"),
    gpu,
    (error) => errors.push(error),
    (page) => ({
      result: failPage(page)
        ? Promise.reject(new Error(`HTTP 404 ${page.key}`))
        : Promise.resolve({ source: { width: page.size[0], height: page.size[1] }, release() {} }),
      setLane() {},
      release() {},
    }),
  );
  const root = new Container();
  root.add(new Text({ text: "研究所的道具", fontWeight: 800 }));
  const restore = () => (globalThis.fetch = original);
  return { fonts, gpu, errors, stage: { root }, restore };
}

test("ready() rejects when a page the stage needs fails", async () => {
  const { fonts, gpu, errors, stage, restore } = await pagedFonts({
    failPage: (page) => page.font === "ui-800" && page.index === 1,
  });
  try {
    const ready = fonts.ready(stage);
    const settled = ready.then(
      () => "ready",
      (error) => error.message,
    );
    await gpu.flush();
    assert.match(await settled, /HTTP 404 ui-800\/1/);
    assert.ok(errors.length > 0, "the failure is reported");
  } finally {
    restore();
  }
});

test("ready() rejects as aborted when its stage is released while it waits", async () => {
  const { fonts, stage, restore } = await pagedFonts({ failPage: () => false });
  try {
    await fonts.metrics;
    // Decoded but not uploaded: no GPU flush, so it is still waiting.
    const ready = fonts.ready(stage);
    await new Promise((resolve) => setImmediate(resolve));
    fonts.release(stage);
    await assert.rejects(ready, { name: "AbortError" });
  } finally {
    restore();
  }
});

test("ready() rejects when the font metrics cannot load", async () => {
  const { fonts, stage, errors, restore } = await pagedFonts({ failManifest: true });
  try {
    await assert.rejects(fonts.ready(stage), /UI 字体载入失败/);
    assert.ok(errors.length > 0);
  } finally {
    restore();
  }
});
