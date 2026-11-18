# Proposal

## Why

大版本「野外与路线」第 9 项，总表见 [野外与路线规划](../archive/2026-11-18-add-field-events/design.md)。用户确认加入超级进化分支，先做喷火龙 X / Y。

现在最终形态之后，构筑上没有新的分岔：喷火龙到 55 级后，形态和特性就固定了。超级进化是宝可梦玩家最熟悉的"同一只宝可梦走两条路"，喷火龙 X（火 / 龙，物理）和喷火龙 Y（火 / 飞行，特殊，日照）正好是两种打法。

## What Changes

- **新增数据**：
  - 线定义新增 `megas`，玩家新增 `mega` 字段。
  - 喷火龙进化石Ｘ / 喷火龙进化石Ｙ 两件道具。
  - 超级喷火龙Ｘ / Ｙ 两个形态，带正作特性硬爪和日照。
  - 新招式闪焰冲锋。
- **超级进化是本局永久的形态分支，不是限时状态**：选定一块进化石后，喷火龙在本局剩下的地图中保持超级形态。理由见 design.md。
- **获得方式**：从路线第 2 张图起，守卫奖杯（`add-route-branches`）给符合条件的玩家提供两块进化石，二选一。
- **后续内容**（各自单独立项）：本作已有的、正作有超级进化的最终形态：
  - 妙蛙花
  - 水箭龟
  - 耿鬼
  - 胡地
- 世界快照版本提升，golden 有意重录。

## Capabilities

### Modified Capabilities

- `combat-builds`：超级进化的获得、触发与形态规则。
- `balance-tuning`：解析模型覆盖超级进化分支。

## Impact

- **模拟**：`content/lines/index.ts`、`content/lines/charmander.ts`、`evolution.ts`、`stats.ts`、`content/items.ts`、`content/abilities.ts`、`content/moves.ts`、`upgrades.ts`、`state/entities.ts`、`state/events.ts`、`snapshot.ts`。
- **画面**：
  - `view/assets.ts`（`formModels`、`facingYaw`）。
  - 超级进化演出与 VFX（`view/vfx/`）。
  - 图鉴登记。
- **工具**：`src/run/balance/model.ts`。
- **测试**：`evolution`、`stats`、`coop`、`snapshot`、`model`、`view`。
- **资产**：
  - 2 个 Tripo 模型，约 80 积分。
  - 超级进化与闪焰冲锋的 ElevenLabs 音效。
- **依赖**：
  - `add-route-branches`：守卫奖杯。
  - `deepen-builds`：玩家特性字段、不变之石。
  - `add-field-events`：大晴天天气，供日照使用。
- 没有存档迁移。
