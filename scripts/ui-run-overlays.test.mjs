import { installResources } from "../src/platform/resources.ts";
import { webResources } from "../src/platform/web/resources.ts";
installResources(webResources);
import assert from "node:assert/strict";
import test from "node:test";

globalThis.document ??= {
  createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }),
};
// Art comes from the image store, bound to the renderer in the app; headless, a GPU that never
// uploads and images that never arrive will do (nothing below draws).
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

// The families the overlays name; their atlases never arrive here, and nothing below needs them.
const never = () => new Promise(() => {});
const fonts = {
  "Poketone UI": { 500: never, 700: never, 800: never },
  "Poketone Display": { 400: never },
};

const callbacks = {
  send() {},
  resume() {},
  closeStats() {},
  openSettings() {},
  retry() {},
  exit() {},
  pick() {},
  toggleBanish() {},
  keepItems: () => true,
  slotCenter: () => null,
};

// Pause → 放弃冒险 → result: the pause window retires (it fades out over the result) and the
// result is built fresh. Nothing of the pause's controls may carry over — its close key was index
// 0, which made the result's first backpack tile act as a close key.
test("a window built after a retiring one owns its own controls", async () => {
  const samples = runWindowSamples("charmander");
  const pause = samples.find((state) => state.kind === "pause");
  const result = samples.find((state) => state.kind === "result");
  const overlays = new GpuRunOverlays(fonts, callbacks);
  overlays.resize(1280, 800, 1, { top: 0, right: 0, bottom: 0, left: 0 });
  await new Promise((resolve) => setTimeout(resolve, 100)); // Yoga loads asynchronously
  overlays.update(pause);
  assert.equal(overlays.closeIndex, 0, "the pause window's close key comes first");
  overlays.update(result);
  assert.equal(overlays.closeIndex, -1, "the result window has no close key");
  overlays.dispose();
});

test("co-op choice Later and back dismiss without spending the pending choice", async () => {
  const { installRuntime } = await import("../src/platform/runtime.ts");
  installRuntime({ createAudioDecoder: () => ({}), activateAudio() {} });
  const state = {
    ...runWindowSamples("charmander").find((state) => state.kind === "choice"),
    dismissible: true,
  };
  const pending = structuredClone(state.pending);
  const sent = [];
  const picked = [];
  const overlays = new GpuRunOverlays(fonts, {
    ...callbacks,
    send: (command) => sent.push(command),
    pick: (...args) => picked.push(args),
  });
  try {
    overlays.update(state);
    overlays.navigate("last"); // Banish → Later.
    overlays.navigate("previous");
    overlays.navigate("confirm");
    assert.deepEqual(sent, [{ t: "choices", open: false }]);
    assert.deepEqual(state.pending, pending);
    assert.deepEqual(picked, []);
    overlays.navigate("cancel");
    assert.deepEqual(sent, [
      { t: "choices", open: false },
      { t: "choices", open: false },
    ]);
    assert.deepEqual(state.pending, pending);
    overlays.update({ ...state, dismissible: false });
    overlays.navigate("cancel");
    assert.equal(sent.length, 2, "solo choices cannot be dismissed");
  } finally {
    overlays.dispose();
  }
});

test("a failed result save can retry but cannot dismiss into a lost result", () => {
  let retried = 0;
  let left = false;
  const overlays = new GpuRunOverlays(fonts, {
    ...callbacks,
    retry: () => retried++,
    exit: () => (left = true),
  });
  try {
    overlays.update({ kind: "save-error", message: "记录保存失败。", theme: "fire" });
    overlays.navigate("cancel");
    assert.equal(left, false);
    overlays.navigate("first");
    overlays.navigate("confirm");
    assert.equal(retried, 1);
    assert.equal(left, false);
  } finally {
    overlays.dispose();
  }
});
