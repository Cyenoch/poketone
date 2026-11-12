// The current zone, read by the director, combat and the view (openspec/specs/world-progression/spec.md); the zone lifecycle
// (summon, leave, the next zone's field) is zones.ts. A leaf: nothing here imports the world loop.

import { stageDefs, type StageZone } from "./content/stages/index";
import { zoneFactorsFor, type ZoneDef } from "./content/params/zones";
import type { Pad } from "./mapgen/index";
import { TICK, type World } from "./state/world";
import type { Player } from "./state/entities";
import { hypot } from "./math";

export function zoneDef(world: World): StageZone {
  return stageDefs[world.stage].zones[world.zone.index]!;
}

export function zoneFactors(world: World): ZoneDef {
  return zoneFactorsFor(stageDefs[world.stage], world.zone.index);
}

/** Seconds fought in the current zone. */
export function zoneTime(world: World): number {
  return world.zone.tick * TICK;
}

export function isLastZone(world: World): boolean {
  return world.zone.index === stageDefs[world.stage].zones.length - 1;
}

/** The map's landmark pad: the guardian's altar, then the exit. Every stage's map spec has one. */
export function landmarkOf(world: World): Pad {
  const pad = world.map.pads.find((candidate) => candidate.tag === "landmark");
  if (!pad) throw new Error(`关卡 ${world.stage} 的地图没有守卫地标。`);
  return pad;
}

/** Standing on the landmark's flat disc. */
export function atLandmark(world: World, player: Player): boolean {
  const pad = landmarkOf(world);
  return hypot(pad.x - player.x, pad.z - player.z) <= pad.radius;
}

/** The guardian fell (combat.ts): the zone is cleared; the field is swept at the end of the tick. */
export function clearZone(world: World): void {
  world.zone.phase = "cleared";
  world.bossId = null;
}
