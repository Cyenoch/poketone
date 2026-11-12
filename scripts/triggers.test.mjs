import assert from "node:assert/strict";
import test from "node:test";
import { damageEnemy } from "../src/run/sim/combat.ts";
import { abilities } from "../src/run/sim/content/abilities.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { find } from "../src/run/sim/status.ts";
import { currentStats, refreshStats } from "../src/run/sim/stats.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { fire } from "../src/run/sim/triggers/index.ts";
import { createWorld } from "../src/run/sim/world.ts";

/** A world with one player at the origin, no moves, and one unkillable enemy at (x, 0). */
function setup(starter, x) {
  const world = createWorld({ stage: "forest", seed: 3, difficulty: 0, players: [{ starter }] });
  const player = world.players[0];
  player.x = player.z = 0;
  player.moves = [];
  const enemy = spawnEnemy(world, "caterpie", x, 0);
  enemy.x = enemy.px = x;
  enemy.z = enemy.pz = 0;
  enemy.hp = enemy.maxHp = 1e6;
  const ctx = { world, grid: new EnemyGrid() };
  ctx.grid.rebuild(world.enemies);
  return { world, player, enemy, ctx };
}

const tick = (ctx, player, seconds) => {
  for (let i = 0; i < Math.round(seconds / TICK); i++) {
    refreshStats();
    fire(ctx, player, "tick", { dt: TICK });
  }
};

test("Static's zap waits its period, then hits the nearest enemy for its owner and paralyses it", () => {
  const { world, player, enemy, ctx } = setup("pikachu", 3);
  const zap = abilities.static.effect.triggers.find((t) => t.kind === "zap");
  tick(ctx, player, zap.seconds[0] - 0.1);
  assert.equal(enemy.hp, enemy.maxHp, "nothing before the period");
  tick(ctx, player, 0.2);
  assert.equal(enemy.maxHp - enemy.hp > 0, true);
  assert.ok(find(enemy, "paralysis"));
  const hits = world.events.filter((e) => e.t === "hit");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].by, player.id);
});

test("Static's zap holds its charge while no enemy is in range and fires as soon as one is", () => {
  const { player, enemy, ctx } = setup("pikachu", 30);
  tick(ctx, player, 10);
  assert.equal(enemy.hp, enemy.maxHp);
  enemy.x = enemy.px = 3;
  ctx.grid.rebuild(ctx.world.enemies);
  tick(ctx, player, TICK);
  assert.ok(enemy.hp < enemy.maxHp);
});

test("Photosynthesis heals on grass hits at most its per-second cap, and not on other types", () => {
  const { player, enemy, ctx } = setup("bulbasaur", 2);
  const cap = abilities.photosynthesis.effect.triggers[0].perSecond;
  const hit = (type) =>
    damageEnemy(ctx, enemy, {
      owner: player,
      move: null,
      type,
      dmg: 1,
      crit: 0,
      statusChance: 0,
      knock: 0,
      fromX: 0,
      fromZ: 0,
    });
  const { maxHp, healing } = currentStats(player);
  player.hp = 1;
  hit("fire");
  assert.equal(player.hp, 1, "a fire hit does not heal");
  for (let i = 0; i < cap + 3; i++) hit("grass");
  const healed = player.hp - 1;
  const each = maxHp * abilities.photosynthesis.effect.triggers[0].heal[0] * healing;
  assert.ok(Math.abs(healed - cap * each) < 1e-9, `${healed} vs ${cap} × ${each}`);
});
