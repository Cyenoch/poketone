import { Container, Text } from "@pmndrs/uikit";
import { createMenuIcon } from "./icons";
import { ui } from "./tokens";

/**
 * Beside a name plate while something not yet available is previewed: a padlock and what is still
 * needed, on a small white chip.
 */
export class LockChip {
  readonly panel = new Container({
    display: "none",
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    backgroundColor: ui.white,
    borderColor: ui.ink,
    borderWidth: 2,
    borderRadius: 4,
  });
  private readonly icon = createMenuIcon("lock");
  private readonly text = new Text({ fontWeight: 800, color: ui.ink, whiteSpace: "pre" });

  constructor() {
    this.panel.add(this.icon, this.text);
  }

  /** The line shown; null hides the chip. */
  set(line: string | null): void {
    this.panel.setProperties({ display: line ? "flex" : "none" });
    if (line) this.text.setProperties({ text: line });
  }

  /** As tall as 72% of the plate it stands beside. */
  size(plate: number, compact: boolean): void {
    const height = Math.round(plate * 0.72);
    this.panel.setProperties({ height, paddingX: compact ? 6 : 8, gap: 4 });
    this.icon.setProperties({ width: height * 0.6, height: height * 0.6 });
    this.text.setProperties({ fontSize: compact ? 12 : 14 });
  }
}
