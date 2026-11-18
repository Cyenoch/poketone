import { unlockIds } from "../src/run/sim/content/unlocks.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { pack, unpack } from "../src/network/wire.ts";
import { itemIds, items } from "../src/run/sim/content/items.ts";
import { starters } from "../src/run/sim/content/lines/index.ts";
import { evolveInWorld, formOf } from "../src/run/sim/evolution.ts";
import { gainXp, queueCard } from "../src/run/sim/progression.ts";
import { createRng } from "../src/run/sim/rng.ts";
import { collectRoutePickup } from "../src/run/sim/route-rewards.ts";
import { interactSite } from "../src/run/sim/sites/index.ts";
import { restoreWorld, snapshotWorld } from "../src/run/sim/snapshot.ts";
import { currentAbility, currentStats, xpForLevel } from "../src/run/sim/stats.ts";
import { offerKey } from "../src/run/sim/upgrades.ts";
import { applyCommand, createWorld, stepSharedWorld } from "../src/run/sim/world.ts";

function run(lineIds, rules = []) {
  return createWorld({
    unlocks: unlockIds,
    mode: "expedition",
    rules,
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: lineIds.map((starter) => ({
      trainer: "chengxi",
      starter,
      shiny: false,
      unlocks: unlockIds,
    })),
  });
}

function atLevel(player, level) {
  Object.assign(player, { level, xp: 0, xpNext: xpForLevel(level) });
}

function allowItems(player, ...allowed) {
  player.banished = itemIds.filter((id) => !allowed.includes(id)).map(offerKey.item);
}

function take(player, index, card = player.pending[0].id) {
  assert.ok(index >= 0, "待选卡须包含指定选项");
  return { t: "pick", player: player.id, card, index };
}

function trophy(world, player) {
  const { id: owner, x, z } = player;
  assert.ok(collectRoutePickup(world, { kind: "trophy", owner, x, z }, player));
}

test("首次换形的二选一留在已打开的卡之后；重连和重复指令不消耗下一张卡", () => {
  const world = run(["charmander", "machop"]);
  const [host, guest] = world.players;
  atLevel(guest, starters.machop.stages[1].at - 1);
  queueCard(world, guest, "chest");
  applyCommand(world, { t: "choices", player: guest.id, open: true });
  const first = structuredClone(guest.pending[0]);

  // One host step picks up the evolution XP and a field chest with a higher rarity floor.
  guest.xp = guest.xpNext - 1;
  const { x, z } = guest;
  world.pickups.push(
    { id: world.nextId++, kind: "xp", x, z, value: 2, magnet: true },
    { id: world.nextId++, kind: "chest", x, z, value: 1, magnet: true, minRarity: 3 },
  );
  stepSharedWorld(world, []);
  assert.equal(formOf(guest).id, "machoke");
  assert.deepEqual(guest.pending[0], first);
  assert.deepEqual(
    guest.pending.map((card) => card.source),
    ["chest", "ability", "level", "chest"],
  );
  applyCommand(world, take(guest, 0));
  const ability = structuredClone(guest.pending[0]);
  assert.deepEqual(ability.options, [
    { kind: "ability", slot: 0, ability: "guts" },
    { kind: "ability", slot: 1, ability: "no-guard" },
  ]);
  Object.assign(guest, { skips: 1, banishes: 1, rerolls: 1 });
  applyCommand(world, { t: "choices", player: guest.id, open: false });
  const resumed = restoreWorld(world.map, unpack(pack(snapshotWorld(world))));
  const player = resumed.players[guest.id];
  const level = player.pending[1].id;
  const damageTaken = currentStats(player).damageTaken;
  assert.equal(player.choosing, false);
  assert.deepEqual(player.pending[0], ability);
  applyCommand(resumed, { t: "choices", player: player.id, open: true });

  for (const t of ["skip", "banish", "reroll"])
    applyCommand(resumed, { t, player: player.id, card: ability.id, index: 1 });
  applyCommand(resumed, { ...take(player, 1), player: host.id });
  assert.deepEqual(player.pending[0], ability);
  assert.equal(currentAbility(player), "guts");
  assert.deepEqual([player.skips, player.banishes, player.rerolls], [1, 1, 1]);

  applyCommand(resumed, take(player, 1));
  applyCommand(resumed, take(player, 0, ability.id));
  assert.equal(currentAbility(player), "no-guard");
  assert.ok(currentStats(player).damageTaken > damageTaken);
  assert.equal(player.pending[0].id, level);
  applyCommand(resumed, take(player, 0));
  const upgrades = player.pending[0].options.filter((option) => option.kind === "upgrade");
  assert.ok(upgrades.length && upgrades.every((option) => option.rarity === 3));
  applyCommand(resumed, take(player, 0));
  atLevel(player, starters.machop.stages[2].at);
  evolveInWorld(resumed, player, "trade");
  assert.equal(formOf(player).id, "machamp");
  assert.equal(currentAbility(player), "no-guard");
  assert.equal(player.pending.length, 0);
});

test("耿鬼的特性膏药立即生效，不占道具栏，且不给鬼斯或已经取得隐藏特性的玩家", () => {
  const world = run(["dratini", "gastly"]);
  const [dragon, ghost] = world.players;
  for (const player of world.players) allowItems(player, "ability-patch");
  const altar = {
    id: world.nextId++,
    kind: "gengar-deal",
    state: "ready",
    x: dragon.x,
    z: dragon.z,
    radius: 2,
    owner: null,
    data: { traded: [] },
  };
  world.sites = [altar];
  Object.assign(ghost, { x: dragon.x, z: dragon.z });
  assert.equal(interactSite(world, ghost), false);

  assert.ok(interactSite(world, dragon));
  const { options } = dragon.pending[0];
  applyCommand(
    world,
    take(
      dragon,
      options.findIndex((choice) => choice.item === "ability-patch"),
    ),
  );
  assert.equal(currentAbility(dragon), "marvel-scale");
  assert.deepEqual(dragon.items, []);
  assert.ok(dragon.tradeHp < 1);

  atLevel(dragon, starters.dratini.stages[2].at);
  evolveInWorld(world, dragon);
  assert.equal(currentAbility(dragon), "multiscale");
  for (const player of world.players) {
    trophy(world, player);
    assert.deepEqual(
      player.pending[0].options.map((option) => option.kind),
      ["upgrade"],
    );
  }
});

for (const opened of [true, false]) {
  test(`野外膏药使${opened ? "已打开" : "排队中"}的普通特性卡失效，保留其他待选机会`, () => {
    const world = run(["abra", "charmander"]);
    const [player] = world.players;
    const firstEvolution = starters.abra.stages[1].at;
    atLevel(player, firstEvolution - 1);
    allowItems(player, "ability-patch");
    if (!opened) trophy(world, player);
    gainXp(world, player, player.xpNext);
    applyCommand(world, { t: "choices", player: player.id, open: true });
    const [ability, level] = player.pending.slice(opened ? 0 : 1);
    const front = player.pending[0];
    const oldCard = front.id;
    const patch = front.options.findIndex((choice) => choice.item === "ability-patch");
    const upgrade = front.options.find((choice) => choice.kind === "upgrade");

    // This seed gives an item from the ball, and the archive leaves only the patch eligible.
    world.rng = createRng(0);
    world.sites = [
      {
        id: world.nextId++,
        kind: "item-ball",
        state: "ready",
        x: player.x,
        z: player.z,
        radius: 1,
        owner: null,
        data: {},
      },
    ];
    stepSharedWorld(world, []);
    assert.equal(currentAbility(player), "magic-guard");
    assert.deepEqual(player.items, []);
    applyCommand(world, take(player, 1, ability.id));

    if (opened) {
      // The lost Synchronize charge must not allow a second dash before the next tick.
      for (let i = 0; i < 2; i++) applyCommand(world, { t: "dash", player: player.id });
      assert.equal(world.events.filter((event) => event.t === "dash").length, 1);
    } else {
      applyCommand(world, take(player, patch, oldCard));
      assert.notEqual(front.id, oldCard);
      assert.deepEqual(front.options, [upgrade]);
      applyCommand(world, take(player, 0, oldCard));
      assert.equal(player.pending[0], front);
      applyCommand(world, take(player, 0));
    }
    assert.equal(currentAbility(player), "magic-guard");
    assert.equal(player.pending[0], level);
    assert.ok(level.options.length > 0);
  });
}

test("达标奖杯必含联系绳，重抽仍保留品质；选择后进化并腾出栏位", () => {
  for (const rules of [[], ["no-items"]]) {
    const world = run(["machop"], rules);
    const [player] = world.players;
    atLevel(player, starters.machop.stages[2].at);
    Object.assign(player, { stage: 1, abilitySlot: 1, rerolls: 8 });
    if (rules.length === 0) {
      player.items = ["hp-up", "honey", "leftovers", "zinc"].map((id) => ({ id, level: 1 }));
    }
    const before = structuredClone(player.items);
    trophy(world, player);
    trophy(world, player);
    const card = player.pending[0];
    for (let i = 0; i < 8; i++) {
      assert.equal(card.options.filter((choice) => choice.item === "linking-cord").length, 1);
      assert.ok(
        card.options.every((choice) =>
          choice.kind === "item"
            ? items[choice.item].rarity >= 2
            : choice.kind === "stardust" || (choice.kind === "upgrade" && choice.rarity >= 2),
        ),
      );
      applyCommand(world, { t: "reroll", player: player.id, card: card.id });
    }
    applyCommand(
      world,
      take(
        player,
        card.options.findIndex((choice) => choice.item === "linking-cord"),
      ),
    );
    assert.equal(formOf(player).id, "machamp");
    assert.equal(currentAbility(player), "no-guard");
    assert.deepEqual(player.items, before);
    assert.ok(player.pending[0].options.every((choice) => choice.item !== "linking-cord"));
  }
});

test("通信进化达标也不会绕过奖杯的道具栏位和放逐约束", () => {
  const world = run(["gastly", "abra"]);
  const [full, archived] = world.players;
  full.items = ["hp-up", "honey", "leftovers", "zinc", "magnet"].map((id) => ({ id, level: 1 }));
  allowItems(archived);
  for (const player of world.players) {
    atLevel(player, starters[player.starter].stages[2].at);
    player.stage = 1;
    trophy(world, player);
    assert.ok(player.pending[0].options.some((choice) => choice.kind === "upgrade"));
    assert.ok(player.pending[0].options.every((choice) => choice.item !== "linking-cord"));
  }
});
