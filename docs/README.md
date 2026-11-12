# 文档入口

每项信息只维护一个来源。行为读主规范，正在做什么用 `bun run spec:list` 查对应change，如何开发和排查读手册。有日期的QA证据不保存在仓库中。目录只链接，不另抄能力状态或任务进度。文档归属契约见 [documentation](../openspec/specs/documentation/spec.md)，操作见 [OpenSpec用法](OPENSPEC.md)。

## 行为规范

| 主题                          | 唯一规范                                                         |
| ----------------------------- | ---------------------------------------------------------------- |
| 文档归属与证据                | [documentation](../openspec/specs/documentation/spec.md)         |
| 确定性、状态与快照            | [simulation](../openspec/specs/simulation/spec.md)               |
| 数值来源与平衡调优            | [balance-tuning](../openspec/specs/balance-tuning/spec.md)       |
| 战斗、构筑、站点与同伴        | [combat-builds](../openspec/specs/combat-builds/spec.md)         |
| 地图、区域、地表与出口        | [world-progression](../openspec/specs/world-progression/spec.md) |
| GPU页面、输入可达性与危险反馈 | [gpu-presentation](../openspec/specs/gpu-presentation/spec.md)   |
| 平台、设备与权限              | [platform-services](../openspec/specs/platform-services/spec.md) |
| 合作、救援、恢复与终局        | [multiplayer](../openspec/specs/multiplayer/spec.md)             |
| 本机进度、背包与保存          | [progress-save](../openspec/specs/progress-save/spec.md)         |
| 图鉴内容与导航                | [encyclopedia](../openspec/specs/encyclopedia/spec.md)           |
| 资产、字体与声画              | [asset-pipeline](../openspec/specs/asset-pipeline/spec.md)       |

规范有已知实现缺口，不代表所有场景已验收。活动任务只在 [changes](../openspec/changes/) 维护；[ROADMAP](ROADMAP.md) 只列未排期方向。

## 项目与实现定位

- [README](../README.md)：玩家概览与快速开始；[开发手册](DEVELOPMENT.md)：工具链、依赖策略与模型/音频制作；[AGENTS](../AGENTS.md)：协作约束；[CLAUDE](../CLAUDE.md)：架构与命令。
- [PRODUCT](../PRODUCT.md)：产品定位；[DESIGN](../DESIGN.md)：详细视觉参数的唯一来源。
- [内容注册表说明](../src/run/sim/content/README.md)：内容数据与扩展约定；具体数值、名单与配方查源码和图鉴。
- [隐式状态机地图](STATE-MACHINES.md)：应用/UI、联机、资源/音频、模拟、平台/输入、画面/分析六领域的实现所有者和转换；各分册由该地图统一索引，不另立行为规范。
- UI简报：[共享界面](../.impeccable/surfaces/src-app-tsx.md)、[大厅](../.impeccable/surfaces/src-ui-gpu-lobby-ts.md)。

## 操作与制作手册

| 手册                                                                          | 独立用途                       |
| ----------------------------------------------------------------------------- | ------------------------------ |
| [MAPGEN](MAPGEN.md) / [NAVIGATION](NAVIGATION.md)                             | 地图装配、导航算法与失败定位   |
| [RENDERING](RENDERING.md)                                                     | 绘制、色彩合成及资源处理方法   |
| [BALANCE](BALANCE.md)                                                         | 分析工具运行、校准方法与局限   |
| [GAMEPAD](GAMEPAD.md)                                                         | 设备识别、接入、权限和排障     |
| [MULTIPLAYER](MULTIPLAYER.md)                                                 | 建房、重返、错误分类与验证入口 |
| [NATIVE-RUNTIME](NATIVE-RUNTIME.md) / [NATIVE-PACKAGING](NATIVE-PACKAGING.md) | 开发运行、依赖修复与独立包制作 |
| [字体构建](fonts-paging-design.md)                                            | core/base构建、发布与错误排查  |
| [AUDIO](AUDIO.md) / [ElevenLabs连接](ELEVENLABS-MCP.md)                       | 音频制作/母带/接入与服务连接   |
| [GAME-FEEL](GAME-FEEL.md)                                                     | 反馈设计的层级与取舍方法       |
| [ART-PROMPTS](ART-PROMPTS.md) / [MAP-ART](MAP-ART.md)                         | 美术语言、制作模板与地图风格   |
| [Harbor](../services/harbor/README.md) / [部署](../deploy/README.md)          | 服务配置、生产运行与回滚       |

## 可视QA（`bun run qa:visual`）

默认只跑轻量检查：点名本次改动的界面；完整预设只在最终整合时由主线程运行。

```sh
bun run qa:visual --screens pause,stats              # 日常：改动的界面，2 组配置
bun run qa:visual                                    # 冒烟：只跑大厅，2 组配置
bun run qa:visual --screens hud --with lifecycle     # 按需加专项检查
bun run qa:visual --preset final                     # 最终整合
```

- **配置**：默认 `desktop-1280x800@100`（DPR 1，鼠标）与 `phone-844x390@100`（DPR 3，触屏，安全区 47 / 21）。`--matrix full` 跑全部 13 组；`--configs` 按名称、名称片段（`844x390`）或类别（`phone`）挑选。
- **界面**：`lobby settings save lab codex partner hud pause stats cards station result` 或 `all`；不传 `--screens` 时只跑 `lobby`。`partner` 到 `result` 会按玩家路径出发并进入对应局内界面。
- **专项**：`--with lifecycle,perf,first-screen`（或 `all`）。`lifecycle` 走上下文丢失 → 恢复 → 继续 → 结算 → 再来一局 → 返回大厅；`perf` 测帧时间；`first-screen` 用生产构建测首屏。`--preset final` 跑全部界面与专项，并加测 `phone-844x390@80` 的触控尺寸。
- **其他选项**：`--out dir`（默认 `$TMPDIR/poketone-qa/<time>/`）、`--url` / `--prod-url`（已运行的服务）、`--live`（直接服务工作区而非快照）、`--idle-ms`（默认 2000）、`--full-res`。列表可用逗号或空格分隔。
- **环境**：源码先冻结为临时快照，自起 Bun Web 服务和一个真实 GPU 的无头 Chrome，退出时清理。需要 Google Chrome 与 npx 缓存中的 `playwright-core`（或设 `PLAYWRIGHT_CORE`），`CHROME_PATH` 可覆盖 Chrome 路径。
- **输出与判定**：每个界面的截图、按配置/界面的联系表、`results.json` 与 `summary.md`。阻塞项（输入可达、控制台错误、漏字、意外滚动溢出、焦点环裁切、触控目标 ≥ 44 px、生命周期）失败时退出码为 1，脚本崩溃为 2；诊断项（HUD 居中偏差、空闲帧率、首屏、帧时间）只报告不失败。阈值在 `scripts/qa/config.mjs`，页内探针、判定和界面步骤在 `scripts/qa/lib/`。

## 经验、研究与来源

- [LESSONS](LESSONS.md)：按现象/原因/做法检索经验。
- [确定性研究](research/DETERMINISM.md)、[WFC取舍](research/WFC.md)：研究，不等于实施授权。
- [UI历史评审](../.impeccable/critique/game-ui-review.md)：保留来源与适用范围。
- [原生许可证](../scripts/native/licenses/README.md)：第三方原文；资产来源由 `assets/`、`public/**/provenance*`、字体SOURCES及manifest维护。

新增文档先查是否已有合适来源。完成变更后同步规范并归档；旧计划在有效信息承接后删除，不保留另一份正文。归档的proposal/design/spec delta是历史，不随当前实现平行更新。第三方技能、官方生成工作流和许可证按各自来源维护。
