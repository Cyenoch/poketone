import { ENEMY_HAZARD } from "../content/params/enemy-skills";
// Shared parts of the swarm's skills (sim/skills/*) and the guardian's attacks: hazards, the tell,
// aim heights and the ground-patch test. Never imports the skill registry, so every skill module can
// load first.

import { formOf, hazardRadius } from "../evolution";
import { aimHeight, enemyFeet, enemyHeight, lineOfFire } from "../sight";
import { interrupted } from "../status";
import { heightAt } from "../terrain";
import type { World } from "../state/world";
import type { Enemy, Hazard, Player } from "../state/entities";
import type { TellSeverity } from "../state/events";
import { hypot } from "../math";

export type HazardInit = Pick<Hazard, "kind" | "x" | "y" | "z" | "life" | "radius"> &
  Partial<Omit<Hazard, "id">>;

export function addHazard(world: World, init: HazardInit): Hazard {
  const hazard: Hazard = {
    id: world.nextId++,
    px: init.x,
    py: init.y,
    pz: init.z,
    vx: 0,
    vy: 0,
    vz: 0,
    dmg: 0,
    dirX: 0,
    dirZ: 0,
    length: 0,
    rise: 0,
    caster: -1,
    ...init,
  };
  world.hazards.push(hazard);
  return hazard;
}

/** Announces a wind-up that lands in `windup` seconds (the view's glint and the tell sound). */
export function tell(world: World, enemy: Enemy, base: TellSeverity, windup: number): void {
  const severity = enemy.elite || enemy.boss ? "danger" : base;
  world.events.push({ t: "tell", enemy: enemy.id, severity, windup });
}

export function enter(enemy: Enemy, phase: Enemy["phase"]): void {
  enemy.phase = phase;
  enemy.phaseTime = 0;
}

/** Lunges and spores leave from the middle of the body. */
export function bodyY(world: World, enemy: Enemy): number {
  return enemyFeet(world.map.terrain, enemy) + enemyHeight(enemy) / 2;
}

/** Casts leave from the mouth. */
export function mouthY(world: World, enemy: Enemy): number {
  return enemyFeet(world.map.terrain, enemy) + enemyHeight(enemy) * ENEMY_HAZARD.mouth;
}

/** Height the attack leaves from, the point on the target it aims at, and whether the line is clear. */
export function sightOn(world: World, enemy: Enemy, target: Player, fromY: number) {
  const goal = aimHeight(
    heightAt(world.map.terrain, target.x, target.z),
    formOf(target).height,
    fromY,
  );
  const clear = lineOfFire(world, enemy.x, fromY, enemy.z, target.x, goal, target.z);
  return { goal, clear };
}

/** The living, awake caster of a wind-up hazard, or undefined once it died or fell asleep. */
export function activeCaster(world: World, hazard: Hazard): Enemy | undefined {
  const caster = world.enemies.find((enemy) => enemy.id === hazard.caster);
  return !caster || caster.hp <= 0 || interrupted(caster) ? undefined : caster;
}

/** A wind-up dies with its caster, or when the caster is put to sleep, before it can land. */
export function interruptWindup(world: World, hazard: Hazard): void {
  if (!activeCaster(world, hazard)) hazard.life = 0;
}

/** True for a living player standing in the ground circle at (x, z) on the terrace at `ground`. */
export function inCircle(
  world: World,
  x: number,
  z: number,
  radius: number,
  player: Player,
  ground: number,
): boolean {
  if (!player.alive) return false;
  if (hypot(player.x - x, player.z - z) > radius + hazardRadius(player)) return false;
  return Math.abs(heightAt(world.map.terrain, player.x, player.z) - ground) <= ENEMY_HAZARD.level;
}

/** True for the players standing in a ground patch (pool or cloud) centred at `hazard`. */
export function inPatch(world: World, hazard: Hazard, player: Player, ground: number): boolean {
  return inCircle(world, hazard.x, hazard.z, hazard.radius, player, ground);
}

/** Height of the middle of the player's body. */
export function chestOf(world: World, player: Player): number {
  return heightAt(world.map.terrain, player.x, player.z) + formOf(player).height / 2;
}

/** How a hazard kind behaves each tick after `updateHazards` integrates it (sim/hazards.ts). */
export interface HazardRule {
  /** Downward acceleration while it flies. */
  gravity?: number;
  /**
   * The kind's own rule. Without one the hazard is a shot: it dies at cover and hits the first player
   * it reaches, once.
   */
  update?(world: World, hazard: Hazard): void;
  /** Poison seconds a shot's hit inflicts. */
  poison?: number;
  slow?: number;
}
