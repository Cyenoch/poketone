import { Container, Image, Text } from "@pmndrs/uikit";
import { assistNames, trainerKits, type TrainerId } from "../../run/sim/content/trainers";
import { assistLooks, passiveLooks } from "../../trainers";
import { OutlineRing } from "./box-shadow";
import { createMenuIcon } from "./icons";
import { stack } from "./layer";
import type { UiStage } from "./stage";
import { ui } from "./tokens";

/**
 * Under the trainer's name: the item they use in a run and their passive, each as its art and
 * short name on one white chip. What they do shows only as the lobby's tip (hover, focus, a tap);
 * keyboard focus rings the chip. The box is a touch target at least `minTarget` tall.
 */
export class TrainerKit {
  readonly panel = new Container({ flexDirection: "row", alignItems: "center", flexShrink: 0 });
  private readonly chip = new Container({
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    backgroundColor: ui.white,
    borderColor: ui.ink,
    borderWidth: 2,
    borderRadius: 4,
  });
  private readonly art = new Image({ src: "", flexShrink: 0 });
  private readonly item = new Text({ fontWeight: 800, color: ui.ink, whiteSpace: "pre" });
  private readonly rule = new Container({ width: 2, backgroundColor: ui.line, flexShrink: 0 });
  private readonly icons = Object.fromEntries(
    Object.entries(passiveLooks).map(([id, look]) => [id, createMenuIcon(look.icon)]),
  );
  private readonly passive = new Text({ fontWeight: 800, color: ui.ink, whiteSpace: "pre" });
  private readonly ring = new OutlineRing(4, ui.ink, 2.5, 3);
  private readonly stage: UiStage;

  constructor(stage: UiStage) {
    this.stage = stage;
    this.ring.content.setProperties({ display: "none" });
    this.chip.add(this.art, this.item, this.rule, ...Object.values(this.icons), this.passive);
    this.chip.add(stack(this.ring.content, 3));
    this.panel.add(this.chip);
  }

  set(id: TrainerId): void {
    const { assist, passive } = trainerKits[id];
    this.art.setProperties({ src: assistLooks[assist].icon });
    this.item.setProperties({ text: assistNames[assist] });
    for (const [key, icon] of Object.entries(this.icons))
      icon.setProperties({ display: key === passive ? "flex" : "none" });
    this.passive.setProperties({ text: passiveLooks[passive].name });
  }

  /** As tall as 72% of the name plate above it, like the lock chip beside it. */
  size(plate: number, compact: boolean, minTarget: number): void {
    const height = Math.round(plate * 0.72);
    const art = Math.round(height * 0.78);
    const glyph = Math.round(height * 0.6);
    // The hit box reaches past the chip evenly above and below; the chip sets the row's height.
    const target = Math.max(44, minTarget);
    const reach = Math.max(0, (target - height) / 2);
    this.panel.setProperties({ height: target, marginTop: -reach, marginBottom: -reach });
    this.chip.setProperties({ height, paddingX: compact ? 6 : 8, gap: compact ? 4 : 6 });
    this.art.setProperties({ width: art, height: art });
    for (const icon of Object.values(this.icons))
      icon.setProperties({ width: glyph, height: glyph });
    this.rule.setProperties({ height: Math.round(height * 0.5), marginX: compact ? 2 : 4 });
    for (const text of [this.item, this.passive])
      text.setProperties({ fontSize: compact ? 12 : 14 });
  }

  paint(focusVisible: boolean): void {
    this.ring.content.setProperties({ display: focusVisible ? "flex" : "none" });
    this.stage.invalidate();
  }

  dispose(): void {
    this.ring.dispose();
  }
}
