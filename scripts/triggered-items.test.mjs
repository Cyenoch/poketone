import assert from "node:assert/strict";
import test from "node:test";
import { damageEnemy } from "../src/run/sim/combat.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { stagger, staggered } from "../src/run/sim/poise.ts";
import { STAGGER } from "../src/run/sim/content/params/combat.ts";
import { createRng } from "../src/run/sim/rng.ts";
import { currentStats, refreshStats } from "../src/run/sim/stats.ts";
import { find, inflict, interrupted } from "../src/run/sim/status.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { fire } from "../src/run/sim/triggers/index.ts";
import { rollChoices } from "../src/run/sim/upgrades.ts";
import { createWorld } from "../src/run/sim/world.ts";

/** One player at the origin with `items`, no moves, and `n` sturdy caterpies in a row along +x. */
function setup(items = [], n = 1, starter = "charmander") {
  const world = createWorld({ stage: "forest", seed: 3, difficulty: 0, players: [{ starter }] });
  const player = world.players[0];
  player.x = player.z = 0;
  player.moves = [];
  player.items = items;
  refreshStats();
  const enemies = Array.from({ length: n }, (_, i) => {
    const enemy = spawnEnemy(world, "caterpie", 3 + i * 0.8, 0);
    enemy.x = enemy.px = 3 + i * 0.8;
    enemy.z = enemy.pz = 0;
    enemy.hp = enemy.maxHp = 1e6;
    return enemy;
  });
  const ctx = { world, grid: new EnemyGrid() };
  ctx.grid.rebuild(world.enemies);
  return { world, player, enemies, ctx };
}

const hit = (ctx, owner, enemy, dmg = 10, extra = {}) =>
  damageEnemy(ctx, enemy, {
    owner,
    move: null,
    type: "normal",
    dmg,
    crit: -1,
    statusChance: 0,
    knock: 0,
    fromX: 0,
    fromZ: 0,
    ...extra,
  });

test("three chill charges turn into a freeze, which holds the enemy and makes it take more damage", () => {
  const { player, enemies, ctx } = setup();
  const [enemy] = enemies;
  const before = enemy.hp;
  hit(ctx, player, enemy);
  const plain = before - enemy.hp;
  inflict(enemy, "chill", 10, player.id);
  inflict(enemy, "chill", 10, player.id);
  assert.equal(find(enemy, "chill")?.stacks, 2);
  assert.equal(find(enemy, "freeze"), undefined);
  inflict(enemy, "chill", 10, player.id);
  assert.equal(find(enemy, "chill"), undefined, "the charges are spent");
  assert.ok(find(enemy, "freeze"));
  assert.ok(interrupted(enemy), "a frozen enemy's wind-ups are cancelled");
  const at = enemy.hp;
  hit(ctx, player, enemy);
  assert.ok(Math.abs(at - enemy.hp - plain * 1.2) < 1e-9);
});

test("King's Rock's flinch is the stagger: same timer, same immunity, never on the guardian", () => {
  const { world, player, enemies, ctx } = setup([{ id: "kings-rock", level: 5 }]);
  const [enemy] = enemies;
  let tries = 0;
  while (!staggered(enemy) && tries++ < 500) hit(ctx, player, enemy, 1);
  assert.ok(staggered(enemy), "a flinch rolls within a few hundred hits");
  assert.equal(enemy.stagger, STAGGER.time + STAGGER.immune);
  enemy.stagger = STAGGER.immune - 0.1; // past the hold, inside the immunity
  assert.equal(stagger(enemy), false, "no second stagger inside the immunity window");
  const boss = spawnEnemy(world, "scyther", 5, 5);
  assert.equal(stagger(boss), false);
});

test("Razor Fang finishes a low enemy once, credited to the hitter", () => {
  const { world, player, enemies, ctx } = setup([{ id: "razor-fang", level: 4 }]);
  const [enemy] = enemies;
  enemy.hp = enemy.maxHp * 0.2;
  hit(ctx, player, enemy, 0.01);
  assert.ok(enemy.hp > 0, "above the line: no execute");
  enemy.hp = enemy.maxHp * 0.11;
  hit(ctx, player, enemy, 0.01);
  assert.equal(enemy.hp <= 0, true);
  assert.equal(player.kills, 1);
  assert.equal(world.events.filter((e) => e.t === "death").length, 1);
});

test("a kill burst damages the crowd for its owner and does not chain through the kills it makes", () => {
  const { world, player, enemies, ctx } = setup([{ id: "leaf-stone", level: 3 }], 6);
  // Guarantee the burst: the leaf stone rolls 10%, so retry fresh victims until one bursts.
  for (const enemy of enemies.slice(1)) enemy.hp = 1;
  let bursts = 0;
  for (let i = 0; i < 200 && bursts === 0; i++) {
    const victim = spawnEnemy(world, "caterpie", 3, 0.2);
    victim.x = 3;
    victim.z = 0.2;
    ctx.grid.rebuild(world.enemies);
    hit(ctx, player, victim, 1e6);
    bursts = world.events.filter((e) => e.t === "item-burst").length;
  }
  assert.equal(bursts, 1, "one burst, even though it killed enemies of its own");
  assert.ok(enemies.slice(1).some((enemy) => enemy.hp <= 0));
  assert.ok(world.events.filter((e) => e.t === "hit").every((e) => e.by === player.id));
  assert.ok(world.events.some((e) => e.t === "heal" && e.player === player.id));
});

test("Electirizer strikes on its period and credits its owner", () => {
  const { world, player, ctx } = setup([{ id: "electirizer", level: 1 }], 3);
  const period = 2.5;
  for (let t = 0; t < Math.round((period - 0.1) / TICK); t++) {
    refreshStats();
    fire(ctx, player, "tick", { dt: TICK });
  }
  assert.equal(world.events.filter((e) => e.t === "item-burst").length, 0);
  for (let t = 0; t < Math.round(0.2 / TICK); t++) {
    refreshStats();
    fire(ctx, player, "tick", { dt: TICK });
  }
  assert.equal(world.events.filter((e) => e.t === "item-burst").length, 2);
  assert.ok(world.events.filter((e) => e.t === "hit").every((e) => e.by === player.id));
});

test("a scaling item's modifier follows its measure (Rage Candy Bar: missing HP → damage)", () => {
  const { player, ctx } = setup([{ id: "rage-candy-bar", level: 1 }], 1, "bulbasaur");
  const tick = () => {
    fire(ctx, player, "tick", { dt: TICK });
    refreshStats();
  };
  const full = currentStats(player).damage;
  player.hp = currentStats(player).maxHp * 0.5;
  tick();
  assert.ok(Math.abs(currentStats(player).damage - full - 0.25) < 1e-9, "50% missing × 0.5");
  player.hp = 1;
  tick();
  assert.ok(Math.abs(currentStats(player).damage - full - 0.4) < 1e-9, "capped");
});

test("status-fed items are offered only to players who can apply that status", () => {
  const offered = (starter, items) => {
    const { player } = setup(items, 1, starter);
    player.level = 20;
    const rng = createRng(4);
    const seen = new Set();
    for (let i = 0; i < 800; i++)
      for (const c of rollChoices(rng, player, "level")) if (c.kind === "item") seen.add(c.item);
    return seen;
  };
  assert.ok(offered("charmander", []).has("fire-stone"), "charmander burns");
  assert.ok(!offered("squirtle", []).has("fire-stone"));
  assert.ok(!offered("squirtle", []).has("ice-stone"), "nothing chills yet");
  assert.ok(offered("squirtle", [{ id: "snowball", level: 1 }]).has("ice-stone"));
});
