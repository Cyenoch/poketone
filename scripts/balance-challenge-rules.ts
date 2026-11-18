import { average, profiles } from "../src/run/balance/skill";
import { DEEP_LIMITS, validateDeepBuild, type DeepBuild } from "../src/run/balance/deep-builds";
import { FIELD_MODEL_LIMITS } from "../src/run/balance/field-events";
import { runModel, type RunModel, type RunOptions } from "../src/run/balance/model";
import { CHALLENGE_MODEL_LIMITS, CHALLENGE_PARAMETERS } from "../src/run/balance/challenge-rules";
import { ruleIds, rules as ruleDefs, type RuleId } from "../src/run/sim/content/rules";
import { ALL_ROUTES } from "../src/run/sim/content/campaign";
import { starterOrder, type StarterId } from "../src/run/sim/content/lines/index";
import { difficulties, type Difficulty } from "../src/run/sim/content/difficulties";
import type { FieldEventId } from "../src/run/sim/state/field";
import { labBonuses } from "../src/run/lab";

export const CHALLENGE_VARIANTS = [...ruleIds, "all"] as const;
type Variant = (typeof CHALLENGE_VARIANTS)[number];
const LIMITS = [...FIELD_MODEL_LIMITS, ...CHALLENGE_MODEL_LIMITS];

const LAB_PRESETS = {
  none: {},
  revive: { revive: 1 },
  slots4: { "slot-move": 1, "slot-vit": 1 },
} as const;

function countEvents(ids: readonly FieldEventId[]) {
  const counts: Partial<Record<FieldEventId, number>> = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

function summarize(run: RunModel) {
  const challenge = run.challenge!;
  return {
    summonSeconds: run.summonSeconds,
    ...challenge,
    rawStardust: run.stardust,
    outcome: run.outcome,
    kills: run.kills,
    evolutions: run.evolutions,
    fused: run.fused,
    exposure: Object.fromEntries(run.exposure),
    maps: run.zoneClears.map((field, index) => {
      const events = run.fieldEvents[index]!;
      return {
        ...field,
        fight: run.fights[index],
        entered: events.entered,
        entryWeight: events.entryWeight,
        completed: events.completed,
        earned: events.earned,
        scheduledEvents: countEvents(
          events.schedules.flatMap((schedule) =>
            schedule.flatMap(({ beat }) => (beat.kind === "event" ? [beat.id] : [])),
          ),
        ),
        triggeredEvents: countEvents(events.events.flatMap((trace) => trace.map(({ id }) => id))),
        output: run.buildFields[index]!,
        weatherSeconds: events.income.weatherSeconds,
        weatherHpCost: events.income.weatherHpCost,
        weatherEnemyHp: events.income.enemyWeatherHp,
        schedules: events.schedules,
        events: events.events,
        ...challenge.pressure[index]!,
        previousExit: run.entryWindows.find((pair) => pair.field === index)?.exit ?? null,
      };
    }),
  };
}

export function compareChallengeRules(
  options: RunOptions,
  variants: readonly Variant[] = CHALLENGE_VARIANTS,
) {
  const run = (rules: readonly RuleId[]) => summarize(runModel({ ...options, rules }));
  const baseline = run([]);
  return {
    baseline,
    variants: variants.map((id) => {
      const result = run(id === "all" ? ruleIds : [id]);
      return {
        id,
        result,
        delta: {
          clearPp: 100 * (result.outcome.clear - baseline.outcome.clear),
          survivalSeconds: result.outcome.meanSurvival - baseline.outcome.meanSurvival,
          rawStardust: result.rawStardust - baseline.rawStardust,
          stardust: result.stardust - baseline.stardust,
        },
      };
    }),
  };
}

if (import.meta.main) {
  // bun scripts/balance-challenge-rules.ts [0|1|2] [samples] [--json]
  // BALANCE_DEEP_BUILD 与 balance:model 使用同一套构筑参数。
  const args = process.argv.slice(2).filter((arg) => arg !== "--json");
  const difficulty = Number(args[0] ?? 0) as Difficulty;
  const samples = Number(args[1] ?? 8);
  if (!difficulties[difficulty]) throw new Error("难度必须为 0、1 或 2。");
  if (!Number.isInteger(samples) || samples < 1) throw new Error("样本数必须为正整数。");
  const roster = (process.env.BALANCE_STARTERS ?? "charmander,bulbasaur,geodude,squirtle").split(
    ",",
  ) as StarterId[];
  if (roster.some((id) => !starterOrder.includes(id)))
    throw new Error(`未知伙伴 ${roster.join(",")}`);
  const skill = profiles.find(
    (entry) => entry.name === (process.env.BALANCE_PROFILE ?? average.name),
  );
  if (!skill) throw new Error(`未知画像 ${process.env.BALANCE_PROFILE}`);
  const lab = (process.env.BALANCE_LAB ?? "none") as keyof typeof LAB_PRESETS;
  if (!Object.hasOwn(LAB_PRESETS, lab))
    throw new Error("BALANCE_LAB 必须为 none、revive 或 slots4。");
  const routeKey = process.env.BALANCE_ROUTE;
  const routes = routeKey ? ALL_ROUTES.filter((route) => route.join(",") === routeKey) : ALL_ROUTES;
  if (!routes.length) throw new Error(`无效的四图路线 ${routeKey}`);
  const variants = process.env.BALANCE_VARIANTS?.split(",") as Variant[] | undefined;
  if (variants?.some((id) => !CHALLENGE_VARIANTS.includes(id)))
    throw new Error(`未知规则组 ${variants.join(",")}`);
  const buildInput = process.env.BALANCE_DEEP_BUILD;
  const deepBuild: DeepBuild | undefined =
    buildInput === undefined ? undefined : JSON.parse(buildInput);
  if (deepBuild !== undefined) for (const starter of roster) validateDeepBuild(starter, deepBuild);
  const limits = deepBuild ? [...LIMITS, ...DEEP_LIMITS] : LIMITS;
  const seed = 0x5eed;
  const results = routes.flatMap((route) =>
    roster.map((starter) => ({
      route,
      starter,
      ...compareChallengeRules(
        {
          route,
          starter,
          difficulty,
          skill,
          lab: labBonuses(LAB_PRESETS[lab]),
          samples,
          seed,
          deepBuild,
        },
        variants,
      ),
    })),
  );
  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify({
        difficulty,
        samples,
        seed,
        profile: skill.name,
        lab,
        deepBuild,
        parameters: CHALLENGE_PARAMETERS,
        limits,
        results,
      }),
    );
  } else {
    console.log(
      `${difficulties[difficulty].name} · ${skill.name} · 每组 ${samples} 样本 · 种子 ${seed} · 研究 ${lab}`,
    );
    if (deepBuild) console.log(`预装构筑 ${JSON.stringify(deepBuild)}`);
    for (const row of results) {
      console.log(
        `\n${row.route.join(" → ")} · ${row.starter} · 每图 ${row.baseline.summonSeconds.join("/")} 秒召唤`,
      );
      for (const { id, result } of [
        { id: "none" as const, result: row.baseline },
        ...row.variants,
      ]) {
        const name = id === "none" ? "无规则" : id === "all" ? "全选" : ruleDefs[id].name;
        console.log(
          `${name}  清图 ${result.maps.map((map) => (100 * map.clear).toFixed(1) + "%").join(" / ")}  生存 ${result.outcome.meanSurvival.toFixed(0)}s  星沙 ${result.rawStardust.toFixed(0)} × ${result.multiplier.toFixed(2)} = ${result.stardust.toFixed(0)}`,
        );
        console.log(
          `  清图等级 ${result.maps.map((map) => map.level?.toFixed(1) ?? "—").join(" / ")} · 召唤前清怪供需 ${result.maps.map((map) => map.preSummon?.pressure.toFixed(2) ?? "—").join(" / ")} · 召唤前承伤 % HP/s ${result.maps.map((map) => (map.preSummon ? (100 * map.preSummon.landed).toFixed(2) : "—")).join(" / ")}`,
        );
      }
    }
    for (const limit of limits) console.log(`- ${limit}`);
  }
}
