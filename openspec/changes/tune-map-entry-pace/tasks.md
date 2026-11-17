# Tasks

## 1. 模型

- [ ] 1.1 `balance/model.ts` / `balance/coop.ts`：读新的入图时钟；`campaign` 报告每张后续地图入图后 0–120 秒与前一张图最后 120 秒的压力指数对照。
- [ ] 1.2 用模型定 `CAMPAIGN_ENTRY_CLOCK` 与 `ENTRY_RAMP_SECONDS`，三个难度都核对；改前改后对照写入 `docs/BALANCE.md`。

## 2. 模拟

- [ ] 2.1 `params/campaign.ts`：`CAMPAIGN_HP_CLOCK` 改名为 `CAMPAIGN_ENTRY_CLOCK`；`params/zones.ts`：`zoneClock` 读入图时钟与新升温时长，删除 `zoneHealthClock` 并更新 `director.ts`、`partners.ts`、`dev/readout.ts` 的调用。
- [ ] 2.2 `campaign.test.mjs` / `late-zones.test.mjs`：后续地图入图升温后刷新速率、在场上限、伤害按入图时钟；时间轴事件与守卫强度不变。
- [ ] 2.3 `bun run test:sim`；`bun run golden --write` 有意重录，复跑一次确认稳定。

## 3. 验证

- [ ] 3.1 浏览器实际打到第二张图，确认入图后一分钟内的怪量与攻势接近前一张图后段。
- [ ] 3.2 独立 Agent 审阅；同步 `simulation`、`balance-tuning` 主规范。
