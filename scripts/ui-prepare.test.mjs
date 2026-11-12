import { installResources } from "../src/platform/resources.ts";
import { webResources } from "../src/platform/web/resources.ts";
installResources(webResources);
import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_SLOTS, fetchAsset } from "../src/prepare/fetch.ts";
import { createPreparation, startWhenReady } from "../src/prepare/preparation.ts";

/** Every request the code under test makes, answered by hand. */
const calls = [];
globalThis.fetch = (url, { signal }) =>
  new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
    calls.push({
      url,
      signal,
      respond: (body = "bytes", status = 200) => resolve(new Response(body, { status })),
    });
  });

const flush = () => new Promise((resolve) => setImmediate(resolve));
const callsTo = (url) => calls.filter((call) => call.url === url);
const respond = async (url, body, status) => {
  const pending = callsTo(url).at(-1);
  assert.ok(pending, `${url} was requested`);
  pending.respond(body, status);
  await flush();
};
const fetchNeed = (url) => ({ key: url, acquire: (lane) => fetchAsset(url, { lane }) });

function fakeContext() {
  const listeners = new Set();
  const tasks = [];
  const context = {
    generation: 0,
    available: true,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enqueue: (task) => tasks.push(task),
    /** Runs one queued task to completion. */
    async step() {
      await tasks.shift()();
      await flush();
    },
    async drain() {
      while (tasks.length) await context.step();
    },
    tasks,
    lose() {
      context.available = false;
      context.generation++;
      for (const listener of listeners) listener();
    },
    restore() {
      context.available = true;
      for (const listener of listeners) listener();
    },
  };
  return context;
}

test("concurrent acquires of one URL share a single request and its bytes", async () => {
  const a = fetchAsset("/dedupe.bin", { lane: "interactive", size: 5 });
  const b = fetchAsset("/dedupe.bin", { lane: "background" });
  await flush();
  assert.equal(callsTo("/dedupe.bin").length, 1);
  await respond("/dedupe.bin", "12345");
  const [blobA, blobB] = await Promise.all([a.result, b.result]);
  assert.equal(blobA, blobB);
  assert.equal(await blobA.text(), "12345");
  assert.deepEqual(a.network, { bytes: 5, bytesTotal: 5, done: true });
  a.release();
  b.release();
});

test("a request runs at the highest lane among its waiters, and keep starts nothing", async () => {
  const fill = Array.from({ length: BACKGROUND_SLOTS }, (_, i) =>
    fetchAsset(`/lane-fill-${i}`, { lane: "background" }),
  );
  const queued = fetchAsset("/lane-queued", { lane: "background" });
  const next = fetchAsset("/lane-next", { lane: "background" });
  const kept = fetchAsset("/lane-kept", { lane: "keep" });
  await flush();
  assert.equal(callsTo("/lane-queued").length, 0, "background waits for a free slot");
  const urgent = fetchAsset("/lane-queued", { lane: "interactive" });
  await flush();
  assert.equal(callsTo("/lane-queued").length, 1, "an interactive waiter starts it past the cap");
  await respond("/lane-fill-0");
  assert.equal(callsTo("/lane-next").length, 1, "a freed slot starts the next queued request");
  for (let i = 1; i < BACKGROUND_SLOTS; i++) await respond(`/lane-fill-${i}`);
  assert.equal(callsTo("/lane-kept").length, 0, "keep never starts, even with free slots");
  kept.setLane("background");
  await flush();
  assert.equal(callsTo("/lane-kept").length, 1);
  await respond("/lane-queued");
  await respond("/lane-kept");
  await respond("/lane-next");
  for (const handle of [...fill, queued, next, urgent, kept]) handle.release();
});

test("releasing aborts the request only when its last waiter lets go", async () => {
  const a = fetchAsset("/release.bin", { lane: "interactive" });
  const b = fetchAsset("/release.bin", { lane: "interactive" });
  await flush();
  const [call] = callsTo("/release.bin");
  a.release();
  await assert.rejects(a.result, { name: "AbortError" });
  assert.equal(call.signal.aborted, false, "b still waits");
  b.release();
  assert.equal(call.signal.aborted, true);
  const c = fetchAsset("/release.bin", { lane: "interactive" });
  await flush();
  assert.equal(callsTo("/release.bin").length, 2, "an abandoned URL is fetched afresh");
  await respond("/release.bin", "ok");
  assert.equal(await (await c.result).text(), "ok");
  c.release();
});

test("a preparation always settles: ready, failed with the first error, or cancelled", async () => {
  const ready = createPreparation({
    revision: 1,
    lane: "critical",
    needs: [fetchNeed("/settle-ok")],
  });
  await respond("/settle-ok");
  assert.equal(await ready.settled, "ready");
  assert.equal(ready.progress().phase, "done");

  const failed = createPreparation({
    revision: 1,
    lane: "critical",
    needs: [fetchNeed("/settle-missing"), fetchNeed("/settle-slow")],
  });
  await respond("/settle-missing", "", 404);
  assert.equal(await failed.settled, "failed");
  assert.equal(failed.error.key, "/settle-missing");
  assert.equal(failed.error.phase, "network");
  assert.equal(
    callsTo("/settle-slow")[0].signal.aborted,
    false,
    "failure releases nothing the user may retry",
  );
  failed.retry();
  await flush();
  assert.equal(callsTo("/settle-missing").length, 2, "retry re-requests the failed need");
  assert.equal(callsTo("/settle-slow").length, 1, "retry keeps unfinished work");
  await respond("/settle-missing");
  await respond("/settle-slow");
  assert.equal(await failed.settled, "ready");

  const context = fakeContext();
  const cancelled = createPreparation({
    revision: 1,
    lane: "critical",
    context,
    needs: [fetchNeed("/settle-cancel"), { key: "warm", gpu: () => {} }],
  });
  context.lose();
  cancelled.cancel();
  assert.equal(await cancelled.settled, "cancelled");
  assert.equal(callsTo("/settle-cancel")[0].signal.aborted, true, "its only waiter is gone");
  for (const prep of [ready, failed]) prep.cancel();
});

test("one retry re-acquires every need that failed, not only the first", async () => {
  const urls = ["/multi-a", "/multi-b", "/multi-c"];
  const prep = createPreparation({ revision: 1, lane: "critical", needs: urls.map(fetchNeed) });
  for (const url of urls) await respond(url, "", 503);
  assert.equal(prep.state, "failed");
  assert.equal(prep.error.key, "/multi-a", "the first error is the one reported");
  prep.retry();
  await flush();
  for (const url of urls) assert.equal(callsTo(url).length, 2, `${url} is requested again`);
  for (const url of urls) await respond(url);
  assert.equal(await prep.settled, "ready");
  prep.cancel();
});

test("a context loss keeps CPU results and re-runs only the GPU phase in the new generation", async () => {
  const context = fakeContext();
  const uploads = [];
  const prep = createPreparation({
    revision: 1,
    lane: "critical",
    context,
    needs: [
      {
        ...fetchNeed("/loss.webp"),
        gpu: () => new Promise((resolve, reject) => uploads.push({ resolve, reject })),
      },
    ],
  });
  await flush();
  context.lose();
  await respond("/loss.webp");
  assert.equal(context.tasks.length, 0, "no GPU work while the context is unavailable");
  context.restore();
  const firstUpload = context.step();
  context.lose();
  context.restore();
  uploads[0].reject(new Error("CONTEXT_LOST_WEBGL"));
  await firstUpload;
  assert.equal(
    prep.state,
    "pending",
    "an upload from the lost generation can neither settle nor fail",
  );
  const secondUpload = context.step();
  uploads[1].resolve();
  await secondUpload;
  assert.equal(await prep.settled, "ready");
  assert.equal(uploads.length, 2);
  assert.equal(callsTo("/loss.webp").length, 1, "no refetch");
  prep.cancel();
});

test("a warm done before a loss runs again after the restore before the preparation is ready", async () => {
  const context = fakeContext();
  let warms = 0;
  const prep = createPreparation({
    revision: 1,
    lane: "critical",
    context,
    needs: [{ key: "warm", gpu: () => void warms++ }, fetchNeed("/loss-pending")],
  });
  await context.drain();
  context.lose();
  await respond("/loss-pending");
  assert.equal(prep.state, "pending", "never ready while the context is lost");
  context.restore();
  await context.drain();
  assert.equal(await prep.settled, "ready");
  assert.equal(warms, 2);
  prep.cancel();
});

test("a late completion can only settle the attempt that issued it", async () => {
  const context = fakeContext();
  const finishes = [];
  const prep = createPreparation({
    revision: 1,
    lane: "critical",
    context,
    needs: [
      { key: "warm", gpu: () => new Promise((resolve) => finishes.push(resolve)) },
      fetchNeed("/attempt-flaky"),
    ],
  });
  const firstWarm = context.step();
  await respond("/attempt-flaky", "", 500);
  assert.equal(prep.state, "failed");
  prep.retry();
  await respond("/attempt-flaky");
  finishes[0]();
  await firstWarm;
  assert.equal(prep.state, "pending", "the first attempt's warm can't settle the retry");
  const secondWarm = context.step();
  finishes[1]();
  await secondWarm;
  assert.equal(await prep.settled, "ready");
  prep.cancel();
});

test("only a ready preparation of the current revision starts anything", async () => {
  let current = "A";
  const started = [];
  const stale = createPreparation({
    revision: "A",
    lane: "critical",
    needs: [fetchNeed("/rev-a")],
  });
  startWhenReady(
    stale,
    () => current,
    () => started.push("A"),
  );
  current = "B";
  const fresh = createPreparation({
    revision: "B",
    lane: "critical",
    needs: [fetchNeed("/rev-b")],
  });
  startWhenReady(
    fresh,
    () => current,
    () => started.push("B"),
  );
  await respond("/rev-a");
  await respond("/rev-b");
  assert.deepEqual(started, ["B"]);
  stale.cancel();
  fresh.cancel();
});

test("A → B → depart(B) → cancel → A keeps the lobby's work and never starts a run", async () => {
  const prep = (url, lane) => createPreparation({ revision: url, lane, needs: [fetchNeed(url)] });
  // 1. Lobby on A: shared set and A's line in the background, A's display set interactive.
  const shared = prep("/walk-shared", "background");
  const lineA = createPreparation({
    revision: "A",
    lane: "background",
    needs: [fetchNeed("/walk-a-1"), fetchNeed("/walk-a-2")],
  });
  const displayA = prep("/walk-display-a", "interactive");
  await flush();
  assert.equal(callsTo("/walk-a-2").length, 0, "the background cap holds A's second file");

  // 2. Select B: A's line becomes the recent line (keep), its display set drops to background.
  const displayB = prep("/walk-display-b", "interactive");
  displayA.setLane("background");
  const lineB = prep("/walk-b", "background");
  lineA.setLane("keep");
  await flush();
  assert.equal(callsTo("/walk-b").length, 0, "both background slots are busy");

  // 3. 出发(B) captures B's revision; the run preparation holds its own handles at critical.
  let current = { starter: "B", n: 1 };
  const departed = current;
  let runs = 0;
  let worldDisposed = false;
  const run = createPreparation({
    revision: departed,
    lane: "critical",
    needs: [fetchNeed("/walk-shared"), fetchNeed("/walk-b")],
  });
  startWhenReady(
    run,
    () => current,
    () => runs++,
  );
  void run.settled.then((outcome) => outcome === "cancelled" && (worldDisposed = true));
  await flush();
  assert.equal(callsTo("/walk-b").length, 1, "critical starts B's line past the cap");
  assert.equal(callsTo("/walk-shared").length, 1, "the run shares the lobby's request");
  await respond("/walk-shared");
  await respond("/walk-a-1");
  assert.equal(callsTo("/walk-a-2").length, 0, "keep starts nothing, even with free slots");

  // 4. Cancel on the run loading screen.
  run.cancel();
  current = { starter: "B", n: 2 };
  assert.equal(await run.settled, "cancelled");
  await flush();
  assert.ok(worldDisposed);
  assert.equal(callsTo("/walk-b")[0].signal.aborted, false, "B's line is still held by the lobby");
  await respond("/walk-b");
  assert.equal(await lineB.settled, "ready", "the late completion lands where the lobby holds it");
  assert.equal(runs, 0, "and can't start a run");

  // 5. Back to A: its done work is reused, its unstarted work resumes.
  displayA.setLane("interactive");
  lineA.setLane("background");
  lineB.setLane("keep");
  await flush();
  assert.equal(callsTo("/walk-a-1").length, 1, "nothing refetched");
  assert.equal(callsTo("/walk-a-2").length, 1);
  await respond("/walk-a-2");
  await respond("/walk-display-a");
  await respond("/walk-display-b");
  assert.equal(await lineA.settled, "ready");
  assert.equal(await displayA.settled, "ready");
  for (const p of [shared, lineA, lineB, displayA, displayB]) p.cancel();
});
