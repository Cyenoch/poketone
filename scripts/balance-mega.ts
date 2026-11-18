// Mega evolution comparison (docs/BALANCE.md「超级进化」): no mega / Ｘ / Ｙ on the same route and seeds.
// bun scripts/balance-mega.ts [difficulty=0] [route=all|forest,desert,glacier,tower] [--json]
// Env: BALANCE_SAMPLES, BALANCE_MEGA_GRANT=extra|replace. `balance:model` prints the same block.
import { clock, pct } from "../src/run/balance/budget.ts";
import {
  compareMega,
  flareBlitzBudget,
  MEGA_LIMITS,
  megaReference,
  type MegaRun,
  type MegaRunOptions,
} from "../src/run/balance/mega-report.ts";
import { MEGA_PARAMS, type MegaGrant } from "../src/run/balance/mega.ts";
import { BUILD_SAMPLES } from "../src/run/balance/model.ts";
import { average } from "../src/run/balance/skill.ts";
import { TARGETS } from "../src/run/balance/targets.ts";
import { ALL_ROUTES, routeFields } from "../src/run/sim/content/campaign.ts";
import { difficulties, type Difficulty } from "../src/run/sim/content/difficulties.ts";
import { GUARDIAN_REFERENCE_SECONDS } from "../src/run/sim/content/params/pacing.ts";
import { stageDefs, type StageId } from "../src/run/sim/content/stages/index.ts";

const fixed = (value: number | null | undefined, digits = 0) =>
  value === undefined || value === null ? "—" : value.toFixed(digits);

export function megaGrant(value = process.env.BALANCE_MEGA_GRANT): MegaGrant {
  if (value === undefined) return "extra";
  if (value !== "extra" && value !== "replace")
    throw new RangeError("BALANCE_MEGA_GRANT must be extra or replace");
  return value;
}

const arms = (runs: readonly MegaRun[], cell: (run: MegaRun) => string) =>
  runs
    .map((run) => `${run.arm === "none" ? "无" : run.arm.toUpperCase()} ${cell(run)}`)
    .join(" · ");

export function printMegaComparison(
  options: Omit<MegaRunOptions, "route" | "skill">,
  routes: readonly (readonly StageId[])[],
  grant: MegaGrant,
) {
  const { difficulty } = options;
  console.log(
    `\n超级进化对照（小火龙线，average；Ｘ=超级喷火龙Ｘ，Ｙ=超级喷火龙Ｙ；同一路线、同一批种子；${options.samples ?? BUILD_SAMPLES} 个样本；招式 grant=${grant}）`,
  );
  for (const limit of MEGA_LIMITS) console.log(`  模型假设 · ${limit}`);
  console.log(
    `  日照（Ｙ）仅按天气占用率近似：${MEGA_PARAMS.droughtSeconds} 秒大晴天，超级进化时和每次入图；下表 weather 列为实际自施天气占用。`,
  );
  for (const route of routes) {
    const runs = compareMega({ ...options, route, skill: average }, grant);
    const fields = routeFields(route);
    console.log(`\n  路线 ${route.join(" → ")}`);
    console.log(
      `    终局通关 ${arms(runs, (r) => pct(r.clear))} · 到达末守卫 ${arms(runs, (r) => pct(r.reachBoss))} · 进化 ${arms(runs.slice(1), (r) => (r.mega ? `${pct(r.mega.share)}${r.mega.at === null ? "" : ` @${clock(r.mega.at)}`}` : "—"))}`,
    );
    for (const [index, field] of fields.entries()) {
      const at = (r: MegaRun) => r.maps[index]!;
      console.log(
        `    ${index + 1}. ${stageDefs[field.stage].name}  守卫到达/击败 ${arms(runs, (r) => `${pct(at(r).reach)}/${pct(at(r).clear)}`)}`,
      );
      console.log(
        `       群怪 HP/s ${arms(runs, (r) => fixed(at(r).capacity))} · 压力指数 ${arms(runs, (r) => fixed(at(r).pressure, 2))} · 守卫 DPS ${arms(runs, (r) => fixed(at(r).single))} · EHP ${arms(runs, (r) => fixed(at(r).ehp))} · 存活 ${arms(runs, (r) => pct(at(r).alive))} · weather ${arms(runs, (r) => (at(r).selfWeather === null ? "—" : pct(at(r).selfWeather!)))} · 守卫战 ${arms(runs, (r) => (at(r).fightSeconds === null ? "—" : `${fixed(at(r).fightSeconds)}s/${fixed(at(r).fightCost, 2)}`))}`,
      );
    }
  }
  const budget = flareBlitzBudget(2, routes[0]![2]!, difficulty, average);
  console.log(
    `\n  闪焰冲锋预算（与全体招式中位数之比，目标 ${TARGETS.budget.min}–${TARGETS.budget.max}×）：群怪 ${fixed(budget.aoeRel, 2)}× 守卫 ${fixed(budget.singleRel, 2)}×；含硬爪 ${fixed(budget.clawsAoeRel, 2)}× / ${fixed(budget.clawsSingleRel, 2)}×`,
  );
  const late = new Map(
    routes.flatMap((route) => [2, 3].map((step) => [route[step]!, step] as const)),
  );
  console.log(
    "\n  参考构筑（60 级喷火龙，三招各 10 次期望强化，各图 5:00 人群；相对无超级进化；Ｙ按日照占用率混合晴/无天气）",
  );
  for (const [stage, step] of late) {
    const rows = megaReference(step as 2 | 3, stage, difficulty, average, grant);
    const base = rows[0]!;
    console.log(
      `    ${stageDefs[stage].name}: ${rows.map((r) => `${r.arm === "none" ? "无" : r.arm.toUpperCase()} 群怪 ${fixed(r.swarm)} (${fixed(r.swarm / base.swarm, 2)}×) 守卫 ${fixed(r.guardian)} (${fixed(r.guardian / base.guardian, 2)}×) EHP ${fixed(r.ehp)} (${fixed(r.ehp / base.ehp, 2)}×) 反作用 ${fixed(r.recoil, 2)} HP/s`).join(" · ")}`,
    );
  }
}

if (import.meta.main) {
  const difficulty = Number(process.argv[2] ?? 0) as Difficulty;
  if (!difficulties[difficulty]) throw new Error(`未知难度 ${process.argv[2]}（0/1/2）。`);
  const spec = process.argv[3] ?? "all";
  const routes =
    spec === "all" ? ALL_ROUTES : [spec.split(",") as unknown as (typeof ALL_ROUTES)[number]];
  const samples = process.env.BALANCE_SAMPLES ? Number(process.env.BALANCE_SAMPLES) : undefined;
  printMegaComparison(
    {
      difficulty,
      samples,
      summonSeconds: Array<number>(4).fill(GUARDIAN_REFERENCE_SECONDS),
    },
    routes,
    megaGrant(),
  );
}
