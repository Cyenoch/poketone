import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { checkPage, checkPagedFont, mergeFonts, unsupportedIn } from "../src/ui/gpu/fonts.ts";

const gpu = new URL("../public/fonts/gpu/", import.meta.url);
const WEIGHTS = ["ui-500", "ui-700", "ui-800"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readSet(folder, missing) {
  const manifestFile = new URL("manifest.json", folder);
  if (!existsSync(manifestFile)) assert.fail(missing);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const fonts = {};
  for (const [name, entry] of Object.entries(manifest))
    if (entry && typeof entry === "object" && "json" in entry) {
      const bytes = readFileSync(new URL(entry.json, folder));
      fonts[name] = { entry, bytes, font: JSON.parse(bytes.toString("utf8")) };
    }
  return { folder, manifest, fonts };
}

const core = () =>
  readSet(new URL("core/", gpu), "public/fonts/gpu/core/ is missing: run `bun run fonts:core`");
// Exactly the base set the core set was built against, never another one.
const base = () => {
  const key = core().manifest.base;
  return readSet(
    new URL(`base/${key}/`, gpu),
    `public/fonts/gpu/base/${key}/ is missing: run \`bun run fonts:base\` (generated, not committed; minutes on the first run)`,
  );
};

/** A lossless WebP's page size, from its VP8L header. */
function webpSize(bytes) {
  assert.equal(bytes.toString("ascii", 12, 16), "VP8L", "UI atlas pages are lossless WebP");
  const bits = bytes.readUInt32LE(21);
  return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
}

for (const set of [
  { label: "core", load: core },
  { label: "base", load: base },
])
  test(`${set.label}: every json and page is the content its manifest and json name`, () => {
    const { folder, fonts } = set.load();
    for (const [name, { entry, bytes, font }] of Object.entries(fonts)) {
      checkPagedFont(name, entry, font, sha256(bytes));
      font.pages.forEach((page, index) => {
        const data = readFileSync(new URL(page, folder));
        const [width, height] = webpSize(data);
        checkPage(name, font, index, sha256(data), width, height);
      });
    }
  });

test("base: the set is the one its key names", () => {
  assert.equal(base().manifest.key, core().manifest.base);
});

// The loader's contract: a json, page or manifest from another build is refused, not drawn,
// including a page of the right size with other content.
test("the paged loader refuses a mismatched json, page count or page", () => {
  const { folder, fonts } = core();
  const { entry, bytes, font } = fonts["ui-800"];
  const digest = sha256(bytes);
  const refuse = (check) => assert.throws(check, /UI 字体图集与清单不一致/);
  refuse(() => checkPagedFont("ui-800", entry, font, "0".repeat(64)));
  refuse(() => checkPagedFont("ui-800", { ...entry, glyphs: entry.glyphs + 1 }, font, digest));
  refuse(() => checkPagedFont("ui-800", { ...entry, pages: entry.pages + 1 }, font, digest));
  const outside = structuredClone(font);
  outside.glyphs[0][1] = outside.pages.length;
  refuse(() => checkPagedFont("ui-800", entry, outside, digest));
  const page0 = readFileSync(new URL(font.pages[0], folder));
  const [width, height] = webpSize(page0);
  refuse(() => checkPage("ui-800", font, 0, sha256(page0), width, height + 128));
  // Right size, other bytes (another weight's page 0): refused by content, not by size.
  const other = readFileSync(new URL(fonts["ui-500"].font.pages[0], folder));
  refuse(() => checkPage("ui-800", font, 0, sha256(other), width, height));
});

// The first screen waits only for chrome pages; damage numbers draw from page 0 alone.
test("core: ASCII is on page 0 of every UI weight", () => {
  const { fonts } = core();
  for (const name of WEIGHTS) {
    const pageOf = new Map(fonts[name].font.glyphs.map(([code, page]) => [code, page]));
    for (let code = 0x21; code < 0x7f; code++)
      assert.equal(pageOf.get(code), 0, `${name}: ${String.fromCharCode(code)}`);
  }
});

// A character draws at the same place whichever page it comes from, so layout does not depend on
// paging. (Core against the single-page atlases it replaces: identical for all 985 glyphs, max
// difference 7e-15 px, same line height and base — checked once at the switch, 2026-11-06.)
test("a character's metrics are identical in core and base pages", () => {
  const coreFonts = core().fonts,
    baseFonts = base().fonts;
  for (const name of WEIGHTS) {
    const c = coreFonts[name].font,
      b = baseFonts[name].font;
    assert.deepEqual([c.size, c.lineHeight, c.base], [b.size, b.lineHeight, b.base], name);
    const fromBase = new Map(b.glyphs.map((row) => [row[0], row]));
    const differ = [];
    let shared = 0;
    for (const row of c.glyphs) {
      const other = fromBase.get(row[0]);
      if (!other) continue;
      shared++;
      // width, height, xoffset, yoffset, xadvance (x, y and page are where it was packed).
      if ([4, 5, 6, 7, 8].some((i) => row[i] !== other[i]))
        differ.push(`${String.fromCodePoint(row[0])} ${row.slice(4)} ≠ ${other.slice(4)}`);
    }
    assert.ok(shared > 900, `${name}: only ${shared} characters in both sets`);
    assert.deepEqual(differ, [], name);
  }
});

// Core wins: what the game writes (ASCII, digits, menu text, 「闪避」) never routes to a base page.
test("merging keeps every core character on its core page and moves base pages after core", () => {
  for (const name of WEIGHTS) {
    const c = core().fonts[name].font,
      b = base().fonts[name].font;
    const merged = mergeFonts(c, b);
    assert.equal(merged.pages.length, c.pages.length + b.pages.length);
    for (const row of c.glyphs) assert.deepEqual(merged.glyphs.get(row[0]), row);
    for (const char of "闪避0123456789出发")
      assert.ok(merged.glyphs.get(char.codePointAt(0))[1] < c.pages.length, `${name}: ${char}`);
    const onlyBase = b.glyphs.find(([code]) => !c.glyphs.some((row) => row[0] === code));
    assert.equal(merged.glyphs.get(onlyBase[0])[1], onlyBase[1] + c.pages.length);
  }
});

const drawable = (name) =>
  new Set(mergeFonts(core().fonts[name].font, base().fonts[name].font).glyphs.keys());

// Names that appear nowhere in game text: Simplified, Traditional, Japanese, Latin-1, mixed.
const NAMES = [
  "张伟",
  "王芳",
  "李喆",
  "刘堃",
  "陳龍",
  "黃淑芬",
  "鄭成功",
  "佐藤ひかり",
  "高橋健太",
  "渡辺ゆい",
  "ヨシダ・タロウ",
  "髙﨑翔",
  "Zoë",
  "François",
  "José Muñoz",
  "Ånge Østergård",
  "陳龍ひかりZoë",
  "小明_2026！",
  "ＮＡＭＥ（全角）",
  "ﾊﾝｶｸ",
  "①★♪→",
];

test("mixed Simplified / Traditional / Japanese / Latin names draw at every UI weight", () => {
  for (const name of WEIGHTS)
    assert.deepEqual(
      NAMES.flatMap((text) => unsupportedIn(text, drawable(name))),
      [],
      `${name}: name characters outside the charset`,
    );
});

// Outside the charset (provisional scope: Latin Extended-A deferred, CJK Extension A/B+, emoji):
// the boundary reports them, in order, and the original text is not altered.
test("characters outside the charset are reported, not dropped", () => {
  const set = drawable("ui-500");
  const text = "Łukasz 𠮷野家 㐀 😀 Čapek";
  assert.deepEqual(unsupportedIn(text, set), ["Ł", "𠮷", "㐀", "😀", "Č"]);
  assert.equal(text, "Łukasz 𠮷野家 㐀 😀 Čapek");
});
