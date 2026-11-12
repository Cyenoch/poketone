import assert from "node:assert/strict";
import { test } from "node:test";
import { soundStart, untilNextBeat } from "../src/audio/schedule.ts";
import { createAudio } from "../src/audio/engine.ts";
import { installResources } from "../src/platform/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";

test("a sound whose hit is later than the effect's key frame skips its lead-in instead of landing late", () => {
  // A sound that hits 405 ms in, cued on a key frame only 90 ms away.
  const { delay, offset } = soundStart(405, 90);
  assert.equal(delay, 0);
  assert.ok(Math.abs(offset - 0.315) < 1e-9);
});

test("a sound whose hit is earlier than the key frame waits so the hit still lands on it", () => {
  // The hit is 5 ms in and the victory sting waits out the 350 ms freeze.
  const { delay, offset } = soundStart(5, 350);
  assert.equal(offset, 0);
  assert.ok(Math.abs(delay - 0.345) < 1e-9);
});

test("an aligned sound plays from its start, right now", () => {
  assert.deepEqual(soundStart(0, 0), { delay: 0, offset: 0 });
});

test("a track switch waits for the next beat of the loop that is playing", () => {
  const beat = 60 / 124;
  assert.ok(Math.abs(untilNextBeat(beat * 3 + 0.1, beat) - (beat - 0.1)) < 1e-9);
  assert.equal(untilNextBeat(beat * 5, beat), 0);
});

test("cancelled music cannot silence or replace an immediate replay of the same track", async () => {
  const decodes = [];
  const started = [];
  const errors = [];
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const node = () => ({
    connect: (target) => target,
    disconnect() {},
    gain: { value: 1, setValueCurveAtTime() {}, setTargetAtTime() {} },
  });
  const context = {
    state: "running",
    currentTime: 0,
    destination: node(),
    createGain: node,
    createDynamicsCompressor: () => ({ ...node(), threshold: {}, ratio: {} }),
    createBufferSource: () => ({
      ...node(),
      start() {
        started.push(this.buffer);
      },
      stop() {},
    }),
    async close() {},
  };
  installRuntime({
    createAudioContext: () => context,
    createAudioDecoder: () => ({
      decodeAudioData: () => new Promise((resolve) => decodes.push(resolve)),
    }),
    activateAudio: (activate) => activate(),
  });
  installResources({
    read: async (url) =>
      url === "/audio/bank.json"
        ? Response.json({ music: { menu: { file: "menu.aac", bpm: 120 } } })
        : new Response("encoded music"),
  });
  const audio = createAudio();
  audio.onError((error) => errors.push(error));
  try {
    audio.music.play("menu");
    await flush();
    assert.equal(decodes.length, 1);
    audio.music.play(null);
    audio.music.play("menu");
    audio.music.play("menu");
    await flush();
    assert.equal(decodes.length, 2);
    const replay = { duration: 60 };
    decodes[1](replay);
    await flush();
    assert.deepEqual(started, [replay], "the new hold plays without another wish or gesture");
    decodes[0]({ duration: 30 });
    await flush();
    assert.deepEqual(started, [replay], "a late cancelled decode cannot start or replace music");

    audio.music.play(null);
    audio.music.play("menu");
    await flush();
    assert.equal(decodes.length, 3);
    audio.music.play(null);
    decodes[2]({ duration: 20 });
    await flush();
    assert.deepEqual(started, [replay], "cancellation without replay stays silent");
    assert.deepEqual(errors, []);
  } finally {
    await audio.dispose();
  }
});
