import assert from "node:assert/strict";
import test from "node:test";
import { Scene } from "three";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { createDebugOverlay } from "../src/run/view/debug/layers.ts";
import { debugLayers } from "../src/run/dev/layers.ts";

test("debug overlays only read sim/nav and detach every scene object on disposal", () => {
  const world = createWorld({
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [{ starter: "squirtle" }],
  });
  spawnEnemy(world, "caterpie", 8, 0);
  stepWorld(world, []);
  const before = structuredClone(world);
  const scene = new Scene();
  const stage = { viewport: { width: 1280, height: 800, scale: 1 } };
  for (const layer of debugLayers) {
    // Offscreen label anchors avoid requiring a GPU font atlas in this headless contract test.
    const overlay = createDebugOverlay(
      world,
      0,
      new Set([layer]),
      () => 1,
      stage,
      () => null,
    );
    scene.add(overlay.root);
    overlay.update(world);
    assert.deepEqual(
      structuredClone(world),
      before,
      `${layer} must not alter the simulation or flow-field demand`,
    );
    overlay.dispose();
    assert.equal(scene.children.length, 0, `${layer} must detach when disabled`);
    assert.equal(overlay.root.children.length, 0);
  }
});
