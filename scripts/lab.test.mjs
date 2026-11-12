import assert from "node:assert/strict";
import test from "node:test";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { labBonuses, labItem, nextCost } from "../src/run/lab.ts";
import {
  buyLab,
  emptyProgress,
  loadProgress,
  PROGRESS_STORAGE_KEY,
  recordRun,
  saveProgress,
  setArchive,
  setBackpack,
  starterUnlocked,
} from "../src/run/progress.ts";
import { encodeSave, decodeSave } from "../src/run/save.ts";
import { webAppStorage } from "../src/platform/web/app-storage.ts";
import { saveSettings } from "../src/settings.ts";
import { moveParams } from "../src/run/sim/attacks.ts";
import { SIGNATURE_GATES } from "../src/run/sim/content/params/cards.ts";
import { killEnemy } from "../src/run/sim/combat.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { damagePlayer } from "../src/run/sim/hurt.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { createRng } from "../src/run/sim/rng.ts";
import { playerStats } from "../src/run/sim/stats.ts";
import { STARDUST } from "../src/run/sim/content/params/economy.ts";
import {
  applyChoice,
  banishKey,
  itemSlots,
  moveSlots,
  rollChoices,
} from "../src/run/sim/upgrades.ts";
import { createPlayer, createWorld, stepWorld } from "../src/run/sim/world.ts";
import { REVIVE } from "../src/run/sim/content/params/player.ts";

/** Map-backed stand-in for the browser's localStorage (Node has none without a file). */
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  },
});

const world = (lab) =>
  createWorld({
    stage: "forest",
    seed: 7,
    difficulty: 0,
    players: [{ starter: "charmander", lab }],
  });

test("lab bonuses change the stats they name, and area still saturates through areaGrowth", () => {
  const base = playerStats(createPlayer(0, "charmander", 0));
  const lab = labBonuses({ dmg: 2, hp: 3, armor: 1, regen: 2, crit: 3, atkspd: 5, area: 5 });
  const more = labBonuses({ spd: 4, xp: 2, gold: 3, magnet: 5 });
  const a = playerStats(createPlayer(0, "charmander", 0, lab));
  const b = playerStats(createPlayer(0, "charmander", 0, more));
  assert.ok(Math.abs(a.damage - base.damage - 0.08) < 1e-9);
  assert.equal(a.maxHp, base.maxHp + 24);
  assert.equal(a.armor, base.armor + 2);
  assert.ok(Math.abs(a.regen - base.regen - 0.4) < 1e-9);
  assert.ok(Math.abs(a.crit - base.crit - 0.03) < 1e-9);
  assert.ok(Math.abs(a.cooldown - base.cooldown / 1.1) < 1e-9);
  assert.ok(Math.abs(b.speed - base.speed * 1.1) < 1e-9);
  assert.ok(Math.abs(b.xp - base.xp - 0.1) < 1e-9);
  assert.ok(Math.abs(b.stardust - 1.24) < 1e-9);
  assert.ok(Math.abs(b.pickup - base.pickup - 3) < 1e-9);
  // A run starts at the raised max HP.
  assert.equal(createPlayer(0, "charmander", 0, lab).hp, a.maxHp);

  const move = createPlayer(0, "charmander", 0).moves[0];
  const plain = moveParams(move, base).area;
  const grown = moveParams(move, a).area;
  assert.ok(grown > plain && grown < plain * 1.15, `area ${plain} → ${grown}`);
});

test("level-ups offer four cards with 第四个选项; chests keep three", () => {
  const w = world(labBonuses({ choice4: 1 }));
  const player = w.players[0];
  assert.equal(rollChoices(w.rng, player, "level").length, 4);
  assert.equal(rollChoices(w.rng, player, "chest").length, 3);
  assert.equal(rollChoices(w.rng, world().players[0], "level").length, 3);
});

for (const { lab, moves, items } of [
  { lab: undefined, moves: 3, items: 5 },
  { lab: labBonuses({ "slot-move": 1, "slot-vit": 4 }), moves: 4, items: 9 },
]) {
  test(`real choices fill ${moves} move slots and ${items} item slots, allow owned upgrades and keep capacity`, () => {
    const w = world(lab);
    const player = w.players[0];
    // Past every signature gate (params/cards.ts SIGNATURE_GATES), so moves can fill every slot.
    player.level = SIGNATURE_GATES.at(-1);
    assert.equal(moveSlots(player), moves);
    assert.equal(itemSlots(player), items);
    const rng = createRng(11);
    for (let i = 0; i < 300 && (player.moves.length < moves || player.items.length < items); i++) {
      const options = rollChoices(rng, player, "level");
      // Prefer anything that fills a new slot, so the limit is actually pushed.
      const pick =
        options.find(
          (c) =>
            c.kind === "move" ||
            (c.kind === "item" && !player.items.some((owned) => owned.id === c.item)),
        ) ?? options[0];
      applyChoice(player, pick);
    }
    assert.equal(player.moves.length, moves);
    assert.equal(player.items.length, items);
    const owned = player.items.map((item) => item.id);
    let upgraded = false;
    for (let i = 0; i < 100; i++) {
      const options = rollChoices(rng, player, "level");
      for (const choice of options)
        if (choice.kind === "item")
          assert.ok(owned.includes(choice.item), "a full bar only offers owned items");
      const pick = options.find((choice) => choice.kind === "item") ?? options[0];
      const before =
        pick.kind === "item" && player.items.find((item) => item.id === pick.item).level;
      applyChoice(player, pick);
      if (pick.kind === "item") {
        upgraded = true;
        assert.equal(player.items.find((item) => item.id === pick.item).level, before + 1);
      }
      assert.deepEqual(
        player.items.map((item) => item.id),
        owned,
        "choices cannot overfill the bar",
      );
    }
    assert.ok(upgraded, "owned items can still upgrade at capacity");
  });
}

test("each vitamin-slot purchase adds one usable slot and the fourth purchase is final", () => {
  store.clear();
  let progress = { ...emptyProgress(), stardust: 1e6 };
  for (let level = 1; level <= 4; level++) {
    const before = progress.stardust;
    const cost = nextCost(labItem("slot-vit"), level - 1);
    progress = buyLab(progress, "slot-vit");
    assert.equal(progress.stardust, before - cost);
    assert.equal(progress.lab["slot-vit"], level);
    const player = createPlayer(0, "charmander", 0, labBonuses(progress.lab));
    assert.equal(itemSlots(player), 5 + level, "each bought level reaches the next run");
  }
  saveProgress(progress);
  assert.deepEqual(loadProgress().progress, progress);
  const maxed = structuredClone(progress);
  assert.throws(() => buyLab(progress, "slot-vit"), /满级/);
  assert.deepEqual(
    progress,
    maxed,
    "buying past level four cannot spend currency or change research",
  );
});

test("a banished option never appears again that run", () => {
  const w = world(labBonuses({ banish: 2 }));
  const player = w.players[0];
  const card = () => player.pending[0];
  player.pending.push({ id: 900, source: "level", options: rollChoices(w.rng, player, "level") });
  const index = card().options.findIndex((c) => banishKey(c) !== null);
  const key = banishKey(card().options[index]);
  stepWorld(w, [{ t: "banish", player: 0, card: 900, index }]);
  assert.equal(player.banishes, 1);
  assert.deepEqual(player.banished, [key]);
  const rng = createRng(3);
  for (let i = 0; i < 400; i++) {
    for (const source of ["level", "chest"]) {
      for (const choice of rollChoices(rng, player, source))
        assert.notEqual(banishKey(choice), key);
    }
  }
  // The card being answered is rolled again without the banished option.
  for (const choice of card().options) assert.notEqual(banishKey(choice), key);
});

test("skip dismisses the card; no skips left does nothing", () => {
  const w = world(labBonuses({ skip: 1 }));
  w.paused = true; // only the command applies this step
  const player = w.players[0];
  player.pending.push({ id: 901, source: "level", options: rollChoices(w.rng, player, "level") });
  stepWorld(w, [{ t: "skip", player: 0, card: 901 }]);
  assert.equal(player.pending.length, 0);
  assert.equal(player.skips, 0);
  assert.equal(player.stardust, 0);
  player.pending.push({ id: 902, source: "level", options: rollChoices(w.rng, player, "level") });
  stepWorld(w, [{ t: "skip", player: 0, card: 902 }]);
  assert.equal(player.pending.length, 1);
});

const stardustDrops = (w) => w.pickups.filter((pickup) => pickup.kind === "stardust");

/** Kills one enemy with the world's RNG at `state`; returns the stardust pickups that kill dropped. */
function killAt(w, state, species, elite = false) {
  w.pickups = [];
  const enemy = spawnEnemy(w, species, 5, 5, elite);
  w.rng.state = state;
  killEnemy({ world: w, grid: new EnemyGrid() }, enemy, w.players[0]);
  return stardustDrops(w).map((pickup) => pickup.value);
}

test("an ordinary kill's stardust is decided by the seeded roll: one pickup worth 5, or none", () => {
  const w = world();
  const seen = { drop: 0, none: 0 };
  for (let state = 0; state < 200; state++) {
    const drops = killAt(w, state, "caterpie");
    // The same RNG state always decides the same way.
    assert.deepEqual(killAt(w, state, "caterpie"), drops);
    if (drops.length === 0) seen.none += 1;
    else {
      assert.deepEqual(drops, [STARDUST.ordinary.value]);
      seen.drop += 1;
    }
  }
  // A low chance: dropping must be the rare branch.
  assert.ok(seen.drop > 0 && seen.drop < seen.none, JSON.stringify(seen));
  assert.equal(w.players[0].stardust, 0);
});

test("an elite always drops one pickup worth 20; the guardian credits 100 and drops none", () => {
  const w = world();
  const player = w.players[0];
  for (let state = 0; state < 50; state++) {
    assert.deepEqual(killAt(w, state, "caterpie", true), [STARDUST.elite]);
    const before = player.stardust;
    assert.deepEqual(killAt(w, state, "scyther"), []);
    // A guardian that is also flagged elite still gives its 100 only.
    assert.deepEqual(killAt(w, state, "scyther", true), []);
    assert.equal(player.stardust - before, 2 * STARDUST.guardian);
  }
});

test("a stardust pickup is credited once, scaled by stardust gain", () => {
  const w = world(labBonuses({ gold: 2 }));
  const player = w.players[0];
  w.pickups.push({
    id: 9001,
    kind: "stardust",
    value: 20,
    x: player.x,
    z: player.z,
    magnet: false,
  });
  stepWorld(w, []);
  assert.equal(stardustDrops(w).length, 0);
  assert.ok(Math.abs(player.stardust - 20 * 1.16) < 1e-9);
  stepWorld(w, []);
  assert.ok(Math.abs(player.stardust - 20 * 1.16) < 1e-9);
});

test("the last guardian reward and remaining ground stardust are carried out exactly once", () => {
  const w = createWorld({
    stage: "tower",
    seed: 7,
    difficulty: 0,
    players: [{ starter: "charmander" }],
  });
  const player = w.players[0];
  w.pickups.push({ id: 9002, kind: "stardust", value: 5, x: 40, z: 40, magnet: false });
  w.enemies = [];
  const guardian = stageDefs.tower.zones[0].guardian.species;
  killEnemy({ world: w, grid: new EnemyGrid() }, spawnEnemy(w, guardian, 5, 5), player);
  stepWorld(w, []);
  assert.equal(w.zone.phase, "cleared");
  assert.equal(w.outcome, "playing");
  assert.equal(player.stardust, STARDUST.guardian);
  // The landmark is the exit: leaving the last zone wins the run.
  const exit = w.map.pads.find((pad) => pad.tag === "landmark");
  player.x = exit.x;
  player.z = exit.z;
  stepWorld(w, [{ t: "interact", player: 0 }]);
  assert.equal(w.outcome, "victory");
  // The ended world no longer moves, so what the run carries out is fixed.
  for (let i = 0; i < 30; i++) stepWorld(w, []);
  assert.equal(player.stardust, STARDUST.guardian + 5);
});

test("giving up ends the run once with what was earned; the world stays frozen after", () => {
  const w = world();
  const player = w.players[0];
  player.stardust = 37;
  stepWorld(w, [{ t: "forfeit" }]);
  assert.equal(w.outcome, "defeat");
  const time = w.time;
  for (let i = 0; i < 30; i++) stepWorld(w, [{ t: "forfeit" }]);
  assert.equal(w.time, time);
  assert.equal(player.stardust, 37);
});

test("活力碎片 revives once at a share of max HP with invulnerability", () => {
  const w = world(labBonuses({ revive: 1 }));
  const player = w.players[0];
  player.invulnerable = 0;
  damagePlayer(w, player, 1e6);
  stepWorld(w, []);
  assert.equal(player.alive, true);
  assert.equal(w.outcome, "playing");
  assert.ok(Math.abs(player.hp - playerStats(player).maxHp * REVIVE.hp) < 1e-9);
  assert.ok(player.invulnerable > 2);
  assert.ok(w.events.some((event) => event.t === "revive"));
  player.invulnerable = 0;
  damagePlayer(w, player, 1e6);
  stepWorld(w, []);
  assert.equal(player.alive, false);
  assert.equal(w.outcome, "defeat");
});

const result = (kills, stardust, items = []) => ({
  outcome: "defeat",
  starter: "charmander",
  difficulty: 0,
  time: 300,
  level: 10,
  kills,
  stardust,
  moves: [],
  items,
});

test("archived items never roll on level-up or chest cards, owned or not", () => {
  store.clear();
  const archive = ["life-orb", "hp-up", "magnet", "lucky-egg", "wide-lens", "rocky-helmet"];
  const progress = setArchive({ ...emptyProgress(), lab: { archive: 6 } }, archive);
  assert.throws(() => setArchive(progress, [...archive, "leftovers"]), /已满/);
  const w = createWorld({
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [{ starter: "charmander", archive: progress.archive, backpack: ["life-orb"] }],
  });
  const player = w.players[0];
  player.level = 12;
  const rng = createRng(9);
  for (let i = 0; i < 400; i++) {
    for (const source of ["level", "chest"]) {
      const options = rollChoices(rng, player, source);
      for (const choice of options)
        assert.ok(choice.kind !== "item" || !archive.includes(choice.item), choice.item);
      if (source === "level") applyChoice(player, options[0]);
    }
  }
  // The carried Life Orb stays at level 1: archived means never offered, upgrades included.
  assert.deepEqual(
    player.items.find((item) => item.id === "life-orb"),
    { id: "life-orb", level: 1 },
  );
});

test("研究 speeds unlock progress: Pikachu joins after 2,500 / 1.5 kills at level 2", () => {
  store.clear();
  const researched = { ...emptyProgress(), lab: { research: 2 } };
  const once = recordRun(researched, result(1667, 0));
  assert.equal(once.research, 2500);
  assert.equal(once.kills, 1667);
  assert.equal(starterUnlocked(once, "pikachu"), true);
  assert.equal(starterUnlocked(recordRun(emptyProgress(), result(1667, 0)), "pikachu"), false);
});

test("the backpack saves up to its slots and the next run starts with its items at level 1", () => {
  store.clear();
  let progress = recordRun(emptyProgress(), result(400, 50, ["hp-up", "quick-claw", "magnet"]));
  assert.throws(() => setBackpack(progress, ["hp-up", "quick-claw", "magnet"]), /已满/);
  progress = setBackpack(progress, ["hp-up", "quick-claw"]);
  saveProgress(progress);
  assert.deepEqual(loadProgress().progress.backpack, ["hp-up", "quick-claw"]);
  // 大背包 makes room for a third.
  assert.equal(
    setBackpack({ ...progress, lab: { bag: 1 } }, ["hp-up", "quick-claw", "magnet"]).backpack
      .length,
    3,
  );
  const carried = progress.backpack;
  const w = createWorld({
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [{ starter: "charmander", backpack: carried }],
  });
  const player = w.players[0];
  assert.deepEqual(player.items, [
    { id: "hp-up", level: 1 },
    { id: "quick-claw", level: 1 },
  ]);
  // Carried HP Up arrives filled.
  assert.equal(player.hp, playerStats(player).maxHp);
  assert.equal(player.hp, playerStats(createPlayer(0, "charmander", 0)).maxHp + 15);
});

test("a carried Loaded Dice rolls this run's first level, fills HP, and keeps that roll on upgrade", () => {
  const pickDice = (w) => {
    w.paused = true;
    for (const player of w.players) {
      const card = w.nextId++;
      player.pending.push({
        id: card,
        source: "level",
        options: [{ kind: "item", item: "loaded-dice" }],
      });
      stepWorld(w, [{ t: "pick", player: player.id, card, index: 0 }]);
    }
  };
  const previous = world();
  pickDice(previous);
  store.clear();
  const progress = setBackpack(recordRun(emptyProgress(), result(1, 0, ["loaded-dice"])), [
    "loaded-dice",
  ]);
  saveProgress(progress);
  const config = {
    stage: "forest",
    seed: 8,
    difficulty: 0,
    players: [{ starter: "charmander" }, { starter: "squirtle" }],
  };
  const carried = createWorld({
    ...config,
    players: config.players.map((player) => ({
      ...player,
      backpack: loadProgress().progress.backpack,
    })),
  });
  const picked = createWorld(config);
  pickDice(picked);
  for (const [index, player] of carried.players.entries()) {
    assert.deepEqual(player.items, [{ id: "loaded-dice", level: 1 }]);
    assert.deepEqual(player.fx, picked.players[index].fx, "same run RNG and player order");
    assert.deepEqual(playerStats(player), playerStats(picked.players[index]));
    assert.equal(player.hp, playerStats(player).maxHp);
    assert.equal(player.level, 1);
    assert.equal(player.pending.length, 0);
  }
  assert.equal(carried.rng.state, picked.rng.state);
  assert.notEqual(carried.players[0].fx["dice:1"], previous.players[0].fx["dice:1"]);
  assert.ok(
    carried.players[0].hp > playerStats(createPlayer(0, "charmander", 0)).maxHp,
    "this seed rolls max HP, which must arrive filled",
  );
  const firstRolls = carried.players.map((player) => player.fx["dice:1"]);
  pickDice(carried);
  pickDice(picked);
  for (const [index, player] of carried.players.entries()) {
    assert.equal(player.items[0].level, 2);
    assert.equal(player.fx["dice:1"], firstRolls[index], "upgrading cannot replace level one");
    assert.ok(Number.isInteger(player.fx["dice:2"]));
    assert.deepEqual(playerStats(player), playerStats(picked.players[index]));
  }
  assert.equal(carried.rng.state, picked.rng.state);
});

test("carried Rare Candy does not replay its card's immediate level grants", () => {
  const w = createWorld({
    stage: "forest",
    seed: 7,
    difficulty: 0,
    players: [{ starter: "charmander", backpack: ["rare-candy", "loaded-dice"] }],
  });
  assert.equal(w.players[0].level, 1);
  assert.equal(w.players[0].pending.length, 0);
  assert.ok(Number.isInteger(w.players[0].fx["dice:1"]));
});

test("recordRun banks a run's stardust, win or lose, with lifetime kills; crossing 2,500 kills unlocks Pikachu", () => {
  store.clear();
  let progress = recordRun(emptyProgress(), result(1300, 210));
  assert.equal(progress.stardust, 210);
  assert.equal(starterUnlocked(progress, "pikachu"), false);
  assert.equal(starterUnlocked(progress, "charmander"), true);
  progress = recordRun(progress, { ...result(1200, 150), outcome: "victory" });
  saveProgress(progress);
  assert.equal(progress.stardust, 360);
  assert.equal(progress.kills, 2500);
  assert.equal(starterUnlocked(progress, "pikachu"), true);
  assert.deepEqual(loadProgress(), { status: "ready", progress });
});

test("buying a lab level deducts its cost and persists; unaffordable or maxed throws", () => {
  store.clear();
  const start = { ...emptyProgress(), stardust: 250 };
  const bought = buyLab(start, "dmg");
  saveProgress(bought);
  assert.equal(bought.stardust, 250 - nextCost(labItem("dmg"), 0));
  assert.equal(bought.lab.dmg, 1);
  assert.deepEqual(loadProgress().progress, bought);
  assert.throws(() => buyLab(bought, "revive"), /不足/);
  assert.throws(() => buyLab({ ...bought, stardust: 1e6, lab: { revive: 1 } }, "revive"), /满级/);
  assert.deepEqual(loadProgress().progress, bought);
});

test("export → wipe → import restores the save exactly", () => {
  store.clear();
  const progress = {
    ...emptyProgress(),
    runs: 4,
    kills: 1830,
    research: 2287,
    stardust: 512,
    lab: { dmg: 2, skip: 1, research: 1, archive: 2, bag: 1 },
    archive: ["magnet", "lucky-egg"],
    backpack: ["life-orb", "hp-up", "scope-lens"],
  };
  progress.best.squirtle = { difficulty: 1, victory: true, time: 540.5, kills: 1400 };
  store.set(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  saveSettings({ sound: false, devMode: true, uiScale: 1.2 });
  const before = new Map(store);
  const current = webAppStorage.load();
  const text = encodeSave({ progress: current.progress.progress, settings: current.settings });
  store.clear();
  const imported = decodeSave(text);
  webAppStorage.save(imported);
  assert.deepEqual(store, before);
  assert.deepEqual(imported.progress, progress);
});

test("a corrupted or foreign import is rejected and leaves the save unchanged", () => {
  store.clear();
  store.set(PROGRESS_STORAGE_KEY, JSON.stringify({ ...emptyProgress(), stardust: 99 }));
  const current = webAppStorage.load();
  const text = encodeSave({ progress: current.progress.progress, settings: current.settings });
  store.set(PROGRESS_STORAGE_KEY, JSON.stringify({ ...emptyProgress(), stardust: 7 }));
  const before = new Map(store);
  const raw = atob(text);
  const flipped = btoa(raw.replace('"stardust":99', '"stardust":98'));
  for (const bad of [flipped, text.slice(0, -8), "hello", btoa("1" + raw.slice(1))]) {
    assert.throws(() => webAppStorage.save(decodeSave(bad)));
    assert.deepEqual(store, before);
  }
});
