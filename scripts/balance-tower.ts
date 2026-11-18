// bun run balance:tower [model.ts] [samples=8] [seed=0x5eed] [--json]
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { average } from "../src/run/balance/skill.ts";
import { TARGETS } from "../src/run/balance/targets.ts";
import { TOWER_TRIAL, type TowerRunner } from "../src/run/balance/tower.ts";
import { difficulties } from "../src/run/sim/content/difficulties.ts";
import { starters } from "../src/run/sim/content/lines/index.ts";
import { TOWER } from "../src/run/sim/content/params/tower.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";

const args = process.argv.slice(2);
const positional = args.filter((arg) => arg !== "--json");
const model = positional[0]?.endsWith(".ts")
  ? resolve(positional.shift()!)
  : fileURLToPath(new URL("../src/run/balance/model.ts", import.meta.url));
const [count = "8", seedArg = "0x5eed", ...extra] = positional;
if (extra.length)
  throw new Error("用法：bun run balance:tower [model.ts] [样本数] [种子] [--json]");
const samples = Number(count);
const seed = Number(seedArg);
if (!Number.isSafeInteger(samples) || samples < 1) throw new Error(`样本数须为正整数：${count}`);
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
  throw new Error(`种子须为无符号 32 位整数：${seedArg}`);

const { runTowerModel } = (await import(pathToFileURL(model).href)) as {
  runTowerModel?: TowerRunner;
};
if (typeof runTowerModel !== "function") throw new Error(`${model} 未导出 runTowerModel`);

const limits = [
  "单人 average，无研究与背包。每个种子共用一条地图序列，构筑种子按已有模型抽样。",
  "使用同一解析战斗模型的 1 秒步长、平均怪群和命中画像；未测真实地形、走位、站点交互或联机。",
  `守卫 ${TOWER.guardianBonus}× 按生命及伤害应用，速度沿用地图基准，强化攻势按向下取整的路线位置选档。`,
  "普通层压缩节拍和事件窗口，保留怪物名单的原始秒数和难度的固定提前量；守卫层窗口沿用原模板。",
  "计时结束或守卫倒下即估作离开；守卫回复与奖励计入成长，省略走到出口、清场拾取和载入时间。",
  "守卫长战沿用地图时长加分析加时作为截尾上限；截尾只记录未决概率，不算通过或倒下。50 是分析范围。",
  "供需以常规供给的 HP/s 为分母，不含节拍额外敌群。落地承伤以最大生命归一，未减后续治疗。",
];
const runs = ([0, 1] as const).flatMap((difficulty) =>
  (["charmander", "bulbasaur"] as const).map((starter) => {
    const slope = TOWER.slope;
    const floors = runTowerModel({ starter, difficulty, skill: average, samples, seed, slope });
    if (floors.length !== TOWER_TRIAL.floors)
      throw new Error(`预期 50 层，收到 ${floors.length} 层`);
    for (const [index, { window, fight, ...floor }] of floors.entries()) {
      const metrics = Object.values({ ...floor, ...window, ...fight });
      if (metrics.some((value) => typeof value === "number" && !Number.isFinite(value)))
        throw new Error(`${difficulty}/${starter} 第 ${index + 1} 层出现非有限指标`);
    }
    return { difficulty, starter, slope, floors };
  }),
);

if (args.includes("--json"))
  console.log(JSON.stringify({ model, samples, seed, trial: TOWER_TRIAL, limits, runs }, null, 2));
else {
  const fixed = (value: number | null | undefined, digits = 2) => value?.toFixed(digits) ?? "—";
  const percent = (value: number) => `${(100 * value).toFixed(2)}%`;
  console.log(`对战塔 ${TOWER_TRIAL.floors} 层预演 · 种子 ${seed} · 每组 ${samples} 个构筑样本`);
  console.log(`守卫耗时使用现有 ${TARGETS.bossTtk.max}s 分析参考。`);
  for (const { difficulty, starter, slope, floors } of runs) {
    console.log(
      `\n${difficulties[difficulty].name} ${starters[starter].stages[0].form.name} · 末段斜率 ${slope.hp}×`,
    );
    console.log(
      "层\t地图\t到达\t通过\t截尾\t累计秒\t本层通过秒\t等级\t供/需 HP/s\t压力指数\t承伤 %HP/秒\t本层承伤 %HP\t守卫秒\t守卫完成/尝试",
    );
    for (const [index, row] of floors.entries()) {
      if (index !== 0 && index !== floors.length - 1 && !row.guardian) continue;
      const w = row.window;
      console.log(
        [
          index + 1,
          stageDefs[row.stage].name,
          percent(row.reach),
          percent(row.clear),
          percent(row.censored),
          fixed(row.clearAt, 1),
          fixed(row.clearSeconds, 1),
          fixed(row.level, 1),
          w ? `${fixed(w.capacity, 1)}/${fixed(w.incoming, 1)}` : "—",
          fixed(w?.pressure),
          w ? fixed(w.landed * 100) : "—",
          w ? fixed(w.lost * 100) : "—",
          fixed(row.fight?.seconds, 1),
          row.fight ? `${row.fight.completed}/${row.fight.attempted}` : "—",
        ].join("\t"),
      );
    }
  }
  console.log(`\n${limits.join("\n")}`);
}
