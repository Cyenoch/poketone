import assert from "node:assert/strict";
import { test } from "node:test";
import { updateAreas, updateMoves, updateProjectiles } from "../src/run/sim/attacks.ts";
import { damageEnemy } from "../src/run/sim/combat.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { newMoveState } from "../src/run/sim/upgrades.ts";
import { createWorld } from "../src/run/sim/world.ts";
import { fireUltimate, updateUltimate } from "../src/run/sim/ultimates/index.ts";
import { createTerrainUniforms } from "../src/run/view/terrain.ts";
import { Vfx } from "../src/run/view/vfx.ts";
import { Shape } from "../src/run/view/vfx/sprites.ts";

function arena(t, starter = "abra") {
  const world = createWorld({
    mode: "expedition",
    rules: [],
    stage: "forest",
    seed: 154,
    difficulty: 0,
    players: [{ trainer: "chengxi", starter }],
  });
  world.map.terrain.heights.fill(0);
  world.map.obstacles = [];
  world.enemies = [];
  const player = world.players[0];
  player.x = player.px = player.z = player.pz = 0;
  player.moves = [];
  // A group in melee range and one down the beam: exercises side shards and terminal bursts too.
  for (const [x, z] of [
    [0, 2],
    [0.2, 2.1],
    [-0.2, 2.1],
    [0, 2.2],
    [0, 10],
  ]) {
    const enemy = spawnEnemy(world, "caterpie", x, z);
    enemy.hp = enemy.maxHp = 1e6;
  }
  const uniforms = createTerrainUniforms(world.map.terrain);
  const vfx = new Vfx({ uniforms, heightAt: () => 0 }, "forest");
  const ctx = { world, grid: new EnemyGrid() };
  ctx.grid.rebuild(world.enemies);
  const update = (dt = TICK) => vfx.update(world, 1, dt, 0, player, new Map());
  t.after(() => {
    vfx.dispose();
    uniforms.uTerrainHeight.value.dispose();
  });
  return { world, player, ctx, vfx, update };
}

function inspect(vfx) {
  let vertices = 0;
  const shapes = new Set();
  vfx.root.traverse((mesh) => {
    if (!mesh.visible || !mesh.geometry) return;
    const g = mesh.geometry;
    const count = Number.isFinite(g.instanceCount)
      ? g.instanceCount
      : Number.isFinite(g.drawRange.count)
        ? g.drawRange.count / 3 + 2
        : 0;
    if (!count) return;
    vertices += count;
    const form = g.getAttribute("iForm");
    if (form) for (let i = 0; i < count; i++) shapes.add(form.getW(i));
    for (const attr of Object.values(g.attributes)) {
      if (!attr.isInterleavedBufferAttribute) continue;
      for (let i = 0; i < Math.min(count, attr.count); i++) {
        for (let c = 0; c < attr.itemSize; c++)
          assert.ok(Number.isFinite(attr.data.array[i * attr.data.stride + attr.offset + c]));
      }
    }
  });
  return { vertices, shapes };
}

test("hypnosis hits keep damage but omit white contact flashes, including predicted contacts", (t) => {
  const { world, player, ctx, vfx, update } = arena(t);
  player.moves = [newMoveState("hypnosis")];
  player.moves[0].cooldown = 0;
  updateMoves(ctx, player, TICK);
  updateAreas(ctx, TICK);
  const hits = world.events.filter((e) => e.t === "hit");
  assert.ok(hits.length > 0 && world.enemies.some((e) => e.hp < e.maxHp));
  assert.ok(
    world.enemies.every((e) => e.flash === 0),
    "control ticks do not whiten targets",
  );
  for (const hit of hits) {
    assert.equal(hit.move, "hypnosis");
    vfx.handle(hit);
    vfx.handle({ t: "contact", x: hit.x, z: hit.z, by: hit.by, type: hit.type, move: hit.move });
  }
  world.areas = [];
  for (const enemy of world.enemies) enemy.statuses = [];
  update();
  assert.equal(inspect(vfx).vertices, 0, "neither hit path adds a generic impact spark");

  const enemy = world.enemies[0];
  const attack = {
    owner: player,
    move: "confusion",
    type: "psychic",
    dmg: 2,
    crit: 0,
    statusChance: 0,
    knock: 0,
    fromX: 0,
    fromZ: 0,
  };
  damageEnemy(ctx, enemy, attack);
  assert.ok(enemy.flash > 0, "other moves retain their contact flash");
  vfx.handle(world.events.at(-1));
  update();
  assert.ok(inspect(vfx).vertices > 0, "other moves retain their contact spark");
  enemy.flash /= 2;
  const remaining = enemy.flash;
  damageEnemy(ctx, enemy, { ...attack, move: "hypnosis" });
  assert.equal(
    enemy.flash,
    remaining,
    "hypnosis neither restarts nor cancels another move's flash",
  );
});

for (const move of [
  "confusion",
  "hypnosis",
  "psybeam",
  "psychic",
  "future-sight",
  "psyshock",
  "psystrike",
  "rock-throw",
  "rollout",
  "magnitude",
  "rock-slide",
  "earthquake",
  "stone-edge",
  "tectonic-rage",
])
  test(`${move}: real sim casts draw finite geometry, preserve state and clean up`, (t) => {
    const { world, player, ctx, vfx, update } = arena(t);
    player.moves = [newMoveState(move)];
    player.moves[0].cooldown = 0;
    // An upgraded cast exercises extra simultaneous areas/projectiles and the wider footprint.
    player.moves[0].mods.area = 1;
    player.moves[0].mods.count = 2;
    updateMoves(ctx, player, TICK);
    assert.ok(
      world.events.some((e) => e.t === "cast"),
      `${move} must actually cast`,
    );
    let drawn = false;
    let sideShards = false;
    let finale = false;
    for (let tick = 0; tick < 150; tick++) {
      updateProjectiles(ctx, TICK);
      updateAreas(ctx, TICK);
      sideShards ||= world.projectiles.some((p) => p.move === "psystrike");
      finale ||= world.areas.some((a) => a.kind === "burst");
      for (const e of world.events) vfx.handle(e);
      world.events.length = 0;
      const before = JSON.stringify([world.areas, world.projectiles, world.rng, player]);
      update();
      drawn ||= inspect(vfx).vertices > 0;
      assert.equal(JSON.stringify([world.areas, world.projectiles, world.rng, player]), before);
    }
    assert.ok(drawn);
    if (move === "psystrike") assert.ok(sideShards && finale, "test must exercise the whole bloom");
    if (move === "tectonic-rage" || move === "rock-throw") assert.ok(finale);
    // Attack-only stepping intentionally leaves sleep statuses active; their markers are not residue.
    for (const enemy of world.enemies) enemy.statuses = [];
    update();
    assert.equal(inspect(vfx).vertices, 0, "expired effects must release their pools");
  });

for (const move of ["psychic", "future-sight", "psybeam", "psystrike"])
  test(`${move}: charged impact waits for the actual damage tick`, (t) => {
    const { world, player, ctx, vfx, update } = arena(t);
    player.moves = [newMoveState(move)];
    player.moves[0].cooldown = 0;
    updateMoves(ctx, player, TICK);
    update();
    let crossed = false;
    let landed = false;
    for (let tick = 0; tick < 60; tick++) {
      const previous = world.enemies[0].hp;
      updateAreas(ctx, TICK);
      const hit = world.enemies[0].hp < previous;
      update(); // Ignore generic hit events: check the move's own impact peak.
      const peak = inspect(vfx).shapes.has(Shape.star);
      if (!landed) {
        assert.equal(peak, hit, `tick ${tick}: peak must coincide with first damage`);
        crossed ||= world.areas.some((a) => a.delay <= 0 && a.tickTimer === 0);
      }
      if (hit) {
        landed = true;
        break;
      }
    }
    assert.ok(crossed && landed, "exercise both delay consumption and actual damage");
  });

function ribbonPoints(vfx) {
  const mesh = vfx.root.children.find((m) => m.geometry?.getAttribute("meta"));
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const indices = g.index.array.subarray(0, g.drawRange.count);
  const count = indices.length ? Math.max(...indices) + 1 : 0;
  return Array.from({ length: count / 2 }, (_, i) => [
    pos.getX(i * 2),
    pos.getY(i * 2),
    pos.getZ(i * 2),
  ]);
}

for (const upgraded of [false, true])
  test(`hypnosis: ${upgraded ? "upgraded" : "normal"} waves follow the interpolated caster, preserve cast aim and stay inside the real cone`, (t) => {
    const { world, player, ctx, vfx } = arena(t);
    player.moves = [newMoveState("hypnosis")];
    const move = player.moves[0];
    move.cooldown = 0;
    move.mods.area = upgraded ? 1 : 0;
    move.mods.dur = upgraded ? 1 : 0;
    updateMoves(ctx, player, TICK);
    const a = world.areas[0];
    assert.equal(a.move, "hypnosis");
    world.enemies = [];
    a.life = a.maxLife - 0.3;
    const draw = () => {
      vfx.update(world, 0.5, 0, 0, player, new Map());
      return ribbonPoints(vfx);
    };
    const before = JSON.stringify([a, player, world.rng]);
    const original = draw();
    assert.equal(JSON.stringify([a, player, world.rng]), before);
    assert.ok(
      original.length > 0 && original.every(([, y]) => y > 0.5),
      "wavefronts float at chest height, not on the ground",
    );
    const bounds = (points, x, z) => {
      for (const [px, , pz] of points) {
        const dx = px - x;
        const dz = pz - z;
        const d = Math.hypot(dx, dz);
        assert.ok(d <= a.length + 1e-5, "wave and range cue stay within the real reach");
        if (d > 1e-5) assert.ok((dx * a.dirX + dz * a.dirZ) / d >= Math.cos(a.angle) - 1e-5);
      }
    };
    bounds(original, 0, 0);
    player.px = 2;
    player.x = 4;
    player.pz = -4;
    player.z = -2;
    player.faceX = 1;
    player.faceZ = 0;
    const moved = draw();
    bounds(moved, 3, -3);
    assert.equal(moved.length, original.length);
    for (let i = 0; i < original.length; i++) {
      assert.ok(Math.abs(moved[i][0] - original[i][0] - 3) < 1e-5);
      assert.ok(Math.abs(moved[i][2] - original[i][2] + 3) < 1e-5);
    }
    const front = (points) =>
      Math.max(...points.filter((p) => p[1] > 0.2).map((p) => Math.hypot(p[0] - 3, p[2] + 3)));
    updateAreas(ctx, TICK);
    const advanced = draw();
    assert.ok(front(advanced) > front(moved), "suspended fronts advance toward the tip");
    bounds(advanced, 3, -3);
    // A new cast aims at the new target; a held cone never swivels to the avatar's new facing.
    world.areas = [];
    const enemy = spawnEnemy(world, "caterpie", player.x + 2, player.z);
    enemy.hp = enemy.maxHp = 1e6;
    ctx.grid.rebuild(world.enemies);
    move.cooldown = 0;
    updateMoves(ctx, player, TICK);
    const next = world.areas[0];
    assert.ok(next.dirX > 0.99);
    // Exercise an instance with a narrower aperture too; rendering must not assume CONE.angle.
    next.angle *= 0.7;
    next.length *= 0.8;
    next.life = next.maxLife - 0.3;
    const rotated = draw();
    for (const [x, , z] of rotated) {
      const dx = x - 3;
      const dz = z + 3;
      assert.ok(Math.hypot(dx, dz) <= next.length + 1e-5);
      assert.ok(dx / Math.hypot(dx, dz) >= Math.cos(next.angle) - 1e-5);
    }
    updateAreas(ctx, next.life + TICK);
    assert.equal(draw().length, 0, "expired cones leave no travelling wave");
    assert.ok(!inspect(vfx).shapes.has(Shape.spiral), "expired cones leave no hypnotic disc");
  });

test("hypnosis: delayed instances gather at the caster and sleep marks belong only to real status", (t) => {
  const { world, player, ctx, vfx, update } = arena(t);
  player.moves = [newMoveState("hypnosis")];
  player.moves[0].cooldown = 0;
  updateMoves(ctx, player, TICK);
  const a = world.areas[0];
  a.delay = 0.25;
  a.life += a.delay;
  a.maxLife = a.life;
  a.statusChance = 1;
  update(0);
  for (const [x, , z] of ribbonPoints(vfx)) assert.ok(Math.hypot(x, z) < a.length * 0.25);
  assert.ok(!inspect(vfx).shapes.has(Shape.zed), "a cast alone never fabricates sleep");
  while (a.delay > 0) {
    updateAreas(ctx, TICK);
    update(0);
    for (const [x, , z] of ribbonPoints(vfx)) assert.ok(Math.hypot(x, z) < a.length * 0.25);
  }
  updateAreas(ctx, TICK);
  update(0);
  assert.ok(world.enemies.some((e) => e.statuses.some((s) => s.id === "sleep")));
  assert.ok(inspect(vfx).shapes.has(Shape.zed));
  assert.ok(ribbonPoints(vfx).some(([x, , z]) => Math.hypot(x, z) > a.length * 0.5));
  world.areas = [];
  update(0);
  assert.equal(ribbonPoints(vfx).length, 0);
  assert.ok(inspect(vfx).shapes.has(Shape.zed), "sleep persists after the wave ends");
  for (const enemy of world.enemies) enemy.statuses = [];
  update(0);
  assert.equal(inspect(vfx).vertices, 0, "removing sleep removes its mark immediately");
});

for (const starter of ["abra", "geodude"])
  test(`${starter}: all three ultimate tiers play through their real pulse timeline`, (t) => {
    const { world, player, ctx, vfx, update } = arena(t, starter);
    for (const stage of [0, 1, 2]) {
      player.stage = stage;
      player.ult.charge = 1;
      player.ult.protection = 0;
      assert.ok(fireUltimate(world, player));
      const looks = new Set();
      for (let tick = 0; tick < 190; tick++) {
        updateUltimate(ctx, player, TICK);
        for (const e of world.events) {
          if (e.t === "ult-pulse") looks.add(e.look);
          vfx.handle(e);
        }
        world.events.length = 0;
        update();
        inspect(vfx);
      }
      assert.ok(looks.has("ring"));
      assert.ok(looks.has(starter === "abra" ? "roots" : "meteor"));
      if (stage === 2) assert.ok(looks.has("blast"));
      assert.equal(inspect(vfx).vertices, 0, "cast aura and pulses must finish");
    }
  });

test("ground chains draw source-to-target aftershocks at ground height and finish before the next tick", (t) => {
  const { world, vfx, update } = arena(t, "geodude");
  world.areas = [];
  vfx.handle({ t: "chain", type: "ground", points: [1, 2, 4, 5, -3, 6], lift: 3 });
  update(0);
  const mesh = vfx.root.children.find((m) => m.geometry?.getAttribute("meta"));
  const pos = mesh.geometry.getAttribute("position");
  const meta = mesh.geometry.getAttribute("meta");
  const indices = mesh.geometry.index.array.slice(0, mesh.geometry.drawRange.count);
  const vertices = Math.max(...indices) + 1;
  const paths = [];
  for (let i = 0; i < vertices; i++) {
    if (meta.getX(i) !== -1) continue;
    if (meta.getZ(i) === 0) paths.push([]);
    paths.at(-1).push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  }
  const groundPaths = paths.filter((path) => Math.abs(path[0][1] - 0.07) < 1e-5);
  assert.equal(groundPaths.length, 2, "one aftershock for each struck target");
  assert.deepEqual(
    groundPaths.map((path) => [path[0][0], path[0][2]]),
    [
      [1, 2],
      [1, 2],
    ],
  );
  assert.deepEqual(
    groundPaths.map((path) => [path.at(-1)[0], path.at(-1)[2]]),
    [
      [4, 5],
      [-3, 6],
    ],
  );
  for (const path of groundPaths)
    for (const point of path) assert.ok(Math.abs(point[1] - 0.07) < 1e-5);
  update(0.32);
  assert.equal(inspect(vfx).vertices, 0);
});
