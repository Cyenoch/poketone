import type { Beat, StampedeBeat, SwarmBeat } from "../../beats";
import { FIELD_EVENTS } from "../params/field-events";
import type { StageZone } from "./index";

export const beatWindow = (at: number, beat: Beat): StageZone["beats"][number] => ({
  window: [at - FIELD_EVENTS.beatSpread, at + FIELD_EVENTS.beatSpread],
  beat,
});

export const firstBeats = (swarm: SwarmBeat, stampede: StampedeBeat): StageZone["beats"] => [
  beatWindow(150, { kind: "alpha" }),
  beatWindow(235, swarm),
  beatWindow(330, { kind: "alpha" }),
  beatWindow(330, { kind: "elite-wave" }),
  beatWindow(390, stampede),
  beatWindow(450, { kind: "elite-wave" }),
  beatWindow(480, { kind: "alpha" }),
  beatWindow(520, swarm),
];

export const laterBeats = (
  swarm: SwarmBeat,
  stampede: StampedeBeat,
  lateSwarm = swarm,
): StageZone["beats"] => [
  beatWindow(120, { kind: "alpha" }),
  beatWindow(200, swarm),
  beatWindow(270, { kind: "elite-wave" }),
  beatWindow(300, { kind: "alpha" }),
  beatWindow(330, stampede),
  beatWindow(390, { kind: "elite-wave" }),
  beatWindow(400, { kind: "alpha" }),
  beatWindow(430, lateSwarm),
];

export const towerBeats = (swarm: SwarmBeat, stampede: StampedeBeat): StageZone["beats"] => [
  beatWindow(70, { kind: "alpha" }),
  beatWindow(110, swarm),
  beatWindow(140, { kind: "elite-wave" }),
  beatWindow(170, { kind: "alpha" }),
  beatWindow(200, stampede),
  beatWindow(230, swarm),
  beatWindow(260, { kind: "elite-wave" }),
];
