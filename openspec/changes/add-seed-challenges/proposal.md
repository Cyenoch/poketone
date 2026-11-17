# Proposal

## Why

用户 2026-11-17 要求"种子码挑战：不需要服务器，和朋友打同一局比成绩"，放进大版本「野外与路线」。模拟已经完全确定（固定 30 Hz、世界 rng、跨引擎一致的数学函数），同一份开局配置在同一版本下会生成同样的地图、出怪和事件，只差一个能抄给朋友的文本。

## What Changes

- 新增种子码：一段可复制粘贴的文本，编码格式版本、模拟版本指纹、种子、难度、模式、起始地图、挑战规则和可选的固定伙伴，带校验和。
- 解码时校验格式、校验和与版本指纹；任一不符都明确拒绝并说明原因，不尝试"尽量复现"。
- 大厅新增种子挑战入口：生成种子码并复制、粘贴或输入朋友的种子码、查看解码后的配置后出发。结算界面可复制本局种子码。
- 种子挑战默认不带研究所加成与背包，保证同一种子码下起点相同。
- 成绩只记在本机进度 v5 的 `seeds` 字段（最近 20 条，`extend-progress-v5` 定义）；没有服务器、排行榜或上传。

## Capabilities

### Modified Capabilities

- `world-progression`：种子码开局与校验。
- `progress-save`：种子码成绩记录。
- `gpu-presentation`：种子挑战入口、输入与分享。

## Impact

- 依赖：`extend-progress-v5`（`seeds` 字段）；`add-challenge-rules`（`RuleId`，未完成前规则段固定为空）；`add-battle-tower`（`mode`）。
- 代码：新增 `src/run/seed-code.ts`（编码、解码、校验，纯函数）；`run/session.ts` 与 `ui/gpu/lobby.ts`（入口、输入、出发、结算记录）；构建把模拟版本指纹注入 Web 与原生（已有 `__GAME_BUILD__`）。
