import assert from "node:assert/strict";
import test from "node:test";
import { WeatherChip } from "../src/run/view/weatherChip.ts";

test("the weather bar drains over that weather's own length, cast or field", () => {
  const chip = new WeatherChip();
  const fill = (remaining, seconds) => {
    chip.set({ id: "sun", phase: "active", remaining, seconds }, false);
    return chip.bar.uniforms.hudFill.value;
  };
  assert.equal(fill(30, 30), 1, "a fresh 30 s cast starts full");
  assert.equal(fill(24, 48), 0.5, "a rock-extended cast halves at half time");
  assert.equal(fill(75, 75), 1, "field weather starts full");
});
