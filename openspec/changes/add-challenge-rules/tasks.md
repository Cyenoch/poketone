# Tasks

## 1. 内容与模拟

- [ ] 1.1 `sim/content/rules.ts`、`sim/content/badges.ts`、`content/params/rules.ts`，按 `content/README.md` 登记。
- [ ] 1.2 `RunConfig.rules` → `world.rules`，世界快照版本加一。
- [ ] 1.3 六条规则落点：救援与复活、经验与等级上限、卡池过滤、精英生成、天气权重。
- [ ] 1.4 星星沙子倍率在 sim 内应用；`RunResult.danger`。
- [ ] 1.5 `bun run balance:model` 加入规则压力项，按结果校准危险度。

## 2. 进度

- [ ] 2.1 `recordRun` 结算徽章；`progress.rules` 回填；`ruleAvailable`。

## 3. 联机

- [ ] 3.1 房间配置下发规则，客机只读，规则变化清空准备。

## 4. 界面与资产

- [ ] 4.1 impeccable 设计规则入口、规则窗口、房间规则行、构筑面板规则行、结算徽章（只由 Claude 设计与实现）。
- [ ] 4.2 规则与徽章图标；获得徽章音效（ElevenLabs，母带，`manifest.json` 标记 ship）。

## 5. 测试与验证

- [ ] 5.1 sim、进度、联机测试（见 design.md「测试」），加入 `test:sim` 文件列表。
- [ ] 5.2 `bun run test:sim`、`bun run golden`。
- [ ] 5.3 `bun run test:ui`（新文案字形覆盖）。
- [ ] 5.4 浏览器 1280×800 与 844×390：规则窗口、房间规则行、结算徽章；键鼠、触控、手柄各走一遍。
- [ ] 5.5 两人联机：房主选 Nuzlocke，客机倒下不可救援，双方结算倍率正确。

## 6. 规范

- [ ] 6.1 同步主规范并归档。
