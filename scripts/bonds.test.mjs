import assert from "node:assert/strict";
import test from "node:test";
import { resultFor } from "../src/run/createRun.ts";
import { buyLab, emptyProgress, partnerBondSetup, recordRun } from "../src/run/progress.ts";
import { decodeSave, encodeSave } from "../src/run/save.ts";
import { defaultSettings } from "../src/settings.ts";
import { clearZone } from "../src/run/sim/currentZone.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { damagePlayer } from "../src/run/sim/hurt.ts";
import { restoreWorld, snapshotWorld } from "../src/run/sim/snapshot.ts";
import { playerStats, refreshStats } from "../src/run/sim/stats.ts";
import { has } from "../src/run/sim/status.ts";
import { createWorld, stepSharedWorld } from "../src/run/sim/world.ts";
import { enterZone, prepareZone } from "../src/run/sim/zones.ts";
import { selectTestExit } from "./fixtures/route.mjs";

function run(players, rules = [], difficulty = 0) {
  return createWorld({
    mode: "expedition",
    stage: "forest",
    seed: 5,
    difficulty,
    rules,
    players: players.map((p) => ({ trainer: "chengxi", ...p })),
  });
}

test("挺住保护自己的席位一次，换图和快照恢复都不补次数", () => {
  const world = run(
    [
      { starter: "charmander", bond: 2 },
      { starter: "charmander", bond: 0 },
    ],
    ["nuzlocke"],
  );
  for (const player of world.players) {
    player.invulnerable = 0;
    damagePlayer(world, player, 1e4);
  }
  const [bonded, teammate] = world.players;
  assert.equal(bonded.hp, 1);
  assert.equal(bonded.alive, true);
  assert.equal(teammate.alive, false);
  assert.deepEqual(
    world.events.filter((event) => event.t === "bond-endure"),
    [{ t: "bond-endure", player: bonded.id }],
  );
  assert.equal(damagePlayer(world, bonded, 1e4), false, "保留受伤无敌");
  selectTestExit(world, "coast");
  enterZone(world, prepareZone(world));
  const restored = restoreWorld(world.map, JSON.parse(JSON.stringify(snapshotWorld(world))));
  const player = restored.players[0];
  player.invulnerable = 0;
  damagePlayer(restored, player, 1e4);
  assert.equal(player.alive, false);
  assert.equal(player.hp, 0);
});

test("挺住先于其他保命：先挺住，再到气势披带和活力碎片", () => {
  const world = run([{ starter: "charmander", bond: 2 }]);
  const [player] = world.players;
  player.items = [
    { id: "focus-sash", level: 1 },
    { id: "revive", level: 1 },
  ];
  refreshStats();
  const knockOut = () => {
    world.events = [];
    player.invulnerable = 0;
    damagePlayer(world, player, 1e6);
    return world.events.filter((event) => ["bond-endure", "heal", "revive"].includes(event.t));
  };
  assert.deepEqual(knockOut(), [{ t: "bond-endure", player: player.id }]);
  assert.equal(player.hp, 1);
  assert.deepEqual(
    Object.keys(player.fx).filter((key) => /focus-sash|revive/.test(key)),
    [],
    "挺住不消耗其他保命",
  );
  assert.deepEqual(
    knockOut().map((event) => event.t),
    ["heal"],
    "第二次致命伤由气势披带接住",
  );
  assert.deepEqual(
    knockOut().map((event) => event.t),
    ["revive"],
  );
  assert.equal(player.alive, true);
});

test("房主在中毒的同一模拟步解除自己的首个异常，进下一张地图才重新获得", () => {
  const world = run([{ starter: "squirtle", bond: 4 }, { starter: "squirtle" }]);
  const [bonded, teammate] = world.players;
  function poisonBoth() {
    world.enemies = [];
    world.events = [];
    for (const player of world.players) {
      player.moves = [];
      player.invulnerable = 0;
      spawnEnemy(world, "weedle", player.x, player.z);
    }
    stepSharedWorld(world, []);
    assert.equal(has(teammate, "poison"), true);
    return world.events.filter((event) => event.t === "bond-cure");
  }

  assert.deepEqual(poisonBoth(), [{ t: "bond-cure", player: bonded.id }]);
  assert.equal(has(bonded, "poison"), false);
  assert.deepEqual(poisonBoth(), []);
  assert.equal(has(bonded, "poison"), true);
  selectTestExit(world, "coast");
  enterZone(world, prepareZone(world));
  assert.deepEqual(poisonBoth(), [{ t: "bond-cure", player: bonded.id }]);
  assert.equal(has(bonded, "poison"), false);
});

test("羁绊研究解锁后可购买、可保存，只增强选择该伙伴的玩家", () => {
  const initial = { ...emptyProgress(), stardust: 1000, bonds: { squirtle: 59, geodude: 60 } };
  assert.throws(() => buyLab(initial, "bond-squirtle"), /羁绊需达到 Lv\.3/);
  const unlocked = { ...initial, bonds: { ...initial.bonds, squirtle: 60 } };
  const bought = buyLab(unlocked, "bond-squirtle");
  assert.ok(bought.stardust < unlocked.stardust);
  const { progress } = decodeSave(encodeSave({ progress: bought, settings: defaultSettings }));
  const seat = (starter) => ({ starter, ...partnerBondSetup(progress, starter) });
  const [trained, teammate, untrained] = run([
    seat("squirtle"),
    seat("geodude"),
    { starter: "squirtle" },
  ]).players;
  assert.ok(playerStats(trained).armor > playerStats(untrained).armor);
  assert.equal(
    playerStats(teammate).armor,
    playerStats(run([{ starter: "geodude" }]).players[0]).armor,
  );
});

test("失败结算只计算已清地图：当前图清完即给点，难度乘完向下取整", () => {
  const world = run([{ starter: "charmander" }], ["nuzlocke"], 1);
  const [player] = world.players;
  world.outcome = "defeat";
  const before = { ...emptyProgress(), bonds: { squirtle: 20 } };
  const lost = resultFor(world, 0);
  assert.deepEqual(recordRun(before, lost).bonds, before.bonds);
  clearZone(world, player.x, player.z);
  const cleared = resultFor(world, 0);
  assert.equal(cleared.zones, 1);
  assert.deepEqual(recordRun(before, cleared).bonds, { charmander: 1, squirtle: 20 });
});

test("结算的背包候选不含超级进化石：下一局开局不会被拒", () => {
  const world = run([{ starter: "charmander" }], [], 0);
  const [player] = world.players;
  player.items.push({ id: "charizardite-x", level: 1 }, { id: "everstone", level: 1 });
  world.outcome = "defeat";
  assert.deepEqual(resultFor(world, 0).items, ["everstone"]);
});

test("羁绊达到 Lv.5 时异色外观只写入一次：正好 160、越过 160、再次越过", () => {
  const ended = run([{ starter: "charmander" }]);
  ended.outcome = "defeat";
  const base = resultFor(ended, 0);
  const earn = (zones) => ({ ...base, outcome: "defeat", difficulty: 0, zones });
  const owned = (progress) => progress.looks.owned.filter((line) => line === "charmander");

  const exact = recordRun({ ...emptyProgress(), bonds: { charmander: 159 } }, earn(1));
  assert.equal(exact.bonds.charmander, 160);
  assert.deepEqual(owned(exact), ["charmander"]);
  const again = recordRun(exact, earn(10));
  assert.equal(again.bonds.charmander, 170);
  assert.deepEqual(owned(again), ["charmander"], "已满级后再得点不重复写入");

  const past = recordRun({ ...emptyProgress(), bonds: { charmander: 150 } }, earn(15));
  assert.equal(past.bonds.charmander, 165);
  assert.deepEqual(owned(past), ["charmander"]);

  // A shiny encounter already gave the look; crossing 160 later does not add it a second time.
  const already = {
    ...emptyProgress(),
    bonds: { charmander: 159 },
    looks: { owned: ["charmander"], worn: [] },
  };
  assert.deepEqual(owned(recordRun(already, earn(5))), ["charmander"]);
});
