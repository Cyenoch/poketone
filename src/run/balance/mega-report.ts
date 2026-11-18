// Mega evolution comparison (docs/BALANCE.md「超级进化」): the same route and seeds with no mega,
// Ｘ and Ｙ, read per map; plus a fixed reference build at the moment of evolution. Pure
// reading of `runModel`; the mega stage itself is `mega.ts`.
import type { Difficulty } from "../sim/content/difficulties";
import type { RouteStep } from "../sim/content/campaign";
import { liveCap } from "../sim/director";
import { starters } from "../sim/content/lines/index";
import { stageDefs, type StageId } from "../sim/content/stages/index";
import { zoneClock } from "../sim/content/params/zones";
import { playerStats, xpForLevel } from "../sim/stats";
import { createPlayer } from "../sim/world";
import { newMoveState } from "../sim/upgrades";
import {
  expectedMods,
  moveBudgets,
  REFERENCE_LEVEL,
  REFERENCE_UPGRADES,
  referenceTarget,
} from "./budget";
import {
  evolveMega,
  megaMove,
  MEGA_PARAMS,
  recoilShare,
  type MegaBranch,
  type MegaGrant,
} from "./mega";
import { buildOutput, fieldAt, runModel, targetFor, throughShare, type RunOptions } from "./model";
import { moveOutput } from "./output";
import type { SkillProfile } from "./skill";

export type MegaArm = "none" | MegaBranch;
export const MEGA_ARMS: readonly MegaArm[] = ["none", "x", "y"];

/** What the mega stage assumes; printed with every comparison. */
export const MEGA_LIMITS = [
  "超级形态是最终形态之后的一个阶段：二图守卫奖杯拿到进化石（占一个道具栏，背包满时丢弃最低等级道具），喷火龙形态下进入超级形态，只补新增最大生命并获得进化无敌。",
  "日照只按天气占用率近似：超级进化时和每次入图的 30 秒大晴天（与自施、野外天气取最后生效者），不模拟其与求雨的互相覆盖。",
  "超级特性替换原特性：猛火（或太阳之力）的数值被精确撤销；超级形态的属性（火/龙、火/飞行）只影响天气伤害免疫，未影响受击克制。",
  "闪焰冲锋借用龙之俯冲的几何（物理波）和升级项，只改威力、冷却、火属性和 10% 灼伤；反作用按每次命中施放折为非致死的最大生命流失。候选池中的第二招（龙之俯冲、暴风）未建模。",
  "新招按 grant 取得：extra 额外增加一格招式栏；replace 在栏满时顶替升级最少的招式。均为分析假设，现行卡牌规则在招式栏满时不会再提供新招。",
];

export interface MegaMap {
  stage: StageId;
  reach: number;
  clear: number;
  /** Mean level and run second at the guardian kill. */
  level: number | null;
  clearAt: number | null;
  /** Minute rows inside the map: swarm clearing, guardian DPS, EHP, pressure = capacity / incoming. */
  capacity: number;
  single: number;
  ehp: number;
  pressure: number;
  alive: number;
  /** Alive-weighted share of the map spent in the player's own weather. */
  selfWeather: number | null;
  /** Guardian fight: seconds and cost in max HP over the samples that killed it. */
  fightSeconds: number | null;
  fightCost: number | null;
}

export interface MegaRun {
  arm: MegaArm;
  clear: number;
  reachBoss: number;
  mega: { share: number; at: number | null } | null;
  maps: MegaMap[];
}

/** One arm on one route; the minute rows are split by each map's alive-weighted guardian kill time. */
export type MegaRunOptions = Omit<
  Extract<RunOptions, { route: readonly StageId[] }>,
  "mega" | "starter"
>;

export function megaRun(arm: MegaArm, options: MegaRunOptions, grant: MegaGrant): MegaRun {
  const run = runModel({
    ...options,
    starter: "charmander",
    ...(arm === "none" ? {} : { mega: { branch: arm, grant } }),
  });
  let from = 0;
  const maps = run.zoneClears.map((zone, index): MegaMap => {
    const to = zone.t ?? from + stageDefs[zone.stage].duration;
    const rows = run.minutes.filter((m) => m.t > from && m.t <= to);
    const mean = (pick: (m: (typeof rows)[number]) => number) =>
      rows.length ? rows.reduce((sum, m) => sum + pick(m), 0) / rows.length : 0;
    const incoming = mean((m) => m.incoming);
    const field = run.buildFields[index]!;
    const fight = run.fights[index];
    from = to;
    return {
      stage: zone.stage,
      reach: zone.reach,
      clear: zone.clear,
      level: zone.level,
      clearAt: zone.t,
      capacity: mean((m) => m.capacity),
      single: mean((m) => m.single),
      ehp: mean((m) => m.ehp),
      pressure: incoming > 0 ? mean((m) => m.capacity) / incoming : 0,
      alive: mean((m) => m.alive),
      selfWeather: field.selfWeatherShare,
      fightSeconds: fight && fight.completed > 0 ? fight.seconds : null,
      fightCost: fight && fight.completed > 0 ? fight.cost : null,
    };
  });
  return { arm, clear: run.outcome.clear, reachBoss: run.outcome.reachBoss, mega: run.mega, maps };
}

export function compareMega(options: MegaRunOptions, grant: MegaGrant = "extra"): MegaRun[] {
  return MEGA_ARMS.map((arm) => megaRun(arm, options, grant));
}

/** A level-60 Charizard with three fire moves, 10 expected upgrades each, evolving on the spot. */
export const REFERENCE_MEGA = {
  level: 60,
  upgrades: 10,
  kit: ["fire-blast", "flamethrower", "lava-plume"],
} as const;

export interface MegaReference {
  arm: MegaArm;
  /** Swarm HP/s, guardian DPS, effective HP and recoil HP/s, sun-weighted for Ｙ. */
  swarm: number;
  guardian: number;
  ehp: number;
  recoil: number;
  maxHp: number;
}

/** The reference build at a map's 5:00 crowd; Ｙ's output mixes sun and no-sun by 日照's occupancy. */
export function megaReference(
  step: RouteStep,
  stage: StageId,
  difficulty: Difficulty,
  skill: SkillProfile,
  grant: MegaGrant = "extra",
  time = 300,
): MegaReference[] {
  const at = (weather: "sun" | null) => {
    const field = fieldAt(step, stage, time, difficulty, false, 0, { weather, outbreak: null });
    return targetFor(field, liveCap(zoneClock(step, time), difficulty) / 2, skill);
  };
  const sunShare = MEGA_PARAMS.droughtSeconds / stageDefs[stage].duration;
  return MEGA_ARMS.map((arm) => {
    const player = createPlayer(0, "charmander", 0);
    player.level = REFERENCE_MEGA.level;
    player.xpNext = xpForLevel(player.level);
    player.stage = starters.charmander.stages.length - 1;
    player.moves = REFERENCE_MEGA.kit.map((id) => ({
      ...newMoveState(id),
      mods: expectedMods(id, REFERENCE_MEGA.upgrades),
    }));
    const build = Object.assign(player, {
      megaProjection:
        arm === "none"
          ? undefined
          : { branch: arm, grant, stone: true, active: false, at: null as number | null },
    });
    if (arm !== "none") evolveMega(build, 0);
    player.hp = playerStats(player).maxHp;
    const sunny = arm === "y" ? sunShare : 0;
    const weight = [
      { share: 1 - sunny, target: at(null) },
      { share: sunny, target: at("sun") },
    ].filter((w) => w.share > 0);
    const mix = (pick: (out: ReturnType<typeof buildOutput>) => number) =>
      weight.reduce((sum, w) => sum + w.share * pick(buildOutput(build, w.target)), 0);
    const stats = playerStats(player);
    return {
      arm,
      swarm: mix((o) => o.useful),
      guardian: mix((o) => o.single + o.bossBurn),
      ehp: stats.maxHp / throughShare(stats),
      recoil: stats.maxHp * recoilShare(build, stats, null, 1),
      maxHp: stats.maxHp,
    };
  });
}

/**
 * 闪焰冲锋 against the same budget every kit move is read at (budget.ts: level 10, four upgrades,
 * type-neutral 5:00 crowd), as a multiple of the all-starter median move; `claws` adds 硬爪.
 */
export function flareBlitzBudget(
  step: RouteStep,
  stage: StageId,
  difficulty: Difficulty,
  skill: SkillProfile,
) {
  const [first] = moveBudgets(step, stage, difficulty, skill);
  const median = { aoe: first!.aoe / first!.aoeRel, single: first!.single / first!.singleRel };
  const player = createPlayer(0, "charmander", 0);
  player.level = REFERENCE_LEVEL;
  player.xpNext = xpForLevel(player.level);
  const shape = MEGA_PARAMS.flareBlitz.shape;
  player.moves = [{ ...newMoveState(shape), mods: expectedMods(shape, REFERENCE_UPGRADES) }];
  const build = Object.assign(player, {
    megaProjection: {
      branch: "x" as const,
      grant: "extra" as const,
      stone: true,
      active: true,
      at: 0,
    },
  });
  const out = moveOutput(
    player.moves[0]!,
    playerStats(player),
    referenceTarget(step, stage, difficulty, skill, true),
    1,
    1,
    megaMove(build, shape),
  );
  const claws = MEGA_PARAMS.toughClaws;
  return {
    aoeRel: out.useful / median.aoe,
    singleRel: out.single / median.single,
    clawsAoeRel: (out.useful * claws) / median.aoe,
    clawsSingleRel: (out.single * claws) / median.single,
  };
}
