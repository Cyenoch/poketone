// Power budgets: every move and item measured at the same reference point so designs can be compared
// directly (the spreadsheet "cost curve" view), plus the advisory warnings the CLI prints.

import { setMeasures } from "./triggers";
import { formOf } from "../sim/evolution";
import { items, type ItemId } from "../sim/content/items";
import { moves, type MoveId } from "../sim/content/moves";
import { starterOrder, starters, type StarterId } from "../sim/content/lines/index";
import { signatureFusions } from "../sim/content/fusions";
import type { Difficulty } from "../sim/content/difficulties";
import { liveCap } from "../sim/director";
import { playerStats, xpForLevel } from "../sim/stats";
import { createRng } from "../sim/rng";
import { type StageId } from "../sim/content/stages/index";
import type { MoveMods, Player } from "../sim/state/entities";
import { rarityOdds, rollsPerUpgrade, statValue, newMoveState } from "../sim/upgrades";
import { rarityPower, MAX_FUSION_STARS, UPGRADE_BASE_DMG } from "../sim/content/params/cards";
import { createPlayer } from "../sim/world";
import { mergeMods } from "../sim/fusion";
import { buildOutput, buildValue, fieldAt, previewChoice, targetFor, type RunModel } from "./model";
import { moveOutput, type Target } from "./output";
import type { SkillProfile } from "./skill";
import { TARGETS } from "./targets";

/** Reference point for budgets: the 5:00 crowd at half the live cap, a level-10 player. */
export const REFERENCE_TIME = 300;
/** Fusions are measured at the 8:00 crowd: they arrive around 8:30, not at the 5:00 reference. */
export const FUSION_TIME = 480;
export const REFERENCE_LEVEL = 10;
/** Upgrades every move gets before comparison, so moves are compared at equal investment. */
export const REFERENCE_UPGRADES = 4;
/** Advisory band around the median. */
export const OUTLIER = 0.4;

/** Expected mods after `upgrades` level-up cards on one move (rarity-weighted rolls, real values). */
export function expectedMods(id: MoveId, upgrades: number, luck = 0): MoveMods {
  const pool = moves[id].stats;
  const odds = rarityOdds(luck);
  const perCard = (stat: (typeof pool)[number]) =>
    odds.reduce((sum, p, rarity) => {
      const power = rarityPower[rarity as 0 | 1 | 2 | 3];
      const share = Math.min(1, rollsPerUpgrade(power) / pool.length);
      return sum + p * share * statValue(stat, power);
    }, 0);
  const gain = (stat: (typeof pool)[number]) => (pool.includes(stat) ? perCard(stat) : 0);
  return {
    dmg: upgrades * (UPGRADE_BASE_DMG + gain("dmg")),
    cd: (1 - gain("cd")) ** upgrades,
    count: upgrades * gain("count"),
    area: upgrades * gain("area"),
    speed: upgrades * gain("speed"),
    dur: upgrades * gain("dur"),
    pierce: upgrades * gain("pierce"),
    crit: upgrades * gain("crit"),
    status: upgrades * gain("status"),
  };
}

function referencePlayer(starter: StarterId, kit: readonly MoveId[], upgrades: number): Player {
  const player = createPlayer(0, starter, 0);
  player.level = REFERENCE_LEVEL;
  player.xpNext = xpForLevel(player.level);
  player.moves = kit.map((id) => ({ ...newMoveState(id), mods: expectedMods(id, upgrades) }));
  return player;
}

function referenceTarget(
  stage: StageId,
  difficulty: Difficulty,
  skill: SkillProfile,
  neutral: boolean,
  time = REFERENCE_TIME,
): Target {
  const field = fieldAt(stage, time, difficulty, false);
  const target = targetFor(field, liveCap(time, difficulty) / 2, skill);
  if (!neutral) return target;
  const flat = Object.fromEntries(Object.keys(target.typeVs).map((type) => [type, 1]));
  const typeVs = flat as Target["typeVs"];
  return { ...target, typeVs, boss: { ...target.boss, typeVs } };
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

export interface MoveBudget {
  move: MoveId;
  starter: StarterId;
  /** Swarm targets per cast, swarm HP removed per second, guardian DPS, control enemy-s/s. */
  targets: number;
  aoe: number;
  single: number;
  control: number;
  /** Relative to the median move; `baseRel` is the swarm budget before any upgrade. */
  aoeRel: number;
  singleRel: number;
  baseRel: number;
}

/** Each kit and evolution move alone at the reference point, type-neutral, normalised to the median move. */
export function moveBudgets(
  stage: StageId,
  difficulty: Difficulty,
  skill: SkillProfile,
): MoveBudget[] {
  const target = referenceTarget(stage, difficulty, skill, true);
  const rows = starterOrder.flatMap((starter) =>
    [...starters[starter].kit, ...starters[starter].evolutionMoves].map((move) => {
      const output = (upgrades: number) => {
        const player = referencePlayer(starter, [move], upgrades);
        return moveOutput(player.moves[0]!, playerStats(player), target);
      };
      const out = output(REFERENCE_UPGRADES);
      return {
        move,
        starter,
        targets: out.targets,
        aoe: out.useful,
        single: out.single,
        control: out.control,
        base: output(0).useful,
      };
    }),
  );
  const aoeMid = median(rows.map((row) => row.aoe));
  const singleMid = median(rows.map((row) => row.single));
  const baseMid = median(rows.map((row) => row.base));
  return rows.map(({ base, ...row }) => ({
    ...row,
    aoeRel: row.aoe / aoeMid,
    singleRel: row.single / singleMid,
    baseRel: base / baseMid,
  }));
}

/** Upgrade cards a move has taken on reaching `MAX_MOVE_LEVEL` (it starts at level 1). */
export const MAXED_UPGRADES = 7;

export interface FusionBudget {
  starter: StarterId;
  move: MoveId;
  /** Fusion output at ★1 over the two max-level parts it replaces (swarm, guardian). */
  aoe: number;
  single: number;
  aoeRel: number;
  singleRel: number;
  /** Fusion over two median moves at max level: the same yardstick for every line. */
  aoeMid: number;
  singleMid: number;
  /** ★5 (four more expected star cards) over ★1, swarm and guardian. */
  aoeGrowth: number;
  singleGrowth: number;
}

/**
 * Each line's fusion at ★1 (both parts' expected max-level mods merged) against the two parts it
 * replaces, at the budget reference point, type-neutral. A fusion also frees a slot, so ≈ 1× is break-even.
 */
export function fusionBudgets(
  stage: StageId,
  difficulty: Difficulty,
  skill: SkillProfile,
): FusionBudget[] {
  const target = referenceTarget(stage, difficulty, skill, true, FUSION_TIME);
  const maxed = starterOrder.flatMap((starter) =>
    [...starters[starter].kit, ...starters[starter].evolutionMoves].map((id) => {
      const player = referencePlayer(starter, [id], MAXED_UPGRADES);
      return moveOutput(player.moves[0]!, playerStats(player), target);
    }),
  );
  const aoeMid = 2 * median(maxed.map((out) => out.useful));
  const singleMid = 2 * median(maxed.map((out) => out.single));
  return starterOrder.map((starter) => {
    const {
      result: move,
      match: { pair },
    } = signatureFusions[starter];
    const parts = referencePlayer(starter, pair, MAXED_UPGRADES);
    const stats = playerStats(parts);
    const before = parts.moves.map((state) => moveOutput(state, stats, target));
    const fused = referencePlayer(starter, [move], 0);
    fused.moves[0]!.mods = mergeMods(parts.moves[0]!.mods, parts.moves[1]!.mods);
    const after = moveOutput(fused.moves[0]!, playerStats(fused), target);
    const stars = expectedMods(move, MAX_FUSION_STARS - 1);
    const merged = fused.moves[0]!.mods;
    fused.moves[0]!.mods = { ...mergeMods(merged, stars), cd: merged.cd * stars.cd };
    const grown = moveOutput(fused.moves[0]!, playerStats(fused), target);
    const aoe = before[0]!.useful + before[1]!.useful;
    const single = before[0]!.single + before[1]!.single;
    return {
      starter,
      move,
      aoe: after.useful,
      single: after.single,
      aoeRel: after.useful / aoe,
      singleRel: after.single / single,
      aoeMid: after.useful / aoeMid,
      singleMid: after.single / singleMid,
      aoeGrowth: grown.useful / after.useful,
      singleGrowth: grown.single / after.single,
    };
  });
}

export interface ItemValue {
  item: ItemId;
  /** Gain in the model's build value (log utility, ≈ fraction) from the first level. */
  value: Record<StarterId, number>;
  rel: number;
}

/** The run state scaling items are valued at: mid-run kills and rates, at 70% HP. */
const REFERENCE_RUN = { kills: 400, killRate: 3, hurtRate: 0.5, frac: 0.7 };

/** Marginal value of one item level on a full reference kit (2 expected upgrades per move). */
export function itemValues(
  stage: StageId,
  difficulty: Difficulty,
  skill: SkillProfile,
): ItemValue[] {
  const target = referenceTarget(stage, difficulty, skill, false);
  const ids = Object.keys(items) as ItemId[];
  const rows = ids.map((item) => {
    const value = Object.fromEntries(
      starterOrder.map((starter) => {
        const base = referencePlayer(starter, starters[starter].kit, 2);
        const withItem = previewChoice(
          base,
          { kind: "item", item },
          createRng(0x5eed),
          target,
          skill,
        );
        const formSpeed = formOf(withItem).speed;
        setMeasures(withItem, { ...REFERENCE_RUN, formSpeed }, playerStats(withItem));
        return [starter, buildValue(withItem, target, skill) - buildValue(base, target, skill)];
      }),
    ) as Record<StarterId, number>;
    return { item, value };
  });
  const mean = (row: (typeof rows)[number]) =>
    starterOrder.reduce((sum, starter) => sum + row.value[starter], 0) / starterOrder.length;
  const mid = median(rows.map(mean));
  return rows.map((row) => ({ ...row, rel: mean(row) / mid }));
}

/** Kit strength per starter at the reference point with the real type matchups. */
export function starterKits(stage: StageId, difficulty: Difficulty, skill: SkillProfile) {
  const target = referenceTarget(stage, difficulty, skill, false);
  return starterOrder.map((starter) => {
    const out = buildOutput(referencePlayer(starter, starters[starter].kit, 2), target);
    return { starter, aoe: out.useful, single: out.single };
  });
}

/** m:ss for a time in seconds. */
const clock = (t: number) => {
  const seconds = Math.round(t);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Clear chances further apart than this between starters (same skill) count as a wide spread. */
export const SPREAD = TARGETS.starterSpread;
/** An expert clear chance above this on every starter suggests the tier asks for no skill. */
export const TRIVIAL = 0.9;

/** Advisory findings; none of these gate anything. */
export function warnings(
  runs: readonly RunModel[],
  budgets: readonly MoveBudget[],
  values: readonly ItemValue[],
): string[] {
  const out: string[] = [];
  for (const run of runs) {
    const tag = `${run.starter}/${run.skill}`;
    const bossAt = run.summonSeconds[0]!;
    const low = run.minutes.find((m) => m.t < bossAt && m.pressure < 1);
    if (low)
      out.push(
        `${tag}: pressure ${low.pressure.toFixed(2)} at ${clock(low.t)} (a full crowd outgrows the build)`,
      );
    const death = run.outcome.medianDeath;
    if (death !== null && death < bossAt)
      out.push(`${tag}: half of runs dead by ${clock(death)}, before the guardian`);
    if (run.bossTtk !== null && run.bossTtk > run.bossWindow)
      out.push(`${tag}: guardian TTK ${Math.round(run.bossTtk)} s > ${run.bossWindow} s window`);
  }
  const off = (rel: number) => Math.abs(rel - 1) > OUTLIER;
  for (const b of budgets) {
    if (!off(b.aoeRel) && !off(b.baseRel) && !off(b.singleRel)) continue;
    // Low damage is the point of a move whose value is crowd control.
    const control = b.control > 0.3 && b.aoeRel < 1 - OUTLIER ? " (control move)" : "";
    out.push(
      `move ${b.move}: swarm ${b.aoeRel.toFixed(2)}× (base ${b.baseRel.toFixed(2)}×), guardian ${b.singleRel.toFixed(2)}× median${control}`,
    );
  }
  for (const v of values)
    if (Math.abs(v.rel - 1) > OUTLIER)
      out.push(`item ${v.item}: marginal value ${pct(v.rel)} of median`);

  for (const skill of new Set(runs.map((run) => run.skill))) {
    const group = runs.filter((run) => run.skill === skill);
    const clears = group.map((run) => run.outcome.clear);
    if (Math.max(...clears) - Math.min(...clears) > SPREAD)
      out.push(
        `starter spread (${skill}): clear ${group.map((run) => `${run.starter} ${pct(run.outcome.clear)}`).join(", ")}`,
      );
    if (skill === "expert" && Math.min(...clears) > TRIVIAL)
      out.push(
        `expert clears ≥ ${pct(Math.min(...clears))} on every starter: the tier may ask for no skill`,
      );
  }
  return out;
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
export { clock, pct };
