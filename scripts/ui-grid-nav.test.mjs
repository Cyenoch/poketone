import assert from "node:assert/strict";
import test from "node:test";
import { gridStep } from "../src/ui/gpu/grid-nav.ts";

// A laid-out control: its centre (y down) and size, as UIKit's layout reports them (y up).
const box = (x, y, w, h) => ({
  relativeCenter: { value: [x, -y] },
  parentContainer: { value: undefined },
  size: { value: [w, h] },
});

test("a row of small items above two wide buttons: arrows follow the layout", () => {
  // Result window: three backpack items on top, 再来一局 and 换宝可梦 below.
  const panels = [box(40, 20, 30, 30), box(80, 20, 30, 30), box(120, 20, 30, 30)];
  panels.push(box(90, 80, 140, 44), box(250, 80, 140, 44));
  const [again, swap] = [3, 4];
  assert.equal(gridStep(panels, again, "right"), swap);
  assert.equal(gridStep(panels, swap, "left"), again);
  assert.equal(gridStep(panels, again, "up"), 1, "up lands on the item over the button");
  assert.equal(gridStep(panels, 0, "down"), again);
  assert.equal(gridStep(panels, 2, "right"), 0, "past the row's end it wraps to its start");
  assert.equal(gridStep(panels, swap, "right"), again);
});

test("an even grid moves by rows and columns and wraps within them", () => {
  const panels = [];
  for (let row = 0; row < 2; row++)
    for (let column = 0; column < 3; column++) panels.push(box(column * 100, row * 60, 90, 50));
  assert.equal(gridStep(panels, 0, "right"), 1);
  assert.equal(gridStep(panels, 2, "right"), 0);
  assert.equal(gridStep(panels, 1, "down"), 4);
  assert.equal(gridStep(panels, 4, "down"), 1);
});

test("navigation reads the resting layout, not a focused key's lift", () => {
  // 3 backpack items over 再来一局 only; 换宝可梦 has nothing above or below it.
  const panels = [box(40, 20, 30, 30), box(80, 20, 30, 30), box(120, 20, 30, 30)];
  panels.push(box(90, 80, 140, 44), box(250, 80, 140, 44));
  // The focused 换宝可梦 drawn 1px higher (hover lift) does not move its layout box.
  panels[4].globalMatrix = {
    value: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 250, -79, 0, 1] },
  };
  assert.equal(gridStep(panels, 3, "down"), 1, "past the bottom: the top of its column");
});

test("past the end, a control alone in its column wraps round like one in a column", () => {
  // Result window: ↓ from 再来一局 wraps to the item over it; ↓ from 换宝可梦 (nothing above or
  // below it) wraps to the top row too, to the item nearest across.
  const panels = [box(40, 20, 30, 30), box(80, 20, 30, 30), box(120, 20, 30, 30)];
  panels.push(box(90, 80, 140, 44), box(250, 80, 140, 44));
  assert.equal(gridStep(panels, 3, "down"), 1);
  assert.equal(gridStep(panels, 4, "down"), 2);
  assert.equal(gridStep(panels, 2, "up"), 3, "and back up: the button under the item");
});

test("a sliver of overlap does not make a column", () => {
  // 667×375: a backpack item's touch box reaches 1.2 units past 换宝可梦's left edge. Were that a
  // column, ↑ would go to that far item rather than to the nearer one up and to the right.
  const panels = [
    box(119.4, 88.3, 228.2, 52.2),
    box(-19.6, -100, 52.2, 52.2),
    box(300, 40, 52, 30),
  ];
  assert.equal(gridStep(panels, 0, "up"), 2);
});

test("vertical boundaries reach the action row instead of wrapping inside a tile column", () => {
  const panels = [box(20, 20, 30, 30), box(20, 70, 30, 30), box(90, 120, 60, 44)];
  assert.equal(gridStep(panels, 1, "down"), 2);
  assert.equal(gridStep(panels, 2, "up"), 1);
});
