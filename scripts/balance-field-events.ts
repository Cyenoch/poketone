// bun scripts/balance-field-events.ts [difficulty=0] [samples=8] [--json]
// Paired continuous six-field runs. Rewards are consumed at the actual sample step, not added here.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runModel, type RunModel } from "../src/run/balance/model.ts";
import { FIELD_MODEL_ASSUMPTIONS, FIELD_MODEL_LIMITS } from "../src/run/balance/field-events.ts";
import { average, profiles } from "../src/run/balance/skill.ts";
import { ultimateTiming } from "../src/run/balance/ultimate.ts";
import { difficulties, type Difficulty } from "../src/run/sim/content/difficulties.ts";
import { starterOrder, starters, type StarterId } from "../src/run/sim/content/lines/index.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { FIELD_EVENTS, SHINY, WEATHER } from "../src/run/sim/content/params/field-events.ts";
import { SITE } from "../src/run/sim/content/params/sites.ts";

const difficulty = Number(process.argv[2] ?? 0) as Difficulty;
const samples = Number(process.argv[3] ?? 8);
if (!difficulties[difficulty]) throw new Error("difficulty 必须为 0/1/2");
if (!Number.isInteger(samples) || samples < 1) throw new Error("samples 必须为正整数");
const roster = (process.env.BALANCE_STARTERS ?? "charmander,bulbasaur,geodude").split(
  ",",
) as StarterId[];
if (roster.some((id) => !starterOrder.includes(id)))
  throw new Error(`未知 BALANCE_STARTERS ${roster.join(",")}`);
const skill = profiles.find(
  (profile) => profile.name === (process.env.BALANCE_PROFILE ?? average.name),
);
if (!skill) throw new Error(`未知 BALANCE_PROFILE ${process.env.BALANCE_PROFILE}`);
const summarize = (run: RunModel) => ({
  outcome: run.outcome,
  zoneClears: run.zoneClears,
  fights: run.fights,
  levelAt: run.levelAt,
  minutes: run.minutes,
  stardust: run.stardust,
  kills: run.kills,
  fieldEvents: run.fieldEvents,
  ultimate: run.ultimate,
  ultEvery: run.ultEvery,
});
function sourceDigest(): string {
  const paths = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "src/run/sim",
      "src/run/balance",
      "scripts/balance-field-events.ts",
      "scripts/balance-model.ts",
    ],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const path of new Set(paths)) hash.update(path).update("\0").update(readFileSync(path));
  return hash.digest("hex");
}
const sourceBefore = sourceDigest();
const report = roster.map((starter) => {
  const options = { stage: "forest" as const, starter, difficulty, skill, samples, campaign: true };
  const before = runModel({ ...options, fieldEvents: false });
  const after = runModel(options);
  // Historical contract, used only for this comparison: immediate release and one second protection.
  const oldUltimate = runModel({ ...options, ultimateTiming: { windup: 0, protection: 1 } });
  const delayedUltimate = runModel({
    ...options,
    ultimateTiming: { windup: ultimateTiming().windup, protection: 1 },
  });
  for (const run of [before, after, oldUltimate, delayedUltimate]) {
    for (const field of run.fieldEvents) {
      assert(
        Object.values(field.income).every(Number.isFinite),
        `${starter}/${field.stage}: 非有限事件统计`,
      );
      for (const schedule of field.schedules)
        assert(
          schedule.every((entry, index) => index === 0 || entry.at >= schedule[index - 1]!.at),
          "排程必须有序",
        );
    }
    assert(run.ultimate.releases <= run.ultimate.casts, "释放不能多于成功触发");
    assert(
      Math.abs(
        run.fieldEvents.reduce((sum, field) => sum + field.earned.stardust, 0) - run.stardust,
      ) < 1e-8,
      "逐图星沙与实际总账守恒，不能追加毛收益",
    );
  }
  const delta = after.fieldEvents.map((field, index) => ({
    stage: field.stage,
    xp: field.earned.xp - before.fieldEvents[index]!.earned.xp,
    cards: field.earned.cards - before.fieldEvents[index]!.earned.cards,
    stardust: field.earned.stardust - before.fieldEvents[index]!.earned.stardust,
  }));
  return {
    starter,
    before: summarize(before),
    after: summarize(after),
    delta,
    oldUltimate: summarize(oldUltimate),
    delayedUltimate: summarize(delayedUltimate),
  };
});
const sourceAfter = sourceDigest();
const metadata = {
  date: new Date().toISOString(),
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceDigest: sourceBefore,
  sourceAfter,
  sourceChangedDuringRun: sourceBefore !== sourceAfter,
  difficulty,
  samples,
  profile: skill.name,
  timing: ultimateTiming(),
  formal: { FIELD_EVENTS, SHINY, WEATHER, SITE },
  assumptions: FIELD_MODEL_ASSUMPTIONS,
  limits: FIELD_MODEL_LIMITS,
  comparison:
    "同种子连续六图：仅关闭额外野外机制；主线节拍仍按正式窗口抽取。另用历史0秒准备/1秒保护对照当前终极技。",
};
if (process.argv.includes("--json")) console.log(JSON.stringify({ metadata, report }, null, 2));
else {
  console.log(
    `正式连续事件模型 · ${difficulties[difficulty].name} · ${skill.name} · ${samples} samples · ${metadata.sourceDigest}`,
  );
  console.log(metadata.comparison);
  for (const { starter, before, after, delta, oldUltimate, delayedUltimate } of report) {
    console.log(
      `\n${starters[starter].stages[0].form.name}：清关 ${(before.outcome.clear * 100).toFixed(1)}% → ${(after.outcome.clear * 100).toFixed(1)}%；星沙 ${before.stardust.toFixed(1)} → ${after.stardust.toFixed(1)}；均存活 ${before.outcome.meanSurvival.toFixed(1)} → ${after.outcome.meanSurvival.toFixed(1)}秒`,
    );
    for (const field of after.fieldEvents) {
      const r = field.income,
        c = field.conditional;
      const difference = delta.find((row) => row.stage === field.stage)!;
      console.log(
        `  ${stageDefs[field.stage].name}：入图${field.entered}/${samples}、完成${field.completed}/${field.entered}；入图质量${field.entryWeight.toFixed(3)}；事件XP ${r.xp.toFixed(1)} / 箱 ${r.cards.toFixed(2)} / 星沙 ${r.stardust.toFixed(1)}`,
      );
      console.log(
        `    条件于入图 ${c ? `${c.xp.toFixed(1)} XP / ${c.cards.toFixed(2)} 箱 / ${c.stardust.toFixed(1)} 星沙` : "未到达"}；占用 ${r.occupiedSeconds.toFixed(1)}秒、普通XP机会成本 ${r.opportunityXp.toFixed(1)}；未完成 ${r.unfinished.toFixed(2)}；天气毛伤 ${r.weatherHpCost.toFixed(1)} HP`,
      );
      console.log(
        `    同种子总收益差（已含成长/存活/分流反馈）：XP ${difference.xp.toFixed(1)} / 箱 ${difference.cards.toFixed(2)} / 星沙 ${difference.stardust.toFixed(1)}`,
      );
    }
    const old = oldUltimate.ultimate,
      current = after.ultimate;
    console.log(
      `  终极技历史→当前：首释放 ${old.firstRelease?.toFixed(1) ?? "未释放"} → ${current.firstRelease?.toFixed(1) ?? "未释放"}秒；保护 ${old.protectedSeconds.toFixed(1)} → ${current.protectedSeconds.toFixed(1)}秒；免除伤害 ${old.preventedDamage.toFixed(1)} → ${current.preventedDamage.toFixed(1)} HP；清关 ${(oldUltimate.outcome.clear * 100).toFixed(1)}% → ${(after.outcome.clear * 100).toFixed(1)}%`,
    );
    console.log(
      `    分离准备影响（同为1秒保护）：平均存活 ${oldUltimate.outcome.meanSurvival.toFixed(1)} → ${delayedUltimate.outcome.meanSurvival.toFixed(1)}秒；分离保护影响（同为共享准备时间）：${delayedUltimate.outcome.meanSurvival.toFixed(1)} → ${after.outcome.meanSurvival.toFixed(1)}秒。`,
    );
  }
  for (const limit of FIELD_MODEL_LIMITS) console.log(`局限：${limit}`);
}
