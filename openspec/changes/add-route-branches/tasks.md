# Tasks

## 1. 模型

- [x] 1.1 用户确认每局 4 张图（2026-11-17）。
- [ ] 1.2 `src/run/balance/model.ts` 与 `scripts/balance-model.ts`：按 `routeFields(route)` 推进，`campaign` 模式跑全部 4 条路线组合；报告每条路线逐图到达与完成率、进化等级、守卫耗时。标记与词条只建模精英率倍数，其余明确标为未建模。
- [ ] 1.3 用模型定 `ROUTE_GROWTH` / `ROUTE_ENTRY_CLOCK`（承接 `tune-map-entry-pace` 的入图时钟）与 `xp` 曲线，记录改前改后对照；更新 `docs/BALANCE.md`。

## 2. 模拟

- [ ] 2.1 `content/campaign.ts`：`ROUTE_TIERS`、`STAGE_INDEX`、`routeStep`、`routeFields`；删除 `STAGE_ROUTE` 与 `CAMPAIGN_FIELDS`，更新全部引用（`zones.ts`、`enemy-aim.ts`、`enemy-dodge.ts`、`ui/gpu/*`、测试）。
- [ ] 2.2 `params/campaign.ts` / `params/zones.ts`：成长与生命时钟改按路线位置；后区守卫强化分组改按路线位置。
- [ ] 2.3 `state/world.ts`：`world.route`、`zone.exits`、`zone.leaving`、`world.marker`、`world.modifier`；`snapshot.ts` 提升版本。
- [ ] 2.4 `currentZone.ts`：多出口生成与试位、`atExit` 返回序号；`zones.ts`：`interactInZone` / `nextField` / `prepareZone` / `enterZone` 读所选出口；`zoneSeed` 用 `STAGE_INDEX`。
- [ ] 2.5 `content/route.ts`：奖励标记与地图词条表；入图时应用标记，耿鬼祭坛交互点与交易结算。
- [ ] 2.6 拾取物 `trophy`、奖杯候选池与三选一；退出时飞行中的奖杯按出口结算规则处理。
- [ ] 2.7 词条：照亮半径数据、闪光与清除浓雾拾取物、头目出没倍率。

## 3. 画面与界面

- [ ] 3.1 `view/exitPortal.ts` 多实例、按目标地图着色、柱顶标记图标与地图名；小地图、大地图、罗盘按出口更新。
- [ ] 3.2 黑暗洞穴压暗与照亮开孔、浓雾场景雾；入图横幅显示词条。
- [ ] 3.3 `ui/gpu/lobby.ts` 分层路线图；`ui/gpu/run-hud.ts` 路线位置 `x/4` 与最近出口目标。

## 4. 资产

- [ ] 4.1 耿鬼祭坛模型：Tripo 低多边形多视图流程，`--dry-run` 先行，记录来源，侧视图确认朝向。
- [ ] 4.2 ElevenLabs：出口选定、耿鬼交易、奖杯拾取三个音效；写入 manifest，`bun run audio:master` 母带与 QC，按 `timing.json` 对齐，遵守舒适音量规则。

## 5. 测试与验证

- [ ] 5.1 `campaign.test.mjs`：每条路线组合的去向、只有塔出口结束整局、路线位置与成长读取。
- [ ] 5.2 `zones.test.mjs` / `late-zones.test.mjs`：五张室外图 × 多个种子，每张目标地图至少一个出口、出口互不重叠、全部双向可达；地标在清区后不作为出口。
- [ ] 5.3 `coop.test.mjs` / `snapshot.test.mjs`：出口选择由房主结算、快照恢复路线与标记、个人奖杯与交易不串号。
- [ ] 5.4 `bun run test:sim`；`bun run golden --write` 有意重录并复跑一次确认稳定。
- [ ] 5.5 浏览器 1280×800 与 844×390：大厅路线图、多出口与标签、黑暗洞穴可读性、浓雾下出口仍可见；两人联机走完一局。
- [ ] 5.6 `bun run check`；独立 Agent 审阅。

## 6. 规范同步

- [ ] 6.1 归档前确认 `guide-field-exit` 与 `tune-map-entry-pace` 已归档（「守卫与出口结算」「后续区域承接敌人耐久」「连续路线的数值模型」以它们的文本为基础；`tune-map-entry-pace` 归档后该 simulation 要求已改名为「后续区域承接怪群强度与节奏」，同步把本 change 的增量标题和场景名对齐后再校验）；同步 `world-progression`、`simulation`、`balance-tuning`、`gpu-presentation` 主规范；更新 `src/run/sim/content/README.md`（路线与标记表登记）与 `docs/STATE-MACHINES.md`（多出口离开流程）。
