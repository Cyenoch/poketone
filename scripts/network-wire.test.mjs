import assert from "node:assert/strict";
import test from "node:test";
import { pack, unpack } from "../src/network/wire.ts";
import { SnapshotBuffer } from "../src/network/interpolation.ts";

test("compressed world packets preserve typed maps, signed zero, unicode and collision coordinates", () => {
  const world = {
    map: new Float32Array([0, -0, 0.33, 128]),
    enemies: Array.from({ length: 600 }, (_, id) => ({
      id,
      x: Math.sin(id),
      z: Math.cos(id),
      hp: 100,
      status: "灼伤",
    })),
    events: [{ t: "hit", x: -0, z: 1 / 3 }],
  };
  const packed = pack(world);
  assert.equal(packed[0], "~");
  assert.deepEqual(unpack(packed), world);
  assert.deepEqual(unpack(pack({ t: "ready", paused: false })), { t: "ready", paused: false });
  assert.throws(() => unpack("~999999999:AA=="), /数据过大/);
  assert.throws(() => unpack(packed.replace(/^~\d+:/, "~8:")));
});

test("moving wind-up rings interpolate position, heading and progress together without crossing phases", () => {
  const buffer = new SnapshotBuffer();
  const ring = { id: 1, x: 0, z: 0, dirX: 0, dirZ: 1, life: 1, dmg: 10, kind: "vine" };
  buffer.push(0, [ring]);
  buffer.push(0.1, [{ ...ring, x: 1, dirX: 1, dirZ: 0, life: 0.9 }]);
  const mid = buffer.sample(0.05)[0];
  assert.equal(mid.x, 0.5);
  assert.equal(mid.life, 0.95);
  assert(Math.abs(mid.dirX - Math.SQRT1_2) < 1e-9);
  assert(Math.abs(mid.dirZ - Math.SQRT1_2) < 1e-9);
  assert.equal(ring.life, 1, "playback cannot mutate the baseline");
  buffer.push(0.2, [{ ...ring, x: 1, life: 0.2, dmg: 0 }]);
  assert.equal(buffer.sample(0.15)[0].dmg, 10);
  assert.equal(buffer.sample(0.15)[0].life, 0.9);
  assert.equal(buffer.sample(0.2)[0].dmg, 0);
  assert.equal(buffer.sample(1)[0].life, 0.2, "no extrapolation beyond the latest snapshot");
});
