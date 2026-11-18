import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { soundStart, untilNextBeat } from "../src/audio/schedule.ts";
import {
  AMBIENCE_NAMES,
  createAudio,
  MENU_TRACKS,
  RUN_TRACKS,
  SFX_NAMES,
} from "../src/audio/engine.ts";
import { playFieldEvent, syncFieldAmbience } from "../src/audio/field-events.ts";
import { installResources } from "../src/platform/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";

test("every registered effect ships its selected masters and measured timing", () => {
  const source = new URL("../assets/audio/elevenlabs/", import.meta.url);
  const published = new URL("../public/audio/", import.meta.url);
  const json = (url) => JSON.parse(readFileSync(url, "utf8"));
  const manifest = json(new URL("manifest.json", source));
  const production = json(new URL("field-route-production.json", source));
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
      const measured = production.assets[id]?.masters[i];
      const publishedBytes = readFileSync(new URL(entry.files[i], published));
      if (production.assets[id]) {
        assert.equal(measured?.raw, raw, `${id}: published variant must match the QC pick`);
        assert.equal(createHash("sha256").update(publishedBytes).digest("hex"), measured.sha256);
      }
      assert.deepEqual(
        publishedBytes,
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

test("publishing selected audio preserves unrelated media and removes only replaced variants", () => {
  const root = mkdtempSync(join(tmpdir(), "poketone-audio-publish-"));
  const source = join(root, "assets/audio/elevenlabs");
  const target = join(root, "public/audio");
  const put = (file, value) =>
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  try {
    for (const dir of [
      "scripts",
      "assets/audio/elevenlabs/master",
      "public/audio/sfx",
      "public/audio/music",
    ])
      mkdirSync(join(root, dir), { recursive: true });
    copyFileSync(
      new URL("./audio-master.mjs", import.meta.url),
      join(root, "scripts/audio-master.mjs"),
    );
    put(join(source, "manifest.json"), {
      assets: {
        keep: { kind: "sfx", ship: "keep", pick: ["keep.raw"] },
        replace: { kind: "sfx", ship: "replace", pick: ["replace.raw"] },
        rain: { kind: "ambience", ship: "rain", pick: ["rain.raw"] },
      },
    });
    put(join(source, "master/timing.json"), { "replace.flac": { hitMs: 20, lenMs: 100 } });
    put(join(source, "master/replace.flac"), "new selected bytes");
    put(join(source, "master/rain.m4a"), "new ambience bytes");
    put(join(target, "sfx/keep.flac"), "untouched bytes");
    put(join(target, "sfx/replace-1.flac"), "old selected variant");
    put(join(target, "sfx/work-in-progress.flac"), "another producer's file");
    const keep = { files: ["sfx/keep.flac"], hitMs: [5] };
    const music = { old: { file: "music/old.m4a", bpm: 124 } };
    put(join(target, "bank.json"), {
      sfx: { keep, replace: { files: ["sfx/replace-1.flac"], hitMs: [0] } },
      music,
    });
    const run = spawnSync(
      process.execPath,
      [join(root, "scripts/audio-master.mjs"), "--publish", "replace", "rain"],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const bank = JSON.parse(readFileSync(join(target, "bank.json"), "utf8"));
    assert.deepEqual(bank.sfx.keep, keep);
    assert.deepEqual(bank.music, music);
    assert.equal(readFileSync(join(target, "sfx/keep.flac"), "utf8"), "untouched bytes");
    assert.equal(
      readFileSync(join(target, "sfx/work-in-progress.flac"), "utf8"),
      "another producer's file",
    );
    assert.equal(existsSync(join(target, "sfx/replace-1.flac")), false);
    assert.deepEqual(bank.sfx.replace, { files: ["sfx/replace.flac"], hitMs: [20] });
    assert.deepEqual(bank.ambience.rain, { file: "ambience/rain.m4a" });
    assert.equal(readFileSync(join(target, "ambience/rain.m4a"), "utf8"), "new ambience bytes");
    const before = readFileSync(join(target, "bank.json"), "utf8");
    const bad = spawnSync(
      process.execPath,
      [join(root, "scripts/audio-master.mjs"), "--publish", "unknown"],
      { encoding: "utf8" },
    );
    assert.notEqual(bad.status, 0);
    assert.equal(readFileSync(join(target, "bank.json"), "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("weather ambience bank references the measured masters by exact hash", () => {
  const source = new URL("../assets/audio/elevenlabs/", import.meta.url);
  const published = new URL("../public/audio/", import.meta.url);
  const json = (url) => JSON.parse(readFileSync(url, "utf8"));
  const manifest = json(new URL("manifest.json", source));
  const production = json(new URL("field-route-production.json", source));
  const bank = json(new URL("bank.json", published));
  const hash = (url) => createHash("sha256").update(readFileSync(url)).digest("hex");
  assert.deepEqual(Object.keys(bank.ambience).sort(), [...AMBIENCE_NAMES].sort());
  const files = [];
  for (const [id, asset] of Object.entries(manifest.assets)) {
    if (asset.kind !== "ambience" || !asset.ship) continue;
    const entry = bank.ambience[asset.ship];
    assert.ok(entry, `${id}: missing bank entry`);
    assert.equal(asset.pick.length, 1);
    const master = `${id}.m4a`;
    const measured = production.assets[id].masters.find((record) => record.file === master);
    assert.ok(measured?.sha256, `${id}: missing production hash`);
    assert.equal(hash(new URL(`master/${master}`, source)), measured.sha256);
    assert.equal(hash(new URL(entry.file, published)), measured.sha256);
    files.push(entry.file);
  }
  assert.deepEqual(
    files.sort((a, b) => a.localeCompare(b)),
    readdirSync(new URL("ambience/", published))
      .map((file) => `ambience/${file}`)
      .sort((a, b) => a.localeCompare(b)),
    "every published environment loop must be referenced, with no orphan media",
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
        ? Response.json({
            music: {
              menu: { file: "menu.aac", bpm: 120 },
              "menu-2": { file: "menu-2.aac", bpm: 120 },
            },
          })
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

const flushAudio = () => new Promise((resolve) => setImmediate(resolve));

/** A controlled host clock and decoder: assertions observe sources/connections, not engine state. */
function audioHost({ activate = true, bank } = {}) {
  const decodes = [];
  const sources = [];
  const nodes = [];
  const reads = [];
  let activation;
  let contexts = 0;
  const param = () => ({
    value: 1,
    curves: [],
    targets: [],
    setValueCurveAtTime(values, at, duration) {
      this.curves.push({ values: [...values], at, duration });
    },
    setTargetAtTime(value, at, duration) {
      this.targets.push({ value, at, duration });
    },
    cancelScheduledValues() {},
  });
  const node = () => {
    const result = {
      connections: [],
      gain: param(),
      connect(target) {
        this.connections.push(target);
        return target;
      },
      disconnect() {
        this.connections.length = 0;
      },
    };
    nodes.push(result);
    return result;
  };
  const context = {
    state: "running",
    currentTime: 0,
    destination: node(),
    createGain: node,
    createDynamicsCompressor: () => ({ ...node(), threshold: {}, ratio: {} }),
    createBufferSource: () => {
      const source = {
        ...node(),
        playbackRate: { value: 1 },
        stopAt: Infinity,
        ended: false,
        start(at = 0, offset = 0) {
          this.startAt = at;
          this.offset = offset;
        },
        stop(at = context.currentTime) {
          this.stopAt = at;
        },
      };
      sources.push(source);
      return source;
    },
    async suspend() {
      this.state = "suspended";
    },
    async resume() {
      this.state = "running";
    },
    async close() {
      this.state = "closed";
    },
  };
  installRuntime({
    createAudioContext: () => {
      contexts++;
      return context;
    },
    createAudioDecoder: () => ({
      decodeAudioData: () => new Promise((resolve, reject) => decodes.push({ resolve, reject })),
    }),
    activateAudio: (callback) => {
      activation = callback;
      if (activate) callback();
    },
  });
  installResources({
    read: async (url) => {
      reads.push(url);
      return url === "/audio/bank.json"
        ? Response.json(
            bank ?? {
              sfx: {},
              music: {},
              ambience: Object.fromEntries(
                AMBIENCE_NAMES.map((name) => [name, { file: `ambience/${name}.m4a` }]),
              ),
            },
          )
        : new Response("encoded audio");
    },
  });
  const audio = createAudio();
  return {
    audio,
    context,
    sources,
    decodes,
    nodes,
    reads,
    activate: () => activation(),
    contexts: () => contexts,
    finish(index, name = "decoded", duration = 8) {
      decodes[index].resolve({ name, duration });
    },
    advance(seconds) {
      if (context.state === "running") context.currentTime += seconds;
      for (const source of sources) {
        const end = source.loop
          ? source.stopAt
          : Math.min(
              source.stopAt,
              source.startAt + (source.buffer.duration - source.offset) / source.playbackRate.value,
            );
        if (!source.ended && end <= context.currentTime) {
          source.ended = true;
          source.onended?.();
        }
      }
    },
  };
}

test("ambience changes fade old sources and release every connection; repeated wishes do not restart", async () => {
  const h = audioHost();
  try {
    h.audio.ambience.play("sun");
    await flushAudio();
    h.finish(0, "sun");
    await flushAudio();
    assert.equal(h.sources.length, 1);
    const sun = h.sources[0];
    const fade = sun.connections[0];
    const out = fade.connections[0];
    assert.equal(sun.loop, true);
    assert.equal(fade.gain.curves[0].values[0], 0);
    assert.equal(fade.gain.curves[0].values.at(-1), 1);
    for (let i = 0; i < 60; i++) h.audio.ambience.play("sun");
    assert.equal(h.decodes.length, 1);
    assert.equal(h.sources.length, 1);
    h.audio.ambience.play("rain");
    assert.ok(sun.stopAt > h.context.currentTime);
    assert.equal(out.gain.curves[0].values[0], 1);
    await flushAudio();
    h.finish(1, "rain");
    await flushAudio();
    assert.equal(h.sources.length, 2);
    assert.equal(h.sources[1].buffer.name, "rain");
    h.advance(0.5);
    assert.equal(sun.connections.length, 0);
    assert.equal(fade.connections.length, 0);
    assert.equal(out.connections.length, 0);
    h.audio.ambience.play(null);
    h.advance(0.5);
    assert.ok(h.sources.every((source) => source.connections.length === 0));
    assert.equal(h.contexts(), 1);
  } finally {
    await h.audio.dispose();
  }
});

test("ambience pause, mute, end and dispose cancel pending work and never resurrect late loads", async () => {
  const h = audioHost();
  try {
    h.audio.ambience.play("rain");
    await flushAudio();
    h.audio.music.setPaused(true);
    h.audio.music.setPaused(false);
    await flushAudio();
    h.finish(1, "resumed rain");
    await flushAudio();
    h.finish(0, "cancelled rain");
    await flushAudio();
    assert.deepEqual(
      h.sources.map((source) => source.buffer.name),
      ["resumed rain"],
    );
    h.audio.music.setPaused(true);
    h.advance(0.5);
    assert.equal(h.sources[0].connections.length, 0);
    h.audio.music.setPaused(false);
    await flushAudio();
    h.finish(2, "paused replay");
    await flushAudio();
    h.audio.ambience.play("sandstorm");
    await flushAudio();
    // Mute during a crossfade must disconnect its retiring sources even with a frozen clock.
    h.audio.setEnabled(false);
    assert.equal(h.context.state, "suspended");
    assert.ok(h.sources.every((source) => source.connections.length === 0));
    h.finish(3, "muted pending sand");
    await flushAudio();
    assert.equal(h.sources.length, 2);
    h.audio.setEnabled(true);
    await flushAudio();
    h.finish(4, "enabled sand");
    await flushAudio();
    assert.equal(h.sources[2].buffer.name, "enabled sand");
    h.audio.ambience.play("hail");
    await flushAudio();
    h.audio.ambience.play(null);
    h.finish(5, "ended hail");
    await flushAudio();
    h.advance(0.5);
    assert.equal(h.sources.length, 3);
    assert.ok(h.sources.every((source) => source.connections.length === 0));
    h.audio.ambience.play("hail");
    await flushAudio();
    h.finish(6, "live hail");
    await flushAudio();
    h.audio.ambience.play("sun");
    await flushAudio();
    await h.audio.dispose();
    h.finish(7, "disposed sun");
    await flushAudio();
    h.audio.ambience.play("rain");
    h.audio.setEnabled(true);
    h.activate();
    assert.equal(h.context.state, "closed");
    assert.equal(h.sources.length, 4);
    assert.ok(h.sources.every((source) => source.connections.length === 0));
    assert.equal(h.contexts(), 1);
  } finally {
    await h.audio.dispose();
  }
});

test("ambience shares decoded holds, waits for activation, and frees the buffer on last release", async () => {
  const h = audioHost({ activate: false });
  const hold = h.audio.acquire(["ambience:sun"], "critical");
  try {
    h.audio.ambience.play("sun");
    await flushAudio();
    h.finish(0, "held sun");
    await hold.result;
    assert.equal(h.sources.length, 0);
    h.activate();
    await flushAudio();
    assert.equal(h.contexts(), 1);
    assert.equal(h.sources.length, 1);
    h.audio.ambience.play(null);
    h.audio.ambience.play("sun");
    await flushAudio();
    assert.equal(h.decodes.length, 1, "external holder keeps the decoded buffer through a stop");
    hold.release();
    h.audio.ambience.play(null);
    h.audio.ambience.play("sun");
    await flushAudio();
    assert.equal(h.decodes.length, 2, "last release frees the buffer");
    h.finish(1, "new hold");
    await flushAudio();
  } finally {
    hold.release();
    await h.audio.dispose();
  }
  assert.ok(h.sources.every((source) => source.connections.length === 0));
});

test("ambience failure reports its file once, stays silent until a new wish, and can retry", async () => {
  const h = audioHost();
  const errors = [];
  const originalError = console.error;
  console.error = () => {};
  h.audio.onError((error) => errors.push(error));
  try {
    h.audio.ambience.play("hail");
    await flushAudio();
    h.decodes[0].reject(new Error("invalid codec"));
    await flushAudio();
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /ambience\/hail.m4a/);
    for (let i = 0; i < 60; i++) h.audio.ambience.play("hail");
    await flushAudio();
    assert.equal(h.decodes.length, 1);
    assert.equal(h.sources.length, 0);
    h.audio.ambience.play(null);
    h.audio.ambience.play("hail");
    await flushAudio();
    h.finish(1, "recovered hail");
    await flushAudio();
    assert.equal(h.sources.length, 1);
  } finally {
    console.error = originalError;
    await h.audio.dispose();
  }
});

test("menu and run music each rotate through every track without repeating one in a row", async () => {
  const music = Object.fromEntries(
    [...MENU_TRACKS, ...RUN_TRACKS, "boss"].map((name) => [
      name,
      { file: `music/${name}.m4a`, bpm: 120 },
    ]),
  );
  const h = audioHost({ bank: { sfx: {}, music, ambience: {} } });
  const heard = [];
  /** Wishes, then decodes the track that wish fetched and checks that it is the one playing. */
  const play = async (wish, duration = 60) => {
    h.audio.music.play(wish);
    await flushAudio();
    const name = h.reads.at(-1).match(/music\/(.+)\.m4a$/)[1];
    h.finish(h.decodes.length - 1, name, duration);
    await flushAudio();
    assert.equal(h.sources.at(-1).buffer.name, name);
    heard.push(name);
  };
  try {
    for (let visit = 0; visit < RUN_TRACKS.length; visit++) {
      await play("menu");
      await play("run");
    }
    assert.deepEqual(heard, [
      "menu",
      "run-1",
      "menu-2",
      "run-2",
      "menu",
      "run-3",
      "menu-2",
      "run-4",
    ]);

    // A lobby left idle turns to the other menu track after one pass.
    await play("menu", 1);
    assert.equal(heard.at(-1), "menu");
    h.advance(1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await flushAudio();
    assert.ok(h.reads.at(-1).endsWith("music/menu-2.m4a"));
  } finally {
    await h.audio.dispose();
  }
});

/** Drives a music host: wishes, then settles the fetch it caused (decode `duration`, or fail). */
function musicRig(options) {
  const music = Object.fromEntries(
    [...MENU_TRACKS, ...RUN_TRACKS, "boss"].map((name) => [
      name,
      { file: `music/${name}.m4a`, bpm: 120 },
    ]),
  );
  const h = audioHost({ bank: { sfx: {}, music, ambience: {} }, ...options });
  const play = async (wish, { duration = 60, fail = false } = {}) => {
    const before = h.decodes.length;
    h.audio.music.play(wish);
    await flushAudio();
    if (h.decodes.length === before) return;
    const name = h.reads.at(-1).match(/music\/(.+)\.m4a$/)[1];
    if (fail) h.decodes.at(-1).reject(new Error(`${name} is corrupt`));
    else h.finish(h.decodes.length - 1, name, duration);
    await flushAudio();
  };
  /** Sources that would sound at the current time: still wired up and not yet stopped. */
  const audible = () =>
    h.sources.filter(
      (source) => source.connections.length > 0 && source.stopAt > h.context.currentTime,
    );
  return { h, play, audible };
}

test("a track that fails to load fades the previous screen out and the playlist's next entry plays", async () => {
  const { h, play, audible } = musicRig();
  h.audio.onError(() => {});
  try {
    await play("run", { duration: 120 });
    const run = h.sources.at(-1);
    await play("menu", { fail: true });
    h.finish(h.decodes.length - 1, "menu-2");
    await flushAudio();
    assert.notEqual(run.stopAt, Infinity, "the run track does not loop under the lobby");
    h.advance(2);
    assert.equal(h.sources.at(-1).buffer.name, "menu-2");
    assert.equal(audible().length, 1);
  } finally {
    await h.audio.dispose();
  }
});

test("screens switched while muted leave one track, which is the only one that plays on resume", async () => {
  const { h, play, audible } = musicRig();
  try {
    await play("run");
    await play("boss"); // the run track is now fading out under the boss track
    h.audio.setEnabled(false);
    await flushAudio();
    for (const wish of ["menu", "run", "menu", "run", "menu"]) await play(wish);
    h.audio.setEnabled(true);
    await flushAudio();
    h.advance(0.4);
    assert.deepEqual(
      audible().map((source) => source.buffer.name),
      [h.sources.at(-1).buffer.name],
    );
    assert.ok(h.sources.at(-1).buffer.name.startsWith("menu"));
  } finally {
    await h.audio.dispose();
  }
});

test("a context interrupted without a gesture is resumed by the next gesture, even one that plays no sound", async () => {
  const h = audioHost({ bank: { sfx: {}, music: {}, ambience: {} } });
  try {
    await flushAudio();
    h.context.state = "interrupted";
    h.context.onstatechange();
    h.activate();
    await flushAudio();
    assert.equal(h.context.state, "running");
  } finally {
    await h.audio.dispose();
  }
});

test("a playlist that fails entirely stays silent until a new request plays", async () => {
  const { h, play, audible } = musicRig();
  h.audio.onError(() => {});
  try {
    await play("menu", { fail: true });
    h.decodes.at(-1).reject(new Error("menu-2 is corrupt")); // the playlist's other entry
    await flushAudio();
    h.audio.music.play("menu"); // the same wish repeated does not refetch
    await flushAudio();
    assert.equal(h.decodes.length, 2);
    assert.equal(audible().length, 0);
    await play("run");
    assert.deepEqual(
      audible().map((source) => source.buffer.name),
      ["run-1"],
    );
  } finally {
    await h.audio.dispose();
  }
});

test("a boss switch cancelled as the pass ends leaves the run track rotating", async () => {
  const { h, play } = musicRig();
  try {
    await play("run", { duration: 1 });
    h.advance(1);
    h.audio.music.play("boss");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await play("run", { duration: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flushAudio();
    assert.ok(h.reads.at(-1).endsWith("music/run-2.m4a"));
  } finally {
    await h.audio.dispose();
  }
});

function fieldFixture() {
  const calls = [];
  const loops = [];
  const audio = {
    sfx: (name, options) => calls.push({ name, ...options }),
    ambience: { play: (name) => loops.push(name) },
  };
  const world = {
    stage: "coast",
    zone: { index: 0, phase: "active" },
    time: 10,
    paused: false,
    outcome: "playing",
    weather: null,
    players: [{ id: 0, x: 0, z: 0 }],
    sites: [],
  };
  return { audio, calls, loops, world };
}

test("field weather announces each occurrence once and loops only in [from, until)", () => {
  const { audio, calls, loops, world } = fieldFixture();
  world.weather = { id: "rain", from: 15, until: 90 };
  const forecast = { t: "weather", id: "rain", phase: "forecast" };
  playFieldEvent(audio, forecast, world, 0, 0);
  playFieldEvent(audio, { ...forecast }, world, 0, 0);
  syncFieldAmbience(audio, world, true);
  assert.deepEqual(loops, []);
  world.time = 15;
  playFieldEvent(audio, { ...forecast, phase: "start" }, world, 0, 0);
  for (let i = 0; i < 60; i++) syncFieldAmbience(audio, world, true);
  assert.deepEqual(
    calls.map((call) => call.name),
    ["weather-rain"],
  );
  assert.deepEqual(loops, ["rain"]);
  syncFieldAmbience(audio, world, false);
  syncFieldAmbience(audio, world, false);
  syncFieldAmbience(audio, world, true);
  assert.deepEqual(loops, ["rain", null, "rain"]);
  world.time = 90;
  syncFieldAmbience(audio, world, true);
  assert.equal(loops.at(-1), null);
  world.weather = { id: "rain", from: 100, until: 175 };
  world.time = 95;
  playFieldEvent(audio, forecast, world, 0, 85000);
  assert.equal(calls.length, 1, "old same-type forecast does not announce the next occurrence");
  world.time = 100;
  playFieldEvent(audio, { ...forecast, phase: "start" }, world, 0, 0);
  assert.equal(calls.length, 2, "start can announce when this forecast was not seen");
  syncFieldAmbience(audio, world, true);
  world.outcome = "victory";
  syncFieldAmbience(audio, world, true);
  assert.equal(loops.at(-1), null);
});

test("field cues follow actual site phases, local egg ownership and one shiny birth", () => {
  const { audio, calls, world } = fieldFixture();
  const event = (kind, phase, site = 1, player = 0) => ({
    t: "site",
    kind,
    phase,
    site,
    player,
    x: 0,
    z: 0,
  });
  const site = { id: 1, state: "busy", until: 10.8, data: { enemy: null, uses: 0, trap: true } };
  world.sites.push(site);
  for (const kind of ["honey-tree", "fishing", "fossil", "egg"])
    playFieldEvent(audio, event(kind, "start"), world, 0, 0);
  assert.equal(calls.length, 0);
  playFieldEvent(audio, event("fishing", "cancel"), world, 0, 0);
  site.data.uses = 1;
  playFieldEvent(audio, event("fishing", "reveal"), world, 0, 100);
  playFieldEvent(audio, event("fishing", "reveal"), world, 0, 100);
  assert.deepEqual(calls[0], { name: "site-fishing", keyMs: -100, maxMs: 700 });
  site.data.uses = 2;
  playFieldEvent(audio, event("fishing", "reveal"), world, 0, 0);
  playFieldEvent(audio, event("fossil", "reveal", 2), world, 0, 0);
  playFieldEvent(audio, event("fishing", "complete"), world, 0, 0);
  playFieldEvent(audio, event("fossil", "complete", 2), world, 0, 0);
  playFieldEvent(audio, event("egg", "complete", 3, 1), world, 0, 0);
  playFieldEvent(audio, event("egg", "complete", 3), world, 0, 0);
  playFieldEvent(audio, event("snorlax", "start"), world, 0, 0);
  const shiny = { t: "shiny", enemy: 50, species: "magikarp", x: 0, z: 0 };
  playFieldEvent(audio, shiny, world, 0, 0);
  playFieldEvent(audio, { ...shiny }, world, 0, 0);
  playFieldEvent(audio, { t: "shiny-caught", species: "magikarp", by: 0 }, world, 0, 0);
  assert.deepEqual(
    calls.map((call) => call.name),
    ["site-fishing", "site-fishing", "site-dig", "egg-hatch", "site-flute", "shiny"],
  );
});

test("Voltorb plays its two-pulse sample once within the warning; late and distant cues are discarded", () => {
  const { audio, calls, world } = fieldFixture();
  const event = { t: "site", site: 5, kind: "item-ball", phase: "start", x: 0, z: 0 };
  world.sites.push({ id: 5, state: "busy", until: 10.8, data: { trap: true, uses: 0 } });
  playFieldEvent(audio, event, world, 0, 0);
  playFieldEvent(audio, { ...event }, world, 0, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "tell-voltorb");
  assert.ok(calls[0].maxMs <= 800);
  world.time = 10.8;
  playFieldEvent(audio, event, world, 0, 800);
  playFieldEvent(audio, { ...event, site: 6, kind: "fishing", phase: "reveal" }, world, 0, 801);
  playFieldEvent(audio, { ...event, site: 7, kind: "fossil", phase: "reveal", x: 20 }, world, 0, 0);
  playFieldEvent(audio, { t: "shiny", enemy: 42 }, world, 0, 900);
  assert.equal(calls.length, 1);
});

test("field SFX skip measured lead-in, stop at the effect end, and stale samples create no source", async () => {
  const h = audioHost({
    bank: {
      music: {},
      sfx: {
        "tell-voltorb": { files: ["sfx/tell-voltorb.flac"], hitMs: [25] },
        "site-fishing": { files: ["sfx/site-fishing.flac"], hitMs: [336] },
      },
    },
  });
  const hold = h.audio.acquire(["tell-voltorb", "site-fishing"]);
  try {
    await flushAudio();
    h.finish(0, "voltorb", 0.35);
    h.finish(1, "fishing", 0.476);
    await hold.result;
    h.audio.sfx("tell-voltorb", { keyMs: 0, maxMs: 800 });
    h.audio.sfx("tell-voltorb", { keyMs: 0, maxMs: 800 });
    assert.equal(
      h.sources.length,
      1,
      "same-batch warning respects cooldown without a generic fallback",
    );
    assert.equal(h.sources[0].offset, 0.025);
    assert.equal(h.sources[0].stopAt, 0.8);
    h.audio.sfx("site-fishing", { keyMs: -150, maxMs: 650 });
    assert.equal(h.sources.length, 1, "a take already over is not scheduled beyond its buffer");
    h.audio.sfx("site-fishing", { keyMs: 0, maxMs: 100 });
    assert.equal(
      h.sources.length,
      2,
      "a dropped stale take does not consume the live cue's cooldown",
    );
    assert.equal(h.sources[1].offset, 0.336);
    assert.equal(h.sources[1].stopAt, 0.1);
  } finally {
    hold.release();
    await h.audio.dispose();
  }
});

test("field decision cues survive a full voice cap while ordinary feedback yields", async () => {
  const names = ["hit", "crit", "site-fishing", "tell-voltorb"];
  const h = audioHost({
    bank: {
      music: {},
      sfx: Object.fromEntries(
        names.map((name) => [name, { files: [`sfx/${name}.flac`], hitMs: [0] }]),
      ),
    },
  });
  const hold = h.audio.acquire(names);
  try {
    await flushAudio();
    for (let i = 0; i < names.length; i++) h.finish(i, names[i], 2);
    await hold.result;
    h.audio.sfx("crit", { fallback: "hit", maxMs: 1000 });
    h.audio.sfx("crit", { fallback: "hit", maxMs: 1000 });
    h.audio.sfx("crit", { fallback: "hit", maxMs: 1000 });
    assert.equal(h.sources.length, 2, "a fallback inside its own cooldown drops without recursion");
    assert.equal(h.sources[1].stopAt, 1, "the fallback inherits the effect window");
    for (let i = 0; i < 12; i++) {
      h.advance(0.06);
      h.audio.sfx("hit");
    }
    assert.equal(h.sources.length, 14);
    h.audio.sfx("site-fishing");
    assert.equal(h.sources.length, 14, "ordinary site feedback yields");
    h.audio.sfx("tell-voltorb", { keyMs: 0, maxMs: 800 });
    h.audio.sfx("tell-voltorb", { keyMs: 0, maxMs: 800 });
    assert.equal(h.sources.length, 15, "one strong Voltorb cue is admitted even under load");
    assert.equal(h.sources.at(-1).buffer.name, "tell-voltorb");
  } finally {
    hold.release();
    await h.audio.dispose();
  }
});
