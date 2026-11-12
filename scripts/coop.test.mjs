import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorld,
  createWorldFromSeeds,
  stepWorld,
  isFrozen,
  cardShown,
} from "../src/run/sim/world.ts";
import { COOP, coopScaling } from "../src/run/sim/content/params/coop.ts";
import { spawnEnemy, updateDirector } from "../src/run/sim/director.ts";
import { playerStats, xpForLevel } from "../src/run/sim/stats.ts";
import { damagePlayer } from "../src/run/sim/hurt.ts";
import { snapshotWorld, restoreWorld } from "../src/run/sim/snapshot.ts";
import { signatureFusions } from "../src/run/sim/content/fusions.ts";
import { MAX_MOVE_LEVEL } from "../src/run/sim/content/params/cards.ts";
import { newMoveState } from "../src/run/sim/upgrades.ts";
import { stationOpen } from "../src/run/sim/stations.ts";
import { prepareZone, enterZone } from "../src/run/sim/zones.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { applyMovementCommand, movePlayer } from "../src/run/sim/player-movement.ts";
import { coopBudget } from "../src/run/balance/coop.ts";
import { average } from "../src/run/balance/skill.ts";
import { expectedMods } from "../src/run/balance/budget.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { STAGE_ROUTE } from "../src/run/sim/content/campaign.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { killEnemy } from "../src/run/sim/combat.ts";

function world(count = 2, difficulty = 0, stage = "forest") {
  return createWorld({
    stage,
    seed: 5,
    difficulty,
    players: Array.from({ length: count }, () => ({ starter: "charmander" })),
  });
}
function loot(w, kind, value) {
  const p = w.players[0];
  w.pickups.push({ id: w.nextId++, kind, value, x: p.x, z: p.z, magnet: true });
  stepWorld(w, []);
}
function advance(w, ticks) {
  for (let i = 0; i < ticks; i++) {
    stepWorld(w, []);
    w.events.length = 0;
  }
}

test("co-op queues two levels, opens only on request, and keeps running through selection and defer", () => {
  const w = world();
  const [a, b] = w.players;
  loot(w, "xp", (xpForLevel(1) + xpForLevel(2) + 1) / coopScaling(w.players.length).xp);
  assert.equal(a.pending.length, 2);
  assert.equal(b.pending.length, 2);
  assert.equal(cardShown(a), false);
  assert.equal(isFrozen(w), false);
  stepWorld(w, [{ t: "interact", player: a.id }]);
  assert.equal(cardShown(a), true);
  assert.equal(cardShown(b), false);
  const tick = w.tick;
  const first = a.pending[0];
  const second = a.pending[1].id;
  stepWorld(w, [{ t: "pick", player: a.id, card: first.id, index: 0 }]);
  assert.equal(w.tick, tick + 1);
  assert.equal(a.pending.length, 1);
  assert.equal(a.pending[0].id, second);
  stepWorld(w, [{ t: "choices", player: a.id, open: false }]);
  assert.equal(cardShown(a), false);
  assert.equal(a.pending.length, 1);
  const restored = restoreWorld(w.map, JSON.parse(JSON.stringify(snapshotWorld(w))));
  assert.equal(restored.players[0].pending[0].id, second);
  stepWorld(restored, [{ t: "choices", player: 0, open: true }]);
  assert.equal(cardShown(restored.players[0]), true);
  stepWorld(restored, [{ t: "pick", player: 0, card: first.id, index: 0 }]);
  assert.equal(
    restored.players[0].pending.length,
    1,
    "late repeated pick must not spend another opportunity",
  );
});

test("solo still automatically opens its level card and freezes", () => {
  const w = world(1);
  loot(w, "xp", w.players[0].xpNext);
  assert.equal(cardShown(w.players[0]), true);
  assert.equal(isFrozen(w), true);
  const tick = w.tick;
  stepWorld(w, []);
  assert.equal(w.tick, tick);
});

test("shared XP/chests/stardust use personal gains, downed rewards wait, berries heal collector only", () => {
  const w = world();
  const [a, b] = w.players;
  b.lab = {
    modifiers: [
      { stat: "xp", op: "mul", value: 2 },
      { stat: "stardust", op: "mul", value: 2 },
    ],
    rules: {},
  };
  a.hp -= 20;
  b.hp -= 20;
  const hp = b.hp;
  loot(w, "berry", 10);
  assert.equal(b.hp, hp);
  assert.ok(a.hp > playerStats(a).maxHp - 20);
  b.alive = false;
  b.hp = 0;
  loot(w, "xp", 4);
  assert.equal(a.xp, 3);
  assert.equal(b.xp, 6);
  loot(w, "stardust", 10);
  assert.equal(a.stardust, 10);
  assert.equal(b.stardust, 20);
  loot(w, "chest", 1);
  assert.equal(a.pending.length, 1);
  assert.equal(b.pending.length, 1);
  assert.equal(cardShown(b), false);
  assert.equal(isFrozen(w), false);
  stepWorld(w, [{ t: "choices", player: 1, open: true }]);
  assert.equal(cardShown(b), false);
});

test("each player can fuse once, and per-player use survives a zone and snapshot", () => {
  const w = world(4);
  const bill = w.stations.find((s) => s.kind === "bill");
  const pair = signatureFusions.charmander.match.pair;
  for (const p of w.players) {
    p.moves = pair.map((id) => ({ ...newMoveState(id), level: MAX_MOVE_LEVEL }));
    p.dialog = { id: w.nextId++, station: bill.id };
    stepWorld(w, [{ t: "fuse", player: p.id, dialog: p.dialog.id }]);
    assert.equal(stationOpen(bill, p), false);
    if (p.id === 0) assert.equal(stationOpen(bill, w.players[1]), true);
  }
  assert.deepEqual(bill.used, [0, 1, 2, 3]);
  w.zone.phase = "transitioning";
  enterZone(w, prepareZone(w));
  const restored = restoreWorld(w.map, snapshotWorld(w));
  assert.deepEqual(restored.stations.find((s) => s.kind === "bill").used, [0, 1, 2, 3]);
});

test("co-op scales swarm and guardian HP, spawn budget without scaling damage or speed; downing keeps scaling", () => {
  const solo = world(1),
    coop = world();
  for (const [species, factor] of [
    ["rattata", 1.15],
    ["scyther", 1.75],
  ]) {
    const a = spawnEnemy(solo, species, 0, 10),
      b = spawnEnemy(coop, species, 0, 10);
    assert.ok(Math.abs(b.hp / a.hp - factor) < 1e-9);
    assert.equal(a.dmg, b.dmg);
    assert.equal(a.speed, b.speed);
  }
  coop.players[1].alive = false;
  assert.ok(
    Math.abs(spawnEnemy(coop, "rattata", 0, 10).hp / spawnEnemy(solo, "rattata", 0, 10).hp - 1.15) <
      1e-9,
  );
  solo.enemies = [];
  coop.enemies = [];
  updateDirector(solo, 0.01);
  updateDirector(coop, 0.01);
  assert.ok(Math.abs(coop.spawn.credit / solo.spawn.credit - 1.35) < 1e-9);
});

test("rescue channels suppress casts, survive restore, cancel on movement, ignore damage, then revive at 30 percent", () => {
  let w = world();
  let [a, b] = w.players;
  b.alive = false;
  b.hp = 0;
  stepWorld(w, [{ t: "interact", player: 0 }]);
  assert.equal(a.rescue.target, 1);
  const cooldown = a.moves[0].cooldown;
  advance(w, 10);
  assert.equal(a.moves[0].cooldown, cooldown);
  applyMovementCommand(a, { t: "move", player: 0, x: 1, z: 0 }, false);
  assert.equal(a.rescue, null);
  applyMovementCommand(a, { t: "move", player: 0, x: 0, z: 0 }, false);
  stepWorld(w, [{ t: "interact", player: 0 }]);
  a.invulnerable = 0;
  damagePlayer(w, a, 1);
  assert.equal(a.rescue.target, 1, "a hit does not interrupt the rescue");
  advance(w, 30);
  w = restoreWorld(w.map, JSON.parse(JSON.stringify(snapshotWorld(w))));
  [a, b] = w.players;
  advance(w, Math.ceil(COOP.rescueSeconds / TICK));
  assert.equal(b.alive, true);
  assert.equal(b.hp, playerStats(b).maxHp * COOP.reviveHp);
  assert.equal(a.rescue, null);
});

test("a rescuer knocked out mid-channel ends the rescue and the team hears of the fall once", () => {
  const w = world();
  const [a, b] = w.players;
  b.alive = false;
  b.hp = 0;
  stepWorld(w, [{ t: "interact", player: 0 }]);
  assert.equal(a.rescue.target, 1);
  w.events = [];
  a.invulnerable = 0;
  damagePlayer(w, a, 1e9);
  assert.equal(a.rescue, null, "falling ends the channel immediately");
  assert.deepEqual(
    w.events.filter((e) => e.t === "down"),
    [{ t: "down", player: 0 }],
  );
  advance(w, 1);
  assert.equal(a.alive, false);
  assert.equal(a.rescue, null);
});

test("personal revives precede rescue, zone clear restores downed members with queued cards, total knockout loses", () => {
  const w = world();
  const [a, b] = w.players;
  b.revives = 1;
  b.invulnerable = 0;
  damagePlayer(w, b, 1e9);
  assert.equal(b.alive, false);
  assert(!w.events.some((event) => event.t === "down"), "personal revival needs no rescue alarm");
  stepWorld(w, []);
  assert.equal(b.alive, true);
  assert.equal(b.revives, 0);
  assert.equal(b.hp, playerStats(b).maxHp * 0.6);
  b.alive = false;
  b.hp = 0;
  loot(w, "chest", 1);
  w.zone.phase = "cleared";
  stepWorld(w, []);
  assert.equal(b.alive, true);
  assert.equal(b.pending.length, 1);
  assert.equal(cardShown(b), false);
  a.alive = b.alive = false;
  stepWorld(w, []);
  assert.equal(w.outcome, "defeat");
});

test("downed and rescuing movement restrictions are shared with guest prediction", () => {
  const w = world(),
    p = w.players[0];
  const x = p.x;
  p.rescue = { target: 1, elapsed: 1 };
  p.vx = 8;
  movePlayer(w, p, 8, TICK);
  assert.equal(p.x, x);
  p.alive = false;
  p.rescue = null;
  applyMovementCommand(p, { t: "dash", player: 0 }, false);
  movePlayer(w, p, 8, TICK);
  assert.equal(p.x, x);
  assert.equal(p.dashTime, 0);
});

test("four seats are accepted, a fifth fails before map generation", () => {
  assert.equal(world(4).players.length, 4);
  assert.throws(() => world(5), /最多支持四名玩家/);
  assert.throws(() => world(0), /至少需要一名玩家/);
});

test("co-op budgets match actual enemy scaling across difficulties and maps without duplicating XP", () => {
  for (const difficulty of [0, 1, 2]) {
    for (const stage of STAGE_ROUTE) {
      const solo = world(1, difficulty, stage);
      for (const p of solo.players) {
        p.level = 16;
        p.moves = ["ember", "fire-spin"].map((id) => ({
          ...newMoveState(id),
          level: 5,
          mods: expectedMods(id, 4),
        }));
      }
      solo.zone.tick = 300 / TICK;
      const baseline = coopBudget(stage, difficulty, 300, solo.players, average);
      let previousHp = baseline.hp;
      let previousTtk = baseline.guardianTtk;
      for (const count of [2, 3, 4]) {
        const w = world(count, difficulty, stage);
        w.zone.tick = solo.zone.tick;
        const roster = Array.from({ length: count }, () => solo.players[0]);
        const budget = coopBudget(stage, difficulty, 300, roster, average);
        assert.ok(budget.hp > previousHp);
        assert.ok(budget.guardianTtk < previousTtk, "extra teammate retains a focus-fire benefit");
        assert.ok(
          budget.xpSupply < baseline.xpSupply * count,
          "sharing does not multiply XP by seats",
        );
        const ordinary = spawnEnemy(w, "rattata", 0, 10);
        const elite = spawnEnemy(w, "rattata", 0, 10, true);
        const species = stageDefs[stage].zones[0].guardian.species;
        const guardian = spawnEnemy(w, species, 0, 10);
        const soloEnemy = spawnEnemy(solo, "rattata", 0, 10);
        const soloElite = spawnEnemy(solo, "rattata", 0, 10, true);
        assert.ok(Math.abs(ordinary.hp / soloEnemy.hp - budget.hp / baseline.hp) < 1e-9);
        assert.ok(Math.abs(elite.hp / soloElite.hp - ordinary.hp / soloEnemy.hp) < 1e-9);
        assert.equal(guardian.hp, budget.guardianHp);
        assert.equal(ordinary.dmg, soloEnemy.dmg);
        assert.equal(ordinary.speed, soloEnemy.speed);
        const fixedHp = guardian.maxHp;
        w.enemies = [guardian];
        w.bossId = guardian.id;
        updateDirector(w, 0.01);
        const credit = w.spawn.credit;
        const nextTick = w.zone.tick;
        for (const p of w.players.slice(0, -1)) p.alive = false;
        w.spawn.credit = 0;
        w.zone.tick = nextTick - 1;
        updateDirector(w, 0.01);
        assert.equal(
          w.spawn.credit,
          credit,
          "downed seats do not reduce the authored guardian budget",
        );
        w.zone.tick = solo.zone.tick;
        assert.equal(spawnEnemy(w, species, 0, 10).maxHp, fixedHp);
        previousHp = budget.hp;
        previousTtk = budget.guardianTtk;
      }
    }
  }
});

test("director fills a larger four-player field and rotates through every living seat", () => {
  const counts = [];
  for (const count of [1, 2, 3, 4]) {
    const w = world(count);
    const anchors = new Set();
    for (let i = 0; i < 4; i++) {
      w.spawn.credit = 1;
      updateDirector(w, 0);
      anchors.add(w.spawn.anchor);
    }
    assert.equal(anchors.size, count);
    while (true) {
      const before = w.enemies.length;
      w.spawn.credit = 8;
      updateDirector(w, 0);
      if (w.enemies.length === before) break;
    }
    counts.push(w.enemies.length);
    const frozen = w.enemies.length;
    w.players.slice(0, -1).forEach((p) => {
      p.alive = false;
    });
    w.enemies.splice(-4);
    w.spawn.credit = 8;
    updateDirector(w, 0);
    assert.equal(w.enemies.length, frozen);
    assert.equal(w.spawn.anchor, count - 1, "spawns skip downed anchors without losing P4");
  }
  assert.ok(counts.every((count, index) => index === 0 || count > counts[index - 1]));
});

test("four players share rewards once including downed seats; P4 chooses independently", () => {
  const w = world(4);
  const collector = w.players[0];
  for (const p of w.players) {
    p.hp -= 20;
    p.lab = {
      modifiers: [{ stat: "xp", op: "mul", value: p.id + 1 }],
      rules: {},
    };
  }
  const downed = w.players[2];
  downed.alive = false;
  downed.hp = 0;
  loot(w, "xp", 4);
  assert.deepEqual(
    w.players.map((p) => p.xp),
    [2, 4, 6, 8],
  );
  loot(w, "stardust", 10);
  assert.deepEqual(
    w.players.map((p) => p.stardust),
    [10, 10, 10, 10],
  );
  const before = w.players.map((p) => p.hp);
  loot(w, "berry", 10);
  assert.ok(collector.hp > before[0]);
  assert.deepEqual(
    w.players.slice(1).map((p) => p.hp),
    before.slice(1),
  );
  loot(w, "chest", 1);
  assert.deepEqual(
    w.players.map((p) => p.pending.length),
    [1, 1, 1, 1],
  );
  const fourth = w.players[3];
  stepWorld(w, [{ t: "choices", player: fourth.id, open: true }]);
  assert.equal(cardShown(fourth), true);
  assert.equal(isFrozen(w), false);
  stepWorld(w, [{ t: "pick", player: fourth.id, card: fourth.pending[0].id, index: 0 }]);
  assert.deepEqual(
    w.players.map((p) => p.pending.length),
    [1, 1, 1, 0],
  );
  const guardian = spawnEnemy(w, "scyther", 0, 10);
  killEnemy({ world: w, grid: new EnemyGrid() }, guardian, fourth);
  assert.deepEqual(
    w.players.map((p) => p.stardust),
    [110, 110, 110, 110],
  );
  assert.deepEqual(
    w.players.map((p) => p.kills),
    [0, 0, 0, 1],
  );
  const queued = w.players.map((p) => p.pending.map((card) => card.id));
  stepWorld(w, []);
  assert.ok(
    w.players.every((p) => p.alive),
    "guardian clear brings back all downed seats",
  );
  assert.equal(downed.hp, playerStats(downed).maxHp * 0.3);
  w.zone.phase = "transitioning";
  enterZone(w, prepareZone(w));
  assert.deepEqual(
    w.players.map((p) => p.pending.map((card) => card.id)),
    queued,
  );
});

test("P4 rescues the nearest of three downed teammates and the team loses only on total knockout", () => {
  let w = world(4);
  for (const p of w.players.slice(0, 3)) {
    p.alive = false;
    p.hp = 0;
  }
  const fourth = w.players[3];
  fourth.x = w.players[2].x;
  stepWorld(w, [{ t: "interact", player: fourth.id }]);
  assert.equal(fourth.rescue.target, 2);
  assert.equal(w.outcome, "playing");
  w = restoreWorld(w.map, JSON.parse(JSON.stringify(snapshotWorld(w))));
  advance(w, Math.ceil(COOP.rescueSeconds / TICK));
  assert.deepEqual(
    w.players.map((p) => p.alive),
    [false, false, true, true],
  );
  assert.equal(w.players[2].hp, playerStats(w.players[2]).maxHp * 0.3);
  for (const p of w.players) {
    p.alive = false;
    p.hp = 0;
  }
  stepWorld(w, []);
  assert.equal(w.outcome, "defeat");
});

test("several rescuers do not accelerate or duplicate a revive", () => {
  const w = world(4);
  const target = w.players[3];
  target.alive = false;
  target.hp = 0;
  for (const p of w.players.slice(0, 3)) p.x = target.x;
  stepWorld(
    w,
    w.players.slice(0, 3).map((p) => ({ t: "interact", player: p.id })),
  );
  advance(w, 45);
  assert.equal(target.alive, false);
  // Keep events from the completion tick to count the observable revive.
  for (let tick = 0; tick < 50; tick++) stepWorld(w, []);
  assert.equal(target.alive, true);
  assert.equal(w.events.filter((e) => e.t === "revive" && e.player === target.id).length, 1);
  assert.ok(w.players.every((p) => p.rescue === null));
});

test("four distinct spawn bodies survive the whole route; restored P4 input remains deterministic", () => {
  let seed = 5;
  const party = createWorldFromSeeds(
    {
      stage: "forest",
      difficulty: 0,
      players: Array.from({ length: 4 }, () => ({ starter: "charmander" })),
    },
    () => seed++,
  );
  for (const stage of STAGE_ROUTE) {
    assert.equal(party.stage, stage);
    assert.equal(new Set(party.players.map((p) => `${p.x},${p.z}`)).size, 4);
    assert(party.players.every((p) => p.z === 0 && p.px === p.x && p.pz === p.z));
    if (stage !== "tower") {
      party.zone.phase = "transitioning";
      enterZone(party, prepareZone(party));
    }
  }
  const w = world(4);
  const restored = restoreWorld(w.map, JSON.parse(JSON.stringify(snapshotWorld(w))));
  for (let tick = 0; tick < 180; tick++) {
    const commands =
      tick === 0
        ? [
            { t: "move", player: 3, x: 1, z: 0 },
            { t: "dash", player: 2 },
          ]
        : [];
    stepWorld(w, commands);
    stepWorld(restored, commands);
  }
  assert.deepEqual(snapshotWorld(restored), snapshotWorld(w));
  assert.ok(w.players[3].x > 3);
});

test("离队席位不再领取奖励，也不按倒地队友抬高刷怪压力", async () => {
  const { departPlayer } = await import("../src/run/sim/team.ts");
  const { updateSpawnPressure } = await import("../src/run/sim/director-pressure.ts");
  const world = createWorld({
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: [{ starter: "charmander" }, { starter: "squirtle" }],
  });
  const [host, gone] = world.players;
  departPlayer(world, gone.id);
  const xp = gone.xp;
  for (const kind of ["xp", "chest"])
    world.pickups.push({ id: world.nextId++, kind, x: host.x, z: host.z, value: 50, magnet: true });
  stepWorld(world, []);
  assert.equal(gone.xp, xp);
  assert.deepEqual(gone.pending, []);
  assert(host.pending.length > 0, "在场玩家照常得到宝箱");
  world.time = 1e4;
  world.zone.tick = Math.round(600 / TICK);
  for (let i = 0; i < 300; i++) updateSpawnPressure(world, TICK);
  assert(world.spawn.pressure < 0.9, `pressure ${world.spawn.pressure}`);
});
