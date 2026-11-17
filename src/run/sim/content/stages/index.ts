import type { Beat } from "../../beats";
import type { FieldEventId, SiteKind } from "../../state/field";
import { FIELD_EVENTS } from "../params/field-events";
import type { GuardianBrainId } from "../../bosses/index";
import type { MapSpec } from "../../mapgen/spec";
import type { StationKind } from "../../state/entities";
import type { EnemyId } from "../enemies";
import { desert } from "./desert";
import { forest } from "./forest";
import { coast } from "./coast";
import { glacier } from "./glacier";
import { volcano } from "./volcano";
import { tower } from "./tower";
import { FIELD_SECONDS } from "../params/campaign";

/** How a zone is lit (the view's per-zone theme, `view/zoneThemes.ts`); no gameplay reads it. */
export type Atmosphere =
  | "afternoon"
  | "dusk"
  | "night"
  | "heat"
  | "sunset"
  | "sandstorm"
  | "tropic"
  | "storm"
  | "thunder"
  | "glacier-clear"
  | "glacier-aurora"
  | "glacier-blizzard"
  | "ash-day"
  | "ember-dusk"
  | "eruption"
  | "tower-hall"
  | "tower-mist"
  | "tower-dark"
  | "tower-roof";

/**
 * One of a stage's zones (openspec/specs/world-progression/spec.md): its spawn roster, timeline beats and guardian. Times are
 * seconds since the zone was entered; the zone's strength factors live in `params/zones.ts`.
 */
export interface StageZone {
  /** Species join the spawn pool at these seconds, in this order. */
  roster: readonly (readonly [number, EnemyId])[];
  /** Beats (sim/beats.ts) at these seconds; harder tiers fire them `earlyBy` (difficulties.ts) sooner. */
  beats: readonly { window: readonly [number, number]; beat: Beat }[];
  events: { windows: readonly (readonly [number, number])[]; pool: readonly FieldEventId[] };
  sites: readonly SiteKind[];
  /** Summoned at the zone's landmark; defeating it clears the zone. */
  guardian: { species: EnemyId; brain: GuardianBrainId; banner: string };
  atmosphere: Atmosphere;
  /** An independent field for this zone/floor; otherwise use the stage's shared map spec. */
  map?: MapSpec;
}

/** One map: its generator spec, its zones in the order a run crosses them, the final swarm and stations. */
export interface StageDef<Id extends string = StageId> {
  id: Id;
  /** Shown when a zone is entered. */
  name: string;
  /**
   * Zone seconds until the final swarm (暴走); a guardian not yet summoned then comes on its own,
   * so no zone runs past it without one.
   */
  duration: number;
  map: MapSpec;
  zones: readonly [StageZone, ...StageZone[]];
  rampage: { banner: string };
  /** One station per building pad, claimed in this order. */
  stations: readonly StationKind[];
}

export type StageId = "forest" | "desert" | "coast" | "glacier" | "volcano" | "tower";

/** The former regional rosters become phases of one field; only its one guardian ends the map. */
function campaignStage(stage: StageDef): StageDef {
  const duration = stage.id === "tower" ? FIELD_SECONDS.tower : FIELD_SECONDS.outdoor;
  const first = stage.zones[0];
  const final = stage.zones.at(-1)!;
  const roster = stage.zones.flatMap((zone, i) =>
    zone.roster.map(
      ([at, species]) =>
        [((i + at / stage.duration) * duration) / stage.zones.length, species] as const,
    ),
  );
  const seen = new Set<EnemyId>();
  const guardian = stage.id === "forest" ? first.guardian : final.guardian;
  const pool = roster.filter(([, species]) => {
    if (species === guardian.species || seen.has(species)) return false;
    seen.add(species);
    return true;
  });
  // One map has one coherent encounter timeline; its roster still introduces every region's species.
  const beats = first.beats.map(({ window, beat }) => {
    const at = (((window[0] + window[1]) / 2) * duration) / stage.duration;
    return {
      window: [
        Math.max(0, at - FIELD_EVENTS.beatSpread),
        Math.min(duration, at + FIELD_EVENTS.beatSpread),
      ] as const,
      beat,
    };
  });
  return {
    ...stage,
    duration,
    map: stage.id === "tower" ? final.map! : stage.map,
    zones: [
      {
        ...first,
        map: stage.id === "tower" ? final.map : first.map,
        roster: pool,
        beats,
        guardian,
        atmosphere: stage.id === "tower" ? "tower-roof" : first.atmosphere,
      },
    ],
  };
}

export const stageDefs: Record<StageId, StageDef> = {
  forest: campaignStage(forest),
  desert: campaignStage(desert),
  coast: campaignStage(coast),
  glacier: campaignStage(glacier),
  volcano: campaignStage(volcano),
  tower: campaignStage(tower),
};

// `spawnEnemy` treats the zone guardian's species as the boss: a regular spawn of it would clear the zone.
for (const stage of Object.values(stageDefs)) {
  stage.zones.forEach((zone, index) => {
    const where = `${stage.id} 第 ${index + 1} 区`;
    if (!zone.roster.some(([at]) => at === 0)) throw new Error(`${where}：开局刷怪池为空。`);
    for (const {
      window: [from, to],
    } of zone.beats)
      if (from < 0 || from > to || to > stage.duration)
        throw new Error(`${where}：节拍时间窗无效。`);
    const { species } = zone.guardian;
    const regular = [
      ...zone.roster.map(([, id]) => id),
      ...zone.beats.flatMap(({ beat }) => ("species" in beat ? [beat.species].flat() : [])),
    ];
    if (regular.includes(species))
      throw new Error(`${where}：守卫 ${species} 不能同时是普通敌人（名单或节拍）。`);
  });
}
