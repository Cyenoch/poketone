import { Component, Container, Text } from "@pmndrs/uikit";
import type { ElementType } from "../../run/sim/content/elements";
import { typeNames } from "../../run/labels";
import { balanceLines, breakLines, ICON_MARK, type GlyphWidths } from "./line-break";
import { typeIcon } from "./type-icon";

const typeByName = new Map(
  (Object.entries(typeNames) as [ElementType, string][]).map(([type, name]) => [name, type]),
);
/** 「火属性」: a type named as a type (one-character names also occur inside words: 冰冻, 中毒). */
const TYPE_WORD = new RegExp(
  `(${[...typeByName.keys()].sort((a, b) => b.length - a.length).join("|")})(?=属性)`,
  "g",
);
/** A figure: its sign or multiplier, the number, and its percent or 万 (`+12%`, `×4`, `-0.5`, `1.8万`). */
const FIGURE = /[+-]?[×★]?\d+(?:\.\d+)?[%万]?/g;

/** Characters drawn bold inside figures, measured with the bold font. */
const FIGURE_CHAR = /[0-9+\-%.×★万]/;

export type RichRun =
  | { kind: "text" | "figure"; text: string }
  | { kind: "type"; type: ElementType; text: string };

/** Marks each type named as a type with {@link ICON_MARK}, so line breaking counts its crest. */
export function markTypes(text: string): string {
  return text.replace(TYPE_WORD, `${ICON_MARK}$1`);
}

/** One laid-out line in runs: plain text, figures, and a crest + type name. */
export function richRuns(line: string): RichRun[] {
  const runs: RichRun[] = [];
  const plain = (text: string) => {
    let at = 0;
    for (const match of text.matchAll(FIGURE)) {
      if (match.index > at) runs.push({ kind: "text", text: text.slice(at, match.index) });
      runs.push({ kind: "figure", text: match[0] });
      at = match.index + match[0].length;
    }
    if (at < text.length) runs.push({ kind: "text", text: text.slice(at) });
  };
  const parts = line.split(ICON_MARK);
  plain(parts[0]!);
  for (const part of parts.slice(1)) {
    const name = [...typeByName.keys()].find((key) => part.startsWith(key));
    if (!name) {
      plain(part);
      continue;
    }
    runs.push({ kind: "type", type: typeByName.get(name)!, text: name });
    plain(part.slice(name.length));
  }
  return runs;
}

export interface RichTone {
  ink: string;
  /** Figures: the theme's deep step on light faces, its light step (or yellow) on ink plates. */
  figure: string;
  weight?: 500 | 600 | 700 | 800;
  align?: "left" | "center";
}

/** The crest's size against the text, and its advance in ems for line breaking. */
const MARK_EM = 1.15;
const MARK_GAP = 2;

/**
 * Description text with its figures picked out in colour and each type named as a type led by its
 * crest. UIKit's Text has one colour, so this breaks the lines itself ({@link breakLines}: numbers
 * whole, kinsoku) and lays each line out as a row of runs. `layout` rebuilds only when the text,
 * width or size changed; the caller calls it after layout once the width is known.
 */
export class RichText {
  readonly panel: Container;
  /** Never drawn: resolve the fonts the runs use (body, bold figures), for measuring. */
  private readonly probe: Text;
  private readonly boldProbe: Text;
  private text: string;
  private tone: RichTone;
  private laid = "";
  private size = 14;
  private lineHeight = 1.45;

  constructor(text: string, tone: RichTone) {
    this.text = text;
    this.tone = tone;
    this.panel = new Container({
      flexDirection: "column",
      alignItems: tone.align === "center" ? "center" : "flex-start",
      minWidth: 0,
      flexShrink: 0,
    });
    this.probe = new Text({
      text: "",
      positionType: "absolute",
      fontWeight: tone.weight ?? 600,
      fontSize: 1,
      visibility: "hidden",
    });
    this.boldProbe = new Text({
      text: "",
      positionType: "absolute",
      fontWeight: 800,
      fontSize: 1,
      visibility: "hidden",
    });
    this.panel.add(this.probe, this.boldProbe);
  }

  get font(): GlyphWidths | undefined {
    return this.probe.fontSignal.value;
  }

  /** Both fonts are in: `layout` can measure. */
  get ready(): boolean {
    return !!this.probe.fontSignal.value && !!this.boldProbe.fontSignal.value;
  }

  /** The text as given (figures and type names as written). */
  get value(): string {
    return this.text;
  }

  set(text: string, tone: RichTone = this.tone): void {
    if (text === this.text && tone === this.tone) return;
    this.text = text;
    this.tone = tone;
    this.laid = "";
  }

  /**
   * Breaks the text to `width` (Infinity: only its own line breaks) at `size` px and redraws the
   * rows if anything changed: true when it did (false unchanged or while the font loads). `balance` evens the lines out
   * when the last would be a one- or two-character orphan.
   */
  layout(
    width: number,
    size: number,
    lineHeight = this.lineHeight,
    balance: "always" | "orphan" | "none" = "none",
  ): boolean {
    const font = this.font,
      bold = this.boldProbe.fontSignal.value;
    if (!font || !bold) return false;
    const key = `${width}|${size}|${lineHeight}|${balance}|${this.tone.ink}|${this.tone.figure}|${this.text}`;
    if (key === this.laid) return false;
    this.laid = key;
    this.size = size;
    this.lineHeight = lineHeight;
    const marked = markTypes(this.text);
    const measure: GlyphWidths = {
      getGlyphInfo: (char) =>
        char === ICON_MARK
          ? { xadvance: MARK_EM + MARK_GAP / size }
          : (FIGURE_CHAR.test(char) ? bold : font).getGlyphInfo(char),
    };
    let lines = Number.isFinite(width) ? breakLines(marked, width, size, measure) : marked;
    const orphan = lines.split("\n").at(-1)!.length <= 2;
    if (lines.includes("\n") && (balance === "always" || (balance === "orphan" && orphan)))
      lines = balanceLines(marked, width, size, measure);
    this.clear();
    const space = font.getGlyphInfo(" ").xadvance * size;
    for (const line of lines.split("\n")) this.panel.add(this.row(line, space));
    return true;
  }

  private row(line: string, space: number): Container {
    const { ink, figure, weight = 600, align } = this.tone;
    const row = new Container({
      flexDirection: "row",
      alignItems: "center",
      justifyContent: align === "center" ? "center" : "flex-start",
      height: Math.round(this.size * this.lineHeight),
      flexShrink: 0,
    });
    const text = (value: string, color: string, bold: boolean) =>
      new Text({
        text: value,
        fontSize: this.size,
        fontWeight: bold ? 800 : weight,
        color,
        lineHeight: this.lineHeight,
        whiteSpace: "pre",
        wordBreak: "keep-all",
        flexShrink: 0,
      });
    // UIKit drops a run's edge spaces from its width: they become margins.
    const edge = (value: string, side: "start" | "end") =>
      (side === "start" ? /^ */ : / *$/).exec(value)![0].length * space;
    for (const run of richRuns(line)) {
      const words = run.text.trim();
      const margins = { marginLeft: edge(run.text, "start"), marginRight: edge(run.text, "end") };
      if (run.kind === "type") {
        const mark = typeIcon(run.type, Math.round(this.size * MARK_EM));
        mark.setProperties({ marginRight: MARK_GAP, marginLeft: margins.marginLeft });
        row.add(mark, text(words, ink, weight >= 700));
      } else if (words) {
        const node = text(words, run.kind === "figure" ? figure : ink, run.kind === "figure");
        node.setProperties(margins);
        row.add(node);
      } else if (run.text)
        row.add(new Container({ width: run.text.length * space, flexShrink: 0 }));
    }
    return row;
  }

  private clear(): void {
    for (const child of this.panel.children.slice()) {
      if (child === this.probe || child === this.boldProbe || !(child instanceof Component))
        continue;
      child.removeFromParent();
      const parts: { dispose(): void }[] = [];
      child.traverse((node) => {
        if (node instanceof Component) parts.push(node);
      });
      for (const part of parts.reverse()) part.dispose();
    }
  }

  dispose(): void {
    this.clear();
    this.probe.dispose();
    this.boldProbe.dispose();
    this.panel.dispose();
  }
}
