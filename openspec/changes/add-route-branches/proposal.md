# Proposal

## Why

大版本「野外与路线」第 2 期（总表见 `add-field-events/design.md`）。现在每局都按 `STAGE_ROUTE` 固定走六张图，守卫倒下后只有一个出口（`guide-field-exit`），地图之间没有任何选择，几局后路线就能背下来。用户确认参考以撒的结合和杀戮尖塔加入分岔选路，要求内容用宝可梦玩家看得懂的东西表达。

## What Changes

- **路线分层**：森林 → {沙漠 | 海岸} → {冰川 | 火山} → 紫苑塔，每局走 4 张图。`STAGE_ROUTE` 改为分层表 `ROUTE_TIERS`，新增世界字段 `world.route`（已进入的地图）。
- **强度按路线位置**：`CAMPAIGN_GROWTH` / `CAMPAIGN_ENTRY_CLOCK`（`tune-map-entry-pace`）从按地图改为按路线位置（第 0–3 步）读取。地图只决定敌人名单、地形和守卫种类。先改解析模型，再定数值。
- **多出口**：`zone.exit` 扩展为 `zone.exits`，守卫倒下处开出 2 个出口（偶尔 3 个），每个出口标明目标地图和奖励标记。
- **奖励标记**：宝箱、精英巢、宝可梦中心、研究资料、耿鬼的交易（付出最大生命换一件传说道具）。
- **守卫奖杯**：守卫给每名玩家掉一个奖杯，拾取后三选一。
- **地图词条**：黑暗洞穴（闪光照亮）、浓雾（清除浓雾恢复小地图）、头目出没（精英更多）。
- 世界快照版本提升；golden 有意重录。

## Capabilities

### Modified Capabilities

- `world-progression`：分层路线、多出口、奖励标记、守卫奖杯、地图词条、路线时长上限、后区守卫强化按路线位置。
- `simulation`：后续地图的生命成长下限改按路线位置。
- `balance-tuning`：解析模型按分层路线推进，并报告每条路线组合。
- `gpu-presentation`：大厅展示分层路线；HUD 显示路线位置；出口显示目标地图与标记。

## Impact

- **模拟**：`content/campaign.ts`、`content/params/campaign.ts`、`content/params/zones.ts`、`zones.ts`、`currentZone.ts`、`enemy-aim.ts`、`enemy-dodge.ts`、`state/world.ts`、`snapshot.ts`，新增 `content/route.ts`。
- **画面**：`view/exitPortal.ts`、`view/minimapLayers.ts`、`view/compassBar.ts`、`ui/gpu/lobby.ts`、`ui/gpu/run-hud.ts`。
- **工具**：`src/run/balance/model.ts`、`scripts/balance-model.ts`、`scripts/golden.mjs`。
- **测试**：`campaign`、`zones`、`late-zones`、`coop`、`snapshot`、`model`。
- **资产**：耿鬼祭坛模型（Tripo）；出口选择、交易、奖杯三个音效（ElevenLabs）。
- 依赖 `guide-field-exit`（单出口）和 `add-field-events`（交互点设施）。没有存档迁移，局外字段不变。
