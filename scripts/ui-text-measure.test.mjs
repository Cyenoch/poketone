import assert from "node:assert/strict";
import test from "node:test";
import { roundMeasurement } from "@pmndrs/uikit/dist/flex/node.js";

// Yoga's MeasureMode (yoga-layout is uikit's dependency, not ours).
const MeasureMode = { Undefined: 0, Exactly: 1, AtMost: 2 };

// The uikit patch: a text box must not outgrow the width it was laid out in, or snapping its edges
// to the device grid can push it a pixel past its parent and the parent turns scrollable.
test("rounding a text measurement up never passes its constraint", () => {
  // The result window's meta line: one line filling its 467.5-wide column.
  assert.equal(roundMeasurement(467.4999, 467.5, MeasureMode.AtMost), 467.5);
  assert.equal(roundMeasurement(467.4999, 467.5, MeasureMode.Exactly), 467.5);
});

test("an unbreakable word wider than its constraint keeps its own width", () => {
  assert.equal(roundMeasurement(480.25, 467.5, MeasureMode.AtMost), 480.25);
});

test("unconstrained text still rounds up, so it never wraps for want of a sliver", () => {
  assert.equal(roundMeasurement(120.001, 0, MeasureMode.Undefined), 120.01);
});
