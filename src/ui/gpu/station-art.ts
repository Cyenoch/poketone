import { Container, Image } from "@pmndrs/uikit";
import type { StationKind } from "../../run/sim/state/entities";
import { stationIcon } from "../../screens/runArt";
import { stack } from "./layer";
import { ChoiceIconPlate } from "./run-choice-surface";

/**
 * A station's icon on the shared round icon plate, the way the 图鉴 draws moves (icon inset to
 * 72%): one look for a station in the 图鉴, the HUD's interact prompt and the station window.
 */
export function createStationArt(
  kind: StationKind,
  size: number,
): { root: Container; dispose(): void } {
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
    stack(
      new Image({ src: stationIcon(kind), width: inset, height: inset, keepAspectRatio: false }),
      1,
    ),
  );
  return { root, dispose: () => plate.dispose() };
}
