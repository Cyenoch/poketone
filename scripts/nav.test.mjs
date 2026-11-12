import assert from "node:assert/strict";
import test from "node:test";
import {
  addCellBlocker,
  addCircleBlocker,
  cellAt,
  createNav,
  findPath,
  flowDirection,
  groundBlockedMask,
  hasWalkableLine,
  moveWithSlope,
  refreshFlowFields,
  removeBlocker,
  requestFlowField,
} from "../src/run/sim/nav/index.ts";
import { mobilityClasses } from "../src/run/sim/content/mobility.ts";
import { MIN_REGION } from "../src/run/sim/nav/walkable.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { createTerrain, TERRAIN_HALF } from "../src/run/sim/terrain.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { ARENA_HALF } from "../src/run/sim/state/world.ts";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";
import { buildSurface } from "../src/run/sim/surface.ts";

const { ground, flying } = mobilityClasses;
/** Corridor where the terrace edge is a gentle 0.125-grade ramp instead of a cliff. */
const RAMP = { from: 20, to: 26 };
/** Corridor where it is a 1.0-grade chute: steeper than ground can climb, gentle enough to walk down. */
const CHUTE = { from: -26, to: -20 };
const CHUTE_GRADE = 1;

function terrainOf(height) {
  const resolution = 2;
  const samples = TERRAIN_HALF * 2 * resolution + 1;
  const heights = new Float32Array(samples * samples);
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      heights[j * samples + i] = height(
        -TERRAIN_HALF + i / resolution,
        -TERRAIN_HALF + j / resolution,
      );
    }
  }
  return { origin: -TERRAIN_HALF, resolution, samples, heights, step: 1.5, levels: 3 };
}

const clamp = (value, top = 1.5) => Math.min(top, Math.max(0, value));
/** Low ground west of x = 10 and a 1.5-high terrace east of it: a sheer cliff except in two corridors. */
const terrace = () =>
  createNav(
    terrainOf((x, z) => {
      if (z >= RAMP.from && z <= RAMP.to) return clamp((x - 4) / 8);
      if (z >= CHUTE.from && z <= CHUTE.to) return clamp((x - 9) * CHUTE_GRADE);
      return x >= 10 ? 1.5 : 0;
    }),
  );
const flat = () => createNav(terrainOf(() => 0));

test("deep water blocks a ground route and movement, while shallows slow and flyers cross both", () => {
  const terrain = terrainOf(() => 0);
  const values = new Float32Array(terrain.heights.length).fill(-1);
  for (let j = 0; j < terrain.samples; j++) {
    for (let i = 0; i < terrain.samples; i++) {
      const x = terrain.origin + i / terrain.resolution;
      if (x >= 8 && x <= 10) values[j * terrain.samples + i] = 0.9;
      if (x >= 2 && x <= 5) values[j * terrain.samples + i] = 0.3;
    }
  }
  terrain.surface = buildSurface(
    terrain,
    { ...terrain, values },
    {
      ground: "ground",
      shallowSpeed: 0.8,
      liquids: [],
    },
    [],
  );
  const nav = createNav(terrain);
  const out = [];
  assert.equal(findPath(nav, ground, 0, 0, 15, 0, out), false);
  assert.equal(hasWalkableLine(nav, flying, 0, 0, 15, 0), true);
  const walker = { x: 6, z: 0 };
  moveWithSlope(nav, ground, walker, 9, 0);
  assert.ok(walker.x < 8, `ground unit entered deep water at ${walker.x}`);
  const flyer = { x: 6, z: 0 };
  moveWithSlope(nav, flying, flyer, 9, 0);
  assert.equal(flyer.x, 15);
  const wader = { x: 3, z: 0 };
  moveWithSlope(nav, ground, wader, 1, 0);
  assert.ok(Math.abs(wader.x - 3.8) < 1e-6);
});

/** Follows the field like the director does: straight when the line is walkable, else the flow. */
function chase(nav, profile, body, target, step, ticks) {
  const dir = { x: 0, z: 0 };
  let maxZ = -Infinity;
  let minZ = Infinity;
  let maxAbsZ = 0;
  for (let tick = 0; tick < ticks; tick++) {
    const dx = target.x - body.x;
    const dz = target.z - body.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.5) return { reached: true, maxZ, minZ, maxAbsZ };
    if (
      hasWalkableLine(nav, profile, body.x, body.z, target.x, target.z) ||
      !flowDirection(nav, profile, body.x, body.z, dir)
    ) {
      dir.x = dx / distance;
      dir.z = dz / distance;
    }
    moveWithSlope(nav, profile, body, dir.x * step, dir.z * step);
    maxZ = Math.max(maxZ, body.z);
    minZ = Math.min(minZ, body.z);
    maxAbsZ = Math.max(maxAbsZ, Math.abs(body.z));
  }
  return { reached: false, maxZ, minZ, maxAbsZ };
}

/** Walks `body` by (dx, dz) per tick and returns the slowest tick as a fraction of the input step. */
function slowestTick(nav, body, dx, dz, ticks, inContact) {
  const step = Math.hypot(dx, dz);
  let slowest = Infinity;
  for (let tick = 0; tick < ticks; tick++) {
    const [x, z] = [body.x, body.z];
    moveWithSlope(nav, ground, body, dx, dz);
    if (inContact(body)) slowest = Math.min(slowest, Math.hypot(body.x - x, body.z - z) / step);
  }
  return slowest;
}

test("a steep hillside within the climb limit is walkable both ways", () => {
  const top = 3;
  const nav = createNav(terrainOf((x) => clamp(x * 0.85, top)));
  const body = { x: -5, z: 0 };
  for (let i = 0; i < 100; i++) moveWithSlope(nav, ground, body, 0.1, 0);
  assert.ok(Math.abs(body.x - 5) < 1e-6, `walks up the 0.85 hillside, got x=${body.x}`);
  for (let i = 0; i < 100; i++) moveWithSlope(nav, ground, body, -0.1, 0);
  assert.ok(Math.abs(body.x + 5) < 1e-6, `walks back down, got x=${body.x}`);
  assert.equal(hasWalkableLine(nav, ground, -5, 0, 5, 0), true);
  assert.equal(hasWalkableLine(nav, ground, 5, 0, -5, 0), true);
  assert.equal(groundBlockedMask(nav).data.some(Boolean), false);
});

/** Sizes of the connected components of mask cells equal to `value` (8- or 4-connected). */
function componentSizes(mask, value, eightWay) {
  const { data, width, height } = mask;
  const seen = new Uint8Array(data.length);
  const sizes = [];
  for (let start = 0; start < data.length; start++) {
    if (seen[start] || data[start] !== value) continue;
    const stack = [start];
    seen[start] = 1;
    let size = 0;
    while (stack.length > 0) {
      const cell = stack.pop();
      size++;
      const x = cell % width;
      const z = (cell - x) / width;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dz) || (!eightWay && dx && dz)) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
          const next = nz * width + nx;
          if (!seen[next] && data[next] === value) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    sizes.push(size);
  }
  return sizes;
}

test("real seeds have no wall speck or walkable pocket smaller than the minimum region", () => {
  for (let seed = 1; seed <= 8; seed++) {
    const mask = groundBlockedMask(
      createNav(createTerrain(seed * 7919, stageDefs.forest.map.terrain, [])),
    );
    const walls = componentSizes(mask, 255, true);
    const fields = componentSizes(mask, 0, false);
    assert.ok(walls.length > 0, `seed ${seed} should still have cliffs`);
    assert.ok(
      Math.min(...walls) >= MIN_REGION,
      `seed ${seed}: wall of ${Math.min(...walls)} cells`,
    );
    assert.ok(
      Math.min(...fields) >= MIN_REGION,
      `seed ${seed}: pocket of ${Math.min(...fields)} cells`,
    );
  }
});

test("walls never touch only at a corner (no one-point pinch between two open cells)", () => {
  for (let seed = 1; seed <= 8; seed++) {
    const mask = groundBlockedMask(
      createNav(createTerrain(seed * 7919, stageDefs.forest.map.terrain, [])),
    );
    const wall = (x, z) => mask.data[z * mask.width + x] === 255;
    for (let z = 0; z < mask.height - 1; z++) {
      for (let x = 0; x < mask.width - 1; x++) {
        const [a, b, c, d] = [wall(x, z), wall(x + 1, z), wall(x, z + 1), wall(x + 1, z + 1)];
        assert.ok(
          !((a && d && !b && !c) || (b && c && !a && !d)),
          `seed ${seed}: pinch at ${x},${z}`,
        );
      }
    }
  }
});

test("a speck-sized bump is walkable in both directions", () => {
  const nav = createNav(terrainOf((x, z) => 1.4 * Math.exp(-2 * (x * x + z * z))));
  const steep = [];
  for (let z = -2; z <= 2; z += 0.5) {
    for (let x = -2; x <= 2; x += 0.5) {
      if (nav.grid.steepness[cellAt(nav.grid, x, z)] > ground.climb) steep.push([x, z]);
    }
  }
  assert.ok(
    steep.length > 0 && steep.length < MIN_REGION,
    `bump should be a speck, got ${steep.length} steep cells`,
  );
  assert.equal(
    groundBlockedMask(nav).data.some(Boolean),
    false,
    "the speck is cleaned out of the mask",
  );
  const body = { x: -3, z: 0 };
  for (let i = 0; i < 60; i++) moveWithSlope(nav, ground, body, 0.1, 0);
  assert.ok(Math.abs(body.x - 3) < 1e-6, `walks over the bump, got x=${body.x}`);
  for (let i = 0; i < 60; i++) moveWithSlope(nav, ground, body, -0.1, 0);
  assert.ok(Math.abs(body.x + 3) < 1e-6, `walks back over it, got x=${body.x}`);
  assert.equal(hasWalkableLine(nav, ground, -3, 0, 3, 0), true);
  assert.equal(hasWalkableLine(nav, ground, 3, 0, -3, 0), true);
});

test("a sheer cliff blocks ground units while the ramp beside it is walkable", () => {
  const nav = terrace();
  assert.equal(hasWalkableLine(nav, ground, 0, 0, 20, 0), false);
  assert.equal(hasWalkableLine(nav, ground, 0, 23, 20, 23), true);

  const body = { x: 0, z: 0 };
  for (let i = 0; i < 300; i++) moveWithSlope(nav, ground, body, 0.1, 0);
  assert.ok(body.x > 9 && body.x < 10, `walker should stop at the cliff foot, got x=${body.x}`);

  const mask = groundBlockedMask(nav);
  const at = (x, z) =>
    mask.data[
      Math.round((z - mask.originZ) / mask.cellSize) * mask.width +
        Math.round((x - mask.originX) / mask.cellSize)
    ];
  assert.equal(at(9.5, 0), 255, "the sheer face is marked blocked");
  assert.equal(
    at(9.75, -23),
    255,
    "a face walkable only downhill is marked too: it cannot be climbed",
  );
  assert.equal(at(5, 0), 0, "low ground is walkable");
  assert.equal(at(10, 23), 0, "the ramp is walkable");

  const path = [];
  assert.equal(findPath(nav, ground, 0, 0, 20, 0, path), true);
  assert.deepEqual(path.slice(-2), [20, 0]);
  const zs = path.filter((_, i) => i % 2 === 1);
  assert.ok(
    Math.max(...zs) >= RAMP.from,
    `A* should climb through the ramp, got ${path.join(",")}`,
  );
  let x = 0;
  let z = 0;
  for (let i = 0; i < path.length; i += 2) {
    assert.equal(
      hasWalkableLine(nav, ground, x, z, path[i], path[i + 1]),
      true,
      `smoothed leg ${i / 2} must be walkable`,
    );
    [x, z] = [path[i], path[i + 1]];
  }
});

test("a face steeper than climb but within drop can be walked down, never up", () => {
  const nav = terrace();
  const middle = (CHUTE.from + CHUTE.to) / 2;
  const descending = { x: 12, z: middle };
  for (let i = 0; i < 60; i++) moveWithSlope(nav, ground, descending, -0.1, 0);
  assert.ok(
    Math.abs(descending.x - 6) < 1e-6,
    `ground walks down the chute, got x=${descending.x}`,
  );

  const ascending = { x: 6, z: middle };
  for (let i = 0; i < 60; i++) moveWithSlope(nav, ground, ascending, 0.1, 0);
  assert.ok(ascending.x < 9.5, `ground cannot walk up the chute, got x=${ascending.x}`);

  assert.equal(hasWalkableLine(nav, ground, 14, middle, 4, middle), true);
  assert.equal(hasWalkableLine(nav, ground, 4, middle, 14, middle), false);

  const edge = { x: 12, z: 0 };
  for (let i = 0; i < 30; i++) moveWithSlope(nav, ground, edge, -0.1, 0);
  assert.ok(edge.x > 10, `the sheer cliff is too steep to walk down onto, got x=${edge.x}`);
});

test("a body shoved onto a cliff face can always walk down or along it, never up", () => {
  const nav = terrace();
  const down = { x: 9.75, z: 5 };
  for (let i = 0; i < 20; i++) moveWithSlope(nav, ground, down, -0.1, 0);
  assert.ok(Math.abs(down.x - 7.75) < 1e-6, `walks off the face downhill, got x=${down.x}`);

  const along = { x: 9.75, z: 5 };
  for (let i = 0; i < 20; i++) moveWithSlope(nav, ground, along, 0, 0.1);
  assert.ok(Math.abs(along.z - 7) < 1e-6, `walks along the face, got z=${along.z}`);

  const up = { x: 9.75, z: 5 };
  for (let i = 0; i < 20; i++) moveWithSlope(nav, ground, up, 0.1, 0);
  assert.equal(up.x, 9.75, "cannot climb the rest of the face");
});

test("a body that only grazes the lip of a one-way face can step back up", () => {
  const nav = terrace();
  const z = (CHUTE.from + CHUTE.to) / 2;
  // The chute's lip line is a little below its top at x = 10.5: stop just past it, then turn back.
  for (const stop of [10.23, 10.21]) {
    const body = { x: 11, z };
    moveWithSlope(nav, ground, body, stop - 11, 0);
    assert.ok(body.x < 10.25, `walks onto the lip, got x=${body.x}`);
    moveWithSlope(nav, ground, body, 0.5, 0);
    assert.ok(body.x > 10.5, `backs up off the lip from ${stop}, got x=${body.x}`);
  }
});

test("one-way banks never lead into a pit ground units could not leave", () => {
  const nav = createNav(
    terrainOf((x, z) => {
      const r = Math.hypot(x - 20, z);
      return Math.min(0, -1.5 + Math.max(0, r - 4) * CHUTE_GRADE);
    }),
  );
  const body = { x: 20, z: -9 };
  for (let i = 0; i < 100; i++) moveWithSlope(nav, ground, body, 0, 0.1);
  assert.ok(body.z < -5, `walker stops at the pit rim, got z=${body.z}`);
  assert.equal(hasWalkableLine(nav, ground, 20, -9, 20, 0), false);
  const bird = { x: 20, z: -9 };
  moveWithSlope(nav, flying, bird, 0, 9);
  assert.equal(bird.z, 0);
});

test("blocked bodies slide along cliffs and around rocks, keeping their tangential speed", () => {
  const diagonal = 0.1 * Math.SQRT1_2;
  const cliff = terrace();
  const climber = { x: 8, z: 0 };
  const alongCliff = slowestTick(cliff, climber, diagonal, diagonal, 120, (b) => b.x > 9);
  assert.ok(climber.x < 10, `stays off the cliff, got x=${climber.x}`);
  assert.ok(alongCliff > 0.69, `keeps ${alongCliff} of its speed along the cliff`);

  const field = flat();
  addCircleBlocker(field, 0, 0, 1);
  const contact = 1.5 * Math.SQRT1_2;
  const walker = { x: -5, z: -contact };
  const aroundRock = slowestTick(field, walker, 0.1, 0, 80, (b) => {
    assert.ok(Math.hypot(b.x, b.z) >= 1.5 - 1e-9, `body overlaps the rock at ${b.x},${b.z}`);
    return Math.abs(b.x) < 1.5;
  });
  assert.ok(walker.x > 2, `slides past the rock, got x=${walker.x}`);
  assert.ok(aroundRock > 0.69, `keeps ${aroundRock} of its speed around the rock`);
});

test("pushing at a slant into a diagonal cliff (a staircase of cells) slides along it, never stalls", () => {
  // Terrace above the line x + z = 6; the wall is a 45° staircase of 0.5-unit cells.
  const nav = createNav(terrainOf((x, z) => (x + z >= 6 ? 1.5 : 0)));
  const n = Math.SQRT1_2;
  for (const off of [30, 45, 60]) {
    const a = (off * Math.PI) / 180;
    // `off` degrees from the wall normal (1, 1)/√2, leaning toward the tangent (1, −1)/√2.
    const dx = 0.12 * (n * Math.cos(a) + n * Math.sin(a));
    const dz = 0.12 * (n * Math.cos(a) - n * Math.sin(a));
    const body = { x: 1, z: 1 };
    let travelled = 0;
    for (let tick = 0; tick < 90; tick++) {
      const [x, z] = [body.x, body.z];
      moveWithSlope(nav, ground, body, dx, dz);
      if (body.x + body.z > 5) travelled += Math.hypot(body.x - x, body.z - z);
    }
    assert.ok(body.x + body.z < 6, `stays below the cliff at ${off}°`);
    // In contact for most of the 90 ticks; ideal along-wall share is sin(off).
    const share = travelled / (0.12 * 60 * Math.sin(a));
    assert.ok(share > 0.8, `keeps ${share.toFixed(2)} of its along-wall speed at ${off}°`);
  }
});

test("a flow field routes ground units around the cliff to a target on the terrace", () => {
  const nav = terrace();
  const target = { x: 20, z: 0, alive: true };
  requestFlowField(nav, ground);
  refreshFlowFields(nav, [target], Infinity);
  const result = chase(nav, ground, { x: 0, z: 0 }, target, 0.1, 3000);
  assert.equal(result.reached, true);
  // Up by the ramp (its edge starts at z = 20, half a cell of slack), never by the one-way chute.
  assert.ok(
    result.maxZ >= RAMP.from - 0.25,
    `walker should climb by the ramp; max z ${result.maxZ}`,
  );
  assert.ok(result.minZ > CHUTE.to, `walker must not try the one-way chute; min z ${result.minZ}`);
});

test("adding a blocker reroutes the flow field and removing it restores the direct route", () => {
  const nav = flat();
  const target = { x: 10, z: 0, alive: true };
  const dir = { x: 0, z: 0 };
  requestFlowField(nav, ground);
  refreshFlowFields(nav, [target], Infinity);
  assert.equal(flowDirection(nav, ground, -0.5, 0, dir), true);
  assert.deepEqual(dir, { x: 1, z: 0 });

  const wall = [];
  for (let z = -30; z <= 30; z += 0.5) wall.push(cellAt(nav.grid, 0, z));
  const id = addCellBlocker(nav, wall);
  refreshFlowFields(nav, [target], Infinity);
  assert.equal(hasWalkableLine(nav, ground, -10, 0, 10, 0), false);
  const body = { x: -2, z: 0 };
  moveWithSlope(nav, ground, body, 4, 0);
  assert.ok(body.x < -0.25, `body stops in front of the wall, got x=${body.x}`);
  const detour = chase(nav, ground, { x: -10, z: 0 }, target, 0.15, 4000);
  assert.equal(detour.reached, true);
  assert.ok(detour.maxAbsZ > 30, `walker should go around the wall end, max |z| ${detour.maxAbsZ}`);

  removeBlocker(nav, id);
  flowDirection(nav, ground, -0.5, 0, dir);
  refreshFlowFields(nav, [target], Infinity);
  assert.equal(flowDirection(nav, ground, -0.5, 0, dir), true);
  assert.deepEqual(dir, { x: 1, z: 0 });
});

test("flyers ignore terrain and solid props but stay inside the arena", () => {
  const nav = terrace();
  addCircleBlocker(nav, 5, 0, 1);
  const bird = { x: 0, z: 0 };
  moveWithSlope(nav, flying, bird, 20, 0);
  assert.equal(bird.x, 20);
  moveWithSlope(nav, flying, bird, 100, 0);
  assert.equal(bird.x, ARENA_HALF);
  assert.equal(hasWalkableLine(nav, flying, 0, 0, 20, 0), true);
});

test("a single large displacement cannot tunnel through a cliff, a rock or a one-cell wall", () => {
  const nav = terrace();
  const dasher = { x: 8, z: 0 };
  moveWithSlope(nav, ground, dasher, 30, 0);
  assert.ok(dasher.x < 10, `straight dash stops at the cliff, got x=${dasher.x}`);
  const slanted = { x: 8, z: 1 };
  moveWithSlope(nav, ground, slanted, 20, 15);
  assert.ok(slanted.x < 10, `diagonal dash slides along the cliff, got x=${slanted.x}`);
  assert.ok(slanted.z > 10, `the blocked dash keeps sliding along the cliff, got z=${slanted.z}`);

  const rocky = flat();
  addCircleBlocker(rocky, 0, 0, 0.6);
  const shoved = { x: -3, z: 0 };
  moveWithSlope(rocky, ground, shoved, 6, 0);
  assert.ok(shoved.x <= -1.1 + 1e-9, `a shove stops at the rock, got x=${shoved.x}`);

  const walled = flat();
  addCellBlocker(walled, [cellAt(walled.grid, 0, 0)]);
  const body = { x: -1, z: 0 };
  moveWithSlope(walled, ground, body, 2, 0);
  assert.ok(body.x < -0.25, `dash stops at a one-cell wall, got x=${body.x}`);
});

test("same seed gives identical fields, whether integrated at once or time-sliced", () => {
  const targets = [
    { x: 6, z: -4, alive: true },
    { x: -20, z: 18, alive: true },
  ];
  const build = () => {
    const nav = createNav(createTerrain(7, stageDefs.forest.map.terrain, []));
    addCircleBlocker(nav, 3, 4, 1.2);
    requestFlowField(nav, ground);
    return nav;
  };
  const whole = build();
  refreshFlowFields(whole, targets, Infinity);
  const sliced = build();
  for (let tick = 0; tick < 200; tick++) {
    requestFlowField(sliced, ground);
    refreshFlowFields(sliced, targets, 997);
  }
  assert.deepEqual(sliced.layers[0].field.cost, whole.layers[0].field.cost);
});

test("a close enemy with a clear line chases the target's current position, not the field's lag", () => {
  const world = createWorld({
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [{ starter: "squirtle" }],
  });
  world.spawn.credit = -Infinity;
  const player = world.players[0];
  const enemy = spawnEnemy(world, "caterpie", 3, 0);
  // The starter's auto-attack would kill it; this test is about steering, not combat.
  enemy.hp = enemy.maxHp = Infinity;
  let tracked = 0;
  for (let tick = 0; tick < 90; tick++) {
    // Teleport the target around the spawn clearing faster than the flow field refreshes.
    const angle = tick * 0.12;
    player.x = Math.cos(angle) * 2.5;
    player.z = Math.sin(angle) * 2.5;
    player.hp = 999;
    stepWorld(world, []);
    world.events.length = 0;
    if (tick < 8) continue;
    const dx = player.x - enemy.px;
    const dz = player.z - enemy.pz;
    const length = Math.hypot(dx, dz);
    if (length < 0.5) continue;
    const dot = (enemy.faceX * dx + enemy.faceZ * dz) / length;
    assert.ok(
      dot > 0.999,
      `tick ${tick}: heading ${enemy.faceX},${enemy.faceZ} misses the target (cos ${dot})`,
    );
    tracked++;
  }
  assert.ok(tracked > 60, `checked ${tracked} ticks`);
});

test("every species walks down a one-way step its flow field routes it over, wherever it meets the edge", () => {
  // Real forest edges where a one-way section of a terrace step meets a sheer one. Seed 1: rows
  // z ≤ 3.5 always got down, rows touching the sheer cell pressed into the edge forever. Seed 8: a
  // body that had just stepped onto the face could neither go on nor back.
  const edges = [
    { seed: 1, from: [-36.5, 3], to: [-30, 3] },
    { seed: 1, from: [-36.5, 4.5], to: [-30, 4.5] },
    { seed: 8, from: [-26, 4], to: [-20, 4] },
  ];
  for (const species of ["caterpie", "nidoran-m"]) {
    for (const { seed, from, to } of edges) {
      const world = createWorld({
        stage: "forest",
        seed,
        difficulty: 0,
        players: [{ starter: "squirtle" }],
      });
      world.spawn.credit = -Infinity;
      const player = world.players[0];
      const enemy = spawnEnemy(world, species, from[0], from[1]);
      enemy.hp = enemy.maxHp = Infinity;
      let reached = false;
      for (let tick = 0; tick < 30 * 10 && !reached; tick++) {
        [player.x, player.z] = to;
        player.hp = 999;
        stepWorld(world, []);
        world.events.length = 0;
        reached = Math.hypot(enemy.x - to[0], enemy.z - to[1]) < 1.2;
      }
      assert.ok(
        reached,
        `${species} from ${from.join(",")} (seed ${seed}) stalls at ${enemy.x.toFixed(2)},${enemy.z.toFixed(2)}`,
      );
    }
  }
});

test("a body that walks off a face into a wall corner can always leave it", () => {
  // Forest seed 2: walking diagonally off a sheer face ends where the smooth wall line cuts deep
  // into a walkable corner cell. Every way out must stay open, or the body freezes there for good.
  const world = createWorld({
    stage: "forest",
    seed: 2,
    difficulty: 0,
    players: [{ starter: "squirtle" }],
  });
  const { nav } = world;
  nav.blockers.length = 0;
  nav.grid.near.fill(0);
  nav.grid.hard.fill(0);
  const body = { x: 6.5, z: -21.5 };
  for (let i = 0; i < 30; i++)
    moveWithSlope(nav, ground, body, -0.1 * Math.SQRT1_2, 0.1 * Math.SQRT1_2);
  const stuck = { x: body.x, z: body.z };
  let free = 0;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const probe = { ...stuck };
    for (let i = 0; i < 10; i++)
      moveWithSlope(nav, ground, probe, Math.cos(a) * 0.06, Math.sin(a) * 0.06);
    if (Math.hypot(probe.x - stuck.x, probe.z - stuck.z) > 0.2) free++;
  }
  assert.ok(free > 0, `frozen at ${stuck.x.toFixed(3)},${stuck.z.toFixed(3)}`);
});

test("same seed and commands produce the same run", () => {
  const run = () => {
    const world = createWorld({
      stage: "forest",
      seed: 11,
      difficulty: 0,
      players: [{ starter: "bulbasaur" }],
    });
    for (let tick = 0; tick < 2400; tick++) {
      const angle = tick / 90;
      const commands = [{ t: "move", player: 0, x: Math.cos(angle), z: Math.sin(angle) }];
      const card = world.players[0].pending[0];
      if (card) commands.push({ t: "pick", player: 0, card: card.id, index: 0 });
      if (tick % 75 === 0) commands.push({ t: "dash", player: 0 });
      stepWorld(world, commands);
      world.events.length = 0;
    }
    return JSON.stringify({
      players: world.players,
      enemies: world.enemies,
      kills: world.players[0].kills,
    });
  };
  assert.equal(run(), run());
});
