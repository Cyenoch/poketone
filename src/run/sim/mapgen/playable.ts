// Final playability acceptance (docs/MAPGEN.md 最终验收): runs on the assembled nav, after props and
// stations are blockers, with the routes' own rule in both directions.
import { enemies, type EnemyId } from "../content/enemies";
import { ELITE_BODY } from "../content/params/pacing";
import { formDefs } from "../content/lines/index";
import type { StageDef } from "../content/stages/index";
import { bodyFits, cellAt, routeReach, type Nav } from "../nav/index";
import { mobilityClasses } from "../content/mobility";
import type { Passage } from "../terrain";
import { MapGenError } from "./types";
import { cos, hypot, sin } from "../math";

/** Body radii the map must accommodate. */
export interface Bodies {
  /** Smallest and largest player form. */
  playerMin: number;
  playerMax: number;
  /** Largest ground-walking enemy the stage spawns (guardian and elites included). */
  ground: number;
}

/** What must stay usable on the assembled map. */
export interface PlayableSpots {
  spawns: readonly { x: number; z: number }[];
  landmarks: readonly { x: number; z: number }[];
  /** `reach`: how far past body + player its dialog opens (stations.ts `STATION_REACH`). */
  stations: readonly { x: number; z: number; radius: number; reach: number }[];
  passages: readonly Passage[];
}

/** Station approach points tried per station: this many bearings. */
const BEARINGS = 32;
/** Passage centrelines are walked at this spacing. */
const PASSAGE_STEP = 0.5;
/** Stand this far inside the smallest form's interaction zone. */
const ZONE_MARGIN = 0.05;

export function stageBodies(stage: StageDef): Bodies {
  const forms = Object.values(formDefs).map((form) => form.radius);
  // Roster species can come as elites (alphas, elite waves), ELITE_BODY × wider.
  const bodies: [EnemyId, number][] = stage.zones.flatMap((zone): [EnemyId, number][] => [
    [zone.guardian.species, 1],
    ...zone.roster.map(([, id]): [EnemyId, number] => [id, ELITE_BODY]),
    ...zone.beats.flatMap(([, beat]) =>
      "species" in beat ? [beat.species].flat().map((id): [EnemyId, number] => [id, 1]) : [],
    ),
  ]);
  const ground = bodies
    .filter(([id]) => !enemies[id].mobility.flying)
    .map(([id, scale]) => enemies[id].radius * scale);
  return {
    playerMin: Math.min(...forms),
    playerMax: Math.max(...forms),
    ground: Math.max(...forms, ...ground),
  };
}

/**
 * Throws a `MapGenError` naming the first broken guarantee: every spawn fits a player and every
 * spawn reaches every other and back; every station has a spot inside its interaction zone (for
 * every form) where the largest form fits, reachable from spawn and back; every passage centreline
 * is walkable both ways for the stage's largest ground body.
 */
export function checkPlayable(nav: Nav, spots: PlayableSpots, bodies: Bodies, where: string): void {
  const fail = (what: string) => {
    throw new MapGenError(`地图验收失败（${where}）：${what}`);
  };
  const ground = mobilityClasses.ground;
  const at = (x: number, z: number) => `(${x.toFixed(1)}, ${z.toFixed(1)})`;
  for (const spawn of spots.spawns) {
    if (!bodyFits(nav, ground, spawn.x, spawn.z, bodies.playerMax))
      fail(`出生点 ${at(spawn.x, spawn.z)} 站不下玩家`);
  }
  const home = spots.spawns.map((spawn) => cellAt(nav.grid, spawn.x, spawn.z));
  const out = routeReach(nav, ground, home.slice(0, 1), false);
  const back = routeReach(nav, ground, home.slice(0, 1), true);
  const twoWay = (x: number, z: number) => {
    const cell = cellAt(nav.grid, x, z);
    return out[cell] === 1 && back[cell] === 1;
  };
  for (const spawn of spots.spawns) {
    if (!twoWay(spawn.x, spawn.z)) fail(`出生点 ${at(spawn.x, spawn.z)} 与其他出生点不能互相到达`);
  }
  for (const landmark of spots.landmarks) {
    if (
      !bodyFits(nav, ground, landmark.x, landmark.z, bodies.ground) ||
      !twoWay(landmark.x, landmark.z)
    )
      fail(`守卫地标 ${at(landmark.x, landmark.z)} 站不下最大身体或不能从出生点往返`);
  }
  for (const station of spots.stations) {
    // Inside the smallest form's zone, so every larger form's zone holds it too.
    const distance = station.radius + bodies.playerMin + station.reach - ZONE_MARGIN;
    let reachable = false;
    for (let k = 0; k < BEARINGS && !reachable; k++) {
      const angle = (k / BEARINGS) * Math.PI * 2;
      const x = station.x + cos(angle) * distance;
      const z = station.z + sin(angle) * distance;
      reachable = bodyFits(nav, ground, x, z, bodies.playerMax) && twoWay(x, z);
    }
    if (!reachable) fail(`站点 ${at(station.x, station.z)} 周围没有能往返的位置`);
  }
  for (const passage of spots.passages) {
    const [sx, sz] = passage.points[0]!;
    const name = `通道 ${at(sx, sz)}（宽 ${passage.width}）`;
    for (let k = 1; k < passage.points.length; k++) {
      const [ax, az] = passage.points[k - 1]!;
      const [bx, bz] = passage.points[k]!;
      const steps = Math.ceil(hypot(bx - ax, bz - az) / PASSAGE_STEP);
      for (let s = 0; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps;
        const z = az + ((bz - az) * s) / steps;
        if (!bodyFits(nav, ground, x, z, bodies.ground))
          fail(`${name} 在 ${at(x, z)} 过不去半径 ${bodies.ground} 的身体`);
        if (!twoWay(x, z)) fail(`${name} 在 ${at(x, z)} 不能从出生点往返`);
      }
    }
  }
}
