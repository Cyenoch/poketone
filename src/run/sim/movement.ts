import { WEAVE, STRAFE } from "./content/params/enemy-motion";
// Chase-heading styles an `EnemyDef.move` names; each turns the unit heading the enemy steers along.

import type { Direction } from "./nav/index";
import type { World } from "./state/world";
import type { Enemy } from "./state/entities";
import { cos, sin } from "./math";

/** Rotates a chase heading side to side on a per-enemy phase (no randomness needed). */
function weave(world: World, enemy: Enemy, heading: Direction): void {
  rotate(heading, WEAVE.amplitude * sin(world.time * WEAVE.rate + enemy.id * WEAVE.phasePerId));
}

/** Circles in at a slant, clockwise or not by id parity, so a pack closes from both flanks. */
function strafe(_world: World, enemy: Enemy, heading: Direction): void {
  rotate(heading, enemy.id % 2 === 0 ? STRAFE.angle : -STRAFE.angle);
}

function rotate(heading: Direction, angle: number): void {
  const c = cos(angle);
  const s = sin(angle);
  const x = heading.x;
  heading.x = x * c - heading.z * s;
  heading.z = x * s + heading.z * c;
}

type Steer = (world: World, enemy: Enemy, heading: Direction) => void;

const movesTable = { weave, strafe } satisfies Record<string, Steer>;

export type EnemyMove = keyof typeof movesTable;
export const enemyMoves: Record<EnemyMove, Steer> = movesTable;
