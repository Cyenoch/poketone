import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { nativeResources } from "../src/platform/native/resources.ts";
import { installResources } from "../src/platform/resources.ts";
import { loadGlb } from "../src/game/models/loadGlb.ts";
import { readSave, writeSave } from "../src/platform/native/save.ts";
import { decodeSave } from "../src/run/save.ts";
import { nativeAppStorage } from "../src/platform/native/app-storage.ts";

const resources = nativeResources(new URL("../public/", import.meta.url));
installResources(resources);

test("native decodes PNG and WebP with explicit texture orientation", async () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]);
  for (const format of ["png", "webp"]) {
    const encoded = await sharp(pixels, { raw: { width: 1, height: 2, channels: 4 } })
      .toFormat(format, { lossless: true })
      .toBuffer();
    for (const flipped of [false, true]) {
      const image = await resources.decodeImage(new Blob([encoded]), flipped);
      assert.deepEqual(
        Array.from(image.source.data),
        Array.from(flipped ? Buffer.concat([pixels.subarray(4), pixels.subarray(0, 4)]) : pixels),
      );
      image.release();
    }
  }
});

test("native asset reads reject escape and cancellation, and load the real textured rig", async () => {
  await assert.rejects(
    resources.read(new URL("../package.json", new URL("../public/", import.meta.url))),
    /outside/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(resources.read("/models/charmander.glb", { signal: abort.signal }), {
    name: "AbortError",
  });
  const blob = await (await resources.read("/models/charmander.glb?v=test")).blob();
  const model = await loadGlb(new File([blob], "charmander.glb"));
  const textures = new Set();
  let skinned = 0;
  model.root.traverse((node) => {
    if (node.isSkinnedMesh) skinned++;
    for (const material of Array.isArray(node.material) ? node.material : [node.material])
      if (material?.map) textures.add(material.map);
  });
  assert(skinned > 0);
  assert(textures.size > 0);
  assert(model.animations.length > 0);
  for (const texture of textures) {
    assert.equal(texture.isDataTexture, true);
    assert(texture.image.data.length > 0);
    assert.equal(texture.flipY, false);
  }
  model.releaseUploads();
  model.dispose();
});

test("native saves use the Web format and preserve an unreadable file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "poketone-save-"));
  const path = join(directory, "save.txt");
  try {
    const save = readSave(path);
    save.settings.uiScale = 1.2;
    writeSave(path, save);
    assert.deepEqual(readSave(path), save);
    assert.deepEqual(decodeSave(await readFile(path, "utf8")), save);
    const storage = nativeAppStorage(path);
    const pick = { starter: "squirtle", difficulty: 0, stage: "forest" };
    storage.savePick(pick);
    assert.deepEqual(nativeAppStorage(path).load().pick, pick);
    await writeFile(`${path}.pick.json`, "{");
    assert.deepEqual(nativeAppStorage(path).load().pick, {});
    assert.deepEqual(readSave(path), save, "a broken preference cannot change the progress save");
    await writeFile(path, "broken");
    assert.throws(() => readSave(path));
    assert.equal(await readFile(path, "utf8"), "broken");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("SDL fingers keep distinct capture identities and suppress synthetic mouse duplicates", async () => {
  const { EventEmitter } = await import("node:events");
  const { NativeUiSurface } = await import("../src/platform/native/ui-surface.ts");
  const win = Object.assign(new EventEmitter(), {
    width: 844,
    height: 390,
    native: { handle: Buffer.alloc(8) },
    focus() {},
  });
  const surface = new NativeUiSurface({ window: win }, new URL("../public/", import.meta.url));
  const points = [];
  const stop = surface.listen({
    down: (point) => {
      points.push(["down", point]);
      return true;
    },
    move: (point) => points.push(["move", point]),
    up: (point) => points.push(["up", point]),
    cancel: (point) => points.push(["cancel", point]),
    keyDown: () => false,
    keyUp() {},
    leave() {},
    wheel: () => false,
    blur() {},
    cancelInput() {},
    displayChanged() {},
  });
  try {
    const finger = { device: { id: 4 }, fingerId: 7, mouse: false, x: 0.25, y: 0.5 };
    win.emit("fingerDown", { ...finger, type: "fingerDown" });
    win.emit("fingerDown", { ...finger, device: { id: 5 }, type: "fingerDown" });
    win.emit("mouseButtonDown", {
      type: "mouseButtonDown",
      touch: true,
      button: 1,
      x: 211,
      y: 195,
    });
    assert.equal(points.length, 2);
    assert.equal(points[0][1].x, 211);
    assert.equal(points[0][1].y, 195);
    assert.notEqual(points[0][1].id, points[1][1].id);
    win.emit("fingerMove", { ...finger, x: 0.5, type: "fingerMove" });
    assert.equal(points[2][1].id, points[0][1].id);
    win.emit("blur");
    assert.equal(points.filter(([kind]) => kind === "cancel").length, 2);
    const count = points.length;
    win.emit("fingerUp", { ...finger, type: "fingerUp" });
    assert.equal(points.length, count, "a cancelled finger cannot submit on a late up");
  } finally {
    stop();
    surface.dispose();
  }
});
