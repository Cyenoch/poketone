# Design

## Context

动机见 [proposal](proposal.md)。本设计以源码与已发布上游接口为依据；查询结果不是升级成功证据。主线程仍在实现野外事件、路线及训练师演出，实施基线须取其整合后的版本，不能覆盖进行中的文件。

| 已观察到的事实                                                                                   | 对本设计的约束                                                       |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `package.json` 精确固定 Three 0.186.1，五个依赖有 patch；`bunfig.toml` 已有 43200 秒发布年龄规则 | 更新所有依赖并逐项缩减补丁；不再造一套安装器                         |
| `AppRenderer.#frame` 已按世界/UI 变更决定是否绘制；`UiStage` 有 dirty 与独立动效                 | 不以“UI 永远重绘”为前提新增全屏 UI 缓存                              |
| `GpuTimer`、`WorldResolution`、多 pass 统计和预热队列已经存在                                    | 迁移现有设施，不另建性能框架；已有阈值仍需真实设备校准               |
| `createRun`、`UiStage`、大厅及图鉴已调用 `compileAsync`                                          | 工作是减少变体和完善真实 pass 预热，不能改回同步 `compile()`         |
| Web / SDL 都构造 `WebGLRenderer`；SDL 提供真实外部 GL 上下文且 `canvas:null`                     | common Renderer 的原生呈现必须先验证，不能用浏览器 mock 冒充         |
| `patchShader.ts`、`UiShaderMaterial`、UIKit 面板/字形使用 GLSL 注入；VFX、离屏拷贝也有直接 GLSL  | WebGPU 准备必须覆盖这些真实消费者，替换 renderer 构造器远远不够      |
| `loadGlb.ts` 明确拒绝 KTX2 与 Meshopt；`EmbeddedTextures` 负责宿主图片解码                       | 转码工具、信任边界、加载器、worker/WASM 与两端发行一起迁移           |
| `Sprites.update/advance` 在 CPU 积分粒子并逐帧上传；还有立即精灵及预警保留槽                     | 存在可落地的 WebGPU 原生数据链路，不能只换 shader 语言               |
| `scripts/web.mjs` 通过版本变化整页刷新；`main.tsx` 使用 React StrictMode                         | 当前不是保留模块状态的 HMR；历史 Vite/HMR 记录不能直接当当前补丁理由 |

依据：[GPU 规范](../../specs/gpu-presentation/spec.md)、[平台规范](../../specs/platform-services/spec.md)、[资产规范](../../specs/asset-pipeline/spec.md)、[开发手册](../../../docs/DEVELOPMENT.md)、[渲染手册](../../../docs/RENDERING.md)、[资源状态机](../../../docs/state-machines/resources.md)、[共享 UI 验收](../complete-shared-ui-acceptance/design.md)、[视觉基准](../../../DESIGN.md)、[界面简报](../../../.impeccable/surfaces/src-app-tsx.md)。旧手册中关于全局调色、单地图和历史性能的叙述须与当前源码区分。

## Goals / Non-Goals

**Goals:**

- 在用户确定的 12 小时规则内完成升级，并让新能力进入正式资源和渲染路径。
- 建立一份场景/材质/效果定义、按能力选择的执行策略；WebGPU 使用合适的原生数据与提交模型，WebGL2 保持完整可玩性。
- 将后续 WebGPU 默认启用的剩余工作收敛为发行策略和目标设备验收，不留下大批材质、字体或宿主待迁移。
- 删除已被上游覆盖、已失去生产用途和仅为开发热更新而存在的代码；剩余必要扩展有明确边界。

**Non-Goals:**

- 不创建后端无关的通用渲染引擎、自己的着色语言/转译器或复制 Three 内部管理器。
- 不要求 WebGL2 模拟 WebGPU 的所有能力，也不要求两个后端使用相同命令或完全相同浮点中间值。
- 不把有损压缩、降采样、关闭抗锯齿、隐藏效果视为天然优化；不为追新加入全屏 GI、SSR 或光追风格。
- 不承诺 dev HMR、Fast Refresh、开发重复挂载保存会话，不以热更新故障驱动依赖 patch。
- 本次不切换产品为 WebGPU 默认，不替换 SDL 为 WebView，不改变模拟或存档格式。

## Decisions

### 1. 依赖选择覆盖整个项目，按批次固定截止时刻

先清点项目内依赖声明与工具版本校验：除 `package.json` 外，覆盖字体脚本的 PyPI 依赖、`source.py` 的工具表、原生/资产构建脚本和 CI 固定工具。使用各自 registry 的版本/制品发布时间和官方 release 对照，不从版本号或 GitHub tag 日期推断 npm/PyPI 上传时间。每批安装固定统一的 `cutoff = resolvedAt - 43200s`，选择稳定发布线中满足条件的最高版本；排除预发布、弃用及撤回版本。保留 Bun 原生 `minimumReleaseAge`，对实际锁入版本核对缺失的时间证据，不能利用 Bun“缺少时间视为通过”的行为绕过规则。冻结安装沿用锁文件，不因时间流逝自行解析新版。

当前明确的候选如下，这是规划输入而非长期版本表；实施时一次刷新并锁定，集成中不无限追逐刚发布的版本。

| 依赖                                      | 当前 → 合格候选                                         | 具体联动                                 |
| ----------------------------------------- | ------------------------------------------------------- | ---------------------------------------- |
| `three` / `@types/three`                  | 0.186.1 / 0.186.0 → 0.187.0 / 0.187.0                   | 源码、类型、补丁、所有材质和两端生命周期 |
| `@stylexjs/stylex` / `@stylexjs/unplugin` | 0.19.1 → 0.19.2                                         | 同步版本，Bun 构建及平台控件 CSS         |
| `oxfmt` / `oxlint` / `oxlint-tsgolint`    | 0.75.0 / 1.90.0 / 7.0.2005 → 0.79.0 / 1.94.0 / 7.0.2007 | 配套 peer 约束；格式迁移不夹入业务重写   |
| `sharp`                                   | 0.34.5 → 0.35.5                                         | 原生图片解码、二进制 ABI 和独立包        |
| `webgl-node`                              | 1.6.2 → 1.7.1                                           | 原生上下文、压缩纹理能力和两个旧补丁     |
| `@fission-ai/openspec`                    | 1.16.1 → 2.1.0                                          | major 迁移、项目内技能刷新及归档校验     |

其他当前 npm 直接依赖及 Bun 的查询未发现更高合格稳定版，仍须纳入安装结果核对。OpenSpec 2.1 的默认全局技能方向不覆盖本仓库约定：保留 project scope，先执行新版 `update --dry-run`，仅刷新本项目生成文件，继续通过 `bun run spec` 调用；不修改个人 profile。新引入的官方转码工具也适用同一规则。升级同步项目运行时、CI 和 native 打包声明，逐项验证 optional 依赖，不能以 Web 安装成功代替原生 ABI 通过。

字体构建还固定 `fonttools`、`brotli`、`pillow`，当前 PyPI 合格候选分别为 4.68.0、1.2.1、13.0.0。`package.json` 的 fonts 命令与 `scripts/fonts/source.py` 的 TOOLS / UV_RUN 必须消费同一版本来源。采用字体工具域内的标准 uv 项目清单与 `uv.lock`，以同一截止时刻排除更新的候选并锁定传递依赖、Python 约束和制品摘要，构建使用冻结环境；不再以重复 `uv run --with` 临时解析环境。MSDF-Atlas-Gen / MSDFgen 等项目声明或校验的原生工具，以及被调用且版本会影响产物的资产工具，按官方发布制品核对版本/发布时间/摘要并记录构建输入。原始字体来源 commit 与美术原源是资产身份，不随工具升级擅自换源。字体工具更新触发 core/base 成套重建与 manifest 身份变化，需验证字形、度量、分页和缓存一致性。

每个依赖批次是一个完整迁移单元：候选选择 → 配套版本与最小 patch 重基/删除 → 调用方与声明迁移 → 生成锁定结果 → 冻结安装及行为验证。不能先去掉带版本绑定的 patch 安装最新包，再把“补回生产能力”留给后续任务。未打补丁依赖可独立先交付，受补丁约束的 Three/类型、webgl-node、UIKit/SDL 必须各自成套验证；最终整合检查在这些批次完成后运行。

替代方案“只升 Three”不满足全依赖目标；“为了省事跳过 major”也不成立。不能解决的兼容问题应成为具体未完成任务，而不是暗自固定旧版本。

### 2. 补丁按行为拆分，先用上游，再删多余所有者

| 当前扩展                                           | 上游核对与处置方向                                                                                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `three`：外部 context、动画停止、GL 状态、程序保留 | r187 仍依赖 canvas 与浏览器调度，不能直接删原生支持。迁移后逐项保留真实 surface、宿主帧推进/异步等待及编译失败传播所需的最小扩展，删除旧 renderer 特有代码；每项对照已发布源码                                             |
| `three`：`createProgramRetention`                  | r187 release 的 `getProgramVariant` 是内部函数，并非公开保留 API。优先用有界材质模板所有权、`NodeMaterialInstance` 与上游管线缓存维持复用，验证跨页面/重开后再移除自定义保留；不使用隐藏网格挂住程序                       |
| `@types/three`                                     | 随运行时公开 API 同步删除扩展声明；只为仍必要的原生扩展保留匹配类型，不用 `any` 或假 canvas 类型逃避                                                                                                                       |
| `@pmndrs/uikit`                                    | 最新版仍为 1.0.78；网格对齐、文本测量、分页字体与回收没有可声称已发布的替代。拆分生产字体/布局能力与后端材质，保留必要最小扩展；优先官方材质注入能力，缺失时仅提供明确材质创建扩展点，不运行时改原型，不复制 Yoga/排版系统 |
| `@kmamal/sdl`                                      | 最新仍为 0.11.13，最小化/恢复误改 fullscreen 是正式行为；未修复前保留最小修复，验证系统窗口操作                                                                                                                            |
| `webgl-node`                                       | 1.7.1 增加压缩纹理枚举处理，但仍创建 mock canvas；仍可能把计时扩展公告为可用却返回空对象。分别核对并保留确有必要的真实能力修复，不因版本升级就假定两项已修复                                                               |

每个剩余 hunk 在 `docs/DEVELOPMENT.md` 的补丁说明中记录生产用途、上游依据、退出条件；临时验证证据留 QA，不新增另一份长期 patch 清单文件。上游引用以已发布 tag / npm 包为准；未发布 main 分支修复不冒充可安装版本。对于可删除的 patch，同批移除应用调用、类型、构建补偿、无效测试和说明，不能只让文件行数减少。

common Renderer 阶段另有必须核对的生产缺口：宿主驱动的节点帧推进与可取消异步等待，以及编译失败向调用方传播。优先使用公开入口；r187 未提供足够语义时，只在上游相应边界提供最小显式扩展及类型，不能把这些错误转成 console 抓取、私有字段探测或全局 RAF shim。它们需要故障与生命周期验收，不能以“减少补丁”为由丢掉正确性。

项目的风、调色、技能造型是产品代码，不因它们自定义就删除；移除的是对上游内部 shader chunk 的脆弱字符串依赖。不得把完整 UI shader 拷进一个新兼容库后宣称“零 patch”。

### 3. 开发刷新采用最简单的整页重启

检视 `main.tsx`、`App.tsx`、`platform/web/ui-surface.ts`、音频与准备取消链，以及 `docs/LESSONS.md` 的历史 HMR 记录，按实际调用路径确认用途。若 StrictMode 的开发重复挂载是某复杂保护的唯一原因，可简化该启动边界，包括移除游戏宿主外的开发重复挂载包装；不添加挂载计数、延迟销毁、跨模块单例保活或 HMR 热数据迁移。

`AppRenderer` 单一所有者、`createPreparation` 的 generation/取消和音频结束处理也保护正式切页、异步失败及设备恢复，不能按含有“StrictMode”注释一刀切删除。测试应继续保护正式产品行为；仅保护不再支持的 HMR 连续性的断言不迁移成新机制。开发整页刷新后从正常入口启动即可，未持久化对局可以结束。

### 4. 最终使用 Three common Renderer，后端差异集中在现有边界

目标执行链：共享应用/只读世界 → 共享场景与 TSL 材质 → `AppRenderer` 的世界、UI 和资源调度 → Three common Renderer → WebGPU 或 WebGLBackend → Web / SDL surface。直接采用上游类型和对象，不再包一层照抄其全部方法的 renderer façade。

- `RenderSurface` 继续只负责窗口、实际绘制表面、调度和呈现；初始化改为可等待流程。平台创建完成后再激活 AppRenderer，`prepare` 复用既有 generation 屏障。
- Web 使用 `three/webgpu` 公开导出的 `Renderer`、`WebGPUBackend` / `WebGLBackend` 与 `StandardNodeLibrary` 直接组合，在平台创建处完成必要配置，不派生一个复制 renderer 的类。r187 的 `WebGPURenderer` 构造器会自行设置 `getFallback`，因此不用于要求严格后端选择的入口；`forceWebGL:false` 或传入空 `getFallback` 不能禁用它的回退。直接构造的 Renderer 不注册库内回退，由宿主处理 auto，并在初始化后验证实际 backend。明确设置目标格式、深度/模板与抗锯齿，不能接受默认 FP16 输出导致额外带宽。正式默认策略为强制 WebGL2；QA/开发可选择强制 WebGPU 或 auto。
- SDL 使用同一 common Renderer + WebGLBackend 组合，提供真实外部 GL context、尺寸及 present。原生扩展范围分为 surface 生命周期、宿主帧推进、异步等待调度与取消三部分；不仅是 nullable canvas。r187 的 render/compute 会启动内部 Animation 循环，后端并行编译、异步读回/查询也有浏览器 RAF 依赖，必须同时解决。不能注入 `window/document/requestAnimationFrame`、构造假 Canvas，或复制整套 renderer。扩展先在真实原生窗口验证，再扩大迁移。
- `FrameClient` 与世界/UI pass 统一迁往 common Renderer 所需接口；不能通过 `WebGLRenderer | WebGPURenderer` 联合类型在每个调用处散布分支。后端特有计时、能力及丢失信号只在 `src/rendering/` 与平台边界处理。
- Three 的 WebGPU 与 WebGL 后端本来就是必要执行差异，不视为两套产品；禁止的是重复页面、重复玩法和长期维护两份视觉 shader。

由 `RenderSurface.start` / AppRenderer 保持唯一帧调度所有权。通过明确的宿主驱动入口，在每个逻辑帧开始时复用上游节点帧/统计推进，随后 compute、world、UI 共用该帧标识，不让每次 render/compute 各起循环。独立 UI/世界时钟仍由应用提供；帧编号和等待调度不得依赖 renderer 的第二条 RAF。公开 API 不足时扩展上游的外部帧驱动模式，不能从应用读写 `_animation` / `_nodes` 或复制 NodeFrame 实现。

并行编译和读回的非阻塞检查使用宿主提供的有界、可取消等待服务，复用已有 scheduler；准备期间即使还没有可见画面也能取得进展，关闭或 generation 变化时取消旧等待并结束其 Promise。Web 不保留第二条持续内部 RAF，SDL 不要求浏览器全局；非阻塞单次等待不等于新增一条常驻帧循环。真机验证覆盖节点时间、多 pass 帧身份、暂停与退出后无继续唤醒。

`WebGLNodesHandler` 可在迁移阶段帮助小批验证 TSL，但不作为最终架构：r187 源码列出实例几何共享、MRT、storage texture、fog 更新等限制；它也不是把 UIKit 的 `onBeforeCompile` 自动转成 WGSL 的工具。迁移结束删除此过渡接线和旧 renderer 路径。

### 5. 先打通真实技术关口，再迁移全部材质

第一个技术关口必须同时覆盖：Web 的 common Renderer 强制 WebGL2 / WebGPU、SDL 外部 GL 呈现、真实 UIKit 容器/分页中文/裁剪/图像、实例化和蒙皮角色、depth/stencil 轮廓、离屏拷贝与一次完整销毁重建。还须实际完成异步编译、compute 编译与缩略图读回，并证明只有一份帧调度、关闭后无残留等待；不能以窗口显示和 resize 通过代替。使用正式组件，不能用空白三角形或替代 UI 材质宣称全链路可行。

编译等待完成与编译成功分别确认：r187 `WebGPUPipelineUtils` 的部分 render/compute 管线错误被捕获、记录后仍 resolve；WebGLBackend 的 link 错误主要通过 `debug.onShaderError` 或日志报告。因此仅 `await compileAsync/compileComputeAsync` 不能标记 ready。核对并接入有效的公开失败入口；若公开回调不能完整覆盖或关联当前编译请求，则以最小扩展让相应公开编译操作传播失败结果/rejection，保留上游并行和缓存机制。错误必须绑定当前 preparation、generation、材质或 compute 任务，并让所有等待者正确结束；不能临时覆盖全局 console，也不能读取私有 pipeline.error。相同失败管线的缓存命中不得误报成功，旧任务错误不能击穿新准备。

关口故意损坏 render 与 compute shader：分别验证 WebGPU 与受支持的 WebGL 编译路径报告带定位上下文的准备失败，不激活页面、不继续提交失败管线、不自动回退。另覆盖 adapter 已存在但后端初始化失败：强制 WebGPU 明确失败，auto 只由宿主尝试一次 WebGL2，并能清理部分初始化资源。

UIKit 1.0.78 的 `createPanelMaterial` 和 `InstancedGlyphMaterial` 仍注入 GLSL。方案是在其受控材质创建边界接入项目 TSL 面板/字形材质，继续使用原布局、实例数据、排序、分页与输入。优先已发布公开入口；缺口用最小扩展点暴露所需数据，并删除旧 GLSL 接线。若这需要复制整个布局库或无法保持字形质量，技术关口不得通过，也不能以世界能画出为由继续扩大改动。

迁移按族进行，每族接真实消费者并删除旧表达：

1. UI：`ui-shader.ts`、UIKit 面板/字形、斜切板/渐变/阴影、图片去色、地图和罗盘、训练师切入、伤害数字、图鉴离屏模型。
2. 世界：`materials.ts`、`terrain.ts`、`environment/`、实例角色运动、蒙皮与尾巴、dither 遮挡、模板描边和地面标记。
3. VFX：`vfx/gl.ts`、sprites / decals / ribbons / volumes、血条和边界墙；保持现有参数表和效果生命周期。
4. 输出：`grade.ts` 和 `world-pass.ts` 用节点表达已确认顺序，不把世界调色套到 UI 或预警。

采用 `NodeMaterialInstance` 共享同类 node graph 与各对象参数，使用公开 reference / attribute / uniform 机制；按材质族有界持有模板，不能保活全部资源。TSL 是共同的视觉表达，不意味着 WebGPU 继续使用逐粒子 CPU 上传。节点的时间由既有世界/视觉/UI 时钟明确提供：暂停、失焦、恢复和演出速度不能改为无条件读取 renderer 全局时间。

### 6. WebGPU 原生工作负载：粒子从生成到绘制留在 GPU

首个交付对象为 `Sprites` 的持久粒子池，而不是预警和本帧立即精灵。现有 `advance` 包含阻力、重力、落地、旋转与寿命；保留这些效果语义和参数。GPU 工作只作用于视觉，绝不承担伤害判定或使用模拟 RNG。联机演出无法显示时只跳过该演出，不阻断同包有效动作；呈现准备或加速能力不得成为动作消息的准入条件，不引入反作弊逻辑。

- CPU 提交新增粒子及少量帧参数，上传量随生成事件变化；状态放入可供 compute 与 vertex 使用的 storage buffer，预分配并按 renderer generation 管理。避免每帧创建 buffer、bind group、pipeline 和映射整个缓冲。
- compute 更新粒子状态，构造可见绘制索引/数量，绘制直接读取 GPU 结果。使用上游 compute、storage 与 indirect 能力，不能每帧 `mapAsync` 读回数量后再填 CPU instance buffer。
- `load` / 容量策略只保留必要的发射与寿命元数据，不在 CPU 再积分整池；溢出按现有装饰预算处理。立即精灵、状态标记和危险预留槽有独立有界区域，GPU 压缩不得挤掉危险反馈。
- 透明粒子的顺序要有定义：保留原池顺序或明确且经视觉验收的稳定顺序；不能让 atomic append 的随机次序改变叠色。采用稳定压缩或保序索引；若为此成本超过收益，回到该负载的测量结论，不能隐藏回归。
- compute 与 draw 在有序提交中消费同一状态；缓冲布局/对齐、usage、workgroup 和 dispatch 上限按 adapter limits 验证，选择与负载匹配的工作组。`shader-f16`、subgroups 等只在适合的数据及支持设备上作为增强，不成为启动硬需求。
- WebGL2 保留适合其能力的有界粒子执行策略；若上游 compute 的 WebGL 回退不支持所需 storage/atomics，则沿用 CPU 粒子更新和范围上传，或对可解析运动使用顶点计算。它与 WebGPU 共用粒子参数和视觉材质，后端更新内核的必要差异集中在粒子执行边界，不复制整套 VFX。
- WebGPU 的有效性验收需要记录实际 backend、compute/indirect 提交、上传字节和读回；与同画质 CPU 路径对照。至少一个真实正式负载取得可重复收益才算原生能力闭环通过，空演示或自动落回 CPU 不算。

随后检查敌群/植被 GPU 剔除、静态命令 bundle、间接实例绘制是否减少真实瓶颈。已有 chunk culling、实例化和低 draw count 可能使这些优化无收益，因此逐项做有界比较；不把 meshlet/visibility buffer、subgroups 或 f16 当作必须全开的开关。未采用项必须写明负载与测量依据，不能只写“未来可用”。

### 7. 能力、回退和设备丢失是正式状态转换

能力探测基于实际 adapter/device/GL 扩展及限额，不以浏览器品牌、用户代理或全球覆盖率作判断。只记录当前消费者需要的能力：呈现 API、纹理格式、样本数、计时、compute/indirect 及采用的可选特性，不建立空的万能 capability registry。

`webgl2` 强制模式不尝试 WebGPU；`webgpu` 强制模式若失败则明确报错；`auto` 在图形 API/adapter 不可用、能力不足或设备初始化失败时允许一次 WebGL2 回退。资产校验、shader validation 和应用异常保留具体错误，不能 catch-all 成回退。回退后本会话不自动反复尝试 WebGPU。

三个模式都通过上文的严格 backend 组合初始化，不启用 `WebGPURenderer` 内置回退；初始化后的实际 backend 身份也作为验收证据，不能只报告请求策略。错误分类覆盖 requestDevice 和后端初始化的失败，不只测试 `navigator.gpu` 缺失。

浏览器一个 canvas 一旦绑定 context 类型就不能换 API。优先在绑定前完成能力预检；已绑定时由 Web surface 释放旧 renderer/context，替换真实 canvas 并重新绑定 UiSurface 输入，维持只有一个活动呈现表面与一份 session。不能在旧 canvas 上反复 `getContext` 或创建常驻第二画布合成两种 API。

`device.lost` / context loss → 停止 GPU 工作与本地推进、增加 generation → 丢弃旧 GPU 队列与完成结果 → 有限重建 → 重新上传/编译/准备 → 恢复；联机沿用同步规则。重建失败时 auto 可一次回退，回退后再次失败明确终止恢复。异步销毁必须被拥有者等待，旧设备 buffer/texture/pipeline 不可跨设备复用。GPU 视觉粒子可由保留发射描述重建或按既有清屏恢复规则重置，但危险提示从当前模拟状态重建。

### 8. GPU 优化矩阵：每项有落点，不重复已有设施

| 项目              | 采用与比较方法                                                                                                                                                                       | 不允许的替代                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 帧调度与 UI 工作  | 复用 AppRenderer dirty、UiStage requestFrame、暂停世界缓存；核对动效时钟、UI 布局遍历与失效传播。静态 UI 离屏缓存只有正式混合场景确有收益才采用                                      | 为已有按需绘制再叠一份全屏缓存；暂停 UI 动画                                |
| MSAA 与附件带宽   | 分开测世界 target 和 UI/default target；按真实支持的 sample count 选择。用上游 render target 的 resolve/store 配置释放不再使用的 MSAA depth/stencil，WebGPU 使用明确 load/store 语义 | 假定“两份 MSAA 必然重复”；用粗指针直接判低性能；删掉描边/遮罩仍需的 stencil |
| 纹理压缩          | KTX2/Basis 用于适合的模型/环境颜色纹理；官方 loader + transcoder，按设备选择 ASTC/BC/ETC 等或上游解压输出，统计实际常驻字节                                                          | 用 GLB 文件大小当 VRAM；保证固定压缩比；把 MSDF/高度/数据纹理做有损压缩     |
| 几何传输          | 利用已安装 Meshopt 和官方 loader 接线，比较下载、解码、上传与动画质量；量化须核对法线、蒙皮和尾巴                                                                                    | 只开压缩标记，未打包 decoder；对已有小网格盲目增加成本                      |
| 实例上传与剔除    | 复用 `uploadRange`、chunkedInstances、实例化；只传脏区与必要动态数据，更新正确 bounds，评估批次与几何合并                                                                            | 每帧上传整池；仅靠 StaticDrawUsage 假装不上传；合并到失去有效剔除           |
| 透明覆盖          | 检查大 quad 空白区域、DoubleSide 双 pass 和既有 blend/depth 顺序；仅在保持外观时用单 pass/alphaTest/alphaToCoverage                                                                  | 把半透明云、水、预警强行改成不透明；无脑开启 OIT                            |
| 阴影              | 沿用单太阳、阴影视域；按投影物/光源/相机变化更新。运动/蒙皮/风变形仍触发正确阴影                                                                                                     | 全局冻结后漏角色、风或镜头变化；把新 SunLight/CSM 当免费提质                |
| shader / pipeline | NodeMaterialInstance 和共享 reference，实际目标格式/样本/阴影变体下 compileAsync；compute 也预编译，复用已创建管线                                                                   | 把运行时值拼入 shader/cache key；用内部 getProgramVariant 保活              |
| mipmap 与资源寿命 | 对动态纹理按实际采样需求使用 `generateMipmaps` / `mipmapsAutoUpdate`；逐资源 dispose 和 node buffer 生命周期，跨重开验证内存回落                                                     | 禁掉必要远距 mip；以 Object3D.dispose 代替纹理、材质和子树释放              |
| WebGPU 数据与提交 | 粒子闭环必做；按实测评估 GPU cull/indirect、bundle、共享 binding、storage 布局；依赖上游实现                                                                                         | GLSL→TSL 后就宣称 GPU driven；每帧 CPU 回读维持旧模式                       |
| 计时与动态分辨率  | 复用 FrameStats/WorldResolution，后端计数归一化；异步获取 timestamp，缺失就 unavailable；性能比较时固定分辨率，调优后再开控制器                                                      | 用 CPU render 时长冒充 GPU；读取时阻塞；通过自动降画质美化对照              |

本矩阵的每一项最终须为“已采用并验证”“现有机制已满足并验证”或“有实际依据的不适用”。“没时间”“库不方便”“只有桌面快一点”不作为完成依据。桌面低负载不代表手机无收益；没有设备证据就保留相关任务未完成。

### 9. 颜色、字体与缓存语义作为迁移底线

当前 `grade.ts` 的真实顺序是 lighting → grade → sRGB encode → display-space fog → premultiply；世界 target 是显示编码 RGBA8 + NoColorSpace，VFX 直接输出显示色，暗角在 VFX/危险提示之前。节点实现先保持此语义，显式控制 output 转换，防止默认 HDR/tonemapping 或二次 sRGB 编码改变外观。不得把所有内容合并到最终调色 pass；乘法暗角与透明 VFX 顺序不可随意交换。

KTX2 首批只处理适合的模型/环境纹理，使用官方 `KTX2Loader`、GLTFLoader 扩展与可在 Bun/浏览器执行的官方转码代码；host 只提供 worker/字节读取等真实服务，不模拟 DOM。若官方 loader 所需 Worker 能力在 native 缺失，提供小而明确的任务执行边界，不能写自己的 KTX/Basis 解码器。处理来源、参数、输出摘要并入既有构建记录；解码器/WASM/worker 经 `assetUrl` 和内容哈希清单发布，独立包打入本地文件，不能依赖 CDN。

`EmbeddedTextures` 的 PNG/JPEG 宿主解码入口和 KTX2 扩展必须正确分派：它当前覆盖 loadTexture，不能抢走压缩纹理处理。自包含引用校验保留，允许格式精确扩展，不删除整个校验器。GPU 格式结果按设备能力与 generation 归属，失败/取消释放部分资源。图鉴与正式对局读同一加载规则。

### 10. 上游新能力必须落到消费者或给出有依据的边界

- r187 `NodeMaterialInstance`、TSL tree-shaking、共享实例 node build、并行 `compileAsync`：进入材质家族、构建与准备链；检查实际包体和冷/热进入时间，避免导入两份 Three 核心。
- r186/187 render target 的 depth resolve/store 及销毁修复：进入 world/codex/UI pass 和设备恢复。r187 的 viewport/scissor 规则按新语义使用，禁止再补偿 pixel ratio。
- r187 GLTFLoader 嵌入 KTX2 无 Blob 路径、webgl-node 压缩格式支持：用于两端资产链；这些改动不等于 native worker 和 codec 已自动打包。
- r187 `Texture.mipmapsAutoUpdate`：只应用于确有动态更新且 mipmap 需要独立控制的纹理，当前已经不生成 mip 的资源不额外套逻辑。
- `Object3D.dispose`、`intersectsFrustum` 已在 r186；不把它们算作此次新获得收益。BatchedMesh 修复只在确有混合几何/同材质批处理收益时采用。
- PMREM 变化、EON BRDF、GI、meshlet/visibility pipeline、clustered lights、OIT 等按现有低模画风与负载评估；没有环境贴图或对应工作负载的功能不为凑“新特性”而接入。Node/Bindings 的优化属于对应 common renderer 路径，不能误报成旧 WebGLRenderer 自动收益。

### 11. 定向研究发现的同范围优化一起交付

这些是源码中已定位的工作，不是已测得的收益；实施时用对应负载验证。全部留在本 change 的呈现/资源边界内，不借机改玩法或重做界面。

| 位置与事实                                                                               | 本 change 的具体收敛                                                                                                                   | 验证                                                                                                      |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `UiStage.update` 无条件调用 `crispBorders` 遍历组件树                                    | 利用布局、DPR、UI scale、边框属性和组件加入/移除的已有失效信号，只更新受影响布局；不引入旁路树或监听全局所有属性                       | 静止菜单 CPU 工作减少；运行中改缩放、新窗口和动态内容的边框墨迹仍正确                                     |
| `createRun.draw`、大厅绘制调用 `applyWorldOutput` 遍历所有对象，内部再判断材质是否已处理 | 在 TSL 材质创建/加入时建立明确 world/UI 输出归属，删除每帧补丁扫描和对应 WeakSet；动态新材质也走同一创建入口                           | 新形态、池扩容、新效果、跨区与恢复没有漏调色或误染 UI，帧内遍历减少                                       |
| `CodexThumbs.render` 同步读像素后再上传为 DataTexture                                    | 使用上游异步 readback，保留必要 CPU 像素用于恢复；将 target 和临时模型占用到读回完成，保证任务、取消、销毁和 generation 归属，队列有界 | 大列表滚动/首次图鉴不因同步读回长时间阻塞；快速关闭、丢失恢复不产生晚到写入或泄漏                         |
| `app-host.prepare` 比较 `info.programs.length` 决定编译等待                              | 以真实 compile/upload 完成及成功结果和现有 Preparation/token 判断就绪，按第 5 节传播错误；不将 resolve 当成功，移除程序计数推断        | 图鉴/选卡/弹窗在冷启动、恢复与取消下无未准备首帧，也无永久等待                                            |
| `warmUi` 在 canvas 配置编译后使用另一离屏 target 绘制；`warmSurfaces` 构造不可见页面副本 | 上游节点共享模板与实际 pass 参数成为预热单位，保留确有首次展示收益的有界预热；删除纯粹为缓存身份制造的页面副本、样例数据与隐藏对象     | 首次页面/技能和热重开编译耗时不回退，启动内存与无效构造下降；sample/format/depth 不同的 pipeline 不能混用 |

上表的“完成结果”须同时满足第 5 节的成功判定，不能仅靠 Promise resolve。并行更新 `CodexModel` 的编译失败/取消与 generation 处理：它目前在 render 中排队并在完成后切换 flags，必须在 common Renderer 异步生命周期下继续正确，不能因简化 dev 防护而删除正式保护。异步缩略图读回也须走第 4 节宿主等待入口，不能把同步阻塞换成 native 中不可调用的裸 RAF。无收益且确无正确性变化的候选记录实测结论，不为制造 diff 强行添加缓存。

## Risks / Trade-offs

- [UIKit 尚无现成的完整 TSL 字形/面板替代] → 将正式中文页面列为首个技术关口；必要材质扩展点保持最小，禁止布局重写和降低字形质量。
- [common Renderer 依赖 canvas、内部 Animation 和裸 RAF，原生迁移可能扩大 patch] → 先打通真实 surface、宿主节点帧推进、异步编译/读回与取消，禁止全局 shim 和第二帧循环。若需要复制渲染器，停留在明确未完成关口，不能保留永久旧路径后宣称完成。
- [编译接口完成但管线实际失败] → 验证公开错误传播，必要时只扩展失败返回语义；以损坏 render/compute shader 和失败缓存重试验收，禁止从日志或私有标志推断就绪。
- [GPU 粒子压缩改变透明顺序或容量策略] → 固定输入重放、稳定索引、独立危险预留槽及混战动态验收；不以更少粒子取得收益。
- [双后端执行差异增加验证成本] → 共享效果数据与材质表达，差异只放在必要的执行内核；不强求不可能的逐位浮点一致，但模拟 golden 必须不变。
- [压缩、MSAA 和输出格式改变画质] → 固定视角/分辨率/内容做截图与动态对照；质量失败就调整该方案，不能降低验收标准。
- [较新的库修复和本地补丁并非语义等价] → 用真实页面、重开及丢失恢复证实替代；局部类型通过不是证明。
- [开发专用代码与生产所有权代码混杂] → 按正式调用链判断用途，先去掉重复挂载需求，保留取消、一次提交及持久化安全。
- [全依赖升级产生格式和构建变更] → 分批验证并在整合点跑全套；保留他人未提交工作，不进行整树无关改写。

## Migration Plan

1. 冻结实际集成基线与代表画面/性能负载，记录源版本、设备、分辨率和随机视觉输入到外部 QA；恢复之前缺失的证据不等于补做完所有历史验收。
2. 逐个完整批次迁移依赖版本、锁定结果、配套 patch 与调用方，再冻结安装和验证；包含 PyPI 与固定原生构建工具。全部批次完成后做整合检查。新旧 npm 运行时不能并存；不在升级过程中写应用级 monkey patch。
3. 在正式应用入口打通两种 Web 后端与 SDL common Renderer 技术关口；临时迁移开关只存在于此 change，结束时删除旧 renderer 和过渡桥。
4. 按材质家族迁移并接真实页面，收敛程序所有权、资源生命周期与 GPU 准备；每族完成后移除旧 GLSL 注入。
5. 接通压缩发布资源、原生 GPU 粒子闭环及其余适用优化，保留同画质 WebGL2 回退。性能策略在实际能力确认后选择，不按设备品牌猜测。
6. 正式 Web 构建分别跑强制 WebGL2、强制 WebGPU、auto 不可用回退；SDL 跑真实窗口与独立包。覆盖大厅→图鉴→出发→暂停→恢复→结算/放弃→再开，以及设备丢失、编译中取消、resize 和跨显示器。
7. 对六图、后期敌群、四人同屏与多技能效果使用同内容对照。分别测冷启动、首次技能/进化、热重开、稳定帧 p50/p95/p99、GPU 时间、上传和常驻内存；固定 DRS 对比后再在真实手机验证自适应。每组多次运行，波动覆盖的差异不能报告成收益；性能属于诊断，不加无依据 CI 调用数门槛。
8. 同步本 change 的规范、开发/渲染/原生手册及状态机地图；删除失效胶水与临时迁移路径，执行 `spec:check` 后按实际完成范围归档。`complete-shared-ui-acceptance` 只引用本轮适用证据，不借此勾选未验设备或历史问题。

本 change 修改依赖、构建与渲染，整合验证包含 `check`、`test:build`、`test:ui`、`test:network`、`test:sim`、不重录的 `golden` 和原生相关检查；渲染恢复、字体分页、资源取消和后端错误选择沿用 `scripts/*.test.mjs` 补必要行为用例。正式画面与真实设备检查另外记录，不用 mock 或手机 viewport 代替。

发布回滚使用可复现的前一套依赖、代码、资产清单和构建产物整体恢复；不保留运行时旧接口转发或双套材质以便回滚。WebGPU 默认仍未开启，后续启用是单独的发行策略选择，不需要再次迁移业务和材质。

## Open Questions

- 真机上各 pass 的最佳 MSAA 样本、DRS 阈值、纹理编码质量和粒子工作组规模由本 change 的实测决定；这些数值不改变架构与视觉契约。
- 真实设备是否从静态 bundle、GPU culling 或可选 subgroups/f16 获益由优化矩阵验收决定；这些增强不可成为基本 WebGPU/WebGL2 正确性的前提。

## References

- [Three r187 发布说明](https://github.com/mrdoob/three.js/releases/tag/r187)、[r186 发布说明](https://github.com/mrdoob/three.js/releases/tag/r186)、[迁移指南](https://github.com/mrdoob/three.js/wiki/Migration-Guide#186--187)。
- [r187 WebGPURenderer](https://github.com/mrdoob/three.js/blob/r187/src/renderers/webgpu/WebGPURenderer.js)、[WebGLBackend](https://github.com/mrdoob/three.js/blob/r187/src/renderers/webgl-fallback/WebGLBackend.js)、[WebGLNodesHandler 的限制](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/tsl/WebGLNodesHandler.js)、[NodeMaterialInstance](https://github.com/mrdoob/three.js/blob/r187/src/materials/nodes/NodeMaterialInstance.js)。
- [r187 公开后端与 NodeLibrary 导出](https://github.com/mrdoob/three.js/blob/r187/src/Three.WebGPU.js)、[Renderer](https://github.com/mrdoob/three.js/blob/r187/src/renderers/common/Renderer.js)、[Animation 调度](https://github.com/mrdoob/three.js/blob/r187/src/renderers/common/Animation.js)、[WebGPU 管线编译结果](https://github.com/mrdoob/three.js/blob/r187/src/renderers/webgpu/utils/WebGPUPipelineUtils.js)。
- [UIKit 1.0.78 字形材质](https://unpkg.com/@pmndrs/uikit@1.0.78/dist/text/render/instanced-glyph-material.js)、[面板材质](https://unpkg.com/@pmndrs/uikit@1.0.78/dist/panel/material/create.js)、[webgl-node 1.7.1](https://unpkg.com/webgl-node@1.7.1/lib/webgl2-context.mjs)。
- [WebGPU 规范](https://www.w3.org/TR/webgpu/)、[MDN WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)、[WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)。
- [OpenSpec 2.1 升级说明](https://github.com/Fission-AI/OpenSpec/releases/tag/v2.1.0)、[npm registry](https://registry.npmjs.org/three)。具体安装证据与性能结果存于 QA，不将查询日期表复制为长期手册。
- [PyPI fonttools](https://pypi.org/pypi/fonttools/json)、[brotli](https://pypi.org/pypi/brotli/json)、[pillow](https://pypi.org/pypi/pillow/json)、[字体工具版本校验](../../../scripts/fonts/source.py)。
