// Partner bond comparison (docs/BALANCE.md「羁绊」): no bond / Lv2 / Lv4 / Lv5 with node, per starter,
// under no, mid and maxed lab. bun scripts/balance-bond.ts [difficulty=0] [--json]
// Env: BALANCE_SAMPLES, BALANCE_STARTERS. `balance:model` prints the same block.
import {
  BOND_ARMS,
  BOND_LABS,
  BOND_TOLERANCE,
  bondArm,
  bondPointsPerRun,
  bondMeanWithinTolerance,
  bondWithinTolerance,
  type BondArmResult,
  type BondOptions,
} from "../src/run/balance/bond.ts";
import { labBonuses } from "../src/run/lab.ts";
import { pct } from "../src/run/balance/budget.ts";
import { BUILD_SAMPLES } from "../src/run/balance/model.ts";
import { bondResearch } from "../src/run/sim/content/bonds.ts";
import { difficulties, type Difficulty } from "../src/run/sim/content/difficulties.ts";
import { starterOrder } from "../src/run/sim/content/lines/index.ts";
import { GUARDIAN_REFERENCE_SECONDS } from "../src/run/sim/content/params/pacing.ts";
import { LAB_PRICES } from "../src/run/sim/content/params/economy.ts";
import { BOND_LAB_MAX, BOND_THRESHOLDS } from "../src/run/sim/content/params/bonds.ts";

const fixed = (value: number, digits = 0) => value.toFixed(digits);
const cell = (r: BondArmResult) => `${pct(r.clear)}/${pct(r.reachBoss)}/${fixed(r.pressure, 2)}`;

export function printBondComparison(
  options: BondOptions,
  starters = starterOrder,
  labs: readonly (keyof typeof BOND_LABS)[] = ["none", "mid", "max"],
) {
  console.log(
    `\n羁绊对照（average；四条路线均值；${options.samples ?? BUILD_SAMPLES} 个样本；格式 通关/到达末守卫/压力指数；挺住按多一次致命保留 1 HP，自己治好按每图移除一次中毒，上限估计）`,
  );
  console.log(
    `  容差：满羁绊相对同研究所无羁绊，单个伙伴通关至多 +${pct(BOND_TOLERANCE.clear)}；伙伴均值通关至多 +${pct(BOND_TOLERANCE.meanClear)}、压力指数至多 ×${BOND_TOLERANCE.pressure}`,
  );
  console.log(
    `  节点价格 ${Array.from({ length: BOND_LAB_MAX }, (_, level) => Math.round(LAB_PRICES.bond.first * LAB_PRICES.bond.growth ** level)).join("/")} 星星沙子`,
  );
  for (const lab of labs) {
    console.log(`\n  研究所 ${lab}`);
    for (const difficulty of [0, 1, 2] as const) {
      const points = bondPointsPerRun(starters, {
        ...options,
        difficulty,
        lab: labBonuses(BOND_LABS[lab]),
      });
      console.log(
        `    每局羁绊点 ${difficulties[difficulty].name} ${fixed(points, 1)}（扣取整损失）· 到 ${BOND_THRESHOLDS.map((threshold, i) => `Lv${i + 1} ${fixed(threshold / points, 1)}`).join(" / ")} 局`,
      );
    }
    console.log(
      `    ${"starter".padEnd(11)}${BOND_ARMS.map((arm) => arm.name.padEnd(22)).join("")}Δ通关  压力×  容差`,
    );
    const pairs: [BondArmResult, BondArmResult][] = [];
    for (const starter of starters) {
      const rows = BOND_ARMS.map((arm) => bondArm(starter, BOND_LABS[lab], arm.bond, options));
      const base = rows[0]!;
      const full = rows.at(-1)!;
      pairs.push([base, full]);
      console.log(
        `    ${starter.padEnd(11)}${rows.map((r) => cell(r).padEnd(22)).join("")}${pct(full.clear - base.clear).padStart(6)} ${fixed(full.pressure / base.pressure, 3).padStart(6)}  ${bondWithinTolerance(base, full) ? "ok" : "OUT"}  (${bondResearch[starter].label})`,
      );
    }
    console.log(`    伙伴均值容差 ${bondMeanWithinTolerance(pairs) ? "ok" : "OUT"}`);
  }
}

if (import.meta.main) {
  const difficulty = Number(process.argv[2] ?? 0) as Difficulty;
  if (!difficulties[difficulty]) throw new Error(`未知难度 ${process.argv[2]}（0/1/2）。`);
  const samples = process.env.BALANCE_SAMPLES ? Number(process.env.BALANCE_SAMPLES) : undefined;
  const roster = process.env.BALANCE_STARTERS?.split(",") ?? starterOrder;
  if (roster.some((id) => !starterOrder.includes(id as (typeof starterOrder)[number])))
    throw new Error(`Unknown BALANCE_STARTERS: ${roster.join(",")}`);
  printBondComparison(
    { difficulty, samples, summonSeconds: Array<number>(4).fill(GUARDIAN_REFERENCE_SECONDS) },
    roster as typeof starterOrder,
  );
}
