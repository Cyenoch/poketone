import assert from "node:assert/strict";
import test from "node:test";
import { balanceLines, breakLines } from "../src/ui/gpu/line-break.ts";

// CJK full width, everything else half width: close to the UI font.
const font = { getGlyphInfo: (char) => ({ xadvance: /[　-鿿＀-￯]/.test(char) ? 1 : 0.55 }) };

test("card lines break between CJK characters but never inside a signed number or its unit", () => {
  for (const [text, width] of [
    ["护甲 +4，接触反伤 +8", 110],
    ["护甲 +4，接触反伤 +8", 125],
    ["每秒回复 +0.5", 70],
    ["经验 +12%", 50],
  ]) {
    const lines = breakLines(text, width, 15, font).split("\n");
    for (const number of text.match(/[+\-−]?[0-9.]+%?/g))
      assert.ok(
        lines.some((line) => line.includes(number)),
        `"${number}" split in ${JSON.stringify(lines)}`,
      );
    for (const line of lines)
      assert.doesNotMatch(line, /^[，。、；：！？]/, "punctuation starts a line");
  }
});

test("a title that must wrap never leaves a one-character last line", () => {
  for (const title of ["凸凸头盔", "火焰旋涡", "吃剩的东西", "招式学习器盒"]) {
    const lines = balanceLines(title, 15 * (title.length - 1), 15, font).split("\n");
    assert.ok(lines.length > 1);
    assert.ok(
      lines.every((line) => line.length > 1),
      JSON.stringify(lines),
    );
  }
});

test("card lines never split a stat term between lines", () => {
  // 「火属性伤害 +10%，伤」 fits 147 px exactly: the break must come before 伤害, not inside it.
  for (const width of [147, 160]) {
    const lines = breakLines("火属性伤害 +10%，伤害 +1%", width, 15, font).split("\n");
    assert.deepEqual(lines, ["火属性伤害 +10%，", "伤害 +1%"]);
  }
});

test("a line never starts with a slash separator", () => {
  const text = "与 Nintendo / The Pokémon Company / Creatures / GAME FREAK 无关";
  for (let width = 120; width <= 400; width += 10)
    for (const line of breakLines(text, width, 10, font).split("\n"))
      assert.doesNotMatch(line, /^\//, `${width}: ${line}`);
});
