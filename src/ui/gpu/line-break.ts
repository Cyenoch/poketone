/** Glyph advances in ems (UIKit's normalised font): `font.getGlyphInfo(char).xadvance`. */
export interface GlyphWidths {
  getGlyphInfo(char: string): { xadvance: number };
}

/** Characters that hold together: a number with its sign, decimals, unit and multiplier. */
const NUMERIC = /[0-9A-Za-z.+\-%×★/]/;
/** Punctuation that must not start a line (kinsoku): a break goes after it, never before. */
const NO_START = /[，。、；：！？）」』】%,.;:!?)]/;
const NO_END = /[（「『【(]/;

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
 * word or a number with its sign or unit (`+8`, `+12%`, `0.5`). A word wider than the line breaks
 * where it overflows. Existing `\n` are kept. The result is laid out with the no-wrap wrapper, so
 * these breaks are the only ones.
 */
export function breakLines(text: string, width: number, size: number, font: GlyphWidths): string {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const chars = Array.from(graphemes.segment(paragraph), (part) => part.segment);
    const edges = new Set(Array.from(words.segment(paragraph), (part) => part.index));
    let offset = 0;
    let line = "",
      lineWidth = 0,
      lastBreak = -1;
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]!;
      const advance = font.getGlyphInfo(char).xadvance * size;
      // The space before a separator is no break either: 「 /」 stays with what it follows.
      const beforeSlash = char === " " && chars[i + 1] === "/";
      if (line && i > 0 && !beforeSlash && breakable(chars[i - 1]!, char, edges.has(offset)))
        lastBreak = line.length;
      offset += char.length;
      if (line && lineWidth + advance > width && char !== " ") {
        if (lastBreak > 0) {
          out.push(line.slice(0, lastBreak).trimEnd());
          line = line.slice(lastBreak).trimStart();
        } else {
          out.push(line.trimEnd());
          line = "";
        }
        lineWidth = textWidth(line, size, font);
        lastBreak = -1;
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
