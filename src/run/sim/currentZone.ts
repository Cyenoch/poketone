// The current zone, read by the director, combat and the view (openspec/specs/world-progression/spec.md); the zone lifecycle
// (summon, leave, the next zone's field) is zones.ts. A leaf: nothing here imports the world loop.

import { stageDefs, type StageId, type StageZone } from "./content/stages/index";
import { routeStep, ROUTE_TIERS } from "./content/campaign";
import { rollExitMarkers } from "./content/route";
import { towerMap } from "./content/tower-map";
import { chance, pick } from "./rng";
import type { ZoneExit } from "./state/route";
import { isTowerGuardianFloor, TOWER, towerClock, towerFactorsFor } from "./content/params/tower";
import { zoneClock, zoneFactorsFor, type ZoneDef } from "./content/params/zones";
import type { Pad } from "./mapgen/index";
import { ARENA_HALF, TICK, type World } from "./state/world";
import type { Player } from "./state/entities";
import { hypot } from "./math";
import { mobilityClasses } from "./content/mobility";
import { EXIT_RADIUS, EXIT_SEARCH } from "./content/params/campaign";
import { stageBodies } from "./mapgen/playable";
import { STATION_REACH } from "./content/params/stations";
import { SITE } from "./content/params/sites";
import { sites as siteDefs } from "./content/sites";
import { bodyFits, routeReach } from "./nav/reach";
import { cellAt, cellCenterX, cellCenterZ, DIR_LENGTH, DIR_X, DIR_Z } from "./nav/grid";

export function zoneDef(world: World): StageZone {
  return stageDefs[world.stage].zones[world.zone.index]!;
}

export function zoneFactors(world: World): ZoneDef {
  if (world.mode === "tower") return towerFactorsFor(world.route.length, stageDefs[world.stage]);
  return zoneFactorsFor(routeStep(world), stageDefs[world.stage], world.zone.index);
}

/** Seconds fought in the current zone. */
export function zoneTime(world: World): number {
  return world.zone.tick * TICK;
}

/** Swarms and partners grow on this clock. Rosters and scheduled beats use local seconds. */
export function zoneGrowthClock(world: World, time = zoneTime(world)): number {
  return world.mode === "tower"
    ? towerClock(world.route.length, time)
    : zoneClock(routeStep(world), time);
}

/** Normal tower floors open an exit; expeditions enter rampage. Guardian floors have no deadline. */
export function zoneTimeLimit(world: World): number | null {
  if (world.mode === "tower")
    return isTowerGuardianFloor(world.route.length) ? null : TOWER.floorSeconds;
  return stageDefs[world.stage].duration;
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
export function atExit(world: World, player: Pick<Player, "x" | "z">): number | null {
  const index = world.zone.exits.findIndex(
    (exit) => hypot(exit.x - player.x, exit.z - player.z) <= EXIT_RADIUS,
  );
  return index < 0 ? null : index;
}

export function nearestExit(world: World, player: Pick<Player, "x" | "z">): ZoneExit | null {
  let nearest: ZoneExit | null = null;
  let best = Infinity;
  for (const exit of world.zone.exits) {
    const d = (exit.x - player.x) ** 2 + (exit.z - player.z) ** 2;
    if (d < best) {
      best = d;
      nearest = exit;
    }
  }
  return nearest;
}

/** Timed tower floors clear at their guaranteed walkable landmark; guardians clear at their fall spot. */
export function clearZone(world: World, x: number, z: number): void {
  if (world.mode === "tower") {
    const spot = isTowerGuardianFloor(world.route.length)
      ? exitSpots(world, x, z, 1)[0]!
      : { x, z };
    const to = towerMap(world.seed, world.route.length + 1, world.stage);
    world.zone.exits = [{ ...spot, to, marker: null }];
  } else world.zone.exits = expeditionExits(world, x, z);
  world.zone.phase = "cleared";
  world.bossId = null;
}

function expeditionExits(world: World, x: number, z: number): ZoneExit[] {
  const targetStep = routeStep(world) + 1;
  const tier = ROUTE_TIERS[targetStep];
  const targets: StageId[] = tier ? [...tier] : [];
  if (targets.length === 1 || (targets.length === 2 && chance(world.rng, EXIT_SEARCH.extraChance)))
    targets.push(pick(world.rng, targets));
  const exits = exitSpots(world, x, z, Math.max(1, targets.length));
  const markers = rollExitMarkers(world.rng, targets.slice(0, exits.length), world.unlocks);
  return exits.map((spot, i) => ({
    ...spot,
    to: targets[i] ?? null,
    marker: markers[i] ?? null,
  }));
}

/**
 * The fall spot when the team can stand there and walk to and from it (the landmark's own guarantee:
 * mapgen/playable.ts), else the nearest such point on rings around it (a flier may fall over water, a
 * one-way ledge or a rock). Search the landmark's surroundings next; mandatory exits may use
 * the entire connected field. Compute the two reachability sets just once per guardian.
 */
function exitSpots(world: World, x: number, z: number, count: number) {
  const spots: { x: number; z: number }[] = [];
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
    return (
      hypot(pad.x - cx, pad.z - cz) > pad.radius + EXIT_RADIUS &&
      spots.every((s) => hypot(s.x - cx, s.z - cz) >= 2 * EXIT_RADIUS + 1) &&
      world.stations.every(
        (station) =>
          hypot(station.x - cx, station.z - cz) >
          station.radius + body + STATION_REACH + EXIT_RADIUS,
      ) &&
      world.sites.every(
        (site) =>
          hypot(site.x - cx, site.z - cz) >
          site.radius +
            body +
            (siteDefs[site.kind].interact === "pickup" ? SITE.pickup : SITE.reach) +
            EXIT_RADIUS,
      )
    );
  };
  const nearby = (cx: number, cz: number, start: number) => {
    for (let ring = start; ring <= EXIT_SEARCH.rings; ring++)
      for (let dir = 0; dir < (ring === 0 ? 1 : DIR_X.length); dir++) {
        const step = (ring * EXIT_SEARCH.step) / DIR_LENGTH[dir]!;
        const sx = cx + DIR_X[dir]! * step,
          sz = cz + DIR_Z[dir]! * step;
        if (fits(sx, sz)) return { x: sx, z: sz };
      }
    return null;
  };
  for (let i = 0; i < count; i++) {
    const first = spots[0];
    let spot =
      nearby(first?.x ?? x, first?.z ?? z, first ? EXIT_SEARCH.branchRadius : 0) ??
      nearby(pad.x, pad.z, 0);
    if (!spot && i === 2) break;
    if (!spot) {
      let best = Infinity;
      for (let cell = 0; cell < out.length; cell++) {
        if (!out[cell] || !back[cell]) continue;
        const sx = cellCenterX(nav.grid, cell),
          sz = cellCenterZ(nav.grid, cell);
        const d = (sx - pad.x) ** 2 + (sz - pad.z) ** 2;
        if (d < best && fits(sx, sz)) {
          best = d;
          spot = { x: sx, z: sz };
        }
      }
    }
    if (!spot)
      throw new Error(
        `关卡 ${world.stage}，种子 ${world.seed}：第 ${i + 1} 个必需出口没有可达落点。`,
      );
    spots.push(spot);
  }
  return spots;
}
