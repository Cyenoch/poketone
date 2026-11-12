import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeAppStorage } from "../src/platform/native/app-storage.ts";
import { nativeSavePath, readSave, writeSave, writeTextFile } from "../src/platform/native/save.ts";
import { decodeSave, encodeSave, SAVE_FORMAT } from "../src/run/save.ts";
import { validPick } from "../src/lobbyPick.ts";

test("native whole-save import commits progress and settings together and keeps disk/memory on write failure", () => {
  const directory = mkdtempSync(join(tmpdir(), "poketone-save-import-"));
  const path = join(directory, "save.txt");
  try {
    const before = readSave(path);
    writeSave(path, before);
    const storage = nativeAppStorage(path);
    const next = {
      progress: { ...before.progress, stardust: 123 },
      settings: { ...before.settings, sound: false, uiScale: 1.2 },
    };
    storage.save(next);
    assert.deepEqual(readSave(path), next);
    assert.deepEqual(storage.load().progress.progress, next.progress);
    assert.deepEqual(storage.load().settings, next.settings);
    mkdirSync(`${path}.tmp`);
    assert.throws(() => storage.save(before));
    assert.deepEqual(readSave(path), next);
    assert.deepEqual(storage.load().progress.progress, next.progress);
    assert.deepEqual(storage.load().settings, next.settings);
    const exported = join(directory, "chosen.txt");
    writeTextFile(exported, encodeSave(next));
    assert.equal(readFileSync(exported, "utf8"), encodeSave(next));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("native startup rejects legacy and unsupported saves without replacing their files", () => {
  const directory = mkdtempSync(join(tmpdir(), "poketone-save-version-"));
  try {
    const oldPath = join(directory, "save.txt");
    const save = readSave(oldPath);
    save.progress.stardust = 567;
    const old = btoa(atob(encodeSave(save)).replace(/^[^.]+/, "2"));
    writeTextFile(oldPath, old);
    const path = join(directory, `save.v${SAVE_FORMAT}.txt`);
    assert.throws(() => nativeSavePath(directory), /旧存档路径不受支持/);
    assert.equal(existsSync(path), false, "startup must not create a replacement save");
    assert.equal(readFileSync(oldPath, "utf8"), old);
    assert.throws(() => readSave(oldPath), /存档版本不受支持/);

    writeTextFile(path, old);
    assert.throws(() => nativeAppStorage(nativeSavePath(directory)), /存档版本不受支持/);
    assert.equal(readFileSync(path, "utf8"), old);
    assert.equal(existsSync(`${path}.tmp`), false);

    const next = { ...save, progress: { ...save.progress, stardust: 890 } };
    writeSave(path, next);
    assert.equal(nativeSavePath(directory), path);
    assert.deepEqual(readSave(path), next);
    assert.deepEqual(decodeSave(readFileSync(path, "utf8")), next);
    assert.equal(readFileSync(oldPath, "utf8"), old);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unreadable native pick falls back with a diagnostic while the progress file stays strict", () => {
  const directory = mkdtempSync(join(tmpdir(), "poketone-pick-"));
  const path = nativeSavePath(directory);
  const pickPath = `${path}.pick.json`;
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const save = readSave(path);
    save.progress.stardust = 567;
    writeSave(path, save);
    const original = readFileSync(path, "utf8");
    const storage = nativeAppStorage(path);
    assert.deepEqual(storage.load().pick, {});
    assert.equal(warnings.length, 0, "a missing preference is normal on first launch");

    mkdirSync(pickPath);
    const loaded = storage.load();
    assert.deepEqual(loaded.progress, { status: "ready", progress: save.progress });
    assert.deepEqual(loaded.settings, save.settings);
    assert.deepEqual(validPick(save.progress, loaded.pick), {
      starter: "charmander",
      difficulty: 0,
      stage: "forest",
    });
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0][0].includes(pickPath));
    assert.equal(warnings[0][1].code, "EISDIR");
    assert.equal(readFileSync(path, "utf8"), original);

    rmSync(pickPath, { recursive: true });
    writeFileSync(pickPath, "{");
    assert.deepEqual(storage.load().pick, {});
    assert.equal(warnings.length, 2);
    assert.ok(warnings[1][1] instanceof SyntaxError);
    assert.equal(readFileSync(pickPath, "utf8"), "{");

    writeFileSync(path, "unreadable progress");
    assert.throws(() => nativeAppStorage(path), /存档/);
    assert.equal(readFileSync(path, "utf8"), "unreadable progress");
  } finally {
    console.warn = warn;
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "permission-denied native pick preserves both files and still loads the valid save",
  { skip: process.getuid?.() === 0 ? "root bypasses file read permissions" : false },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "poketone-pick-permission-"));
    const path = nativeSavePath(directory);
    const pickPath = `${path}.pick.json`;
    const warnings = [];
    const warn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      const save = readSave(path);
      writeSave(path, save);
      const original = readFileSync(path, "utf8");
      const pick = '{"starter":"squirtle","difficulty":0,"stage":"forest"}';
      writeFileSync(pickPath, pick, { mode: 0o600 });
      chmodSync(pickPath, 0);
      const loaded = nativeAppStorage(path).load();
      assert.deepEqual(loaded.progress, { status: "ready", progress: save.progress });
      assert.deepEqual(loaded.pick, {});
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0][0].includes(pickPath));
      assert.equal(warnings[0][1].code, "EACCES");
      assert.equal(readFileSync(path, "utf8"), original);
      chmodSync(pickPath, 0o600);
      assert.equal(readFileSync(pickPath, "utf8"), pick);
    } finally {
      console.warn = warn;
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("native refuses invalid progress and settings before committing disk or memory", () => {
  const directory = mkdtempSync(join(tmpdir(), "poketone-save-invalid-"));
  const path = nativeSavePath(directory);
  try {
    const save = readSave(path);
    save.progress.stardust = 123;
    writeSave(path, save);
    const original = readFileSync(path, "utf8");
    const storage = nativeAppStorage(path);
    const invalid = {
      ...save.progress,
      best: { charmander: { difficulty: 0, victory: true, time: -1, kills: 1 } },
    };
    assert.throws(() => storage.saveProgress(invalid), /最佳记录无效/);
    assert.throws(() => storage.saveSettings({ ...save.settings, rumble: true }), /设置不受支持/);
    assert.throws(
      () => storage.save({ ...save, progress: { ...save.progress, runs: 2 ** 53 } }),
      /记录内容/,
    );
    assert.equal(readFileSync(path, "utf8"), original);
    assert.deepEqual(storage.load().progress.progress, save.progress);
    assert.deepEqual(storage.load().settings, save.settings);
    assert.equal(existsSync(`${path}.tmp`), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
