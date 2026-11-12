import { test } from "node:test";
import assert from "node:assert/strict";
import { terrainGeometry } from "../src/run/view/environment/terrainGeometry.ts";

test("cliff refinement preserves traversal heights and never overshoots a crevasse", () => {
  const samples = 9,
    heights = new Float32Array(samples * samples);
  for (let z = 0; z < samples; z++)
    for (let x = 0; x < samples; x++) heights[z * samples + x] = x >= 3 && x <= 5 ? -4 : 0;
  const terrain = { samples, resolution: 2, origin: -2, heights, step: 0.8, levels: 2 };
  const g = terrainGeometry(terrain),
    p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const gx = (p.getX(i) + 2) * 2,
      gz = (p.getZ(i) + 2) * 2,
      y = p.getY(i);
    assert.ok(y >= -4 && y <= 0, "visual cliff cannot protrude above the snow or below the floor");
    if (Number.isInteger(gx) && Number.isInteger(gz))
      assert.equal(y, heights[gz * samples + gx], "simulation contact samples must be exact");
  }
  // Every triangle has area and faces upward, so backface culling cannot cut holes in the ground.
  const index = g.index;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i),
      b = index.getX(i + 1),
      c = index.getX(i + 2);
    const cross =
      (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)) -
      (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a));
    assert.ok(cross > 0);
  }
  g.dispose();
});
