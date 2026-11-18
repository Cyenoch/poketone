import type { ItemId } from "./content/items";
import { megaDefs, stageForm, starters, type FormDef, type Stage } from "./content/lines/index";
import { playerStats, refreshStats } from "./stats";
import type { Player } from "./state/entities";
import type { World } from "./state/world";
import { EVOLVE_INVULNERABLE, HAZARD_RADIUS_INSET } from "./content/params/player";
import { queueCard } from "./progression";

/** Last reachable stage from the current form. A confirmed trade applies only to this check. */
export function stageFor(player: Player, confirmation?: "trade"): Stage {
  const { stages } = starters[player.starter];
  const holds = (id: ItemId) => player.items.some((item) => item.id === id);
  let stage = player.stage;
  while (stage + 1 < stages.length) {
    const next = stages[stage + 1]!;
    if (player.level < next.at) break;
    if (next.kind === "evolve") {
      if (holds("everstone")) break;
      if (next.needs === "thunder-stone" && !holds("thunder-stone")) break;
      if (next.needs === "trade" && confirmation !== "trade" && !holds("linking-cord")) break;
    }
    stage++;
  }
  return stage;
}

export function formOf(player: Player): FormDef {
  return player.mega ? megaDefs[player.mega].form : stageForm(player.starter, player.stage);
}

/**
 * Advances to the eligible stage. The max HP gained arrives filled, like HP Up.
 * Returns whether the stage changed; the balance model calls this without a world.
 */
export function evolve(player: Player, confirmation?: "trade"): boolean {
  const stage = stageFor(player, confirmation);
  if (stage === player.stage) return false;
  const before = playerStats(player).maxHp;
  const reached = starters[player.starter].stages[stage]!;
  if (reached.kind === "evolve" && reached.needs === "trade")
    player.items = player.items.filter((item) => item.id !== "linking-cord");
  player.stage = stage;
  finishEvolution(player, before);
  return true;
}

function finishEvolution(player: Player, before: number): void {
  player.hp += Math.max(0, playerStats(player).maxHp - before);
  player.invulnerable = Math.max(player.invulnerable, EVOLVE_INVULNERABLE);
  // The level-up card waits until the evolution has been seen (the run keeps going, invulnerable).
  player.cardHold = EVOLVE_INVULNERABLE;
}

export function heldMega(player: Player) {
  return starters[player.starter].megas?.find((mega) =>
    player.items.some((item) => item.id === mega.stone),
  );
}

export function tryMegaEvolution(world: World, player: Player): boolean {
  if (
    player.mega ||
    !player.alive ||
    player.cardHold > 0 ||
    player.stage !== starters[player.starter].stages.length - 1 ||
    player.items.some((item) => item.id === "everstone")
  )
    return false;
  const mega = heldMega(player);
  if (!mega) return false;
  const before = playerStats(player).maxHp;
  player.mega = mega.form.id;
  finishEvolution(player, before);
  refreshStats();
  world.events.push({ t: "mega", player: player.id, form: player.mega });
  return true;
}

export function evolveInWorld(world: World, player: Player, confirmation?: "trade"): void {
  const before = formOf(player);
  if (!evolve(player, confirmation)) return;
  const form = formOf(player);
  world.events.push({
    t: "evolve",
    player: player.id,
    stage: player.stage,
    form: form.id,
  });
  if (
    before === stageForm(player.starter, 0) &&
    form !== before &&
    form.abilities.normal.length === 2 &&
    player.abilitySlot !== "hidden"
  )
    queueCard(world, player, "ability");
}

/** Hazards (spores, pools, beams) reach a little less far than contact. */
export function hazardRadius(player: Player): number {
  return formOf(player).radius - HAZARD_RADIUS_INSET;
}
