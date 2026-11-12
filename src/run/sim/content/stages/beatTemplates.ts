import type { StampedeBeat, SwarmBeat } from "../../beats";
import type { StageZone } from "./index";

// The zone beat templates every map fills with its own species (docs/state-machines/simulation.md「节拍模板」).

/** A first zone keeps the forest's first-zone beat times. */
export const firstBeats = (swarm: SwarmBeat, stampede: StampedeBeat) =>
  [
    [150, { kind: "alpha" }],
    [235, swarm],
    [330, { kind: "alpha" }],
    [330, { kind: "elite-wave" }],
    [390, stampede],
    [450, { kind: "elite-wave" }],
    [480, { kind: "alpha" }],
    [520, swarm],
  ] as const satisfies StageZone["beats"];

/** Zones 2–3 beat earlier than the first; `lateSwarm` rings the second swarm when it differs. */
export const laterBeats = (swarm: SwarmBeat, stampede: StampedeBeat, lateSwarm = swarm) =>
  [
    [120, { kind: "alpha" }],
    [200, swarm],
    [270, { kind: "elite-wave" }],
    [300, { kind: "alpha" }],
    [330, stampede],
    [390, { kind: "elite-wave" }],
    [400, { kind: "alpha" }],
    [430, lateSwarm],
  ] as const satisfies StageZone["beats"];

/** Seven short tower floors: every species is introduced by 135 seconds. */
export const towerBeats = (swarm: SwarmBeat, stampede: StampedeBeat) =>
  [
    [70, { kind: "alpha" }],
    [110, swarm],
    [140, { kind: "elite-wave" }],
    [170, { kind: "alpha" }],
    [200, stampede],
    [230, swarm],
    [260, { kind: "elite-wave" }],
  ] as const satisfies StageZone["beats"];
