import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Texture } from "three";
import { GpuSaveDialog } from "../src/ui/gpu/save-dialog.ts";
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

function setup({ code = "initial", error = "", clipboard = async () => "paste" } = {}) {
  let closed = 0;
  const loads = [],
    notes = [],
    copies = [];
  const service = {
    createInput() {
      throw new Error("the save window takes no typed text");
    },
    readClipboard: clipboard,
    writeClipboard: async (text) => {
      copies.push(text);
      throw new Error("refused");
    },
    openFile: async () => null,
    saveFile: async () => true,
  };
  const dialog = new GpuSaveDialog(
    fonts,
    { text: code, error },
    {
      notify: (message) => notes.push(message),
      load: (text) => {
        if (text !== "good") throw new Error("不是存档文本。");
        loads.push(text);
      },
      closed: () => closed++,
    },
    service,
  );
  const settle = () => {
    // The owner unmounts on the first `closed`.
    for (let i = 0; i < 20 && closed === 0; i++) dialog.afterLayout(16);
  };
  return { dialog, loads, notes, copies, closed: () => closed, settle };
}
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
const status = (dialog) =>
  dialog.status.properties.value.display === "none" ? "" : dialog.status.properties.value.text;
// Tab order: close, 复制存档, 保存文件, 粘贴导入, 打开文件.
const COPY = 1,
  SAVE = 2,
  PASTE = 3,
  OPEN = 4;

test("a bad paste stays in the window with the reason; a good one imports once and closes", async () => {
  let clip = "junk";
  const s = setup({ clipboard: async () => clip });
  try {
    s.dialog.activate(PASTE);
    await flush();
    s.settle();
    assert.deepEqual(s.loads, []);
    assert.equal(s.closed(), 0);
    assert.equal(status(s.dialog), "导入失败：不是存档文本。");
    clip = "good";
    s.dialog.activate(PASTE);
    s.dialog.activate(PASTE); // A second press while the first read is pending does nothing.
    await flush();
    s.settle();
    assert.deepEqual(s.loads, ["good"]);
    assert.equal(s.closed(), 1);
  } finally {
    s.dialog.dispose();
  }
});

test("clipboard and file failures name the step; a cancelled file pick changes nothing", async () => {
  const s = setup({
    clipboard: async () => {
      throw new Error("denied");
    },
  });
  try {
    s.dialog.activate(PASTE);
    await flush();
    assert.equal(status(s.dialog), "粘贴失败：denied");
    s.dialog.activate(OPEN);
    await flush();
    assert.equal(status(s.dialog), "粘贴失败：denied");
    s.dialog.activate(COPY);
    await flush();
    assert.deepEqual(s.copies, ["initial"]);
    assert.equal(status(s.dialog), "复制失败：refused");
    s.dialog.activate(SAVE);
    await flush();
    assert.deepEqual(s.notes, ["存档已导出"]);
    assert.equal(status(s.dialog), "");
    assert.equal(s.closed(), 0);
  } finally {
    s.dialog.dispose();
  }
});

test("locked progress offers only import, by key and by pointer", async () => {
  const s = setup({ code: "", error: "进度无法读取" });
  try {
    assert.equal(status(s.dialog), "进度无法读取");
    s.dialog.navigate("confirm"); // First focus skips the empty export to 粘贴导入.
    s.dialog.activate(COPY);
    s.dialog.activate(SAVE);
    await flush();
    assert.deepEqual(s.copies, []);
    assert.deepEqual(s.notes, []);
    assert.equal(status(s.dialog), "导入失败：不是存档文本。");
    s.dialog.navigate("cancel");
    s.settle();
    assert.equal(s.closed(), 1);
  } finally {
    s.dialog.dispose();
  }
});
