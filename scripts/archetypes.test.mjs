import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import test from "node:test";
import { updateAreas, updateMoves, updateProjectiles } from "../src/run/sim/attacks.ts";
import { acquire, chestOf, nearest } from "../src/run/sim/archetypes/kit.ts";
import { moves } from "../src/run/sim/content/moves.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { TERRAIN_HALF } from "../src/run/sim/terrain.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { newMoveState } from "../src/run/sim/upgrades.ts";
import { createWorld } from "../src/run/sim/world.ts";

function terrainOf(height) {
  const resolution = 2;
  const samples = TERRAIN_HALF * 2 * resolution + 1;
  const heights = new Float32Array(samples * samples);
  for (let j = 0; j < samples; j++)
    for (let i = 0; i < samples; i++)
      heights[j * samples + i] = height(
        -TERRAIN_HALF + i / resolution,
        -TERRAIN_HALF + j / resolution,
      );
  return { origin: -TERRAIN_HALF, resolution, samples, heights, step: 1.5, levels: 3 };
}

const flat = () => 0;

/** Charmander (no grass or drain healing of its own) at the origin on a hand-made heightfield. */
function arena(height = flat) {
  const world = createWorld({
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [{ starter: "charmander" }],
  });
  world.map.terrain = terrainOf(height);
  world.map.obstacles = [];
  world.players[0].moves = [];
  return world;
}

function dummy(world, x, z, hp = 1e6) {
  const enemy = spawnEnemy(world, "caterpie", x, z);
  enemy.x = enemy.px = x;
  enemy.z = enemy.pz = z;
  enemy.hp = enemy.maxHp = hp;
  return enemy;
}

const hurt = (enemy) => enemy.hp < enemy.maxHp;
const rock = (x, z, radius) => ({ kind: "rock", x, z, radius, scale: 1, rotation: 0, solid: true });

/** Runs the player's attacks only; `each(tick)` runs before every tick (moving targets). */
function fight(world, moveIds, seconds, each = () => {}) {
  const player = world.players[0];
  player.moves = moveIds.map((id) => newMoveState(id));
  for (const state of player.moves) state.cooldown = 0;
  const ctx = { world, grid: new EnemyGrid() };
  for (let tick = 0; tick < seconds / TICK; tick++) {
    each(tick);
    ctx.grid.rebuild(world.enemies);
    updateMoves(ctx, player, TICK);
    updateProjectiles(ctx, TICK);
    updateAreas(ctx, TICK);
  }
}

test("target selection keeps enemy array order for equal distances across casts and deaths", () => {
  const world = arena();
  const player = world.players[0];
  player.x = player.z = 0;
  const first = dummy(world, -4, 0);
  const second = dummy(world, 0, 4);
  const third = dummy(world, 0, -4);
  const hidden = dummy(world, 3, 0);
  const closer = dummy(world, -2, 0);
  world.map.obstacles = [rock(1.5, 0, 0.5)];
  // Array order, not spawn ID, breaks ties; the later closer enemy displaces the last tie.
  world.enemies = [hidden, third, first, second, closer];
  const selected = acquire(world, player, 3);
  assert.deepEqual(selected, [closer, third, first]);
  assert.deepEqual(acquire(world, player, 1), [closer]);
  assert.deepEqual(selected, [closer, third, first]);
  third.hp = 0;
  const eye = chestOf(world.map.terrain, player);
  assert.deepEqual(nearest(world, 0, eye, 0, 3, 4), [closer, first, second]);
});

test("a homing shot follows a target that sidesteps after the cast; a bolt misses it", () => {
  const sidestep = (world, enemy) => (tick) => {
    // Cast happens on tick 0; from then on the target strafes 2.5 m/s sideways.
    if (tick > 0) enemy.z = enemy.pz = Math.min(3, enemy.z + 2.5 * TICK);
  };
  for (const [move, homes] of [
    ["shock-wave", true],
    ["ember", false],
  ]) {
    const world = arena();
    const target = dummy(world, 7, 0);
    fight(world, [move], 1.0, sidestep(world, target));
    assert.equal(hurt(target), homes, move);
  }
});

test("a homing shot steering at an enemy behind a rock stops at the rock", () => {
  const world = arena();
  world.map.obstacles = [rock(3, 0, 0.8)];
  const hidden = dummy(world, 6, 0);
  world.projectiles.push({
    id: world.nextId++,
    owner: 0,
    move: "shock-wave",
    archetype: "homing",
    type: "electric",
    x: 0,
    y: 0.7,
    z: 0,
    px: 0,
    py: 0.7,
    pz: 0,
    vx: 13,
    vy: 0,
    vz: 0,
    life: 1.4,
    radius: 0.2,
    dmg: 10,
    pierce: 0,
    area: 0.2,
    dur: 1.4,
    statusChance: 0,
    crit: 0,
    hit: [],
    delay: 0,
    target: hidden.id,
  });
  fight(world, [], 0.6);
  assert.ok(!hurt(hidden));
  assert.ok(world.events.some((event) => event.t === "impact"));
});

test("drain heals a share of the HP the hit actually removed, not of its damage", () => {
  const share = moves["giga-drain"].drain;
  for (const hp of [3, 1e6]) {
    const world = arena();
    const player = world.players[0];
    player.hp = 20;
    const target = dummy(world, 4, 0, hp);
    fight(world, ["giga-drain"], 0.6);
    const removed = Math.min(hp, target.maxHp - target.hp);
    assert.ok(removed > 0, `hp ${hp}: hit`);
    assert.ok(
      Math.abs(player.hp - 20 - removed * share) < 1e-9,
      `hp ${hp}: healed ${player.hp - 20}`,
    );
  }
});

test("a lobbed shell clears a low ridge a straight shot can't and bursts at the aimed point", () => {
  const ridge = (x, z) => (x >= 2.5 && x <= 3.5 && Math.abs(z) <= 3 ? 1.2 : 0);
  const bolt = arena(ridge);
  const sheltered = dummy(bolt, 6, 0);
  fight(bolt, ["ember"], 1);
  assert.ok(!hurt(sheltered), "the ridge blocks line of sight");

  const world = arena(ridge);
  const target = dummy(world, 6, 0);
  const ctx = { world, grid: new EnemyGrid() };
  const player = world.players[0];
  player.moves = [{ ...newMoveState("seed-bomb"), cooldown: 0 }];
  let burst;
  for (let tick = 0; tick < 40 && !burst; tick++) {
    ctx.grid.rebuild(world.enemies);
    updateMoves(ctx, player, TICK);
    updateProjectiles(ctx, TICK);
    burst = world.areas.find((a) => a.kind === "burst");
  }
  assert.ok(burst, "the shell landed");
  assert.ok(Math.hypot(burst.x - 6, burst.z) < 0.6, `burst at ${burst.x}, ${burst.z}`);
  updateAreas(ctx, TICK);
  assert.ok(hurt(target));
});

test("a wave rolls outward, shoves along its travel, and a rock shelters only its own lane", () => {
  const world = arena();
  const near = dummy(world, 1.5, 0.2);
  const far = dummy(world, 6, 0.3);
  const firstHurt = new Map();
  fight(world, ["surf"], 1, (tick) => {
    for (const enemy of [near, far])
      if (hurt(enemy) && !firstHurt.has(enemy)) firstHurt.set(enemy, tick);
  });
  assert.ok(hurt(near) && hurt(far));
  assert.ok(firstHurt.get(far) > firstHurt.get(near) + 10, "the far enemy is reached later");
  for (const enemy of [near, far]) {
    assert.ok(enemy.knockX > 0, "pushed forward");
    assert.ok(Math.abs(enemy.knockZ) < enemy.knockX * 0.2, "not flung sideways");
  }

  const rocky = arena();
  rocky.map.obstacles = [rock(4, 0, 0.6)];
  const lee = dummy(rocky, 5.2, 0);
  const open = dummy(rocky, 5.2, 1.2);
  fight(rocky, ["surf"], 1);
  assert.ok(hurt(open));
  assert.ok(!hurt(lee), "the rock is on this enemy's lane");
});

test("a nova strikes every enemy within its radius around the caster once, and nothing beyond", () => {
  const world = arena();
  const r = moves["lava-plume"].area;
  const ring = [0, 1, 2, 3].map((i) =>
    dummy(world, Math.cos((i * Math.PI) / 2) * r * 0.8, Math.sin((i * Math.PI) / 2) * r * 0.8),
  );
  const beyond = dummy(world, r + 1.2, 0);
  fight(world, ["lava-plume"], 0.5);
  for (const enemy of ring) assert.ok(hurt(enemy), `at ${enemy.x}, ${enemy.z}`);
  assert.equal(
    world.events.filter((event) => event.t === "hit").length,
    ring.length,
    "one hit each",
  );
  assert.ok(!hurt(beyond));
});

test("every sim module loads first on its own (no load-order cycle)", () => {
  const dir = new URL("../src/run/sim/", import.meta.url);
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".ts"),
  );
  // One process per file (each needs a fresh module graph). Waited for synchronously: under load,
  // bun 1.4.4 inside a --parallel worker can miss an async child's exit and spin forever.
  for (const file of files) {
    const url = new URL(file, dir).href;
    const child = spawnSync(process.execPath, ["-e", `await import(${JSON.stringify(url)});`], {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(child.status, 0, `${file} fails when loaded first\n${child.stderr}`);
  }
});

test("every move casts through its archetype and damages an enemy in front of the caster", () => {
  for (const id of Object.keys(moves)) {
    const world = arena();
    const target = dummy(world, 1.5, 0);
    fight(world, [id], 2);
    assert.ok(hurt(target), id);
  }
});

test("a ready move with nothing in range waits ready, and casts when a target arrives", () => {
  // The HUD shows a waiting move full: its 0.2 s retry must not read as a cooldown.
  const world = arena();
  const player = world.players[0];
  player.moves = [newMoveState("ember")];
  player.moves[0].cooldown = 0;
  const ctx = { world, grid: new EnemyGrid() };
  const tick = () => {
    ctx.grid.rebuild(world.enemies);
    updateMoves(ctx, player, TICK);
  };
  for (let i = 0; i < 30; i++) {
    tick();
    assert.equal(player.moves[0].waiting, true, `tick ${i}: nothing in range, still waiting`);
  }
  dummy(world, 3, 0);
  for (let i = 0; i < 10 && player.moves[0].waiting; i++) tick();
  assert.equal(player.moves[0].waiting, undefined, "the cast ends the wait");
  assert.ok(player.moves[0].cooldown > 0.2, "and starts a real cooldown");
});
