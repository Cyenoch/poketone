# Tasks

## 1. 进度与条件

- [x] 1.1 `starterUnlocks` 改为条件联合类型（研究、通关、不同伙伴通关），六只伙伴的门槛。
- [x] 1.2 `starterUnlockProgress` / `starterUnlocked` / `distinctClears`，`starterLock` 锁签文案，`runUnlocks` 沿用。
- [x] 1.3 `scripts/lab.test.mjs`：每类条件含门槛，导入低进度存档后的选择校正。

## 2. 界面

- [x] 2.1 `BallBadge` 剪影模式与 `setSilhouette`。
- [x] 2.2 大厅剪影伙伴、焦点锁签提示，未解锁伙伴不可选、切换跳过；`ui-lobby` 测试。
- [x] 2.3 图鉴列表、关联卡片与详情二维剪影立绘（不渲染模型），锁定系列隐藏种族值、特性、终极技与招式。

## 3. 验证

- [x] 3.1 typecheck、lint、test:ui、`lab.test`，golden 只因本 change 以外的模拟改动变化时归因说明。
- [x] 3.2 1280×800 与 844×390 下新进度、部分解锁、全部解锁的大厅与图鉴截图检查。
