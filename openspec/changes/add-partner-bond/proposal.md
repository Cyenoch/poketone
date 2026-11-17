# Proposal

## Why

大版本「野外与路线」（用户 2026-11-17 确认）。伙伴之间现在只有通关记录不同，常用的伙伴不会积累任何专属成果。宝可梦正作里有亲密度：亲密度高的宝可梦会为训练家挺住致命一击、自己治好异常状态。本 change 把这种羁绊做成每个伙伴自己的长期进度，奖励以外观、称号和小幅保命效果为主，不超过研究所的数值成长。

## What Changes

- 每个伙伴按自己参与的对局积累羁绊点：每清一张地图得点，通关额外得点，难度越高倍率越高。写入进度 v5 的 `bonds`。
- 羁绊分 5 级，每级授予一项：
  - 称号：每级一个，显示在大厅和合作座位。
  - 开局效果：Lv2「挺住」，每局一次，致命伤害后保留 1 点生命；Lv4「自己治好」，每张地图一次，自动解除第一个异常状态。
  - 羁绊研究节点：Lv3 在研究所羁绊卷宗开放该伙伴的专属节点，用星星沙子购买，只在使用该伙伴时生效。
  - 异色外观：Lv5 授予该系列异色外观（`add-shiny-looks`）。
- 羁绊效果计入解析平衡模型，单项不超过研究所同类数值节点。
- 没有商店，不能用任何货币购买羁绊点。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `progress-save`：新增「伙伴羁绊积累」。
- `combat-builds`：新增「羁绊开局效果」。
- `gpu-presentation`：新增「羁绊等级与称号显示」。

## Impact

- 依赖：`extend-progress-v5`（`bonds`、`looks`）；`redesign-lab`（羁绊卷宗）；`add-shiny-looks`（外观授予）；`add-route-branches`（按地图计数）。
- 代码：`sim/content/bonds.ts`、`content/params/bonds.ts`，`RunConfig.players[].bond`、`Player.bond`（世界快照版本加一），`hurt.ts`（挺住）、`status.ts`（自己治好），`run/lab.ts` 羁绊节点，`run/progress.ts` 结算，`RunResult.zones`。
- 平衡：`balance:model` 新增羁绊项。
