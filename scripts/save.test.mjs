import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeSave, encodeSave, SAVE_UNREADABLE } from "../src/run/save.ts";
import {
  emptyProgress,
  parseProgress,
  loadProgress,
  saveProgress,
  PROGRESS_STORAGE_KEY,
} from "../src/run/progress.ts";
import { webAppStorage } from "../src/platform/web/app-storage.ts";
import { defaultSettings, SETTINGS_STORAGE_KEY } from "../src/settings.ts";
import { labDefinitions } from "../src/run/sim/content/lab.ts";

// Synthetic player data in the real released format, NOT an actual player's export.
// Frozen once using encodeSave + its original dependencies from git 0910cc31 (outer v3 / progress v4).
const releasedText = readFileSync(
  new URL("./fixtures/save-v3-progress-v4.txt", import.meta.url),
  "utf8",
).trim();
const releasedRaw = atob(releasedText);
const releasedSave = JSON.parse(
  releasedRaw.slice(releasedRaw.indexOf(".") + 1, releasedRaw.lastIndexOf(".")),
);

// Only for adversarial payloads; successful old-version migration always uses the frozen fixture.
function corruptPayload(value, format = 3) {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 0x01000193);
  return btoa(`${format}.${json}.${(hash >>> 0).toString(16).padStart(8, "0")}`);
}

function withStorage(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    run(entries, storage);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
}

test("released nonempty v3/v4 fixture upgrades without losing any old data and exports only v4/v5", () => {
  const original = structuredClone(releasedSave);
  const upgraded = decodeSave(releasedText);
  assert.equal(upgraded.progress.version, 5);
  for (const [key, value] of Object.entries(original.progress))
    if (key !== "version") assert.deepEqual(upgraded.progress[key], value, key);
  for (const key of ["dex", "looks", "badges", "rules", "unlocks", "bonds", "tower", "seeds"])
    assert.deepEqual(upgraded.progress[key], emptyProgress()[key], key);
  assert.deepEqual(upgraded.settings, { ...defaultSettings, ...original.settings });
  assert.deepEqual(parseProgress(original.progress), upgraded.progress);
  assert.deepEqual(releasedSave, original, "upgrade never mutates its input");
  const exported = encodeSave(upgraded);
  assert.ok(atob(exported).startsWith("4."));
  assert.deepEqual(decodeSave(exported), upgraded);
  assert.throws(() => encodeSave(original), /版本不受支持/);
});

test("v4 validation rejects invalid old fields before upgrading and stays frozen when lab limits change", () => {
  const invalid = [
    { version: 3 },
    { version: 6 },
    { extra: 1 },
    { dex: {} },
    { runs: -1 },
    { runs: 2 ** 53 },
    { clears: [0, 0] },
    { clears: [0, 0, 0.1] },
    { kills: -1 },
    { research: 0.5 },
    { stardust: null },
    { best: { unknown: { difficulty: 0, victory: true, time: 1, kills: 1 } } },
    { best: { charmander: { difficulty: 3, victory: true, time: 1, kills: 1 } } },
    { best: { charmander: { difficulty: 0, victory: true, time: -1, kills: 1 } } },
    { best: { charmander: { difficulty: 0, victory: true, time: 1, kills: 1, extra: 1 } } },
    { lab: { "future-research": 1 } },
    { lab: { dmg: 9 } },
    { lab: { bag: 2 } },
    { lab: { "slot-vit": 5 } },
    { lab: [] },
    { archive: ["unknown-item"] },
    { archive: ["magnet", "magnet"] },
    { archive: ["magnet", "lucky-egg", "hp-up"] },
    { backpack: ["magnet", "lucky-egg", "hp-up", "scope-lens"] },
  ];
  for (const patch of invalid) {
    const bad = { ...releasedSave, progress: { ...releasedSave.progress, ...patch } };
    assert.throws(() => decodeSave(corruptPayload(bad)), undefined, JSON.stringify(patch));
  }
  for (const field of Object.keys(releasedSave.progress)) {
    const bad = structuredClone(releasedSave);
    delete bad.progress[field];
    assert.throws(() => decodeSave(corruptPayload(bad)), undefined, field);
  }
  const dmg = labDefinitions.find((entry) => entry.id === "dmg");
  const max = dmg.max;
  try {
    dmg.max = 99;
    assert.throws(() => parseProgress({ ...releasedSave.progress, lab: { dmg: 9 } }), /研究所等级/);
    dmg.max = 1;
    assert.equal(
      decodeSave(releasedText).progress.lab.dmg,
      3,
      "old valid levels survive later balancing",
    );
  } finally {
    dmg.max = max;
  }
});

test("v3 settings preserve both known shapes without accepting future setting fields", () => {
  // Synthetic data encoded by the unchanged v3 encoder at 88b6dfde, after its two new settings.
  const text = readFileSync(
    new URL("./fixtures/save-v3-progress-v4-settings5.txt", import.meta.url),
    "utf8",
  ).trim();
  const upgraded = decodeSave(text);
  assert.equal(upgraded.settings.pauseOnBlur, false);
  assert.equal(upgraded.settings.autoOpenCards, false);
  assert.equal(decodeSave(releasedText).settings.pauseOnBlur, true);
  const saved = { ...defaultSettings };
  try {
    defaultSettings.futureSetting = true;
    defaultSettings.pauseOnBlur = false;
    defaultSettings.autoOpenCards = false;
    assert.equal(decodeSave(releasedText).settings.pauseOnBlur, true);
    assert.equal(decodeSave(releasedText).settings.autoOpenCards, true);
    assert.throws(
      () =>
        decodeSave(
          corruptPayload({
            ...releasedSave,
            settings: { ...releasedSave.settings, futureSetting: true },
          }),
        ),
      /设置不受支持/,
    );
    assert.throws(
      () =>
        decodeSave(
          corruptPayload({
            ...releasedSave,
            settings: { ...releasedSave.settings, pauseOnBlur: 1 },
          }),
        ),
      /旧存档设置无效/,
    );
  } finally {
    delete defaultSettings.futureSetting;
    Object.assign(defaultSettings, saved);
  }
});

test("save envelope rejects mismatched versions, unknown fields, checksums and malformed JSON", () => {
  const current = decodeSave(releasedText);
  for (const format of [0, 1, 2, 5, 99])
    assert.throws(() => decodeSave(corruptPayload(releasedSave, format)), /版本不受支持/);
  assert.throws(() => decodeSave(corruptPayload(current, 3)), /进度版本不受支持/);
  assert.throws(() => decodeSave(corruptPayload(releasedSave, 4)), /进度版本不受支持/);
  assert.throws(() => decodeSave(corruptPayload({ ...releasedSave, extra: true })), /字段不受支持/);
  assert.throws(
    () =>
      decodeSave(
        corruptPayload({ ...releasedSave, settings: { ...releasedSave.settings, rumble: true } }),
      ),
    /设置不受支持/,
  );
  assert.throws(
    () => decodeSave(btoa(releasedRaw.replace('"stardust":2846', '"stardust":2845'))),
    /校验和不符/,
  );
  assert.throws(() => decodeSave(corruptPayload("{")), { message: SAVE_UNREADABLE });
  assert.throws(() => decodeSave("not a save"), /不是存档文本/);
});

function populatedProgress() {
  return {
    ...decodeSave(releasedText).progress,
    dex: { caterpie: { seen: 10, defeated: 7, shiny: 1 } },
    looks: { owned: ["charmander", "squirtle"], worn: ["squirtle"] },
    bonds: { charmander: 42 },
    tower: { squirtle: { floor: 14, difficulty: 2 } },
    seeds: [
      {
        code: "PT-EXAMPLE",
        starter: "charmander",
        trainer: "chengxi",
        result: "victory",
        time: 12.5,
        kills: 2,
      },
      {
        code: "PT-TOWER",
        starter: "squirtle",
        trainer: "yewei",
        result: "defeat",
        time: 21,
        kills: 4,
        floor: 0,
      },
    ],
  };
}

test("v5 new records survive export/import and malformed fields cannot be silently discarded", () => {
  const progress = populatedProgress();
  assert.deepEqual(
    decodeSave(encodeSave({ progress, settings: defaultSettings })).progress,
    progress,
  );
  const invalid = [
    { extra: true },
    { dex: { unknown: { seen: 1, defeated: 0, shiny: 0 } } },
    { dex: { caterpie: { seen: -1, defeated: 0, shiny: 0 } } },
    { dex: { caterpie: { seen: 1, defeated: 0 } } },
    { dex: { caterpie: { seen: 1, defeated: 0, shiny: 0, extra: 0 } } },
    { dex: { caterpie: { seen: 1, defeated: 2 ** 53, shiny: 0 } } },
    { looks: { owned: ["charmander", "charmander"], worn: [] } },
    { looks: { owned: [], worn: ["charmander"] } },
    { looks: { owned: ["unknown"], worn: [] } },
    { looks: { owned: ["charmander"], worn: ["charmander", "charmander"] } },
    { looks: { owned: [], worn: [], extra: 1 } },
    { badges: ["unknown"] },
    { badges: Array(9).fill("badge") },
    { rules: ["unknown"] },
    { unlocks: ["unknown"] },
    { bonds: { unknown: 1 } },
    { bonds: { charmander: 0.5 } },
    { tower: { unknown: { floor: 1, difficulty: 0 } } },
    { tower: { charmander: { floor: -1, difficulty: 0 } } },
    { tower: { charmander: { floor: 1, difficulty: 3 } } },
    { tower: { charmander: { floor: 1, difficulty: 0, extra: true } } },
    { seeds: Array(21).fill(progress.seeds[0]) },
    ...[
      { code: " " },
      { starter: "unknown" },
      { trainer: "unknown" },
      { result: "playing" },
      { time: -1 },
      { time: Infinity },
      { kills: 0.1 },
      { floor: -1 },
      { floor: undefined },
      { extra: true },
    ].map((patch) => ({ seeds: [{ ...progress.seeds[0], ...patch }] })),
  ];
  for (const patch of invalid)
    assert.throws(() => parseProgress({ ...progress, ...patch }), undefined, JSON.stringify(patch));
  for (const field of Object.keys(progress)) {
    const bad = { ...progress };
    delete bad[field];
    assert.throws(() => parseProgress(bad), undefined, field);
  }
  for (const number of [NaN, Infinity, -1, 0.1, 2 ** 53])
    assert.throws(() => parseProgress({ ...progress, bonds: { charmander: number } }));
});

test("Web migration retains v4 until a successful write and a failed complete import restores both old records", () =>
  withStorage((entries, storage) => {
    const old = JSON.stringify(releasedSave.progress);
    entries.set(PROGRESS_STORAGE_KEY, old);
    entries.set(SETTINGS_STORAGE_KEY, JSON.stringify(defaultSettings));
    const loaded = loadProgress();
    assert.equal(loaded.status, "ready");
    assert.equal(loaded.needsSave, true);
    assert.deepEqual(loaded.progress, decodeSave(releasedText).progress);
    assert.equal(entries.get(PROGRESS_STORAGE_KEY), old);
    const setItem = storage.setItem;
    storage.setItem = () => {
      throw new Error("quota");
    };
    assert.throws(() => saveProgress(loaded.progress), /quota/);
    assert.equal(entries.get(PROGRESS_STORAGE_KEY), old);
    assert.equal(loadProgress().needsSave, true);
    storage.setItem = (key, value) => {
      if (key === SETTINGS_STORAGE_KEY) throw new Error("settings quota");
      return setItem(key, value);
    };
    const before = new Map(entries);
    assert.throws(() => webAppStorage.save(decodeSave(releasedText)), /settings quota/);
    assert.deepEqual(entries, before);
    storage.setItem = setItem;
    webAppStorage.save(decodeSave(releasedText));
    assert.equal(loadProgress().needsSave, false);
    assert.equal(JSON.parse(entries.get(PROGRESS_STORAGE_KEY)).version, 5);
    assert.deepEqual(webAppStorage.load().settings, {
      ...defaultSettings,
      ...releasedSave.settings,
    });
  }));

test("Web locks rejected records without replacing them and refuses invalid writes before either key changes", () =>
  withStorage((entries) => {
    for (const record of [
      { ...releasedSave.progress, extra: true },
      { ...releasedSave.progress, version: 3 },
      { ...emptyProgress(), bonds: { unknown: 1 } },
    ]) {
      const raw = JSON.stringify(record);
      entries.set(PROGRESS_STORAGE_KEY, raw);
      assert.equal(loadProgress().status, "locked");
      assert.equal(entries.get(PROGRESS_STORAGE_KEY), raw);
    }
    const before = new Map(entries);
    assert.throws(() =>
      webAppStorage.save({
        progress: populatedProgress(),
        settings: { ...defaultSettings, rumble: true },
      }),
    );
    assert.throws(() =>
      webAppStorage.save({ progress: { ...emptyProgress(), runs: -1 }, settings: defaultSettings }),
    );
    assert.deepEqual(entries, before);
    entries.clear();
    assert.deepEqual(loadProgress(), {
      status: "ready",
      progress: emptyProgress(),
      needsSave: false,
    });
  }));
