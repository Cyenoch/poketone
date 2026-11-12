import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "../src/run/sim/world.ts";
import { ultimates } from "../src/run/sim/content/ultimates.ts";
import { createTerrainUniforms } from "../src/run/view/terrain.ts";
import { Vfx } from "../src/run/view/vfx.ts";
import { Decal } from "../src/run/view/vfx/decals.ts";

test("Blast Burn disc hits show their entire event radius on the first rendered frame", () => {
  const world = createWorld({
    stage: "forest",
    seed: 154,
    difficulty: 0,
    players: [{ starter: "charmander" }],
  });
  const uniforms = createTerrainUniforms(world.map.terrain);
  try {
    for (const look of ["pillar", "ring", "meteor", "blast"]) {
      const pulse = ultimates["blast-burn"].tiers.flat().find((pulse) => pulse.look === look);
      for (const scale of [1, 1.3]) {
        const radius = pulse.radius * scale;
        const vfx = new Vfx({ uniforms, heightAt: () => 0 }, "forest");
        try {
          vfx.handle({
            t: "ult-pulse",
            player: 0,
            look: pulse.look,
            x: 2,
            z: -3,
            radius,
            dirX: 0,
            dirZ: 0,
            length: 0,
          });
          vfx.update(world, 1, 1 / 60, 0, world.players[0], new Map());
          let fullBoundary = false;
          vfx.root.traverse((mesh) => {
            const geometry = mesh.geometry;
            const params = geometry?.getAttribute("iP");
            const origin = geometry?.getAttribute("iOrigin");
            const extra = geometry?.getAttribute("iX");
            if (!params || !origin || !extra) return;
            for (let i = 0; i < geometry.instanceCount; i++) {
              if (params.getX(i) !== Decal.ring) continue;
              assert.ok(Math.abs(extra.getX(i) - radius) < 1e-5);
              assert.equal(origin.getX(i), 2);
              assert.equal(origin.getY(i), -3);
              // The ring shader interpolates from p3 to 1. A small starting ring lies about an
              // instantaneous disc hit even if it eventually expands to the correct radius.
              assert.equal(params.getW(i), 1);
              fullBoundary = true;
            }
          });
          assert.ok(fullBoundary, `${pulse.look} needs a full impact boundary`);
        } finally {
          vfx.dispose();
        }
      }
    }
  } finally {
    uniforms.uTerrainHeight.value.dispose();
  }
});

test("burning-spot ticks release their geometry before the next damage tick", () => {
  const world = createWorld({
    stage: "forest",
    seed: 154,
    difficulty: 0,
    players: [{ starter: "charmander" }],
  });
  const pulses = ultimates["blast-burn"].tiers[0].filter((pulse) => pulse.look === "embers");
  const uniforms = createTerrainUniforms(world.map.terrain);
  const vfx = new Vfx({ uniforms, heightAt: () => 0 }, "forest");
  const muzzles = new Map();
  try {
    vfx.handle({
      t: "ult-pulse",
      player: 0,
      look: "embers",
      x: 2,
      z: 1,
      radius: pulses[0].radius,
      dirX: 0,
      dirZ: 0,
      length: 0,
    });
    vfx.update(world, 1, 0, 0, world.players[0], muzzles);
    assert.ok(vfx.root.children.some((mesh) => mesh.visible));
    vfx.update(world, 1, pulses[1].at - pulses[0].at, 0, world.players[0], muzzles);
    assert.ok(
      vfx.root.children.every((mesh) => !mesh.visible),
      "old ticks must not pile up",
    );
  } finally {
    vfx.dispose();
    uniforms.uTerrainHeight.value.dispose();
  }
});
