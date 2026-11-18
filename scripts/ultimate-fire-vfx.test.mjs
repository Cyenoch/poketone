import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "../src/run/sim/world.ts";
import { ultimates } from "../src/run/sim/content/ultimates.ts";
import { moves } from "../src/run/sim/content/moves.ts";
import { createTerrainUniforms } from "../src/run/view/terrain.ts";
import { Vfx } from "../src/run/view/vfx.ts";
import { Decal } from "../src/run/view/vfx/decals.ts";

test("Blast Burn disc hits show their entire event radius on the first rendered frame", () => {
  const world = createWorld({
    mode: "expedition",
    rules: [],
    stage: "forest",
    seed: 154,
    difficulty: 0,
    players: [{ trainer: "chengxi", starter: "charmander" }],
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
    mode: "expedition",
    rules: [],
    stage: "forest",
    seed: 154,
    difficulty: 0,
    players: [{ trainer: "chengxi", starter: "charmander" }],
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

test("instant player bursts expose the full damage disc before their residue", () => {
  const world = createWorld({
    mode: "expedition",
    rules: [],
    stage: "forest",
    seed: 154,
    difficulty: 0,
    players: [{ trainer: "chengxi", starter: "charmander" }],
  });
  const uniforms = createTerrainUniforms(world.map.terrain);
  try {
    for (const move of [
      "fire-blast",
      "fire-spin",
      "electro-ball",
      "seed-bomb",
      "whirlpool",
      "floral-beam",
      "fire-whirl",
      "hydro-spiral",
      "ball-storm",
      "lava-plume",
      "discharge",
      "rock-throw",
      "psystrike",
      "tectonic-rage",
      "earthquake",
    ]) {
      for (const radius of [1, 2]) {
        const area = {
          id: 99,
          owner: 0,
          move,
          kind: ["lava-plume", "discharge", "earthquake"].includes(move) ? "nova" : "burst",
          type: "fire",
          x: 2,
          z: -3,
          dirX: 0,
          dirZ: 1,
          radius,
          length: 0,
          rise: 0,
          angle: 0,
          life: 0.3,
          maxLife: 0.3,
          delay: 0,
          tick: 0,
          tickTimer: 0,
          dmg: 1,
          statusChance: 0,
          crit: 0,
          follow: false,
          count: 1,
          released: 0,
          scale: 1,
        };
        world.areas = [area];
        const before = JSON.stringify(area);
        const vfx = new Vfx({ uniforms, heightAt: () => 0 }, "forest");
        try {
          vfx.update(world, 1, 1 / 60, 0, world.players[0], new Map());
          let boundary = false;
          vfx.root.traverse((mesh) => {
            const geometry = mesh.geometry;
            const params = geometry?.getAttribute("iP");
            const extent = geometry?.getAttribute("iX");
            if (!params || !extent) return;
            for (let i = 0; i < geometry.instanceCount; i++) {
              if (params.getX(i) !== Decal.ring) continue;
              if (Math.abs(extent.getX(i) - radius) > 1e-5) continue;
              assert.equal(params.getW(i), 1, `${move} must not draw a travelling damage front`);
              boundary = true;
            }
          });
          assert.ok(boundary, `${move}: missing full-radius hit boundary`);
          assert.equal(
            JSON.stringify(area),
            before,
            "rendering must leave the damage area untouched",
          );
        } finally {
          vfx.dispose();
        }
      }
    }
  } finally {
    uniforms.uTerrainHeight.value.dispose();
  }
});

test("Mega Charizard X burns Blast Burn blue and Y keeps it orange", () => {
  const pulse = ultimates["blast-burn"].tiers.flat().find((pulse) => pulse.look === "blast");
  for (const [mega, blue] of [
    ["charizard-x", 1],
    ["charizard-y", 0],
  ]) {
    const world = createWorld({
      mode: "expedition",
      rules: [],
      stage: "forest",
      seed: 154,
      difficulty: 0,
      players: [{ trainer: "chengxi", starter: "charmander" }],
    });
    world.players[0].mega = mega;
    const uniforms = createTerrainUniforms(world.map.terrain);
    const vfx = new Vfx({ uniforms, heightAt: () => 0 }, "forest");
    try {
      vfx.handle({
        t: "ult-pulse",
        player: 0,
        look: pulse.look,
        x: 2,
        z: -3,
        radius: pulse.radius,
        dirX: 0,
        dirZ: 0,
        length: 0,
      });
      vfx.update(world, 1, 1 / 60, 0, world.players[0], new Map());
      const flags = [];
      vfx.root.traverse((mesh) => {
        const params = mesh.geometry?.getAttribute("iP");
        const extra = mesh.geometry?.getAttribute("iX");
        if (!params || !extra) return;
        for (let i = 0; i < mesh.geometry.instanceCount; i++)
          if (params.getX(i) === Decal.ring) flags.push(extra.getZ(i));
      });
      assert.ok(flags.length > 0, "the blast draws its ring");
      assert.ok(
        flags.every((flag) => flag === blue),
        `${mega} ring flags ${flags.join(",")}`,
      );
    } finally {
      vfx.dispose();
      uniforms.uTerrainHeight.value.dispose();
    }
  }
});

test("a Mega Charizard X shot that lands before it is tracked still burns blue", () => {
  for (const [mega, blue] of [
    ["charizard-x", 1],
    ["charizard-y", 0],
  ]) {
    const world = createWorld({
      mode: "expedition",
      rules: [],
      stage: "forest",
      seed: 154,
      difficulty: 0,
      players: [{ trainer: "chengxi", starter: "charmander" }],
    });
    world.players[0].mega = mega;
    const uniforms = createTerrainUniforms(world.map.terrain);
    const vfx = new Vfx({ uniforms, heightAt: () => 0 }, "forest");
    try {
      vfx.handle({
        t: "projectile-feedback",
        id: 9,
        tick: world.tick,
        owner: 0,
        move: "ember",
        archetype: moves.ember.archetype,
        type: "fire",
        x: 1,
        y: 0.5,
        z: 1,
        fromX: 0,
        fromY: 0.5,
        fromZ: 0,
        ended: true,
        reason: "hit",
        hits: 1,
      });
      vfx.update(world, 1, 1 / 60, 0, world.players[0], new Map());
      const flags = [];
      vfx.root.traverse((mesh) => {
        const params = mesh.geometry?.getAttribute("iP");
        const extra = mesh.geometry?.getAttribute("iX");
        if (!params || !extra) return;
        for (let i = 0; i < mesh.geometry.instanceCount; i++)
          if (params.getX(i) === Decal.scorch) flags.push(extra.getZ(i));
      });
      assert.ok(flags.length > 0, "the landing scorches the ground");
      assert.ok(
        flags.every((flag) => flag === blue),
        `${mega} scorch flags ${flags.join(",")}`,
      );
    } finally {
      vfx.dispose();
      uniforms.uTerrainHeight.value.dispose();
    }
  }
});
