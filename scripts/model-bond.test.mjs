import assert from "node:assert/strict";
import test from "node:test";
import { runModel } from "../src/run/balance/model.ts";
import { average } from "../src/run/balance/skill.ts";

const forest = {
  starter: "squirtle",
  skill: average,
  stage: "forest",
  step: 0,
  difficulty: 1,
  samples: 8,
};

test("等级 0 的羁绊与不带羁绊的模型结果完全相同", () => {
  assert.deepEqual(runModel({ ...forest, bond: { level: 0, lab: 3 } }), runModel(forest));
});

test("羁绊节点未到 Lv3 不生效", () => {
  assert.deepEqual(
    runModel({ ...forest, bond: { level: 2, lab: 3 } }),
    runModel({ ...forest, bond: { level: 2, lab: 0 } }),
  );
});

test("挺住只增加存活，不降低任何路径的通关概率", () => {
  const base = runModel(forest).outcome;
  const endure = runModel({ ...forest, bond: { level: 2, lab: 0 } }).outcome;
  assert.ok(endure.meanSurvival >= base.meanSurvival);
  assert.ok(endure.clear >= base.clear);
});

test("满羁绊节点提高护甲估算的受击容量", () => {
  const at = (bond) => runModel({ ...forest, bond }).minutes.at(-1);
  assert.ok(at({ level: 5, lab: 3 }).ehp > at({ level: 4, lab: 0 }).ehp);
});
