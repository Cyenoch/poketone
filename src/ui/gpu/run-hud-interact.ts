import { InputGlyph } from "./input-glyph";
import { Container, Text } from "@pmndrs/uikit";
import type { InteractPrompt } from "../../run/createRun";
import type { StationKind } from "../../run/sim/state/entities";
import { stationNames } from "../../run/sim/content/stations";
import { BoxShadow, OutlineRing } from "./box-shadow";
import { cubicBezier, uiEaseOut } from "./focus-mark";
import { fade, stack } from "./layer";
import { createStationArt } from "./station-art";
import type { UiStage } from "./stage";

const easeIn = (t: number) => cubicBezier(t, 0.42, 0, 1, 1);

type LandmarkPrompt = Exclude<InteractPrompt, StationKind>;
const landmarkNames: Record<LandmarkPrompt, string> = {
  summon: "召唤守卫",
  leave: "前往下一区域",
  choices: "选择构筑",
  rescue: "救援",
};

/**
 * The station prompt (`.run-interact`): a navy key centred 16px above the slot row, the station's
 * icon on the shared icon plate (`station-art.ts`), its name and an R badge. It rises 6px into place over 160ms
 * (`run-interact-in`, ease-out) and sinks back out over 160ms (`run-interact-out`, ease-in).
 */
export class RunHudInteract {
  /** Full-width, absolutely placed row; `place()` keeps it above the slot row. */
  readonly row = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionRight: 0,
    flexDirection: "row",
    justifyContent: "center",
    display: "none",
  });
  readonly panel = new Container({
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 4,
    paddingRight: 16,
    borderWidth: 2,
    borderColor: "#0d233f",
    borderRadius: 8,
    backgroundColor: "#142f50",
  });
  private readonly plate = new Container({ width: 36, height: 36, flexShrink: 0 });
  private readonly label = new Container({ flexShrink: 0 });
  private readonly name = stack(
    new Text({
      text: "",
      fontSize: 16,
      fontWeight: 800,
      color: "#ffffff",
      wordBreak: "keep-all",
    }),
    1,
  );
  /** `text-shadow: 0 2px 0 var(--navy-deep)`. */
  private readonly nameShadow = new Text({
    text: "",
    fontSize: 16,
    fontWeight: 800,
    color: "#0d233f",
    wordBreak: "keep-all",
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 2,
  });
  private readonly shadow = new BoxShadow(8, [
    { y: 3, blur: 0, color: "#0d233f", alpha: 1 },
    { y: 4, blur: 10, color: "#0d233f", alpha: 0.22 },
  ]);
  readonly ring = new OutlineRing(8, "#ffd45b");
  private readonly stage: UiStage;
  private readonly pose = { alpha: 0, y: 6 };
  private kind: InteractPrompt | null = null;
  private art: ReturnType<typeof createStationArt> | null = null;
  private shown = false;
  private pressed = false;
  private coarse = false;

  constructor(stage: UiStage) {
    this.stage = stage;
    this.ring.content.setProperties({ display: "none" });
    this.label.add(this.nameShadow, this.name);
    this.panel.add(
      this.shadow.content,
      this.plate,
      this.label,
      this.key,
      stack(this.ring.content, 2),
    );
    this.row.add(this.panel);
  }

  /** The R key hint; hidden for coarse pointers, like every keyboard hint. */
  private readonly key = this.badge();

  setCoarsePointer(coarse: boolean): void {
    this.coarse = coarse;
    this.key.setProperties({ display: coarse ? "none" : "flex" });
    this.panel.setProperties({
      gap: coarse ? 8 : 12,
      paddingLeft: this.kind && !(this.kind in landmarkNames) ? 4 : coarse ? 12 : 16,
      paddingRight: coarse ? 12 : 16,
    });
  }

  private badge(): Container {
    // Tag badge, ice tone: 16px tall, 11px type, 4px padding, 1.5px navy-deep ring.
    const badge = new Container({
      height: 16,
      minWidth: 16,
      paddingX: 4,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: "#0d233f",
      backgroundColor: "#d8effb",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    });
    badge.add(new InputGlyph("interact", "R"));
    return badge;
  }

  /** What interacting does here (a station, or the zone landmark), or null; `blocked` hides it while a window is open. */
  set(
    kind: InteractPrompt | null,
    blocked: boolean,
    count: number,
    progress: number | null,
    exitLabel: string,
  ): void {
    const show = kind !== null && !blocked;
    if (kind && kind !== this.kind) {
      this.kind = kind;
      const name =
        kind in landmarkNames
          ? landmarkNames[kind as LandmarkPrompt]
          : stationNames[kind as StationKind];
      this.name.setProperties({ text: name });
      this.nameShadow.setProperties({ text: name });
      if (this.art) {
        this.art.root.removeFromParent();
        this.art.dispose();
        this.art = null;
      }
      // The landmark has no icon: its prompt is its name alone.
      const station = !(kind in landmarkNames);
      this.plate.setProperties({ display: station ? "flex" : "none" });
      this.panel.setProperties({ paddingLeft: station ? 4 : this.coarse ? 12 : 16 });
      if (station) {
        this.art = createStationArt(kind as StationKind, 36);
        this.plate.add(this.art.root);
      }
    }
    if (kind === "choices" || kind === "rescue") {
      const label =
        kind === "choices"
          ? `选择构筑 · ${count}`
          : progress === null
            ? "救援"
            : `救援 · ${Math.floor(progress * 100)}%`;
      this.name.setProperties({ text: label });
      this.nameShadow.setProperties({ text: label });
    }
    if (kind === "leave") {
      this.name.setProperties({ text: exitLabel });
      this.nameShadow.setProperties({ text: exitLabel });
    }
    if (show === this.shown) return;
    this.shown = show;
    if (show) this.row.setProperties({ display: "flex" });
    this.stage.motion.animate(
      this.pose,
      { alpha: show ? 1 : 0, y: show ? 0 : 6 },
      160,
      () => {
        this.apply();
        if (!this.shown && this.pose.alpha === 0) this.row.setProperties({ display: "none" });
      },
      show ? uiEaseOut : easeIn,
    );
  }

  get visible(): boolean {
    return this.shown;
  }

  setHovered(hovered: boolean): void {
    this.panel.setProperties({ backgroundColor: hovered ? "#173f70" : "#142f50" });
    this.stage.invalidate();
  }

  setPressed(pressed: boolean): void {
    this.pressed = pressed;
    this.shadow.set(
      pressed
        ? []
        : [
            { y: 3, blur: 0, color: "#0d233f", alpha: 1 },
            { y: 4, blur: 10, color: "#0d233f", alpha: 0.22 },
          ],
    );
    this.apply();
  }

  setFocusRing(visible: boolean): void {
    this.ring.content.setProperties({ display: visible ? "flex" : "none" });
    this.stage.invalidate();
  }

  /** Keeps the prompt `gap` above the slot row's top edge (`bottom` is measured from the viewport). */
  place(bottom: number): void {
    this.row.setProperties({ positionBottom: bottom });
  }

  private apply(): void {
    fade(this.row, this.pose.alpha);
    this.panel.setProperties({ transformTranslateY: this.pose.y + (this.pressed ? 3 : 0) });
    this.stage.invalidate();
  }

  dispose(): void {
    this.art?.dispose();
    this.stage.motion.cancel(this.pose);
    this.shadow.dispose();
    this.ring.dispose();
  }
}
