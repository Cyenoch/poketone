import { InputGlyph } from "./input-glyph";
import { Container, Image, Text } from "@pmndrs/uikit";
import type { InteractPrompt } from "../../run/createRun";
import type { StationKind } from "../../run/sim/state/entities";
import { stationNames } from "../../run/sim/content/stations";
import { sites } from "../../run/sim/content/sites";
import type { SiteKind } from "../../run/sim/state/field";
import { cubicBezier, uiEaseOut } from "./focus-mark";
import { fade, stack } from "./layer";
import { LIFT } from "./motion";
import { SlantPlate } from "./slant-plate";
import { createStationArt } from "./station-art";
import { ChoiceIconPlate } from "./run-choice-surface";
import { siteIcons } from "../../run/view/fieldMapMarks";
import type { ZoneExit } from "../../run/sim/state/route";
import { exitName, markerIcons, markerName } from "../../run/view/routeLook";
import { ballGlyph } from "./ball";
import { gameTag } from "./tag";
import type { UiStage } from "./stage";
import { RADIUS_INNER, ui } from "./tokens";

const easeIn = (t: number) => cubicBezier(t, 0.42, 0, 1, 1);

type LandmarkPrompt = Exclude<InteractPrompt, StationKind | SiteKind>;
const landmarkNames: Record<LandmarkPrompt, string> = {
  summon: "召唤守卫",
  leave: "前往下一区域",
  choices: "选择构筑",
  rescue: "救援",
  trade: "交换",
  "trade-accept": "接受交换",
  "trade-wait": "等待交换",
};

const HEIGHT = 48;

/**
 * The station prompt: an upright paper key with an ink frame centred 16px above the slot row, the
 * station's icon on the shared icon plate (`station-art.ts`), its name and an R badge. It rises 6px
 * into place over 160ms (ease-out) and sinks back out over 160ms (ease-in).
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
    minHeight: HEIGHT,
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 4,
    paddingRight: 16,
  });
  private readonly face = new SlantPlate(this.panel, {
    fill: ui.white,
    border: { color: ui.ink, width: 2 },
    upright: true,
  });
  private readonly plate = new Container({ width: 36, height: 36, flexShrink: 0 });
  private readonly label = new Container({ flexShrink: 0 });
  private readonly name = stack(
    new Text({
      text: "",
      fontSize: 16,
      fontWeight: 800,
      color: ui.ink,
      wordBreak: "keep-all",
    }),
    1,
  );
  /** The name's hard 2px drop. */
  private readonly nameShadow = new Text({
    text: "",
    fontSize: 16,
    fontWeight: 800,
    color: ui.line,
    wordBreak: "keep-all",
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 2,
  });
  private readonly stage: UiStage;
  private readonly pose = { alpha: 0, y: 6 };
  private kind: InteractPrompt | null = null;
  /** The exit the leave prompt was dressed for (`to:marker`). */
  private leaveKey = "";
  /** The exit's reward, said once here where the player decides. */
  private readonly markerSlot = new Container({ flexShrink: 0, display: "none" });
  private art: ReturnType<typeof createStationArt> | null = null;
  private shown = false;
  private pressed = false;
  private coarse = false;

  constructor(stage: UiStage) {
    this.stage = stage;
    this.label.add(this.nameShadow, this.name);
    this.panel.add(
      this.face.content,
      stack(this.plate, 1),
      stack(this.label, 1),
      stack(this.markerSlot, 1),
      stack(this.key, 1),
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
      paddingLeft:
        this.kind &&
        (this.kind in stationNames || (this.kind in sites && siteIcons[this.kind as SiteKind]))
          ? 4
          : coarse
            ? 12
            : 16,
      paddingRight: coarse ? 12 : 16,
    });
  }

  private badge(): Container {
    // Key badge: 16px tall, 11px type, 4px padding, a 1.5px ink ring on mist.
    const badge = new Container({
      height: 16,
      minWidth: 16,
      paddingX: 4,
      borderRadius: RADIUS_INNER,
      borderWidth: 1.5,
      borderColor: ui.ink,
      backgroundColor: ui.mist,
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
    exit: ZoneExit | null,
  ): void {
    const show = kind !== null && !blocked;
    if (kind && kind !== this.kind) {
      this.kind = kind;
      this.leaveKey = "";
      this.setMarker(null);
      const name =
        kind in sites
          ? sites[kind as SiteKind].name
          : kind in landmarkNames
            ? landmarkNames[kind as LandmarkPrompt]
            : stationNames[kind as StationKind];
      this.name.setProperties({ text: name });
      this.nameShadow.setProperties({ text: name });
      if (this.art) {
        this.art.root.removeFromParent();
        this.art.dispose();
        this.art = null;
      }
      // The landmark has no icon: its prompt is its name alone. A field site shows its map badge art.
      const station = kind in stationNames;
      const siteArt = kind in sites ? siteIcons[kind as SiteKind] : undefined;
      const iconed = station || siteArt !== undefined;
      this.plate.setProperties({ display: iconed ? "flex" : "none" });
      this.panel.setProperties({ paddingLeft: iconed ? 4 : this.coarse ? 12 : 16 });
      if (station) {
        this.art = createStationArt(kind as StationKind, 36);
        this.plate.add(this.art.root);
      } else if (siteArt) {
        this.art = createSiteArt(siteArt, 36);
        this.plate.add(this.art.root);
      }
    }
    // A channel (fishing, digging) counts up on its own prompt.
    if (kind && kind in sites) {
      const name = sites[kind as SiteKind].name;
      const label = progress === null ? name : `${name} · ${Math.floor(progress * 100)}%`;
      this.name.setProperties({ text: label });
      this.nameShadow.setProperties({ text: label });
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
    if (kind === "leave") this.dressLeave(exit);
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

  /** 前往{map} with the marker's art on the plate and its name chipped after; 离开 at the end. */
  private dressLeave(exit: ZoneExit | null): void {
    const key = exit ? `${exit.to}:${exit.marker}` : "none";
    if (key === this.leaveKey) return;
    this.leaveKey = key;
    const label = exit?.to ? `前往${exitName(exit)}` : "离开";
    this.name.setProperties({ text: label });
    this.nameShadow.setProperties({ text: label });
    if (this.art) {
      this.art.root.removeFromParent();
      this.art.dispose();
      this.art = null;
    }
    const marker = exit?.marker ?? null;
    if (marker === "chests") {
      const ball = ballGlyph(26);
      const root = new Container({
        width: 36,
        height: 36,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        backgroundColor: ui.ink,
      });
      root.add(ball.glyph);
      this.art = { root, dispose: () => ball.dispose() };
    } else if (marker) this.art = createSiteArt(markerIcons[marker]!, 36);
    if (this.art) this.plate.add(this.art.root);
    this.plate.setProperties({ display: this.art ? "flex" : "none" });
    this.panel.setProperties({ paddingLeft: this.art ? 4 : this.coarse ? 12 : 16 });
    this.setMarker(marker ? markerName(marker) : null);
  }

  private setMarker(name: string | null): void {
    for (const child of this.markerSlot.children.slice()) {
      child.removeFromParent();
      (child as Container).dispose?.();
    }
    if (name) this.markerSlot.add(gameTag(name, { face: ui.ink, ink: ui.white }));
    this.markerSlot.setProperties({ display: name ? "flex" : "none" });
  }

  get visible(): boolean {
    return this.shown;
  }

  setHovered(hovered: boolean): void {
    this.face.set({ fill: hovered ? ui.mist : ui.white });
    this.stage.invalidate();
  }

  setPressed(pressed: boolean): void {
    this.pressed = pressed;
    this.face.set({ depth: pressed ? 4 - LIFT.press : 4 });
    this.apply();
  }

  setFocusRing(visible: boolean): void {
    this.face.set({ focus: visible ? 1 : 0 });
    this.stage.invalidate();
  }

  /** Keeps the prompt `gap` above the slot row's top edge (`bottom` is measured from the viewport). */
  place(bottom: number): void {
    this.row.setProperties({ positionBottom: bottom });
  }

  private apply(): void {
    fade(this.row, this.pose.alpha);
    this.panel.setProperties({
      transformTranslateY: this.pose.y + (this.pressed ? LIFT.press : 0),
    });
    this.stage.invalidate();
  }

  dispose(): void {
    this.art?.dispose();
    this.stage.motion.cancel(this.pose);
    this.face.dispose();
  }
}

/** A site's icon on the shared round icon plate, as `createStationArt` draws a station's. */
function createSiteArt(src: string, size: number): { root: Container; dispose(): void } {
  const root = new Container({
    width: size,
    height: size,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  });
  const plate = new ChoiceIconPlate("move", null);
  const inset = Math.round(size * 0.72);
  root.add(
    plate.content,
    stack(new Image({ src, width: inset, height: inset, keepAspectRatio: false }), 1),
  );
  return { root, dispose: () => plate.dispose() };
}
