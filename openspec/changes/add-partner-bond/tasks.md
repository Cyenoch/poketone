# Tasks

## 1. 内容与模拟

- [ ] 1.1 `sim/content/bonds.ts`、`content/params/bonds.ts`（里程碑、称号、每个伙伴的羁绊节点）。
- [ ] 1.2 `RunConfig.players[].bond` → `Player.bond`，世界快照版本加一。
- [ ] 1.3 挺住（`hurt.ts`）、自己治好（状态模块），以及对应事件与边缘消息。
- [ ] 1.4 `balance:model` 羁绊项，校准节点数值与容差。

## 2. 进度与研究所

- [ ] 2.1 `RunResult.zones`；`recordRun` 加羁绊点，Lv5 写入 `looks.owned`。
- [ ] 2.2 `LabId` 加入 `bond-<starter>`，羁绊卷宗节点（依赖 `redesign-lab`）。

## 3. 界面

- [ ] 3.1 大厅羁绊刻度与称号、合作座位称号、结算羁绊点（只由 Claude 设计与实现）。

## 4. 测试与验证

- [ ] 4.1 进度、sim、平衡测试（见 design.md「测试」），加入 `test:sim` 文件列表。
- [ ] 4.2 `bun run test:sim`、`bun run golden`（无羁绊配置应不变）。
- [ ] 4.3 `bun run test:ui`（称号与效果名字形覆盖）。
- [ ] 4.4 浏览器 1280×800 与 844×390：大厅羁绊显示、结算升级、局内挺住消息；键鼠、触控、手柄查看下一级详情。
- [ ] 4.5 两人联机：座位称号互相可见，各自羁绊效果只作用于自己。

## 5. 规范

- [ ] 5.1 同步主规范并归档。
