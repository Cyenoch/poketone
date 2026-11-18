import { Component, Container, Content, Image, Text, withOpacity } from "@pmndrs/uikit";
import { Mesh, MeshBasicMaterial, Shape, ShapeGeometry } from "three";
import { createMenuIcon, type MenuIconName } from "./icons";
import { fade, stack } from "./layer";
import { EASE, SNAP } from "./motion";
import { RichText } from "./rich-text";
import { createRunStatIcon } from "./run-overlays-icons";
import { SlantPlate } from "./slant-plate";
import type { UiStage } from "./stage";
import { RADIUS_INNER, ui } from "./tokens";

/** The text's room (a 260 tip less its padding); a tip of entries is wider. */
const TEXT_WIDTH = 228;
const ENTRY_WIDTH = 252;
const TEXT_SIZE = 14;
const ENTRY_SIZE = 13;
const LINE_HEIGHT = 1.45;
const PADDING_Y = 8;
const PADDING_X = 14;
/** Figures on the ink plate: the warm yellow (DESIGN.md › yellow). */
const FIGURE = "#ffd45b";

/**
 * One named thing a tip explains: its art (an image or a menu glyph), its name, what it does, and
 * how often (a cooldown in seconds, shown as a clock chip beside the name).
 */
export interface TipEntry {
  icon: { src: string } | { glyph: MenuIconName };
  name: string;
  text: string;
  cooldown?: number;
}
/** A line of text, or entries stacked with a hairline between them. */
export type TipContent = string | readonly TipEntry[];

/** The content as plain text (what tests and logs read). */
export function tipText(content: TipContent): string {
  return typeof content === "string"
    ? content
    : content
        .map((entry) =>
          [entry.name, entry.text, entry.cooldown ? `${entry.cooldown} 秒` : ""].join(" "),
        )
        .join("\n");
}

/**
 * One short line on a small upright ink plate (radius 4, a 3px hard shadow) with a
 * pointer at its anchor, above the anchor (below when there is no room), never clipped by a window.
 * Figures read in yellow and a type named as a type carries its crest ({@link RichText}). Entries
 * (a trainer's item and passive) stack as blocks: art and name over the effect, the cooldown a
 * clock chip beside the name. It fades in over 120ms rising 4px and out over 100ms.
 */
export class GpuTooltip {
  private readonly box = stack(
    new Container({
      positionType: "absolute",
      paddingY: PADDING_Y,
      display: "none",
    }),
    40,
  );
  private readonly plate = new SlantPlate(this.box, { fill: ui.ink, upright: true }, RADIUS_INNER);
  /** What the tip says: rebuilt when its content changes. */
  private readonly body = stack(new Container({ flexDirection: "column", minWidth: 0 }), 2);
  private texts: {
    rich: RichText;
    width: number;
    size: number;
    balance: "always" | "orphan";
  }[] = [];
  private readonly arrow = new Content({
    positionType: "absolute",
    width: 18,
    height: 10,
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly stage: UiStage;
  private readonly motion = { opacity: 0, y: 4 };
  private want: Container | null = null;
  private anchor: Container | null = null;
  private raw: TipContent = "";
  private laid: TipContent | null = null;
  /** `left`: beside its anchor, pointing right (a column of controls whose tips cover only the
   *  scene to its left); `right`: beside its right edge, pointing left (the trainer's kit, whose
   *  name plate sits above it); otherwise above it, or below where above has no room. */
  private side: "auto" | "left" | "right" = "auto";
  /** The box whose edge the tip opens from, else the anchor: `left` clears its left edge (the
   *  column), `right` its right edge (the trainer group, so no trainer slot is covered). */
  private edge: Container | null = null;
  /** With `left`: controls the tip must not cover (it rises above them). */
  private avoid: Container[] = [];

  constructor(stage: UiStage) {
    this.stage = stage;
    this.plate.set({ depth: 3 });
    this.box.add(this.plate.content, this.body);
    // Pointer: an ink triangle.
    const outer = new Mesh(
      new ShapeGeometry(new Shape().moveTo(-7, 0).lineTo(7, 0).lineTo(0, -7).closePath()),
      new MeshBasicMaterial({
        color: ui.ink,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.arrow.add(outer);
    this.arrow.notifyAncestorsChanged();
    this.arrow.abortSignal.addEventListener("abort", () => {
      outer.geometry.dispose();
      outer.material.dispose();
    });
    this.box.add(stack(this.arrow, 1));
    stage.root.add(this.box);
  }

  /** The control the tip explains, or null to fade it out. */
  show(
    anchor: Container | null,
    text: TipContent,
    side: "auto" | "left" | "right" = "auto",
    edge: Container | null = null,
    avoid: Container[] = [],
  ): void {
    if (anchor === this.want) {
      // The same control explaining something new (another partner's bond): new words, no entrance.
      if (anchor && tipText(text) !== tipText(this.raw)) this.raw = text;
      return;
    }
    this.want = anchor;
    if (anchor) {
      this.anchor = anchor;
      this.side = side;
      this.edge = edge;
      this.avoid = avoid;
      this.raw = text;
      this.laid = null;
      if (this.motion.opacity === 0) this.motion.y = 4;
    }
    this.stage.motion.animate(
      this.motion,
      { opacity: anchor ? 1 : 0, y: anchor ? 0 : this.motion.y },
      anchor ? 120 : 100,
      () => this.stage.invalidate(),
      anchor ? EASE : SNAP,
    );
  }

  /** What the tip says, as plain text. */
  get shown(): string {
    return tipText(this.raw);
  }

  private build(content: TipContent): void {
    this.clearBody();
    if (typeof content === "string") {
      const rich = new RichText(content, {
        ink: ui.white,
        figure: FIGURE,
        weight: 700,
        align: "center",
      });
      this.texts.push({ rich, width: TEXT_WIDTH, size: TEXT_SIZE, balance: "orphan" });
      this.body.setProperties({ alignItems: "center", gap: 0 });
      this.body.add(rich.panel);
      this.box.setProperties({ paddingX: PADDING_X, maxWidth: TEXT_WIDTH + 2 * PADDING_X });
      return;
    }
    this.body.setProperties({ alignItems: "stretch", gap: 0, width: ENTRY_WIDTH });
    for (const [index, entry] of content.entries()) {
      if (index > 0)
        this.body.add(
          new Container({
            height: 1,
            marginY: 7,
            flexShrink: 0,
            backgroundColor: withOpacity(ui.white, 0.16),
          }),
        );
      const head = new Container({ flexDirection: "row", alignItems: "center", gap: 6 });
      let art: Component;
      if ("src" in entry.icon)
        art = new Image({ src: entry.icon.src, width: 22, height: 22, flexShrink: 0 });
      else {
        art = createMenuIcon(entry.icon.glyph);
        art.setProperties({ width: 18, height: 18, marginX: 2, color: ui.white });
      }
      const name = new Text({
        text: entry.name,
        fontSize: 15,
        fontWeight: 800,
        color: ui.white,
        lineHeight: 1.3,
        whiteSpace: "pre",
        wordBreak: "keep-all",
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
      });
      head.add(art, name);
      if (entry.cooldown) head.add(cooldownChip(entry.cooldown));
      const rich = new RichText(entry.text, { ink: ui.mist, figure: FIGURE, weight: 600 });
      rich.panel.setProperties({ marginTop: 3 });
      this.texts.push({ rich, width: ENTRY_WIDTH, size: ENTRY_SIZE, balance: "always" });
      this.body.add(head, rich.panel);
    }
    this.box.setProperties({ paddingX: PADDING_X, maxWidth: ENTRY_WIDTH + 2 * PADDING_X });
  }

  private clearBody(): void {
    for (const { rich } of this.texts) {
      rich.panel.removeFromParent();
      rich.dispose();
    }
    this.texts = [];
    this.body.setProperties({ width: undefined });
    for (const child of this.body.children.slice()) {
      if (!(child instanceof Component)) continue;
      child.removeFromParent();
      const parts: { dispose(): void }[] = [];
      child.traverse((node) => {
        if (node instanceof Component) parts.push(node);
      });
      for (const part of parts.reverse()) part.dispose();
    }
  }

  /** Hides at once (its anchor is being torn down). */
  clear(): void {
    this.stage.motion.cancel(this.motion);
    this.motion.opacity = 0;
    this.want = this.anchor = null;
    this.box.setProperties({ display: "none" });
  }

  /** Places the tip over its anchor; call after layout every frame it may be visible. */
  update(): void {
    if (this.laid !== this.raw) {
      this.laid = this.raw;
      this.build(this.raw);
    }
    let changed = false;
    for (const { rich, width, size, balance } of this.texts)
      changed = rich.layout(width, size, LINE_HEIGHT, balance) || changed;
    if (changed) this.stage.invalidate();
    if (!this.want && this.motion.opacity === 0) this.anchor = null;
    const target = this.anchor;
    const matrix = target?.globalMatrix.value,
      size = target?.size.value,
      tipSize = this.box.size.value;
    this.box.setProperties({ display: target ? "flex" : "none" });
    if (!target || !matrix || !size || !tipSize) return;
    const v = this.stage.viewport;
    const centre = matrix.elements[12]! - this.stage.camera.left,
      top = this.stage.camera.top - matrix.elements[13]! - size[1] / 2,
      bottom = top + size[1];
    const minX = Math.max(8, v.safeArea.left),
      maxX = v.width - Math.max(8, v.safeArea.right) - tipSize[0];
    if (this.side === "right") {
      // Past the right edge (of the anchor or its group), centred on the anchor, pointing left.
      const middle = (top + bottom) / 2;
      const y = Math.min(
        Math.max(middle - tipSize[1] / 2, Math.max(8, v.safeArea.top)),
        v.height - Math.max(8, v.safeArea.bottom) - tipSize[1],
      );
      const edgeMatrix = this.edge?.globalMatrix.value,
        edgeSize = this.edge?.size.value;
      const right =
        edgeMatrix && edgeSize
          ? edgeMatrix.elements[12]! - this.stage.camera.left + edgeSize[0] / 2
          : centre + size[0] / 2;
      const x = Math.min(Math.max(right, centre + size[0] / 2) + 12, Math.max(minX, maxX));
      fade(this.box, this.motion.opacity).setProperties({
        positionLeft: x,
        positionTop: y,
        transformTranslateY: 0,
      });
      this.arrow.setProperties({
        positionLeft: -10,
        positionTop: Math.min(Math.max(middle - y, 14), tipSize[1] - 14) - 5,
        transformRotateZ: -90,
        transformScaleY: 1,
      });
      return;
    }
    if (this.side === "left") {
      const middle = (top + bottom) / 2;
      let y = Math.min(
        Math.max(middle - tipSize[1] / 2, Math.max(8, v.safeArea.top)),
        v.height - Math.max(8, v.safeArea.bottom) - tipSize[1],
      );
      const edgeMatrix = this.edge?.globalMatrix.value,
        edgeSize = this.edge?.size.value;
      const left =
        edgeMatrix && edgeSize
          ? edgeMatrix.elements[12]! - this.stage.camera.left - edgeSize[0] / 2
          : centre - size[0] / 2;
      const x = Math.max(minX, left - 12 - tipSize[0]);
      // Never over another control: lift just clear of it (8 above), so the tip stays beside the
      // column and its pointer still reaches its target's row.
      for (const other of this.avoid) {
        const m = other.globalMatrix.value,
          s = other.size.value;
        if (!m || !s || !other.isVisible.value) continue;
        const ox = m.elements[12]! - this.stage.camera.left,
          oy = this.stage.camera.top - m.elements[13]!;
        const overlaps =
          x < ox + s[0] / 2 &&
          x + tipSize[0] > ox - s[0] / 2 &&
          y < oy + s[1] / 2 &&
          y + tipSize[1] > oy - s[1] / 2;
        if (overlaps) y = Math.max(Math.max(8, v.safeArea.top), oy - s[1] / 2 - 8 - tipSize[1]);
      }
      fade(this.box, this.motion.opacity).setProperties({
        positionLeft: x,
        positionTop: y,
        transformTranslateY: 0,
      });
      this.arrow.setProperties({
        positionLeft: tipSize[0] - 2 - 6,
        // Within the band where the tip and its target overlap (a lifted tip points low).
        positionTop:
          Math.min(Math.max(middle - y, 14, top - y + 6), tipSize[1] - 14, bottom - y - 6) - 5,
        transformRotateZ: 90,
        transformScaleY: 1,
      });
      return;
    }
    const x = Math.min(Math.max(centre - tipSize[0] / 2, minX), Math.max(minX, maxX));
    const above = top - 10 - tipSize[1];
    const below = above < Math.max(8, v.safeArea.top);
    const arrowX = Math.min(Math.max(centre - x, 14), tipSize[0] - 14);
    fade(this.box, this.motion.opacity).setProperties({
      positionLeft: x,
      positionTop: below ? bottom + 10 : above,
      transformTranslateY: below ? -this.motion.y : this.motion.y,
    });
    // Centred on the anchor, just past the plate's edge.
    this.arrow.setProperties({
      positionLeft: arrowX - 9,
      positionTop: below ? -10 + 1 : tipSize[1] - 1,
      transformRotateZ: 0,
      transformScaleY: below ? -1 : 1,
    });
  }

  dispose(): void {
    this.stage.motion.cancel(this.motion);
    this.clearBody();
    this.box.removeFromParent();
    this.plate.dispose();
    this.box.dispose();
  }
}

/** A cooldown beside a name: a clock and the seconds, on a faint white chip. */
function cooldownChip(seconds: number): Container {
  const chip = new Container({
    height: 20,
    paddingX: 6,
    gap: 3,
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    borderRadius: 4,
    backgroundColor: withOpacity(ui.white, 0.14),
  });
  const clock = createRunStatIcon("cooldown");
  clock.setProperties({ width: 13, height: 13, color: FIGURE });
  chip.add(
    clock,
    new Text({
      text: `${seconds} 秒`,
      fontSize: 12,
      fontWeight: 800,
      color: FIGURE,
      whiteSpace: "pre",
      wordBreak: "keep-all",
    }),
  );
  return chip;
}
