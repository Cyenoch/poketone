import assert from "node:assert/strict";
import test from "node:test";
import { FRAME_BUDGET_MS, policyFor, WorldResolution } from "../src/rendering/world-resolution.ts";

const B = FRAME_BUDGET_MS;
const desktop = { initial: 1.5, min: 1, max: 2 };

/** Plays `ms` of 60 Hz frames with the given GPU and CPU times (gpu null: no timer queries). */
function play(drs, clock, ms, { gpu, cpu = 2, interval = B }) {
  const end = clock.now + ms;
  while (clock.now < end) {
    clock.now += interval;
    drs.frame(clock.now, interval, cpu);
    if (gpu !== null) drs.gpu(typeof gpu === "function" ? gpu(drs.ratio) : gpu, clock.now);
  }
  return drs.ratio;
}

function start(policy = desktop) {
  const clock = { now: 0 };
  const drs = new WorldResolution(policy);
  drs.reset(0);
  return { drs, clock };
}

test("a sustained GPU overload steps down once per hold, and a severe one takes two steps once", () => {
  const { drs, clock } = start();
  play(drs, clock, 600, { gpu: B * 0.9 });
  assert.equal(drs.ratio, 1.5, "one over-budget window is not enough");
  play(drs, clock, 600, { gpu: B * 0.9 });
  assert.equal(drs.ratio, 1.375, "two windows step down 0.125");
  play(drs, clock, 700, { gpu: B * 0.9 });
  assert.equal(drs.ratio, 1.375, "no second step inside the 1 s hold");

  const severe = start();
  play(severe.drs, severe.clock, 600, { gpu: B * 1.3 });
  assert.equal(severe.drs.ratio, 1.25, "a severe window takes two steps at once");
  play(severe.drs, severe.clock, 1600, { gpu: B * 1.3 });
  assert.equal(severe.drs.ratio, 1.125, "later overload steps one at a time");
});

test("it steps up only after 3 s of headroom with CPU room, then holds 3 s", () => {
  const { drs, clock } = start({ initial: 1.25, min: 1, max: 2 });
  play(drs, clock, 2800, { gpu: B * 0.5 });
  assert.equal(drs.ratio, 1.25);
  play(drs, clock, 1000, { gpu: B * 0.5 });
  assert.equal(drs.ratio, 1.3125, "one 0.0625 step up");
  play(drs, clock, 2800, { gpu: B * 0.5 });
  assert.equal(drs.ratio, 1.3125, "held 3 s after an increase");

  const busy = start({ initial: 1.25, min: 1, max: 2 });
  play(busy.drs, busy.clock, 6000, { gpu: B * 0.5, cpu: B * 0.8 });
  assert.equal(busy.drs.ratio, 1.25, "a CPU-bound frame never buys more world pixels");
});

test("it never leaves the policy range", () => {
  const { drs, clock } = start();
  // A fill-bound load: GPU time follows the world pixel count.
  play(drs, clock, 20000, { gpu: (ratio) => B * 2 * (ratio / 1.5) ** 2 });
  assert.equal(drs.ratio, 1);
  const up = start({ initial: 1.875, min: 1, max: 2 });
  play(up.drs, up.clock, 20000, { gpu: B * 0.3 });
  assert.equal(up.drs.ratio, 2);
});

test("decreases that do not lower GPU time stop after two: the cost is not in world pixels", () => {
  const { drs, clock } = start({ initial: 2, min: 1, max: 2 });
  play(drs, clock, 12000, { gpu: B * 0.95 });
  assert.equal(drs.ratio, 1.75, "two steps, then it stops instead of collapsing to the floor");
});

test("a frozen world (no world frames) holds the resolution and breaks streaks", () => {
  const { drs, clock } = start();
  play(drs, clock, 600, { gpu: B * 0.9 });
  clock.now += 5000; // paused: the app feeds nothing
  play(drs, clock, 600, { gpu: B * 0.9 });
  assert.equal(drs.ratio, 1.5, "the window before the pause does not count toward two");
});

test("without timer queries, one trial step is kept only if it cuts misses, else reverted for good", () => {
  const { drs, clock } = start();
  play(drs, clock, 1200, { gpu: null, interval: B * 2 });
  assert.equal(drs.ratio, 1.375, "two miss windows with CPU room: try one step down");
  play(drs, clock, 1600, { gpu: null, interval: B * 2 });
  assert.equal(drs.ratio, 1.5, "no fewer misses: back to where it was");
  play(drs, clock, 10000, { gpu: null, interval: B * 2 });
  assert.equal(drs.ratio, 1.5, "and no more trials");
});

test("device classes start where the assessment proposes", () => {
  assert.deepEqual(policyFor(3, true, 3), { initial: 1.5, min: 1, max: 2 });
  assert.deepEqual(policyFor(2, false, 2), { initial: 1.5, min: 1, max: 2 });
  assert.deepEqual(policyFor(1, false, 1), { initial: 1, min: 0.75, max: 1 });
});

test("the range stops at the canvas density, so every step down really lowers the target", () => {
  // A DPR-3 desktop whose canvas is capped at 2: the policy must not climb past what applies.
  const policy = policyFor(3, false, 2);
  assert.equal(policy.max, 2);
  const { drs, clock } = start({ ...policy, initial: policy.max });
  play(drs, clock, 20000, { gpu: B * 0.3 });
  assert.equal(drs.ratio, 2, "headroom never asks for more than the canvas has");
  play(drs, clock, 1200, { gpu: (ratio) => B * 0.95 * (ratio / 2) ** 2 + B * 0.1 });
  assert.equal(drs.ratio, 1.875, "the first overload steps down from the real ceiling");
});

test("sustained slow frames are still judged; only a long gap counts as a pause", () => {
  const { drs, clock } = start();
  // 8 fps: a 500 ms window holds only four frames; it runs on until it has enough.
  play(drs, clock, 2500, { gpu: B * 4, interval: 125 });
  assert.equal(drs.ratio, 1.25, "a severe window takes two steps even at 8 fps");
});

test("a reset gives a failed no-timer trial another chance", () => {
  const { drs, clock } = start();
  play(drs, clock, 3000, { gpu: null, interval: B * 2 });
  assert.equal(drs.ratio, 1.5, "the trial was reverted");
  drs.reset(clock.now);
  play(drs, clock, 1200, { gpu: null, interval: B * 2 });
  assert.equal(drs.ratio, 1.375, "after a resize, restore or new run it may try again");
});

test("GPU results that arrive while the world is frozen change nothing, before or after", () => {
  const { drs, clock } = start();
  play(drs, clock, 600, { gpu: B * 0.9 });
  const lastFrame = clock.now;
  // Paused: no world frames, but over-budget results for the frames before the pause trickle in.
  for (let i = 0; i < 20; i++) drs.gpu(B * 0.9, lastFrame - i * B);
  clock.now += 3000;
  assert.equal(drs.ratio, 1.5, "nothing is decided without world frames");
  play(drs, clock, 600, { gpu: B * 0.5 });
  for (let i = 0; i < 80; i++) drs.gpu(B * 2, lastFrame - i * B);
  play(drs, clock, 600, { gpu: B * 0.5 });
  assert.equal(drs.ratio, 1.5, "results from before the pause never land in a later window");
});
