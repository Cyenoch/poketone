// The archetype registry: how every move casts (`archetypes`) and how every area kind strikes
// (`areaRules`). A new archetype is one module here plus its entry; the `Record` fails to compile
// until it has one, and so do the balance model (balance/output.ts) and the view's default looks
// (view/vfx/defaults.ts).

import type { Archetype } from "../content/moves";
import { barrage } from "./barrage";
import { beam, beamArea } from "./beam";
import { bloom, bloomArea } from "./bloom";
import { bolt } from "./bolt";
import { burstArea } from "./burst";
import { chain } from "./chain";
import { cone, coneArea } from "./cone";
import { firestorm, firestormArea } from "./firestorm";
import { homing } from "./homing";
import type { ArchetypeDef, AreaRule } from "./kit";
import { lob } from "./lob";
import { nova, novaArea } from "./nova";
import { orb } from "./orb";
import { rod, rodArea } from "./rod";
import { smite, smiteArea } from "./smite";
import { spin, spinArea } from "./spin";
import { sprinkler, sprinklerArea } from "./sprinkler";
import { strike, strikeArea } from "./strike";
import { vortex, vortexArea } from "./vortex";
import { wave } from "./wave";

export const archetypes: Record<Archetype, ArchetypeDef> = {
  bolt,
  cone,
  vortex,
  orb,
  strike,
  barrage,
  beam,
  spin,
  chain,
  smite,
  nova,
  homing,
  // Drain shots fly as homing ones; the heal is the move's `drain` share on each hit.
  drain: homing,
  lob,
  wave,
  bloom,
  firestorm,
  sprinkler,
  rod,
};

export const areaRules = {
  cone: coneArea,
  vortex: vortexArea,
  beam: beamArea,
  spin: spinArea,
  strike: strikeArea,
  burst: burstArea,
  smite: smiteArea,
  nova: novaArea,
  bloom: bloomArea,
  firestorm: firestormArea,
  sprinkler: sprinklerArea,
  rod: rodArea,
} as const satisfies Record<string, AreaRule>;

export type AreaKind = keyof typeof areaRules;
