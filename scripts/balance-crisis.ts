// Paired single-route diagnostic for 危机充能 (docs/BALANCE.md). Same builds, clock and seeds.
import { runModel } from "../src/run/balance/model";
import { average, expert } from "../src/run/balance/skill";
import { BOND_LABS } from "../src/run/balance/bond";
import { labBonuses } from "../src/run/lab";
import { ALL_ROUTES } from "../src/run/sim/content/campaign";
import { GUARDIAN_REFERENCE_SECONDS } from "../src/run/sim/content/params/pacing";

const samples = Number(process.env.BALANCE_SAMPLES ?? 16);
for (const [profile, difficulty, skill, lab] of [
  ["弱构筑", 0, average, "none"],
  ["高压", 1, average, "none"],
  ["强构筑", 0, expert, "max"],
] as const) {
  for (const crisisCharge of [false, true]) {
    const run = runModel({
      starter: "charmander",
      route: ALL_ROUTES[0]!,
      skill,
      difficulty,
      lab: labBonuses(BOND_LABS[lab]),
      crisisCharge,
      samples,
      seed: 0x5eed,
      summonSeconds: Array(4).fill(GUARDIAN_REFERENCE_SECONDS),
      fieldEvents: false,
    });
    const pressure = run.minutes.reduce((sum, m) => sum + m.pressure, 0) / run.minutes.length;
    console.log(
      `${profile} ${crisisCharge ? "开" : "关"}  供需 ${pressure.toFixed(2)}  施放 ${run.ultimate.casts.toFixed(2)}  通关 ${(run.outcome.clear * 100).toFixed(2)}%  存活 ${run.outcome.meanSurvival.toFixed(1)}s`,
    );
  }
}
