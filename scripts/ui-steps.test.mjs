import assert from "node:assert/strict";
import test from "node:test";
import { drive } from "../src/prepare/steps.ts";

test("a construction stops before its next step once its owner is gone", async () => {
  const done = [];
  function* build() {
    for (let i = 0; i < 5; i++) {
      done.push(i);
      yield;
    }
    return "built";
  }
  let live = true;
  const steps = build();
  const driven = drive(
    (function* () {
      for (;;) {
        const step = steps.next();
        if (step.done) return step.value;
        if (done.length === 2) live = false; // disposed (or the context lost) after two steps
        yield;
      }
    })(),
    { live: () => live, budgetMs: Infinity },
  );
  await assert.rejects(driven, { name: "AbortError" });
  assert.deepEqual(done, [0, 1], "no step after the owner went");
  assert.equal(await drive(build(), { budgetMs: Infinity }), "built");
});
