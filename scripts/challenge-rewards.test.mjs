import { unlockIds } from "../src/run/sim/content/unlocks.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { damageEnemy } from "../src/run/sim/combat.ts";
import { itemIds } from "../src/run/sim/content/items.ts";
import { starters } from "../src/run/sim/content/lines/index.ts";
import { ruleIds } from "../src/run/sim/content/rules.ts";
import {
  CAP_STARDUST_RATE,
  HELD_ITEM_STARDUST,
  LEVEL_CAP,
} from "../src/run/sim/content/params/rules.ts";
import { SITE } from "../src/run/sim/content/params/sites.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { formOf } from "../src/run/sim/evolution.ts";
import { fuseMoves } from "../src/run/sim/fusion.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { gainXp, pickEffects, queueCard } from "../src/run/sim/progression.ts";
import { createRng } from "../src/run/sim/rng.ts";
import { collectRoutePickup, prepareRouteField } from "../src/run/sim/route-rewards.ts";
import { interactSite, settleSiteKill, updateSites } from "../src/run/sim/sites/index.ts";
import { playerStats, xpForLevel } from "../src/run/sim/stats.ts";
import { levelCap, newMoveState, offerKey } from "../src/run/sim/upgrades.ts";
import { applyCommand, collectRemainingPickups, createWorld } from "../src/run/sim/world.ts";
import { enterZone, prepareZone } from "../src/run/sim/zones.ts";
import { selectTestExit } from "./fixtures/route.mjs";

function run(rules, starters = ["squirtle"], route = ["forest"]) {
  return createWorld({
    unlocks: unlockIds,
    mode: "expedition",
    seed: 5,
    difficulty: 0,
    stage: route.at(-1),
    route,
    rules,
    players: starters.map((starter) => ({ trainer: "chengxi", starter, shiny: false })),
  });
}

function pick(world, player, index) {
  assert.ok(index >= 0, "the chosen reward must be on the card");
  const command = { t: "pick", player: player.id, card: player.pending[0].id, index };
  applyCommand(world, command);
  return command;
}

function limitItems(player, ...allowed) {
  player.banished.push(...itemIds.filter((id) => !allowed.includes(id)).map(offerKey.item));
}

function placeSite(world, player, kind) {
  const site = {
    id: world.nextId++,
    kind,
    state: "ready",
    x: player.x,
    z: player.z,
    radius: 1,
    owner: null,
    data: { progress: 0, uses: 0, enemy: null, lastHurt: 0 },
  };
  world.sites = [site];
  return site;
}

test("overflow pays only its recipient, including the pickup that hits each route cap", () => {
  const world = run(ruleIds, ["squirtle", "dratini"]);
  const [p, peer] = world.players;
  p.lab = { ...p.lab, modifiers: [{ stat: "stardust", op: "add", value: 0.08 }] };
  for (const [step, cap] of LEVEL_CAP.entries()) {
    if (step > 0) {
      selectTestExit(world, ["forest", "coast", "volcano", "tower"][step]);
      enterZone(world, prepareZone(world));
      const level = p.level;
      gainXp(world, p, p.xpNext);
      assert.equal(p.level, level + 1);
      pick(world, p, 0);
    }
    Object.assign(p, { level: cap - 1, xpNext: xpForLevel(cap - 1), xp: 7 });
    const before = p.stardust;
    const cardsBefore = p.pending.length;
    gainXp(world, p, p.xpNext - p.xp + 1);
    gainXp(world, p, 199);
    assert.equal(p.level, cap);
    assert.equal(p.xp, 0);
    assert.equal(p.stardust - before, 200 * CAP_STARDUST_RATE);
    assert.equal(peer.stardust, 0);
    assert.equal(p.pending.length, cardsBefore + 1);
    assert.equal(p.pending.at(-1).source, "level");
    pick(world, p, 0);
  }
});

test("Rare Candy grants only the levels and cards remaining before the map cap", () => {
  const world = run(["level-cap"]);
  const [p] = world.players;
  Object.assign(p, { level: 21, xp: 7, xpNext: xpForLevel(21) });
  p.items.push({ id: "rare-candy", level: 1 });
  pickEffects(world, p, "rare-candy");
  pickEffects(world, p, "rare-candy");
  assert.deepEqual([p.level, p.xp, p.pending.length, p.stardust], [22, 0, 1, 0]);
});

test("combined rules fill exhausted level cards with training and retain TM Case chest rewards", () => {
  const world = run(ruleIds, ["squirtle"], ["forest", "coast"]);
  const [p] = world.players;
  Object.assign(p, { level: 40, stage: 1 });
  for (const move of ["water-gun", "bubble", "hydro-pump", "surf", "rain-dance", "water-pledge"])
    p.banished.push(offerKey.move(move));
  // The only remaining kit move is off-type; the stone isn't an evolution condition for Squirtle.
  limitItems(p, "hp-up", "thunder-stone");
  queueCard(world, p, "level");
  assert.equal(p.pending[0].options.length, 3);
  const levelOptions = p.pending[0].options;
  assert.equal(levelOptions.filter((card) => card.kind === "train").length, 2);
  pick(
    world,
    p,
    levelOptions.findIndex((c) => c.kind === "item" && c.item === "hp-up"),
  );
  assert.deepEqual(p.items, [{ id: "hp-up", level: 1 }]);
  world.rng = createRng(3);
  queueCard(world, p, "chest");
  const options = p.pending[0].options;
  assert.ok(options.every((c) => c.kind === "train" || c.kind === "tm-case"));
  pick(
    world,
    p,
    options.findIndex((c) => c.kind === "tm-case"),
  );
  assert.ok(p.tmCase);
});

test("mono-type preserves off-type evolution moves, owned upgrades and fusion", () => {
  const world = run(ruleIds, ["dratini", "squirtle"], ["forest", "coast"]);
  const [dragon, turtle] = world.players;
  limitItems(dragon);
  limitItems(turtle);
  Object.assign(dragon, { level: 35, stage: 1 });
  for (const move of ["dragon-breath", "twister", "dragon-pulse"])
    dragon.banished.push(offerKey.move(move));
  queueCard(world, dragon, "level");
  pick(
    world,
    dragon,
    dragon.pending[0].options.findIndex((c) => c.move === "aqua-tail"),
  );
  assert.ok(dragon.moves.some((m) => m.id === "aqua-tail"));
  turtle.moves = ["rapid-spin", "hydro-pump"].map(newMoveState);
  for (const move of turtle.moves) move.level = levelCap(turtle, move.id);
  turtle.moves[0].level--;
  queueCard(world, turtle, "chest");
  pick(
    world,
    turtle,
    turtle.pending[0].options.findIndex((c) => c.move === "rapid-spin"),
  );
  assert.ok(fuseMoves(turtle));
  assert.equal(turtle.moves[0].id, "hydro-spiral");
});

test("field item rewards pay the recipient for item balls, glints, fishing and Snorlax", () => {
  const world = run(["no-items"], ["squirtle", "dratini"]);
  const [p, peer] = world.players;
  p.level = 25;
  limitItems(p, "leftovers");
  for (const kind of ["item-ball", "glint", "fishing", "snorlax"]) {
    const site = placeSite(world, p, kind);
    const before = p.stardust;
    // Seed 0 draws the ball's item branch and seed 1 draws a fishing item.
    world.rng = createRng(kind === "fishing" ? 1 : 0);
    if (kind === "snorlax") {
      site.state = "busy";
      site.data.enemy = 123;
      settleSiteKill({ world }, { id: 123, site: site.id }, p);
    } else {
      if (kind === "fishing") assert.ok(interactSite(world, p));
      updateSites({ world }, SITE.fishing.channel);
    }
    assert.equal(p.stardust - before, HELD_ITEM_STARDUST, kind);
    assert.deepEqual(p.items, []);
    assert.equal(peer.stardust, 0);
  }
});

test("trophy pays once by choice and Gengar charges only on an accepted stardust trade", () => {
  const world = run(ruleIds, ["squirtle", "dratini"], ["forest", "coast", "volcano"]);
  const [p, peer] = world.players;
  limitItems(p, "pp-max", "thunder-stone", "moon-stone");
  assert.ok(collectRoutePickup(world, { kind: "trophy", owner: p.id, x: p.x, z: p.z }, p));
  const options = p.pending[0].options;
  assert.deepEqual(options.map((c) => c.kind).sort(), ["item", "stardust", "upgrade"]);
  assert.equal(options.find((c) => c.kind === "item").item, "pp-max");
  const trophy = pick(
    world,
    p,
    options.findIndex((c) => c.kind === "stardust"),
  );
  applyCommand(world, trophy);
  assert.equal(p.stardust, HELD_ITEM_STARDUST);
  world.marker = "gengar-deal";
  prepareRouteField(world);
  const altar = world.sites.find((s) => s.kind === "gengar-deal");
  Object.assign(p, { x: altar.x, z: altar.z });
  assert.ok(interactSite(world, p));
  assert.deepEqual(p.pending[0].options, [{ kind: "stardust" }]);
  applyCommand(world, { t: "leave", player: p.id, dialog: p.pending[0].id });
  assert.equal(p.tradeHp, 1);
  assert.equal(p.stardust, HELD_ITEM_STARDUST);
  assert.ok(interactSite(world, p));
  const deal = pick(world, p, 0);
  applyCommand(world, deal);
  assert.equal(p.stardust, 2 * HELD_ITEM_STARDUST);
  assert.ok(p.tradeHp < 1);
  assert.deepEqual(altar.data.traded, [p.id]);
  assert.equal(interactSite(world, p), false);
  assert.equal(peer.stardust, 0);
  assert.deepEqual(p.items, []);
});

test("a shared level-up offers the stone only to Pikachu; a field pickup invalidates its open card", () => {
  const world = run(["no-items"], ["squirtle", "pikachu"]);
  const [host, guest] = world.players;
  for (const p of world.players) {
    limitItems(p, "thunder-stone");
    p.banished.push(...starters[p.starter].kit.map(offerKey.move));
    p.level = 20;
    p.xpNext = xpForLevel(p.level);
    p.xp = p.xpNext - 1;
  }
  world.pickups.push({
    id: world.nextId++,
    kind: "xp",
    x: host.x,
    z: host.z,
    value: 2,
    magnet: true,
  });
  collectRemainingPickups(world);
  assert.ok(host.pending[0].options.every((card) => card.kind === "train"));
  const open = guest.pending[0];
  const index = open.options.findIndex((card) => card.item === "thunder-stone");
  assert.ok(index >= 0);
  const originalId = open.id;
  guest.x = host.x + 10;
  placeSite(world, guest, "glint");
  updateSites({ world }, 1 / 30);
  pick(world, guest, index);
  assert.deepEqual(guest.items, [{ id: "thunder-stone", level: 1 }]);
  assert.equal(guest.stardust, 0);
  assert.notEqual(guest.pending[0].id, originalId);
  assert.ok(guest.pending[0].options.every((card) => card.kind === "train"));
  for (const p of [host, guest]) {
    placeSite(world, p, "glint");
    updateSites({ world }, 1 / 30);
    assert.equal(p.stardust, HELD_ITEM_STARDUST);
  }
  assert.deepEqual(host.items, []);
  assert.deepEqual(guest.items, [{ id: "thunder-stone", level: 1 }]);
});

test("trophies recheck each owner: the first stone evolves Pikachu and keeps its critical strike", () => {
  const world = run(["no-items"], ["pikachu", "pikachu", "squirtle"]);
  const [first, second, turtle] = world.players;
  for (const p of world.players) {
    limitItems(p, "thunder-stone");
    p.moves[0].level = levelCap(p, p.moves[0].id);
    p.level = starters.pikachu.stages.at(-1).at;
    p.stage = 1;
    collectRoutePickup(world, { kind: "trophy", owner: p.id, x: p.x, z: p.z }, p);
  }
  assert.deepEqual(turtle.pending[0].options, [{ kind: "stardust" }]);
  assert.deepEqual(second.pending[0].options, [{ kind: "item", item: "thunder-stone" }]);
  const baseCrit = playerStats(first).crit;
  pick(world, first, 0);
  assert.equal(formOf(first).id, "raichu");
  assert.deepEqual(first.items, [{ id: "thunder-stone", level: 1 }]);
  assert.ok(playerStats(first).crit > baseCrit);
  const target = spawnEnemy(world, "caterpie", first.x, first.z);
  const neighbor = spawnEnemy(world, "caterpie", first.x + 1, first.z);
  const hp = neighbor.hp;
  damageEnemy({ world, grid: new EnemyGrid() }, target, {
    owner: first,
    move: null,
    type: "normal",
    dmg: 1,
    crit: 1,
    statusChance: 0,
    knock: 0,
    fromX: first.x,
    fromZ: first.z,
  });
  assert.ok(neighbor.hp < hp, "the evolved holder's critical hit still strikes a second target");

  // While the other Pikachu's trophy is open, its own glint awards the stone and evolves it.
  second.x = first.x + 10;
  placeSite(world, second, "glint");
  updateSites({ world }, 1 / 30);
  assert.equal(formOf(second).id, "raichu");
  pick(world, second, 0);
  assert.deepEqual(second.pending[0].options, [{ kind: "stardust" }]);
  pick(world, second, 0);
  assert.deepEqual(second.items, [{ id: "thunder-stone", level: 1 }]);
  assert.equal(second.stardust, HELD_ITEM_STARDUST);
  assert.equal(first.stardust, 0);
});

test("vitamins drawn in the field can be upgraded from a level card under no-items", () => {
  for (const id of ["hp-up", "zinc", "pp-max"]) {
    const world = run(["no-items"]);
    const [p] = world.players;
    limitItems(p, id);
    p.level = 20;
    placeSite(world, p, "glint");
    updateSites({ world }, 1 / 30);
    queueCard(world, p, "level");
    pick(
      world,
      p,
      p.pending[0].options.findIndex((card) => card.item === id),
    );
    assert.deepEqual(p.items, [{ id, level: 2 }]);
    assert.equal(p.stardust, 0);
  }
});

test("without rules, forest XP can pass 22 and a glint still grants a held item", () => {
  const world = run([]);
  const [p] = world.players;
  Object.assign(p, { level: 22, xpNext: xpForLevel(22) });
  gainXp(world, p, p.xpNext + 3);
  assert.deepEqual([p.level, p.xp, p.stardust], [23, 3, 0]);
  limitItems(p, "thunder-stone");
  for (let i = 0; i < 2; i++) {
    placeSite(world, p, "glint");
    updateSites({ world }, 1 / 30);
  }
  assert.deepEqual(p.items, [{ id: "thunder-stone", level: 2 }]);
  assert.equal(p.stardust, 0);
});
