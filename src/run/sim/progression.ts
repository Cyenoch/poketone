import { DICE_FACES, diceKey, items, type ItemId } from "./content/items";
import { evolveInWorld } from "./evolution";
import { next, type Rng } from "./rng";
import type { PendingChoice, Player, Rarity } from "./state/entities";
import type { World } from "./state/world";
import { refreshStats, xpForLevel } from "./stats";
import { rollChoices } from "./upgrades";

/** Only the front card is rolled: one queued behind it would be rolled against an outdated kit. */
export function queueCard(
  world: World,
  player: Player,
  source: PendingChoice["source"],
  minRarity?: Rarity,
): void {
  const front = player.pending.length === 0;
  player.pending.push({
    id: world.nextId++,
    source,
    options: front ? rollChoices(world.rng, player, source, world.partners, minRarity) : [],
    ...(minRarity === undefined ? {} : { minRarity }),
  });
}

/**
 * An item level's immediate effects (`ItemDef.onPick`): whole player levels (Rare Candy; their cards
 * queue behind the one being answered) and a die roll stored for the fold (Loaded Dice).
 */
export function pickEffects(world: World, player: Player, id: ItemId): void {
  const { onPick } = items[id];
  if (!onPick) return;
  if (onPick.roll) {
    const level = player.items.find((item) => item.id === id)!.level;
    rollDice(world.rng, player, level);
  }
  for (let i = 0; i < (onPick.levels ?? 0); i++) gainXp(world, player, player.xpNext - player.xp);
}

export function rollDice(rng: Rng, player: Player, level: number): void {
  player.fx[diceKey(level)] = Math.floor(next(rng) * DICE_FACES.length);
}

export function gainXp(world: World, player: Player, amount: number): void {
  player.xp += amount;
  while (player.xp >= player.xpNext) {
    player.xp -= player.xpNext;
    player.level += 1;
    player.xpNext = xpForLevel(player.level);
    // Before the card is rolled, so a new stage's evolution move is already in the pool.
    evolveInWorld(world, player);
    if (!player.alive) player.hp = 0;
    if (world.players.length > 1) player.cardHold = 0;
    // Level and stage feed the stats: later pickups this tick (berries, candy) read the new ones.
    refreshStats();
    queueCard(world, player, "level");
    world.events.push({ t: "level", player: player.id, level: player.level });
  }
}
