import assert from "node:assert/strict";
import test from "node:test";
import { autoScale, fitScale, uiViewport } from "../src/ui/gpu/viewport.ts";
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

test("large screens grow the UI from the 1280×800 reference; phones and the reference keep the user's scale", () => {
  const none = { left: 0, right: 0, top: 0, bottom: 0 };
  const layout = { width: 760, height: 360 };
  for (const user of [0.8, 1, 1.5]) assert.equal(fitScale(user, 1280, 800, none, layout), user);
  for (const [width, height] of [
    [1280, 800],
    [844, 390],
    [932, 430],
    [1024, 768],
  ])
    assert.equal(autoScale(width, height, none), 1, `${width}×${height} does not grow`);
  assert.equal(fitScale(1, 844, 390, none, layout), Math.floor((390 / 460) * 64) / 64);
  // The logical layout of a large window matches the reference's, so nothing shrinks beside 3D art.
  for (const [width, height] of [
    [1920, 1080],
    [2000, 1118],
    [2560, 1440],
  ]) {
    const scale = fitScale(1, width, height, none, layout);
    assert.ok(scale > 1, `${width}×${height} grows`);
    assert.equal(scale, Math.floor(Math.min(width / 1280, height / 800) * 64) / 64);
    const view = uiViewport(width, height, scale, none);
    assert.ok(view.width >= 1280 && view.height >= 800 && view.height < 800 + 64 / scale);
    assert.ok(view.minTarget * scale >= 44);
    // The user's scale multiplies the automatic one.
    assert.ok(fitScale(1.2, width, height, none, layout) > scale);
  }
  // Measured on the safe area: insets eat into the growth.
  assert.ok(
    autoScale(2560, 1440, { left: 400, right: 400, top: 0, bottom: 0 }) <
      autoScale(2560, 1440, none),
  );
});
