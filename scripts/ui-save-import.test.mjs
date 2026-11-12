import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeSave, encodeSave, SAVE_FORMAT, SAVE_UNREADABLE } from "../src/run/save.ts";
import { emptyProgress, PROGRESS_STORAGE_KEY, saveProgress } from "../src/run/progress.ts";
import { loadSettings, SETTINGS_STORAGE_KEY } from "../src/settings.ts";
import { webAppStorage } from "../src/platform/web/app-storage.ts";

function checkedText(json, version = SAVE_FORMAT) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 0x01000193);
  const raw = `${version}.${json}.${(hash >>> 0).toString(16).padStart(8, "0")}`;
  return Buffer.from(raw, "utf8").toString("base64");
}

// A save whose checksum matches but whose content is not JSON: the save dialog shows
// 「导入失败：<reason>」. The parser's own message would quote the content (emoji, lone surrogates),
// which the UI atlases cannot draw (a lone surrogate arrives as U+FFFD); the player must read a fixed, drawable reason instead.
test("a checksummed save with malformed JSON shows a fixed reason the UI atlases can draw", () => {
  const json = '{"progress":😀\uFFFD';
  const { error } = console;
  console.error = () => {};
  let shown;
  try {
    decodeSave(checkedText(json));
  } catch (cause) {
    shown = `导入失败：${cause.message}`;
  } finally {
    console.error = error;
  }
  assert.equal(shown, `导入失败：${SAVE_UNREADABLE}`);
  const fonts = new URL("../public/fonts/gpu/core/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", fonts), "utf8"));
  for (const name of ["ui-500", "ui-700", "ui-800"]) {
    const atlas = JSON.parse(readFileSync(new URL(manifest[name].json, fonts), "utf8"));
    const glyphs = new Set(atlas.glyphs.map(([code]) => String.fromCodePoint(code)));
    assert.deepEqual(
      Array.from(shown).filter((char) => !glyphs.has(char)),
      [],
      name,
    );
  }
});

test("Web whole-save import rolls progress back when settings write fails and reports rollback failure", async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const store = new Map([[PROGRESS_STORAGE_KEY, "previous"]]);
  let writes = 0,
    failRollback = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => store.get(key) ?? null,
      setItem(key, value) {
        writes++;
        if (writes === 2 || (failRollback && writes === 3)) throw new Error("disk full");
        store.set(key, value);
      },
      removeItem: (key) => store.delete(key),
    },
  });
  const save = {
    progress: emptyProgress(),
    settings: { sound: false, devMode: false, uiScale: 1 },
  };
  try {
    assert.throws(() => webAppStorage.save(save), /disk full/);
    assert.equal(store.get(PROGRESS_STORAGE_KEY), "previous");
    writes = 0;
    failRollback = true;
    assert.throws(() => webAppStorage.save(save), AggregateError);
  } finally {
    if (old) Object.defineProperty(globalThis, "localStorage", old);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("invalid and unsupported imports never commit; valid boundary values export and import again", () => {
  const save = {
    progress: {
      ...emptyProgress(),
      runs: 12,
      kills: 4000,
      research: 5000,
      stardust: 123,
      best: { charmander: { difficulty: 0, victory: true, time: 540.5, kills: 300 } },
    },
    settings: { sound: false, devMode: true, uiScale: 1.2 },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const store = new Map([
    [PROGRESS_STORAGE_KEY, JSON.stringify(save.progress)],
    [SETTINGS_STORAGE_KEY, JSON.stringify(save.settings)],
  ]);
  const before = new Map(store);
  let writes = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => store.get(key) ?? null,
      setItem(key, value) {
        writes++;
        store.set(key, value);
      },
      removeItem: (key) => store.delete(key),
    },
  });
  try {
    const invalid = [];
    const change = (mutate) => {
      const copy = structuredClone(save);
      mutate(copy);
      invalid.push(checkedText(JSON.stringify(copy)));
    };
    for (const time of [-1, null, "300"])
      change((copy) => (copy.progress.best.charmander.time = time));
    invalid.push(
      checkedText(JSON.stringify(save).replace('"time":540.5', '"time":1e309')),
      checkedText(JSON.stringify(save).replace('"time":540.5', '"time":-1e309')),
    );
    for (const count of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      for (const field of ["runs", "kills", "research", "stardust"])
        change((copy) => (copy.progress[field] = count));
      change((copy) => (copy.progress.clears[1] = count));
      change((copy) => (copy.progress.best.charmander.kills = count));
    }
    invalid.push(checkedText(JSON.stringify(save), 2));
    change((copy) => (copy.progress.version = 3));
    change((copy) => (copy.settings.rumble = true));
    change((copy) => (copy.settings.reducedMotion = false));
    change((copy) => (copy.settings = { sound: false, uiScale: 1 }));
    change((copy) => (copy.progress.best.charmander.score = 100));
    change((copy) => (copy.progress.best.unknown = copy.progress.best.charmander));
    change((copy) => (copy.progress.legacy = 1));
    change((copy) => (copy.legacy = 1));
    change((copy) => (copy.progress.best = null));
    change((copy) => (copy.progress.best.charmander = null));
    change((copy) => (copy.progress.lab = []));
    for (const text of invalid) {
      assert.throws(() => webAppStorage.save(decodeSave(text)));
      assert.equal(writes, 0);
      assert.deepEqual(store, before);
    }

    assert.throws(() => saveProgress({ ...save.progress, runs: 2 ** 53 }), /记录内容/);
    assert.deepEqual(store, before, "overflow cannot replace valid stored progress");

    for (const time of [0, 540.5, Number.MAX_VALUE]) {
      const next = structuredClone(save);
      next.progress.best.charmander.time = time;
      for (const field of ["runs", "kills", "research", "stardust"])
        next.progress[field] = Number.MAX_SAFE_INTEGER;
      next.progress.clears = [0, 1, Number.MAX_SAFE_INTEGER];
      next.progress.best.charmander.kills = Number.MAX_SAFE_INTEGER;
      const decoded = decodeSave(encodeSave(next));
      webAppStorage.save(decoded);
      const loaded = webAppStorage.load();
      assert.deepEqual(loaded.progress, { status: "ready", progress: next.progress });
      assert.deepEqual(loaded.settings, next.settings);
      assert.deepEqual(decodeSave(encodeSave(decoded)), next);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("unsupported stored settings use defaults with a warning and leave the original bytes intact", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const warn = console.warn;
  const warnings = [];
  const raw = '{"sound":false,"devMode":true,"uiScale":1.2,"rumble":true}';
  const store = new Map([[SETTINGS_STORAGE_KEY, raw]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    },
  });
  console.warn = (...args) => warnings.push(args);
  try {
    assert.deepEqual(loadSettings(), { sound: true, devMode: false, uiScale: 1 });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][1].message, /设置不受支持/);
    assert.equal(store.get(SETTINGS_STORAGE_KEY), raw);
  } finally {
    console.warn = warn;
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
