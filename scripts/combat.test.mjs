import assert from "node:assert/strict";
import test from "node:test";
import { moveParams, updateAreas, updateMoves, updateProjectiles } from "../src/run/sim/attacks.ts";
import { playerStats, xpForLevel } from "../src/run/sim/stats.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { updateEnemies } from "../src/run/sim/enemies.ts";
import { updateHazards } from "../src/run/sim/hazards.ts";
import {
  ACID,
  LUNGE,
  PSYBEAM,
  STUN_SPORE,
  HARDEN,
  ENEMY_SHOTS,
  RADIAL,
} from "../src/run/sim/content/params/enemy-skills.ts";
import { statuses } from "../src/run/sim/content/statuses.ts";
import { apply, find, has, inflict } from "../src/run/sim/status.ts";
import { addHazard } from "../src/run/sim/skills/kit.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { addCircleBlocker } from "../src/run/sim/nav/index.ts";
import { TERRAIN_HALF } from "../src/run/sim/terrain.ts";
import {
  BOSS_CHASE_MIN,
  BOSS_DASH_TIME,
  BOSS_RECOVER,
} from "../src/run/sim/content/params/guardian.ts";
import { difficulties } from "../src/run/sim/content/difficulties.ts";
import { damageEnemy } from "../src/run/sim/combat.ts";
import { STAGGER } from "../src/run/sim/content/params/combat.ts";
import { pullToward } from "../src/run/sim/archetypes/vortex.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { forest } from "../src/run/sim/content/stages/forest.ts";
import { STARDUST } from "../src/run/sim/content/params/economy.ts";
import { items } from "../src/run/sim/content/items.ts";
import { sampleSurface } from "../src/run/sim/surface.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { newMoveState } from "../src/run/sim/upgrades.ts";
import { BASE_ITEM_SLOTS, BASE_MOVE_SLOTS } from "../src/run/sim/content/params/cards.ts";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";

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

const flat = () => 0;
/** Player at the bottom of a pit: slope from r = 4 up to a rim of 2 at r = 6, back down to 0 by r = 8. */
const pit = (x, z) => {
  const r = Math.hypot(x, z);
  if (r < 4) return 0;
  if (r < 6) return r - 4;
  if (r < 7) return 2;
  return Math.max(0, 2 - (r - 7) * 2);
};
/** A wall of `top` height over the box [x0, x1] × [z0, z1] on flat ground. */
const wall = (x0, x1, z0, z1, top) => (x, z) =>
  x >= x0 && x <= x1 && z >= z0 && z <= z1 ? top : 0;

/** A world on a hand-made heightfield with the player at the origin, starting with no moves. */
function arena(height) {
  const world = createWorld({
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: [{ starter: "bulbasaur" }],
  });
  world.map.terrain = terrainOf(height);
  const player = world.players[0];
  player.invulnerable = 0;
  player.moves = [];
  return world;
}

/** A target dummy that never dies, placed exactly (spawning clamps and slides). */
function dummy(world, species, x, z) {
  const enemy = spawnEnemy(world, species, x, z);
  enemy.x = enemy.px = x;
  enemy.z = enemy.pz = z;
  enemy.hp = enemy.maxHp = 1e6;
  return enemy;
}

const hurt = (enemy) => enemy.hp < enemy.maxHp;

/** Runs the player's attacks only (enemies hold still) with the given moves and count bonus. */
function fight(world, moveIds, seconds, extraCount = 0) {
  const player = world.players[0];
  player.moves = moveIds.map((id) => {
    const state = newMoveState(id);
    state.mods.count = extraCount;
    return state;
  });
  const ctx = { world, grid: new EnemyGrid() };
  for (let tick = 0; tick < seconds / TICK; tick++) {
    ctx.grid.rebuild(world.enemies);
    updateMoves(ctx, player, TICK);
    updateProjectiles(ctx, TICK);
    updateAreas(ctx, TICK);
  }
}

const impacts = (world) => world.events.filter((event) => event.t === "impact");

test("from a pit the player hits enemies on the slope but not ones beyond the rim", () => {
  const world = arena(pit);
  const slope = dummy(world, "caterpie", 5, 0);
  const beyond = dummy(world, "caterpie", 0, -9.5);
  fight(world, ["razor-leaf", "thunder", "solar-beam"], 6, 2);
  assert.ok(hurt(slope), "the enemy on the slope is in the line of fire");
  assert.ok(!hurt(beyond), "the enemy behind the rim is out of sight");

  const open = arena(flat);
  const far = dummy(open, "caterpie", 0, -9.5);
  dummy(open, "caterpie", 5, 0);
  fight(open, ["razor-leaf", "thunder", "solar-beam"], 6, 2);
  assert.ok(hurt(far), "without the rim the same enemy is a target");
});

test("auto-aim skips a nearer enemy behind a ridge for a farther visible one", () => {
  const world = arena(wall(2, 3, -2, 2, 2.5));
  const hidden = dummy(world, "caterpie", 5, 0);
  const visible = dummy(world, "caterpie", 0, -7);
  fight(world, ["razor-leaf"], 3);
  assert.ok(hurt(visible));
  assert.ok(!hurt(hidden));
});

test("a rock shelters the enemy behind it from shots and auto-aim; a short bush does not", () => {
  const world = arena(flat);
  const rock = { kind: "rock", x: 3, z: 0, radius: 0.8, scale: 1, rotation: 0, solid: true };
  world.map.obstacles = [rock];
  const hidden = dummy(world, "caterpie", 5, 0);
  const visible = dummy(world, "caterpie", 0, -8);
  fight(world, ["razor-leaf", "ember"], 3);
  assert.ok(hurt(visible));
  assert.ok(!hurt(hidden), "the rock is in the line of fire");

  const open = arena(flat);
  open.map.obstacles = [{ ...rock, kind: "bush", solid: false }];
  const behindBush = dummy(open, "caterpie", 5, 0);
  fight(open, ["ember"], 3);
  assert.ok(hurt(behindBush));
});

/** A level shot fired along +x from (x, y, 0). */
function shotInto(world, move, archetype, y = 0.7, x = 0) {
  world.projectiles.push({
    id: world.nextId++,
    owner: 0,
    move,
    archetype,
    type: "fire",
    x,
    y,
    z: 0,
    px: x,
    py: y,
    pz: 0,
    vx: 13,
    vy: 0,
    vz: 0,
    life: 1.4,
    radius: archetype === "orb" ? 0.6 : 0.45,
    dmg: 10,
    pierce: 0,
    area: 3.4,
    dur: 1.4,
    statusChance: 0,
    crit: 0,
    hit: [],
    delay: 0,
  });
}

test("a shot flying into a hillside stops at the slope, and an orb explodes there", () => {
  const hill = (x) => Math.max(0, x - 3);
  const bolt = arena(hill);
  shotInto(bolt, "ember", "bolt");
  fight(bolt, [], 0.5);
  const [hit] = impacts(bolt);
  assert.equal(bolt.projectiles.length, 0, "the shot died well inside its 18-unit range");
  assert.ok(hit && hit.x > 3.3 && hit.x < 4, `impact at x=${hit?.x}`);

  const orb = arena(hill);
  shotInto(orb, "fire-blast", "orb");
  const ctx = { world: orb, grid: new EnemyGrid() };
  let burst;
  for (let tick = 0; tick < 15 && !burst; tick++) {
    updateProjectiles(ctx, TICK);
    burst = orb.areas.find((a) => a.kind === "burst");
  }
  assert.ok(burst && burst.x > 3.3 && burst.x < 4, `burst at x=${burst?.x}`);
});

test("a shot flying into a rock stops at its face", () => {
  const world = arena(flat);
  world.map.obstacles = [
    { kind: "rock", x: 5, z: 0, radius: 0.8, scale: 1, rotation: 0, solid: true },
  ];
  shotInto(world, "ember", "bolt");
  fight(world, [], 0.5);
  const [hit] = impacts(world);
  assert.equal(world.projectiles.length, 0);
  assert.ok(hit && hit.x > 3.9 && hit.x < 4.3, `impact at x=${hit?.x}`);
});

test("an orb that hits a cliff face explodes at its foot, not on the terrace above", () => {
  for (const start of [0, 0.1, 0.2, 0.3]) {
    const world = arena((x) => (x >= 4 ? 3 : 0));
    const above = dummy(world, "caterpie", 6.5, 0);
    shotInto(world, "fire-blast", "orb", 0.7, start);
    fight(world, [], 1);
    assert.ok(!hurt(above), `fired from x=${start}`);
  }
});

test("a shot only hits a body its height passes through", () => {
  const high = arena(flat);
  const under = dummy(high, "caterpie", 3, 0);
  shotInto(high, "ember", "bolt", 2.2);
  fight(high, [], 0.5);
  assert.ok(!hurt(under), "a shot well above the head flies over");

  const level = arena(flat);
  const ahead = dummy(level, "caterpie", 3, 0);
  shotInto(level, "ember", "bolt");
  fight(level, [], 0.5);
  assert.ok(hurt(ahead));
});

test("a flamethrower only burns what the caster can see", () => {
  const post = wall(1, 1.25, -0.25, 0.25, 1.5);
  const world = arena(post);
  const target = dummy(world, "caterpie", 1.5, 0.6);
  const hidden = dummy(world, "caterpie", 2, 0);
  fight(world, ["flamethrower"], 2);
  assert.ok(hurt(target));
  assert.ok(!hurt(hidden), "the post shelters the enemy behind it inside the cone");

  const open = arena(flat);
  dummy(open, "caterpie", 1.5, 0.6);
  const exposed = dummy(open, "caterpie", 2, 0);
  fight(open, ["flamethrower"], 2);
  assert.ok(hurt(exposed));
});

/** Player hits taken from enemies standing still next to the player at (px, 0). */
function contactHits(height, species, enemyX, px, elite = false) {
  const world = arena(height);
  const player = world.players[0];
  player.x = player.px = px;
  const enemy = spawnEnemy(world, species, enemyX, 0, elite);
  enemy.x = enemy.px = enemyX;
  enemy.z = enemy.pz = 0;
  enemy.speed = 0;
  const ctx = { world, grid: new EnemyGrid() };
  for (let tick = 0; tick < 20; tick++) {
    ctx.grid.rebuild(world.enemies);
    updateEnemies(ctx, TICK);
  }
  return world.events.filter((event) => event.t === "player-hit").length;
}

test("contact needs level footing, and hovering elites still touch", () => {
  const cliff = (x) => (x > -0.25 ? 1.5 : 0);
  assert.equal(contactHits(cliff, "caterpie", -0.5, 0.3), 0, "a cliff top is out of reach");
  assert.ok(contactHits(flat, "caterpie", -0.5, 0.3) > 0);
  assert.ok(contactHits(flat, "pidgey", 0.6, 0, true) > 0, "an elite pidgey hovers 1.7 up");
});

test("a beam ends at the ridge it runs into", () => {
  const world = arena(wall(-3, 3, 7.5, 8.5, 3));
  const target = dummy(world, "caterpie", 0, 4);
  const behind = dummy(world, "caterpie", 0, 12);
  world.players[0].moves = [newMoveState("solar-beam")];
  const ctx = { world, grid: new EnemyGrid() };
  let length = Infinity;
  for (let tick = 0; tick < 60; tick++) {
    ctx.grid.rebuild(world.enemies);
    updateMoves(ctx, world.players[0], TICK);
    updateAreas(ctx, TICK);
    for (const a of world.areas) if (a.kind === "beam") length = Math.min(length, a.length);
  }
  assert.ok(length >= 6.5 && length <= 7.5, `beam length ${length}`);
  assert.ok(hurt(target));
  assert.ok(!hurt(behind));

  const open = arena(flat);
  dummy(open, "caterpie", 0, 4);
  const far = dummy(open, "caterpie", 0, 12);
  fight(open, ["solar-beam"], 2);
  assert.ok(hurt(far), "on open ground the beam reaches the far enemy");
});

test("a melee swing can't reach an enemy up a cliff", () => {
  // Two lashes: one at the target to the west, the second sweeps back east toward the cliff.
  const cliff = (x) => (x > 0.75 ? 1.5 : 0);
  const world = arena(cliff);
  const target = dummy(world, "caterpie", -1, 0);
  const above = dummy(world, "caterpie", 1.25, 0);
  fight(world, ["vine-whip"], 2, 1);
  assert.ok(hurt(target));
  assert.ok(!hurt(above));

  const open = arena(flat);
  dummy(open, "caterpie", -1, 0);
  const level = dummy(open, "caterpie", 1.25, 0);
  fight(open, ["vine-whip"], 2, 1);
  assert.ok(hurt(level), "on level ground the back swing connects");
});

function sporeAtPlayer(world, y = 0.5) {
  world.hazards.push({
    id: world.nextId++,
    kind: "spore",
    x: -6,
    y,
    z: 0,
    px: -6,
    py: y,
    pz: 0,
    vx: 2.8,
    vy: 0,
    vz: 0,
    life: 3.6,
    radius: 0.35,
    dmg: 5,
    dirX: 0,
    dirZ: 0,
    length: 0,
  });
  for (let tick = 0; tick < 3.6 / TICK; tick++) updateHazards(world, TICK);
  return world.players[0];
}

test("an enemy spore can't hit a player behind a ridge", () => {
  const sheltered = arena(wall(-3.5, -2.5, -3, 3, 2));
  const before = sheltered.players[0].hp;
  assert.equal(sporeAtPlayer(sheltered).hp, before);
  assert.ok(impacts(sheltered)[0]?.x < -2.5, "the spore splats on the ridge");

  const open = arena(flat);
  assert.ok(sporeAtPlayer(open).hp < before, "in the open the same spore lands");
  assert.equal(sporeAtPlayer(arena(flat), 2.5).hp, before, "a spore over the head misses");
});

test("a flyer can be hit over a ridge that hides a ground enemy", () => {
  const ridge = wall(2.5, 3.5, -3, 3, 0.9);
  const air = arena(ridge);
  const pidgey = dummy(air, "pidgey", 6, 0);
  fight(air, ["razor-leaf"], 3);
  assert.ok(hurt(pidgey));

  const ground = arena(ridge);
  const caterpie = dummy(ground, "caterpie", 6, 0);
  fight(ground, ["razor-leaf"], 3);
  assert.ok(!hurt(caterpie));
});

test("combat on real terrain is deterministic", () => {
  const run = () => {
    const world = createWorld({
      stage: "forest",
      seed: 77,
      difficulty: 1,
      players: [{ starter: "squirtle" }],
    });
    const player = world.players[0];
    player.hp = 1e6;
    player.xpNext = 1e9;
    player.moves = [
      "water-gun",
      "fire-blast",
      "flamethrower",
      "solar-beam",
      "vine-whip",
      "thunder",
    ].map(newMoveState);
    for (let tick = 0; tick < 30 * 90; tick++) {
      const angle = tick / 90;
      stepWorld(world, [{ t: "move", player: 0, x: Math.cos(angle), z: Math.sin(angle) }]);
    }
    return JSON.stringify({
      kills: world.players[0].kills,
      hp: player.hp,
      enemies: world.enemies.map((e) => [e.id, e.x, e.z, e.hp]),
      shots: world.projectiles.map((s) => [s.id, s.x, s.y, s.z]),
      hazards: world.hazards.map((h) => [h.id, h.x, h.y, h.z]),
      areas: world.areas.map((a) => [a.id, a.length]),
    });
  };
  assert.equal(run(), run());
});

test("cards queued by one burst of XP stay legal when picked in turn, and a stale pick is ignored", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const world = createWorld({
      stage: "forest",
      seed,
      difficulty: 0,
      players: [{ starter: "charmander" }],
    });
    const player = world.players[0];
    player.moves.push(newMoveState("fire-spin"), newMoveState("flamethrower"));
    world.pickups.push({
      id: 9999,
      kind: "xp",
      x: player.x,
      z: player.z,
      value: 3000,
      magnet: true,
    });
    stepWorld(world, []);
    assert.ok(player.pending.length >= 4, `seed ${seed}: one burst should queue several cards`);
    const first = player.pending[0];
    stepWorld(world, [{ t: "pick", player: 0, card: first.id, index: 0 }]);
    // A repeated input naming the card just answered must not resolve the next one.
    const left = player.pending.length;
    stepWorld(world, [{ t: "pick", player: 0, card: first.id, index: 0 }]);
    assert.equal(player.pending.length, left);
    while (player.pending.length > 0) {
      const card = player.pending[0];
      const wanted = card.options.findIndex((c) => c.kind === "move" || c.kind === "item");
      stepWorld(world, [{ t: "pick", player: 0, card: card.id, index: Math.max(0, wanted) }]);
    }
    const ids = player.moves.map((move) => move.id);
    assert.equal(new Set(ids).size, ids.length, `seed ${seed}: duplicate move ${ids.join(",")}`);
    assert.ok(ids.length <= BASE_MOVE_SLOTS);
    assert.ok(player.items.length <= BASE_ITEM_SLOTS, `seed ${seed}: ${player.items.length} items`);
    for (const item of player.items) assert.ok(item.level <= items[item.id].max);
  }
});

test("a player standing at the arena wall gets spawns at full ring distance, never on top of them", () => {
  const world = createWorld({
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [{ starter: "squirtle" }],
  });
  const player = world.players[0];
  const [x, z] = [43.9, -20];
  const seen = new Set();
  let nearest = Infinity;
  for (let tick = 0; tick < 30 * 90; tick++) {
    player.x = player.px = x;
    player.z = player.pz = z;
    player.hp = 1e9;
    player.invulnerable = 1;
    stepWorld(world, []);
    for (const enemy of world.enemies) {
      if (seen.has(enemy.id)) continue;
      seen.add(enemy.id);
      nearest = Math.min(nearest, Math.hypot(enemy.x - x, enemy.z - z));
    }
  }
  assert.ok(seen.size >= 30, `only ${seen.size} spawns in 90 s at the wall`);
  assert.ok(nearest > 12, `an enemy spawned ${nearest.toFixed(2)} from the player`);
});

test("a sleeping guardian stops mid-dash and does not dash again until it has woken and chased", () => {
  const world = arena(() => 0);
  const ctx = { world, grid: new EnemyGrid() };
  const boss = dummy(world, "scyther", 6, 0);
  boss.phase = "dash";
  boss.phaseTime = 0;
  boss.dashX = -1;
  boss.dashZ = 0;
  apply(boss, "sleep", 1, 0, -1);
  for (let i = 0; i < 20; i++) updateEnemies(ctx, TICK);
  assert.equal(boss.x, 6);
  assert.equal(boss.phase, "chase");
});

test("below half HP the guardian tells red when a dash ends and its Air Slash leaves when that wind-up ends", () => {
  const world = arena(() => 0);
  const ctx = { world, grid: new EnemyGrid() };
  const boss = dummy(world, "scyther", 6, 0);
  boss.hp = boss.maxHp * 0.4;
  boss.phase = "dash";
  boss.phaseTime = BOSS_DASH_TIME;
  boss.dashX = -1;
  boss.dashZ = 0;
  world.events.length = 0;
  updateEnemies(ctx, TICK);
  const windup = BOSS_RECOVER * difficulties[world.difficulty].bossTelegraph;
  assert.equal(boss.phase, "windup");
  assert.deepEqual(world.events, [{ t: "tell", enemy: boss.id, severity: "danger", windup }]);
  const slashes = () => world.hazards.filter((hazard) => hazard.kind === "slash").length;
  const ticks = Math.round(windup / TICK);
  for (let i = 0; i < ticks - 1; i++) updateEnemies(ctx, TICK);
  assert.equal(slashes(), 0, "no blade before the wind-up ends");
  for (let i = 0; i < 2; i++) updateEnemies(ctx, TICK);
  assert.equal(slashes(), difficulties[world.difficulty].airSlashBlades);
  assert.equal(boss.phase, "chase");
});

test("a paralysed guardian starts neither its dash nor its Air Slash until the paralysis wears off", () => {
  const world = arena(() => 0);
  const ctx = { world, grid: new EnemyGrid() };
  const boss = dummy(world, "scyther", 6, 0);
  const dashWarns = () => world.hazards.filter((hazard) => hazard.kind === "dash-warn").length;
  boss.phaseTime = BOSS_CHASE_MIN + 1;
  inflict(boss, "paralysis", 1, -1);
  world.events.length = 0;
  for (let i = 0; i < 10; i++) updateEnemies(ctx, TICK);
  assert.equal(boss.phase, "chase");
  assert.equal(dashWarns(), 0);
  assert.equal(world.events.filter((event) => event.t === "tell").length, 0);
  while (has(boss, "paralysis")) updateEnemies(ctx, TICK);
  updateEnemies(ctx, TICK);
  assert.equal(boss.phase, "windup", "it dashes again once the paralysis is gone");
  assert.equal(dashWarns(), 1);

  boss.hp = boss.maxHp * 0.4;
  boss.phase = "dash";
  boss.phaseTime = BOSS_DASH_TIME;
  inflict(boss, "paralysis", 1, -1);
  world.events.length = 0;
  updateEnemies(ctx, TICK);
  assert.equal(
    boss.phase,
    "recover",
    "a paralysed dash ends in its recovery, not Air Slash's wind-up",
  );
  assert.equal(world.events.filter((event) => event.t === "tell").length, 0);
  const recover = BOSS_RECOVER * difficulties[world.difficulty].bossTelegraph;
  const slashes = () => world.hazards.filter((hazard) => hazard.kind === "slash").length;
  for (let i = 0; i < Math.round(recover / TICK) + 2; i++) updateEnemies(ctx, TICK);
  assert.equal(slashes(), 0);
  assert.equal(boss.phase, "chase");

  // Paralysis landing on a wind-up already under way does not cancel it (only sleep does).
  while (has(boss, "paralysis")) updateEnemies(ctx, TICK);
  boss.phase = "dash";
  boss.phaseTime = BOSS_DASH_TIME;
  updateEnemies(ctx, TICK);
  assert.equal(boss.phase, "windup");
  inflict(boss, "paralysis", 1, -1);
  for (let i = 0; i < Math.round(recover / TICK) + 2; i++) updateEnemies(ctx, TICK);
  assert.equal(slashes(), difficulties[world.difficulty].airSlashBlades);
});

/** An attacker that is ready to use its skill at once and barely walks (its lunge speed is unaffected). */
function attacker(world, species, x, z) {
  const enemy = dummy(world, species, x, z);
  enemy.attackTimer = 0;
  enemy.speed = 1e-3;
  return enemy;
}

/** Steps enemies and hazards only; returns the player's HP after each tick. */
function run(world, seconds) {
  const ctx = { world, grid: new EnemyGrid() };
  const hp = [];
  for (let tick = 0; tick < Math.round(seconds / TICK); tick++) {
    ctx.grid.rebuild(world.enemies);
    updateEnemies(ctx, TICK);
    updateHazards(world, TICK);
    hp.push(world.players[0].hp);
  }
  return hp;
}

const rockAt = (x, z) => ({ kind: "rock", x, z, radius: 0.8, scale: 1, rotation: 0, solid: true });
const hazardsOf = (world, kind) => world.hazards.filter((h) => h.kind === kind);

test("Harden reduces direct hits only while active, then wears off", () => {
  const w = arena(flat);
  const enemy = attacker(w, "metapod", 4, 0);
  enemy.speed = 0;
  run(w, HARDEN.windup + 3 * TICK);
  assert.ok(enemy.hardened > 0);
  const hit = () =>
    damageEnemy({ world: w, grid: new EnemyGrid() }, enemy, {
      owner: w.players[0],
      move: null,
      type: "normal",
      dmg: 10,
      crit: -1,
      statusChance: 0,
      knock: 0,
      fromX: 0,
      fromZ: 0,
    });
  const before = enemy.hp;
  hit();
  assert.ok(Math.abs(before - enemy.hp - 10 * HARDEN.damage) < 1e-6);
  run(w, HARDEN.duration + TICK);
  assert.equal(enemy.hardened, 0);
  const after = enemy.hp;
  hit();
  assert.ok(Math.abs(after - enemy.hp - 10) < 1e-6);
});

test("poison sting and ember warn, lock their aim, hit after launch, and stop at cover", () => {
  for (const [species, kind] of [
    ["nidoran-f", "poison-sting"],
    ["vulpix", "ember"],
  ]) {
    const w = arena(flat);
    const enemy = attacker(w, species, 5, 0);
    enemy.speed = 0;
    const player = w.players[0];
    const hp = player.hp;
    run(w, ENEMY_SHOTS[kind].windup - TICK);
    assert.equal(player.hp, hp, `${kind}: no early hit`);
    assert.equal(hazardsOf(w, `${kind}-warn`).length, 1);
    run(w, 1.3);
    assert.ok(player.hp < hp, `${kind}: hits a stationary player`);
    if (kind === "poison-sting") assert.ok(has(player, "poison"));

    const dodge = arena(flat);
    const caster = attacker(dodge, species, 5, 0);
    caster.speed = 0;
    run(dodge, TICK);
    const untouched = dodge.players[0].hp;
    dodge.players[0].z = 3;
    run(dodge, 2);
    assert.equal(dodge.players[0].hp, untouched, `${kind}: no tracking after warning`);

    const covered = arena(flat);
    const shooter = attacker(covered, species, 5, 0);
    shooter.speed = 0;
    run(covered, ENEMY_SHOTS[kind].windup + 3 * TICK);
    covered.map.obstacles = [rockAt(2.5, 0)];
    const safe = covered.players[0].hp;
    run(covered, ENEMY_SHOTS[kind].life);
    assert.equal(covered.players[0].hp, safe, `${kind}: rock blocks the shot`);
  }
});

test("a shot warning follows knockback and the launched shot keeps that exact lane", () => {
  const w = arena(flat);
  const enemy = attacker(w, "vulpix", 5, 0);
  enemy.speed = 0;
  run(w, TICK);
  const warning = hazardsOf(w, "ember-warn")[0];
  enemy.knockZ = 25;
  run(w, ENEMY_SHOTS.ember.windup - 3 * TICK);
  assert.ok(warning.z > 2, "knockback moved the lane");
  assert.equal(warning.z, enemy.z);
  assert.equal(warning.x, enemy.x);
  const dir = [warning.dirX, warning.dirZ];
  run(w, 4 * TICK);
  const shot = hazardsOf(w, "ember")[0];
  assert.ok(shot, "launched after the complete warning");
  assert.ok(Math.abs((shot.z - warning.z) * dir[0] - (shot.x - warning.x) * dir[1]) < 1e-6);
});

test("Flame Charge warns before moving and cannot start through a ground blocker", () => {
  const w = arena(flat);
  const enemy = attacker(w, "growlithe", 5, 0);
  const hp = w.players[0].hp;
  run(w, LUNGE["flame-charge"].windup - TICK);
  assert.equal(hazardsOf(w, "dash-warn").length, 1);
  assert.equal(w.players[0].hp, hp);
  const windupX = enemy.x;
  run(w, 2 * TICK);
  assert.equal(enemy.x, windupX, "the transition tick still holds the caster in place");
  assert.equal(hazardsOf(w, "dash-warn").length, 1, "the lane remains until movement starts");
  run(w, 0.8);
  assert.ok(w.players[0].hp < hp);
  assert.ok(enemy.phase === "recover" || enemy.phase === "dash");
  const blocked = arena(flat);
  blocked.map.obstacles = [rockAt(2.5, 0)];
  addCircleBlocker(blocked.nav, 2.5, 0, 0.8);
  attacker(blocked, "growlithe", 5, 0);
  run(blocked, 0.5);
  assert.equal(hazardsOf(blocked, "dash-warn").length, 0);
});

test("a Flame Charge lane follows its caster during knockback", () => {
  const w = arena(flat);
  const enemy = attacker(w, "growlithe", 5, 0);
  enemy.speed = 0;
  run(w, TICK);
  const warning = hazardsOf(w, "dash-warn")[0];
  enemy.knockZ = 25;
  run(w, LUNGE["flame-charge"].windup - 3 * TICK);
  assert.ok(warning.z > 2);
  assert.equal(warning.x, enemy.x);
  assert.equal(warning.z, enemy.z);
});

test("radial attacks hit once after their full warning, can be dodged and respect cover", () => {
  for (const [species, kind] of [
    ["voltorb", "discharge"],
    ["electrode", "self-destruct"],
  ]) {
    const w = arena(flat);
    const enemy = attacker(w, species, 2, 0);
    enemy.speed = 0;
    const player = w.players[0];
    const hp = player.hp;
    run(w, RADIAL[kind].windup);
    assert.equal(player.hp, hp, `${kind}: full wind-up after the tell`);
    run(w, 3 * TICK);
    assert.ok(player.hp < hp, `${kind}: one hit at the end`);
    const struck = player.hp;
    player.invulnerable = 0;
    run(w, RADIAL[kind].active);
    assert.equal(player.hp, struck, `${kind}: residue never hits twice`);
    if (kind === "self-destruct") {
      assert.equal(enemy.hp, 0);
      assert.equal(player.kills, 0);
      assert.equal(w.pickups.length, 0);
      assert.equal(w.partners.length, 0);
    }
    const dodge = arena(flat);
    const caster = attacker(dodge, species, 2, 0);
    caster.speed = 0;
    run(dodge, TICK);
    dodge.players[0].z = 7;
    const safe = dodge.players[0].hp;
    run(dodge, RADIAL[kind].windup + 0.4);
    assert.equal(dodge.players[0].hp, safe, `${kind}: leave the circle`);
    const covered = arena(flat);
    const other = attacker(covered, species, 2.5, 0);
    other.speed = 0;
    run(covered, TICK);
    covered.map.obstacles = [rockAt(1.2, 0)];
    const sheltered = covered.players[0].hp;
    run(covered, RADIAL[kind].windup + 0.4);
    assert.equal(covered.players[0].hp, sheltered, `${kind}: rock shelters player`);
  }
});

test("sleep or killing the caster interrupts self-destruct before it can land", () => {
  for (const interrupt of ["sleep", "kill"]) {
    const w = arena(flat);
    const enemy = attacker(w, "electrode", 2, 0);
    enemy.speed = 0;
    run(w, 0.5);
    assert.equal(hazardsOf(w, "self-destruct").length, 1);
    if (interrupt === "sleep") apply(enemy, "sleep", 3, 0, -1);
    else enemy.hp = 0;
    const hp = w.players[0].hp;
    run(w, 2);
    assert.equal(w.players[0].hp, hp);
    assert.equal(hazardsOf(w, "self-destruct").length, 0);
  }
});

test("knockback moves the charging radial attack with its caster, then the blast stays put", () => {
  for (const [species, kind] of [
    ["voltorb", "discharge"],
    ["electrode", "self-destruct"],
  ]) {
    const w = arena(flat);
    const enemy = attacker(w, species, 2, 0);
    enemy.speed = 0;
    run(w, TICK);
    const warning = hazardsOf(w, kind)[0];
    enemy.knockZ = 25;
    run(w, RADIAL[kind].windup - 3 * TICK);
    assert.ok(warning.z > 2);
    assert.equal(warning.x, enemy.x);
    assert.equal(warning.z, enemy.z);
    run(w, 3 * TICK);
    assert.equal(warning.dmg, 0, "pulse resolved");
    const point = [warning.x, warning.z];
    enemy.knockZ = 25;
    run(w, TICK);
    assert.deepEqual([warning.x, warning.z], point, "residue stays at the blast origin");
  }
});

test("a spearow dive and a geodude roll show their lane for the whole wind-up before they hit", () => {
  for (const [species, x] of [
    ["spearow", 4],
    ["geodude", 6],
  ]) {
    const world = arena(flat);
    const kind = species === "spearow" ? "dive" : "roll";
    attacker(world, species, x, 0);
    const start = world.players[0].hp;
    const windup = run(world, LUNGE[kind].windup - TICK);
    assert.equal(hazardsOf(world, "dash-warn").length, 1, `${species}: lane telegraph`);
    assert.ok(
      windup.every((hp) => hp === start),
      `${species}: no damage during the wind-up`,
    );
    run(world, LUNGE[kind].time + 0.2);
    assert.ok(world.players[0].hp < start, `${species}: the lunge lands on a player who stays`);
  }
});

test("a wind-up tells once at its start: blue for a plain dodge, red for stun spore and any elite", () => {
  const tellsOf = (world) => world.events.filter((event) => event.t === "tell");
  for (const [species, x, elite, severity, windup] of [
    ["spearow", 4, false, "normal", LUNGE.dive.windup],
    ["paras", 2, false, "danger", STUN_SPORE.windup],
    ["spearow", 4, true, "danger", LUNGE.dive.windup],
  ]) {
    const world = arena(flat);
    const enemy = spawnEnemy(world, species, x, 0, elite);
    enemy.x = enemy.px = x;
    enemy.z = enemy.pz = 0;
    enemy.attackTimer = 0;
    run(world, windup - TICK);
    assert.deepEqual(
      tellsOf(world),
      [{ t: "tell", enemy: enemy.id, severity, windup }],
      `${species}${elite ? " (elite)" : ""}`,
    );
  }
});

test("a rock between them stops spearow and geodude from lunging", () => {
  const air = arena(flat);
  air.map.obstacles = [rockAt(2, 0)];
  attacker(air, "spearow", 4, 0);
  run(air, 1);
  assert.equal(hazardsOf(air, "dash-warn").length, 0, "the rock hides the player from the flyer");

  const ground = arena(flat);
  ground.map.obstacles = [rockAt(3, 0)];
  addCircleBlocker(ground.nav, 3, 0, 0.8);
  attacker(ground, "geodude", 6, 0);
  run(ground, 1.5);
  assert.equal(hazardsOf(ground, "dash-warn").length, 0, "no walkable line through the rock");
});

test("ekans' acid lands after its telegraphed flight, poisons from the pool, and a sidestep dodges it", () => {
  const world = arena(flat);
  attacker(world, "ekans", 6, 0);
  const player = world.players[0];
  const start = player.hp;
  run(world, ACID.windup + TICK);
  assert.equal(hazardsOf(world, "acid").length, 1);
  const flight = run(world, ACID.flight - 2 * TICK);
  assert.ok(
    flight.every((hp) => hp === start),
    "nothing lands before the flight time",
  );
  run(world, 3 * TICK);
  assert.ok(player.hp < start, "the splash hits a player who stayed on the ring");
  assert.equal(hazardsOf(world, "acid-pool").length, 1);
  player.statuses = [];
  run(world, 0.5);
  assert.ok(has(player, "poison"), "standing in the pool keeps the player poisoned");
  run(world, ACID.poolLife);
  assert.equal(hazardsOf(world, "acid-pool").length, 0, "the pool dries up");

  const dodge = arena(flat);
  attacker(dodge, "ekans", 6, 0);
  run(dodge, ACID.windup + TICK);
  dodge.players[0].z = 2.5;
  run(dodge, ACID.flight + 0.2);
  assert.equal(dodge.players[0].hp, start, "the glob splashes where the player stood");

  const covered = arena(flat);
  covered.map.obstacles = [rockAt(3, 0)];
  attacker(covered, "ekans", 6, 0);
  run(covered, 1);
  assert.equal(hazardsOf(covered, "acid").length, 0, "no spit without a line onto the player");
});

test("paras' stun spore arms after its wind-up, slows only what it can see, and the slow wears off", () => {
  const world = arena(flat);
  attacker(world, "paras", 2, 0);
  const player = world.players[0];
  run(world, STUN_SPORE.windup - TICK);
  assert.equal(hazardsOf(world, "stun-spore").length, 1);
  assert.ok(!has(player, "slow"), "the cloud is harmless while it swells");
  run(world, 0.3);
  assert.ok(has(player, "slow"), "inside the armed cloud the player is slowed");

  // Walking speed while slowed, and full speed once it wears off (world.updatePlayer).
  world.hazards = [];
  world.enemies = [];
  player.x = player.px = 0;
  // Past the 0.07 s acceleration, still inside the slow.
  for (let tick = 0; tick < 4; tick++) stepWorld(world, [{ t: "move", player: 0, x: 1, z: 0 }]);
  const slowed = Math.hypot(player.vx, player.vz);
  for (let tick = 0; tick < (statuses.slow.duration + 0.1) / TICK; tick++)
    stepWorld(world, [{ t: "move", player: 0, x: 1, z: 0 }]);
  assert.ok(!has(player, "slow"));
  const full = Math.hypot(player.vx, player.vz);
  assert.ok(
    Math.abs(slowed / full - statuses.slow.move.factor) < 0.01,
    `slowed ${slowed} vs ${full}`,
  );

  const covered = arena(flat);
  covered.map.obstacles = [rockAt(1.2, 0)];
  attacker(covered, "paras", 2.2, 0);
  run(covered, 1.5);
  assert.equal(hazardsOf(covered, "stun-spore").length, 0, "no cast at a player behind a rock");
});

test("venonat's psybeam hits along its charged lane only, and a ridge cuts it short", () => {
  const world = arena(flat);
  attacker(world, "venonat", 8, 0);
  const start = world.players[0].hp;
  const charge = run(world, PSYBEAM.windup - TICK);
  const [beam] = hazardsOf(world, "psybeam");
  assert.ok(beam, "the lane appears when the charge starts");
  assert.ok(
    charge.every((hp) => hp === start),
    "no damage during the charge",
  );
  run(world, PSYBEAM.active + 2 * TICK);
  assert.ok(world.players[0].hp < start, "the beam hits a player who stayed in the lane");

  const dodge = arena(flat);
  attacker(dodge, "venonat", 8, 0);
  run(dodge, TICK);
  dodge.players[0].z = 1.5;
  run(dodge, PSYBEAM.windup + PSYBEAM.active);
  assert.equal(dodge.players[0].hp, start, "stepping out of the lane dodges it");

  assert.equal(beam.length, PSYBEAM.length, "in the open it runs its full reach");
  const ridge = arena(wall(-2.5, -1.5, -3, 3, 3));
  attacker(ridge, "venonat", 8, 0);
  run(ridge, TICK);
  const cut = hazardsOf(ridge, "psybeam")[0];
  // The ridge's foot starts rising at x = −1 (terrain is sampled every 0.5 and interpolated).
  assert.ok(cut && cut.length >= 8.5 && cut.length <= 10.5, `ends at the ridge (${cut?.length})`);
});

test("runs with every new species and attack stay deterministic", () => {
  const play = () => {
    const world = createWorld({
      stage: "forest",
      seed: 21,
      difficulty: 2,
      players: [{ starter: "pikachu" }],
    });
    const player = world.players[0];
    player.hp = 1e6;
    player.xpNext = 1e9;
    world.zone.tick = 460 * 30;
    for (let tick = 0; tick < 30 * 60; tick++) {
      const angle = tick / 70;
      stepWorld(world, [{ t: "move", player: 0, x: Math.cos(angle), z: Math.sin(angle) }]);
    }
    const kinds = new Set(world.spawn.pool);
    // Zone 1's roster; zones 2–3 bring their own (scripts/zone-skills.test.mjs).
    for (const [, id] of forest.zones[0].roster)
      assert.ok(kinds.has(id), `${id} joined the spawn pool`);
    return JSON.stringify({
      enemies: world.enemies.map((e) => [e.id, e.x, e.z, e.hp, e.phase]),
      hazards: world.hazards.map((h) => [h.id, h.kind, h.x, h.y, h.z, h.life]),
      player: [player.x, player.z, player.hp, JSON.stringify(player.statuses)],
    });
  };
  assert.equal(play(), play());
});

test("area upgrades keep growing a move but a late build stays under 1.7× its base size", () => {
  const world = createWorld({
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: [{ starter: "charmander" }],
  });
  const player = world.players[0];
  const state = newMoveState("fire-spin");
  player.moves = [state];
  const sizes = [];
  for (let rolls = 0; rolls <= 12; rolls++) {
    state.mods.area = rolls * 0.13;
    sizes.push(moveParams(state, playerStats(player)).area);
  }
  player.items = [{ id: "wide-lens", level: 5 }];
  const maxed = moveParams(state, playerStats(player)).area;
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] > sizes[i - 1], `roll ${i} adds area`);
  assert.ok(maxed < sizes[0] * 1.7, `late area ${maxed.toFixed(2)} vs base ${sizes[0]}`);
});

test("a reroll makes a new card: a pick still aimed at the old card is ignored", () => {
  const world = createWorld({
    stage: "forest",
    seed: 4,
    difficulty: 0,
    players: [{ starter: "charmander" }],
  });
  const player = world.players[0];
  player.rerolls = 1;
  world.pickups.push({
    id: 9999,
    kind: "xp",
    x: player.x,
    z: player.z,
    value: xpForLevel(1),
    magnet: true,
  });
  stepWorld(world, []);
  const shown = player.pending[0];
  assert.ok(shown, "a level-up card is up");
  const oldId = shown.id;
  stepWorld(world, [{ t: "reroll", player: 0, card: oldId }]);
  assert.notEqual(player.pending[0].id, oldId);
  const before = player.pending.length;
  stepWorld(world, [{ t: "pick", player: 0, card: oldId, index: 0 }]);
  assert.equal(player.pending.length, before, "the stale pick resolved the rerolled card");
});

test("a psybeam still winding up dies with its caster", () => {
  const world = arena(() => 0);
  const player = world.players[0];
  const venonat = dummy(world, "venonat", 4, 0);
  addHazard(world, {
    kind: "psybeam",
    x: venonat.x,
    y: 0.6,
    z: venonat.z,
    life: 1.2,
    radius: 0.3,
    dmg: 20,
    dirX: -1,
    dirZ: 0,
    length: 8,
    caster: venonat.id,
  });
  world.enemies = world.enemies.filter((enemy) => enemy !== venonat);
  const hp = player.hp;
  for (let i = 0; i < 45; i++) updateHazards(world, TICK);
  assert.equal(player.hp, hp);
  assert.equal(world.hazards.length, 0);
});

test("a poison hit wears an enemy down at its DoT share and then ends", () => {
  const w = arena(flat);
  const enemy = dummy(w, "caterpie", 4, 0);
  enemy.speed = 0;
  damageEnemy({ world: w, grid: new EnemyGrid() }, enemy, {
    owner: w.players[0],
    move: null,
    type: "normal",
    dmg: 10,
    crit: -1,
    status: "poison",
    statusChance: 1,
    knock: 0,
    fromX: 0,
    fromZ: 0,
  });
  const dealt = enemy.maxHp - enemy.hp;
  const { duration, dotShare } = statuses.poison;
  assert.ok(Math.abs(find(enemy, "poison").power - dealt * dotShare) < 1e-9);
  const before = enemy.hp;
  run(w, duration + 2 * TICK);
  assert.ok(!has(enemy, "poison"), "the poison wears off");
  assert.ok(
    Math.abs(before - enemy.hp - dealt * dotShare * duration) < dealt * dotShare * 2 * TICK,
  );
});

/** Two players far apart on flat ground, kept alive and still. */
function duo() {
  const world = createWorld({
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: [{ starter: "charmander" }, { starter: "squirtle" }],
  });
  world.map.terrain = terrainOf(flat);
  const [left, right] = world.players;
  left.x = left.px = -30;
  right.x = right.px = 30;
  for (const player of world.players) {
    player.z = player.pz = 0;
    player.moves = [];
  }
  return world;
}

/** Steps the whole world `seconds` and returns, per player id, how many new enemies spawned nearest them. */
function spawnsAround(world, seconds) {
  const seen = new Set(world.enemies.map((enemy) => enemy.id));
  const counts = world.players.map(() => 0);
  for (let tick = 0; tick < Math.round(seconds / TICK); tick++) {
    for (const player of world.players) {
      player.hp = 1e9;
      player.invulnerable = 1;
    }
    stepWorld(world, []);
    for (const enemy of world.enemies) {
      if (seen.has(enemy.id)) continue;
      seen.add(enemy.id);
      const [nearest] = [...world.players].sort(
        (a, b) =>
          Math.hypot(a.x - enemy.x, a.z - enemy.z) - Math.hypot(b.x - enemy.x, b.z - enemy.z),
      );
      counts[nearest.id] += 1;
    }
  }
  return counts;
}

test("co-op spawns ring each living player in turn and skip one who is down", () => {
  const world = duo();
  const [left, right] = spawnsAround(world, 40);
  const total = left + right;
  // Enough spawns for the split to mean something (普通 spawns about one a second here).
  assert.ok(total >= 30, `only ${total} spawns`);
  // Skipped spawns and beats still take a turn, so the split is near even rather than exact.
  assert.ok(Math.min(left, right) >= total * 0.4, `spawns split ${left} / ${right}`);
  world.players[1].alive = false;
  const [alone, downed] = spawnsAround(world, 20);
  assert.ok(alone >= 15, `only ${alone} spawns around the standing player`);
  assert.equal(downed, 0);
});

test("a burn kill credits the player whose hit burned the enemy, not the one standing nearest", () => {
  const world = duo();
  const [burner, bystander] = world.players;
  const enemy = dummy(world, "caterpie", 28, 0);
  enemy.speed = 0;
  damageEnemy({ world, grid: new EnemyGrid() }, enemy, {
    owner: burner,
    move: null,
    type: "fire",
    dmg: 10,
    crit: -1,
    status: "burn",
    statusChance: 1,
    knock: 0,
    fromX: burner.x,
    fromZ: burner.z,
  });
  assert.deepEqual(
    world.events.filter((event) => event.t === "hit").map((event) => event.by),
    [burner.id],
  );
  enemy.hp = 0.01;
  run(world, 0.5);
  assert.ok(enemy.hp <= 0, "the burn finishes the enemy");
  assert.equal(burner.kills, 1);
  assert.equal(bystander.kills, 0);
});

function lavaWorld() {
  const world = createWorld({
    stage: "volcano",
    seed: 7,
    difficulty: 0,
    players: [{ starter: "charmander" }, { starter: "squirtle" }],
  });
  for (const player of world.players) player.moves = [];
  assert.equal(sampleSurface(world.map.terrain.surface, 7, -24).kind, "lava");
  return world;
}

test("lava deaths leave base loot once without player kills, captures, triggers or item bonuses", () => {
  for (const elite of [false, true]) {
    const plain = lavaWorld();
    const equipped = lavaWorld();
    for (const player of equipped.players)
      player.items = [
        { id: "master-ball", level: 1 },
        { id: "poke-radar", level: 5 },
        { id: "berry-juice", level: 5 },
      ];
    for (const world of [plain, equipped]) {
      for (const player of world.players) player.hp = 10;
      const enemy = spawnEnemy(world, "machop", 7, -24, elite);
      enemy.hp = 0.01;
      // These berry rolls fall between the base chance and the equipped radar's chance.
      world.rng.state = elite ? 52 : 33;
      stepWorld(world, []);
      assert.equal(world.enemies.includes(enemy), false);
      assert.equal(world.events.filter((event) => event.t === "death").length, 1);
      const xp = world.pickups.filter((pickup) => pickup.kind === "xp");
      assert.equal(xp.length, elite ? 6 : 1);
      assert.equal(
        xp.reduce((sum, pickup) => sum + pickup.value, 0),
        elite ? Math.ceil(enemy.xp / 6) * 6 : enemy.xp,
      );
      if (elite) {
        assert.equal(world.pickups.filter((pickup) => pickup.kind === "chest").length, 1);
        assert.equal(
          world.pickups.find((pickup) => pickup.kind === "stardust").value,
          STARDUST.elite,
        );
      }
      assert.deepEqual(
        world.players.map((player) => player.kills),
        [0, 0],
      );
      assert.equal(world.partners.length, 0);
    }
    assert.deepEqual(equipped.pickups, plain.pickups, "no player's berry bonus is borrowed");
    assert.deepEqual(
      equipped.players.map((player) => player.hp),
      plain.players.map((player) => player.hp),
      "no on-kill healing",
    );
    assert.equal(equipped.rng.state, plain.rng.state, "capture and kill procs draw no rolls");
    const loot = equipped.pickups.map(({ id, kind, value }) => ({ id, kind, value }));
    stepWorld(equipped, []);
    assert.equal(equipped.events.filter((event) => event.t === "death").length, 1);
    assert.deepEqual(
      equipped.pickups.map(({ id, kind, value }) => ({ id, kind, value })),
      loot,
    );
  }
});

test("lava retains stronger player burns, replaces weaker ones, and respects fire and flight", () => {
  for (const [power, credited] of [
    [4, false],
    [9, true],
  ]) {
    const world = lavaWorld();
    world.players[1].items = [
      { id: "master-ball", level: 1 },
      { id: "poke-radar", level: 5 },
    ];
    const enemy = spawnEnemy(world, "machop", 7, -24, true);
    apply(enemy, "burn", 1, power, world.players[1].id);
    enemy.hp = 0.01;
    world.rng.state = 52;
    stepWorld(world, []);
    assert.deepEqual(
      world.players.map((player) => player.kills),
      [0, Number(credited)],
    );
    assert.equal(world.enemies.includes(enemy), false);
    assert.equal(
      world.pickups.some((pickup) => pickup.kind === "berry"),
      credited,
    );
    assert.deepEqual(
      world.partners.map((partner) => partner.owner),
      credited ? [1] : [],
    );
  }
  const world = lavaWorld();
  const normal = spawnEnemy(world, "machop", 7, -24);
  const fire = spawnEnemy(world, "ninetales", 7, -24);
  const flying = spawnEnemy(world, "zubat", 7, -24);
  const hp = normal.hp;
  fire.hp = flying.hp = 0.01;
  stepWorld(world, []);
  assert.ok(normal.hp > 0 && normal.hp < hp);
  assert.equal(find(normal, "burn").source, -1);
  assert.equal(fire.hp, 0.01);
  assert.equal(flying.hp, 0.01);
  assert.equal(
    world.events.some((event) => event.t === "death"),
    false,
  );
});

test("an environmental guardian death clears the zone and grants shared rewards without a killer", () => {
  const world = duo();
  const guardian = spawnEnemy(world, forest.zones[0].guardian.species, 20, 0);
  world.bossId = guardian.id;
  guardian.hp = 0.01;
  apply(guardian, "burn", 1, 8, -1);
  stepWorld(world, []);
  assert.equal(world.zone.phase, "cleared");
  assert.equal(world.bossId, null);
  assert.deepEqual(
    world.players.map((player) => player.kills),
    [0, 0],
  );
  assert.deepEqual(
    world.players.map((player) => player.stardust),
    [STARDUST.guardian, STARDUST.guardian],
  );
  assert.equal(world.pickups.filter((pickup) => pickup.kind === "chest").length, 1);
  assert.equal(world.pickups.filter((pickup) => pickup.kind === "xp").length, 6);
});

test("a lethal DoT with an invalid player ID still fails instead of becoming an environment kill", () => {
  for (const source of [-2, 99]) {
    const world = duo();
    const enemy = spawnEnemy(world, "caterpie", 0, 0);
    enemy.hp = 0.01;
    apply(enemy, "burn", 1, 8, source);
    assert.throws(() => stepWorld(world, []), new RegExp(`玩家 ${source} 不存在`));
    assert.equal(
      world.events.some((event) => event.t === "death"),
      false,
    );
    assert.equal(world.pickups.length, 0);
  }
});

/** A hit with knockback `knock` from the origin and no damage worth noting. */
function shove(world, enemy, knock) {
  damageEnemy({ world, grid: new EnemyGrid() }, enemy, {
    owner: world.players[0],
    move: null,
    type: "normal",
    dmg: 0,
    crit: -1,
    statusChance: 0,
    knock,
    fromX: 0,
    fromZ: 0,
  });
}

test("poise: pushes and pulls move light enemies most, heavy ones and elites less, guardians never", () => {
  const world = arena(flat);
  const light = dummy(world, "caterpie", 3, 0);
  const heavy = dummy(world, "golem", 0, 3);
  const elite = spawnEnemy(world, "caterpie", -3, 0, true);
  const guardian = dummy(world, "scyther", 0, -3);
  for (const enemy of [light, heavy, elite, guardian]) shove(world, enemy, 1);
  const pushed = (enemy) => Math.hypot(enemy.knockX, enemy.knockZ);
  assert.ok(Math.abs(pushed(light) - (1 - enemies.caterpie.poise)) < 1e-9);
  assert.ok(Math.abs(pushed(heavy) - (1 - enemies.golem.poise)) < 1e-9);
  assert.ok(pushed(elite) <= 0.3 + 1e-9, "an elite stands at least 0.7 firm");
  assert.equal(pushed(guardian), 0);

  // A vortex at the origin drags the light enemy in further than the heavy one.
  const pull = arena(flat);
  const a = dummy(pull, "caterpie", 2, 0);
  const b = dummy(pull, "golem", -2, 0);
  const boss = dummy(pull, "scyther", 0, 2);
  const ctx = { world: pull, grid: new EnemyGrid() };
  ctx.grid.rebuild(pull.enemies);
  pullToward(ctx, { x: 0, z: 0, radius: 1.5 }, 0.2);
  assert.ok(2 - a.x > 2 * (b.x + 2), "the light enemy moves more than twice as far");
  assert.equal(boss.z, 2);
});

test("stagger: a heavy hit cancels a wind-up and holds the enemy, then 2 s of immunity", () => {
  const world = arena(flat);
  const spearow = attacker(world, "spearow", 4, 0);
  run(world, LUNGE.dive.windup / 2);
  assert.equal(spearow.phase, "windup");
  shove(world, spearow, STAGGER.threshold / (1 - enemies.spearow.poise) - 0.01);
  assert.equal(spearow.stagger, 0, "below the threshold nothing happens");
  shove(world, spearow, 1.5);
  const start = world.players[0].hp;
  run(world, TICK);
  assert.equal(spearow.phase, "chase", "the wind-up is cancelled");
  assert.equal(hazardsOf(world, "dash-warn").length, 0, "with its lane");
  const held = [spearow.x, spearow.z];
  spearow.knockX = spearow.knockZ = 0;
  run(world, STAGGER.time - 2 * TICK);
  assert.deepEqual([spearow.x, spearow.z], held, "held still");
  assert.equal(world.players[0].hp, start);
  const left = spearow.stagger;
  shove(world, spearow, 3);
  assert.equal(spearow.stagger, left, "immune right after a stagger");
  run(world, STAGGER.immune + TICK);
  assert.equal(spearow.stagger, 0);
});

test("stagger never stops a lunge in motion, a heavy enemy's wind-up, or the guardian", () => {
  const world = arena(flat);
  const spearow = attacker(world, "spearow", 4, 0);
  run(world, LUNGE.dive.windup + 2 * TICK);
  assert.equal(spearow.phase, "dash");
  shove(world, spearow, 3);
  run(world, TICK);
  assert.equal(spearow.phase, "dash", "a dive under way keeps going");
  assert.ok(spearow.stagger <= STAGGER.released, "and is not held");

  const geodude = attacker(world, "geodude", -6, 0);
  run(world, TICK);
  assert.equal(geodude.phase, "windup");
  shove(world, geodude, 1.5);
  run(world, TICK);
  assert.equal(geodude.phase, "windup", "an ordinary hit does not stagger a heavy roller");

  const guardian = dummy(world, "scyther", 0, 5);
  shove(world, guardian, 6);
  assert.equal(guardian.stagger, 0);
});
