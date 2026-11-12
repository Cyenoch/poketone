import assert from "node:assert/strict";
import test from "node:test";
import { SettingsDialog } from "../src/ui/gpu/settings-dialog.ts";

test("settings navigation updates each preference and reaches save after the scale controls", () => {
  // Input behavior only: fonts remain pending and no renderer or device is created.
  const pending = () => new Promise(() => {});
  const fonts = { "Poketone UI": { 500: pending, 700: pending, 800: pending } };
  const initial = { sound: true, devMode: false, uiScale: 1 };
  const changes = [];
  let saves = 0;
  const dialog = new SettingsDialog(fonts, {
    settings: initial,
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
    assert.deepEqual(initial, { sound: true, devMode: false, uiScale: 1 });
  } finally {
    dialog.dispose();
  }
});
