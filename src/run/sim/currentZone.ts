// The current zone, read by the director, combat and the view (openspec/specs/world-progression/spec.md); the zone lifecycle
// (summon, leave, the next zone's field) is zones.ts. A leaf: nothing here imports the world loop.

import { stageDefs, type StageZone } from "./content/stages/index";
import { zoneFactorsFor, type ZoneDef } from "./content/params/zones";
import type { Pad } from "./mapgen/index";
import { ARENA_HALF, TICK, type World } from "./state/world";
import type { Player } from "./state/entities";
import { hypot } from "./math";
import { mobilityClasses } from "./content/mobility";
import { EXIT_RADIUS, EXIT_SEARCH } from "./content/params/campaign";
import { stageBodies } from "./mapgen/playable";
import { STATION_REACH } from "./content/params/stations";
import { bodyFits, routeReach } from "./nav/reach";
import { cellAt, DIR_LENGTH, DIR_X, DIR_Z } from "./nav/grid";

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

/** The map's guardian altar. Every stage's map spec has one. */
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

/** Within reach of the exit the fallen guardian opened. */
export function atExit(world: World, player: Player): boolean {
  const exit = world.zone.exit;
  return exit !== null && hypot(exit.x - player.x, exit.z - player.z) <= EXIT_RADIUS;
}

/**
 * The guardian fell at (x, z) (combat.ts): the zone is cleared and the exit opens where it fell, so
 * the way on is wherever the fight ended; the field is swept at the end of the tick.
 */
export function clearZone(world: World, x: number, z: number): void {
  world.zone.phase = "cleared";
  world.zone.exit = exitSpot(world, x, z);
  world.bossId = null;
}

/**
 * The fall spot when the team can stand there and walk to and from it (the landmark's own guarantee:
 * mapgen/playable.ts), else the nearest such point on rings around it (a flier may fall over water, a
 * one-way ledge or a rock) and clear of the stations, else the landmark itself.
 */
function exitSpot(world: World, x: number, z: number): { x: number; z: number } {
  const { nav } = world;
  const ground = mobilityClasses.ground;
  const pad = landmarkOf(world);
  const home = [cellAt(nav.grid, pad.x, pad.z)];
  const out = routeReach(nav, ground, home, false);
  const back = routeReach(nav, ground, home, true);
  // Guardian loot can evolve players after placement; keep every reachable form clear of stations.
  const body = stageBodies(stageDefs[world.stage]).playerMax;
  const edge = ARENA_HALF - body;
  const fits = (cx: number, cz: number) => {
    if (Math.abs(cx) > edge || Math.abs(cz) > edge) return false;
    const cell = cellAt(nav.grid, cx, cz);
    if (out[cell] !== 1 || back[cell] !== 1 || !bodyFits(nav, ground, cx, cz, body)) return false;
    // Clear of every station's reach, so the exit and a station never answer the same interact.
    return world.stations.every(
      (station) =>
        hypot(station.x - cx, station.z - cz) > station.radius + body + STATION_REACH + EXIT_RADIUS,
    );
  };
  for (let ring = 0; ring <= EXIT_SEARCH.rings; ring++)
    for (let dir = 0; dir < (ring === 0 ? 1 : DIR_X.length); dir++) {
      const step = (ring * EXIT_SEARCH.step) / DIR_LENGTH[dir]!;
      const cx = x + DIR_X[dir]! * step,
        cz = z + DIR_Z[dir]! * step;
      if (fits(cx, cz)) return { x: cx, z: cz };
    }
  return { x: pad.x, z: pad.z };
}
