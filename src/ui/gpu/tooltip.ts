import { Container, Content, Text, withOpacity } from "@pmndrs/uikit";
import { Mesh, MeshBasicMaterial, Shape, ShapeGeometry } from "three";
import { BoxShadow } from "./box-shadow";
import { cubicBezier, uiEaseOut } from "./focus-mark";
import { fade, stack } from "./layer";
import { balanceLines, breakLines, type GlyphWidths } from "./line-break";
import type { UiStage } from "./stage";

const easeIn = (t: number) => cubicBezier(t, 0.42, 0, 1, 1);
/** The text's room: 260 max width less 2 × 14 padding and 2 × 2 frame. */
const TEXT_WIDTH = 228;
const TEXT_SIZE = 14;

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
 * ui/Tooltip.tsx `.game-tip`: one short line on a navy plate with a warm inner line and a pointer
 * at its anchor, above the anchor (below when there is no room), never clipped by a window. It fades
 * in over 120ms rising 4px (`game-tip-in`) and out over 100ms (`ui-fade-out`).
 */
export class GpuTooltip {
  private readonly box = stack(
    new Container({
      positionType: "absolute",
      maxWidth: 260,
      paddingX: 14,
      paddingY: 8,
      borderWidth: 2,
      borderColor: "#0d233f",
      borderRadius: 8,
      backgroundColor: "#142f50",
      display: "none",
    }),
    40,
  );
  private readonly text = stack(
    new Text({
      text: "",
      fontSize: TEXT_SIZE,
      fontWeight: 700,
      color: "#ffffff",
      lineHeight: 1.45,
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
  private readonly shadow = new BoxShadow(8, [
    { y: 3, blur: 0, color: "#0d233f", alpha: 1 },
    { y: 4, blur: 10, color: "#0d233f", alpha: 0.22 },
  ]);
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
    this.box.add(
      this.shadow.content,
      stack(
        new Container({
          positionType: "absolute",
          positionLeft: 0,
          positionTop: 0,
          width: "100%",
          height: "100%",
          borderWidth: 1,
          borderColor: withOpacity("#ffd45b", 0.55),
          borderRadius: 6,
        }),
        1,
      ),
      this.text,
    );
    // Pointer: a navy-deep triangle with a navy one inset 1px above it.
    const triangle = (w: number, h: number, color: string, z: number) => {
      const mesh = new Mesh(
        new ShapeGeometry(
          new Shape()
            .moveTo(-w / 2, 0)
            .lineTo(w / 2, 0)
            .lineTo(0, -h)
            .closePath(),
        ),
        new MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false }),
      );
      mesh.position.z = z;
      return mesh;
    };
    const outer = triangle(18, 9, "#0d233f", 0),
      inner = triangle(12, 6, "#142f50", 0.01);
    outer.position.y = -1;
    this.arrow.add(outer, inner);
    this.arrow.notifyAncestorsChanged();
    this.arrow.abortSignal.addEventListener("abort", () => {
      for (const mesh of [outer, inner]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
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
    if (anchor === this.want) return;
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
      anchor ? uiEaseOut : easeIn,
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
      this.text.setProperties({ text: tipLines(this.raw, font) });
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
        positionLeft: tipSize[0] - 2 - 4,
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
    // ::before at top: 100% of the padding box (inside the 2px frame), centred on the anchor.
    this.arrow.setProperties({
      positionLeft: arrowX - 9 - 2,
      positionTop: below ? -10 : tipSize[1] - 4 - 1,
      transformRotateZ: 0,
      transformScaleY: below ? -1 : 1,
    });
  }

  dispose(): void {
    this.stage.motion.cancel(this.motion);
    this.box.removeFromParent();
    this.shadow.dispose();
    this.box.dispose();
  }
}
