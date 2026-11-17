# Proposal

## Why

大版本「野外与路线」第 4 期（用户 2026-11-17 确认）。通关普通、困难、噩梦之后，玩家缺少继续挑战的目标，局外奖励也不随挑战难度变化。参考哈迪斯的热度：出发前自选限制，换取更多奖励和长期收集目标。规则采用宝可梦玩家熟悉的玩法（Nuzlocke、对战设施禁带道具、单属性等），不另造概念。

## What Changes

- 新增 6 条挑战规则（`RuleId`），每条有危险度：Nuzlocke、等级上限、禁止携带道具、单属性、头目化、异常天气。
- 出发前选规则。总危险度提高本局带出的星星沙子倍率。
- 新增 8 枚道馆徽章（`BadgeId`）。通关时按「难度 + 危险度」得分达到门槛即获得，写入进度 v5 的 `badges`，在研究所徽章盒展示（`redesign-lab`）。
- 规则写入 `RunConfig.rules` 和世界状态，世界快照版本加一。种子码挑战（`add-seed-challenges`）复用这份配置。
- 合作：房主选规则，房间内和局内向所有队员展示；倍率和徽章按个人收益规则发给每名队员。
- 首次普通难度通关后开放规则选择；研究所解锁表可以把个别规则设为需要解锁（`redesign-lab`）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `world-progression`：新增「挑战规则」。
- `progress-save`：新增「危险度奖励与道馆徽章」。
- `multiplayer`：新增「房主选择挑战规则」。
- `gpu-presentation`：新增「挑战规则选择与展示」。

## Impact

- 依赖：`extend-progress-v5`（`badges`、`rules` 字段）；`add-field-events`（天气，「异常天气」规则依赖）；`add-route-branches`（路线位置，「等级上限」按路线位置取上限）。
- 代码：`sim/content/rules.ts`、`sim/content/badges.ts`、`sim/content/params/rules.ts`，`sim/world.ts`（`RunConfig.rules`），`upgrades.ts`、`rescue.ts`、`director.ts`、`partners.ts` 等规则落点，`run/progress.ts` 结算，`ui/gpu/lobby.ts`、多人房间、结算界面。
- 平衡：解析模型新增规则压力项；golden 只在不选规则的配置下保持不变。
