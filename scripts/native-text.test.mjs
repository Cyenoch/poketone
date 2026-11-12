import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { NativeUiSurface } from "../src/platform/native/ui-surface.ts";
import { TextBuffer } from "../src/ui/text-buffer.ts";
import sdl from "@kmamal/sdl";

function setup() {
  const window = Object.assign(new EventEmitter(), {
    native: { handle: Buffer.alloc(8) },
    width: 800,
    height: 600,
    focus() {},
  });
  const surface = new NativeUiSurface({ window }, new URL("../public/", import.meta.url));
  const forwarded = [],
    errors = [],
    focus = [],
    leaves = [];
  let closed = 0;
  const stop = surface.listen({
    down: () => false,
    move() {},
    up() {},
    cancel() {},
    leave() {},
    keyDown: (key) => {
      forwarded.push(key);
      return true;
    },
    keyUp() {},
    wheel: () => false,
    cancelInput() {},
    blur() {},
    displayChanged() {},
  });
  const buffer = new TextBuffer("abc");
  const input = surface.text.createInput(buffer, {
    focus: (value) => focus.push(value),
    leave: (backward) => {
      leaves.push(backward);
      input.blur();
    },
    close: () => {
      closed++;
      input.blur();
    },
    error: (error) => errors.push(error.message),
  });
  const key = (name, modifiers = {}) =>
    window.emit("keyDown", {
      type: "keyDown",
      scancode: sdl.keyboard.SCANCODE[name],
      key: name.toLowerCase(),
      ...modifiers,
    });
  return {
    window,
    surface,
    buffer,
    input,
    forwarded,
    errors,
    focus,
    leaves,
    key,
    closed: () => closed,
    dispose() {
      input.dispose();
      stop();
      surface.text.dispose();
    },
  };
}

test("SDL editing owns committed text, selection, Tab/Escape and yields keys after blur", () => {
  const s = setup();
  try {
    s.input.focus();
    s.key("A", { super: 1 });
    s.window.emit("textInput", { text: "存档😀" });
    assert.equal(s.buffer.text, "存档😀");
    s.key("LEFT", { shift: 1 });
    assert.equal(s.buffer.text.slice(s.buffer.start, s.buffer.end), "😀");
    s.key("BACKSPACE");
    assert.equal(s.buffer.text, "存档");
    s.key("HOME");
    s.key("DELETE");
    assert.equal(s.buffer.text, "档");
    assert.equal(s.forwarded.length, 0);
    s.key("TAB", { shift: 1 });
    assert.deepEqual(s.leaves, [true]);
    s.key("RIGHT");
    assert.equal(s.forwarded.at(-1).key, "ArrowRight");
    s.input.focus();
    s.key("ESCAPE");
    assert.equal(s.closed(), 1);
    s.window.emit("textInput", { text: "ignored" });
    assert.equal(s.buffer.text, "档");
    assert.deepEqual(s.focus, [true, false, true, false]);
  } finally {
    s.dispose();
  }
});

test("native cut failure preserves selection and paste precedes the next SDL text event", () => {
  const s = setup();
  try {
    s.input.focus();
    s.key("A", { ctrl: 1 });
    s.surface.text.writeClipboard = () => {
      throw new Error("clipboard refused");
    };
    s.key("X", { ctrl: 1 });
    assert.equal(s.buffer.text, "abc");
    assert.deepEqual([s.buffer.start, s.buffer.end], [0, 3]);
    assert.deepEqual(s.errors, ["clipboard refused"]);
    s.surface.text.readClipboard = () => "paste";
    s.key("V", { ctrl: 1 });
    s.window.emit("textInput", { text: "new" });
    assert.equal(s.buffer.text, "pastenew");
  } finally {
    s.dispose();
  }
});
