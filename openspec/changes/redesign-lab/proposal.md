# Proposal

## Why

大版本「野外与路线」第 4 期（用户 2026-11-17 确认）。研究所现在只有 24 个数值节点，买满后不再有目标，界面是普通的分段页加卡片网格。用户要求研究所「进一步丰富，UI/UX 升级，更风格化」。

参考两种做法：宝可梦传说 阿尔宙斯的图鉴研究等级（遇见、击败、异色累积研究进度），以及以撒的结合用成就解锁扩充内容池。成长方向从「数值更高」扩展为「内容更多」。

## What Changes

- **图鉴研究等级**：每种敌方宝可梦按遇见、击败、异色三类任务累积研究点，满 10 点为研究完成。等级由进度 v5 的 `dex` 计数推算，不另存。
- 图鉴按研究状态逐步显示：未遇见为剪影；遇见后显示名称、模型和属性；研究完成后显示数值、招式和掉落。
- **内容解锁**（`UnlockId`）：新的交互点、事件、出口奖励标记、隐藏特性和挑战规则由研究成就解锁，满足条件后在结算时自动获得，写入进度 v5 的 `unlocks`。未解锁的内容不进入卡池或生成表。现有数值节点保留，仍用星星沙子购买。
- **研究所场景化**：研究所改为实验室场景，有三处：书架（研究卷宗：图鉴研究、解锁、羁绊）、实验台（现有数值节点）、徽章盒（`add-challenge-rules` 的 8 枚徽章）。只由 Claude 用 impeccable 设计和实现，用真实截图验收。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `encyclopedia`：新增「图鉴研究等级」。
- `progress-save`：新增「研究解锁内容」。
- `multiplayer`：新增「合作中的解锁内容」。
- `gpu-presentation`：新增「研究所场景」。

## Impact

- 依赖：`extend-progress-v5`（`dex`、`unlocks`、`badges`）；`add-field-events`（`dex` 计数、交互点和事件）；`add-route-branches`（出口奖励标记）；`deepen-builds`（隐藏特性）；`add-challenge-rules`（规则与徽章）；`add-partner-bond` 往羁绊卷宗里加节点。
- 代码：`sim/content/dex-research.ts`、`sim/content/unlocks.ts`、`run/research.ts`（研究等级推算与解锁判定），`run/progress.ts` 结算，`run/codex.ts` 与 `ui/gpu/codex.ts`，`ui/gpu/lab.ts` 重做。
- 资产：研究所场景背景图（Magpie Image，记录来源，同大厅背景）。
