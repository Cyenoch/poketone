import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import sdl from "@kmamal/sdl";
import { NativeUiSurface } from "../src/platform/native/ui-surface.ts";
import { navigationAction } from "../src/platform/input.ts";
import { TextBuffer } from "../src/ui/text-buffer.ts";

test("SDL paging and keypad confirmation reach shared navigation; dev key keeps its physical code", () => {
  const window = Object.assign(new EventEmitter(), {
    native: { handle: Buffer.alloc(8) },
    width: 1280,
    height: 800,
    focus() {},
  });
  const surface = new NativeUiSurface({ window }, new URL("../public/", import.meta.url));
  const actions = [],
    downs = [],
    ups = [];
  const stop = surface.listen({
    down: () => false,
    move() {},
    up() {},
    cancel() {},
    leave() {},
    keyDown(event) {
      downs.push(event);
      actions.push(navigationAction(event.code, event.shift));
      return true;
    },
    keyUp: (event) => ups.push(event.code),
    wheel: () => false,
    cancelInput() {},
    blur() {},
    displayChanged() {},
  });
  const press = (name) => {
    const event = { scancode: sdl.keyboard.SCANCODE[name], key: name.toLowerCase() };
    window.emit("keyDown", { ...event, type: "keyDown" });
    window.emit("keyUp", { ...event, type: "keyUp" });
  };
  try {
    for (const name of ["PAGEUP", "PAGEDOWN", "KP_ENTER", "GRAVE"]) press(name);
    assert.deepEqual(actions, ["previousPage", "nextPage", "confirm", undefined]);
    assert.deepEqual(ups, ["PageUp", "PageDown", "NumpadEnter", "Backquote"]);
    assert.deepEqual(
      downs.map((event) => event.code),
      ups,
    );
    assert.equal(downs[2].key, "Enter", "keypad Enter has the same text meaning as Return");
    const buffer = new TextBuffer("");
    const input = surface.text.createInput(buffer, {
      focus() {},
      leave() {},
      close() {},
      error: (error) => {
        throw error;
      },
    });
    input.focus();
    press("KP_ENTER");
    assert.equal(buffer.text, "\n", "text editing consumes keypad Enter before shared navigation");
    assert.equal(actions.length, 4);
    assert.equal(ups.length, 4, "editing does not leak a key-up to gameplay");
    input.dispose();
  } finally {
    stop();
    surface.dispose();
  }
});
