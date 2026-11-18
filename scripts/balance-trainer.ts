// Trainer support comparison (docs/BALANCE.md「训练师」): no trainer and each of the four trainers on
// the same routes and seeds. bun scripts/balance-trainer.ts [difficulty=0] [--json]
// Env: BALANCE_SAMPLES, BALANCE_STARTERS, BALANCE_LAB=none|mid|max (default mid).
// `balance:model --trainer` prints the same block.
import { pct } from "../src/run/balance/budget.ts";
import { BOND_LABS } from "../src/run/balance/bond.ts";
import { BUILD_SAMPLES } from "../src/run/balance/model.ts";
import {
  NON_COMBAT,
  TRAINER_ARMS,
  tinkerExtra,
  trainerArm,
  type TrainerArmResult,
  type TrainerOptions,
  trainerReference,
} from "../src/run/balance/trainer-report.ts";
import { difficulties, type Difficulty } from "../src/run/sim/content/difficulties.ts";
import { starterOrder, type StarterId } from "../src/run/sim/content/lines/index.ts";
import { GUARDIAN_REFERENCE_SECONDS } from "../src/run/sim/content/params/pacing.ts";
import { assistNames, trainerKits, type TrainerId } from "../src/run/sim/content/trainers.ts";

export function printTrainerComparison(
  options: TrainerOptions,
  starters: readonly StarterId[] = starterOrder,
  lab: keyof typeof BOND_LABS = "mid",
) {
  console.log(
    `\n训练师对照（average；四条路线均值；${options.samples ?? BUILD_SAMPLES} 个样本；研究所 ${lab}；道具按 90 秒冷却折算平均收益，首次立即可用；单人，好伤药不计队友）`,
  );
  for (const [id, text] of Object.entries(NON_COMBAT))
    console.log(`  非战斗被动 ${id}：${text}，不入模型`);
  console.log(
    `  巧修（tinker）：遗忘返还 +50%，满级（8 级）招式多返 ${tinkerExtra(8)} 星星沙子，纯经济`,
  );
  const rows = new Map<TrainerId | undefined, TrainerArmResult[]>();
  for (const trainer of TRAINER_ARMS) rows.set(trainer, []);
  for (const starter of starters)
    for (const trainer of TRAINER_ARMS)
      rows.get(trainer)!.push(trainerArm(starter, trainer, BOND_LABS[lab], options));
  const mean = (list: TrainerArmResult[], pick: (r: TrainerArmResult) => number) =>
    list.reduce((sum, r) => sum + pick(r), 0) / list.length;
  const base = rows.get(undefined)!;
  console.log("  参考构筑（10 级、套路各 2 次强化、森林 5:00；九线均值）：");
  for (const trainer of Object.keys(trainerKits) as TrainerId[]) {
    const refs = starters.map((starter) => trainerReference(starter, trainer, options.difficulty));
    const avg = (pick: (r: (typeof refs)[number]) => number) =>
      refs.reduce((sum, r) => sum + pick(r), 0) / refs.length;
    console.log(
      `    ${trainer.padEnd(8)}${assistNames[trainerKits[trainer].assist]}+${trainerKits[trainer].passive}  群怪 ×${avg((r) => r.swarm).toFixed(3)} · 守卫 ×${avg((r) => r.guardian).toFixed(3)} · 同伴 ×${avg((r) => r.partner).toFixed(3)} · 回复抵消承伤 ${pct(avg((r) => r.healShare))} · 毒伤移除 ${pct(avg((r) => r.poisonCover))}`,
    );
  }
  console.log("  完整模型（相对无训练师，同种子）：");
  console.log(
    `    无训练师  通关 ${pct(mean(base, (r) => r.clear))} · 到达末守卫 ${pct(mean(base, (r) => r.reachBoss))} · 平均存活 ${mean(base, (r) => r.meanSurvival).toFixed(0)}s`,
  );
  for (const trainer of Object.keys(trainerKits) as TrainerId[]) {
    const list = rows.get(trainer)!;
    const gain = starters.map((_, i) => list[i]!.clear - base[i]!.clear);
    const mid = gain.reduce((sum, value) => sum + value, 0) / gain.length;
    console.log(
      `    ${trainer.padEnd(8)}通关 ${mid >= 0 ? "+" : ""}${pct(mid)}（单线 ${pct(Math.min(...gain))}…${pct(Math.max(...gain))}） · 到达末守卫 ${pct(mean(list, (r) => r.reachBoss) - mean(base, (r) => r.reachBoss))} · 存活 ${(mean(list, (r) => r.meanSurvival) - mean(base, (r) => r.meanSurvival)).toFixed(0)}s`,
    );
  }
}

if (import.meta.main) {
  const difficulty = Number(process.argv[2] ?? 0) as Difficulty;
  if (!difficulties[difficulty]) throw new Error(`未知难度 ${process.argv[2]}（0/1/2）。`);
  const samples = process.env.BALANCE_SAMPLES ? Number(process.env.BALANCE_SAMPLES) : undefined;
  const roster = process.env.BALANCE_STARTERS?.split(",") ?? starterOrder;
  if (roster.some((id) => !starterOrder.includes(id as StarterId)))
    throw new Error(`Unknown BALANCE_STARTERS: ${roster.join(",")}`);
  const lab = (process.env.BALANCE_LAB ?? "mid") as keyof typeof BOND_LABS;
  if (!(lab in BOND_LABS))
    throw new Error(`BALANCE_LAB must be ${Object.keys(BOND_LABS).join("/")}`);
  printTrainerComparison(
    { difficulty, samples, summonSeconds: Array<number>(4).fill(GUARDIAN_REFERENCE_SECONDS) },
    roster as StarterId[],
    lab,
  );
}
