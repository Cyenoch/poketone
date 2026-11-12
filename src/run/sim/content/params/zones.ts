import type { StageDef } from "../stages/index";
import { CAMPAIGN_GROWTH, CAMPAIGN_HP_CLOCK } from "./campaign";

export interface ZoneDef {
  /**
   * Seconds added to the stage clock the swarm curves read (HP, damage, speed, spawns, live cap),
   * ramped in over the zone's first 20 s: clock = t + `clockOffset` × min(1, t / 20) (reference `mn`).
   */
  clockOffset: number;
  /**
   * × swarm and elite HP. Guardians use guardianHp separately. These factors are calibrated
   * with the continuing build and the HP-clock floor, not copied from another game's growth.
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
    clockOffset: 0,
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

/** `stage`'s zone factors, without its `enemyHp` (partner growth reads these). */
export function zonesOf(_stage: Pick<StageDef, "id">): ZoneTable {
  return FIELD;
}

/** Zone `zone`'s factors on `stage`: its HP factors × the stage's `enemyHp`. */
export function zoneFactorsFor(stage: Pick<StageDef, "id" | "enemyHp">, zone: number): ZoneDef {
  const z = zonesOf(stage)[zone]!;
  const hp = stage.enemyHp ?? 1;
  const route = CAMPAIGN_GROWTH[stage.id];
  return {
    ...z,
    hp: z.hp * hp * route.hp,
    guardianHp: z.guardianHp * hp * route.guardian,
    dmg: z.dmg * route.dmg,
    xp: z.xp * route.xp,
  };
}

/** The stage clock the swarm curves read in `stage`'s zone `zone` (0-based) at `t` seconds into it. */
export function zoneClock(stage: Pick<StageDef, "id">, zone: number, t: number): number {
  return t + zonesOf(stage)[zone]!.clockOffset * Math.min(1, t / 20);
}

/** Swarm HP only: other swarm stats/partners use zoneClock; guardians use their fixed reference. */
export function zoneHealthClock(stage: Pick<StageDef, "id">, zone: number, t: number): number {
  return Math.max(zoneClock(stage, zone, t), CAMPAIGN_HP_CLOCK[stage.id]);
}
