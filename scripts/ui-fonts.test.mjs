import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { displayText, sourceTexts } from "./fonts/source-text.mjs";

// The committed core set: the game's own text (docs/fonts-paging-design.md).
const core = new URL("../public/fonts/gpu/core/", import.meta.url);
const coreManifest = JSON.parse(readFileSync(new URL("manifest.json", core), "utf8"));
const coreFont = (name) => JSON.parse(readFileSync(new URL(coreManifest[name].json, core), "utf8"));
const coreGlyphs = (name) =>
  new Set(coreFont(name).glyphs.map(([code]) => String.fromCodePoint(code)));

test("the core atlases are built from the committed source fonts", () => {
  for (const name of ["ui-500", "ui-700", "ui-800", "display"]) {
    const font = coreManifest[name];
    const source = readFileSync(new URL(`../${font.source}`, import.meta.url));
    assert.equal(
      createHash("sha256").update(source).digest("hex"),
      font.sourceSha256,
      `${name}: rerun bun run fonts:core after changing source font shapes or metrics`,
    );
  }
});

test("every character the UI source can display is in each UI atlas", () => {
  // The GPU UI has no font fallback: a character missing from the atlas is simply not drawn.
  // Displayable = string literals, template text and JSX text, escapes decoded; never comments.
  const text = new Set(
    sourceTexts()
      .map(({ text }) => text)
      .join(""),
  );
  for (const weight of [500, 700, 800]) {
    const name = `ui-${weight}`;
    const glyphs = coreGlyphs(name);
    const missing = [...text].filter(
      (char) => char.trim() && !glyphs.has(char) && !coreManifest[name].unavailable.includes(char),
    );
    assert.deepEqual(
      missing,
      [],
      `${name}: rerun bun run fonts:core after changing UI text (or the source font lacks these: use another character)`,
    );
  }
});

// The extraction both the font build and these tests use (scripts/fonts/source-text.mjs).
test("source text extraction keeps displayable text and drops comments", () => {
  const sample = [
    'const a = "牌 // 仍是字符串"; // 缎 注释',
    '/* 程 */ const r = /"[板]/g; const d = x / 2 / "除";',
    'const e = "\\u4E09"; const t = `头${ `内${ { k: "套" }.k }尾` }外`;',
    'const j = <div title="属">文本{"表达"}<b>粗{/* 罕 */}</b><br /></div>;',
  ].join("\n");
  const text = displayText(sample, true).join("");
  for (const char of "牌仍是字符串除三头内套尾外属文本表达粗") assert.ok(text.includes(char), char);
  for (const char of "缎注释程板罕") assert.ok(!text.includes(char), char);
  // In the real tree: 牌 is displayed (招牌招式), 缎 only appears in a comment.
  const tree = sourceTexts()
    .map(({ text: shown }) => shown)
    .join("");
  assert.ok(tree.includes("牌") && !tree.includes("缎"));
});

const atlasGlyphs = () =>
  ["ui-500", "ui-700", "ui-800"].map((name) => ({ name, glyphs: coreGlyphs(name) }));

test("text the UI formats at runtime draws from the atlases", async () => {
  const { amountText, formatStat } = await import("../src/ui/gpu/run-overlays-stats.ts");
  const { formatTime } = await import("../src/run/labels.ts");
  const samples = [
    amountText("pct", { op: "add", amount: -0.135 }),
    amountText("pct", { op: "mul", amount: 0.87 }),
    amountText("pct", { op: "div", amount: 1.25 }),
    amountText("dec", { op: "add", amount: -2.5 }),
    amountText("int", { op: "extra", amount: 16 }),
    formatStat("pct", -0.5),
    formatStat("dec", -3.25),
    formatTime(0),
    formatTime(3599.9),
    new Intl.NumberFormat("zh-CN").format(-1234567.891),
    new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 21 }).format(98765432),
    Math.round(-123456).toLocaleString("zh-CN"),
  ];
  for (const { name, glyphs } of atlasGlyphs()) {
    const missing = [...new Set(samples.join(""))].filter(
      (char) => !/\s/.test(char) && !glyphs.has(char),
    );
    assert.deepEqual(missing, [], `${name}: ${samples.join(" ")}`);
  }
});

// A character the font lacks draws uikit's box and the UI goes on; development names it once with
// its code point and font, so it can be found and added to the atlas.
test("a missing glyph is named once, with its code point, and still returns a glyph", async () => {
  // Through the package entry first: font.js alone hits a circular module initialisation.
  await import("@pmndrs/uikit");
  const { Font } = await import("@pmndrs/uikit/dist/text/font.js");
  const { Texture } = await import("three");
  const { logMissingGlyphs } = await import("../src/ui/gpu/fonts.ts");
  // uikit's description of the core ui-500 font over its stable pages (as fonts.ts builds it).
  const paged = coreFont("ui-500");
  const info = {
    pages: [],
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
  const font = new Font(
    info,
    paged.pages.map(() => new Texture()),
  );
  const messages = [];
  logMissingGlyphs(font, "ui-500", (message) => messages.push(message));
  const logged = console.error;
  console.error = () => {};
  let box;
  try {
    font.getGlyphInfo("共");
    font.getGlyphInfo("𠮷");
    box = font.getGlyphInfo("𠮷");
  } finally {
    console.error = logged;
  }
  assert.equal(messages.length, 1);
  assert.match(messages[0], /「𠮷」U\+20BB7（ui-500）/);
  assert.equal(box.id, -1, "the missing glyph still lays out as uikit's box");
});

// Layout draws the space (and a line break with it); msdf-atlas-gen only emits it when the charset
// names it. Every published UI font json, in every set, must carry U+0020.
test("every published UI font has the space glyph", () => {
  const gpu = new URL("../public/fonts/gpu/", import.meta.url);
  const read = (url) => JSON.parse(readFileSync(url, "utf8"));
  const base = new URL(`base/${coreManifest.base}/`, gpu);
  const files = [
    [coreManifest, core],
    [read(new URL("manifest.json", base)), base],
  ].flatMap(([manifest, folder]) =>
    ["ui-500", "ui-700", "ui-800"].map((name) => new URL(manifest[name].json, folder)),
  );
  for (const file of files)
    assert.ok(
      read(file).glyphs.some(([code]) => code === 0x20),
      `${file}`,
    );
});
