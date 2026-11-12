import assert from "node:assert/strict";
import test from "node:test";
import { Scene } from "three";
import { HoverPattern } from "../src/ui/gpu/hover-pattern.ts";
import { advanceIdleClock, UiMotion } from "../src/ui/gpu/motion.ts";

/** A frame of `ms` as the host runs it: the page idle clock, then the pattern. */
const frame = (pattern, ms) => {
  advanceIdleClock(ms);
  pattern.update(ms);
};

test("a lit pattern drifts by any input (hover, focus, selected, touch), stops in place unlit, loops after 24 s", () => {
  const motion = new UiMotion();
  const pattern = new HoverPattern(motion, () => {}, true);
  new Scene().add(pattern.content);
  pattern.setFocused(true);
  motion.update(220);
  frame(pattern, 6000);
  assert.equal(pattern.uniforms.patternAlpha.value, 1);
  assert.equal(
    pattern.uniforms.patternPhase.value,
    0.25,
    "lit with no pointer (a picked control on touch) drifts",
  );
  pattern.setFocused(false);
  motion.update(220);
  frame(pattern, 10000);
  assert.equal(pattern.uniforms.patternAlpha.value, 0);
  assert.equal(pattern.uniforms.patternPhase.value, 0.25, "unlit it stops where it was");
  pattern.setFocused(true);
  motion.update(220);
  frame(pattern, 18000);
  assert.equal(
    pattern.uniforms.patternPhase.value,
    0,
    "and resumes from there, round to the start",
  );
  pattern.dispose();
  motion.dispose();
});

test("a pattern made without drift (the run HUD) lights but holds still", () => {
  const motion = new UiMotion();
  const pattern = new HoverPattern(motion, () => {}, true, 8, false);
  new Scene().add(pattern.content);
  pattern.setFocused(true);
  motion.update(220);
  frame(pattern, 6000);
  assert.equal(pattern.uniforms.patternAlpha.value, 1);
  assert.equal(pattern.uniforms.patternPhase.value, 0);
  pattern.dispose();
  motion.dispose();
});
