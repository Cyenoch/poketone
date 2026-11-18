import { TRAINER } from "./content/params/trainers";
import { ABILITY_PARAMS, abilities, abilityForSlot, type AbilityId } from "./content/abilities";
import { weatherDefs } from "./content/weather";
import type { WeatherId } from "./state/field";
import type { MoveId } from "./content/moves";
import {
  atLevel,
  isHitCondition,
  LOW_HP,
  statIds,
  type HitCondition,
  type Modifier,
  type ModifierDef,
  type ModifierOp,
  type ModifierSource,
  type PlayerCondition,
  type StatId,
} from "./content/effects";
import { boosted, resolveTrigger, scaled, type ResolvedTrigger } from "./content/triggers";
import { DICE_FACES, diceKey, itemIds, items, type ItemId, type ItemRule } from "./content/items";
import { megaDefs, starters } from "./content/lines/index";
import { signatureFusions } from "./content/fusions";
import { formOf } from "./evolution";
import type { LabBonuses, Player, TrainStat } from "./state/entities";
import { exp } from "./math";
import { XP_STEP } from "./content/params/pacing";
import { XP_LEVEL_OFFSET } from "./content/params/progression";
import { TRAIN } from "./content/params/cards";
import { AREA_GROWTH_MAX, ARMOR_HALF, BASE, LEVEL } from "./content/params/player";

export type StatKey = StatId;

export function currentAbility(player: Player): AbilityId {
  return abilityForSlot(formOf(player).abilities, player.abilitySlot);
}

/** No Guard only changes the owner's line moves, including its signature fusion. */
export function noGuardMove(player: Player, move: MoveId): boolean {
  if (currentAbility(player) !== "no-guard") return false;
  const line = starters[player.starter];
  return (
    line.kit.includes(move) ||
    line.evolutionMoves.includes(move) ||
    signatureFusions[line.id].result === move
  );
}

/** The caller chooses live weather or explicit null for a weather-free model. */
export function weatherMoveStats(
  move: MoveId,
  weather: WeatherId | null,
): { cooldown: number; count: number } {
  const tweak = weather === null ? undefined : weatherDefs[weather].moves?.[move];
  return { cooldown: tweak?.cooldown ?? 1, count: tweak?.count ?? 0 };
}

export interface PlayerStats extends Record<StatId, number> {
  /**
   * Extra damage factor per hit condition (Blaze's fire, type boosters, muscle band, cleanse tag…),
   * applied after type effectiveness (combat.ts); absent when nothing waits on that condition.
   */
  hit: Partial<Record<HitCondition, number>>;
  /** Every trigger the player has now (sim/triggers): items in content order, then the ability. */
  triggers: ActiveTrigger[];
}

/** A trigger taken at its source's step; `key` names its state in `Player.fx` / `Player.procs`. */
export interface ActiveTrigger {
  key: string;
  def: ResolvedTrigger;
}

function triggersOf(player: Player, ability: AbilityId): ActiveTrigger[] {
  const list: ActiveTrigger[] = [];
  for (const id of itemIds) {
    const level = player.items.find((item) => item.id === id)?.level ?? 0;
    if (level === 0) continue;
    items[id].effect.triggers?.forEach((def, i) =>
      list.push({ key: `item:${id}#${i}`, def: resolveTrigger(def, level - 1) }),
    );
  }
  abilities[ability].effect.triggers.forEach((def, i) =>
    list.push({ key: `ability:${ability}#${i}`, def: resolveTrigger(def, player.stage) }),
  );
  return list;
}

/**
 * Credits 星星沙子 to the run, scaled by the stardust-gain stat (content/params/economy.ts). Reads the
 * stats fresh, not the memo: a forget command changes items before the tick's `refreshStats`.
 */
export function earnStardust(player: Player, amount: number): void {
  player.stardust += amount * playerStats(player).stardust;
}

export const NO_LAB: LabBonuses = { modifiers: [], rules: {} };

const training: Record<TrainStat, ModifierDef<number>> = {
  dmg: { stat: "damage", op: "add", value: TRAIN.dmg },
  hp: { stat: "maxHp", op: "add", value: TRAIN.hp },
  speed: { stat: "speed", op: "pct", value: TRAIN.speed },
  area: { stat: "area", op: "add", value: TRAIN.area },
  cd: { stat: "cooldown", op: "mul", value: 1 - TRAIN.cd },
};

/** Saturating area growth toward 1 + AREA_GROWTH_MAX (params/player.ts). */
export function areaGrowth(raw: number): number {
  return 1 + AREA_GROWTH_MAX * (1 - exp(-(raw - 1) / AREA_GROWTH_MAX));
}

export type StatSourceKind = ModifierSource["kind"] | "deal";

/** Display order of the sources (form → level → items → ability → lab → training). */
export const SOURCE_ORDER: readonly StatSourceKind[] = [
  "evolution",
  "level",
  "item",
  "ability",
  "lab",
  "train",
  "deal",
];

export type StatOp = ModifierOp;

/** A modifier as the stats sheet shows it. */
export interface StatSource {
  kind: StatSourceKind;
  op: StatOp;
  amount: number;
  /** Item level, 训练 cards taken, or the player level. */
  count?: number;
  item?: ItemId;
  ability?: AbilityId;
  /** The condition the modifier waits on (低血量, 火属性招式). */
  when?: Modifier["when"];
  requires?: PlayerCondition;
  /** Whether the source is in `value` now; a conditional one that does not hold is listed but not counted. */
  active: boolean;
}

export interface StatLine {
  key: StatKey;
  /** The starting form's value (or the stat's fixed base). */
  base: number;
  /** Non-neutral modifiers, in fold order. */
  sources: StatSource[];
  /** What the sim uses: `playerStats(player)[key]`. */
  value: number;
  /** Area only: what a move without area upgrades gets after `areaGrowth`. */
  effective?: number;
}

export type StatBreakdown = Record<StatKey, StatLine>;

const neutral = (op: ModifierOp) => (op === "mul" || op === "div" ? 1 : 0);

/**
 * Every modifier on the player, in fold order: evolution → items (content order) → level → lab →
 * training → ability. Sums and products in this order are the bit-exact numbers the game was tuned
 * and recorded on (golden); the display order is `SOURCE_ORDER`.
 */
function modifiersOf(player: Player, ability: AbilityId): Modifier[] {
  const list: Modifier[] = [];
  const push = (def: ModifierDef<number>, source: ModifierSource) => {
    if (def.value !== neutral(def.op)) list.push({ ...def, source });
  };
  const line = starters[player.starter];
  const start = line.stages[0].form;
  const form = formOf(player);
  // Sterbenz: the forms of a line are within 2× of each other, so start + (form − start) is exactly form.
  push({ stat: "maxHp", op: "add", value: form.hp - start.hp }, { kind: "evolution" });
  push({ stat: "speed", op: "add", value: form.speed - start.speed }, { kind: "evolution" });
  if (player.mega)
    for (const mod of megaDefs[player.mega].modifiers) push(mod, { kind: "evolution" });
  for (const id of itemIds) {
    const count = player.items.find((item) => item.id === id)?.level ?? 0;
    if (count === 0) continue;
    for (const def of items[id].effect.modifiers)
      push({ ...def, value: atLevel(def.op, def.value, count) }, { kind: "item", item: id, count });
    // Loaded Dice: each level's rolled face (progression.ts `pickEffects`).
    if (items[id].onPick?.roll)
      for (let level = 1; level <= count; level++) {
        const face = DICE_FACES[player.fx[diceKey(level)] ?? -1];
        if (face) push(face, { kind: "item", item: id, count });
      }
    // Buffs (adrenaline orb…) fold their modifiers while their timer runs (triggers/player.ts).
    items[id].effect.triggers?.forEach((def, i) => {
      if (def.kind !== "buff" || !((player.fx[`item:${id}#${i}`] ?? 0) > 0)) return;
      const resolved = resolveTrigger(def, count - 1) as Extract<ResolvedTrigger, { kind: "buff" }>;
      // `:share` is written only by the balance model (expected uptime); the sim's buff is all on.
      const share = player.fx[`item:${id}#${i}:share`] ?? 1;
      for (const mod of def.mods)
        push(boosted(mod, resolved.power * share), { kind: "item", item: id, count });
    });
    // Scaling triggers (metronome…) fold as a modifier sized by the measure their tick wrote.
    items[id].effect.triggers?.forEach((def, i) => {
      if (def.kind !== "scaling") return;
      const resolved = resolveTrigger(def, count - 1) as Extract<
        ResolvedTrigger,
        { kind: "scaling" }
      >;
      const value = scaled(resolved, player.fx[`item:${id}#${i}`] ?? 0);
      push(
        { stat: def.stat, op: "add", value, ...(def.when ? { when: def.when } : {}) },
        { kind: "item", item: id, count },
      );
    });
  }
  push(
    { ...LEVEL, value: atLevel(LEVEL.op, LEVEL.value, player.level - 1) },
    { kind: "level", count: player.level },
  );
  for (const modifier of player.lab.modifiers) push(modifier, modifier.source);
  for (const stat of Object.keys(training) as TrainStat[]) {
    const def = training[stat];
    const count = player.training[stat];
    push({ ...def, value: atLevel(def.op, def.value, count) }, { kind: "train", count });
  }
  for (const def of abilities[ability].effect.modifiers)
    push({ ...def, value: def.value[player.stage]! }, { kind: "ability", ability });
  return list;
}

type PlayerState = Record<PlayerCondition, boolean>;

/** Whether a modifier counts in its stat's value; a hit condition never does (it is `hit`). */
const holds = (modifier: Modifier, state: PlayerState) =>
  (modifier.requires === undefined || state[modifier.requires]) &&
  (modifier.when === undefined || (!isHitCondition(modifier.when) && state[modifier.when]));

/** Whether a later stage still brings a new form (Eviolite). */
export function canEvolve(player: Player): boolean {
  return starters[player.starter].stages.some(
    (step, stage) => stage > player.stage && step.kind === "evolve",
  );
}

/** (base + Σadd) × (1 + Σpct) × Πmul ÷ Πdiv + Σextra over the modifiers `counts` keeps, in list order. */
function fold(base: number, modifiers: readonly Modifier[], counts: (m: Modifier) => boolean) {
  let value = base;
  for (const m of modifiers) if (m.op === "add" && counts(m)) value += m.value;
  let scale = 1;
  for (const m of modifiers) if (m.op === "pct" && counts(m)) scale += m.value;
  value *= scale;
  for (const m of modifiers) if (m.op === "mul" && counts(m)) value *= m.value;
  for (const m of modifiers) if (m.op === "div" && counts(m)) value /= m.value;
  for (const m of modifiers) if (m.op === "extra" && counts(m)) value += m.value;
  return value;
}

interface Folded {
  stats: PlayerStats;
  /** Each stat's modifiers, in fold order. */
  byStat: Record<StatId, Modifier[]>;
  bases: Record<StatId, number>;
  state: PlayerState;
}

/** The one fold behind both `playerStats` and the stats sheet, so the two can never disagree. */
function evaluate(player: Player, weather: WeatherId | null): Folded {
  const ability = currentAbility(player);
  const byStat = {} as Record<StatId, Modifier[]>;
  for (const stat of statIds) byStat[stat] = [];
  for (const modifier of modifiersOf(player, ability)) byStat[modifier.stat].push(modifier);
  const start = starters[player.starter].stages[0].form;
  const bases: Record<StatId, number> = { ...BASE, maxHp: start.hp, speed: start.speed };
  const stats = { hit: {}, triggers: triggersOf(player, ability) } as unknown as PlayerStats;
  const state: PlayerState = {
    lowHp: false,
    fullHp: false,
    canEvolve: canEvolve(player),
    pikachu: formOf(player).id === "pikachu",
    sun: weather === "sun",
    rain: weather === "rain",
    sandstorm: weather === "sandstorm",
    poisoned: player.statuses.some((s) => s.id === "poison"),
    slowed: player.statuses.some((s) => s.id === "slow"),
    charged: player.lightningRodTime > 0,
  };
  const counts = (m: Modifier) => holds(m, state);
  // Compute capacity first: HP thresholds and Rain Dish both use the final maximum.
  stats.maxHp = player.tradeHp * fold(bases.maxHp, byStat.maxHp, counts);
  state.lowHp = player.hp < LOW_HP * stats.maxHp;
  state.fullHp = player.hp >= stats.maxHp;
  if (ability === "rain-dish")
    byStat.regen.push({
      stat: "regen",
      op: "add",
      value: stats.maxHp * ABILITY_PARAMS.rainDishHealing,
      when: "rain",
      source: { kind: "ability", ability },
    });
  for (const stat of statIds)
    if (stat !== "maxHp") stats[stat] = fold(bases[stat], byStat[stat], counts);
  if (ability === "sand-veil") {
    // Sand Veil evades a share of the attacks left after the player's other evasion.
    const value = (1 - stats.evasion) * ABILITY_PARAMS.sandVeil;
    byStat.evasion.push({
      stat: "evasion",
      op: "extra",
      value,
      when: "sandstorm",
      source: { kind: "ability", ability },
    });
    if (state.sandstorm) stats.evasion += value;
  }
  for (const { when, requires } of byStat.damage) {
    if (
      when === undefined ||
      !isHitCondition(when) ||
      when in stats.hit ||
      (requires && !state[requires])
    )
      continue;
    stats.hit[when] = fold(
      1,
      byStat.damage,
      (m) => m.when === when && (!m.requires || state[m.requires]),
    );
  }
  if (player.assistBuffs.xSpeed) {
    stats.speed *= TRAINER.xSpeed.movement;
    stats.cooldown /= TRAINER.xSpeed.attackRate;
  }
  if (player.assistBuffs.direHit) stats.crit = 1;
  return { stats, byStat, bases, state };
}

/** An item rule summed over the player's items: per level × level (`ItemDef.rules`). */
export function itemRule(player: Player, rule: ItemRule): number {
  let total = 0;
  for (const owned of player.items) total += (items[owned.id].rules?.[rule] ?? 0) * owned.level;
  return total;
}

export function playerStats(player: Player, weather: WeatherId | null = null): PlayerStats {
  return evaluate(player, weather).stats;
}

/** Where every stat comes from, for the stats panel: the same fold, grouped by stat with its sources. */
export function statBreakdown(player: Player, weather: WeatherId | null = null): StatBreakdown {
  const { stats, byStat, bases, state } = evaluate(player, weather);
  const lines = {} as StatBreakdown;
  for (const stat of statIds)
    lines[stat] = {
      key: stat,
      base: bases[stat],
      sources: byStat[stat].map((modifier) => ({
        ...modifier.source,
        op: modifier.op,
        amount: modifier.value,
        when: modifier.when,
        ...(modifier.requires ? { requires: modifier.requires } : {}),
        active: holds(modifier, state),
      })),
      value: stats[stat],
    };
  if (player.tradeHp !== 1)
    lines.maxHp.sources.push({ kind: "deal", op: "mul", amount: player.tradeHp, active: true });
  lines.area.effective = areaGrowth(stats.area);
  return lines;
}

/**
 * Memo for the per-hit, per-heal and per-kill paths inside a step. Between refreshes even the
 * form, slot, weather and active HP/status conditions may change. The same player can
 * also be queried for a weather-independent stat (e.g. healing) between two hits in live weather.
 */
let generation = 0;
interface StatsMemo {
  generation: number;
  stage: number;
  slot: Player["abilitySlot"];
  state: PlayerState;
  stats: PlayerStats;
}
const memo = new WeakMap<Player, Partial<Record<WeatherId | "clear", StatsMemo>>>();

export function refreshStats(): void {
  generation++;
}

export function currentStats(player: Player, weather: WeatherId | null = null): PlayerStats {
  let entries = memo.get(player);
  if (!entries) memo.set(player, (entries = {}));
  const key = weather ?? "clear";
  const entry = entries[key];
  if (
    entry?.generation === generation &&
    entry.stage === player.stage &&
    entry.slot === player.abilitySlot &&
    entry.state.lowHp === player.hp < LOW_HP * entry.stats.maxHp &&
    entry.state.fullHp === player.hp >= entry.stats.maxHp &&
    entry.state.charged === player.lightningRodTime > 0 &&
    entry.state.poisoned === player.statuses.some((s) => s.id === "poison") &&
    entry.state.slowed === player.statuses.some((s) => s.id === "slow")
  )
    return entry.stats;
  const { stats, state } = evaluate(player, weather);
  entries[key] = { generation, stage: player.stage, slot: player.abilitySlot, state, stats };
  return stats;
}

/** Diminishing armor (params/player.ts ARMOR_HALF): 15 armor ≈ 27% less damage, 40 armor = 50%. */
export function armorFactor(armor: number): number {
  return ARMOR_HALF / (ARMOR_HALF + armor);
}

/** XP to go from `level` to the next: XP_STEP × (level + XP_LEVEL_OFFSET); no cap. */
export function xpForLevel(level: number): number {
  if (!(Number.isInteger(level) && level >= 1)) throw new RangeError(`xpForLevel: level ${level}`);
  return XP_STEP * (level + XP_LEVEL_OFFSET);
}
