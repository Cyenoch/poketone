import assert from "node:assert/strict";
import test from "node:test";
import { compareChallengeRules } from "./balance-challenge-rules.ts";
import { fieldAt, previewChoice, runModel, targetFor } from "../src/run/balance/model.ts";
import { average, expert } from "../src/run/balance/skill.ts";
import { labBonuses } from "../src/run/lab.ts";
import {
  CAP_STARDUST_RATE,
  HELD_ITEM_STARDUST,
  LEVEL_CAP,
} from "../src/run/sim/content/params/rules.ts";
import { ruleIds } from "../src/run/sim/content/rules.ts";
import { evolve } from "../src/run/sim/evolution.ts";
import { createRng } from "../src/run/sim/rng.ts";
import { xpForLevel } from "../src/run/sim/stats.ts";
import { newMoveState, offerKey, replacesHeldItem } from "../src/run/sim/upgrades.ts";
import { createPlayer } from "../src/run/sim/world.ts";

const forest = { starter: "bulbasaur", skill: average, stage: "forest", step: 0, samples: 1 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("空规则的挑战报告与原模型使用完全相同的成长、承伤和收益", () => {
  const baseline = runModel({ ...forest, difficulty: 0 });
  const { challenge, ...control } = runModel({ ...forest, difficulty: 0, rules: [] });
  assert.deepEqual(control, baseline);
  assert.equal(challenge.stardust, baseline.stardust);
  assert.ok(challenge.pressure[0].preSummon.landed > 0);
});

test("全选读取正式等级上限和卡池，转砂入原账后只乘一次结算倍率", () => {
  const run = runModel({ ...forest, difficulty: 0, skill: expert, seed: 0x5eed, rules: ruleIds });
  const { challenge } = run;
  const [field] = challenge.fields;
  assert.equal(run.zoneClears[0].level, LEVEL_CAP[0]);
  assert.ok(field.cappedXp > 0);
  close(field.capStardust, field.cappedXp * CAP_STARDUST_RATE);
  assert.ok(field.replacedItems > 0);
  close(field.itemStardust, field.replacedItems * HELD_ITEM_STARDUST);
  const player = createPlayer(0, forest.starter, 0);
  for (const [key, exposure] of run.exposure) {
    if (key.startsWith("item:") && replacesHeldItem(ruleIds, player, key.slice(5))) {
      assert.equal(exposure.offered, 0);
      assert.equal(exposure.acquired, 0);
    }
  }
  close(run.fieldEvents[0].earned.stardust, run.stardust);
  assert.equal(challenge.danger, 13);
  close(challenge.stardust, run.stardust * 2.3);
});

test("单属性在糖果连发选卡中限制异属性新招式，保留异属性进化招式", () => {
  const target = targetFor(fieldAt(1, "coast", 300, 0, false), 60, average);
  for (const [starter, kit, desiredMove, eligible] of [
    ["squirtle", ["water-gun", "hydro-pump"], "rapid-spin", false],
    ["dratini", ["dragon-breath", "dragon-pulse"], "aqua-tail", true],
  ]) {
    const player = createPlayer(0, starter, 0);
    Object.assign(player, { level: 39, xpNext: xpForLevel(39), moves: kit.map(newMoveState) });
    evolve(player);
    player.banished.push(...["bubble", "surf", "twister", "dragon-rush"].map(offerKey.move));
    const takesMove = (rules) =>
      previewChoice(
        player,
        { kind: "item", item: "rare-candy" },
        createRng(17),
        target,
        average,
        { prefer: "move", greedy: 0 },
        [],
        rules,
      ).moves.some(({ id }) => id === desiredMove);
    assert.ok(takesMove([]), "对照组需要实际习得目标招式");
    assert.equal(takesMove(["mono-type"]), eligible, desiredMove);
  }
});

test("异常天气报告区分排定与触发，真正遭遇沙暴才计自然天气承伤", () => {
  // 给后区起步的构筑留足生存余量，让它能到达同种子的天气窗口。
  const options = {
    ...forest,
    starter: "squirtle",
    skill: expert,
    lab: labBonuses({ hp: 5, regen: 5 }),
    stage: "desert",
    step: 1,
    difficulty: 0,
    seed: 4,
  };
  const compare = (options) => compareChallengeRules(options, ["wild-weather"]);
  const {
    baseline,
    variants: [{ result }],
  } = compare(options);
  assert.equal(baseline.maps[0].triggeredEvents.sandstorm ?? 0, 0);
  assert.equal(result.maps[0].triggeredEvents.sandstorm, 1);
  assert.ok(result.maps[0].weatherHpCost > 0);

  const early = compare({ ...options, summonSeconds: [1] }).variants[0].result.maps[0];
  assert.equal(early.scheduledEvents.sandstorm, 1);
  assert.equal(early.triggeredEvents.sandstorm ?? 0, 0);
  assert.equal(early.weatherHpCost, 0);
});

test("有个人复活研究时，Nuzlocke 改变存活曲线，头目化提高精英供给生命", () => {
  const options = { ...forest, difficulty: 2, lab: labBonuses({ revive: 1 }) };
  const control = runModel({ ...options, rules: [] });
  const nuzlocke = runModel({ ...options, rules: ["nuzlocke"] });
  const alpha = runModel({ ...options, rules: ["alpha-elites"] });
  assert.ok(nuzlocke.outcome.reachBoss < control.outcome.reachBoss);
  assert.ok(
    alpha.challenge.pressure[0].entry.incoming > control.challenge.pressure[0].entry.incoming,
  );
});
