// Evolution (openspec/specs/combat-builds/spec.md 进化线): a line evolves at the levels its stages name
// (`LineDef.stages[i].at`). Moves, their levels, mods and damage, items and level all carry over; the
// form (HP, speed, body, types), passive strength and ultimate tier follow the stage.

import {
  stageForm,
  starters,
  type FormDef,
  type Stage,
  type StarterId,
} from "./content/lines/index";
import { playerStats } from "./stats";
import type { Player } from "./state/entities";
import type { World } from "./state/world";
import { EVOLVE_INVULNERABLE, HAZARD_RADIUS_INSET } from "./content/params/player";

/** The last stage of the line whose level `level` has reached. */
export function stageFor(line: StarterId, level: number): Stage {
  const { stages } = starters[line];
  let stage = 0;
  while (stage + 1 < stages.length && level >= stages[stage + 1]!.at) stage += 1;
  return stage;
}

export function formOf(player: Player): FormDef {
  return stageForm(player.starter, player.stage);
}

/**
 * Moves the player to the stage their level has reached. The max HP gained arrives filled, like HP Up.
 * Returns whether the stage changed; the balance model calls this without a world.
 */
export function evolve(player: Player): boolean {
  const stage = stageFor(player.starter, player.level);
  if (stage <= player.stage) return false;
  const before = playerStats(player).maxHp;
  player.stage = stage;
  player.hp += Math.max(0, playerStats(player).maxHp - before);
  player.invulnerable = Math.max(player.invulnerable, EVOLVE_INVULNERABLE);
  // The level-up card waits until the evolution has been seen (the run keeps going, invulnerable).
  player.cardHold = EVOLVE_INVULNERABLE;
  return true;
}

export function evolveInWorld(world: World, player: Player): void {
  if (!evolve(player)) return;
  world.events.push({
    t: "evolve",
    player: player.id,
    stage: player.stage,
    form: formOf(player).id,
  });
}

/** Hazards (spores, pools, beams) reach a little less far than contact. */
export function hazardRadius(player: Player): number {
  return formOf(player).radius - HAZARD_RADIUS_INSET;
}
