import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { soundStart, untilNextBeat } from "../src/audio/schedule.ts";
import { createAudio, SFX_NAMES } from "../src/audio/engine.ts";
import { installResources } from "../src/platform/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";

test("every registered effect ships its selected masters and measured timing", () => {
  const source = new URL("../assets/audio/elevenlabs/", import.meta.url);
  const published = new URL("../public/audio/", import.meta.url);
  const json = (url) => JSON.parse(readFileSync(url, "utf8"));
  const manifest = json(new URL("manifest.json", source));
  const timing = json(new URL("master/timing.json", source));
  const bank = json(new URL("bank.json", published));
  const byName = (a, b) => a.localeCompare(b);
  assert.deepEqual(Object.keys(bank.sfx).sort(byName), [...SFX_NAMES].sort(byName));
  const files = [];
  for (const [id, asset] of Object.entries(manifest.assets)) {
    if (asset.kind !== "sfx" || !asset.ship) continue;
    const entry = bank.sfx[asset.ship];
    assert.ok(asset.pick.length > 0, `${id}: nothing selected`);
    assert.equal(entry.files.length, asset.pick.length, `${id}: published variant count`);
    assert.equal(entry.hitMs.length, asset.pick.length, `${id}: timing count`);
    for (const [i, raw] of asset.pick.entries()) {
      const take = asset.takes.find((candidate) => candidate.file === raw);
      assert.ok(take?.generationId, `${id}: missing generation provenance for ${raw}`);
      assert.ok(readFileSync(new URL(`raw/${raw}`, source)).length > 0);
      const master = `${id}${asset.pick.length > 1 ? `-${i + 1}` : ""}.flac`;
      assert.deepEqual(
        readFileSync(new URL(entry.files[i], published)),
        readFileSync(new URL(`master/${master}`, source)),
        `${id}: published audio differs from its master`,
      );
      assert.equal(entry.hitMs[i], timing[master].hitMs, `${id}: stale hit timing`);
      assert.ok(entry.hitMs[i] >= 0 && entry.hitMs[i] < timing[master].lenMs);
    }
    files.push(...entry.files);
  }
  assert.deepEqual(
    files.sort(byName),
    readdirSync(new URL("sfx/", published))
      .map((file) => `sfx/${file}`)
      .sort(byName),
    "published effects must all belong to the bank",
  );
});

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
