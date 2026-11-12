import assert from "node:assert/strict";
import { test } from "node:test";
import { dressingSite } from "../src/run/view/environment/dressing.ts";
import { runAll } from "../src/prepare/steps.ts";
import { createFoliage } from "../src/run/view/environment/foliage.ts";
import { tower } from "../src/run/view/themes/tower.ts";

test("decorative scenery preserves pads, passages, water and obstacle clearance", () => {
  const world = {
    map: { pads: [], passages: [], water: { puddles: [] }, obstacles: [], terrain: {} },
  };
  const layers = { sample: () => 0 };
  assert.equal(dressingSite(world, layers, 10, 10, 0.3), true);
  world.map.pads = [{ x: 10, z: 10, radius: 4 }];
  assert.equal(dressingSite(world, layers, 10, 10, 0.3), false);
  world.map.pads = [];
  world.map.passages = [
    {
      points: [
        [0, 10],
        [20, 10],
      ],
      width: 3,
    },
  ];
  assert.equal(dressingSite(world, layers, 10, 10, 0.3), false);
  world.map.passages = [];
  world.map.obstacles = [{ x: 10, z: 10, radius: 0.7 }];
  assert.equal(dressingSite(world, layers, 10.8, 10, 0.3), false);
  world.map.obstacles = [];
  const values = new Float32Array(4).fill(0.5),
    dry = { samples: 2, resolution: 1, origin: 0, values: new Float32Array(4).fill(-1) };
  world.map.terrain.surface = { water: { ...dry, values }, lava: dry };
  assert.equal(dressingSite(world, layers, 10, 10, 0.3), false);
  world.map.terrain.surface = { water: dry, lava: { ...dry, values } };
  assert.equal(dressingSite(world, layers, 10, 10, 0.3), false);
});
test("an indoor vegetation theme allocates no plant meshes and disposes cleanly", () => {
  const foliage = runAll(createFoliage({ theme: tower }));
  assert.equal(foliage.meshes.length, 0);
  foliage.dispose();
});
