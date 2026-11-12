import { abilities, type AbilityId } from "./content/abilities";
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
  type StatId,
} from "./content/effects";
import { boosted, resolveTrigger, scaled, type ResolvedTrigger } from "./content/triggers";
import { DICE_FACES, diceKey, itemIds, items, type ItemId, type ItemRule } from "./content/items";
import { starters } from "./content/lines/index";
import { formOf } from "./evolution";
import type { LabBonuses, Player, TrainStat } from "./state/entities";
import { exp } from "./math";
import { XP_STEP } from "./content/params/pacing";
import { XP_LEVEL_OFFSET } from "./content/params/progression";
import { TRAIN } from "./content/params/cards";
import { AREA_GROWTH_MAX, ARMOR_HALF, BASE, LEVEL } from "./content/params/player";

export type StatKey = StatId;

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

function triggersOf(player: Player): ActiveTrigger[] {
  const list: ActiveTrigger[] = [];
  for (const id of itemIds) {
    const level = player.items.find((item) => item.id === id)?.level ?? 0;
    if (level === 0) continue;
    items[id].effect.triggers?.forEach((def, i) =>
      list.push({ key: `item:${id}#${i}`, def: resolveTrigger(def, level - 1) }),
    );
  }
  const { ability } = starters[player.starter];
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

export type StatSourceKind = ModifierSource["kind"];

/** Display order of the sources (form → level → items → ability → lab → training). */
export const SOURCE_ORDER: readonly StatSourceKind[] = [
  "evolution",
  "level",
  "item",
  "ability",
  "lab",
  "train",
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
function modifiersOf(player: Player): Modifier[] {
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
  for (const id of itemIds) {
    const count = player.items.find((item) => item.id === id)?.level ?? 0;
    if (count === 0) continue;
    for (const def of items[id].effect.modifiers)
      push({ ...def, value: atLevel(def.op, def.value, count) }, { kind: "item", item: id, count });
    // Loaded Dice: each level's rolled face (world.ts `pickEffects`).
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
  for (const def of abilities[line.ability].effect.modifiers)
    push({ ...def, value: def.value[player.stage]! }, { kind: "ability", ability: line.ability });
  return list;
}

interface PlayerState {
  lowHp: boolean;
  canEvolve: boolean;
}

/** Whether a modifier counts in its stat's value; a hit condition never does (it is `hit`). */
const holds = (modifier: Modifier, state: PlayerState) =>
  modifier.when === undefined ||
  (modifier.when === "lowHp" && state.lowHp) ||
  (modifier.when === "canEvolve" && state.canEvolve);

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
function evaluate(player: Player): Folded {
  const byStat = {} as Record<StatId, Modifier[]>;
  for (const stat of statIds) byStat[stat] = [];
  for (const modifier of modifiersOf(player)) byStat[modifier.stat].push(modifier);
  const start = starters[player.starter].stages[0].form;
  const bases: Record<StatId, number> = { ...BASE, maxHp: start.hp, speed: start.speed };
  const stats = { hit: {}, triggers: triggersOf(player) } as unknown as PlayerStats;
  const evolving = canEvolve(player);
  // Max HP decides the low-HP condition, so it never depends on it.
  stats.maxHp = fold(bases.maxHp, byStat.maxHp, (m) =>
    holds(m, { lowHp: false, canEvolve: evolving }),
  );
  const state = { lowHp: player.hp < LOW_HP * stats.maxHp, canEvolve: evolving };
  const counts = (m: Modifier) => holds(m, state);
  for (const stat of statIds)
    if (stat !== "maxHp") stats[stat] = fold(bases[stat], byStat[stat], counts);
  for (const { when } of byStat.damage) {
    if (when === undefined || !isHitCondition(when) || when in stats.hit) continue;
    stats.hit[when] = fold(1, byStat.damage, (m) => m.when === when);
  }
  return { stats, byStat, bases, state };
}

/** An item rule summed over the player's items: per level × level (`ItemDef.rules`). */
export function itemRule(player: Player, rule: ItemRule): number {
  let total = 0;
  for (const owned of player.items) total += (items[owned.id].rules?.[rule] ?? 0) * owned.level;
  return total;
}

export function playerStats(player: Player): PlayerStats {
  return evaluate(player).stats;
}

/** Where every stat comes from, for the stats panel: the same fold, grouped by stat with its sources. */
export function statBreakdown(player: Player): StatBreakdown {
  const { stats, byStat, bases, state } = evaluate(player);
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
        active: holds(modifier, { ...state, lowHp: state.lowHp && stat !== "maxHp" }),
      })),
      value: stats[stat],
    };
  lines.area.effective = areaGrowth(stats.area);
  return lines;
}

/**
 * `playerStats` memo for the per-hit, per-heal and per-kill paths inside a step. Within one generation the
 * inputs only change through HP crossing `LOW_HP` (checked on every read); `refreshStats` opens a new
 * generation at every tick and after a level-up (level, stage). Items, training and moves change through
 * commands, which run before the tick's refresh.
 */
let generation = 0;
const memo = new WeakMap<Player, { generation: number; low: boolean; stats: PlayerStats }>();

export function refreshStats(): void {
  generation++;
}

export function currentStats(player: Player): PlayerStats {
  const entry = memo.get(player);
  if (entry?.generation === generation && entry.low === player.hp < LOW_HP * entry.stats.maxHp)
    return entry.stats;
  const stats = playerStats(player);
  memo.set(player, { generation, low: player.hp < LOW_HP * stats.maxHp, stats });
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
