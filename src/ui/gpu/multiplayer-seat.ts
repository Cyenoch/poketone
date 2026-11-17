import { Container, Image, Text } from "@pmndrs/uikit";
import { Color } from "three";
import type { ElementType } from "../../run/sim/content/elements";
import { starters } from "../../run/sim/content/lines";
import { trainerArt, trainers } from "../../trainers";
import { playerColors } from "../player-colors";
import { BallBadge, portraitSrc } from "./ball";
import { createMenuIcon } from "./icons";
import { fade, stack } from "./layer";
import { EASE } from "./motion";
import { themeColors } from "./run-theme";
import { SlantPlate } from "./slant-plate";
import type { UiStage } from "./stage";
import { RADIUS_INNER, slantOf, ui } from "./tokens";
import { slantTag, typeTag } from "./tag";
import type { SeatView } from "./multiplayer-view";

/** Chip faces by seat state. */
const chipLooks = {
  host: { face: ui.ink, ink: ui.white },
  joined: { face: ui.white, ink: ui.ink },
  ready: { face: ui.success, ink: ui.white },
} as const;

/**
 * One room seat. Taken: the partner's type card (its colour under the type's card face, framed in
 * the player colour) with the trainer's cut-in art behind the partner, the P# tag and the seat's
 * state chip on top, and the partner's name on the ink slanted plate over its type and trainer at
 * the foot. Empty: a hatched mist card, a grey ball breathing over 等待加入. A seat keeps its nodes
 * through join/transport changes (only the type card is redrawn when the type changes).
 */
export class MultiplayerSeat {
  readonly root = new Container({
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    flexShrink: 0,
    overflow: "hidden",
    borderRadius: 6,
  });
  private readonly empty: SlantPlate;
  private filled: SlantPlate | null = null;
  private type: ElementType | null = null;
  private shiny = false;
  private readonly color: string;
  private readonly art = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
  });
  private readonly trainerArt = new Image({
    positionType: "absolute",
    objectFit: "cover",
    aspectRatio: 1,
  });
  private readonly portrait = new Image({ positionType: "absolute", aspectRatio: 1 });
  private readonly top = new Container({
    positionType: "absolute",
    positionLeft: 8,
    positionTop: 8,
    positionRight: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  });
  private readonly me = slantTag("我", { size: 12 });
  private readonly tag: ReturnType<typeof slantTag>;
  private readonly foot = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionRight: 0,
    positionBottom: 0,
    flexDirection: "column",
    alignItems: "center",
  });
  private readonly nameBox = new Container({
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  });
  private readonly namePlate = new SlantPlate(this.nameBox, { fill: ui.ink });
  private readonly name = new Text({
    text: "",
    fontWeight: 900,
    letterSpacing: 1,
    color: ui.white,
    whiteSpace: "pre",
    wordBreak: "keep-all",
  });
  private readonly facts = new Container({ flexDirection: "row", alignItems: "center", gap: 5 });
  private typeChip: Container | null = null;
  private readonly trainerChip = new Container({
    height: 21,
    paddingX: 7,
    borderRadius: 4,
    backgroundColor: ui.white,
    alignItems: "center",
    flexShrink: 0,
  });
  private readonly trainerName = new Text({
    text: "",
    fontSize: 12,
    fontWeight: 800,
    color: ui.ink,
    whiteSpace: "pre",
    wordBreak: "keep-all",
  });
  private readonly chip = new Container({
    height: 23,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingX: 8,
    marginLeft: "auto",
    flexShrink: 0,
  });
  private readonly chipPlate = new SlantPlate(
    this.chip,
    { fill: ui.white, upright: true },
    RADIUS_INNER,
  );
  private readonly chipText = new Text({
    text: "",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "pre",
    wordBreak: "keep-all",
  });
  private readonly spinner = createMenuIcon("spinner");
  private readonly check = createMenuIcon("check");
  private readonly waiting = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionRight: 0,
    positionTop: 0,
    positionBottom: 0,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  });
  private readonly waitingText = new Text({
    text: "等待加入",
    fontWeight: 800,
    color: ui.muted,
    whiteSpace: "pre",
  });
  private readonly ball: BallBadge;
  private chipLook: keyof typeof chipLooks | "" = "";
  private readonly arrival = { opacity: 1, y: 0 };
  private view: SeatView | undefined;
  private trainer: string | null = null;
  private clock = 0;
  private idle = 0;
  private readonly stage: UiStage;

  constructor(stage: UiStage, slot: number) {
    this.stage = stage;
    this.color = playerColors[slot]!;
    this.empty = new SlantPlate(this.root, {
      fill: ui.mist,
      border: { color: ui.line, width: 2 },
      hatch: { color: ui.line, alpha: 0.45, step: 12 },
      upright: true,
    });
    this.empty.set({ depth: 0 });
    this.tag = slantTag(`P${slot + 1}`, { face: this.color, ink: ui.ink, size: 12 });
    this.ball = new BallBadge(stage.motion, () => stage.invalidate(), 64);
    this.ball.set({ locked: true });
    this.waiting.add(stack(this.ball.panel, 1), stack(this.waitingText, 1));
    this.art.add(this.trainerArt, this.portrait);
    this.trainerChip.add(this.trainerName);
    this.facts.add(this.trainerChip);
    this.namePlate.set({ depth: 3 });
    this.nameBox.add(this.namePlate.content, stack(this.name, 1));
    this.foot.add(stack(this.nameBox, 1), stack(this.facts, 1));
    this.chipPlate.set({ depth: 2 });
    for (const icon of [this.spinner, this.check]) icon.setProperties({ width: 13, height: 13 });
    this.chip.add(
      this.chipPlate.content,
      stack(this.spinner, 1),
      stack(this.check, 1),
      stack(this.chipText, 1),
    );
    this.top.add(this.tag.tag, this.me.tag, this.chip);
    this.root.add(
      this.empty.content,
      stack(this.waiting, 1),
      stack(this.art, 1),
      stack(this.foot, 2),
      stack(this.top, 2),
    );
  }

  /** The card takes the room's height (up to 220 compact / 340); the art is sized for compact. */
  resize(compact: boolean) {
    this.art.setProperties({ width: "100%", height: "100%" });
    // The cut-in ends mid-thigh at its bottom edge: that edge sits on the card's foot (the card
    // frame is the only cut) and the figure takes most of the card's height, head down from the top.
    this.trainerArt.setProperties({
      height: "88%",
      positionLeft: compact ? -40 : -56,
      positionBottom: 0,
    });
    const partner = compact ? 104 : 156;
    this.portrait.setProperties({
      width: partner,
      height: partner,
      positionRight: compact ? -4 : 0,
      positionBottom: compact ? 50 : 70,
    });
    const plate = compact ? 28 : 36;
    this.nameBox.setProperties({
      height: plate,
      paddingX: (compact ? 12 : 16) + slantOf(plate) / 2,
    });
    this.name.setProperties({ fontSize: compact ? 15 : 19 });
    this.foot.setProperties({ gap: compact ? 5 : 8, paddingBottom: compact ? 8 : 12 });
    this.ball.panel.setProperties({ width: compact ? 52 : 72, height: compact ? 52 : 72 });
    this.waitingText.setProperties({ fontSize: compact ? 13 : 15 });
  }

  /** `shiny`: the seat's own look, as its player chose it (only they can change it). */
  update(view: SeatView, shiny = false) {
    const previous = this.view;
    const wasShiny = this.shiny;
    this.view = view;
    this.shiny = shiny;
    const taken = !!view.starter;
    this.me.tag.setProperties({ display: view.self ? "flex" : "none" });
    this.empty.content.setProperties({ display: taken ? "none" : "flex" });
    this.waiting.setProperties({ display: taken ? "none" : "flex" });
    this.art.setProperties({ display: taken ? "flex" : "none" });
    this.foot.setProperties({ display: taken ? "flex" : "none" });
    this.chip.setProperties({ display: taken ? "flex" : "none" });
    if (taken) fade(this.ball.panel, 1);
    if (view.trainer !== this.trainer) {
      this.trainer = view.trainer;
      if (view.trainer) {
        this.trainerArt.setProperties({ src: trainerArt(view.trainer, "cutin") });
        this.trainerName.setProperties({ text: trainers[view.trainer].name });
      }
    }
    if (view.starter && previous?.starter === view.starter && wasShiny !== shiny) {
      const form = starters[view.starter].stages[0].form;
      this.portrait.setProperties({ src: portraitSrc(form.id, shiny) });
    }
    if (view.starter && previous?.starter !== view.starter) {
      const form = starters[view.starter].stages[0].form;
      this.portrait.setProperties({ src: portraitSrc(form.id, shiny) });
      this.name.setProperties({ text: form.name });
      this.setType(form.types[0]!);
      this.arrival.opacity = 0;
      this.arrival.y = 10;
      this.stage.motion.animate(
        this.arrival,
        { opacity: 1, y: 0 },
        220,
        () => {
          fade(this.portrait, this.arrival.opacity).setProperties({
            transformTranslateY: this.arrival.y,
          });
          this.stage.invalidate();
        },
        EASE,
      );
    }
    this.filled?.content.setProperties({ display: taken ? "flex" : "none" });
    const look = view.chip === "就绪" ? "ready" : view.chip === "房主" ? "host" : "joined";
    this.chipText.setProperties({ text: view.chip });
    if (look !== this.chipLook) {
      this.chipLook = look;
      const { face, ink } = chipLooks[look];
      this.chipPlate.set({ fill: face });
      // UIKit compares colours by reference: a new one per change.
      this.chipText.setProperties({ color: new Color(ink) });
      this.spinner.setProperties({ color: new Color(ink) });
      this.check.setProperties({ color: new Color(ink) });
    }
    this.spinner.setProperties({ display: view.pending ? "flex" : "none" });
    this.check.setProperties({ display: look === "ready" ? "flex" : "none" });
  }

  /** The type card behind a taken seat; a new partner type draws a new one. */
  private setType(type: ElementType) {
    if (type === this.type) return;
    this.type = type;
    this.filled?.content.removeFromParent();
    this.filled?.dispose();
    const filled = new SlantPlate(this.root, {
      fill: themeColors(type).theme,
      border: { color: this.color, width: 3 },
      card: { type, loaded: () => this.stage.invalidate() },
      upright: true,
    });
    filled.set({ depth: 0 });
    this.filled = filled;
    this.root.add(filled.content);
    this.typeChip?.removeFromParent();
    this.typeChip = typeTag(type);
    this.facts.add(this.typeChip);
  }

  /** On the 15Hz idle clock: the pending spinner turns, an empty seat's ball breathes. */
  updateMotion(delta: number) {
    this.clock += delta;
    this.idle += delta;
    if (this.idle < 1000 / 15) return;
    this.idle %= 1000 / 15;
    if (this.view?.pending) this.spinner.setProperties({ transformRotateZ: this.clock * 0.3 });
    if (!this.view?.starter) fade(this.ball.panel, 0.65 + Math.sin(this.clock / 600) * 0.2);
  }

  dispose() {
    this.stage.motion.cancel(this.arrival);
    this.empty.dispose();
    this.filled?.dispose();
    this.namePlate.dispose();
    this.me.dispose();
    this.tag.dispose();
    this.ball.dispose();
    this.chipPlate.dispose();
  }
}
