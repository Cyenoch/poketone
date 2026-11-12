import assert from "node:assert/strict";
import test from "node:test";
import { FocusMark, uiEaseOut } from "../src/ui/gpu/focus-mark.ts";
import { UiMotion } from "../src/ui/gpu/motion.ts";

test("focus changes crossfade markers in place rather than flying between commands", () => {
  const motion = new UiMotion();
  const first = new FocusMark(motion, () => {}),
    second = new FocusMark(motion, () => {});
  first.mesh.position.set(10, 80, 0);
  second.mesh.position.set(10, 20, 0);
  first.setFocused(true);
  motion.update(180);
  first.setFocused(false);
  second.setFocused(true);
  motion.update(50);
  for (const mark of [first, second]) {
    assert.ok(mark.mesh.material.uniforms.alpha.value > 0);
    assert.ok(mark.mesh.material.uniforms.alpha.value < 1);
  }
  assert.equal(first.mesh.position.y, 80);
  assert.equal(second.mesh.position.y, 20);
  motion.update(50);
  assert.equal(first.mesh.material.uniforms.alpha.value, 0);
  assert.equal(second.mesh.material.uniforms.alpha.value, 1);
  motion.update(80);
  assert.equal(second.mesh.rotation.z, 0);
  assert.equal(second.mesh.scale.x, 22 / 24);
  first.dispose();
  second.dispose();
  motion.dispose();
});

test("interrupting marker motion preserves its visible pose and completes the new transition", () => {
  const motion = new UiMotion();
  const mark = new FocusMark(motion, () => {});
  mark.setFocused(true);
  motion.update(40);
  const scale = mark.mesh.scale.x,
    alpha = mark.mesh.material.uniforms.alpha.value;
  mark.setFocused(false);
  assert.equal(mark.mesh.scale.x, scale);
  assert.equal(mark.mesh.material.uniforms.alpha.value, alpha);
  mark.setFocused(true);
  motion.update(180);
  assert.equal(mark.mesh.scale.x, 22 / 24);
  assert.equal(mark.mesh.rotation.z, 0);
  assert.equal(mark.mesh.material.uniforms.alpha.value, 1);
  assert.equal(motion.update(16), false);
  mark.dispose();
  motion.dispose();
});

test("the shared ease matches the authored CSS curve, including its endpoints", () => {
  assert.equal(uiEaseOut(0), 0);
  assert.equal(uiEaseOut(1), 1);
  // At parameter t=.5: x=.2975 and y=.875 for cubic-bezier(.16,1,.3,1).
  assert.ok(Math.abs(uiEaseOut(0.2975) - 0.875) < 0.00001);
});
