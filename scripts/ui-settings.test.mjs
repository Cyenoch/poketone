import assert from "node:assert/strict";
import test from "node:test";
import { SettingsDialog } from "../src/ui/gpu/settings-dialog.ts";

test("settings navigation updates each preference and reaches save after the scale controls", () => {
  // Input behavior only: fonts remain pending and no renderer or device is created.
  const pending = () => new Promise(() => {});
  const fonts = { "Poketone UI": { 500: pending, 700: pending, 800: pending } };
  const initial = {
    sound: true,
    devMode: false,
    uiScale: 1,
    pauseOnBlur: true,
    autoOpenCards: true,
  };
  const changes = [];
  let saves = 0;
  const dialog = new SettingsDialog(fonts, {
    settings: initial,
    solo: true,
    onChange: (next) => changes.push(next),
    onClose() {},
    onSave: () => saves++,
  });
  try {
    dialog.navigate("first");
    dialog.navigate("down");
    dialog.navigate("left");
    assert.deepEqual(changes.at(-1), { ...initial, sound: false });
    dialog.navigate("down");
    dialog.navigate("confirm");
    assert.deepEqual(changes.at(-1), { ...initial, sound: false, devMode: true });
    dialog.navigate("down");
    dialog.navigate("confirm");
    assert.equal(changes.at(-1).pauseOnBlur, false);
    dialog.navigate("down");
    dialog.navigate("confirm");
    assert.equal(changes.at(-1).autoOpenCards, false);
    dialog.navigate("down");
    dialog.navigate("confirm");
    assert.equal(changes.at(-1).uiScale, 0.9);
    dialog.navigate("down");
    dialog.navigate("confirm");
    assert.equal(changes.at(-1).uiScale, 1);
    dialog.navigate("down");
    dialog.navigate("confirm");
    assert.equal(changes.at(-1).uiScale, 1.1);
    dialog.navigate("down");
    dialog.navigate("confirm");
    assert.equal(saves, 1);
    assert.deepEqual(changes[0], { ...initial, sound: false });
    assert.equal(initial.pauseOnBlur && initial.autoOpenCards, true, "the input is not mutated");
  } finally {
    dialog.dispose();
  }
});

test("the card-timing preference is offered only outside co-op", () => {
  const pending = () => new Promise(() => {});
  const fonts = { "Poketone UI": { 500: pending, 700: pending, 800: pending } };
  const settings = {
    sound: true,
    devMode: false,
    uiScale: 1,
    pauseOnBlur: true,
    autoOpenCards: true,
  };
  const changes = [];
  const dialog = new SettingsDialog(fonts, {
    settings,
    solo: false,
    onChange: (next) => changes.push(next),
    onClose() {},
  });
  try {
    for (let i = 0; i < 3; i++) dialog.navigate("down");
    dialog.navigate("down");
    dialog.navigate("confirm");
    assert.equal(changes.at(-1).uiScale, 0.9, "after 失去焦点时暂停 comes the scale");
  } finally {
    dialog.dispose();
  }
});
