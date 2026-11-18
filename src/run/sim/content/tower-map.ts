import { createRng, mixSeed, pick } from "../rng";
import { STAGE_INDEX } from "./campaign";
import type { StageId } from "./stages/index";

const stages = Object.keys(STAGE_INDEX) as StageId[];

export function towerMap(seed: number, floor: number, previous?: StageId): StageId {
  return pick(
    createRng(mixSeed(seed, floor)),
    stages.filter((stage) => stage !== previous),
  );
}
