import assert from "node:assert/strict";
import test from "node:test";
import { UiMotion } from "../src/ui/gpu/motion.ts";

test("reversing a focus animation continues from the visible value", () => {
  const motion = new UiMotion();
  const state = { x: 0 };
  const frames = [];
  const apply = () => frames.push(state.x);
  motion.animate(state, { x: 100 }, 100, apply, (t) => t);
  motion.update(40);
  assert.equal(state.x, 40);
  motion.animate(state, { x: 0 }, 100, apply, (t) => t);
  assert.equal(state.x, 40);
  motion.update(50);
  assert.equal(state.x, 20);
  motion.update(50);
  assert.equal(state.x, 0);
  assert.equal(motion.update(1), false);
  assert.equal(frames.at(-1), 0);
  assert.equal(motion.group.getAll().length, 0);
});

test("unmounted controls cannot receive updates from a cancelled animation", () => {
  const motion = new UiMotion();
  const state = { x: 0 };
  let calls = 0;
  motion.animate(state, { x: 100 }, 100, () => calls++);
  motion.update(20);
  const previous = calls;
  motion.cancel(state);
  motion.update(100);
  assert.equal(calls, previous);
  assert.equal(motion.group.getAll().length, 0);
});
