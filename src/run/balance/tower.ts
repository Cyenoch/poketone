import type { EntryWindow } from "./entry-windows";
import type { GuardianFight } from "./model";
import type { SkillProfile } from "./skill";
import { towerMap } from "../sim/content/tower-map";
import type { Difficulty } from "../sim/content/difficulties";
import type { StarterId } from "../sim/content/lines/index";
import {
  isTowerGuardianFloor,
  TOWER,
  towerClock,
  towerFactorsFor,
  towerPosition,
  towerRouteStep,
  type TowerSlope,
} from "../sim/content/params/tower";
import type { StageId } from "../sim/content/stages/index";

export const TOWER_TRIAL = {
  floors: 50,
  seconds: TOWER.floorSeconds,
  guardianBonus: TOWER.guardianBonus,
  heal: TOWER.guardianHeal,
} as const;

export interface TowerRunOptions {
  starter: StarterId;
  difficulty: Difficulty;
  skill: SkillProfile;
  seed: number;
  samples: number;
  slope: TowerSlope;
}

export interface TowerFloorResult {
  stage: StageId;
  guardian: boolean;
  reach: number;
  clear: number;
  censored: number;
  clearAt: number | null;
  clearSeconds: number | null;
  level: number | null;
  window: EntryWindow | null;
  fight: GuardianFight | null;
}

export type TowerRunner = (options: TowerRunOptions) => TowerFloorResult[];

export function towerRoute(floor: number, stage: StageId, slope: TowerSlope) {
  return {
    stage,
    zone: 0,
    position: towerPosition(floor),
    step: towerRouteStep(floor),
    guardian: isTowerGuardianFloor(floor),
    factors: towerFactorsFor(floor, { id: stage }, slope),
    clock: (time: number) => towerClock(floor, time, slope.clock),
  };
}

export type TowerField = ReturnType<typeof towerRoute>;

export function towerFields(seed: number, slope: TowerSlope) {
  let previous: StageId | undefined;
  return Array.from({ length: TOWER_TRIAL.floors }, (_, index) => {
    const floor = index + 1;
    previous = towerMap(seed, floor, previous);
    return towerRoute(floor, previous, slope);
  });
}
