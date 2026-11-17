# Proposal

## Why

用户 2026-11-17 要求把"对战塔无尽"放进大版本「野外与路线」。现在通关一次远征后，只能换伙伴或提高难度重打同一条路线，没有"能打多远"的目标。路线图曾把无尽列为后期内容，并要求重启前先确认确定性研究里的数值边界。

## What Changes

- 新增对战塔模式（`RunConfig.mode: "tower"`）：从第 1 层开始逐层推进，每层是一张短场地，每 7 层是强化守卫层。
- 敌人强度按楼层折算成路线位置；超出四步远征路线后按最后一段斜率线性外推，不设上限。
- 不设塔顶（用户 2026-11-17 确认），打到倒下为止。周期运动的时间输入超出安全范围时折回一个周期，保持确定性数学函数的定义域；正常远征的数值不受影响。
- 测试与平衡模型只模拟到第 50 层，更高的层不模拟。
- 支持 2–4 人联机，楼层推进与守卫由房主结算。
- 局外进度 v5 的 `tower` 字段记录每只伙伴的最高层与难度（字段由 `extend-progress-v5` 定义）。
- 大厅新增对战塔入口，通关任一难度后解锁；对局 HUD 显示当前层数。

## Capabilities

### Modified Capabilities

- `world-progression`：对战塔楼层、守卫层与强度外推。
- `progress-save`：对战塔最高层记录。
- `gpu-presentation`：大厅对战塔入口与楼层显示。

## Impact

- 依赖：`extend-progress-v5`（`tower` 字段）、`add-route-branches`（路线位置强度函数）、`guide-field-exit`（守卫倒下处开出口）。
- 代码：`sim/world.ts`（`RunConfig.mode`）、`sim/zones.ts`（楼层切换）、`content/params/tower.ts`、`director.ts`（强度）、`run/session.ts` 与 `ui/gpu/lobby.ts`（入口与结算）、`scripts/golden.mjs`（新增对战塔用例）。
