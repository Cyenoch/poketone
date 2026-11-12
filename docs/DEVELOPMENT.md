# 开发手册

README 之外的开发细节：工具链、依赖策略、资源制作流程和 AI 助手技能。架构与验证选择见 [CLAUDE.md](../CLAUDE.md)，协作约束见 [AGENTS.md](../AGENTS.md)。

## 编辑器

VS Code 推荐安装工作区建议的 Oxc、EditorConfig 和 TypeScript 7 扩展；已配置保存格式化、显式保存时修复、原生 TypeScript 语言服务及工作区编译器路径。首次使用工作区编译器时，按编辑器提示确认信任和版本选择。Web 和原生入口均由 `Bun.build` 打包，开发服务与预览使用 `Bun.serve`。浏览器平台控件采用 StyleX，官方 Bun 插件在构建时生成带内容哈希的 CSS（插件内部依赖 Babel）；`src/styles.css` 只保留全局页面重置和 Safari 底色。正常游戏 UI 继续由 Three/WebGL 绘制。TypeScript 类型检查、Oxlint 和 Oxfmt 保留各自职责。

## 依赖策略

直接依赖固定精确版本，提交 `bun.lock`。`bunfig.toml` 设置：

```toml
[install]
exact = true
linker = "isolated"
minimumReleaseAge = 43200
```

只有发布满 **12 小时**（43200 秒）的版本可安装，涵盖传递依赖，不设豁免；精确版本同样受限，范围依赖取满足年龄的较旧版本。bun 把缺少发布时间的版本视为通过，也没有严格 peer 依赖检查。`isolated` 与 pnpm 一样不提升依赖，只能引用自己声明的包。补丁登记在 `package.json` 的 `patchedDependencies`。新增依赖使用 `bun add <包名>`；升级可执行 `bun update --latest`，之后运行 `bun run check` 并验证浏览器场景。CI 安装使用 `bun install --frozen-lockfile`。

当前已移除 Vite；Bun 1.4.4、StyleX 0.19.1。初始其他主要版本：React 19.3.1、TypeScript 7.0.2、Three.js 0.186.1、Oxlint 1.90.0、Oxfmt 0.75.0。初始化查询时 Three.js 0.187.0 发布尚不足 12 小时，因此未采用。

## 手机浏览器

手机仅支持横屏。竖屏显示「请横屏使用」，旋转后自动恢复原界面，不再维护手机竖屏布局。

手机浏览器的全屏与横屏（`src/platform/landscape.ts`，首次触摸经 `src/platform/gesture.ts`，与音频解锁共用一组监听）：

| 平台                                     | 无浏览器栏的显示                                                                                                                                                        | 横屏锁定                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Android Chrome 等（支持 Fullscreen API） | 首次触摸时 `requestFullscreen({ navigationUI: "hide" })`，每次载入只请求一次；退出全屏后不再追问                                                                        | 全屏成功后 `screen.orientation.lock("landscape")`；不支持的浏览器静默跳过                   |
| 安装到主屏幕（Android 等）               | `public/manifest.webmanifest` 的 `display: fullscreen`（回退 `standalone`）                                                                                             | manifest 的 `orientation: landscape`，由支持它的浏览器执行                                  |
| iPhone Safari                            | 无 Fullscreen API；首次显示一次「添加到主屏幕」提示（分享图标，放在左侧中部，不挡主操作）（记在 `localStorage` 的 `poketone.installHint.v1`），从主屏幕打开即无浏览器栏 | 不支持：iOS 既不执行 manifest 的 `orientation`，也没有 `ScreenOrientation.lock`，靠玩家旋转 |
| 桌面浏览器                               | 不自动全屏                                                                                                                                                              | 无                                                                                          |

所有平台上竖屏时仍由「请横屏使用」提示覆盖。应用图标采用小火龙·火焰旋涡款，源图为 `assets/icons/concepts/2026-11-07/characters/charmander.png`；`public/icons/icon-*.png` 为 180 / 192 / 512px 导出，`public/favicon.ico` 包含 16 / 32 / 48px。来源与生成命令见 `public/icons/icons.provenance.json`。PWA 使用标准 `any` 图标，不声明任意形状裁切安全。

## 资源入库约定

- 不接入支付、广告、商城或商业化 SDK。代码与题材资源的权利分开处理，见 [README](../README.md#许可与权利)。
- Tripo 只作为离线内容制作工具，运行时不依赖 Tripo 服务，不要求 API Key，也不会上传导入的本地模型。导出和使用生成物前，核对所用计划、输入素材及输出资源的许可。
- 每项正式资源入库时，在资源旁记录来源链接、作者/生成工具、制作日期、许可/署名要求、原始工程位置和修改情况；不把来源不明的资源混入代码资产。

## 3D 模型与动画（Tripo + Blender）

1. 模型一律低多边形、省积分，禁止生成高精模型。先 `--dry-run` 看报价，调用时设 `TRIPO_CLIENT_APP=claude`。角色和敌人走 `.agents/skills/skill-model/` 的多视图流程：官方立绘 → nano banana 2.1 画 2×2 四视图 → `split-sheet.py` 切图 → `tripo make <四张图> --model tripo-v3.1 -p smart_low_poly=true -p face_limit=1000`（40 积分）→ `render-compare.py` 按游戏镜头对比。文字生成（约 30 积分）让 Tripo 自己画参考图，颜色常错（杰尼龟紫肚皮、卡咪龟 / 水箭龟需要 `recolour`），不再用于角色。
2. 原始导出保存在 `assets/<characters|enemies|props>/<名字>/`（含 `task.json` 与原始 GLB；参考图和渲染图不入库）。可玩宝可梦再做绑骨（25 积分）和原地动画（每个 10 积分）；成群的敌人不绑骨，用程序化跳动省积分。
3. `bun run assets:game`（Blender 5.2，`assets/prepare-game-models.py`）生成发布 GLB：只保留基础色、缩小纹理、敌人减到约 900 面、把 Tripo 双足片段里贴进肚子的手臂抬开（`open_arms`），仅对逐图批准的静态模型先连接重合的开放接缝，再减面；八种双足 idle 在最终骨架上烘焙脚掌接地，Tripo run 的首尾以局部周期曲线连接。写入 `public/models/`，构建记录在 `assets/game-models.build.json`。
   树和灌木不用 Tripo：`blender --background --factory-startup --python assets/props/build-props.py` 手搭源模型（Tripo 的圆形树冠是碎片），再走同一条管线。
   妙蛙种子一系不用 Tripo 的四足绑骨：`blender --background --factory-startup --python assets/characters/rig-quadrupeds.py` 在未绑骨的 Tripo 网格上搭骨架、按区域刷权重、生成 `run` / `idle`，写到 `assets/characters/<名字>/blender/`，再走同一条管线（0 积分）。
   短腿的双足（小火龙、杰尼龟、卡咪龟、皮卡丘、雷丘）保留 Tripo 的绑骨和 `idle`，`run` 换成 `blender --background --factory-startup --python assets/characters/run-bipeds.py` 在原骨架上逐帧解腿部 IK 做的大步幅跑步（带腾空，0 积分），写到 `assets/characters/<名字>/blender/`，再走同一条管线。管线对每个 Tripo 双足先做 `symmetrise`（把贴合较好的一侧的骨骼、权重和关键帧镜像到另一侧：Tripo 的 idle 向一侧歪，绑骨两侧的关节位置也不一样），正面才左右对称。
4. Tripo 导出的朝向不统一（多数面向 +X），游戏在载入时按 `view/assets.ts` 的 `facingYaw` 校正；新模型需要先渲染侧视图确认朝向。
5. 来源、任务 ID 和费用见 [game-models.provenance.json](../public/models/game-models.provenance.json)（3350 积分；2026-11-06 起玩家形态按 `.agents/skills/skill-model/` 的多视图流程重新生成）；旧小火龙的记录存档在 [charmander.provenance.json](../public/models/charmander.provenance.json)（185 积分）。

原地跑步片段的地面速度、每圈步态周期数和各片段的抬升量（让片段最低点落在地面上）用 `blender -b --python assets/measure-run-clip.py -- public/models/<形态>.glb <高度>` 量，填进 `formModels` 的 `runClipSpeed`、`runCycles` 和 `lift`（`run-bipeds.py` 的片段 `runClipSpeed` 用脚本输出的着地速度 × 高度，见 `formModels` 注释）。有尾巴的形态在 `formModels` 的 `tail` 里登记尾巴中心线，画面层载入时加尾骨并做摆尾（`view/tail.ts`）。

## 音频制作

新的音效和 BGM 一律用项目级 [ElevenLabs 官方托管 MCP](ELEVENLABS-MCP.md) 生成，并按 [AUDIO.md](AUDIO.md) 的风格和规则做：声音身份、哪些该单独做、提示词模板、生成与母带流程。成品在 `assets/audio/elevenlabs/`（`raw/` 原始、`master/` 母带与 `timing.json` 重音点、`manifest.json` 出处），`bun run audio:master` 处理，`bun run audio:master --publish` 把清单里标了 `ship` 的素材复制到 `public/audio/`。游戏已接入：31 个音效、菜单 / 局内 / 头目 3 首 BGM、胜负短曲（共享引擎在 `src/audio/`）。局内 BGM 的方向是“宝可梦野外”风格的乐队 + 弦乐 + 小号（见 AUDIO.md）。只有少数几条被人耳听过；音效的重音与特效关键帧的对齐见 AUDIO.md「声画同步」。

## AI 助手技能

项目为 AI 开发助手安装了若干技能（`.agents/skills/`），只在开发时使用，不进入游戏运行时。

### Blender 资产制作技能

项目另安装了 [Scenario Blender 专家技能](https://github.com/scenario-labs/skills/tree/main/skills/dcc/blender)，位于 `.agents/skills/scenario-blender-*/`，来源提交与内容哈希记录在 `skills-lock.json`，MIT 许可见 [.agents/SCENARIO-SKILLS-LICENSE](../.agents/SCENARIO-SKILLS-LICENSE)。这些技能使用本地 Blender，无需 Scenario 账号或 MCP；不进入游戏运行时依赖。

- `scenario-blender-expert`：公共工具与入口，模型审查、多角度渲染和 Blender 5.2 API 注意事项。
- `scenario-blender-retopology`、`scenario-blender-uv-baking`、`scenario-blender-texturing-shading`：生成模型的拓扑清理、UV、烘焙和材质处理。
- `scenario-blender-rigging`、`scenario-blender-animation`、`scenario-blender-sculpting`：绑定、权重、动画与形体修整；雕刻工具也是绑定工具中测试人偶的依赖。
- `scenario-blender-geometry-nodes`、`scenario-blender-lighting-rendering`、`scenario-blender-export`：程序化环境资产、对比渲染、GLB 导出及重新导入核对。

新宝可梦模型仍遵循 `skill-model` 的官方立绘 → Tripo 流程，以上技能补充 Blender 后处理。使用时沿用项目低模预算和游戏镜头；技能的通用默认数值不覆盖项目约束。2026-11-07 已核对安装文件与来源一致，并在本机 Blender 5.2.3 LTS 完成 12 个 Python 工具模块的加载检查；尚未逐项验证其建模、烘焙、绑定和导出功能。

### 游戏 UI 设计技能

项目级安装官方 [Impeccable](https://impeccable.style/) 技能，位于 `.agents/skills/impeccable/`，来源与内容哈希记录在 `skills-lock.json`。它是 AI 开发助手的设计技能，不是 React 组件库，不进入游戏运行时依赖或产物。

- **Impeccable**：视觉层级、排版、配色、布局、控件状态、动效打磨与可访问性审查。
- **`game-ui-ux`**：游戏 HUD / 菜单交互、焦点导航、屏幕适配、安全区及 UI 与游戏状态的连接；需要按钮反馈和过场手感时再配合 `game-feel`。
- **`skill-vfx`**（项目自建，`.agents/skills/skill-vfx/`）：招式特效与敌方预警的阶段结构、可读性、属性配色、屏幕占比预算、设计模板与评分表，以及每个招式的参考资料。
- **`skill-model`**（项目自建，`.agents/skills/skill-model/`）：从官方立绘生成低模宝可梦：nano banana 2.1 四视图 → 切图 → Tripo 多视图 → 游戏镜头对比渲染。
- UI 任务先读取 `PRODUCT.md` 和目标对应的 `.impeccable/surfaces/` 简报；已有 `DESIGN.md` 时一并读取。沿用全屏游戏菜单和清爽海岸冒险方向，不套用网站导航、营销落地页或卡片墙，不编造尚未确定的玩法。

可直接要求助手「使用 Impeccable 和 game-ui-ux 审查主菜单，保留现有游戏美术方向」。支持技能命令的工具可用 `/impeccable critique 主菜单` 或 `/impeccable polish 研究所`；Codex 使用 `$impeccable`。

安装与更新仅针对本项目，不使用全局安装：

```sh
npx skills add pbakaus/impeccable --skill impeccable --agent codex --yes
npx skills update impeccable --project --yes
```

这里的 `codex` 选择共享 `.agents/skills/` 目录，与已有游戏技能保持一致。安装后重新加载助手会话，以刷新技能发现。

游戏 UI 简报已登记在 `.impeccable/surfaces/src-app-tsx.md`，关联主菜单与共享 UI。该目录由 Impeccable 管理，已从 Oxfmt 排除，避免格式化改写 frontmatter 后使关联目标失效。

游戏 UI 规范见 [DESIGN.md](../DESIGN.md)：大厅采用海岸场景、伙伴舞台和右侧决定列；功能界面使用深海蓝窗框、冰蓝内容区和暖黄选中态，覆盖指令、选项、弹窗、短消息、过场与手机适配。机器可读 token 位于 frontmatter，组件预览及动效、断点元数据位于 `.impeccable/design.json`。海岸背景在 `public/art/`，来源记录随文件保留。

当前共享技能安装不配置自动设计 Hook；完成 UI 修改后手动检测：

```sh
.agents/skills/impeccable/scripts/impeccable detect src/
.agents/skills/impeccable/scripts/impeccable detect http://localhost:5173
```

第二条需先启动 `bun run dev`，并使用实际服务地址；源码检测不能替代渲染后的对比度、溢出与交互验证。检测退出码 `2` 表示发现问题，`1` 表示扫描失败。其他工具的自动 Hook 支持与信任步骤见[官方说明](https://impeccable.style/docs/hooks)，不自动批准执行权限。
