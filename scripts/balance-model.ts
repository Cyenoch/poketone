// Analytical balance model (docs/BALANCE.md): per-minute tables per starter across the skill band,
// build scenarios, move / item power budgets and advisory warnings.
// Usage: bun run balance:model [difficulty=0] [lab=none|mid|slots4|luck|party] [stage=campaign|forest|…] [zones=1] [summonSeconds=510,30,30,30,30,30]
// Default: all six maps with one carried build. An explicit map runs that map alone.
import {
  clock,
  FUSION_TIME,
  fusionBudgets,
  itemValues,
  moveBudgets,
  pct,
  REFERENCE_LEVEL,
  REFERENCE_TIME,
  REFERENCE_UPGRADES,
  starterKits,
  warnings,
} from "../src/run/balance/budget.ts";
import { runModel, type RunModel } from "../src/run/balance/model.ts";
import { labBonuses } from "../src/run/lab.ts";
import { type LabLevels } from "../src/run/sim/content/lab.ts";
import { average, expert, profiles, scenarios } from "../src/run/balance/skill.ts";
import { inRange, TARGETS, type Range } from "../src/run/balance/targets.ts";
import { items } from "../src/run/sim/content/items.ts";
import { difficulties, type Difficulty } from "../src/run/sim/content/difficulties.ts";
import { moves } from "../src/run/sim/content/moves.ts";
import { stageDefs, type StageId } from "../src/run/sim/content/stages/index.ts";
import { starterOrder, starters } from "../src/run/sim/content/lines/index.ts";
import { CAMPAIGN_FIELDS } from "../src/run/sim/content/campaign.ts";
import { GUARDIAN_REFERENCE_SECONDS } from "../src/run/sim/content/params/pacing.ts";

const difficulty = Number(process.argv[2] ?? 0) as Difficulty;
if (!difficulties[difficulty]) throw new Error(`未知难度 ${process.argv[2]}（0/1/2）。`);
/** Lab presets: mid = 10 levels; slots4 = four move slots and one extra item slot. */
const labPresets: Record<string, LabLevels> = {
  none: {},
  mid: { dmg: 2, hp: 2, armor: 1, regen: 1, spd: 1, xp: 1, gold: 1, magnet: 1 },
  slots4: { "slot-move": 1, "slot-vit": 1 },
  /** 财运 maxed (+30 luck) and nothing else. */
  luck: { luck: 6 },
  /** 支援队伍 (3 partner slots) and nothing else. */
  party: { party: 1 },
};
const labName = process.argv[3] ?? "none";
const preset = labPresets[labName];
if (!preset) throw new Error(`未知研究所预设 ${labName}（${Object.keys(labPresets).join("/")}）。`);
const lab = labBonuses(preset);
const campaign = (process.argv[4] ?? "campaign") === "campaign";
// Campaign runModel selects its own fields; standalone power budgets still use a real map.
const stage = (campaign ? "forest" : process.argv[4]) as StageId;
if (!stageDefs[stage])
  throw new Error(`未知关卡 ${process.argv[4]}（campaign/${Object.keys(stageDefs).join("/")}）。`);
const zones = Number(process.argv[5] ?? 1);
if (!(Number.isInteger(zones) && zones >= 1 && zones <= stageDefs[stage].zones.length))
  throw new Error(`未知区域数 ${process.argv[5]}（1–${stageDefs[stage].zones.length}）。`);
const started = performance.now();
const fields = campaign
  ? CAMPAIGN_FIELDS
  : Array.from({ length: zones }, (_, zone) => ({ stage, zone }));
const summonSeconds = process.argv[6]
  ? process.argv[6].split(",").map(Number)
  : fields.map(() => GUARDIAN_REFERENCE_SECONDS);
const scope = campaign
  ? `campaign ${fields.map((field) => field.stage).join(" → ")} (${fields.length} fields)`
  : `single map ${stageDefs[stage].name} (${stage}, ${zones} field${zones > 1 ? "s" : ""})`;
const finalStage = fields.at(-1)!.stage;

const band = (runs: readonly RunModel[], value: (run: RunModel) => string) =>
  runs.map(value).join("/");
const at = (run: RunModel, t: number) => run.minutes.find((m) => m.t === t);
const fixed = (value: number | null | undefined, digits = 0) =>
  value === undefined || value === null ? "—" : value.toFixed(digits);
const pad = (text: string, width: number) => text.padStart(width);
const fightAt = (run: RunModel, field: number) => {
  const fight = run.fights[field];
  if (!fight) return "0/0·not attempted";
  const count = `${fight.completed}/${fight.attempted}`;
  if (fight.completed === 0) return `${count}·incomplete`;
  return `${count}·${fixed(fight.seconds)}s·${fixed(fight.cost, 2)} HP${fight.completed < fight.attempted ? `·${fight.attempted - fight.completed} incomplete` : ""}`;
};

console.log(
  `poketone analytical balance model — ${difficulties[difficulty].name} (difficulty ${difficulty}), lab ${labName}; ${scope}; bands are ${profiles.map((p) => p.name).join(" / ")}`,
);
console.log(
  `Normal field limits: ${fields.map((field) => `${stageDefs[field.stage].name} ${clock(stageDefs[field.stage].duration)}`).join(" · ")}; guardian overtime may extend elapsed time.`,
);
console.log(
  `Guardian calibration: ${clock(GUARDIAN_REFERENCE_SECONDS)}; local summons: ${summonSeconds.map(clock).join(" → ")}.`,
);

const all: RunModel[] = [];
for (const starter of starterOrder) {
  const runs = profiles.map((skill) =>
    runModel({ stage, starter, difficulty, skill, lab, zones, campaign, summonSeconds }),
  );
  all.push(...runs);
  const mid = runs[profiles.indexOf(average)]!;
  console.log(
    `\n${starter} ${starters[starter].stages[0].form.name}  reach final guardian (${stageDefs[finalStage].name}) ${band(runs, (r) => pct(r.outcome.reachBoss))}  ${campaign ? "campaign" : "map"} clear ${band(runs, (r) => pct(r.outcome.clear))}  mean run ${band(runs, (r) => clock(r.outcome.meanSurvival))}`,
  );
  console.log(
    "  min  level      moves items  AoE cap  inHP/s  pressure        fill  boss/s  in/s   EHP  alive",
  );
  const lastMinute = Math.max(...runs.map((run) => run.minutes.at(-1)?.t ?? 0));
  for (let t = 60; t <= lastMinute; t += 60) {
    const rows = runs.map((run) => at(run, t));
    const m = rows[profiles.indexOf(average)];
    if (rows.every((row) => !row)) break;
    console.log(
      [
        pad(String(t / 60), 5),
        pad(rows.map((r) => fixed(r?.level)).join("/"), 10),
        pad(fixed(m?.moves, 1), 6),
        pad(fixed(m?.items, 1), 5),
        pad(fixed(m?.capacity), 8),
        pad(fixed(m?.incoming), 7),
        pad(rows.map((r) => fixed(r?.pressure, 1)).join("/"), 15),
        pad(fixed(m?.fill, 2), 5),
        pad(fixed(m?.single), 7),
        pad(fixed(m?.inDps, 1), 5),
        pad(fixed(m?.ehp), 5),
        "  " + rows.map((r) => (r ? pct(r.alive) : "—")).join("/"),
      ].join(" "),
    );
  }
  const reached = (run: RunModel, level: number) => {
    const t = run.levelAt[level];
    return t === undefined ? "—" : clock(t);
  };
  // Mean level of the samples still running at `t` (the per-minute rows).
  const levelAt = (run: RunModel, t: number) => fixed(at(run, t)?.level);
  const evolutions = starters[starter].stages.slice(1);
  console.log(
    `  pacing: ${[4, 8, 16].map((level) => `L${level} ${band(runs, (r) => reached(r, level))}`).join(" · ")} · level ${[60, 180, 300, 480].map((t) => `@${clock(t)} ${band(runs, (r) => levelAt(r, t))}`).join(" ")}`,
  );
  console.log(
    `  evolution/maturity (cumulative time, reached samples): ${evolutions.map((st) => `${st.kind === "evolve" ? st.form.name : "成熟"} L${st.at} ${band(runs, (r) => reached(r, st.at))}`).join(" · ")}`,
  );
  console.log(
    "  fields: reach/clear probabilities from starting samples (reach = alive when the guardian fight starts) · level/time at clear · guardian completed/attempted·seconds·cost in max HP (completed samples only)",
  );
  console.log(
    "  incomplete = no full-fight estimate, not an easy fight; not attempted = no exposure",
  );
  for (const [index, field] of mid.zoneClears.entries())
    console.log(
      `    ${index + 1}. ${stageDefs[field.stage].name} (${field.stage}) reach ${band(runs, (r) => pct(r.zoneClears[index]!.reach))} · clear ${band(runs, (r) => pct(r.zoneClears[index]!.clear))} · L${band(runs, (r) => fixed(r.zoneClears[index]!.level, 1))} · elapsed ${band(runs, (r) => (r.zoneClears[index]!.t === null ? "—" : clock(r.zoneClears[index]!.t!)))} · guardian ${band(runs, (r) => fightAt(r, index))}`,
    );
  console.log(
    `  wind-ups staggered: ${[180, 300, 420].map((t) => `${clock(t)} ${band(runs, (r) => (at(r, t) ? pct(at(r, t)!.cancelled) : "—"))}`).join(" · ")}`,
  );
  console.log(
    `  learned (average): ${mid.learned.map((l) => `${l.move} ${clock(l.t)}${l.share < 0.95 ? ` (${pct(l.share)})` : ""}`).join(" · ")}`,
  );
  console.log(
    `  fused (novice/average/expert): ${band(runs, (r) => `${pct(r.fused.share)}${r.fused.share > 0 ? ` @${clock(r.fused.t)}` : ""}`)}`,
  );
  const novice = runs[0]!;
  console.log(
    `  damage share (novice): ${novice.damageShare.map((d) => `${d.move} ${pct(d.share)}`).join(" · ")}`,
  );
  const end = (run: RunModel) => run.minutes.at(-1);
  console.log(
    `  partners at the end (novice/average/expert): ${band(runs, (r) => fixed(end(r)?.partners, 2))} · ${band(runs, (r) => fixed(end(r)?.partnerDps))} dmg/s`,
  );
  console.log(
    `  ultimate every ${band(runs, (r) => fixed(r.ultEvery ?? undefined))} s · kills per run swarm ${band(runs, (r) => fixed(r.kills.swarm))} · elites ${band(runs, (r) => fixed(r.kills.elites, 1))} · guardian ${band(runs, (r) => pct(r.kills.guardian))} · 星星沙子 ${band(runs, (r) => fixed(r.stardust))}`,
  );
  const worst = [...mid.beats].sort((a, b) => b.clear - a.clear).slice(0, 3);
  console.log(
    `  slowest spikes (average, local field time): ${worst.map((b) => `${b.beat}@${fields[b.zone]!.stage}:${clock(b.t)} ${b.clear.toFixed(0)} s`).join(" · ")}`,
  );
}

// Card exposure (average skill, all starters): the share of level-up offers an item could be in, was
// shown in, and the share of samples that took it.
const exposure = new Map<
  string,
  { eligible: number; offered: number; acquired: number; at: number }
>();
const mids = all.filter((run) => run.skill === average.name);
for (const run of mids)
  for (const [key, e] of run.exposure) {
    if (!key.startsWith("item:")) continue;
    const sum = exposure.get(key) ?? { eligible: 0, offered: 0, acquired: 0, at: 0 };
    sum.eligible += e.eligible / mids.length;
    sum.offered += e.offered / mids.length;
    sum.acquired += e.acquired / mids.length;
    sum.at += (e.acquired > 0 ? e.at : 0) / mids.length;
    exposure.set(key, sum);
  }
console.log(
  `\ncard exposure (average skill, level-up offers): eligible / offered / owned at the end`,
);
for (const rarity of [0, 1, 2, 3]) {
  const rows = [...exposure].filter(
    ([key]) => items[key.slice(5) as keyof typeof items].rarity === rarity,
  );
  const avg = (field: "eligible" | "offered" | "acquired") =>
    rows.reduce((sum, [, e]) => sum + e[field], 0) / Math.max(1, rows.length);
  console.log(
    `  rarity ${rarity} (${rows.length} items): ${pct(avg("eligible"))} / ${(100 * avg("offered")).toFixed(1)}% / ${pct(avg("acquired"))}`,
  );
}
const owned = [...exposure].sort((a, b) => b[1].acquired - a[1].acquired);
const cell = ([key, e]: (typeof owned)[number]) =>
  `${key.slice(5)} ${pct(e.eligible)}/${(100 * e.offered).toFixed(1)}%/${pct(e.acquired)}`;
console.log(`  most owned: ${owned.slice(0, 8).map(cell).join(" · ")}`);
console.log(`  least owned: ${owned.slice(-8).map(cell).join(" · ")}`);

console.log(
  `\nbuild scenarios (average skill, ${scope}): clear · final guardian completed/attempted·seconds·cost in max HP (completed only) · level at 5:00`,
);
for (const starter of starterOrder) {
  const cells = scenarios.map(({ name, picks }) => {
    const run = runModel({
      stage,
      starter,
      difficulty,
      skill: average,
      picks,
      lab,
      zones,
      campaign,
      summonSeconds,
    });
    return `${name} ${pct(run.outcome.clear)} · ${fightAt(run, run.fights.length - 1)} · L${fixed(at(run, 300)?.level)}`;
  });
  console.log(`  ${starter.padEnd(10)} ${cells.join("   ")}`);
}

const budgets = moveBudgets(stage, difficulty, average);
console.log(
  `\nmove budgets (${stageDefs[stage].name}, ${stage}): each move alone, ${REFERENCE_UPGRADES} expected upgrades, level ${REFERENCE_LEVEL}, ${clock(REFERENCE_TIME)} crowd, type-neutral`,
);
console.log(
  "  move           archetype  targets  AoE/s   ×median  base ×median  boss/s  ×median  control",
);
for (const b of budgets) {
  console.log(
    [
      "  " + b.move.padEnd(14),
      moves[b.move].archetype.padEnd(9),
      pad(b.targets.toFixed(1), 8),
      pad(b.aoe.toFixed(0), 6),
      pad(b.aoeRel.toFixed(2), 8),
      pad(b.baseRel.toFixed(2), 13),
      pad(b.single.toFixed(0), 7),
      pad(b.singleRel.toFixed(2), 8),
      pad(b.control.toFixed(1), 8),
    ].join(" "),
  );
}
const kits = starterKits(stage, difficulty, average);
console.log(
  `  full kits with type matchups: ${kits.map((k) => `${k.starter} AoE ${k.aoe.toFixed(0)} · boss ${k.single.toFixed(0)}`).join("   ")}`,
);

console.log(
  `\nfusion budgets: ★1 fusion over its two max-level parts (${clock(FUSION_TIME)} crowd, type-neutral)`,
);
for (const f of fusionBudgets(stage, difficulty, average))
  console.log(
    `  ${f.starter.padEnd(10)} ${f.move.padEnd(13)} AoE ${f.aoe.toFixed(0).padStart(5)} (${f.aoeRel.toFixed(2)}× parts)  boss ${f.single.toFixed(0).padStart(4)} (${f.singleRel.toFixed(2)}× parts)  vs 2 median maxed: AoE ${f.aoeMid.toFixed(2)}× boss ${f.singleMid.toFixed(2)}×  ★5/★1 ${f.aoeGrowth.toFixed(2)}×/${f.singleGrowth.toFixed(2)}×`,
  );

const values = itemValues(stage, difficulty, average);
console.log(
  `\nitem marginal value (build value gain of the first level, full kit, level ${REFERENCE_LEVEL})`,
);
console.log(`  item           ${starterOrder.map((s) => s.padStart(10)).join("")}   ×median`);
for (const v of values) {
  console.log(
    `  ${v.item.padEnd(14)} ${starterOrder.map((s) => pad(v.value[s].toFixed(3), 10)).join("")}   ${pad(v.rel.toFixed(2), 7)}`,
  );
}

// Targets (docs/BALANCE.md「目标」): hints to read the results against, never gates.
const fusions = fusionBudgets(stage, difficulty, average);
const mark = (ok: boolean) => (ok ? "ok" : "OUT");
const range = (r: Range, f = pct) => `${f(r.min)}–${f(r.max)}`;
const of = (skill: string) => all.filter((run) => run.skill === skill);
console.log(
  `\ntargets (${campaign ? "legacy single-map reference ranges; campaign comparisons are uncalibrated; " : ""}hints, not gates)`,
);
const clearTarget = TARGETS.averageClear[difficulty];
console.log(
  `  average clear ${range(clearTarget)}: ${of(average.name)
    .map(
      (r) => `${r.starter} ${pct(r.outcome.clear)} ${mark(inRange(r.outcome.clear, clearTarget))}`,
    )
    .join(" · ")}`,
);
console.log(
  `  expert clear ≥ ${pct(TARGETS.expertClear.min)}: ${of(expert.name)
    .map(
      (r) =>
        `${r.starter} ${pct(r.outcome.clear)} ${mark(inRange(r.outcome.clear, TARGETS.expertClear))}`,
    )
    .join(" · ")}`,
);
if (difficulty === 0)
  console.log(
    `  novice clear ${range(TARGETS.noviceClear)} is the bot's to measure (bun run balance); model: ${of(
      "novice",
    )
      .map((r) => `${r.starter} ${pct(r.outcome.clear)}`)
      .join(" · ")}`,
  );
for (const run of of(average.name)) {
  const levels = Object.entries(TARGETS.levelAt).map(([level, want]) => {
    const got = run.levelAt[Number(level)];
    const ok = got !== undefined && Math.abs(got - want) <= TARGETS.levelSlack;
    return `L${level} ${got === undefined ? "—" : clock(got)} (≈${clock(want)}) ${mark(ok)}`;
  });
  const at8 = run.levelAt.reduce((last, at, level) => (level >= 1 && at <= 480 ? level : last), 1);
  const ttk = run.bossTtk ?? Infinity;
  const ult = run.ultEvery;
  console.log(
    `  ${run.starter.padEnd(10)} ${levels.join(" · ")} · level at 8:00 ${at8} ${mark(inRange(at8, TARGETS.levelAt8))} · last observed guardian arrival TTK ${fixed(run.bossTtk ?? undefined)} s ${mark(ttk <= TARGETS.bossTtk.max)} · ult every ${fixed(ult ?? undefined)} s ${mark(ult !== null && inRange(ult, TARGETS.ultEvery))}`,
  );
}
console.log(
  `  fusion vs 2 median maxed moves, swarm ${range(TARGETS.fusionSwarm, (v) => `${v}×`)} / guardian ${range(TARGETS.fusionGuardian, (v) => `${v}×`)}: ${fusions.map((f) => `${f.starter} ${f.aoeMid.toFixed(2)}× ${mark(inRange(f.aoeMid, TARGETS.fusionSwarm))} / ${f.singleMid.toFixed(2)}× ${mark(inRange(f.singleMid, TARGETS.fusionGuardian))}`).join(" · ")}`,
);
for (const skill of profiles) {
  const clears = of(skill.name).map((r) => r.outcome.clear);
  const spread = Math.max(...clears) - Math.min(...clears);
  console.log(
    `  starter spread (${skill.name}) ≤ ${Math.round(TARGETS.starterSpread * 100)} pp: ${Math.round(spread * 100)} pp ${mark(spread <= TARGETS.starterSpread)}`,
  );
}

const found = warnings(all, budgets, values);
console.log(
  `\nwarnings (advisory${campaign ? "; single-map heuristics, not campaign calibration" : ""}) — ${found.length}`,
);
for (const line of found) console.log(`  · ${line}`);
console.log(
  `\nScope: runs and build scenarios = ${scope}; move/fusion/item budgets = ${stageDefs[stage].name} (${stage}) reference points.`,
);
console.log(
  "Analytical estimates, not measured playthroughs; completed-only guardian costs have survivor bias, and incomplete fights cannot establish ease.",
);
console.log(`${(performance.now() - started).toFixed(0)} ms`);
