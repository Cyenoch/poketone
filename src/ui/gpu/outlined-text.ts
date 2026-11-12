import { Container, Text } from "@pmndrs/uikit";
import { stack } from "./layer";

type TextProperties = NonNullable<ConstructorParameters<typeof Text>[0]>;

/** Copies around the outline: 16 keep the gap between neighbours under 0.6px at a 1.5px radius. */
const DIRECTIONS = 16;

/**
 * CSS `-webkit-text-stroke: <width> <color>; paint-order: stroke fill`: the visible stroke is the
 * outer half, `width / 2` around the glyphs. UIKit draws one shared material per font, so the
 * stroke is copies of the text placed evenly on that circle under the fill; they join the fill's
 * instanced glyph draw, so it costs instances, not draw calls.
 */
export class OutlinedText {
  readonly root = new Container({ flexShrink: 0 });
  readonly fill: Text;
  private readonly strokes: Text[] = [];

  constructor(properties: TextProperties, stroke: { width: number; color: string }) {
    const radius = stroke.width / 2;
    // One line unless the caller asks otherwise: an absolute copy sized while its box still held the
    // previous, shorter text would wrap and sit off the fill.
    properties = { whiteSpace: "pre", ...properties };
    for (let i = 0; i < DIRECTIONS; i++) {
      const angle = (i / DIRECTIONS) * Math.PI * 2;
      const copy = new Text({
        ...properties,
        color: stroke.color,
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 0,
        // The fill's box: when a parent stretches the fill, its text stays centred in it, and so do
        // the copies.
        width: "100%",
        height: "100%",
        transformTranslateX: Math.cos(angle) * radius,
        transformTranslateY: Math.sin(angle) * radius,
      });
      this.strokes.push(copy);
      this.root.add(copy);
    }
    this.fill = stack(new Text(properties), 1);
    this.root.add(this.fill);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const copy of this.strokes) copy.dispose();
    this.fill.dispose();
    this.root.dispose();
  }

  setStrokeColor(color: string): void {
    for (const copy of this.strokes) copy.setProperties({ color });
  }

  /** Updates every copy; `color` applies to the fill only. */
  set(properties: TextProperties): void {
    this.fill.setProperties(properties);
    const { color: _color, ...shared } = properties;
    for (const copy of this.strokes) copy.setProperties(shared);
  }
}
