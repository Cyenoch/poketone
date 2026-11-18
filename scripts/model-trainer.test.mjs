import assert from "node:assert/strict";
import test from "node:test";
import { trainerReference } from "../src/run/balance/trainer-report.ts";
import { trainerKits } from "../src/run/sim/content/trainers.ts";

const reference = Object.fromEntries(
  Object.keys(trainerKits).map((id) => [id, trainerReference("charmander", id, 0)]),
);

test("没有训练师明显最强：道具折算后的输出不超过 +10%，好伤药不抵消全部平均承伤", () => {
  for (const [id, ref] of Object.entries(reference)) {
    assert.ok(ref.swarm >= 1 && ref.swarm <= 1.1, `${id} swarm ${ref.swarm}`);
    assert.ok(ref.guardian >= 1 && ref.guardian <= 1.1, `${id} guardian ${ref.guardian}`);
    assert.ok(ref.healShare < 0.75, `${id} heal ${ref.healShare}`);
  }
});
