import { installResources } from "../src/platform/resources.ts";
import { webResources } from "../src/platform/web/resources.ts";
installResources(webResources);
import assert from "node:assert/strict";
import test from "node:test";
import { createPreparation } from "../src/prepare/preparation.ts";
import { createImageStore } from "../src/prepare/images.ts";

// The image store (readiness design §5.3): one Source per URL, views that never re-upload it, a
// GPU upload once per context generation, release at zero holders. Fake GPU and decoder; the real
// upload count per Source is the browser harness's.

function fakeGpu() {
  const listeners = new Set();
  const residents = new Set();
  const gpu = {
    generation: 0,
    available: true,
    queue: [],
    uploads: [],
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    enqueue: (task) => gpu.queue.push(task),
    upload: (texture) => gpu.uploads.push(texture),
    resident: (resident) => (residents.add(resident), () => residents.delete(resident)),
    async flush() {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setImmediate(resolve));
        for (const task of gpu.queue.splice(0)) await task();
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

function setup() {
  const gpu = fakeGpu();
  const decodes = new Map();
  const closed = [];
  const released = [];
  const store = createImageStore(gpu, (url, lane) => {
    let resolve, reject;
    const result = new Promise((res, rej) => ((resolve = res), (reject = rej)));
    const entry = { resolve, reject, count: (decodes.get(url)?.count ?? 0) + 1, lanes: [lane] };
    decodes.set(url, entry);
    return { result, setLane: (next) => entry.lanes.push(next), release: () => released.push(url) };
  });
  const bitmap = (url) => ({ source: { width: 4, height: 4 }, release: () => closed.push(url) });
  const complete = async (url) => {
    decodes.get(url).resolve(bitmap(url));
    await gpu.flush();
  };
  return { gpu, store, decodes, closed, released, complete };
}

/** A surface's hold: the Source decoded and its base view uploaded in the current generation. */
async function prepare(gpu, store, url, complete) {
  const preparation = createPreparation({
    revision: 0,
    lane: "critical",
    needs: [store.need(url)],
    context: gpu,
  });
  if (complete) await complete(url);
  await gpu.flush();
  assert.equal(await preparation.settled, "ready");
  return preparation;
}

test("views share the Source and never bump its version", async () => {
  const { store, complete } = setup();
  const handle = store.acquire("/art/a.webp", "art");
  await complete("/art/a.webp");
  await handle.result;
  const entry = store.entries.get("art:/art/a.webp");
  const version = entry.source.version;
  const views = Array.from({ length: 10 }, () => handle.view());
  for (const view of views) {
    assert.equal(view.source, entry.source);
    assert.equal(view.wrapS, entry.base.wrapS);
    assert.equal(view.minFilter, entry.base.minFilter);
    assert.equal(view.colorSpace, entry.base.colorSpace);
    view.dispose();
  }
  assert.equal(entry.source.version, version, "a view must not re-upload the Source");
  handle.release();
});

test("ten close/reopen cycles upload the Source once while it stays held", async () => {
  const { gpu, store, complete } = setup();
  const held = store.acquire("/art/lobby.webp", "art", "background");
  for (let cycle = 0; cycle < 10; cycle++) {
    const preparation = await prepare(gpu, store, "/art/lobby.webp", cycle === 0 && complete);
    const view = store.acquire("/art/lobby.webp", "art");
    await view.result;
    view.view().dispose();
    view.release();
    preparation.cancel();
  }
  assert.equal(gpu.uploads.length, 1);
  held.release();
});

test("a restore uploads every decoded Source again, once", async () => {
  const { gpu, store, complete } = setup();
  const a = store.acquire("/art/a.webp", "art");
  const b = store.acquire("/art/b.webp", "pattern");
  await complete("/art/a.webp");
  await complete("/art/b.webp");
  const ready = await prepare(gpu, store, "/art/a.webp");
  gpu.uploads.length = 0;
  gpu.lose();
  for (const entry of store.entries.values()) assert.equal(entry.uploadedIn, null);
  gpu.restore();
  await gpu.flush();
  assert.equal(gpu.uploads.length, 2);
  for (const entry of store.entries.values()) assert.equal(entry.uploadedIn, gpu.generation);
  ready.cancel();
  a.release();
  b.release();
});

test("a Source is freed only when its last holder releases it", async () => {
  const { store, complete, closed } = setup();
  const first = store.acquire("/art/a.webp", "art");
  const second = store.acquire("/art/a.webp", "art");
  await complete("/art/a.webp");
  const entry = store.entries.get("art:/art/a.webp");
  let disposed = 0;
  entry.base.addEventListener("dispose", () => disposed++);
  first.release();
  assert.ok(store.entries.has("art:/art/a.webp"));
  assert.equal(disposed, 0);
  assert.deepEqual(closed, []);
  second.release();
  assert.ok(!store.entries.has("art:/art/a.webp"));
  assert.equal(disposed, 1);
  assert.deepEqual(closed, ["/art/a.webp"]);
});

test("an unfinished decode is abandoned at zero holders, and a late result is dropped", async () => {
  const { store, decodes, released, closed } = setup();
  const handle = store.acquire("/art/a.webp", "art");
  handle.release();
  assert.deepEqual(released, ["/art/a.webp"]);
  // The abandoned decode still finishes: its bitmap is closed, not stored.
  decodes
    .get("/art/a.webp")
    .resolve({ source: { width: 1, height: 1 }, release: () => closed.push("late") });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(closed, ["late"]);
  assert.ok(!store.entries.has("art:/art/a.webp"));
});

test("concurrent acquires of one URL and class share one decode; another class decodes its own", async () => {
  const { store, decodes } = setup();
  const a = store.acquire("/art/a.webp", "art");
  const b = store.acquire("/art/a.webp", "art");
  assert.equal(decodes.get("/art/a.webp").count, 1);
  const c = store.acquire("/art/a.webp", "pattern");
  assert.equal(decodes.get("/art/a.webp").count, 2);
  assert.equal(store.entries.size, 2);
  for (const handle of [a, b, c]) handle.release();
  assert.equal(store.entries.size, 0);
});

test("a retried image keeps its Source: views made before the failure bind to the retry", async () => {
  const { gpu, store, decodes } = setup();
  let loads = 0;
  const view = store.texture("/art/a.webp", "art", () => loads++);
  assert.equal(view.version, 0);
  const source = store.entries.get("art:/art/a.webp").source;
  decodes.get("/art/a.webp").reject(new Error("HTTP 503"));
  await gpu.flush();
  assert.equal(store.entries.get("art:/art/a.webp").state, "failed");
  // The next ask retries; the view from before the failure is still a view of the same Source.
  const again = store.texture("/art/a.webp", "art", () => loads++);
  assert.equal(decodes.get("/art/a.webp").count, 2);
  decodes.get("/art/a.webp").resolve({ source: { width: 4, height: 4 }, release() {} });
  await gpu.flush();
  const entry = store.entries.get("art:/art/a.webp");
  assert.equal(entry.source, source);
  assert.equal(view.source, source);
  assert.equal(view.version, 1, "the waiting view binds");
  assert.equal(again.version, 1);
  assert.equal(loads, 2);
  assert.ok(entry.source.data, "the Source has the retry's pixels");
});

test("releasing a failed attempt's hold never frees its retry", async () => {
  const { gpu, store, decodes, closed } = setup();
  const failed = store.acquire("/art/a.webp", "art");
  decodes.get("/art/a.webp").reject(new Error("HTTP 503"));
  await gpu.flush();
  const retry = store.acquire("/art/a.webp", "art");
  decodes
    .get("/art/a.webp")
    .resolve({ source: { width: 4, height: 4 }, release: () => closed.push("retry") });
  await retry.result;
  failed.release();
  assert.ok(store.entries.has("art:/art/a.webp"));
  assert.deepEqual(closed, []);
  retry.release();
  assert.deepEqual(closed, ["retry"]);
});

test("a raised lane reaches the image's download", () => {
  const { store, decodes } = setup();
  const kept = store.acquire("/art/a.webp", "art", "keep");
  const wanted = store.acquire("/art/a.webp", "art", "critical");
  assert.equal(decodes.get("/art/a.webp").lanes[0], "keep");
  assert.equal(decodes.get("/art/a.webp").lanes.at(-1), "critical");
  kept.release();
  wanted.release();
});

test("a failed or abandoned real decode leaves no unhandled rejection", async () => {
  const { decodeImage } = await import("../src/prepare/images.ts");
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("missing", { status: 404 });
  try {
    const failed = decodeImage("/art/missing.webp", "critical", () => {});
    await failed.result.catch(() => {});
    const abandoned = decodeImage("/art/abandoned.webp", "critical", () => {});
    abandoned.release();
    await abandoned.result.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    globalThis.fetch = original;
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a retry started by a surface hold keeps the page's image when that hold lets go", async () => {
  const { gpu, store, decodes, closed } = setup();
  const view = store.texture("/art/a.webp", "art", () => {});
  decodes.get("/art/a.webp").reject(new Error("HTTP 503"));
  await gpu.flush();
  // The surface hold retries it (its preparation's need), then settles and releases its hold.
  const uploaded = store.uploaded();
  decodes
    .get("/art/a.webp")
    .resolve({ source: { width: 4, height: 4 }, release: () => closed.push("retry") });
  await gpu.flush();
  await uploaded;
  const entry = store.entries.get("art:/art/a.webp");
  assert.ok(entry, "the page's own hold moved to the retry");
  assert.equal(entry.state, "decoded");
  assert.deepEqual(closed, []);
  assert.equal(view.source, entry.source);
  assert.equal(view.version, 1);
});
