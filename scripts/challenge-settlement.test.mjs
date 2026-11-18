import assert from "node:assert/strict";
import test from "node:test";
import {
  availableSelection,
  emptyProgress,
  parseProgress,
  recordRun,
} from "../src/run/progress.ts";
import { createWorld } from "../src/run/sim/world.ts";
import { challengePayout, seatOutcome } from "../src/run/sim/challenge-result.ts";
import { ruleIds } from "../src/run/sim/content/rules.ts";
import { badgeIds } from "../src/run/sim/content/badges.ts";
import { restoreWorld, snapshotWorld } from "../src/run/sim/snapshot.ts";

test("全选噩梦按席位结算星沙，倒下的队员不获通关徽章", () => {
  const world = createWorld({
    mode: "expedition",
    seed: 6,
    stage: "forest",
    difficulty: 2,
    rules: ruleIds,
    players: ["charmander", "squirtle"].map((starter) => ({
      trainer: "chengxi",
      starter,
      shiny: false,
    })),
  });
  const run = {
    difficulty: 2,
    zones: 4,
    time: 90,
    level: 3,
    kills: 17,
    dex: {},
    moves: [],
    items: [],
  };
  for (const player of world.players) {
    player.stardust = player.id === 0 ? 100 : 10;
    player.alive = player.id === 0;
    const progress = recordRun(emptyProgress(), {
      ...run,
      starter: player.starter,
      outcome: seatOutcome(world, player, "victory"),
      ...challengePayout(world, player),
    });
    assert.equal(progress.stardust, player.alive ? 230 : 23);
    assert.deepEqual(progress.badges, player.alive ? badgeIds : []);
    assert.equal(progress.clears[2], player.alive ? 1 : 0);
    assert.equal(progress.research, 17);
    assert.deepEqual(progress.bonds, { [player.starter]: player.alive ? 20 : 8 });
  }
  const snap = snapshotWorld(world);
  assert.deepEqual(restoreWorld(world.map, snap).rules, ruleIds);
  assert.throws(() => restoreWorld(world.map, { ...snap, rules: ["unregistered"] }), /规则/);
});

test("存档接受已登记的规则和徽章，回填不选尚未开放的规则", () => {
  const empty = emptyProgress();
  const saved = { ...empty, badges: ["boulder"], rules: ["level-cap", "wild-weather"] };
  assert.deepEqual(availableSelection(parseProgress(saved)), []);
  const open = parseProgress({ ...saved, clears: [1, 0, 0] });
  assert.deepEqual(availableSelection(open), saved.rules);
  assert.deepEqual(open.badges, saved.badges);
  assert.throws(() => parseProgress({ ...saved, rules: ["nuzlocke", "nuzlocke"] }), /rules/);
  assert.throws(() => parseProgress({ ...saved, badges: ["unknown"] }), /badges/);
});
