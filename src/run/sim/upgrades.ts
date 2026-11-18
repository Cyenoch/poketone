import { contentAvailable } from "./content/unlocks";
import { megaDefs, megaStones, starters } from "./content/lines/index";
import { formOf, heldMega, stageFor } from "./evolution";
import type { RuleId } from "./content/rules";
import { HELD_ITEM_STARDUST } from "./content/params/rules";
import type { ElementType } from "./content/elements";
import { itemIds, items, type ItemDef, type ItemId } from "./content/items";
import { enemies } from "./content/enemies";
import { moves, type MoveCategory, type MoveId, type UpgradeStat } from "./content/moves";
import { signatureFusions } from "./content/fusions";
import { statuses, type EnemyStatusId, type StatusDef } from "./content/statuses";
import { next, type Rng } from "./rng";
import { powInt } from "./math";
import { earnStardust, itemRule, playerStats, refreshStats } from "./stats";
import type { Choice, MoveState, Partner, PendingChoice, Player, Rarity } from "./state/entities";
import type { World } from "./state/world";
import {
  BASE_CHOICES,
  BASE_ITEM_LEVEL_CAP,
  BASE_ITEM_SLOTS,
  BASE_MOVE_SLOTS,
  BOOSTER_WEIGHT,
  choiceWeights,
  ITEM_DRAWS,
  ITEM_GATES,
  LUCK_SCALING,
  MAX_FUSION_STARS,
  MAX_MOVE_LEVEL,
  MIN_UPGRADE_RARITY,
  RARITY_ODDS,
  rarityPower,
  SIGNATURE_GATES,
  TM_CASE,
  trainStats,
  UPGRADE_BASE_DMG,
  UPGRADE_PICKS,
  UPGRADE_ROLL,
} from "./content/params/cards";
import { NEW_MOVE_COOLDOWN } from "./content/params/moves";

export function moveSlots(player: Player): number {
  return BASE_MOVE_SLOTS + (player.lab.rules.moveSlots ?? 0);
}

export function itemSlots(player: Player): number {
  return BASE_ITEM_SLOTS + (player.lab.rules.itemSlots ?? 0);
}

/**
 * Keys of `Player.banished`, the offers never rolled again this run: a move (learning and upgrades), an
 * item, or the TM case. Banishes, the archive, Hypno's forgetting and Bill's fusion all write these.
 */
export const offerKey = {
  move: (id: MoveId) => `move:${id}`,
  item: (id: ItemId) => `item:${id}`,
  tmCase: "tm-case",
} as const;

/** The offer a banish removes for the rest of the run. */
export function banishKey(choice: Choice): string | null {
  switch (choice.kind) {
    case "move":
    case "upgrade":
      return offerKey.move(choice.move);
    case "item":
      return offerKey.item(choice.item);
    case "tm-case":
      return offerKey.tmCase;
    case "ability":
    case "decline":
    case "stardust":
    case "train":
      return null;
  }
}
export const rarityNames = ["普通", "稀有", "史诗", "传说"] as const;
/**
 * Luck (财运) reweights the odds like the reference (`nw` in the 0.8.83 client): with a = luck / 100,
 * common × 1/(1 + a), rare × (1 + a/2), epic × (1 + a)², legendary × (1 + a)³, renormalised. Each
 * 100 luck roughly doubles the rare-or-better share's upper tiers; our lab cap of 30 moves
 * P(≥ 稀有) 40% → 54% and P(传说) 3% → 6.5%.
 */
export function rarityOdds(luck: number): [number, number, number, number] {
  const a = Math.max(0, luck) / LUCK_SCALING.unit;
  const [common, rare, epic, legend] = RARITY_ODDS;
  const w = [
    common / (1 + a),
    rare * (1 + a / LUCK_SCALING.rareDivisor),
    epic * powInt(1 + a, LUCK_SCALING.epicExponent),
    legend * powInt(1 + a, LUCK_SCALING.legendaryExponent),
  ];
  const total = w[0]! + w[1]! + w[2]! + w[3]!;
  return [w[0]! / total, w[1]! / total, w[2]! / total, w[3]! / total];
}
for (const line of Object.values(starters))
  if (line.kit.length > SIGNATURE_GATES.length)
    throw new Error(
      `${line.id}: ${line.kit.length} 个招牌招式，SIGNATURE_GATES 只有 ${SIGNATURE_GATES.length} 级。`,
    );
/** Highest level this item can reach for this player: Max Ether raises the five-level items. */
export function itemCap(player: Player, id: ItemId): number {
  const { max } = items[id];
  return max >= BASE_ITEM_LEVEL_CAP ? max + itemRule(player, "itemLevels") : max;
}

function branchMoves(player: Player): readonly MoveId[] {
  return player.mega ? megaDefs[player.mega].moves : [];
}

export function megaMoveToLearn(player: Player): MoveId | undefined {
  const move = player.mega && megaDefs[player.mega].moves[0];
  return move && !player.moves.some((m) => m.id === move) ? move : undefined;
}

/**
 * Types and move categories the player's line and partners hit with: a booster of anything else is
 * never offered (a dead card in a 3-slot build).
 */
function hitTypes(player: Player, partners: readonly Partner[]): Set<ElementType | MoveCategory> {
  const line = starters[player.starter];
  const types = new Set<ElementType | MoveCategory>();
  for (const id of [
    ...line.kit,
    ...line.evolutionMoves,
    ...branchMoves(player),
    signatureFusions[player.starter].result,
  ]) {
    const move = moves[id];
    if (move.category !== "status") types.add(move.type).add(move.category);
  }
  for (const partner of partners)
    if (partner.owner === player.id) types.add(enemies[partner.species].types[0]!);
  return types;
}

/**
 * Statuses the player's line can inflict (its moves) or its items do (on-hit items), with what they
 * build into (chill → freeze): an item that needs a status nobody applies is never offered.
 */
export function statusSources(player: Player): Set<EnemyStatusId> {
  const line = starters[player.starter];
  const sources = new Set<EnemyStatusId>();
  for (const move of [
    ...line.kit,
    ...line.evolutionMoves,
    ...branchMoves(player),
    signatureFusions[player.starter].result,
  ]) {
    const status = moves[move].status;
    if (status) sources.add(status);
  }
  for (const owned of player.items)
    for (const trigger of items[owned.id].effect.triggers ?? [])
      if (trigger.kind === "inflictOnHit" && trigger.status !== "flinch")
        sources.add(trigger.status);
  for (const status of sources) {
    const builds = (statuses[status] as StatusDef).builds;
    if (builds) sources.add(builds.into as EnemyStatusId);
  }
  return sources;
}

/** Odds of each tier for a new-item card: `rarityOdds` gated by level, tiers with no item left zeroed. */
export function itemTierOdds(luck: number, level: number, present: readonly boolean[]): number[] {
  const odds = rarityOdds(luck).map((p, tier) => {
    const gate = ITEM_GATES[tier as Rarity];
    const open = gate ? Math.max(0, Math.min(1, (level - gate[0]) / (gate[1] - gate[0]))) : 1;
    return present[tier] ? p * open : 0;
  });
  const total = odds.reduce((sum, p) => sum + p, 0);
  return odds.map((p) => p / total);
}

const isElement = (boosts: ItemDef["boosts"]) =>
  boosts !== undefined && boosts !== "physical" && boosts !== "special";

type RewardWorld = Pick<World, "rng" | "partners" | "rules" | "playerUnlocks">;

/** Hidden slots follow the owner's research, including when the current form changes. */
export function hiddenAbilityAvailable(world: RewardWorld, player: Player): boolean {
  const hidden = formOf(player).abilities.hidden;
  return (
    hidden !== undefined && contentAvailable(world.playerUnlocks[player.id]!, { ability: hidden })
  );
}

/** Field items obey the same build, banish and slot limits as cards. */
export function itemEligible(
  player: Player,
  id: ItemId,
  partners: readonly Partner[],
  guaranteedTier = false,
  hiddenAvailable = false,
): boolean {
  if (megaStones.has(id) || player.banished.includes(offerKey.item(id))) return false;
  const owned = player.items.find((item) => item.id === id);
  if (owned ? owned.level >= itemCap(player, id) : player.items.length >= itemSlots(player))
    return false;
  const gate = ITEM_GATES[items[id].rarity];
  if (!guaranteedTier && !owned && gate && player.level <= gate[0]) return false;
  if (id === "ability-patch") return hiddenAvailable && player.abilitySlot !== "hidden";
  if (id === "everstone" && heldMega(player)) return false;
  if (id === "light-ball") return formOf(player).id === "pikachu";
  if (id === "linking-cord")
    return starters[player.starter].stages.some(
      (stage, index) => index > player.stage && stage.kind === "evolve" && stage.needs === "trade",
    );
  const { boosts, needs } = items[id];
  return (
    (boosts === undefined || hitTypes(player, partners).has(boosts)) &&
    (needs === undefined ||
      (needs === "partner"
        ? partners.some((partner) => partner.owner === player.id)
        : statusSources(player).has(needs)))
  );
}

export function rollItemChoice(
  rng: Rng,
  player: Player,
  partners: readonly Partner[],
  hiddenAvailable = false,
): Extract<Choice, { kind: "item" }> | null {
  const pool = itemIds.filter((id) => itemEligible(player, id, partners, false, hiddenAvailable));
  if (pool.length === 0) return null;
  return {
    kind: "item",
    item: drawItem(rng, player, playerStats(player).luck, pool),
  };
}

/** Rolls a tier, then an item in it (boosters for the player's types weighted up); `pool` is never empty. */
function drawItem(rng: Rng, player: Player, luck: number, pool: readonly ItemId[]): ItemId {
  const present = [0, 1, 2, 3].map((tier) => pool.some((id) => items[id].rarity === tier));
  const odds = itemTierOdds(luck, player.level, present);
  let r = next(rng);
  let tier = odds.findIndex((p) => (r -= p) < 0);
  if (tier < 0) tier = odds.findLastIndex((p) => p > 0);
  const inTier = pool.filter((id) => items[id].rarity === tier);
  const choices = inTier.length > 0 ? inTier : pool;
  const weight = (id: ItemId) => (isElement(items[id].boosts) ? BOOSTER_WEIGHT : 1);
  let roll = next(rng) * choices.reduce((sum, id) => sum + weight(id), 0);
  return choices.find((id) => (roll -= weight(id)) < 0) ?? choices[choices.length - 1]!;
}

/** Highest level (fusions: stars) this move can reach for this player. */
export function levelCap(player: Player, move: MoveId): number {
  return moves[move].fusion
    ? MAX_FUSION_STARS + (player.tmCase ? TM_CASE.stars : 0)
    : MAX_MOVE_LEVEL + (player.tmCase ? TM_CASE.moveLevels : 0);
}

function canUpgrade(player: Player, state: MoveState): boolean {
  return (
    state.level < levelCap(player, state.id) && !player.banished.includes(offerKey.move(state.id))
  );
}

type RouteOffer = NonNullable<PendingChoice["offer"]>["kind"];

function routeItem(player: Player, id: ItemId, world: RewardWorld, kind: RouteOffer): boolean {
  return (
    items[id].rarity >= (kind === "deal" ? 3 : 2) &&
    itemEligible(
      player,
      id,
      world.partners,
      true,
      id === "ability-patch" && hiddenAbilityAvailable(world, player),
    )
  );
}

/** Level cards omit restricted items; field and route rewards replace them with stardust. */
export function replacesHeldItem(rules: readonly RuleId[], player: Player, id: ItemId): boolean {
  if (!rules.includes("no-items") || items[id].noItemsException) return false;
  if (id !== "thunder-stone") return true;
  const needsStone = starters[player.starter].stages.some(
    (stage, index) => index > player.stage && stage.kind === "evolve" && stage.needs === id,
  );
  return !needsStone || player.items.some((item) => item.id === id);
}

export function hasDealItem(world: RewardWorld, player: Player): boolean {
  return itemIds.some((id) => routeItem(player, id, world, "deal"));
}

function availableStones(
  player: Player,
  offer: PendingChoice["offer"],
): Extract<Choice, { kind: "item" }>[] {
  if (
    offer?.kind !== "trophy" ||
    !offer.megaStones ||
    player.mega ||
    player.items.some((i) => i.id === "everstone") ||
    heldMega(player)
  )
    return [];
  let drop: ItemId | undefined;
  if (player.items.length >= itemSlots(player)) {
    let lowest = Infinity;
    for (const item of player.items) {
      if (megaStones.has(item.id) || item.level >= lowest) continue;
      lowest = item.level;
      drop = item.id;
    }
    if (!drop) return [];
  }
  return (starters[player.starter].megas ?? [])
    .filter(({ stone }) => !player.banished.includes(offerKey.item(stone)))
    .map(({ stone }) => ({ kind: "item", item: stone, ...(drop ? { drop } : {}) }));
}

/** Recheck against the live kit: co-op can grant a field item while the card is open. */
export function rewardChoiceEligible(
  world: RewardWorld,
  player: Player,
  pending: PendingChoice,
  choice: Choice,
): boolean {
  const { offer } = pending;
  const kind = offer?.kind;
  if (choice.kind === "item" && megaStones.has(choice.item))
    return availableStones(player, offer).some(
      (c) => c.item === choice.item && c.drop === choice.drop,
    );
  if (choice.kind === "stardust")
    return (
      !!kind &&
      itemIds.some(
        (id) => replacesHeldItem(world.rules, player, id) && routeItem(player, id, world, kind),
      )
    );
  if (choice.kind === "item")
    return (
      !replacesHeldItem(world.rules, player, choice.item) &&
      (kind
        ? routeItem(player, choice.item, world, kind)
        : itemEligible(
            player,
            choice.item,
            world.partners,
            false,
            hiddenAbilityAvailable(world, player),
          ))
    );
  if (kind === "deal") return false;
  switch (choice.kind) {
    case "decline":
      return pending.source === "mega-move";
    case "ability":
      return (
        !kind &&
        player.abilitySlot !== "hidden" &&
        formOf(player).abilities.normal[choice.slot] === choice.ability
      );
    case "upgrade":
      return player.moves.some((state) => state.id === choice.move && canUpgrade(player, state));
    case "move":
      if (pending.source === "mega-move")
        return (
          choice.move === megaMoveToLearn(player) &&
          (player.moves.length < moveSlots(player)
            ? choice.replace === undefined
            : player.moves.some((m) => m.id === choice.replace))
        );
      return (
        !kind &&
        player.moves.length < moveSlots(player) &&
        !player.banished.includes(offerKey.move(choice.move)) &&
        learnable(player, world.rules).some(({ move }) => move === choice.move)
      );
    case "tm-case":
      return !kind && !player.tmCase && !player.banished.includes(offerKey.tmCase);
    case "train":
      return (
        !kind ||
        (!player.moves.some((state) => canUpgrade(player, state)) &&
          !itemIds.some((id) => routeItem(player, id, world, kind)))
      );
  }
}

/** Only build an upgrade's random stats after its distinct move was actually drawn. */
export function rollRewardChoices(
  world: RewardWorld,
  player: Player,
  pending: PendingChoice,
  kept: readonly Choice[] = [],
): Choice[] {
  if (pending.source === "mega-move") {
    const move = megaMoveToLearn(player);
    if (!move) return [];
    const options: Choice[] =
      player.moves.length < moveSlots(player)
        ? [{ kind: "move", move }]
        : player.moves.map(({ id }) => ({ kind: "move", move, replace: id }));
    return [...options, { kind: "decline" }];
  }
  if (pending.source === "ability") {
    const [first, second] = formOf(player).abilities.normal;
    return second && player.abilitySlot !== "hidden"
      ? [
          { kind: "ability", slot: 0, ability: first },
          { kind: "ability", slot: 1, ability: second },
        ]
      : [];
  }
  const kind = pending.offer?.kind;
  if (!kind)
    return rollChoices(
      world.rng,
      player,
      pending.source,
      world.partners,
      pending.minRarity,
      world.rules,
      hiddenAbilityAvailable(world, player),
    );
  const keys = new Set(kept.map(banishKey));
  const keptStardust = kept.some((choice) => choice.kind === "stardust");
  let pool: (ItemId | MoveState)[] = itemIds.filter(
    (id) =>
      !keys.has(offerKey.item(id)) &&
      !(keptStardust && replacesHeldItem(world.rules, player, id)) &&
      routeItem(player, id, world, kind),
  );
  const options = [...kept];
  if (kind === "trophy") {
    for (const stone of availableStones(player, pending.offer))
      if (!keys.has(offerKey.item(stone.item)) && options.length < BASE_CHOICES)
        options.push(stone);
    const cord = pool.indexOf("linking-cord");
    if (
      cord >= 0 &&
      options.length < BASE_CHOICES &&
      stageFor(player, "trade") > stageFor(player)
    ) {
      pool.splice(cord, 1);
      options.push({ kind: "item", item: "linking-cord" });
    }
    for (const state of player.moves)
      if (!keys.has(offerKey.move(state.id)) && canUpgrade(player, state)) pool.push(state);
    if (!pool.length && !options.length) return training(world.rng, BASE_CHOICES);
  }
  const { luck } = playerStats(player);
  while (pool.length && options.length < BASE_CHOICES) {
    const candidate = pool.splice(Math.floor(next(world.rng) * pool.length), 1)[0]!;
    if (typeof candidate !== "string") options.push(rollUpgrade(world.rng, candidate.id, 2, luck));
    else if (replacesHeldItem(world.rules, player, candidate)) {
      options.push({ kind: "stardust" });
      // All eligible held items keep their original draw weight until the one distinct payout is drawn.
      pool = pool.filter(
        (entry) => typeof entry !== "string" || !replacesHeldItem(world.rules, player, entry),
      );
    } else options.push({ kind: "item", item: candidate });
  }
  return options;
}
/** Moves a card may teach now: kit moves past their gate, then the evolution moves unlocked so far. */
export function learnable(
  player: Player,
  rules: readonly RuleId[] = [],
): { move: MoveId; weight: number }[] {
  const line = starters[player.starter];
  const allowedTypes = rules.includes("mono-type") ? formOf(player).types : null;
  const offers: { move: MoveId; weight: number }[] = line.kit
    .filter(
      (move, i) =>
        player.level >= SIGNATURE_GATES[i]! &&
        (!allowedTypes || allowedTypes.includes(moves[move].type)),
    )
    .map((move) => ({ move, weight: choiceWeights.signature }));
  for (const move of [
    ...line.evolutionMoves.slice(0, player.stage),
    ...branchMoves(player).filter(
      (move) => !allowedTypes || allowedTypes.includes(moves[move].type),
    ),
  ])
    offers.push({ move, weight: choiceWeights.evolution });
  return offers.filter(({ move }) => !player.moves.some((state) => state.id === move));
}

/** `count` 训练 cards on different stats. */
function training(rng: Rng, count: number): Choice[] {
  const pool = [...trainStats];
  const cards: Choice[] = [];
  while (cards.length < count && pool.length > 0) {
    const [stat] = pool.splice(Math.floor(next(rng) * pool.length), 1);
    cards.push({ kind: "train", stat: stat! });
  }
  return cards;
}

/** Stats rolled per upgrade card: three from 史诗 up, else two. */
export function rollsPerUpgrade(power: number): number {
  return power >= UPGRADE_PICKS.extraFrom ? UPGRADE_PICKS.extra : UPGRADE_PICKS.base;
}

export function newMoveState(id: MoveId): MoveState {
  return {
    id,
    level: 1,
    cooldown: NEW_MOVE_COOLDOWN,
    damage: 0,
    mods: { dmg: 0, cd: 1, count: 0, area: 0, speed: 0, dur: 0, pierce: 0, crit: 0, status: 0 },
  };
}

function rollRarity(rng: Rng, minimum: Rarity, luck: number): Rarity {
  const r = next(rng);
  const [, rare, epic, legend] = rarityOdds(luck);
  const rolled: Rarity = r < legend ? 3 : r < legend + epic ? 2 : r < legend + epic + rare ? 1 : 0;
  return Math.max(rolled, minimum) as Rarity;
}

export function statValue(stat: UpgradeStat, power: number): number {
  switch (stat) {
    case "dmg":
      return UPGRADE_ROLL.dmg * power;
    case "cd":
      return Math.min(UPGRADE_ROLL.cdMax, UPGRADE_ROLL.cdPerPower * power);
    case "count":
      return power >= UPGRADE_ROLL.countHighFrom ? UPGRADE_ROLL.countHigh : UPGRADE_ROLL.countBase;
    case "pierce":
      return Math.max(UPGRADE_ROLL.pierceMin, Math.round(power));
    case "area":
      return UPGRADE_ROLL.area * power;
    case "speed":
      return UPGRADE_ROLL.speed * power;
    case "dur":
      return UPGRADE_ROLL.dur * power;
    case "crit":
      return UPGRADE_ROLL.crit * power;
    case "status":
      return UPGRADE_ROLL.status * power;
  }
}

function rollUpgrade(rng: Rng, move: MoveId, minimum: Rarity, luck: number): Choice {
  const rarity = rollRarity(rng, minimum, luck);
  const power = rarityPower[rarity];
  const pool = [...moves[move].stats];
  const rolls: { stat: UpgradeStat; value: number }[] = [];
  const picks = rollsPerUpgrade(power);
  while (rolls.length < picks && pool.length > 0) {
    const [stat] = pool.splice(Math.floor(next(rng) * pool.length), 1);
    if (stat) rolls.push({ stat, value: statValue(stat, power) });
  }
  return { kind: "upgrade", move, rarity, rolls };
}

/** `partners` are the run's partners: their types open those boosters to their owner. */
export function rollChoices(
  rng: Rng,
  player: Player,
  source: "level" | "chest",
  partners: readonly Partner[] = [],
  minRarity?: Rarity,
  rules: readonly RuleId[] = [],
  hiddenAvailable = false,
): Choice[] {
  const minimum = Math.max(MIN_UPGRADE_RARITY[source], minRarity ?? 0) as Rarity;
  const open = (key: string) => !player.banished.includes(key);
  const { luck } = playerStats(player);
  const upgradable = player.moves.filter((state) => canUpgrade(player, state));
  if (source === "chest") {
    const cards =
      upgradable.length === 0
        ? training(rng, BASE_CHOICES)
        : Array.from({ length: BASE_CHOICES }, (_, i) =>
            rollUpgrade(rng, upgradable[i % upgradable.length]!.id, minimum, luck),
          );
    if (
      !player.tmCase &&
      open(offerKey.tmCase) &&
      next(rng) < TM_CASE.chance * (1 + luck / LUCK_SCALING.unit)
    )
      cards[cards.length - 1] = { kind: "tm-case" };
    return cards;
  }
  const candidates: { weight: number; make: () => Choice }[] = [];
  for (const state of upgradable)
    candidates.push({
      weight: choiceWeights.upgrade,
      make: () => rollUpgrade(rng, state.id, minimum, luck),
    });
  if (player.moves.length < moveSlots(player)) {
    for (const { move, weight } of learnable(player, rules)) {
      if (open(offerKey.move(move)))
        candidates.push({ weight, make: () => ({ kind: "move", move }) });
    }
  }
  for (const owned of player.items)
    if (
      !replacesHeldItem(rules, player, owned.id) &&
      itemEligible(player, owned.id, partners, false, hiddenAvailable)
    )
      candidates.push({
        weight: choiceWeights.ownedItem,
        make: () => ({ kind: "item", item: owned.id }),
      });
  if (player.items.length < itemSlots(player)) {
    const pool = itemIds.filter(
      (id) =>
        !replacesHeldItem(rules, player, id) &&
        !player.items.some((item) => item.id === id) &&
        itemEligible(player, id, partners, false, hiddenAvailable),
    );
    const drawn: ItemId[] = [];
    for (let i = 0; i < Math.min(ITEM_DRAWS, pool.length); i++)
      candidates.push({
        weight: choiceWeights.newItem,
        make: () => {
          const id = drawItem(
            rng,
            player,
            luck,
            pool.filter((p) => !drawn.includes(p)),
          );
          drawn.push(id);
          return { kind: "item", item: id };
        },
      });
  }
  const count = BASE_CHOICES + (player.lab.rules.choices ?? 0);
  const choices: Choice[] = [];
  while (choices.length < count && candidates.length > 0) {
    const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let roll = next(rng) * total;
    const index = candidates.findIndex((candidate) => (roll -= candidate.weight) <= 0);
    const [chosen] = candidates.splice(index < 0 ? candidates.length - 1 : index, 1);
    if (chosen) choices.push(chosen.make());
  }
  // Training only fills slots no real card could.
  return [...choices, ...training(rng, count - choices.length)];
}

export function applyChoice(player: Player, choice: Choice): void {
  switch (choice.kind) {
    case "decline":
      break;
    case "ability":
      setAbilitySlot(player, choice.slot);
      break;
    case "move":
      if (choice.replace !== undefined) {
        const index = player.moves.findIndex((m) => m.id === choice.replace);
        if (index < 0) throw new Error(`未掌握招式 ${choice.replace}。`);
        player.moves[index] = newMoveState(choice.move);
        break;
      }
      if (player.moves.length >= moveSlots(player)) throw new Error("招式栏已满。");
      player.moves.push(newMoveState(choice.move));
      break;
    case "upgrade": {
      const state = player.moves.find((move) => move.id === choice.move);
      if (!state) throw new Error(`未掌握招式 ${choice.move}。`);
      if (state.level >= levelCap(player, state.id))
        throw new Error(`${choice.move} 已达最高等级。`);
      state.level += 1;
      state.mods.dmg += UPGRADE_BASE_DMG;
      for (const { stat, value } of choice.rolls) {
        if (stat === "cd") state.mods.cd *= 1 - value;
        else state.mods[stat] += value;
      }
      break;
    }
    case "stardust":
      earnStardust(player, HELD_ITEM_STARDUST);
      break;
    case "item": {
      if (choice.item === "ability-patch") {
        setAbilitySlot(player, "hidden");
        break;
      }
      const owned = player.items.find((item) => item.id === choice.item);
      const before = playerStats(player).maxHp;
      if (choice.drop) player.items = player.items.filter((item) => item.id !== choice.drop);
      if (owned) owned.level += 1;
      else player.items.push({ id: choice.item, level: 1 });
      // Max HP gains arrive filled, so HP Up is not a trap pick at low health.
      const after = playerStats(player).maxHp;
      player.hp = Math.min(after, player.hp + Math.max(0, after - before));
      break;
    }
    case "tm-case":
      player.tmCase = true;
      break;
    case "train": {
      const before = playerStats(player).maxHp;
      player.training[choice.stat] += 1;
      player.hp += Math.max(0, playerStats(player).maxHp - before);
      break;
    }
  }
  // The build changed; a frozen world (another card queued) does not step to refresh the memo.
  refreshStats();
}

function setAbilitySlot(player: Player, slot: Player["abilitySlot"]): void {
  const before = playerStats(player).maxHp;
  player.abilitySlot = slot;
  const { maxHp, dashCharges } = playerStats(player);
  player.hp = Math.min(maxHp, player.hp + Math.max(0, maxHp - before));
  player.dashes = Math.min(player.dashes, dashCharges);
}

const statLabels: Record<UpgradeStat, (value: number) => string> = {
  dmg: (v) => `伤害 +${Math.round(v * 100)}%`,
  cd: (v) => `冷却 -${Math.round(v * 100)}%`,
  count: (v) => `数量 +${v}`,
  pierce: (v) => `穿透 +${v}`,
  area: (v) => `范围 +${Math.round(v * 100)}%`,
  speed: (v) => `速度 +${Math.round(v * 100)}%`,
  dur: (v) => `持续 +${Math.round(v * 100)}%`,
  crit: (v) => `会心 +${Math.round(v * 100)}%`,
  status: (v) => `异常几率 +${Math.round(v * 100)}%`,
};

export function describeRoll(stat: UpgradeStat, value: number): string {
  return statLabels[stat](value);
}
