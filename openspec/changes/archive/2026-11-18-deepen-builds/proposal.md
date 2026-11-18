# Proposal

## Why

这是大版本「野外与路线」第 3 期，总表见 [野外与路线规划](../archive/2026-11-18-add-field-events/design.md)。现在的构筑容易收敛，原因有三：

- 进化只看等级，`evolution.ts` 的 `stageFor` 到点就换形，玩家不用做任何决定。
- 每条线只有一个特性（`LineDef.ability`），而且光合作用、激流之壳、幽影、龙鳞这几个名字不是正作特性。
- 融合只限本线的招牌配方。

用户要求加深构筑，并且必须契合宝可梦设定，宝可梦玩家一看就懂。

## What Changes

- **进化条件与不进化选择**：
  - 皮卡丘要持有雷之石才进化成雷丘；新增电气球，只对皮卡丘有效。
  - 豪力、鬼斯通、勇基拉、隆隆石靠通信交换进化：合作中由两名玩家交换，单人用联系绳。
  - 新增不变之石，持有时不进化，与已有的进化奇石形成"要不要进化"的选择。
- **正作特性与隐藏特性**：
  - 每条线改用正作特性。有两个普通特性的线，在第一次进化时二选一。
  - 隐藏特性由特性膏药获得。
- **天气构筑**：
  - 新增招式大晴天、求雨、沙暴。
  - 新增炽热岩石、潮湿岩石，沙沙岩石加上延长沙暴的效果。
  - 叶绿素、太阳之力、雨盘、沙隐与天气联动。
  - 天气效果沿用 `add-field-events` 的天气规则。
- **誓约组合招式**：新增草之誓约、火之誓约、水之誓约，两种誓约在同一处相遇时生成火海、彩虹或湿地。
- 世界快照版本提升，golden 有意重录。

## Capabilities

### Modified Capabilities

- `combat-builds`：进化条件、不进化选择、特性选择、天气招式与誓约组合。
- `balance-tuning`：解析模型覆盖进化分支、特性和天气占用率。

## Impact

- **模拟**：
  - `content/lines/*.ts`、`content/lines/index.ts`、`evolution.ts`、`stats.ts`、`content/abilities.ts`、`content/items.ts`、`content/moves.ts`、`upgrades.ts`、`zones.ts`（交换交互）、`state/entities.ts`、`snapshot.ts`。
  - 新增 `content/pledges.ts` 和天气招式原型 `archetypes/weather.ts`。
- **画面**：天气招式与誓约的 VFX（`view/vfx/`）；特性选择复用选择对话。
- **工具**：`src/run/balance/model.ts`。
- **测试**：`evolution`、`stats`、`items`、`triggered-items`、`archetypes`、`combat`、`coop`、`snapshot`、`model`。
- **资产**：雷丘已有模型，不需要新模型。新增天气招式 3 个、誓约 3 个、组合场 3 个、交换进化 1 个音效（ElevenLabs）。
- **依赖**：
  - `add-field-events`：天气状态与规则。
  - `add-route-branches`：守卫奖杯候选池。
  - `add-psychic-rock-starters`：勇基拉、隆隆石两条线。
- 没有存档迁移。
