import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Texture } from "three";
import { GpuSaveDialog } from "../src/ui/gpu/save-dialog.ts";
import { setGlyphInputMode } from "../src/ui/gpu/input-glyph.ts";
import { installRuntime } from "../src/platform/runtime.ts";

installRuntime({ createAudioDecoder: () => ({}), activateAudio() {} });

const fontsRoot = new URL("../public/fonts/gpu/core/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", fontsRoot), "utf8"));
const paged = JSON.parse(readFileSync(new URL(manifest["ui-500"].json, fontsRoot), "utf8"));
const info = {
  pages: [],
  pageTextures: paged.pages.map(() => new Texture()),
  pageSizes: paged.pageSizes,
  chars: paged.glyphs.map(([id, page, x, y, width, height, xoffset, yoffset, xadvance]) => ({
    id,
    char: String.fromCodePoint(id),
    page,
    x,
    y,
    width,
    height,
    xoffset,
    yoffset,
    xadvance,
  })),
  info: { size: paged.size },
  common: { lineHeight: paged.lineHeight },
  distanceField: { distanceRange: paged.distanceRange },
  kernings: [],
};
const fonts = { "Poketone UI": { 500: info, 700: info, 800: info } };

function setup() {
  let events,
    focused = false,
    closed = 0,
    disposed = false;
  const loads = [],
    notes = [];
  const service = {
    createInput(_buffer, callbacks) {
      events = callbacks;
      return {
        focus() {
          if (!focused) {
            focused = true;
            events.focus(true);
          }
        },
        blur() {
          if (focused) {
            focused = false;
            events.focus(false);
          }
        },
        dispose() {
          disposed = true;
        },
      };
    },
    readClipboard: async () => "paste",
    writeClipboard: async () => {
      throw new Error("refused");
    },
    openFile: async () => "opened",
    saveFile: async () => true,
  };
  const dialog = new GpuSaveDialog(
    fonts,
    { text: "initial", error: "" },
    {
      notify: (message) => notes.push(message),
      load: (text) => loads.push(text),
      closed: () => closed++,
    },
    service,
  );
  return {
    dialog,
    service,
    loads,
    notes,
    events,
    focused: () => focused,
    closed: () => closed,
    disposed: () => disposed,
  };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("shared save editor hands Tab/Escape focus back and selects text after refused copy", async () => {
  const s = setup();
  try {
    s.dialog.focus(1);
    assert.equal(s.focused(), true);
    assert.deepEqual([s.dialog.buffer.start, s.dialog.buffer.end], [0, 7]);
    s.events.leave(false);
    assert.equal(s.focused(), false);
    s.dialog.navigate("confirm"); // Open file; next item after the editor.
    await flush();
    assert.equal(s.dialog.buffer.text, "opened");
    s.dialog.activate(5); // Copy.
    await flush();
    assert.equal(s.focused(), true);
    assert.deepEqual([s.dialog.buffer.start, s.dialog.buffer.end], [0, 6]);
    assert.match(s.dialog.status.properties.value.text, /复制失败/);
    s.events.close();
    s.dialog.afterLayout(220);
    assert.equal(s.closed(), 1);
  } finally {
    s.dialog.dispose();
  }
  assert.equal(s.disposed(), true);
});

test("gamepad edits the same buffer through the GPU keyboard then imports once", async () => {
  const s = setup();
  setGlyphInputMode({ kind: "gamepad", family: "generic" });
  try {
    s.dialog.buffer.select(0, s.dialog.buffer.text.length);
    s.dialog.activate(1); // Activating the well opens the GPU keyboard.
    s.dialog.navigate("confirm"); // First key, A, replaces the selected export.
    assert.equal(s.dialog.buffer.text, "A");
    assert.equal(s.focused(), false);
    s.dialog.navigate("cancel"); // Keyboard closes before the window.
    assert.equal(s.closed(), 0);
    s.dialog.activate(6); // Import.
    await flush();
    assert.deepEqual(s.loads, ["A"]);
    s.dialog.activate(6);
    assert.deepEqual(s.loads, ["A"]);
  } finally {
    s.dialog.dispose();
    setGlyphInputMode({ kind: "keyboardMouse", pointer: false });
  }
});

test("native GPU well uses glyph positions for pointer selection and follows the edited caret", async () => {
  const s = setup();
  try {
    s.dialog.resize(1280, 800, 1, { top: 0, right: 0, bottom: 0, left: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (let i = 0; i < 20; i++) {
      s.dialog.stage.update(16);
      s.dialog.afterLayout(16);
    }
    const { getCaretTransformation } = await import("@pmndrs/uikit/dist/text/layout/query.js");
    const { Vector3 } = await import("three");
    const text = s.dialog.codePreview;
    assert.ok(text.textLayout.value, "the shared GPU text has a measured font layout");
    const point = (index) => {
      const caret = getCaretTransformation(text.textLayout.value, index);
      const world = new Vector3(...caret.position, 0).applyMatrix4(text.globalTextMatrix.value);
      return [world.x - s.dialog.stage.camera.left, s.dialog.stage.camera.top - world.y];
    };
    s.dialog.pointerDown(...point(1));
    s.dialog.pointerMove(...point(4));
    assert.equal(s.dialog.pointerUp(), true);
    assert.deepEqual([s.dialog.buffer.start, s.dialog.buffer.end], [1, 4]);
    s.dialog.buffer.replace("changed");
    s.dialog.stage.update(16);
    s.dialog.afterLayout(16);
    assert.equal(s.dialog.buffer.text, "ichangedial");
    assert.equal(s.dialog.caret.properties.value.display, "flex");
  } finally {
    s.dialog.dispose();
  }
});
