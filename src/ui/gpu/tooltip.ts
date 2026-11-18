import { Container, Content, Text } from "@pmndrs/uikit";
import { Mesh, MeshBasicMaterial, Shape, ShapeGeometry } from "three";
import { fade, stack } from "./layer";
import { balanceLines, breakLines, type GlyphWidths } from "./line-break";
import { EASE, SNAP } from "./motion";
import { SlantPlate } from "./slant-plate";
import type { UiStage } from "./stage";
import { RADIUS_INNER, ui } from "./tokens";

/** The text's room (a 260 tip less its padding). */
const TEXT_WIDTH = 228;
const TEXT_SIZE = 14;
const LINE_HEIGHT = 1.45;
const PADDING_Y = 8;
const PADDING_X = 14;

/**
 * Lines that fit the tip, broken where Chinese text may break (numbers whole, no line-start
 * punctuation), and evened out when the last line would be a one- or two-character orphan.
 */
function tipLines(text: string, font: GlyphWidths): string {
  const greedy = breakLines(text, TEXT_WIDTH, TEXT_SIZE, font);
  const lines = greedy.split("\n");
  return lines.length > 1 && lines.at(-1)!.length <= 2
    ? balanceLines(text, TEXT_WIDTH, TEXT_SIZE, font)
    : greedy;
}

/**
 * One short line on a small upright ink plate (radius 4, a 3px hard shadow) with a
 * pointer at its anchor, above the anchor (below when there is no room), never clipped by a window.
 * It fades in over 120ms rising 4px and out over 100ms.
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
  private readonly text = stack(
    new Text({
      text: "",
      fontSize: TEXT_SIZE,
      fontWeight: 700,
      color: ui.white,
      lineHeight: LINE_HEIGHT,
      textAlign: "center",
      flexShrink: 1,
      // UIKit's word wrapper measures a line and then breaks it again inside that same width
      // (「…2.8 / 秒」); keep-all draws exactly the breaks `tipLines` chose, and pre-line keeps
      // those breaks as breaks (under `normal` each one collapses to a space on one long line).
      wordBreak: "keep-all",
      whiteSpace: "pre-line",
    }),
    2,
  );
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
  private raw = "";
  private laid: string | null = null;
  /** `left`: beside its anchor, pointing right (a column of controls whose tips cover only the
   *  scene to its left); otherwise above it, or below where above has no room. */
  private side: "auto" | "left" = "auto";
  /** With `left`: the box whose left edge the tip opens from (the column), else the anchor. */
  private edge: Container | null = null;
  /** With `left`: controls the tip must not cover (it rises above them). */
  private avoid: Container[] = [];

  constructor(stage: UiStage) {
    this.stage = stage;
    this.plate.set({ depth: 3 });
    this.box.add(this.plate.content, this.text);
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
    text: string,
    side: "auto" | "left" = "auto",
    edge: Container | null = null,
    avoid: Container[] = [],
  ): void {
    if (anchor === this.want) {
      // The same control explaining something new (another partner's bond): new words, no entrance.
      if (anchor && text !== this.raw) this.raw = text;
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

  /** Hides at once (its anchor is being torn down). */
  clear(): void {
    this.stage.motion.cancel(this.motion);
    this.motion.opacity = 0;
    this.want = this.anchor = null;
    this.box.setProperties({ display: "none" });
  }

  /** Places the tip over its anchor; call after layout every frame it may be visible. */
  update(): void {
    const font = this.text.fontSignal.value;
    if (font && this.laid !== this.raw) {
      this.laid = this.raw;
      const lines = tipLines(this.raw, font);
      this.text.setProperties({ text: lines });
      this.box.setProperties({ paddingX: PADDING_X, maxWidth: TEXT_WIDTH + 2 * PADDING_X });
    }
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
    this.box.removeFromParent();
    this.plate.dispose();
    this.box.dispose();
  }
}
