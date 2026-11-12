import assert from "node:assert/strict";
import test from "node:test";
import { damageEnemy } from "../src/run/sim/combat.ts";
import { items } from "../src/run/sim/content/items.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { damagePlayer, updateShield } from "../src/run/sim/hurt.ts";
import { DASH_COOLDOWN, SHIELD } from "../src/run/sim/content/params/player.ts";
import { createRng } from "../src/run/sim/rng.ts";
import { currentStats, playerStats, refreshStats } from "../src/run/sim/stats.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { fire } from "../src/run/sim/triggers/index.ts";
import { rollChoices } from "../src/run/sim/upgrades.ts";
import { ITEM_GATES } from "../src/run/sim/content/params/cards.ts";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";

const world = (starter = "squirtle") =>
  createWorld({ stage: "forest", seed: 3, difficulty: 0, players: [{ starter }] });

/** Item ids offered to `player` over `n` level-up rolls. */
function offered(player, n = 400) {
  const rng = createRng(11);
  const seen = new Set();
  for (let i = 0; i < n; i++)
    for (const choice of rollChoices(rng, player, "level"))
      if (choice.kind === "item") seen.add(choice.item);
  return seen;
}

test("Torrent Shell's shield takes a hit before HP and refills after a quiet spell", () => {
  const w = world("squirtle");
  const player = w.players[0];
  player.invulnerable = 0;
  const max = currentStats(player).shield;
  assert.ok(max > 0);
  assert.equal(player.shield, max, "starts full");
  const hp = player.hp;
  damagePlayer(w, player, 5);
  assert.equal(player.hp, hp, "a small hit only dents the shield");
  assert.ok(player.shield < max);
  player.invulnerable = 0;
  damagePlayer(w, player, 1000);
  assert.equal(player.shield, 0);
  assert.equal(player.alive, false, "what the shield cannot hold reaches HP");
  // Refill: nothing inside the delay, then full after the refill time.
  const v = world("squirtle");
  const p = v.players[0];
  p.shield = 1;
  p.lastHurt = 0;
  v.time = SHIELD.delay - 0.5;
  updateShield(v, p, 0.5);
  assert.equal(p.shield, 1);
  v.time = SHIELD.delay;
  for (let t = 0; t < SHIELD.refill / TICK + 1; t++) updateShield(v, p, TICK);
  assert.equal(p.shield, max);
});

test("a dash charge item lets two dashes chain; charges come back one cooldown at a time", () => {
  const w = world("charmander");
  const player = w.players[0];
  player.items = [{ id: "air-balloon", level: 1 }];
  refreshStats();
  player.dashes = currentStats(player).dashCharges;
  assert.equal(player.dashes, 2);
  const dashes = () => w.events.filter((e) => e.t === "dash").length;
  for (let i = 0; i < 3; i++) stepWorld(w, [{ t: "dash", player: 0 }]);
  assert.equal(dashes(), 2, "two charges, the third press is ignored");
  for (let t = 0; t < DASH_COOLDOWN / TICK; t++) stepWorld(w, []);
  assert.equal(player.dashes, 1, "one charge back after one cooldown");
});

test("boosters only reach players who hit with their type or category, and gated tiers wait for level", () => {
  const charmander = world("charmander").players[0];
  const seen = offered(charmander);
  assert.ok(seen.has("charcoal"));
  for (const id of ["mystic-water", "miracle-seed", "magnet", "muscle-band", "choice-band"])
    assert.ok(!seen.has(id), `${id} is a dead card for charmander`);
  for (const id of seen) assert.ok(items[id].rarity < 2, `${id} gated at level 1`);
  const bulbasaur = world("bulbasaur").players[0];
  assert.ok(offered(bulbasaur).has("muscle-band"), "bulbasaur has physical moves");
  const late = world("charmander").players[0];
  late.level = ITEM_GATES[3][1];
  assert.ok(
    [...offered(late)].some((id) => items[id].rarity === 3),
    "legendaries open late",
  );
});

test("Cleanse Tag adds damage on elites only", () => {
  const w = world("charmander");
  const player = w.players[0];
  const ctx = { world: w, grid: new EnemyGrid() };
  const plain = spawnEnemy(w, "caterpie", 3, 0);
  const elite = spawnEnemy(w, "caterpie", -3, 0, true);
  for (const e of [plain, elite]) e.hp = e.maxHp = 1e6;
  const hit = (enemy) => {
    const before = enemy.hp;
    damageEnemy(ctx, enemy, {
      owner: player,
      move: null,
      type: "normal",
      dmg: 10,
      crit: -1,
      statusChance: 0,
      knock: 0,
      fromX: 0,
      fromZ: 0,
    });
    return before - enemy.hp;
  };
  const base = [hit(plain), hit(elite)];
  player.items = [{ id: "cleanse-tag", level: 2 }];
  refreshStats();
  assert.equal(hit(plain), base[0]);
  assert.ok(Math.abs(hit(elite) - base[1] * 1.24) < 1e-9);
});

test("Sitrus Berry heals once below its line, then waits its cooldown", () => {
  const w = world("charmander");
  const player = w.players[0];
  player.items = [{ id: "sitrus-berry", level: 1 }];
  refreshStats();
  const ctx = { world: w, grid: new EnemyGrid() };
  const max = playerStats(player).maxHp;
  const run = (seconds) => {
    for (let t = 0; t < seconds / TICK; t++) {
      refreshStats();
      fire(ctx, player, "tick", { dt: TICK });
    }
  };
  player.hp = max * 0.5;
  run(1);
  assert.equal(player.hp, max * 0.5, "above the line: nothing");
  player.hp = max * 0.2;
  run(TICK);
  assert.ok(Math.abs(player.hp - max * (0.2 + 0.2)) < 1e-9);
  player.hp = max * 0.1;
  run(10);
  assert.equal(player.hp, max * 0.1, "cooling down");
});

test("Berry Juice heals the player credited with the kill, not a teammate", () => {
  const w = createWorld({
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: [{ starter: "charmander" }, { starter: "squirtle" }],
  });
  const [owner, other] = w.players;
  owner.items = [{ id: "berry-juice", level: 5 }];
  refreshStats();
  const ctx = { world: w, grid: new EnemyGrid() };
  owner.hp = other.hp = 10;
  let healed = 0;
  for (let i = 0; i < 200 && healed === 0; i++) {
    const enemy = spawnEnemy(w, "caterpie", 3, 0);
    enemy.hp = 1;
    damageEnemy(ctx, enemy, {
      owner,
      move: null,
      type: "fire",
      dmg: 50,
      crit: -1,
      statusChance: 0,
      knock: 0,
      fromX: 0,
      fromZ: 0,
    });
    healed = owner.hp - 10;
  }
  assert.ok(healed > 0, "a kill eventually procs");
  assert.equal(other.hp, 10, "the teammate is not healed");
});
