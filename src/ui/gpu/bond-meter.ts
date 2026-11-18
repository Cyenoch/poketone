import { Container, Text } from "@pmndrs/uikit";
import { bondTitle } from "../../run/labels";
import { bondLevel, bondMilestones, MAX_BOND_LEVEL } from "../../run/sim/content/bonds";
import { OutlineRing } from "./box-shadow";
import { HeartGauge } from "./heart-gauge";
import { stack } from "./layer";
import type { UiStage } from "./stage";
import { RADIUS, ui } from "./tokens";

/** The next level's number, title and grant, and the points still missing; the total once full. */
export function bondTip(points: number): string {
  const level = bondLevel(points);
  if (level >= MAX_BOND_LEVEL) return `Lv.${level} ${bondTitle(level)}\n${points} 点`;
  const next = bondMilestones[level]!;
  const grant = next.reward ? ` · ${next.reward}` : "";
  return `Lv.${level + 1} ${next.title}${grant}\n还差 ${next.points - points} 点`;
}

/**
 * The lobby's bond with the picked partner: the heart scale and the title it has earned. The next
 * level (what it grants, how many points are missing) shows only as its tip on hover, focus or a
 * tap; keyboard focus rings it.
 */
export class BondMeter {
  readonly panel = new Container({
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    paddingX: 6,
  });
  private readonly gauge: HeartGauge;
  private readonly title = new Text({
    text: "",
    fontWeight: 800,
    color: ui.ink,
    whiteSpace: "pre",
    wordBreak: "keep-all",
  });
  private readonly ring = new OutlineRing(RADIUS, ui.ink, 2.5, 3);
  private readonly stage: UiStage;
  points = 0;

  constructor(stage: UiStage) {
    this.stage = stage;
    this.gauge = new HeartGauge(stage);
    this.ring.content.setProperties({ display: "none" });
    this.panel.add(stack(this.gauge.panel, 1), stack(this.title, 1), stack(this.ring.content, 3));
  }

  set(points: number): void {
    this.points = points;
    const title = bondTitle(bondLevel(points));
    this.title.setProperties({ text: title ?? "", display: title ? "flex" : "none" });
    this.gauge.set(points);
  }

  /** Heart size and title type. The box is a touch target (at least `minTarget` tall) that lays
   *  out as its row's height `row`, reaching past the row evenly above and below. */
  size(compact: boolean, minTarget: number, row: number): void {
    this.gauge.size(compact ? 13 : 17, compact ? 2 : 3);
    const height = Math.max(44, minTarget);
    const reach = Math.max(0, (height - row) / 2);
    this.panel.setProperties({
      gap: compact ? 6 : 8,
      height,
      marginTop: -reach,
      marginBottom: -reach,
    });
    this.title.setProperties({ fontSize: compact ? 13 : 15 });
  }

  paint(focusVisible: boolean): void {
    this.ring.content.setProperties({ display: focusVisible ? "flex" : "none" });
    this.stage.invalidate();
  }

  dispose(): void {
    this.gauge.dispose();
    this.ring.dispose();
  }
}
