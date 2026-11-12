import { REACH_STEP, FLYER_HOVER, GRAZE } from "./content/params/combat";
import { enemies as enemyDefs, type EnemyId } from "./content/enemies";
import { sampleSurface } from "./surface";
import { PROP_HEIGHT } from "./mapgen/index";
import { heightAt, type Terrain } from "./terrain";
import type { Enemy, Hazard, Obstacle, Projectile } from "./state/entities";
import type { World } from "./state/world";
import { hypot } from "./math";

/** What blocks a line: terrain, static grid walls, and solid props. */
export type Cover = Pick<World, "map">;

/** The level a species stands on at (x, z): the ground, or the water's surface for swimmers and amphibians. */
export function standingHeight(terrain: Terrain, species: EnemyId, x: number, z: number): number {
  const ground = heightAt(terrain, x, z);
  if (!enemyDefs[species].mobility.water) return ground;
  return ground + sampleSurface(terrain.surface, x, z).waterDepth;
}

export function enemyFeet(terrain: Terrain, enemy: Enemy): number {
  const hover = enemyDefs[enemy.species].mobility.flying ? FLYER_HOVER * enemy.scale : 0;
  return standingHeight(terrain, enemy.species, enemy.x, enemy.z) + hover;
}

export function enemyHeight(enemy: Enemy): number {
  return enemyDefs[enemy.species].height * enemy.scale;
}

/** True when the enemy stands on ground (hover aside) within reach of `ground`. */
export function withinStep(terrain: Terrain, enemy: Enemy, ground: number): boolean {
  return Math.abs(standingHeight(terrain, enemy.species, enemy.x, enemy.z) - ground) <= REACH_STEP;
}

/** Point of a body a shot from height `fromY` aims at: level when it can, else just inside the body. */
export function aimHeight(feet: number, height: number, fromY: number): number {
  return Math.min(feet + height * 0.85, Math.max(feet + height * 0.15, fromY));
}

/**
 * Horizontal distance along a straight line (unit heading dirX/dirZ, `rise` height per unit) to the
 * last clear sample before terrain rises over it, or Infinity when the whole `length` is clear. Steps
 * at the terrain sample spacing, so a fast shot can't skip a thin ridge.
 */
export function terrainHit(
  terrain: Terrain,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirZ: number,
  rise: number,
  length: number,
): number {
  const step = 1 / terrain.resolution;
  let clear = 0;
  for (let s = Math.min(step, length); ; s = Math.min(s + step, length)) {
    if (y + rise * s < heightAt(terrain, x + dirX * s, z + dirZ * s) - GRAZE) return clear;
    if (s >= length) return Infinity;
    clear = s;
  }
}

/** Solid props per obstacle list, derived once (the list never changes during a run). */
const solidsOf = new WeakMap<readonly Obstacle[], Obstacle[]>();

/**
 * Horizontal distance along the line to where it enters a solid prop below the prop's top, or
 * Infinity. A line that starts inside a prop's circle is not blocked by that prop.
 */
function propHit(
  cover: Cover,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirZ: number,
  rise: number,
  length: number,
): number {
  let solids = solidsOf.get(cover.map.obstacles);
  if (!solids)
    solidsOf.set(cover.map.obstacles, (solids = cover.map.obstacles.filter((o) => o.solid)));
  let nearest = Infinity;
  for (const prop of solids) {
    const ox = prop.x - x;
    const oz = prop.z - z;
    const along = ox * dirX + oz * dirZ;
    const offset = ox * ox + oz * oz - along * along;
    const r2 = prop.radius * prop.radius;
    if (offset > r2) continue;
    const enter = along - Math.sqrt(r2 - offset);
    if (enter < 0 || enter > length || enter >= nearest) continue;
    const top = heightAt(cover.map.terrain, prop.x, prop.z) + PROP_HEIGHT[prop.kind] * prop.scale;
    if (y + rise * enter <= top) nearest = enter;
  }
  return nearest;
}

/** Traverse the same full cell squares that nav blocks and the view extrudes. */
function wallHit(
  terrain: Terrain,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirZ: number,
  rise: number,
  length: number,
): number {
  const walls = terrain.walls;
  if (!walls) return Infinity;
  const { origin, resolution, samples } = walls;
  const size = 1 / resolution;
  let gx = Math.floor((x - origin) * resolution + 0.5);
  let gz = Math.floor((z - origin) * resolution + 0.5);
  const sx = Math.sign(dirX);
  const sz = Math.sign(dirZ);
  const dx = dirX === 0 ? Infinity : size / Math.abs(dirX);
  const dz = dirZ === 0 ? Infinity : size / Math.abs(dirZ);
  let tx = dirX === 0 ? Infinity : (origin + (gx + sx * 0.5) * size - x) / dirX;
  let tz = dirZ === 0 ? Infinity : (origin + (gz + sz * 0.5) * size - z) / dirZ;
  let enter = 0;
  while (enter <= length) {
    const exit = Math.min(tx, tz, length);
    if (gx >= 0 && gz >= 0 && gx < samples && gz < samples) {
      const at = gz * samples + gx;
      const height = walls.heights[at]!;
      if (height > 0) {
        const floor = terrain.heights[at]!;
        if (rise === 0) {
          if (y >= floor && y <= floor + height) return enter;
        } else {
          const a = (floor - y) / rise;
          const b = (floor + height - y) / rise;
          const hit = Math.max(enter, Math.min(a, b));
          if (hit <= Math.min(exit, Math.max(a, b))) return hit;
        }
      }
    }
    if (exit >= length) break;
    const nextX = tx;
    if (nextX <= tz) {
      gx += sx;
      tx += dx;
    }
    if (tz <= nextX) {
      gz += sz;
      tz += dz;
    }
    enter = exit;
  }
  return Infinity;
}

/** Horizontal distance to terrain, a grid wall or a solid prop, or Infinity. */
export function coverHit(
  cover: Cover,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirZ: number,
  rise: number,
  length: number,
): number {
  return Math.min(
    terrainHit(cover.map.terrain, x, y, z, dirX, dirZ, rise, length),
    propHit(cover, x, y, z, dirX, dirZ, rise, length),
    wallHit(cover.map.terrain, x, y, z, dirX, dirZ, rise, length),
  );
}

export function lineOfFire(
  cover: Cover,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const length = hypot(dx, dz);
  if (length === 0) return true;
  return (
    coverHit(cover, ax, ay, az, dx / length, dz / length, (by - ay) / length, length) === Infinity
  );
}

/** Clear line from (x, y, z) to the part of the enemy's body a shot from there would aim at. */
export function sees(cover: Cover, x: number, y: number, z: number, enemy: Enemy): boolean {
  const target = aimHeight(enemyFeet(cover.map.terrain, enemy), enemyHeight(enemy), y);
  return lineOfFire(cover, x, y, z, enemy.x, target, enemy.z);
}

/**
 * Stops a shot whose path this tick ran into terrain, a grid wall or a solid prop (an orb then
 * explodes there, as on expiry). Emits `impact` for the view.
 */
export function stopAtCover(world: World, shot: Projectile | Hazard): boolean {
  const speed = hypot(shot.vx, shot.vz);
  const dirX = shot.vx / speed;
  const dirZ = shot.vz / speed;
  const along = coverHit(
    world,
    shot.px,
    shot.py,
    shot.pz,
    dirX,
    dirZ,
    shot.vy / speed,
    hypot(shot.x - shot.px, shot.z - shot.pz),
  );
  if (along === Infinity) return false;
  shot.x = shot.px + dirX * along;
  shot.y = shot.py + (shot.vy / speed) * along;
  shot.z = shot.pz + dirZ * along;
  shot.life = 0;
  world.events.push({ t: "impact", id: shot.id, x: shot.x, y: shot.y, z: shot.z });
  return true;
}
