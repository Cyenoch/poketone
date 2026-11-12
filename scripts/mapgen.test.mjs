import assert from "node:assert/strict";
import test from "node:test";
import { spawnEnemy } from "../src/run/sim/director.ts";
import {
  checkPlayable,
  generateMap,
  PAD_RIM,
  shoreDistance,
  stageBodies,
  waterDepthAt,
} from "../src/run/sim/mapgen/index.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import {
  addCircleBlocker,
  addCellBlocker,
  bodyFits,
  cellAt,
  createNav,
  groundBlockedMask,
  moveWithSlope,
  routeReach,
  steepnessAt,
} from "../src/run/sim/nav/index.ts";
import { mobilityClasses } from "../src/run/sim/content/mobility.ts";
import { heightAt, TERRAIN_HALF } from "../src/run/sim/terrain.ts";
import { apply, has } from "../src/run/sim/status.ts";
import { createWorld, createWorldFromSeeds, stepWorld } from "../src/run/sim/world.ts";
import { applyStamps } from "../src/run/sim/mapgen/stamps.ts";
import { createTerrain } from "../src/run/sim/terrain.ts";
import { sampleSurface } from "../src/run/sim/surface.ts";
import { updateHazards } from "../src/run/sim/hazards.ts";
import { tower, towerFloors } from "../src/run/sim/content/stages/tower.ts";
import { resolveLayout } from "../src/run/sim/mapgen/layout.ts";
import { coverHit, stopAtCover } from "../src/run/sim/sight.ts";

const forestMap = stageDefs.forest.map;
const STAGES = ["forest", "desert"];

// Desert seed 7919 × 8 cannot fit the new landmark pad; these are direct-generation fixtures.
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 9].map((k) => k * 7919);
/** Per stage, seed → the built map ({ map, nav }); `nav` has the solid props registered. */
const built = Object.fromEntries(
  STAGES.map((stage) => [
    stage,
    new Map(SEEDS.map((seed) => [seed, generateMap(seed, stageDefs[stage].map)])),
  ]),
);

/** Points on a polar grid inside a disc, for checking a whole area rather than its centre. */
function discPoints(x, z, radius) {
  const points = [[x, z]];
  for (let r = 0.5; r <= radius; r += 0.5) {
    for (let k = 0; k < 16; k++) {
      const angle = (k / 16) * Math.PI * 2;
      points.push([x + Math.cos(angle) * r, z + Math.sin(angle) * r]);
    }
  }
  return points;
}

function wallAt(mask, x, z) {
  const i = Math.round((x - mask.originX) / mask.cellSize);
  const j = Math.round((z - mask.originZ) / mask.cellSize);
  return mask.data[j * mask.width + i] !== 0;
}

test("every requested pad exists, is flat, clear of walls, props and water, and reachable on foot both ways", () => {
  for (const stage of STAGES) {
    const padSpecs = stageDefs[stage].map.pads;
    for (const [seed, { map, nav }] of built[stage]) {
      assert.equal(
        map.pads.length,
        padSpecs.reduce((count, spec) => count + spec.count, 0),
        `${stage} seed ${seed}`,
      );
      const walls = groundBlockedMask(nav);
      const home = [nav.grid.home];
      const out = routeReach(nav, mobilityClasses.ground, home, false);
      const back = routeReach(nav, mobilityClasses.ground, home, true);
      for (const pad of map.pads) {
        const padSpec = padSpecs.find((spec) => spec.tag === pad.tag);
        const name = `${stage} seed ${seed} pad at ${pad.x.toFixed(1)},${pad.z.toFixed(1)}`;
        const cell = cellAt(nav.grid, pad.x, pad.z);
        assert.equal(pad.tag, padSpec.tag);
        assert.ok(Math.hypot(pad.x, pad.z) > 7 + pad.radius, `${name} overlaps the spawn clearing`);
        assert.ok(out[cell] === 1 && back[cell] === 1, `${name} is not reachable both ways`);
        for (const [x, z] of discPoints(pad.x, pad.z, pad.radius - 0.5)) {
          assert.ok(
            Math.abs(heightAt(map.terrain, x, z) - pad.height) < 1e-3,
            `${name} is not flat`,
          );
          assert.ok(steepnessAt(nav.grid, x, z) <= padSpec.maxSlope, `${name} is too steep`);
          assert.ok(!wallAt(walls, x, z), `${name} has a wall`);
        }
        for (const o of map.obstacles) {
          const clear = Math.hypot(o.x - pad.x, o.z - pad.z) >= pad.radius + PAD_RIM + o.radius;
          assert.ok(!o.solid || clear, `${name} has a ${o.kind} on it`);
        }
        for (const p of map.water.puddles) {
          assert.ok(
            Math.hypot(p.x - pad.x, p.z - pad.z) >= pad.radius + p.radius,
            `${name} has water`,
          );
        }
      }
    }
  }
});

test("puddles hold water exactly inside their outline and keep off walls, pads and the spawn clearing", () => {
  for (const stage of STAGES) {
    const [least, most] = stageDefs[stage].map.puddles.count;
    for (const [seed, { map }] of built[stage]) {
      const { puddles } = map.water;
      assert.ok(
        puddles.length >= least && puddles.length <= most,
        `seed ${seed}: ${puddles.length}`,
      );
      const walls = groundBlockedMask(createNav(map.terrain));
      // Ponds may sit closer than their bounding discs, so "outside" means outside every outline.
      const nearestShore = (x, z) => Math.min(...puddles.map((p) => shoreDistance(p, x, z)));
      for (const p of puddles) {
        const name = `seed ${seed} puddle at ${p.x.toFixed(1)},${p.z.toFixed(1)}`;
        assert.ok(waterDepthAt(map.water, p.x, p.z) > 0.03, `${name} is dry at the centre`);
        // What gameplay reads (waterDepthAt) agrees with the outline away from the half-metre grid's blur.
        for (const [x, z] of discPoints(p.x, p.z, p.radius)) {
          const d = nearestShore(x, z);
          const depth = waterDepthAt(map.water, x, z);
          if (d < -0.3) assert.ok(depth > 0, `${name} is dry inside its outline`);
          if (d > 0.3) assert.ok(depth <= 0, `${name} spills past its outline`);
          if (shoreDistance(p, x, z) < 0.9)
            assert.ok(!wallAt(walls, x, z), `${name} sits on a wall`);
        }
        assert.ok(Math.hypot(p.x, p.z) > 7 + p.radius, `${name} is in the spawn clearing`);
      }
    }
  }
});

/** Grid points inside a puddle's outline, relative to its centre. */
function wetPoints(p, step) {
  const points = [];
  for (let x = -p.radius; x <= p.radius; x += step)
    for (let z = -p.radius; z <= p.radius; z += step)
      if (shoreDistance(p, p.x + x, p.z + z) < 0) points.push([x, z]);
  return points;
}

/** Long axis over short axis of the wet area (principal axes of its points). */
function aspect(points) {
  const n = points.length;
  const mx = points.reduce((a, [x]) => a + x, 0) / n;
  const mz = points.reduce((a, [, z]) => a + z, 0) / n;
  let xx = 0,
    zz = 0,
    xz = 0;
  for (const [x, z] of points) {
    xx += (x - mx) ** 2;
    zz += (z - mz) ** 2;
    xz += (x - mx) * (z - mz);
  }
  const half = (xx + zz) / 2;
  const spread = Math.sqrt(half * half - (xx * zz - xz * xz));
  return Math.sqrt((half + spread) / (half - spread));
}

/** Whether some straight line between two wet points crosses dry land (the outline bends inward). */
function concave(p, points) {
  return points.some(([ax, az], i) =>
    points.some(
      ([bx, bz], j) => j > i && shoreDistance(p, p.x + (ax + bx) / 2, p.z + (az + bz) / 2) > 0.25,
    ),
  );
}

test("puddles come in all kinds of shapes and sizes", () => {
  const all = [...built.forest.values()].flatMap(({ map }) => map.water.puddles);
  const shapes = all.map((p) => {
    const points = wetPoints(p, 0.4);
    return { area: points.length * 0.16, aspect: aspect(points), concave: concave(p, points) };
  });
  const areas = shapes.map((s) => s.area);
  assert.ok(
    Math.max(...areas) > 8 * Math.min(...areas),
    `areas ${areas.map((a) => a.toFixed(1)).join(", ")}`,
  );
  assert.ok(
    shapes.some((s) => s.aspect > 2.5),
    "no elongated puddle",
  );
  assert.ok(
    shapes.some((s) => s.concave),
    "no puddle with a cove, dent or inner curve",
  );
  assert.ok(
    shapes.some((s) => s.aspect < 1.5 && !s.concave),
    "no plain round puddle",
  );
});

test("the same seed and spec generate the same map", () => {
  for (const stage of STAGES) {
    const { map: again } = generateMap(SEEDS[2], stageDefs[stage].map);
    const first = built[stage].get(SEEDS[2]).map;
    assert.deepEqual(again.terrain.heights, first.terrain.heights);
    assert.deepEqual(again.pads, first.pads);
    assert.deepEqual(again.water, first.water);
    assert.deepEqual(again.obstacles, first.obstacles);
    assert.deepEqual(again.passages, first.passages);
  }
});

test("an impossible requirement throws an error that names it", () => {
  const castle = { ...forestMap, pads: [{ tag: "castle", radius: 30, count: 1, maxSlope: 0.05 }] };
  assert.throws(() => generateMap(SEEDS[0], castle), /「castle」平台.*半径 30/);
  const lake = { ...forestMap, puddles: { ...forestMap.puddles, count: [300, 300] } };
  assert.throws(() => generateMap(SEEDS[0], lake), /至少 300 个水洼/);
});

test("a run whose drawn seed cannot fit the map starts on the next seed instead of crashing", () => {
  // 127704 cannot fit both building pads (found by scanning seeds).
  const unfit = 127704;
  assert.throws(() => generateMap(unfit, forestMap), /「building」平台/);
  let next = unfit;
  const world = createWorldFromSeeds(
    { stage: "forest", difficulty: 0, players: [{ starter: "pikachu" }] },
    () => next++,
  );
  assert.equal(world.seed, unfit + 1);
});

test("a ground enemy standing in a puddle loses its burn and gets wet; a flyer stays dry", () => {
  const world = createWorld({
    stage: "forest",
    seed: SEEDS[0],
    difficulty: 0,
    players: [{ starter: "bulbasaur" }],
  });
  world.spawn.credit = -Infinity;
  const [puddle] = world.map.water.puddles;
  const walker = spawnEnemy(world, "caterpie", puddle.x, puddle.z);
  const flyer = spawnEnemy(world, "pidgey", puddle.x, puddle.z);
  for (const enemy of [walker, flyer]) {
    enemy.hp = enemy.maxHp = Infinity;
    apply(enemy, "burn", 3, 1, -1);
  }
  stepWorld(world, []);
  assert.ok(!has(walker, "burn"));
  assert.ok(has(walker, "wet"), "the walker is wet");
  assert.ok(has(flyer, "burn"), "the flyer keeps burning");
  assert.ok(!has(flyer, "wet"), "the flyer stays dry");
});

test("the desert's stamps run through the same pipeline: each ramp climbs its landform, and runs start", () => {
  const explicit = stageDefs.desert.map.passages.length;
  for (const [seed, { map }] of built.desert) {
    // Past the explicit passages, every passage is a stamp ramp: it must climb onto the landform.
    for (const passage of map.passages.slice(explicit)) {
      const heights = [];
      const [[ax, az], [bx, bz]] = passage.points;
      for (let t = 0; t <= 1; t += 0.05)
        heights.push(heightAt(map.terrain, ax + (bx - ax) * t, az + (bz - az) * t));
      const rise = Math.max(...heights) - Math.min(...heights);
      assert.ok(rise > 1.2, `seed ${seed} ramp at ${ax.toFixed(1)},${az.toFixed(1)} rises ${rise}`);
    }
  }
  // createWorld runs the final acceptance (stations, spawns, every passage and ramp) and throws on failure.
  for (const seed of SEEDS.slice(0, 4)) {
    const config = { stage: "desert", seed, difficulty: 0, players: [{ starter: "pikachu" }] };
    assert.doesNotThrow(() => createWorld(config), `desert seed ${seed}`);
  }
});

// ---- Final acceptance counterexamples (synthetic terrain, the real nav and rules) ------------------

const bodies = { playerMin: 0.45, playerMax: 0.6, ground: 1.3 };
const spawn = { x: 0, z: 0 };

/** A nav on a heightfield given by `height(x, z)`. */
function navOn(height) {
  const resolution = 2;
  const samples = TERRAIN_HALF * 2 * resolution + 1;
  const heights = new Float32Array(samples * samples);
  for (let j = 0; j < samples; j++)
    for (let i = 0; i < samples; i++)
      heights[j * samples + i] = height(
        -TERRAIN_HALF + i / resolution,
        -TERRAIN_HALF + j / resolution,
      );
  return createNav({ origin: -TERRAIN_HALF, resolution, samples, heights, step: 1, levels: 1 });
}

const accept = (nav, spots) =>
  checkPlayable(
    nav,
    { spawns: [spawn], landmarks: [], stations: [], passages: [], ...spots },
    bodies,
    "test",
  );

test("a template wall stops the body's footprint and a fast projectile at the same visible cells", () => {
  const spec = {
    ...tower.map,
    pads: [],
    templates: [
      {
        id: "cover",
        passages: [],
        blocks: [{ kind: "wall", at: [10, 0], size: [0.5, 12], height: 3 }],
      },
    ],
  };
  const { map, nav } = generateMap(7919, spec);
  const block = resolveLayout(7919, spec).floor.blocks[0];
  const [x, z] = block.at;
  const [dx, dz] = block.size[0] < block.size[1] ? [1, 0] : [0, 1];
  const start = { x: x - dx * 2, z: z - dz * 2, radius: 0.6 };
  const body = { ...start };
  moveWithSlope(nav, mobilityClasses.ground, body, dx * 4, dz * 4);
  const distance = (body.x - start.x) * dx + (body.z - start.z) * dz;
  assert.ok(distance <= 1.75 - body.radius + 1e-9, "whole body stays in front of the wall");
  assert.equal(bodyFits(nav, mobilityClasses.ground, x - dx * 0.8, z - dz * 0.8, 0.6), false);
  const shot = {
    id: 1,
    px: start.x,
    py: 0.7,
    pz: start.z,
    x: x + dx * 2,
    y: 0.7,
    z: z + dz * 2,
    vx: dx * 4,
    vy: 0,
    vz: dz * 4,
    life: 1,
  };
  const cover = { map, events: [] };
  assert.equal(stopAtCover(cover, shot), true);
  assert.equal(shot.life, 0);
  assert.equal((shot.x - start.x) * dx + (shot.z - start.z) * dz, 1.75);
  assert.equal(cover.events[0].t, "impact");
  assert.equal(
    coverHit(cover, start.x, 4, start.z, dx, dz, 0, 4),
    Infinity,
    "shots above the wall pass",
  );
});

test("rotated tower templates keep their required passages, and final acceptance rejects a plugged one", () => {
  for (const floor of towerFloors) {
    for (const seed of [7919, 1]) {
      const spec = { ...tower.map, templates: [floor] };
      const { map, nav } = generateMap(seed, spec);
      const spots = {
        spawns: [spawn],
        landmarks: map.pads.filter((pad) => pad.tag === "landmark"),
        stations: [],
        passages: map.passages,
      };
      const largest = stageBodies(tower);
      const check = () => checkPlayable(nav, spots, largest, `${floor.id} ${seed}`);
      assert.doesNotThrow(check);
      if (seed === 1) {
        assert.equal(
          Math.abs(map.passages[0].points[0][0]),
          0,
          "the authored horizontal passage rotated to vertical",
        );
        const [px, pz] = map.passages[0].points[0];
        addCellBlocker(nav, [cellAt(nav.grid, px / 2, pz / 2)]);
        assert.throws(check, /通道.*过不去/, "the assembled check includes template passages");
      }
    }
  }
});

test("acceptance: a prop sealing the only gap fails a station the terrain alone can reach", () => {
  // A sheer ring around the station, open toward spawn.
  const nav = navOn((x, z) => {
    const d = Math.hypot(x - 20, z);
    return d >= 6 && d <= 7 && !(x < 20 && Math.abs(z) < 1.5) ? 3 : 0;
  });
  const stations = [{ x: 20, z: 0, radius: 0.6, reach: 0.5 }];
  assert.doesNotThrow(() => accept(nav, { stations }));
  assert.doesNotThrow(() => accept(nav, { landmarks: stations }));
  addCircleBlocker(nav, 13.5, 0, 1.4);
  assert.throws(() => accept(nav, { stations }), /站点 \(20\.0, 0\.0\) 周围没有能往返的位置/);
  assert.throws(() => accept(nav, { landmarks: stations }), /守卫地标 \(20\.0, 0\.0\)/);
});

test("acceptance: a station reached down a one-way face fails once a prop blocks the ramp back", () => {
  // A pit at −2: its west side a face ground units can only walk down (grade 1), the others sheer
  // except a gentle ramp up the north side.
  const nav = navOn((x, z) => {
    const inPit = x >= 14 && x <= 26 && Math.abs(z) <= 6;
    if (inPit) return -2;
    if (x >= 12 && x < 14 && Math.abs(z) <= 6) return -(x - 12);
    if (x >= 18 && x <= 22 && z > 6 && z <= 6 + 2 / 0.3) return -2 + (z - 6) * 0.3;
    return 0;
  });
  const stations = [{ x: 20, z: 0, radius: 0.6, reach: 0.5 }];
  assert.doesNotThrow(() => accept(nav, { stations }));
  addCircleBlocker(nav, 20, 9, 2.2);
  const out = routeReach(nav, mobilityClasses.ground, [cellAt(nav.grid, 0, 0)], false);
  assert.equal(out[cellAt(nav.grid, 18, 0)], 1, "the drop still leads down to the station");
  assert.throws(() => accept(nav, { stations }), /站点 \(20\.0, 0\.0\)/);
});

test("acceptance: a station whose interaction zone is covered by a prop fails", () => {
  const nav = navOn(() => 0);
  const stations = [{ x: 15, z: 0, radius: 0.6, reach: 0.5 }];
  assert.doesNotThrow(() => accept(nav, { stations }));
  addCircleBlocker(nav, 15, 0, 2.5);
  assert.throws(() => accept(nav, { stations }), /站点 \(15\.0, 0\.0\)/);
});

test("acceptance: a passage a route threads but the largest ground body cannot fails", () => {
  const nav = navOn(() => 0);
  const passages = [
    {
      points: [
        [5, 0],
        [30, 0],
      ],
      width: 4,
    },
  ];
  assert.doesNotThrow(() => accept(nav, { passages }));
  addCircleBlocker(nav, 18, 1.6, 0.6);
  addCircleBlocker(nav, 18, -1.6, 0.6);
  const out = routeReach(nav, mobilityClasses.ground, [cellAt(nav.grid, 0, 0)], false);
  assert.equal(out[cellAt(nav.grid, 25, 0)], 1, "a route still runs between the rocks");
  assert.throws(() => accept(nav, { passages }), /过不去半径 1\.3 的身体/);
});

test("a finite crevasse cannot cut a required passage: its crossing stays a wide causeway", () => {
  const passages = [
    {
      points: [
        [0, 0],
        [24, 0],
      ],
      width: 7,
    },
  ];
  const trench = {
    kind: "trench",
    points: [
      [12, -14],
      [12, 14],
    ],
    width: 2,
    depth: 4,
    edge: 0.8,
  };
  const terrain = () =>
    createTerrain(
      7919,
      {
        ...forestMap.terrain,
        levels: 1,
        step: 0.1,
        undulation: 0,
        cliffRamp: 1,
        gentleRamp: 1,
      },
      passages,
    );
  const broken = terrain();
  applyStamps(broken, [trench], []);
  assert.throws(() => accept(createNav(broken), { passages }), /通道/);
  const protectedGround = terrain();
  applyStamps(protectedGround, [trench], passages);
  assert.doesNotThrow(() => accept(createNav(protectedGround), { passages }));
  assert.ok(
    heightAt(protectedGround, 12, 8) < -3,
    "the finite crevasse remains beside the crossing",
  );
});

test("lava hurts through the hazard hit path, stays walkable, and never douses an existing burn", () => {
  const world = createWorld({
    stage: "volcano",
    seed: 7919,
    difficulty: 0,
    players: [{ starter: "pikachu" }],
  });
  const { terrain } = world.map;
  assert.equal(world.map.water.puddles.length, 0, "the dry volcanic stage requests no water pools");
  const index = terrain.surface.lava.values.findIndex((depth) => depth > 0.3);
  assert.ok(index >= 0);
  const x = terrain.origin + (index % terrain.samples) / terrain.resolution;
  const z = terrain.origin + Math.floor(index / terrain.samples) / terrain.resolution;
  const surface = sampleSurface(terrain.surface, x, z);
  assert.equal(surface.kind, "lava");
  assert.equal(surface.waterDepth, 0);
  const reachable = routeReach(world.nav, mobilityClasses.ground, [world.nav.grid.home], false);
  assert.equal(
    reachable[cellAt(world.nav.grid, x, z)],
    1,
    "lava remains walkable under the shared nav rule",
  );
  const player = world.players[0];
  Object.assign(player, { x, z, invulnerable: 0, dashTime: 0 });
  const hp = player.hp;
  world.tick = 15;
  updateHazards(world, 1 / 30);
  assert.ok(player.hp < hp);
  const after = player.hp;
  updateHazards(world, 1 / 30);
  assert.equal(player.hp, after, "the shared hit path respects i-frames");
  const walker = spawnEnemy(world, "caterpie", x, z);
  apply(walker, "burn", 3, 1, -1);
  world.spawn.credit = -Infinity;
  player.moves = [];
  stepWorld(world, []);
  assert.ok(has(walker, "burn"), "lava must not run the water douse rule");
  assert.ok(!has(walker, "wet"), "lava is not water");
  assert.ok(walker.hp < walker.maxHp, "burn still settles through the existing enemy DoT path");
});
