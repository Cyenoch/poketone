# Tasks

## 1. 图鉴研究

- [x] 1.1 `sim/content/dex-research.ts`、`content/params/research.ts`，`run/research.ts` 推算研究点与完成状态。
- [x] 1.2 一局统计各物种出场与击败次数，校准阈值（大多数普通物种 5 到 10 局完成）。
- [x] 1.3 图鉴按研究状态显示：剪影、基础、完整；条目内显示任务进度。

## 2. 内容解锁

- [x] 2.1 `sim/content/unlocks.ts`，第一批解锁清单（按 design.md 原则从各 change 内容表选出）。
- [x] 2.2 结算时判定并写入 `unlocks`；各内容池按解锁过滤；`RunConfig` 携带房主与个人解锁。

## 3. 研究所场景

- [x] 3.1 写 `.impeccable/surfaces/src-ui-gpu-lab-ts.md` 简报，用 impeccable 设计（只由 Claude 设计与实现）。
- [x] 3.2 实验室背景图（Magpie Image），记录来源。
- [x] 3.3 重做 `ui/gpu/lab.ts`：场景热点、书架卷宗、实验台、徽章盒，以及键鼠、触控、手柄导航。

## 4. 测试与验证

- [x] 4.1 研究、解锁、合作、图鉴测试（见 design.md「测试」），加入 `test:sim` 文件列表。
- [x] 4.2 `bun run test:sim`、`bun run golden`。
- [x] 4.3 `bun run test:ui`（新文案字形覆盖）。
- [x] 4.4 浏览器真实截图 1280×800 与 844×390：场景、三处内容、图鉴三种研究状态；键鼠、触控、手柄各走一遍；用户视觉验收。

## 5. 规范

- [x] 5.1 同步主规范并归档。
