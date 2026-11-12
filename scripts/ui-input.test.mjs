import test from "node:test";
import assert from "node:assert/strict";
import { ActionInput, radialStick, navigationAction } from "../src/platform/input.ts";
function setup() {
  let pads = [
    {
      token: "pad:1",
      name: "test",
      family: "generic",
      mapped: true,
      axes: [0, 0, 0, 0],
      buttons: new Set(),
    },
  ];
  const modes = [];
  const input = new ActionInput({
    sample: () => pads,
    dispose() {},
  });
  input.onActivity = (mode) => modes.push(mode);
  const pad = pads[0];
  const frame = (now = 0, context = "gameplay") => input.sample(now, context);
  function claim() {
    pad.buttons.add("south");
    assert.deepEqual(frame().actions, []);
    pad.buttons.clear();
    frame();
  }
  return {
    input,
    pad,
    frame,
    claim,
    modes,
    disconnect: () => {
      pads = [];
    },
  };
}
test("radial movement keeps slow walking and caps diagonals; sources never add together", () => {
  assert.deepEqual(radialStick(0.1, 0.1), [0, 0]);
  const [x, y] = radialStick(0.3, 0.4);
  assert.ok(Math.abs(Math.hypot(x, y) - (0.5 - 0.18) / 0.82) < 1e-10);
  assert.ok(Math.abs(x / y - 0.75) < 1e-10);
  const { input, pad, frame, claim } = setup();
  claim();
  pad.axes = [0.19, 0, 0, 0];
  assert.ok(
    frame().move[0] > 0 && frame().move[0] < 0.02,
    "just outside the dead zone still walks",
  );
  pad.axes = [0.5, 0, 0, 0];
  assert.ok(frame().move[0] > 0 && frame().move[0] < 0.5);
  input.keyDown("KeyD", false);
  assert.deepEqual(frame().move, [1, 0]);
  input.keyUp("KeyD");
  assert.deepEqual(frame().move, [0, 0], "old held stick cannot resume after keyboard release");
  pad.axes = [1, 1, 0, 0];
  assert.ok(Math.abs(Math.hypot(...frame().move) - 1) < 1e-10);
});
test("claim consumes its button; window changes require release and centered sticks", () => {
  const { input, pad, frame, claim } = setup();
  claim();
  pad.buttons.add("south");
  assert.deepEqual(frame().actions, ["dash"]);
  assert.deepEqual(frame().actions, []);
  input.cancel();
  assert.deepEqual(frame(0, "navigation").actions, []);
  pad.buttons.clear();
  pad.axes = [0.8, 0, 0, 0];
  assert.deepEqual(frame(0, "navigation").actions, []);
  pad.axes = [0, 0, 0, 0];
  frame(0, "navigation");
  pad.buttons.add("south");
  assert.deepEqual(frame(0, "navigation").actions, ["confirm"]);
  input.keyDown("Space", false);
  input.cancel();
  assert.equal(input.observeKey("Space", true), false);
  input.keyUp("Space");
  assert.equal(input.observeKey("Space", false), true);
  input.cancel();
  assert.equal(
    input.observeKey("Space", false),
    true,
    "a fresh press recovers a key released outside the window",
  );
});
test("navigation repeats with hysteresis and never catches up after a stalled frame", () => {
  const { pad, frame, claim } = setup();
  claim();
  pad.axes = [0.6, 0, 0, 0];
  assert.deepEqual(frame(0, "navigation").actions, ["right"]);
  pad.axes = [0.4, 0, 0, 0];
  assert.deepEqual(frame(200, "navigation").actions, []);
  assert.deepEqual(frame(300, "navigation").actions, ["right"]);
  assert.deepEqual(frame(5000, "navigation").actions, ["right"]);
  assert.deepEqual(frame(5010, "navigation").actions, []);
  pad.buttons.add("up");
  assert.deepEqual(frame(5020, "navigation").actions, ["up"]);
});
test("drift does not take mode, SDL short taps survive sampling, disconnect zeros movement", () => {
  const { input, pad, frame, claim, modes, disconnect } = setup();
  claim();
  const before = modes.length;
  pad.axes = [0.08, -0.1, 0.12, 0];
  frame();
  assert.equal(modes.length, before);
  pad.pressed = new Set(["north"]);
  assert.deepEqual(frame().actions, ["ult"]);
  pad.pressed.clear();
  assert.deepEqual(frame().actions, []);
  pad.axes = [1, 0, 0, 0];
  frame();
  disconnect();
  const result = frame();
  assert.equal(result.disconnected, true);
  assert.deepEqual(result.move, [0, 0]);
  assert.equal(input.activeToken, null);
});

test("navigation shoulders page without gameplay stats and right stick scroll stops on context change", () => {
  const { input, pad, frame, claim } = setup();
  claim();
  pad.buttons.add("lb");
  assert.deepEqual(frame(0, "navigation").actions, ["previousPage"]);
  pad.buttons.clear();
  pad.axes = [0, 0, 0, 0.8];
  assert.ok(frame(16, "navigation").scroll > 0);
  input.cancel();
  assert.equal(frame(32, "navigation").scroll, 0);
});

test("keyboard navigation retains reverse Tab, endpoints and page actions without claiming text", () => {
  assert.equal(navigationAction("Tab", false), "next");
  assert.equal(navigationAction("Tab", true), "previous");
  for (const [code, action] of Object.entries({
    Home: "first",
    End: "last",
    PageUp: "previousPage",
    PageDown: "nextPage",
    Enter: "confirm",
    NumpadEnter: "confirm",
    Space: "confirm",
    Escape: "cancel",
    KeyP: "resume",
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
  }))
    assert.equal(navigationAction(code, false), action);
  for (const code of ["Digit1", "KeyQ", "KeyE", "KeyR", "Backspace"])
    assert.equal(navigationAction(code, false), undefined);
});

test("co-op choice keeps held movement and skills while only the D-pad and RB select", () => {
  const { input, pad, frame, claim } = setup();
  claim();
  input.keyDown("KeyW", false);
  assert.deepEqual(frame().move, [0, -1]);
  assert.deepEqual(frame(16, "choice").move, [0, -1], "opening cards does not clear WASD");
  input.keyDown("Space", false);
  input.keyDown("KeyF", false);
  assert.deepEqual(frame(32, "choice").actions, ["dash", "ult"]);
  pad.axes = [0.8, 0, 0.7, 0];
  let result = frame(48, "choice");
  assert.ok(result.move[0] > 0 && result.turn > 0);
  assert.deepEqual(result.actions, [], "sticks move and turn without selecting cards");
  pad.buttons = new Set(["right", "rb", "south", "north"]);
  result = frame(64, "choice");
  assert.deepEqual(new Set(result.actions), new Set(["right", "choiceConfirm", "dash", "ult"]));
  assert.ok(result.move[0] > 0 && result.turn > 0);
  pad.buttons.clear();
  result = frame(80, "gameplay");
  assert.ok(result.move[0] > 0 && result.turn > 0, "closing cards preserves held sticks");
  assert.deepEqual(result.actions, [], "confirm cannot turn into a gameplay action after close");
});
