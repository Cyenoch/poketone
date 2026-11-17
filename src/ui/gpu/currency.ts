import { Container, Image, Text } from "@pmndrs/uikit";
import { stack } from "./layer";
import { POP } from "./motion";
import { SlantPlate } from "./slant-plate";
import type { UiStage } from "./stage";
import { RADIUS, ui } from "./tokens";

/** The carry-out currency's player-facing name: the one place UI labels read it from. */
export const CURRENCY_NAME = "星星沙子";
/** Its icon, wherever an amount of it shows (purses, prices, refunds). */
export const CURRENCY_ICON = "/art/icons/stardust.webp";

const counts = new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 21 });

/**
 * An amount of 星星沙子 on an upright ink chip (the lab's balance look): the coin, then the count in
 * white. `gain` writes it as +N: this run's earnings (station, result), never the banked total. The
 * count pops from 1.25× (240ms) whenever it changes after the first value.
 */
export class GpuCurrency {
  readonly root = stack(
    new Container({
      height: 40,
      gap: 6,
      paddingLeft: 5,
      paddingRight: 12,
      borderRadius: RADIUS,
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
    }),
    3,
  );
  private readonly plate: SlantPlate;
  private readonly text = stack(
    new Text({ text: "0", fontSize: 18, fontWeight: 900, color: ui.white, lineHeight: 1.2 }),
    1,
  );
  private readonly pose = { scale: 1 };
  private readonly stage: UiStage;
  private value: number | null = null;
  private readonly gain: boolean;

  constructor(stage: UiStage, gain = false) {
    this.stage = stage;
    this.gain = gain;
    this.plate = new SlantPlate(this.root, { fill: ui.ink, upright: true });
    this.plate.set({ depth: 2 });
    this.root.add(
      this.plate.content,
      stack(new Image({ src: CURRENCY_ICON, width: 30, height: 30, flexShrink: 0 }), 1),
      this.text,
    );
  }

  set(value: number): void {
    if (value === this.value) return;
    const first = this.value === null;
    this.value = value;
    this.text.setProperties({ text: `${this.gain ? "+" : ""}${counts.format(value)}` });
    if (first) return;
    this.stage.motion.enter(
      this.pose,
      { scale: 1.25 },
      { scale: 1 },
      240,
      () => {
        this.text.setProperties({
          transformScaleX: this.pose.scale,
          transformScaleY: this.pose.scale,
        });
        this.stage.invalidate();
      },
      POP,
    );
  }

  dispose(): void {
    this.stage.motion.cancel(this.pose);
    this.plate.dispose();
  }
}
