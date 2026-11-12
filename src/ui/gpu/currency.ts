import { Container, Image, withOpacity } from "@pmndrs/uikit";
import { uiEaseOut } from "./focus-mark";
import { stack } from "./layer";
import { OutlinedText } from "./outlined-text";
import type { UiStage } from "./stage";

/** The carry-out currency's player-facing name: the one place UI labels read it from. */
export const CURRENCY_NAME = "星星沙子";
/** Its icon, wherever an amount of it shows (purses, prices, refunds). */
export const CURRENCY_ICON = "/art/icons/stardust.webp";

const counts = new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 21 });

/**
 * ui/CurrencyCounter.tsx `.game-currency`: a gold coin hanging over the left end of a dark pill
 * (2px gold rim), the count in gold with a 3px navy-deep stroke; `gain` writes it as +N: this
 * run's earnings (HUD, station, result), never the banked total (大厅, 研究所). The count springs from 1.3× in white back to gold over 240ms (`game-coin-pop`) when it
 * appears and whenever it changes, as the original's keyed count did.
 */
export class GpuCurrency {
  readonly root = stack(
    new Container({
      height: 32,
      paddingRight: 12,
      borderWidth: 2,
      borderColor: withOpacity("#ffd45b", 0.7),
      backgroundColor: withOpacity("#0d233f", 0.55),
      borderRadius: 16,
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
    }),
    3,
  );
  private readonly count = new Container({
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 14,
  });
  private readonly text = new OutlinedText(
    { text: "0", fontSize: 18, fontWeight: 800, color: "#ffd45b", lineHeight: 1 },
    { width: 3, color: "#0d233f" },
  );
  private readonly pose = { scale: 1, white: 0 };
  private readonly stage: UiStage;
  private value: number | null = null;
  private readonly gain: boolean;

  constructor(stage: UiStage, gain = false) {
    this.stage = stage;
    this.gain = gain;
    this.count.add(stack(this.text.root, 4));
    this.root.add(
      stack(
        new Image({
          src: CURRENCY_ICON,
          width: 40,
          height: 40,
          marginLeft: -10,
          marginRight: 4,
          flexShrink: 0,
        }),
        4,
      ),
      this.count,
    );
  }

  /** A solid pill (the lobby's top bar over the bright scene); the HUD keeps the translucent one. */
  solid(): void {
    this.root.setProperties({ backgroundColor: "#0d233f", borderColor: "#ffd45b" });
  }

  set(value: number): void {
    if (value === this.value) return;
    this.value = value;
    this.text.set({ text: `${this.gain ? "+" : ""}${counts.format(value)}` });
    this.pose.scale = 1.3;
    this.pose.white = 1;
    this.stage.motion.animate(
      this.pose,
      { scale: 1, white: 0 },
      240,
      () => {
        this.count.setProperties({
          transformScaleX: this.pose.scale,
          transformScaleY: this.pose.scale,
        });
        // #ffd45b (linear 1, .658, .105) to white; a fresh array each frame (UIKit compares by reference).
        this.text.fill.setProperties({
          color: [
            1,
            0.658375 + (1 - 0.658375) * this.pose.white,
            0.104616 + (1 - 0.104616) * this.pose.white,
          ],
        });
        this.stage.invalidate();
      },
      uiEaseOut,
    );
  }

  dispose(): void {
    this.stage.motion.cancel(this.pose);
    this.text.dispose();
  }
}
