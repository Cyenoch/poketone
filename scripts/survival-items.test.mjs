import assert from "node:assert/strict";
import test from "node:test";
import { heal } from "../src/run/sim/combat.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { damagePlayer } from "../src/run/sim/hurt.ts";
import { partnerSlots } from "../src/run/sim/partners.ts";
import { currentStats, refreshStats } from "../src/run/sim/stats.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { fire } from "../src/run/sim/triggers/index.ts";
import { itemCap } from "../src/run/sim/upgrades.ts";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";

function setup(items = [], starter = "charmander") {
  const world = createWorld({ stage: "forest", seed: 3, difficulty: 0, players: [{ starter }] });
  const player = world.players[0];
  player.x = player.z = 0;
  player.moves = [];
  player.items = items;
  player.invulnerable = 0;
  refreshStats();
  const ctx = { world, grid: new EnemyGrid() };
  return { world, player, ctx };
}

const tick = (ctx, player, seconds = TICK) => {
  for (let i = 0; i < Math.round(seconds / TICK); i++) {
    ctx.world.time += TICK;
    refreshStats();
    fire(ctx, player, "tick", { dt: TICK });
    player.invulnerable = 0;
  }
};

test("Revive turns one knockout per level into a comeback at its HP share, then lets the next one land", () => {
  const { world, player } = setup([{ id: "revive", level: 1 }]);
  damagePlayer(world, player, 1e6);
  assert.equal(player.alive, true);
  assert.ok(Math.abs(player.hp - currentStats(player).maxHp * 0.35) < 1e-9);
  assert.ok(world.events.some((e) => e.t === "revive"));
  player.invulnerable = 0;
  damagePlayer(world, player, 1e6);
  assert.equal(player.alive, false, "one use per run at level 1");
});

test("Focus Sash holds once per evolution stage", () => {
  const { world, player } = setup([{ id: "focus-sash", level: 1 }]);
  damagePlayer(world, player, 1e6);
  assert.equal(player.hp, 1);
  player.invulnerable = 0;
  player.stage = 1;
  damagePlayer(world, player, 1e6);
  assert.equal(player.alive, true, "a new stage, a new save");
  player.invulnerable = 0;
  damagePlayer(world, player, 1e6);
  assert.equal(player.alive, false);
});

test("Guard Spec blocks a whole hit, then needs its period before the next block", () => {
  const { world, player, ctx } = setup([{ id: "guard-spec", level: 1 }]);
  const hp = player.hp;
  damagePlayer(world, player, 10);
  assert.equal(player.hp, hp, "blocked");
  player.invulnerable = 0;
  damagePlayer(world, player, 10);
  assert.ok(player.hp < hp, "the guard is down");
  tick(ctx, player, 14.1);
  const now = player.hp;
  damagePlayer(world, player, 10);
  assert.equal(player.hp, now, "back after 14 s");
});

test("Adrenaline Orb speeds the player up for 3 s after a hit lands, then wears off", () => {
  const { world, player, ctx } = setup([{ id: "adrenaline-orb", level: 1 }]);
  tick(ctx, player);
  const base = currentStats(player).speed;
  damagePlayer(world, player, 1);
  tick(ctx, player, 2 * TICK);
  refreshStats();
  assert.ok(currentStats(player).speed > base);
  tick(ctx, player, 3);
  refreshStats(); // the fold sees the buff's timer from the next tick on
  assert.equal(currentStats(player).speed, base);
});

test("Soda Pop bursts around the player when a dash starts, credited to the player", () => {
  const { world, player } = setup([{ id: "soda-pop", level: 5 }]);
  const enemy = spawnEnemy(world, "caterpie", 1, 0);
  enemy.x = enemy.px = 1;
  enemy.z = enemy.pz = 0;
  enemy.hp = enemy.maxHp = 1e6;
  stepWorld(world, [{ t: "dash", player: 0 }]);
  stepWorld(world, []);
  assert.ok(world.events.some((e) => e.t === "item-burst" && e.player === player.id));
  assert.ok(enemy.hp < enemy.maxHp);
  assert.ok(enemy.statuses.some((s) => s.id === "wet"));
});

test("Fresh Water stores overheal up to its cap and shoots it at an enemy", () => {
  const { world, player, ctx } = setup([{ id: "fresh-water", level: 1 }]);
  const enemy = spawnEnemy(world, "caterpie", 3, 0);
  enemy.x = enemy.px = 3;
  enemy.z = enemy.pz = 0;
  enemy.hp = enemy.maxHp = 1e6;
  ctx.grid.rebuild(world.enemies);
  heal(player, 1000);
  const key = "item:fresh-water#0";
  assert.ok(Math.abs(player.fx[key] - currentStats(player).maxHp * 0.2) < 1e-9, "capped at 20%");
  tick(ctx, player, 1.6);
  assert.equal(player.fx[key], 0);
  assert.ok(enemy.hp < enemy.maxHp);
});

test("S.S. Ticket adds a partner slot and Max Ether raises five-level items' caps", () => {
  const { player } = setup([
    { id: "ss-ticket", level: 1 },
    { id: "max-ether", level: 1 },
  ]);
  assert.equal(partnerSlots(player), 3);
  assert.equal(itemCap(player, "leftovers"), 7);
  assert.equal(itemCap(player, "eviolite"), 1, "single-level items stay single");
});

test("Rare Candy's pick grants two whole levels and queues their cards behind the answered one", () => {
  const { world, player } = setup();
  player.pending.push({
    id: 77,
    source: "level",
    options: [{ kind: "item", item: "rare-candy" }],
  });
  const level = player.level;
  stepWorld(world, [{ t: "pick", player: 0, card: 77, index: 0 }]);
  assert.equal(player.level, level + 2);
  assert.equal(player.pending.length, 2);
});
