/** Glyph advances in ems (UIKit's normalised font): `font.getGlyphInfo(char).xadvance`. */
export interface GlyphWidths {
  getGlyphInfo(char: string): { xadvance: number };
}

/** Characters that hold together: a number with its sign, decimals, unit and multiplier. */
const NUMERIC = /[0-9A-Za-z.+\-%×★/]/;
/** Punctuation that must not start a line (kinsoku): a break goes after it, never before. */
const NO_START = /[，。、；：！？）」』】%,.;:!?)]/;
/** Stands in for an inline icon (a type's crest): it holds to the word it leads. */
// A private-use code point, built rather than written: it is never drawn, so the source scan that
// feeds the font build must not see it as text.
export const ICON_MARK = String.fromCharCode(0xe000);
const NO_END = /[（「『【(\uE000]/;

/** A figure held to its unit and a leading 每 (「每 45 秒」, 「12 伤害」, 「×4 倍」): one run, never split. */
const FIGURE_RUN =
  /(?:每\s*)?[+-]?[×★]?\d+(?:\.\d+)?[%万]?(?:\s*(?:伤害|秒|时|次|层|点|格|倍|米|级|个|只|名|枚|下|发|颗|回))?/g;
/** A short bracketed aside stays on one line: 「（每 45 秒一次）」 never wraps inside. */
const ASIDE = /[（(][^（）()\n]{1,14}[）)]/g;

/** Code-unit offsets inside each match of `pattern` in `text`: no break before them. */
function heldOffsets(text: string, pattern: RegExp): Set<number> {
  const held = new Set<number>();
  for (const match of text.matchAll(pattern))
    for (let i = match.index + 1; i < match.index + match[0].length; i++) held.add(i);
  return held;
}

const graphemes = new Intl.Segmenter();
/** Dictionary words (ICU), like Chrome's `word-break: auto-phrase`: 「伤害」 never splits into 「伤」/「害」. */
const words = new Intl.Segmenter("zh", { granularity: "word" });

/** Width of `text` in px at `size`. */
export function textWidth(text: string, size: number, font: GlyphWidths): number {
  let width = 0;
  for (const char of text) width += font.getGlyphInfo(char).xadvance * size;
  return width;
}

/** Whether a line may break between `before` and `after`, as browsers break Chinese text. */
function breakable(before: string, after: string, wordEdge: boolean): boolean {
  // A separator ends its line (「Company /」), never starts the next one.
  if (after === "/") return false;
  if (after === " " || before === " ") return true;
  if (!wordEdge) return false;
  if (NUMERIC.test(before) && NUMERIC.test(after)) return false;
  if (NO_START.test(after) || NO_END.test(before)) return false;
  return true;
}

/**
 * Inserts line breaks so `text` fits `width`: between words and after punctuation, never inside a
 * word, a number with its sign or unit (`+8`, `+12%`, `每 45 秒`) or a short bracketed aside. A word wider than the line breaks
 * where it overflows. Existing `\n` are kept. The result is laid out with the no-wrap wrapper, so
 * these breaks are the only ones.
 */
export function breakLines(text: string, width: number, size: number, font: GlyphWidths): string {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const chars = Array.from(graphemes.segment(paragraph), (part) => part.segment);
    const edges = new Set(Array.from(words.segment(paragraph), (part) => part.index));
    const figures = heldOffsets(paragraph, FIGURE_RUN),
      asides = heldOffsets(paragraph, ASIDE);
    let offset = 0;
    let line = "",
      lineWidth = 0,
      lastBreak = -1,
      lastLoose = -1;
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]!;
      const advance = font.getGlyphInfo(char).xadvance * size;
      // The space before a separator is no break either: 「 /」 stays with what it follows.
      const beforeSlash = char === " " && chars[i + 1] === "/";
      if (line && i > 0 && !beforeSlash && breakable(chars[i - 1]!, char, edges.has(offset))) {
        // An aside wider than the line breaks inside it; a figure only when it alone overflows.
        if (!figures.has(offset)) {
          lastLoose = line.length;
          if (!asides.has(offset)) lastBreak = line.length;
        }
      }
      offset += char.length;
      if (line && lineWidth + advance > width && char !== " ") {
        const at = lastBreak > 0 ? lastBreak : lastLoose;
        if (at > 0) {
          out.push(line.slice(0, at).trimEnd());
          line = line.slice(at).trimStart();
        } else {
          out.push(line.trimEnd());
          line = "";
        }
        lineWidth = textWidth(line, size, font);
        lastBreak = lastLoose = -1;
      }
      line += char;
      lineWidth += advance;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * `text-wrap: balance`: the same number of lines as {@link breakLines}, made as even as they can
 * be, so a title never ends on a one-character orphan (「凸凸头 / 盔」 becomes 「凸凸 / 头盔」).
 */
export function balanceLines(text: string, width: number, size: number, font: GlyphWidths): string {
  const greedy = breakLines(text, width, size, font);
  const count = greedy.split("\n").length;
  if (count < 2) return greedy;
  let low = 0,
    high = width;
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    if (breakLines(text, mid, size, font).split("\n").length > count) low = mid;
    else high = mid;
  }
  return breakLines(text, high, size, font);
}
