import { unlockIds } from "../src/run/sim/content/unlocks.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { killEnemy } from "../src/run/sim/combat.ts";
import { clearZone } from "../src/run/sim/currentZone.ts";
import { itemIds, items } from "../src/run/sim/content/items.ts";
import {
  rollExitMarkers,
  rollRouteModifier,
  routeMarkers,
  routeModifiers,
} from "../src/run/sim/content/route.ts";
import { selectTestExit } from "./fixtures/route.mjs";
import { mobilityClasses } from "../src/run/sim/content/mobility.ts";
import { STARDUST } from "../src/run/sim/content/params/economy.ts";
import { spawnEnemy, summonGuardian } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { bodyFits, cellAt, routeReach } from "../src/run/sim/nav/index.ts";
import { nextCard, pickEffects, queueCard } from "../src/run/sim/progression.ts";
import { createRng } from "../src/run/sim/rng.ts";
import {
  cancelRouteDeal,
  collectRoutePickup,
  lightRadius,
  pickRouteReward,
  prepareRouteField,
  routeSpawnFactors,
} from "../src/run/sim/route-rewards.ts";
import { interactSite, siteHere, updateSites } from "../src/run/sim/sites/index.ts";
import { currentStats, playerStats, statBreakdown } from "../src/run/sim/stats.ts";
import { applyChoice, itemCap, levelCap } from "../src/run/sim/upgrades.ts";
import {
  applyCommand,
  collectRemainingPickups,
  createWorld,
  createWorldFromSeeds,
} from "../src/run/sim/world.ts";
import { enterZone, prepareZone } from "../src/run/sim/zones.ts";

function run(route = ["forest"], starters = ["charmander", "squirtle"]) {
  let seed = 5;
  return createWorldFromSeeds(
    {
      mode: "expedition",
      rules: [],
      stage: route.at(-1),
      route,
      difficulty: 0,
      players: starters.map((starter) => ({ trainer: "chengxi", starter })),
    },
    () => seed++,
  );
}

test("exit groups are unique, destination-gated and reproducible", () => {
  const seen = new Set();
  for (const [step, targets] of [
    [1, ["desert", "coast", "desert"]],
    [2, ["volcano", "glacier", "volcano"]],
    [3, ["tower", "tower"]],
  ]) {
    for (let seed = 0; seed < 60; seed++) {
      const marks = rollExitMarkers(createRng(seed), targets);
      assert.deepEqual(marks, rollExitMarkers(createRng(seed), targets));
      assert.equal(new Set(marks).size, targets.length);
      if (step === 1) assert.ok(!marks.includes("gengar-deal"));
      if (step === 3) assert.ok(!marks.includes("pokecenter"));
      for (const id of marks) seen.add(id);
    }
  }
  assert.deepEqual(seen, new Set(Object.keys(routeMarkers)));
});

test("only valid building locations receive bonus chests / TMs; dispelling restores visibility for everyone", () => {
  const w = run(["forest", "coast"], ["charmander", "squirtle", "pikachu"]);
  const out = routeReach(w.nav, mobilityClasses.ground, [w.nav.grid.home], false);
  const back = routeReach(w.nav, mobilityClasses.ground, [w.nav.grid.home], true);
  const seeds = new Map();
  for (let seed = 0; seed < 100; seed++) {
    for (const step of [0, 3]) assert.equal(rollRouteModifier(createRng(seed), step), null);
    seeds.set(rollRouteModifier(createRng(seed), 1), seed);
  }
  assert.equal(seeds.size, Object.keys(routeModifiers).length + 1);
  for (const [modifier, seed] of seeds) {
    Object.assign(w, { rng: createRng(seed), marker: "chests", pickups: [] });
    prepareRouteField(w);
    assert.equal(w.modifier, modifier);
    assert.equal(w.pickups.filter((p) => p.kind === "chest").length, 3);
    for (const p of w.pickups) {
      assert.equal(out[cellAt(w.nav.grid, p.x, p.z)], 1);
      assert.equal(back[cellAt(w.nav.grid, p.x, p.z)], 1);
      assert.ok(bodyFits(w.nav, mobilityClasses.ground, p.x, p.z, 0.5));
      assert.ok(
        w.map.pads.some(
          (pad) => pad.tag === "building" && Math.hypot(pad.x - p.x, pad.z - p.z) <= pad.radius,
        ),
      );
    }
    const [fire, water, electric] = w.players;
    if (modifier === "dark-cave") {
      assert.ok(lightRadius(w, fire) > lightRadius(w, water));
      assert.ok(lightRadius(w, electric) > lightRadius(w, water));
    }
    if (modifier === "dark-cave" || modifier === "fog") {
      const tm = w.pickups.find((p) => p.kind === (modifier === "fog" ? "defog" : "flash"));
      assert.ok(collectRoutePickup(w, tm, water));
      assert.equal(w.modifier, null);
      assert.equal(lightRadius(w, fire), Infinity);
      assert.ok(!collectRoutePickup(w, tm, fire));
    } else assert.equal(w.pickups.length, 3);
  }
});

test("preparing the same chosen exit twice leaves live players and RNG alone; only commit heals", () => {
  const w = run();
  for (const p of w.players) {
    p.hp = 2;
    p.statuses.push({ id: "poison", time: 2, power: 1, by: -1 });
  }
  const leaving = selectTestExit(w, "coast");
  assert.equal(w.zone.exits[leaving].marker, "pokecenter");
  const players = structuredClone(w.players),
    rng = w.rng.state;
  const a = prepareZone(w),
    b = prepareZone(w);
  assert.deepEqual(w.players, players);
  assert.equal(w.rng.state, rng);
  assert.deepEqual([a.rng, a.modifier, a.pickups], [b.rng, b.modifier, b.pickups]);
  enterZone(w, b);
  for (const p of w.players) {
    assert.equal(p.hp, playerStats(p).maxHp);
    assert.deepEqual(p.statuses, []);
  }
  w.players[0].hp = 2;
  assert.throws(() => enterZone(w, a));
  assert.equal(w.players[0].hp, 2);
});

test("guardian pays each living seat exactly once; a teammate cannot receive or answer its trophy", () => {
  const w = run(["forest"], ["charmander", "pikachu", "squirtle", "abra"]);
  const [a, b, down, left] = w.players;
  down.alive = false;
  left.departed = true;
  summonGuardian(w, a);
  const boss = w.enemies.find((e) => e.id === w.bossId);
  const ctx = { world: w, grid: new EnemyGrid() };
  boss.hp = 0;
  killEnemy(ctx, boss, null);
  const reward = a.stardust;
  killEnemy(ctx, boss, null);
  assert.equal(a.stardust, reward);
  const cups = w.pickups.filter((p) => p.kind === "trophy");
  assert.deepEqual(
    cups.map((p) => p.owner),
    [a.id, b.id],
  );
  assert.equal(collectRoutePickup(w, cups[0], b), false);
  for (const [i, p] of [a, b].entries()) assert.ok(collectRoutePickup(w, cups[i], p));
  const card = a.pending[0];
  assert.equal(card.source, "chest");
  assert.equal(card.offer.kind, "trophy");
  assert.equal(card.options.length, 3);
  assert.equal(new Set(card.options.map((c) => c.item ?? c.move)).size, 3);
  for (const c of card.options)
    assert.ok(
      c.kind === "item"
        ? items[c.item].rarity >= 2
        : c.kind === "upgrade" && a.moves.some((m) => m.id === c.move),
    );
  assert.equal(pickRouteReward(w, b, card, card.options[0]), false);
  const [old, ...kept] = card.options;
  a.banished.push(old.kind === "item" ? `item:${old.item}` : `move:${old.move}`);
  const oldId = card.id;
  applyCommand(w, { t: "pick", player: a.id, card: oldId, index: 0 });
  assert.notEqual(card.id, oldId);
  assert.deepEqual(card.options.slice(0, 2), kept);
  const keys = card.options.map((choice) => choice.item ?? choice.move);
  assert.equal(new Set(keys).size, 3);
  assert.ok(!keys.includes(old.item ?? old.move));
  assert.ok(pickRouteReward(w, a, card, card.options[0]));
  applyChoice(a, card.options[0]);
  nextCard(w, a);
  assert.equal(pickRouteReward(w, a, card, card.options[0]), false);
  assert.equal(b.pending.length, 1);
});

function altar(w) {
  w.marker = "gengar-deal";
  prepareRouteField(w);
  const s = w.sites.find((s) => s.kind === "gengar-deal");
  assert.ok(w.map.pads.some((p) => p.tag === "site" && p.x === s.x && p.z === s.z));
  for (const p of w.players) Object.assign(p, { x: s.x, z: s.z });
  return s;
}

test("switching to manual cards leaves a solo altar decision open until the matching decline", () => {
  const world = run(["forest", "coast", "volcano"], ["charmander"]);
  const [player] = world.players;
  altar(world);
  assert.ok(interactSite(world, player));
  const card = player.pending[0];
  applyCommand(world, { t: "cardMode", player: player.id, manual: true });
  assert.equal(player.manualCards, true);
  assert.equal(player.choosing, true);
  assert.equal(player.pending[0], card);
  applyCommand(world, { t: "leave", player: player.id, dialog: card.id });
  assert.equal(player.choosing, false);
  assert.equal(player.pending.length, 0);
  assert.equal(player.tradeHp, 1);
});

test("departure cancels the unpaid deal and settles travelling trophies by owner exactly once", () => {
  const w = run(["forest", "coast", "volcano"]),
    [a, b] = w.players;
  const site = altar(w);
  assert.ok(interactSite(w, a));
  const stale = a.pending[0].id;
  queueCard(w, b, "level");
  w.pickups = [a, b].map((p) => ({
    id: w.nextId++,
    kind: "trophy",
    owner: p.id,
    x: b.x,
    z: b.z,
    value: 1,
    magnet: true,
  }));
  selectTestExit(w, "tower");
  collectRemainingPickups(w);
  assert.deepEqual(
    a.pending.map((c) => c.offer?.kind),
    ["trophy"],
  );
  assert.deepEqual(
    b.pending.map((c) => c.offer?.kind),
    [undefined, "trophy"],
  );
  assert.deepEqual(b.pending[1].options, []);
  const card = a.pending[0];
  applyCommand(w, { t: "pick", player: a.id, card: stale, index: 0 });
  assert.equal(a.pending[0], card);
  assert.equal(a.tradeHp, 1);
  assert.deepEqual(site.data.traded, []);
  const before = b.pending[0];
  applyCommand(w, { t: "pick", player: b.id, card: before.id, index: 0 });
  assert.equal(b.pending[0].offer.kind, "trophy");
  assert.equal(b.pending[0].options.length, 3);
  assert.equal(w.events.filter((e) => e.t === "route" && e.kind === "trophy").length, 2);
});

test("a tower exit waiting on a trophy preserves the teammate's open deal", () => {
  const world = run(["forest", "coast", "volcano", "tower"]);
  const [host, guest] = world.players;
  altar(world);
  assert.ok(interactSite(world, guest));
  const deal = guest.pending[0];
  clearZone(world, host.x, host.z);
  const exit = world.zone.exits[0];
  Object.assign(host, { x: exit.x, z: exit.z });
  world.pickups = [
    { id: world.nextId++, kind: "trophy", owner: host.id, x: exit.x, z: exit.z, value: 1 },
  ];
  applyCommand(world, { t: "interact", player: host.id });
  assert.equal(world.outcome, "playing");
  assert.equal(world.zone.leaving, null);
  assert.equal(guest.pending[0], deal);
  assert.equal(guest.choosing, true);
  applyCommand(world, { t: "pick", player: host.id, card: host.pending[0].id, index: 0 });
  applyCommand(world, { t: "interact", player: host.id });
  assert.equal(world.outcome, "victory");
  assert.equal(guest.pending.length, 0);
  assert.equal(guest.tradeHp, 1);
});

test("cancel or stale trade costs nothing, resumes the queue; accepted trades stack personally across sites", () => {
  const w = run(["forest", "coast", "volcano", "tower"]),
    [a, b] = w.players;
  const s = altar(w),
    max = currentStats(a).maxHp;
  assert.ok(
    w.sites.some((s) => s.kind === "ghost") && w.sites.some((s) => s.kind === "silph-scope"),
  );
  assert.ok(interactSite(w, a));
  queueCard(w, a, "chest", undefined, { kind: "trophy" });
  const first = a.pending[0].id;
  a.rerolls = a.skips = a.banishes = 1;
  applyCommand(w, { t: "leave", player: a.id, dialog: first });
  assert.deepEqual([a.rerolls, a.skips, a.banishes], [1, 1, 1]);
  assert.equal(a.hp, max);
  assert.deepEqual(s.data.traded, []);
  assert.equal(a.pending[0].offer.kind, "trophy");
  assert.ok(a.pending[0].options.length);
  assert.equal(cancelRouteDeal(w, a), false);
  nextCard(w, a);
  for (let n = 1; n <= 2; n++) {
    assert.ok(interactSite(w, a));
    const card = a.pending[0];
    assert.equal(new Set(card.options.map((c) => c.item)).size, 3);
    assert.ok(card.options.every((c) => c.kind === "item" && items[c.item].rarity === 3));
    const options = structuredClone(card.options);
    const id = card.id;
    for (const command of [
      { t: "leave", dialog: first },
      { t: "choices", open: false },
      { t: "reroll", card: id },
      { t: "banish", card: id, index: 0 },
      { t: "skip", card: id },
    ])
      applyCommand(w, { ...command, player: a.id });
    assert.equal(a.pending[0], card);
    assert.equal(card.id, id);
    assert.equal(a.choosing, true);
    assert.deepEqual(card.options, options);
    assert.deepEqual([a.rerolls, a.skips, a.banishes], [1, 1, 1]);
    assert.deepEqual(a.banished, []);
    const stale = card.options[0];
    a.banished.push(`item:${stale.item}`);
    const hp = a.tradeHp;
    applyCommand(w, { t: "pick", card: id, player: a.id, index: 0 });
    assert.notEqual(card.id, id);
    applyCommand(w, { t: "leave", dialog: id, player: a.id });
    assert.equal(a.pending[0], card);
    assert.deepEqual(card.options.slice(0, 2), options.slice(1));
    assert.equal(new Set(card.options.map((c) => c.item)).size, 3);
    assert.ok(
      card.options.every(
        (c) => c.kind === "item" && items[c.item].rarity === 3 && c.item !== stale.item,
      ),
    );
    assert.equal(a.tradeHp, hp);
    assert.deepEqual(w.sites.find((s) => s.kind === "gengar-deal").data.traded, []);
    a.banished.pop();
    const c = card.options.find((c) => !items[c.item].onPick) ?? card.options[0];
    assert.ok(pickRouteReward(w, a, card, c));
    assert.equal(a.hp, Math.min(max, currentStats(a).maxHp));
    assert.ok(!pickRouteReward(w, a, card, c));
    applyChoice(a, c);
    pickEffects(w, a, c.item);
    nextCard(w, a);
    assert.equal(a.tradeHp, 0.85 ** n);
    assert.equal(
      statBreakdown(a).maxHp.sources.find((source) => source.kind === "deal").amount,
      a.tradeHp,
    );
    assert.equal(playerStats(a).maxHp, playerStats({ ...a, tradeHp: 1 }).maxHp * 0.85 ** n);
    assert.equal(siteHere(w, a), null);
    assert.equal(siteHere(w, b)?.kind, "gengar-deal");
    assert.equal(b.tradeHp, 1);
    if (n === 1) w.sites = [{ ...s, id: w.nextId++, data: { ...s.data, traded: [] } }];
  }
});

test("full inventory offers only legal owned upgrades; exhausted trophy becomes distinct training and altar stays free", () => {
  const w = run(["forest", "coast", "volcano", "tower"]),
    p = w.players[0];
  altar(w);
  const legendary = itemIds.find(
    (id) => items[id].rarity === 3 && items[id].max > 1 && !items[id].needs && !items[id].boosts,
  );
  p.items = [legendary, ...itemIds.filter((id) => !items[id].rarity).slice(0, 4)].map((id) => ({
    id,
    level: 1,
  }));
  assert.ok(interactSite(w, p));
  assert.deepEqual(p.pending[0].options, [{ kind: "item", item: legendary }]);
  applyCommand(w, { t: "leave", player: p.id, dialog: p.pending[0].id });
  queueCard(w, p, "chest", undefined, { kind: "trophy" });
  const card = p.pending[0],
    move = p.moves[0];
  assert.equal(card.options.length, 2);
  assert.deepEqual(new Set(card.options.map((c) => c.kind)), new Set(["item", "upgrade"]));
  move.level = levelCap(p, move.id);
  p.items[0].level = itemCap(p, legendary);
  const stale = card.id;
  applyCommand(w, { t: "pick", player: p.id, card: stale, index: 0 });
  assert.notEqual(card.id, stale);
  assert.ok(card.options.every((c) => c.kind === "train"));
  assert.equal(new Set(card.options.map((c) => c.stat)).size, 3);
  const stat = card.options[0].stat;
  const before = p.training[stat];
  applyCommand(w, { t: "pick", player: p.id, card: card.id, index: 0 });
  assert.equal(p.training[stat], before + 1);
  assert.equal(interactSite(w, p), false);
  assert.equal(p.tradeHp, 1);
  assert.equal(p.pending.length, 0);
});

for (const source of ["level", "trophy"]) {
  test(`a co-op item ball filling the last slot refreshes the open ${source} card once`, () => {
    const world = createWorld({
      mode: "expedition",
      rules: [],
      stage: "forest",
      unlocks: unlockIds,
      seed: 6,
      difficulty: 0,
      players: [
        { trainer: "chengxi", starter: "charmander" },
        { trainer: "chengxi", starter: "squirtle" },
      ],
    });
    const [player] = world.players;
    player.items = itemIds
      .filter((id) => !items[id].rarity)
      .slice(0, 4)
      .map((id) => ({ id, level: items[id].max }));
    if (source === "level") {
      world.rng = createRng(0);
      queueCard(world, player, "level");
    } else queueCard(world, player, "chest", undefined, { kind: "trophy" });
    applyCommand(world, { t: "choices", player: player.id, open: true });
    const card = player.pending[0];
    const upgrade = card.options.find((choice) => choice.kind === "upgrade");
    assert.ok(upgrade);
    const pick = {
      t: "pick",
      player: player.id,
      card: card.id,
      index: card.options.findIndex((choice) => choice.kind === "item"),
    };
    assert.ok(pick.index >= 0);
    const ball = world.sites.find((site) => site.kind === "item-ball" && !site.data.trap);
    Object.assign(player, { x: ball.x, z: ball.z });
    updateSites({ world, grid: new EnemyGrid() }, 1 / 30);
    assert.equal(player.items.length, 5);
    assert.ok(!player.items.some((item) => item.id === card.options[pick.index].item));
    const inventory = structuredClone(player.items);
    player.rerolls = player.skips = player.banishes = 1;
    applyCommand(world, pick);
    assert.notEqual(card.id, pick.card);
    assert.deepEqual(player.items, inventory);
    if (source === "trophy") assert.deepEqual(card.options, [upgrade]);
    else
      for (const option of card.options.filter((choice) => choice.kind === "item")) {
        assert.ok(
          inventory.some(
            (item) => item.id === option.item && item.level < itemCap(player, item.id),
          ),
        );
      }
    const state = world.rng.state;
    applyCommand(world, pick);
    assert.equal(world.rng.state, state);
    assert.deepEqual([player.rerolls, player.skips, player.banishes], [1, 1, 1]);
    assert.equal(player.pending.length, 1);
    applyCommand(world, { ...pick, card: card.id, index: 0 });
    assert.equal(player.items.length, 5);
    assert.equal(player.pending.length, 0);
  });
}

test("elite-nest doubles elite chests only; research increases ordinary dust frequency, not value", () => {
  const w = run(),
    ctx = { world: w, grid: new EnemyGrid() };
  w.marker = "elite-nest";
  w.modifier = "boss-sighting";
  assert.deepEqual(routeSpawnFactors(w), { eliteRate: 3.2, eliteHp: 1.15 });
  killEnemy(ctx, spawnEnemy(w, "rattata", 1, 1, true), null);
  assert.equal(w.pickups.filter((p) => p.kind === "chest").length, 2);
  const enemy = spawnEnemy(w, "rattata", 1, 1, false);
  function drops(marker) {
    const seeds = new Set();
    w.marker = marker;
    for (let seed = 0; seed < 250; seed++) {
      w.pickups = [];
      w.rng = createRng(seed);
      killEnemy(ctx, enemy, null);
      const dust = w.pickups.filter((p) => p.kind === "stardust");
      if (dust.length) {
        assert.deepEqual(
          dust.map((p) => p.value),
          [STARDUST.ordinary.value],
        );
        seeds.add(seed);
      }
    }
    return seeds;
  }
  const normal = drops(null),
    research = drops("research");
  assert.ok(normal.size > 0 && research.size > normal.size);
  assert.ok([...normal].every((s) => research.has(s)));
});
