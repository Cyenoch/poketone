import type { MoveId } from "../../sim/content/moves";
import type { UltimateId } from "../../sim/content/ultimates";
import type { UltPulseEvent } from "../../sim/state/events";
import type { AreaLook, Fx, ShotLook } from "./fx";
import type { Rgb } from "./gl";
import { dragon, fighting, ghost, psychic as psychicColour, rock } from "./palette";
import {
  confusion,
  hypnosis,
  psybeam,
  psychic,
  psychicField,
  psystrike,
  psystrikeBurst,
} from "./psychic";
import {
  earthquake,
  magnitude,
  rockBurst,
  rockSlide,
  rockThrow,
  rockslideQuake,
  rollout,
  stoneEdge,
  tectonicBurst,
  tectonicRage,
} from "./rock";
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
  dragonStream,
  hurricane,
  twister,
} from "./dragon";
import { combo, focusBlast, focusBurst, lowSweep, seismicBarrage, seismicToss } from "./fighting";

export const lineShotLooks: Partial<Record<MoveId, ShotLook>> = {
  confusion,
  psystrike: confusion,
  "rock-throw": rockThrow,
  rollout,
  "shadow-ball": shadowBall,
  "sludge-bomb": sludgeBomb,
  "dream-eater": dreamEater,
  "dragon-breath": dragonBreath,
  "dragon-rush": dragonRush,
  "focus-blast": focusBlast,
};

export const lineAreaLooks: Partial<Record<MoveId, AreaLook>> = {
  hypnosis,
  psybeam,
  psychic,
  "future-sight": psychic,
  psystrike,
  magnitude,
  "rock-slide": rockSlide,
  earthquake,
  "stone-edge": stoneEdge,
  "tectonic-rage": tectonicRage,
  smog,
  hex,
  "night-shade": nightShade,
  "nightmare-vortex": nightmareVortex,
  twister,
  "dragon-pulse": dragonPulse,
  "dragon-tempest": dragonStream,
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
  psystrike: psystrikeBurst,
  "rock-throw": rockBurst,
  "tectonic-rage": tectonicBurst,
  smog: smogBurst,
  "sludge-bomb": sludgeBurst,
  "nightmare-vortex": shadowBurst,
  twister: dragonBurst,
  "dragon-tempest": dragonBurst,
  "focus-blast": focusBurst,
};

export const lineUltColour: Record<
  Extract<
    UltimateId,
    "draco-meteor" | "phantom-night" | "seismic-barrage" | "psychic-field" | "rockslide-quake"
  >,
  readonly [Rgb, Rgb]
> = {
  "psychic-field": [psychicColour.pink, psychicColour.light],
  "rockslide-quake": [rock.earth, rock.light],
  "phantom-night": [ghost.veil, ghost.light],
  "draco-meteor": [dragon.teal, dragon.scale],
  "seismic-barrage": [fighting.amber, fighting.cream],
};

export function lineUltPulse(fx: Fx, e: UltPulseEvent, ultimate: UltimateId): boolean {
  switch (ultimate) {
    case "psychic-field":
      psychicField(fx, e);
      return true;
    case "rockslide-quake":
      rockslideQuake(fx, e);
      return true;
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
