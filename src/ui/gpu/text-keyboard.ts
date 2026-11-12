import { Container } from "@pmndrs/uikit";
import { GameButton } from "./game-button";
import type { UiStage } from "./stage";

/** Base64 alphabet only: the save format needs no IME or general keyboard layout. */
export class TextKeyboard {
  readonly panel = new Container({
    flexDirection: "column",
    gap: 4,
    display: "none",
    flexShrink: 0,
  });
  readonly keys: { button: GameButton; value: string }[] = [];
  constructor(stage: UiStage) {
    for (const values of [
      "ABCDEFGHIJKLM".split(""),
      "NOPQRSTUVWXYZ".split(""),
      "0123456789+/=".split(""),
      ["Aa", "←", "→", "全选", "删除", "粘贴", "完成"],
    ]) {
      const row = new Container({ flexDirection: "row", gap: 3 });
      for (const value of values) {
        const button = new GameButton(stage, { label: value, tone: "secondary", size: "small" });
        button.panel.setProperties({ flexGrow: 1, flexBasis: 0, paddingX: 0 });
        row.add(button.panel);
        this.keys.push({ button, value });
      }
      this.panel.add(row);
    }
  }
  fitTouch() {
    for (const { button } of this.keys) button.fitTouch();
  }
  dispose() {
    for (const { button } of this.keys) button.dispose();
  }
}
