// Trainer comparison arms and reference (docs/BALANCE.md「训练师」); the item model itself is trainer.ts.
import { FORGET } from "../sim/content/params/economy";
import type { StarterId } from "../sim/content/lines/index";
import { ALL_ROUTES } from "../sim/content/campaign";
import { labBonuses } from "../lab";
import type { LabLevels } from "../sim/content/lab";
import { buildOutput, runModel, type RunOptions } from "./model";
import { referencePlayer, referenceTarget } from "./budget";
import type { BuildPlayer } from "./deep-builds";
import type { Difficulty } from "../sim/content/difficulties";
import { starters } from "../sim/content/lines/index";
import { GUARDIAN_REFERENCE_SECONDS } from "../sim/content/params/pacing";
import { average } from "./skill";
import { assistPoisonCover } from "./trainer";
import { trainerKits, type TrainerId } from "../sim/content/trainers";
import { TRAINER } from "../sim/content/params/trainers";

export const TRAINER_ARMS = [undefined, ...(Object.keys(trainerKits) as TrainerId[])] as const;

export interface TrainerArmResult {
  clear: number;
  reachBoss: number;
  meanSurvival: number;
  /** Mean over minutes and routes of the swarm HP/s, guardian DPS and effective HP. */
  swarm: number;
  guardian: number;
  ehp: number;
}

export type TrainerOptions = Pick<RunOptions, "difficulty"> & {
  samples?: number;
  summonSeconds: readonly number[];
  fieldEvents?: boolean;
};

/** One trainer (or none) for one starter: the four routes' mean under the average profile. */
export function trainerArm(
  starter: StarterId,
  trainer: TrainerId | undefined,
  labLevels: LabLevels,
  options: TrainerOptions,
): TrainerArmResult {
  const runs = ALL_ROUTES.map((route) =>
    runModel({ ...options, route, starter, skill: average, lab: labBonuses(labLevels), trainer }),
  );
  const mean = (value: (run: (typeof runs)[number]) => number) =>
    runs.reduce((sum, run) => sum + value(run), 0) / runs.length;
  const minutes = (value: (m: (typeof runs)[number]["minutes"][number]) => number) =>
    mean(
      (run) => run.minutes.reduce((sum, m) => sum + value(m), 0) / Math.max(1, run.minutes.length),
    );
  return {
    clear: mean((run) => run.outcome.clear),
    reachBoss: mean((run) => run.outcome.reachBoss),
    meanSurvival: mean((run) => run.outcome.meanSurvival),
    swarm: minutes((m) => m.capacity),
    guardian: minutes((m) => m.single),
    ehp: minutes((m) => m.ehp),
  };
}

/**
 * 修缮 (tinker) pays +50% on every forget refund: a move at level L adds `L × FORGET.move × 0.5`
 * star dust. Pure economy; it enters no combat number.
 */
export const tinkerExtra = (level: number) => level * FORGET.move * (TRAINER.tinker.refund - 1);

export const NON_COMBAT = {
  scout: "小地图标记显示距离 ×1.5，只改画面读取距离",
  naturalist: "异色出现率 ×1.5（全队共享不叠加），图鉴遇见计数 +50%",
} as const;

export interface TrainerReference {
  /** Output ratios of the reference build (10 级，套路各 2 次强化，森林 5:00 人群) with / without the item. */
  swarm: number;
  guardian: number;
  /** Partner damage per second ratio (damage × attack rate). */
  partner: number;
  /** Item heal per second as a share of the reference build's incoming damage per second. */
  healShare: number;
  /** Share of poison drain removed. */
  poisonCover: number;
}

/** Deterministic reference at the forest 5:00 crowd, so the four items read in one place. */
export function trainerReference(
  starter: StarterId,
  trainer: TrainerId,
  difficulty: Difficulty,
): TrainerReference {
  const target = referenceTarget(0, "forest", difficulty, average, false);
  const outputOf = (id: TrainerId | undefined) => {
    const player: BuildPlayer = referencePlayer(starter, starters[starter].kit, 2);
    player.trainerProjection = id;
    return buildOutput(player, target);
  };
  const base = outputOf(undefined);
  const out = outputOf(trainer);
  const minute = runModel({
    stage: "forest",
    step: 0,
    starter,
    difficulty,
    skill: average,
    samples: 8,
    summonSeconds: [GUARDIAN_REFERENCE_SECONDS],
    fieldEvents: false,
  }).minutes.find((m) => m.t === 300);
  const heal =
    trainerKits[trainer].assist === "superPotion"
      ? (out.stats.maxHp * TRAINER.superPotion.hp) / TRAINER.cooldown
      : 0;
  return {
    swarm: out.useful / base.useful,
    guardian: out.single / base.single,
    partner:
      (out.stats.partnerDamage * out.stats.partnerRate) /
      (base.stats.partnerDamage * base.stats.partnerRate),
    healShare: minute && minute.inDps > 0 ? heal / minute.inDps : 0,
    poisonCover: assistPoisonCover(trainer),
  };
}
