import type { MoveId } from "../../sim/content/moves";
import type { UltimateId } from "../../sim/content/ultimates";
import type { UltPulseEvent } from "../../sim/state/events";
import type { AreaLook, Fx, ShotLook } from "./fx";
import type { Rgb } from "./gl";
import { dragon, fighting, ghost } from "./palette";
import {
  dreamEater,
  hex,
  nightmareVortex,
  nightShade,
  phantomNight,
  shadowBall,
  shadowBurst,
  sludgeBomb,
  sludgeBurst,
  smog,
  smogBurst,
} from "./ghost";
import {
  aquaTail,
  dracoMeteor,
  dragonBreath,
  dragonBurst,
  dragonPulse,
  dragonRush,
  dragonScales,
  hurricane,
  twister,
} from "./dragon";
import { combo, focusBlast, focusBurst, lowSweep, seismicBarrage, seismicToss } from "./fighting";

export const lineShotLooks: Partial<Record<MoveId, ShotLook>> = {
  "shadow-ball": shadowBall,
  "sludge-bomb": sludgeBomb,
  "dream-eater": dreamEater,
  "dragon-breath": dragonBreath,
  "dragon-rush": dragonRush,
  "dragon-tempest": dragonScales,
  "focus-blast": focusBlast,
};

export const lineAreaLooks: Partial<Record<MoveId, AreaLook>> = {
  smog,
  hex,
  "night-shade": nightShade,
  "nightmare-vortex": nightmareVortex,
  twister,
  "dragon-pulse": dragonPulse,
  "dragon-tempest": dragonPulse,
  "aqua-tail": aquaTail,
  hurricane,
  "karate-chop": combo,
  "brick-break": combo,
  "cross-chop": combo,
  "hundred-fists": combo,
  "low-sweep": lowSweep,
  "seismic-toss": seismicToss,
};

export const lineBurstLooks: Partial<Record<MoveId, AreaLook>> = {
  smog: smogBurst,
  "sludge-bomb": sludgeBurst,
  "nightmare-vortex": shadowBurst,
  twister: dragonBurst,
  "dragon-tempest": dragonBurst,
  "focus-blast": focusBurst,
};

export const lineUltColour: Record<
  Extract<UltimateId, "draco-meteor" | "phantom-night" | "seismic-barrage">,
  readonly [Rgb, Rgb]
> = {
  "phantom-night": [ghost.veil, ghost.light],
  "draco-meteor": [dragon.teal, dragon.scale],
  "seismic-barrage": [fighting.amber, fighting.cream],
};

export function lineUltPulse(fx: Fx, e: UltPulseEvent, ultimate: UltimateId): boolean {
  switch (ultimate) {
    case "phantom-night":
      phantomNight(fx, e);
      return true;
    case "draco-meteor":
      dracoMeteor(fx, e);
      return true;
    case "seismic-barrage":
      seismicBarrage(fx, e);
      return true;
    default:
      return false;
  }
}
