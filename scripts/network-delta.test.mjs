import assert from "node:assert/strict";
import test from "node:test";
import { entityDelta, applyEntityDelta } from "../src/network/delta.ts";
import { encode, decode } from "../src/network/codec.ts";

test("motion-only batches and field removal preserve the unchanged entity order", () => {
  const baseline = {
    players: [],
    enemies: [
      { id: 1, x: 0, z: 1, target: 3 },
      { id: 2, x: 2, z: 3, target: 1 },
    ],
    projectiles: [],
    partners: [],
    hazards: [],
    pickups: [],
    areas: [],
  };
  const original = structuredClone(baseline);
  const moving = {
    ...baseline,
    enemies: [
      { id: 1, x: -0, z: 1.125 },
      { id: 2, x: 2, z: 3 },
    ],
  };
  const restored = applyEntityDelta(baseline, decode(encode(entityDelta(baseline, moving))));
  assert.deepEqual(restored, moving);
  assert(Object.is(restored.enemies[0].x, -0));
  assert.equal(Object.hasOwn(restored.enemies[0], "target"), false);
  assert.deepEqual(baseline, original, "queued snapshots cannot mutate their published baseline");
  assert.deepEqual(applyEntityDelta(restored, entityDelta(restored, restored)), restored);
});
