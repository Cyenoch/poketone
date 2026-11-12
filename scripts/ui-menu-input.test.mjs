import assert from "node:assert/strict";
import test from "node:test";
import { MenuInput } from "../src/ui/gpu/menu-input.ts";

function fixture() {
  const activated = [],
    scrolled = [],
    focused = [],
    hovered = [],
    presses = [],
    pressedAtActivation = [];
  let pressed = null;
  const input = new MenuInput({
    hit: (x, y) => (x >= 0 && x < 200 && y >= 0 && y < 100 ? Math.floor(y / 50) : -1),
    focus: (index) => focused.push(index),
    activate: (index) => {
      pressedAtActivation.push(pressed);
      activated.push(index);
    },
    setPressed: (index) => {
      pressed = index;
      presses.push(index);
    },
    scroll: (delta) => scrolled.push(delta),
    hover: (index) => hovered.push(index),
  });
  return {
    input,
    activated,
    scrolled,
    focused,
    hovered,
    presses,
    pressedAtActivation,
    get pressed() {
      return pressed;
    },
  };
}

test("a tap activates once; a second finger cannot steal its command", () => {
  const { input, activated } = fixture();
  assert.equal(input.down(1, 20, 20), true);
  assert.equal(input.down(2, 20, 70), false);
  input.up(2, 20, 70);
  input.up(1, 20, 20);
  input.up(1, 20, 20);
  assert.deepEqual(activated, [0]);
});

test("scrolling, cancelling or releasing outside never activates a command", () => {
  const { input, activated, scrolled } = fixture();
  input.down(1, 20, 70);
  input.move(1, 20, 30, false);
  input.move(1, 20, 70, false);
  input.up(1, 20, 70);
  assert.deepEqual(scrolled, [40, -40]);
  input.down(1, 20, 20);
  input.cancel();
  input.up(1, 20, 20);
  input.down(1, 20, 20);
  input.up(1, 300, 20);
  assert.deepEqual(activated, []);
});

test("touch motion without a press does not hover; mouse does", () => {
  const { input, hovered } = fixture();
  input.move(1, 20, 70, false);
  assert.deepEqual(hovered, [null]);
  input.move(1, 20, 70, true);
  assert.deepEqual(hovered, [null, 1]);
});

test("leaving and returning before drag restores press; release clears it before activation", () => {
  const state = fixture();
  state.input.down(1, 199, 20);
  assert.equal(state.pressed, 0);
  state.input.move(1, 201, 20, false);
  assert.equal(state.pressed, null);
  state.input.move(1, 199, 20, false);
  assert.equal(state.pressed, 0);
  state.input.up(1, 199, 20);
  assert.equal(state.pressed, null);
  assert.deepEqual(state.activated, [0]);
  assert.deepEqual(state.pressedAtActivation, [null]);
});

test("second-finger move, release and cancel cannot clear the owner's pressed feedback", () => {
  const state = fixture();
  state.input.down(1, 20, 20);
  assert.equal(state.input.down(2, 20, 70), false);
  state.input.move(2, 300, 70, false);
  state.input.up(2, 20, 70);
  state.input.cancel(2);
  assert.equal(state.pressed, 0);
  assert.deepEqual(state.presses, [0]);
  state.input.cancel(1);
  assert.equal(state.pressed, null);
  state.input.up(1, 20, 20);
  assert.deepEqual(state.activated, []);
});

test("dragging never restores pressed feedback or activates after returning to the target", () => {
  const state = fixture();
  state.input.down(1, 20, 20);
  state.input.move(1, 20, 40, false);
  assert.equal(state.pressed, null);
  state.input.move(1, 20, 20, false);
  assert.equal(state.pressed, null);
  state.input.up(1, 20, 20);
  assert.equal(state.pressed, null);
  assert.deepEqual(state.activated, []);
  state.input.down(3, 20, 20);
  state.input.cancel();
  assert.equal(state.pressed, null);
  state.input.down(4, 20, 20);
  state.input.up(4, 300, 20);
  assert.equal(state.pressed, null);
});
