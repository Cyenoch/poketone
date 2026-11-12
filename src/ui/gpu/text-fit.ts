import type { Text } from "@pmndrs/uikit";
import { breakLines } from "./line-break";

/**
 * `white-space: nowrap; text-overflow: ellipsis` for a one-line text node: `full` as it fits the
 * node's laid-out width, cut with "…" when it does not. Undefined until the node has a layout and
 * a font. The node must take its width from its box (flex grow / shrink), not from its text.
 */
export function ellipsize(node: Text, full: string): string | undefined {
  const width = node.size.value?.[0],
    layout = node.textLayout.value,
    font = node.fontSignal.value;
  if (width === undefined || !layout || !font) return undefined;
  const measure = (value: string) => {
    let result = 0,
      previous: number | undefined;
    for (const char of value) {
      const glyph = font.getGlyphInfo(char);
      result +=
        (glyph.xadvance + (previous === undefined ? 0 : font.getKerning(previous, glyph.id))) *
          layout.fontSize +
        layout.letterSpacing;
      previous = glyph.id;
    }
    return result;
  };
  if (measure(full) <= width + 0.5) return full;
  const chars = Array.from(full);
  while (chars.length && measure(chars.join("") + "…") > width) chars.pop();
  return chars.join("") + "…";
}

/**
 * A paragraph broken to the node's laid-out width as a page breaks Chinese: between CJK characters
 * and after punctuation, never inside a Latin word or a number with its sign or unit
 * (line-break.ts). Undefined until the node has a layout and a font. The node draws exactly these
 * breaks: `wordBreak: "keep-all"`, `whiteSpace: "pre-line"`, its width from its box.
 */
export function wrapLines(node: Text, full: string): string | undefined {
  const width = node.size.value?.[0],
    layout = node.textLayout.value,
    font = node.fontSignal.value;
  if (width === undefined || !layout || !font) return undefined;
  return breakLines(full, width, layout.fontSize, font);
}
