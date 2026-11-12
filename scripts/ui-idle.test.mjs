import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { admits, IdleQueue, QUIET_MS } from "../src/prepare/idle.ts";
import { glbUnitSize } from "../src/game/models/glbSize.ts";

const sizeOf = (path) =>
  glbUnitSize(new Blob([readFileSync(new URL(`../public/models/${path}`, import.meta.url))]));

test("the idle lane admits the measured small models and nothing larger", async () => {
  for (const path of [
    "enemies/caterpie.glb",
    "enemies/geodude.glb",
    "props/hypno.glb",
    "props/bill-machine.glb",
  ]) {
    assert.ok(admits("glb-parse", await sizeOf(path)), `${path} is in the measured bucket`);
  }
  // Few vertices but a player-form texture: the texels, not the file, decide.
  const charmander = await sizeOf("charmander.glb");
  assert.ok(charmander.texturePixels > 512 * 512, "read from the image header");
  assert.equal(admits("glb-parse", charmander), false);
  assert.equal(admits("glb-parse", await sizeOf("enemies/scyther.glb")), false);
  assert.equal(admits("texture-upload", { vertices: 0, texturePixels: 1024 * 1024 }), false);
  assert.equal(
    admits("glb-parse", { vertices: 10, texturePixels: Number.POSITIVE_INFINITY }),
    false,
    "an image whose size cannot be read is never admitted",
  );
});

test("one unit per idle frame, and none until input has been quiet", () => {
  const queue = new IdleQueue();
  const ran = [];
  const unit = (name) => ({
    kind: "glb-parse",
    size: { vertices: 100, texturePixels: 256 * 256 },
    run: () => ran.push(name),
  });
  queue.add(unit("a"));
  const cancelB = queue.add(unit("b"));
  queue.add(unit("c"));
  assert.equal(
    queue.add({ ...unit("big"), size: { vertices: 9000, texturePixels: 0 } }),
    null,
    "not admitted: not queued",
  );
  assert.equal(queue.next(1000, 1000 - QUIET_MS + 1), null, "input too recent");
  queue.next(1000, 0)?.run();
  cancelB();
  queue.next(1001, 0)?.run();
  assert.deepEqual(ran, ["a", "c"], "first come, one per call, a cancelled unit never runs");
  assert.equal(queue.size, 0);
});
