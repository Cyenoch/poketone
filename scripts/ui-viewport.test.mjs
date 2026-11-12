import assert from "node:assert/strict";
import test from "node:test";
import { fitScale, uiViewport } from "../src/ui/gpu/viewport.ts";
import { parseSettings } from "../src/settings.ts";

test("UI magnification reduces layout space without scaling safe-area pixels twice", () => {
  const view = uiViewport(844, 390, 1.5, { left: 44, right: 44, top: 0, bottom: 21 });
  assert.equal(view.width, 844 / 1.5);
  assert.equal(view.height, 260);
  assert.equal(view.safeArea.left * view.scale, 44);
  assert.equal(view.safeArea.bottom * view.scale, 21);
  assert.ok(view.minTarget * view.scale >= 44);
  assert.ok(uiViewport(844, 390, 0.8).minTarget * 0.8 >= 44);
});

test("import requires a valid UI scale so corrupt values cannot hide the interface", () => {
  const settings = { sound: true, devMode: false, uiScale: 1.5 };
  assert.equal(parseSettings(settings).uiScale, 1.5);
  for (const uiScale of [undefined, 0, -1, Infinity, NaN, "1.2", null, 100]) {
    assert.throws(() => parseSettings({ ...settings, uiScale }), /界面缩放无效/);
  }
});

test("shared fitting reserves vertical room on short wide screens and preserves touch targets", () => {
  const insets = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const [width, height] of [
    [932, 430],
    [844, 390],
    [667, 375],
  ]) {
    const scale = fitScale(1, width, height, insets, { width: 760, height: 360 });
    const view = uiViewport(width, height, scale, insets);
    assert.ok(view.height >= 460);
    assert.ok(view.width >= 760);
    assert.ok(view.minTarget * scale >= 44);
  }
  assert.equal(fitScale(1, 1280, 800, insets, { width: 760, height: 360 }), 1);
});
