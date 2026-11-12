import { Container, Text, withOpacity } from "@pmndrs/uikit";
import { stack } from "./layer";

/**
 * `.run-dev-panel` (developer mode): the frame, sim and world readout on a dark plate under the
 * vitals, 12px / 1.45 in pale green. The run refreshes it 4× a second.
 */
export class GpuDevReadout {
  readonly root = stack(
    new Container({
      positionType: "absolute",
      paddingY: 8,
      paddingX: 12,
      borderRadius: 6,
      backgroundColor: withOpacity("#0d233f", 0.32),
    }),
    5,
  );
  private readonly text = new Text({
    text: "",
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.45,
    color: "#d8effb",
    whiteSpace: "pre",
  });

  constructor() {
    this.root.add(stack(this.text, 1));
  }

  set(text: string): void {
    this.text.setProperties({ text });
  }

  /** `top: hud-top + 2.6 meters + 12px; left: hud-left`. */
  place(top: number, left: number): void {
    this.root.setProperties({
      positionTop: top,
      positionLeft: left,
    });
  }

  dispose(): void {
    this.root.removeFromParent();
    this.text.dispose();
    this.root.dispose();
  }
}
