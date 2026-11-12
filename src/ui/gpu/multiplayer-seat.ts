import { Container, Image, Text } from "@pmndrs/uikit";
import { starters } from "../../run/sim/content/lines";
import { playerColors } from "../player-colors";
import { createMenuIcon } from "./icons";
import { gameTag } from "./tag";
import { fade, stack } from "./layer";
import { uiEaseOut } from "./focus-mark";
import type { UiStage } from "./stage";
import type { SeatView } from "./multiplayer-view";

/** A seat keeps its nodes through join/transport changes, so focus and arrival motion survive. */
export class MultiplayerSeat {
  readonly root = new Container({
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    height: 182,
    flexShrink: 0,
    gap: 4,
    padding: 10,
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: "#f5fbff",
  });
  private readonly top = new Container({
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
  });
  private readonly me = gameTag("我", { face: "#142f50", ink: "#ffffff", size: "badge" });
  private readonly portrait = new Image({ width: 88, height: 88, flexShrink: 0 });
  private readonly empty = new Container({
    width: 88,
    height: 88,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 2,
  });
  private readonly name = new Text({
    text: "",
    fontSize: 15,
    fontWeight: 800,
    whiteSpace: "pre",
    wordBreak: "keep-all",
    flexShrink: 0,
  });
  private readonly chip = gameTag("等待加入", { face: "#d8effb", ink: "#142f50" });
  private readonly spinner = createMenuIcon("spinner");
  private readonly check = createMenuIcon("check");
  private readonly dashed = new Container({
    positionType: "absolute",
    width: "100%",
    height: "100%",
  });
  private readonly arrival = { opacity: 1, y: 0, scale: 1 };
  private view: SeatView | undefined;
  private clock = 0;
  private idle = 0;
  private readonly stage: UiStage;
  constructor(stage: UiStage, slot: number) {
    this.stage = stage;
    const color = playerColors[slot]!;
    this.root.setProperties({ borderColor: color });
    this.empty.setProperties({ borderColor: color });
    const person = createMenuIcon("person");
    person.setProperties({ width: 32, height: 32, color: "#657b91" });
    this.empty.add(person);
    this.top.add(gameTag(`P${slot + 1}`, { face: color, ink: "#0d233f", size: "badge" }), this.me);
    for (const icon of [this.spinner, this.check]) icon.setProperties({ width: 14, height: 14 });
    this.chip.add(this.spinner, this.check);
    // Broken outline for the empty seat; solid outline for an occupied one.
    for (let i = 0; i < 10; i++) {
      for (const bottom of [false, true])
        this.dashed.add(
          new Container({
            positionType: "absolute",
            positionLeft: `${i * 10 + 2}%`,
            ...(bottom ? { positionBottom: 0 } : { positionTop: 0 }),
            width: "6%",
            height: 2,
            backgroundColor: color,
          }),
        );
      for (const right of [false, true])
        this.dashed.add(
          new Container({
            positionType: "absolute",
            positionTop: `${i * 10 + 2}%`,
            ...(right ? { positionRight: 0 } : { positionLeft: 0 }),
            height: "6%",
            width: 2,
            backgroundColor: color,
          }),
        );
    }
    this.root.add(this.dashed, stack(this.top, 1), this.portrait, this.empty, this.name, this.chip);
  }
  resize(compact: boolean) {
    this.root.setProperties({ height: compact ? 150 : 182, padding: compact ? 8 : 10 });
    const size = compact ? 60 : 88;
    this.portrait.setProperties({ width: size, height: size });
    this.empty.setProperties({ width: size, height: size });
  }
  update(view: SeatView) {
    const previous = this.view;
    this.view = view;
    this.me.setProperties({ display: view.self ? "flex" : "none" });
    this.root.setProperties({ borderWidth: view.starter ? (view.self ? 3 : 2) : 0 });
    this.dashed.setProperties({ display: view.starter ? "none" : "flex" });
    this.empty.setProperties({ display: view.starter ? "none" : "flex" });
    this.portrait.setProperties({ display: view.starter ? "flex" : "none" });
    this.name.setProperties({ display: view.starter ? "flex" : "none" });
    if (view.starter && previous?.starter !== view.starter) {
      const form = starters[view.starter].stages[0].form;
      this.portrait.setProperties({ src: `/art/portraits/${form.id}.webp` });
      this.name.setProperties({ text: form.name });
      this.arrival.opacity = 0;
      this.arrival.y = 8;
      this.arrival.scale = 0.92;
      this.stage.motion.animate(
        this.arrival,
        { opacity: 1, y: 0, scale: 1 },
        200,
        () => {
          fade(this.portrait, this.arrival.opacity).setProperties({
            transformTranslateY: this.arrival.y,
            transformScaleX: this.arrival.scale,
            transformScaleY: this.arrival.scale,
          });
          this.stage.invalidate();
        },
        uiEaseOut,
      );
    }
    const ready = view.chip === "就绪";
    (this.chip.children[0] as Text).setProperties({
      text: view.chip,
      color: ready ? "#ffffff" : "#142f50",
    });
    this.chip.setProperties({ backgroundColor: ready ? "#287a58" : "#d8effb" });
    this.spinner.setProperties({ display: view.pending ? "flex" : "none" });
    this.check.setProperties({ display: ready ? "flex" : "none", color: "#ffffff" });
  }
  updateMotion(delta: number) {
    this.clock += delta;
    this.idle += delta;
    if (this.idle < 1000 / 15) return;
    this.idle %= 1000 / 15;
    if (this.view?.pending) this.spinner.setProperties({ transformRotateZ: this.clock * 0.3 });
    if (!this.view?.starter) fade(this.empty, 0.65 + Math.sin(this.clock / 600) * 0.2);
  }
  dispose() {
    this.stage.motion.cancel(this.arrival);
  }
}
