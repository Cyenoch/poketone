# Design

## 所属版本

大版本「野外与路线」的存档基础。本 change 与 `guide-field-exit` 独立推进，其余依赖新进度字段的功能在本 change 集成后实施。

## v5 新增字段

均为本机数据，只由游玩获得，结构直接定义，不保留兼容字段：

| 字段      | 形状                                                                                                                                                                                                     | 写入方                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `dex`     | `Partial<Record<EnemyId, { seen: number; defeated: number; shiny: number }>>`                                                                                                                            | 图鉴研究（`redesign-lab`）、异色（`add-field-events`） |
| `looks`   | `{ owned: StarterId[]; worn: StarterId[] }`，拥有和正在使用的异色外观                                                                                                                                    | `add-shiny-looks`                                      |
| `badges`  | `BadgeId[]`，最多 8 枚                                                                                                                                                                                   | `add-challenge-rules`                                  |
| `rules`   | `RuleId[]`，上次出发选的挑战规则，供大厅回填                                                                                                                                                             | `add-challenge-rules`                                  |
| `unlocks` | `UnlockId[]`，研究所解锁的内容（事件、出口标记、特性、规则）                                                                                                                                             | `redesign-lab`                                         |
| `bonds`   | `Partial<Record<StarterId, number>>`，羁绊点                                                                                                                                                             | `add-partner-bond`                                     |
| `tower`   | `Partial<Record<StarterId, { floor: number; difficulty: Difficulty }>>`，对战塔最高层                                                                                                                    | `add-battle-tower`                                     |
| `seeds`   | 最近 20 个种子码成绩：`{ code: string; starter: StarterId; trainer: TrainerId; result: "victory" \| "defeat"; time: number; kills: number; floor?: number }[]`，`floor` 只在对战塔码中出现（通过的层数） | `add-seed-challenges`                                  |

各 ID 类型（`BadgeId`、`RuleId`、`UnlockId`）由对应 change 的内容表定义；解析时按当前内容表校验，未知 ID 视为非法。

## 迁移（用户 2026-11-17 确认）

- `parseProgress` 按 `version` 分派：v5 直接校验；v4 先用 v4 的完整规则校验，再补空的新字段，返回 v5 进度并标记“需要保存”。其他版本拒绝。
- 每个已发布格式保留一个只做校验的解析函数和一个升级到下一版的纯函数；v6 出现时只需新增 v5 → v6 一步，不改旧函数。
- Web 在保存成功后才替换 `localStorage` 记录；原生端沿用原子写入，写入成功前保留原文件。导入 v4 导出文本走同一路径。
- 两个版本号要分清：进度格式（`progress.ts`，现为 v4）和导出外层格式（`save.ts` 的 `SAVE_FORMAT`，现为 v3）。本次进度升到 v5、外层升到 v4；导入时先按外层版本拆开（v3 或 v4），再按里面的进度版本校验和升级。测试固定一份当前线上版本导出的“外层 v3 + 进度 v4”文本。
- 本地存储键保持 `poketone.progress.v3` 不变，避免换键造成的“读不到旧进度”。
- 原生默认文件名继续使用已经发布的 `save.v3.txt`，文件名不跟随导出外层版本改动；校验和升级成功后原子替换内容。旧 `save.txt` 路径仍明确拒绝并保留。
- 并行设置变更 `88b6dfde` 在外层 v3 下加入 `pauseOnBlur`、`autoOpenCards`。因此外层 v3 的冻结设置规则接受原三项，以及这两个可选布尔字段；原三项导出缺少它们时均取 `true`，已有值原样保留。除此之外的字段仍拒绝。此历史规则不读取当前设置字段表，后续新增设置不能扩宽旧版本的接受范围。
- 世界快照仍不跨版本兼容：它只用于对局内恢复和联机，不长期保存。

## 不做

- 不改变设置功能；保留当前声音、开发者模式、UI 缩放、失焦暂停、自动打开升级卡。旧外层的字段校验和默认值只在存档迁移边界处理。
- 不做账号或云同步。
