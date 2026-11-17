import type { StageDef } from "../stages/index";
import type { RouteStep } from "../campaign";
import { ROUTE_ENTRY_CLOCK, ROUTE_GROWTH, ENTRY_RAMP_SECONDS } from "./campaign";

export interface ZoneDef {
  /**
   * × swarm and elite HP. Guardians use guardianHp separately. These factors are calibrated
   * with the continuing build and entry clock, not copied from another game's growth.
   */
  hp: number;
  dmg: number;
  /** × swarm speed (reference: +0.06 a zone). */
  speed: number;
  /** × spawn credits per second (reference: 1 + 0.35 a zone). */
  spawns: number;
  /** × the live cap (reference: 1 + 0.6 a zone). */
  cap: number;
  /** × XP per kill (reference enemy `xp`: 1 + 0.35 a zone). */
  xp: number;
  guardianHp: number;
  /** × the guardian's every hit, on top of `dmg`. */
  guardianDmg: number;
}

type ZoneTable = readonly [ZoneDef];

/** Each map is one field. Route growth is applied once in zoneFactorsFor. */
const FIELD: ZoneTable = [
  {
    hp: 1,
    dmg: 1,
    speed: 1,
    spawns: 1,
    cap: 1,
    xp: 1,
    guardianHp: 1,
    guardianDmg: 1,
  },
];

/** Field basis shared with partners, before enemy-only growth. */
export function zonesOf(_stage: Pick<StageDef, "id">): ZoneTable {
  return FIELD;
}

export function zoneFactorsFor(
  step: RouteStep,
  stage: Pick<StageDef, "id">,
  zone: number,
): ZoneDef {
  const z = zonesOf(stage)[zone]!;
  const route = ROUTE_GROWTH[step];
  return {
    ...z,
    hp: z.hp * route.hp,
    guardianHp: z.guardianHp * route.guardian,
    dmg: z.dmg * route.dmg,
    xp: z.xp * route.xp,
  };
}

/** Shared swarm and partner clock at `t` local seconds. */
export function zoneClock(step: RouteStep, t: number): number {
  return t + ROUTE_ENTRY_CLOCK[step] * Math.min(1, t / ENTRY_RAMP_SECONDS);
}
