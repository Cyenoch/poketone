// What every archetype module casts with: targeting, aiming, the shot and area builders, hits, and the
// shapes and terrain rules area kinds share. Load order: this module and every archetype module import
// neither `attacks.ts` nor `archetypes/index.ts` at runtime (index imports them all; attacks imports
// index), so any one of them can be the first sim module a page or test loads (docs/LESSONS.md).

import { damageEnemy, type Ctx, type Hit } from "../combat";
import type { MoveDef } from "../content/moves";
import { SECTOR_CONTACT_PADDING, SHOT_KNOCK } from "../content/params/archetypes";
import { AIM_INSET, TARGET_RANGE } from "../content/params/moves";
import { formOf } from "../evolution";
import {
  aimHeight,
  enemyFeet,
  enemyHeight,
  sees,
  stopAtCover,
  withinStep,
  type Cover,
} from "../sight";
import { CHEST } from "../content/params/combat";
import { targetable } from "../status";
import { heightAt, type Terrain } from "../terrain";
import type { Area, Enemy, Player, Projectile } from "../state/entities";
import type { World } from "../state/world";
import type { AreaKind } from "./index";
import { cos, hypot, sin } from "../math";
import { onScreen } from "../viewFootprint";

export interface MoveParams {
  dmg: number;
  cd: number;
  count: number;
  area: number;
  speed: number;
  dur: number;
  pierce: number;
  crit: number;
  statusChance: number;
}

/** One attack archetype: how a move of it casts, and how the shots it fires fly. */
export interface ArchetypeDef {
  /** Starts one cast; false when there is nothing to aim at (the move retries soon). */
  cast(ctx: Ctx, player: Player, def: MoveDef, p: MoveParams): boolean;
  /**
   * Seconds from the cast to its first shot or hit, for the archetypes whose effect waits; a function
   * when the wait depends on the cast's params (a smite's telegraph lasts `dur`).
   */
  windup?: number | ((p: MoveParams) => number);
  /** For the archetypes that fire projectiles. */
  shot?: ShotRule;
  /** Strikes only next to the caster: the balance model counts it only while an enemy is that close. */
  shortReach?: true;
  /** A slow, heavy cast that gets a cast sound; fast ones are carried by their hit sounds (docs/AUDIO.md). */
  heavy?: true;
  /**
   * Where the view draws the cast leaving the body. By default shots leave the model's mouth and areas
   * stand where the sim puts them; `edge`: a held area starts at the body's edge along its heading;
   * `chest`: shots start at the sim's chest point (shells arc up, not out of the mouth).
   */
  launch?: "edge" | "chest";
}

interface ShotRule {
  /** Before the shot moves this tick: steering or gravity. */
  steer?(ctx: Ctx, shot: Projectile, dt: number): void;
  /** After it moved: what it struck, and whether it ends. */
  land(ctx: Ctx, shot: Projectile, owner: Player, def: MoveDef): void;
}

/** An area that hits every enemy inside its shape that its terrain rule reaches, once per `Area.tick`. */
export interface Zone {
  shape(a: Area, enemy: Enemy): boolean;
  /** Terrain rule for an area whose centre stands on `ground` (src/run/sim/content/README.md 地形与战斗). */
  reaches(cover: Cover, a: Area, ground: number, enemy: Enemy): boolean;
  knock: number;
  /** Enemy search radius around the centre; the larger of radius and length when absent. */
  reach?(a: Area): number;
  /** Every tick, before the delay runs out (a beam clips to cover). */
  track?(world: World, a: Area, ground: number): void;
  /** Every tick after the delay, before the hit (a vortex pulls). */
  hold?(ctx: Ctx, a: Area, dt: number): void;
  /** After every area has ticked, once its life ran out (a vortex collapses into a burst). */
  expire?(ctx: Ctx, a: Area, owner: Player): void;
}

/** An area that plays out its own parts every tick (the fusions). `a.life` already counts this tick. */
export interface Driven {
  drive(ctx: Ctx, a: Area, owner: Player, dt: number): void;
}

export type AreaRule = Zone | Driven;

/** Up to `count` living enemies in range with a line of fire from the eye at (x, y, z), nearest first. */
export function nearest(
  world: World,
  x: number,
  y: number,
  z: number,
  count: number,
  maxRange = TARGET_RANGE,
  keep?: (enemy: Enemy) => boolean,
): Enemy[] {
  const limit = maxRange * maxRange;
  const targets: Enemy[] = [];
  if (count <= 0) return targets;
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || !targetable(enemy) || (keep && !keep(enemy))) continue;
    const d = (enemy.x - x) ** 2 + (enemy.z - z) ** 2;
    if (!(d <= limit)) continue;
    let at = targets.length;
    while (at > 0) {
      const previous = targets[at - 1]!;
      // Equal distances keep world.enemies order, as the stable full sort did.
      if (d >= (previous.x - x) ** 2 + (previous.z - z) ** 2) break;
      at--;
    }
    if (at >= count || !sees(world, x, y, z, enemy)) continue;
    if (targets.length < count) targets.push(enemy);
    for (let i = targets.length - 1; i > at; i--) targets[i] = targets[i - 1]!;
    targets[at] = enemy;
  }
  return targets;
}

/**
 * Up to `count` targets for `player`'s own cast (every archetype and trigger acquires here): `nearest`
 * from their chest, among enemies on their screen.
 */
export function acquire(
  world: World,
  player: Player,
  count: number,
  maxRange = TARGET_RANGE,
): Enemy[] {
  const eye = chestOf(world.map.terrain, player);
  return nearest(world, player.x, eye, player.z, count, maxRange, (enemy) =>
    aimable(world, player, enemy),
  );
}

/** Whether `player`'s auto-aim may pick `enemy`: on their screen, `AIM_INSET` in from the edges. */
export function aimable(world: World, player: Player, enemy: Enemy): boolean {
  return onScreen(world, player, enemy.x, enemy.z, AIM_INSET);
}

export function chestOf(terrain: Terrain, player: Player): number {
  return heightAt(terrain, player.x, player.z) + CHEST;
}

/** Unit heading toward the target and the climb per unit that brings a shot from `fromY` onto its body. */
export function aim(
  terrain: Terrain,
  player: Player,
  fromY: number,
  target: Enemy | undefined,
): [number, number, number] {
  if (!target) return [player.faceX, player.faceZ, 0];
  const dx = target.x - player.x;
  const dz = target.z - player.z;
  const length = hypot(dx, dz) || 1;
  const goal = aimHeight(enemyFeet(terrain, target), enemyHeight(target), fromY);
  return [dx / length, dz / length, (goal - fromY) / length];
}

export function rotate(x: number, z: number, angle: number): [number, number] {
  const c = cos(angle);
  const s = sin(angle);
  return [x * c - z * s, x * s + z * c];
}

/**
 * Where a shot leaves the body: its edge along the shot's heading, not its centre, so a shot never
 * starts inside (or behind) the caster. A shot with no heading (a lob) leaves the centre.
 */
export function launchPoint(player: Player, dirX: number, dirZ: number): [number, number] {
  const length = hypot(dirX, dirZ);
  if (length === 0) return [player.x, player.z];
  const reach = formOf(player).radius / length;
  return [player.x + dirX * reach, player.z + dirZ * reach];
}

export function projectile(
  world: World,
  player: Player,
  def: MoveDef,
  p: MoveParams,
  [dirX, dirZ, rise]: [number, number, number],
  y: number,
  delay: number,
): Projectile {
  const [x, z] = launchPoint(player, dirX, dirZ);
  return {
    id: world.nextId++,
    owner: player.id,
    move: def.id,
    archetype: def.archetype,
    type: def.type,
    x,
    y,
    z,
    px: x,
    py: y,
    pz: z,
    vx: dirX * p.speed,
    vy: rise * p.speed,
    vz: dirZ * p.speed,
    life: p.dur,
    radius: p.area,
    dmg: p.dmg,
    pierce: p.pierce,
    area: p.area,
    dur: p.dur,
    status: def.status,
    statusChance: p.statusChance,
    crit: p.crit,
    hit: [],
    delay,
    target: -1,
  };
}

export function area(
  world: World,
  player: Player,
  def: MoveDef | null,
  p: Pick<MoveParams, "dmg" | "area" | "dur" | "statusChance" | "crit">,
  kind: AreaKind,
  init: Partial<Area>,
): Area {
  const a: Area = {
    id: world.nextId++,
    owner: player.id,
    move: def?.id ?? null,
    kind,
    type: def?.type ?? "normal",
    x: player.x,
    z: player.z,
    dirX: player.faceX,
    dirZ: player.faceZ,
    radius: p.area,
    length: 0,
    rise: 0,
    angle: 0,
    life: p.dur,
    maxLife: p.dur,
    delay: 0,
    tick: 99, // Single-hit sentinel; longer than every non-ticking area's visual lifetime.
    tickTimer: 0,
    dmg: p.dmg,
    status: def?.status,
    statusChance: p.statusChance,
    crit: p.crit,
    follow: false,
    count: 0,
    released: 0,
    scale: 1,
    ...init,
  };
  a.maxLife = a.life;
  world.areas.push(a);
  return a;
}

export function hitFrom(
  player: Player,
  def: MoveDef,
  p: MoveParams | Projectile | Area,
  x: number,
  z: number,
  knock: number,
): Hit {
  return {
    owner: player,
    move: def.id,
    type: def.type,
    dmg: p.dmg,
    crit: p.crit,
    status: def.status,
    statusChance: p.statusChance,
    knock,
    fromX: x,
    fromZ: z,
    drain: def.drain,
  };
}

// ── Shots ─────────────────────────────────────────────────────────────────────────────────────────

/** Calls `touch` for each living enemy the shot's body overlaps now and has not struck yet. */
export function touching(ctx: Ctx, shot: Projectile, touch: (enemy: Enemy) => void): void {
  const { terrain } = ctx.world.map;
  ctx.grid.query(shot.x, shot.z, shot.radius + 1.4, (enemy) => {
    if (shot.life <= 0 || enemy.hp <= 0 || shot.hit.includes(enemy.id)) return;
    if (hypot(enemy.x - shot.x, enemy.z - shot.z) > shot.radius + enemy.radius) return;
    const feet = enemyFeet(terrain, enemy);
    if (shot.y < feet - shot.radius || shot.y > feet + enemyHeight(enemy) + shot.radius) return;
    touch(enemy);
  });
}

/** The plain shot: stops at cover, strikes each body once and ends after `pierce` extra bodies. */
export function pierce(ctx: Ctx, shot: Projectile, owner: Player, def: MoveDef): void {
  if (stopAtCover(ctx.world, shot)) return;
  touching(ctx, shot, (enemy) => {
    shot.hit.push(enemy.id);
    damageEnemy(
      ctx,
      enemy,
      hitFrom(owner, def, shot, shot.x - shot.vx, shot.z - shot.vz, SHOT_KNOCK),
    );
    if (shot.hit.length > shot.pierce) shot.life = 0;
  });
}

export const piercing: ShotRule = { land: pierce };

// ── Area shapes and terrain rules ─────────────────────────────────────────────────────────────────

export function inDisc(a: Area, enemy: Enemy): boolean {
  return hypot(enemy.x - a.x, enemy.z - a.z) <= a.radius + enemy.radius;
}

/** Within `length` and `angle` of the heading; a body pressed against the caster always counts. */
export function inSector(a: Area, enemy: Enemy): boolean {
  const dx = enemy.x - a.x;
  const dz = enemy.z - a.z;
  const distance = hypot(dx, dz);
  if (distance > a.length + enemy.radius) return false;
  if (distance < enemy.radius + SECTOR_CONTACT_PADDING) return true;
  // acos(c) ≤ angle ⇔ c ≥ cos(angle) for angle in [0, π]: no acos needed.
  return (dx * a.dirX + dz * a.dirZ) / distance >= cos(a.angle);
}

/** Struck from the sky: no terrain stops it. */
export const anywhere = (): boolean => true;

export const onStep = (cover: Cover, _a: Area, ground: number, enemy: Enemy): boolean =>
  withinStep(cover.map.terrain, enemy, ground);

export const inSight = (cover: Cover, a: Area, ground: number, enemy: Enemy): boolean =>
  sees(cover, a.x, ground + CHEST, a.z, enemy);

/** A blast along the ground: bodies on the same step, or in sight of its centre. */
export const onStepOrInSight = (cover: Cover, a: Area, ground: number, enemy: Enemy): boolean =>
  onStep(cover, a, ground, enemy) || inSight(cover, a, ground, enemy);
