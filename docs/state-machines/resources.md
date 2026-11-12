# 资源、渲染与音频状态机

基线见 [总清单](../STATE-MACHINES.md)。主范围20个TypeScript文件、5038行；逐文件覆盖在文末。本页资源状态机盘点阶段未运行测试/复现。

2026-11-08 按修复 diff 更新相关所有权与失败条目；初次盘点的数量、源码行号及范围记录不重算，不表示重新全量审计。本次文档更新未执行产品测试、构建或设备验收。

这里的“机器”包括显式枚举、几个字段联合表达的隐式状态、缓存条目、调用方持有、异步提交门、GPU 代际与资源所有权生命周期。不同层级分别列出；分解出来的子机器并不代表代码中有同名独立类。纯计算、常量表、每种粒子的插值不单列。主范围之外只追踪直接参与资源持有、上传、预热和释放的调用方，标为 X。

读过项目入口文档、当前状态、GPU 迁移/交接的相关生命周期记录，并结合 2026-11-08 代码审计（原文不随仓库发布）。旧文档描述与实现不一致时以下清单写**实际实现**。例如音频不是启动即解码所有资源；模型预取 ready 不代表 GPU 已驻留；字体 registry 当前 dispose 也不等于清空所有已解码页。

本表共 **81 项**：主范围 **65 项状态机器/子机器**，直接关联的主范围外资源生命周期 **16 项**。这是分层盘点粒度，不是独立线程或系统数量。

表列约定：

- **承载**列列 flags、refs、promises、timers；没有定时器的项不重复写“无”。
- **转换**列同时给出逻辑状态、事件与 guard；`→` 不是新建的枚举。
- **失败/终止**包括失败、取消、完成后保留与最终释放，不能把它们混为一个 done。
- **T** 是现有测试的源码映射，本轮未执行；fake GPU / 受控解码不是实际设备。
- **K#n** 是 2026-11-08 代码审计第 n 项（原文不随仓库发布），旧复现结论按其证据边界引用；本轮重新核对源码，但未重跑复现。
- **S** 是本轮静态可见的约束或待核实时序，不宣称正式页面已发生。**无新增特定风险**只表示这一行没有另外提出风险。
- 所有 owner 和测试路径相对仓库根目录；`:数字` 为定位行。

## P：准备基础设施（coordinator / shared entry / holder 分开）

<a id="p01"></a>

### P01 共享操作结果与 lane 仲裁

- **所有者/定位**：[src/prepare/handle.ts:49](../../src/prepare/handle.ts#L49) `Shared`；resolve/reject `:131`，lane `:150`
- **编码字段**：`#state=pending/done/failed`、`#value/#cause`、`#holders`、`#lane`、`#network`
- **状态、事件与转换**：acquire 增加 holder；effective lane 为 live holders 中最高优先级；pending 经 resolve/reject 单向到 done/failed；network.progress 独立通知各 holder
- **失败/取消/终态**：resolve/reject 只接受首次；无 holders 时 lane=null，调用 cache 的 empty；Shared 本身没有 cancelled 状态，也不直接 abort/dispose
- **所有权不变量**：Shared 只管理结果和引用关系；entry 所属 cache 决定网络中止、保留或释放
- **测试/风险**：T [scripts/ui-prepare.test.mjs:64,78,103,121](../../scripts/ui-prepare.test.mjs#L64)（经 fetch/preparation 间接覆盖）；S watch/lane/empty 回调同步调用，异常不会被隔离

<a id="p02"></a>

### P02 单调用方 Handle / Holder

- **所有者/定位**：[src/prepare/handle.ts:41,86](../../src/prepare/handle.ts#L41)
- **编码字段**：holder.lane、resolve/reject、watchers；闭包 `released`；每次 acquire 独立 result Promise
- **状态、事件与转换**：live-pending → fulfilled/rejected；setLane 重算共享优先级；watch/unwatch 控制订阅；release → released；已完成 Shared 的新 holder 立即取得同一结果
- **失败/取消/终态**：pending 时 release 仅拒绝自己的 result 为 AbortError；done/failed 后 release 不改变已 settled Promise；幂等释放；内部 catch 防无观察者的 unhandled rejection
- **所有权不变量**：一个调用方释放不会取消其他 holder；result 已兑现不意味着它已释放；持有完成值仍须 release
- **测试/风险**：T [ui-prepare.test.mjs:103](../../scripts/ui-prepare.test.mjs#L103)、[ui-images.test.mjs:134,201](../../scripts/ui-images.test.mjs#L134)；S release 后保留的结果对象仅是引用，不再有资源租约

<a id="p03"></a>

### P03 多 handle 聚合

- **所有者/定位**：[src/prepare/handle.ts:165](../../src/prepare/handle.ts#L165) `allOf`
- **编码字段**：parts、Promise.all 的 result、`released`；动态汇总 network
- **状态、事件与转换**：all pending → all fulfilled；任一 reject → aggregate rejected；lane 广播至各 parts；release 广播且幂等
- **失败/取消/终态**：失败不会自动释放其他 parts；release 后，已经 settled 的 aggregate 仍保留原结果；未完成部分按自身 handle 语义终止
- **所有权不变量**：聚合者拥有 parts 的释放责任，但不拥有 parts 的资源实现；network 总量只在所有有网络的部分均已知时已知
- **测试/风险**：T [scripts/ui-audio.browser.mjs:18](../../scripts/ui-audio.browser.mjs#L18) 间接；S 不应把 Promise.all fail-fast 当作 cancel-all；自定义 prefetch handle 可在 release 后 fulfilled，见 A05

<a id="p04"></a>

### P04 网络调度 coordinator

- **所有者/定位**：[src/prepare/fetch.ts:20,51](../../src/prepare/fetch.ts#L20)
- **编码字段**：全局 `entries`、`queued`、`backgroundBusy`；`BACKGROUND_SLOTS=2`
- **状态、事件与转换**：acquire 入表/复用 → pump 按 lane 排序；critical/interactive 立即入场；background/idle 共用两个槽；keep/null 保留排队不启动；download.finally 归还原入场槽并 pump
- **失败/取消/终态**：排队项 last release 被移除；in-flight 完成/失败 finally 补位；没有全局 dispose 或 timeout
- **所有权不变量**：槽位按**启动时**是否 capped 记账；已运行任务改 lane 不抢占、不改槽归属；网络并发与 CPU/GPU 调度是不同机器
- **测试/风险**：T [ui-prepare.test.mjs:64,78,103](../../scripts/ui-prepare.test.mjs#L64)；S 急迫任务不受背景上限；一个不终止的资源 read 会持续占背景槽，内部没有超时

<a id="p05"></a>

### P05 单 URL fetch entry / 流读取

- **所有者/定位**：[src/prepare/fetch.ts:14,25,32,43,69](../../src/prepare/fetch.ts#L14)
- **编码字段**：url、Shared<Blob>、AbortController；Response reader、chunks、bytes、bytesTotal
- **状态、事件与转换**：absent → queued → downloading → stream-reading → done-held；原始 URL 字符串是去重 key；下载时经 assetUrl 映射实际路径；reader EOF 设置 network.done，再 resolve Blob
- **失败/取消/终态**：HTTP 非 OK 取消 body 后抛；read/stream 失败 forget+reject；last holder release forget，pending 才 abort；旧 entry 的 forget 检查身份，不能删新请求
- **所有权不变量**：完成 Blob 留到最后 holder；未完成取消只发生在最后 holder；内容总长度只认调用方 manifest size，不猜 header
- **测试/风险**：T [ui-prepare.test.mjs:64,103,121](../../scripts/ui-prepare.test.mjs#L64)；K#14 已修 host 背景路径，K#15 已让发布映射/字节来自同一快照，见平台 PL-18；S 相对/绝对 URL 在本层仍是不同 key；取消后底层晚结果不再可由表获取

<a id="p06"></a>

### P06 Preparation 尝试 coordinator

- **所有者/定位**：[src/prepare/preparation.ts:82,114,205,224](../../src/prepare/preparation.ts#L82)
- **编码字段**：revision、lane、attempt、state、error、settled/settle、listeners、items、context unsubscribe
- **状态、事件与转换**：构造 begin → pending；所有 CPU done 且每个有 GPU need 当前 generation done → ready；首个错误 → failed；仅 failed 可 retry，attempt++、新 settled Promise；cancel → cancelled
- **失败/取消/终态**：failed/ready 保留 handle 供重试/保温；cancel 释放 handles/watch/context listener；仅 pending 的 settled 被 resolve(cancelled)，已 settled ready/failed 不重写；无内建 timeout
- **所有权不变量**：每个 attempt 只结算一次；GPU needs 必须给 context；外层拥有整个 preparation 的最终 cancel；失败不自动丢弃成功资源
- **测试/风险**：T [ui-prepare.test.mjs:121,167,239](../../scripts/ui-prepare.test.mjs#L121)；S 同步 `need.acquire()`/watch 异常不由 start 捕获，能从构造或 retry 抛出；“总会 settle”不涵盖外部永不结算/长期 keep

<a id="p07"></a>

### P07 单 need 的 CPU 获取 / 重试

- **所有者/定位**：[src/prepare/preparation.ts:70,165](../../src/prepare/preparation.ts#L70)
- **编码字段**：Item.handle/unwatch/value、cpuDone、failed；捕获 issuedIn=attempt 与 handle
- **状态、事件与转换**：unacquired → acquired-pending → cpuDone；无 acquire 的 GPU-only need 直接 cpuDone；失败记 failed；retry 只释放并重获 failed 项，其他 handle 复用
- **失败/取消/终态**：success 只在 attempt、pending、handle 身份均匹配时提交；任何同 handle 的失败即使已被另一项先失败，也标 failed 以便统一重试；cancel 后忽略
- **所有权不变量**：CPU value 随 preparation 持有的 handle 存活；一个 need 的失败不释放别人仍在等待的资源；network 未 done 划为 network failure，否则 cpu
- **测试/风险**：T [ui-prepare.test.mjs:121,167](../../scripts/ui-prepare.test.mjs#L121)；S gpu-only 或无 network 项不贡献网络/CPU total，phase 是聚合进度而非串行执行阶段

<a id="p08"></a>

### P08 单 need 的 GPU generation / task

- **所有者/定位**：[src/prepare/preparation.ts:126,135,215](../../src/prepare/preparation.ts#L126)
- **编码字段**：gpuDoneIn、gpuQueuedIn、gpuTask；闭包 generation/task；context.available
- **状态、事件与转换**：CPU-ready + available + 本代未完成/未排队 → queued(g) → running(g) → done(g)；context loss 后旧代失效；restore 或 retry 重新排队未完成项
- **失败/取消/终态**：live guard 为 preparation pending、task 身份、本代且 available；晚完成/晚失败被忽略；GPU 抛错 live 时产生 phase=gpu 的失败；正在执行的 GPU 工作不可被真正取消
- **所有权不变量**：每个 need 每代提交一次；不能把旧 context 的完成认成本代 ready；已 ready preparation 不因后续 loss 回到 pending，后续恢复由 resident/外层负责
- **测试/风险**：T [ui-prepare.test.mjs:181,219,239](../../scripts/ui-prepare.test.mjs#L181)；S 工作自身副作用不由 guard 回滚；guard 保护的是完成提交；ready Promise 是一次性凭证，不是永久 resident 凭证

<a id="p09"></a>

### P09 ready 与业务 revision 启动门

- **所有者/定位**：[src/prepare/preparation.ts:304](../../src/prepare/preparation.ts#L304) `startWhenReady`
- **编码字段**：stop subscription；preparation.revision 与 current()
- **状态、事件与转换**：订阅且立即检查；pending/failed 等待（允许 retry）；ready 时先退订，再以 Object.is(current, revision) 决定 start；cancelled 退订
- **失败/取消/终态**：返回 stop 只断开启动观察，不取消 preparation；过期 ready 不启动
- **所有权不变量**：业务 revision 的所有权由调用方保持；对象 revision 比较是 identity，不是字段相等
- **测试/风险**：T [ui-prepare.test.mjs:266,297](../../scripts/ui-prepare.test.mjs#L266)；后者模拟 A/B/depart 流程，没有 import 真实 `run/prefetch.ts`

<a id="p10"></a>

### P10 IdleQueue 入场 / 取消

- **所有者/定位**：[src/prepare/idle.ts:85](../../src/prepare/idle.ts#L85)；策略 `:66`；renderer 取队 [src/rendering/app-renderer.ts:314](../../src/rendering/app-renderer.ts#L314)
- **编码字段**：`#units` FIFO；各 unit.kind/size/run；返回 cancel；renderer.#lastInput
- **状态、事件与转换**：size 被 allowlist 接受 → queued；未接受返回 null；quiet >=300ms 时 next 出队一个；仅 renderer 本帧无需呈现才执行；cancel 删未取任务
- **失败/取消/终态**：无失败终态记录，run 抛出给调用方；出队后 cancel 不能撤回；context loss 没清空此队列，但 unavailable 时不取队
- **所有权不变量**：同帧最多一个 idle 单元；8ms 是测量准入预算，不是中途抢占；模型 gate 在执行前仍检查 keep
- **测试/风险**：T [scripts/ui-idle.test.mjs:10,32](../../scripts/ui-idle.test.mjs#L10)、[ui-model-store.test.mjs:218](../../scripts/ui-model-store.test.mjs#L218)；S 动画持续需画时可长期等待；允许表/4×CPU profile 不等于实机性能保证

<a id="p11"></a>

### P11 分步 CPU construction driver

- **所有者/定位**：[src/prepare/steps.ts:15,27,47](../../src/prepare/steps.ts#L15)
- **编码字段**：generator 内部游标；drive 的 start、live、budgetMs；nextFrame Promise，afterFrame 另有 setTimeout(0)
- **状态、事件与转换**：running → 每次 steps.next；预算耗尽 → waiting-frame → running；done → resolve value；每步之前检验 live
- **失败/取消/终态**：!live → AbortError；generator 抛错原样 reject；未调用 generator.return()，也未自动 dispose 已分配资源；await nextFrame 期间不能立即取消
- **所有权不变量**：driver 仅推进和交出结果，生成中的资源归 generator/调用方；afterFrame 只让出调度，不是加载完成保证
- **测试/风险**：T [scripts/ui-steps.test.mjs:5](../../scripts/ui-steps.test.mjs#L5)；S 中途取消没有强制执行 generator finally，半成品是否可释放要由实际构建者设计；本轮未做泄漏复现

## I：共享图片与 view

<a id="i01"></a>

### I01 ImageStore coordinator / 全局绑定

- **所有者/定位**：[src/prepare/images.ts:135,323](../../src/prepare/images.ts#L135)
- **编码字段**：entries、shared、decodings、images、waiting、kept；模块 current
- **状态、事件与转换**：首次 bindImages(gpu) 创建；后续绑定返回同一 store；按 `kind:pathname+search` 索引；无条目时建 I02，failed 时建新 Shared 复用旧 Source
- **失败/取消/终态**：没有 store.dispose/unbind，resident 的注销句柄也未保存；持续到页面/进程结束
- **所有权不变量**：app 级 store 拥有 Source、base Texture、DecodedImage；consumer view 不拥有共享像素
- **测试/风险**：T [scripts/ui-images.test.mjs:166](../../scripts/ui-images.test.mjs#L166)；K#14 的 host 已改为 `/art/lobby/backdrop.webp` 经映射获取，见 [ui-host.test.mjs](../../scripts/ui-host.test.mjs)；S store 的 key 仍不含 origin，绑定也不随新 renderer 自动替换

<a id="i02"></a>

### I02 图片 entry 获取 / 解码 / 重试

- **所有者/定位**：[src/prepare/images.ts:85,154,181](../../src/prepare/images.ts#L85)
- **编码字段**：entry.state(fetching/decoded/failed)、Shared、decoding.result、base/source、images map；decodeImage 的 fetch handle/unwatch
- **状态、事件与转换**：absent → fetching(network/decode) → decoded；失败 → failed-held；下一 acquire/texture/upload barrier 对失败重试，保留 entry+Source 但换 Shared；kept hold 移至新 Shared
- **失败/取消/终态**：last holder → idle 身份校验、移表、release decode/base/image；非当前解码成功 image.release；失败保留可重试状态；底层 image decode 不可中断
- **所有权不变量**：entry 所属 Shared 身份判定防止旧 release 删除新 attempt；每个成功像素只有当前 store 接受或立即释放；同 URL 不同 kind 可各解码一次
- **测试/风险**：T [ui-images.test.mjs:134,152,166,178,201,228,249](../../scripts/ui-images.test.mjs#L134)；S decode 期间 release 只能放开 fetch，最终像素靠 late-result guard 关闭

<a id="i03"></a>

### I03 图片 GPU upload / resident

- **所有者/定位**：[src/prepare/images.ts:145,166,266](../../src/prepare/images.ts#L145)
- **编码字段**：uploadedIn；gpu.generation/available；entry.base；resident release/restore callbacks
- **状态、事件与转换**：decoded+available+未上传本代 → upload base → uploadedIn=g；loss → dispose GPU base、uploadedIn=null、保留像素；restore → enqueue 所有 decoded entry → upload
- **失败/取消/终态**：GPU throw 由 preparation 接住（need 路径）；resident restore 的直接排队不是 Preparation 失败路径；退出 entry → base+image 最终释放
- **所有权不变量**：同 Source 同 sampler 的 view 共享上传；每代以 base 维持缓存；loss 不能关闭 ImageBitmap
- **测试/风险**：T [ui-images.test.mjs:100,115](../../scripts/ui-images.test.mjs#L100)；S restore 队列持有 entry 闭包，upload 只查 state/gen/available，没查 entry 仍在表，释放与 restore 排队交错待核实

<a id="i04"></a>

### I04 调用方 view / 页面 keep hold / 待绑定

- **所有者/定位**：[src/prepare/images.ts:128,250,279](../../src/prepare/images.ts#L128)
- **编码字段**：caller Texture.source/version；kept[key]；waiting[key] 的 view/onLoad
- **状态、事件与转换**：acquire.view 要求 decoded；texture() 立即提供 version=0 view 并建立 app/page hold；解码后所有 waiting view.version=1、onLoad；已 decoded 则微任务通知；重试绑定同 Source
- **失败/取消/终态**：view.dispose 只释放该 view 的 GPU 引用；kept 不随 view.dispose 释放；waiting 在成功解码后清空，失败仍留给 retry
- **所有权不变量**：caller 应 dispose 自己 view；共享 Source 必须仍有 holder；不使用 needsUpdate 增加 Source 版本以避免重复上传
- **测试/风险**：T [ui-images.test.mjs:81,178,249](../../scripts/ui-images.test.mjs#L81)；S waiting 没有 view 卸载的 unsubscribe，晚成功可调用旧 onLoad；通过 texture() 请求过的图会随 kept 常驻

<a id="i05"></a>

### I05 图片 uploaded 屏障

- **所有者/定位**：[src/prepare/images.ts:295,301](../../src/prepare/images.ts#L295)
- **编码字段**：调用瞬间 pending entries 快照、临时 Preparation、outcome/error
- **状态、事件与转换**：allUploaded 检查 available 且所有 entries decoded/uploadedIn=g；uploaded 按快照建 critical needs → 等 settled → cancel 释放临时 holds；成功返回
- **失败/取消/终态**：非 ready 抛出首错误；cancel 不影响 kept；没有独立外部 cancel；后续新增图片不在本次快照内
- **所有权不变量**：它是“已请求到调用时为止”的全 store 屏障，不是每个 surface 私有资源列表；不拥有 consumer view
- **测试/风险**：T [ui-images.test.mjs:100,249](../../scripts/ui-images.test.mjs#L100)；S 任一不相关已请求失败图也能阻塞该次屏障；无 GPU needs 且 context lost 的空快照可直接 ready，调用方仍须用 context guard

## M：GLB、模型仓库、贴图与单局持有

<a id="m01"></a>

### M01 keyedStore coordinator

- **所有者/定位**：[src/run/view/assets.ts:351,362,457](../../src/run/view/assets.ts#L351)
- **编码字段**：闭包 entries Map；make/drop；可选 unit；models/textureEntries 两个实例
- **状态、事件与转换**：acquire(url,lane) 查当前表 → 复用或创建 entry；each 只访问 value 已落表的结果；offerWaiting 在 app 绑定后重提空闲工作
- **失败/取消/终态**：entry 失败移表，下一 acquire 新建；last holder 释放移表；没有容量 LRU、TTL 或独立 shutdown
- **所有权不变量**：保留由 live handles 决定；模型与世界贴图是两套 keyedStore；跨大厅/图鉴/对局共享同一模型 URL
- **测试/风险**：T [scripts/ui-model-store.test.mjs:79,181](../../scripts/ui-model-store.test.mjs#L79)；S cache 本身不会替常驻 holder 限内存，需连同 L02/L03/X08 等看实际常驻量

<a id="m02"></a>

### M02 keyedStore 单 entry

- **所有者/定位**：[src/run/view/assets.ts:330,379,438](../../src/run/view/assets.ts#L330)
- **编码字段**：Shared、fetch、value、dropped、go、size、queued；异步 IIFE
- **状态、事件与转换**：created → fetched → gate → make/parse → value-ready；release fetched 后置 fetch=null；make 完成只有 !dropped 才存 value、resolve
- **失败/取消/终态**：empty 标 dropped、身份移表、释放 fetch、打开 gate、drop 已成值；make 晚完成则直接 drop(value)；错误 live 时移表并 reject
- **所有权不变量**：entry 只拥有 make **成功返回**的 value；make 内部尚未交出的半成品由 make 自清理；共享结果要等最后 holder 才 drop
- **测试/风险**：T [ui-model-store.test.mjs](../../scripts/ui-model-store.test.mjs) 已加入 canonical 准备失败释放/重试；K#13 修复由 model loader 清理尚未移交的 LoadedModel，entry 仍只拥有成功 value，见 M04/M07

<a id="m03"></a>

### M03 模型 CPU parse 入场 gate

- **所有者/定位**：[src/run/view/assets.ts:342,364,410](../../src/run/view/assets.ts#L342)
- **编码字段**：go resolve、size Promise、queued cancel、shared.lane、boundTo
- **状态、事件与转换**：urgent critical/interactive（或已无 holder 的 null）直接通过；其他 lane 读取 glbUnitSize → offer idle；allowlist 拒绝则停在 fetched/gated；升 urgent → go；降 keep → cancel queued；重新背景 → offer
- **失败/取消/终态**：GLB cost proxy 读取错误 reject“不是可读的 GLB”；empty 打开 gate 后 dropped 检查阻止 make；旧 idle unit 执行前再次看 keep
- **所有权不变量**：download-ready 与 parsed-ready 明确分开；keep 不开始新 parse；被拒绝的大模型通常等出发 critical 促动
- **测试/风险**：T [ui-model-store.test.mjs:181,211,218](../../scripts/ui-model-store.test.mjs#L181)、[scripts/ui-idle.test.mjs:10](../../scripts/ui-idle.test.mjs#L10)；S 未绑定 app/一直 keep/大模型没有急迫请求可长期 pending，是准入策略，不是网络失败

<a id="m04"></a>

### M04 GLB load 解析与所有权移交

- **所有者/定位**：[src/game/models/loadGlb.ts:164](../../src/game/models/loadGlb.ts#L164)；仓库接线 [src/run/view/assets.ts:468,508](../../src/run/view/assets.ts#L468)
- **编码字段**：file/data；loader.parseAsync；ModelResources；images plugin；gltf/root
- **状态、事件与转换**：文件名 → ArrayBuffer → validateGlb/references → parseAsync → collect scenes → 选择 root → 返回 LoadedModel；仓库随后 canonicalModel
- **失败/取消/终态**：格式/外部引用/不支持压缩显式抛；parse 失败等待 EmbeddedTextures.dispose；无 root 清资源后抛；模型仓库的 loader 在 canonicalModel 抛错时 dispose 已解析模型，再抛出原错误；不接受 AbortSignal，取消在外层处理晚结果
- **所有权不变量**：GLB 自包含边界在 loader 前；LoadedModel 成功返回才交给上层；decoded image 的关闭由 EmbeddedTextures，GPU 对象由 ModelResources
- **测试/风险**：T [scripts/native-platform.test.mjs:34](../../scripts/native-platform.test.mjs#L34)（真实带纹理 rig）、[ui-model-store.test.mjs](../../scripts/ui-model-store.test.mjs)（共享缓存与 canonical 失败清理）；K#13 原复现保留，当前有带内嵌图片的失败/重试定义；未逐项重测所有 validator 分支

<a id="m05"></a>

### M05 内嵌图片去重 / 纹理插件生命周期

- **所有者/定位**：[src/game/models/embedded-textures.ts:45,55,90](../../src/game/models/embedded-textures.ts#L45)
- **编码字段**：#images Map<sourceIndex,Promise<DecodedImage>>；#textures Set；parser
- **状态、事件与转换**：未见 source → 创建 decode Promise；相同 source 共享像素；每个 texture definition await source 后建独立 Texture/sampler，记录 association；dispose 等当前 images 全 settled 再释放
- **失败/取消/终态**：某图失败 Promise 缓存在本 parser，靠整次 load 重来；dispose 对 reject 分支不取像素；成功图 close/release，纹理 dispose，集合 clear
- **所有权不变量**：同 GLB image source 的像素解码一次；Texture 可多个；失败时其他并行图片的晚成功也必须被释放
- **测试/风险**：T [native-platform.test.mjs:34](../../scripts/native-platform.test.mjs#L34) 间接；S 无 disposed flag/停止新 loadTexture 的门，dispose 假定 parser 不继续新增工作；data URI fetch 已由 validateReferences 限制

<a id="m06"></a>

### M06 LoadedModel GPU / CPU 管理器

- **所有者/定位**：[src/game/models/loadGlb.ts:117,149,157,192](../../src/game/models/loadGlb.ts#L117)
- **编码字段**：geometries/materials/textures/skeletons/instances Sets；disposed flag；LoadedModel.root/animations
- **状态、事件与转换**：collect 建所有权清单；可重复 releaseUploads → 清 GPU 上传但保留 CPU 对象；dispose 首次标记并 releaseUploads；LoadedModel.dispose 另发起 plugin dispose
- **失败/取消/终态**：ModelResources.dispose 幂等；LoadedModel 的 images.dispose 是 fire-and-forget；没有阻止 dispose 后 root 再被调用者使用
- **所有权不变量**：普通完整 dispose 与 context-loss upload release 是不同动作；共享 canonical 不能由 clone consumer 完整销毁
- **测试/风险**：T [native-platform.test.mjs:34,61](../../scripts/native-platform.test.mjs#L34)；S ModelResources 使用 instance.dispose，不是通用 releaseUploads 的纯事件方案，对有 morphTexture 的 instanced GLB 恢复需单独核实；本轮未执行

<a id="m07"></a>

### M07 canonical 尾骨与按高度烘焙 cache

- **所有者/定位**：[src/run/view/assets.ts:477,499,503,589](../../src/run/view/assets.ts#L477)
- **编码字段**：canonical.model/tail；instances Map<height,InstanceSource>；bakedSources WeakMap
- **状态、事件与转换**：parse-ready → rigTail 一次 → canonical-ready；首次 instance(height) 验证单网格单材质并 bake，成功后存；同高度复用；loss 仅 dispose baked GPU geometry；最后 owner drop 全 dispose
- **失败/取消/终态**：rigTail 抛错发生在 entry 接收 value 前，由外层 model loader dispose LoadedModel 并重抛；instance 校验失败不缓存结果；最终 disposeCanonical 释放所有 baked geometry 和 LoadedModel
- **所有权不变量**：canonical 属仓库；尾骨/skin 属性在 clone 前准备；baked geometry 属 canonical，材质仍借原模型；height key 精确匹配
- **测试/风险**：T [ui-model-store.test.mjs](../../scripts/ui-model-store.test.mjs) 定位 K#13 的准备失败清理与成功持有；S 当前 canonical 初始化不预烘焙，bake 实际在 instance 首次调用，不能把注释“prepare 含 bake”当已发生

<a id="m08"></a>

### M08 consumer skeleton instance

- **所有者/定位**：[src/run/view/assets.ts:561,622](../../src/run/view/assets.ts#L561)
- **编码字段**：clone root、skeletons Set、克隆 tail；normalisePlayer wrapper
- **状态、事件与转换**：instantiate → 克隆骨架/找 tail → consumer-ready；context loss releaseUploads 清自己 bone texture；dispose 同样清自己的 skeleton；normalise 组装玩家容器
- **失败/取消/终态**：tail 对不上显式抛；dispose 没独立 disposed 标记，依赖 skeleton dispose 可重复；不释放 canonical 共享 geometry/material/texture
- **所有权不变量**：clone 的骨骼/骨纹理由 consumer 拥有；animations、geometry、原材质与贴图共享；canonical holder 必须覆盖 clone 使用期
- **测试/风险**：T [ui-model-store.test.mjs:145](../../scripts/ui-model-store.test.mjs#L145)；S instantiate 本身没有租约，必须搭配外部 Handle；直接拿 canonical 再提前 release 是调用方违约

<a id="m09"></a>

### M09 世界贴图 entry / CPU image

- **所有者/定位**：[src/run/view/assets.ts:515,516,720](../../src/run/view/assets.ts#L515)
- **编码字段**：独立 textureEntries；textureImages WeakMap<Texture,DecodedImage>；Texture 源
- **状态、事件与转换**：fetch → decodeImage(true) → Texture ready → keyedStore held；地面 consumer 设置 RepeatWrapping/anisotropy；loss texture.dispose 保留像素；last holder texture.dispose + image.release
- **失败/取消/终态**：使用 M02 的 late-result drop/失败移表；CPU decode 无硬中断；没有自己的 uploadedIn
- **所有权不变量**：textureEntries 拥有 Texture 与像素；对局直接共享 Texture（不同于图片 store 的独立 view）；所有 consumer 应使用一致 sampler
- **测试/风险**：T [ui-model-store.test.mjs](../../scripts/ui-model-store.test.mjs) 只直接覆盖模型实例，贴图路径无独立生命周期测试定位；S groundMap 会修改共享 Texture 属性，新增其他 sampler consumer 需守同一契约

<a id="m10"></a>

### M10 模型仓库 GPU resident / renderer 绑定

- **所有者/定位**：[src/run/view/assets.ts:535,551](../../src/run/view/assets.ts#L535)
- **编码字段**：boundTo；app.resident 回调；modelEntries/textureEntries 的 values
- **状态、事件与转换**：首次/换 app bind → 注册 release resident、offerWaiting；同 app 重绑 no-op；loss 遍历 canonical/model/baked/texture releaseUploads；restore 靠后续 draw/warm 重传
- **失败/取消/终态**：无显式 restore 钩子；注册返回的 unregister 未保存；没有 unbind
- **所有权不变量**：仓库负责共享 GPU 数据；run/lobby/codex 各负责自己的 clone 骨纹理；释放上传不移除 entry
- **测试/风险**：T [ui-model-store.test.mjs:181,218](../../scripts/ui-model-store.test.mjs#L181) 用 fake app；S 换 app 后旧 resident 仍注册，且 boundTo 只指向最后 app；代码依赖单应用 renderer 生命周期

<a id="m11"></a>

### M11 loadRunAssets 聚合与 RunAssets 持有

- **所有者/定位**：[src/run/view/assets.ts:696](../../src/run/view/assets.ts#L696)；释放 `:704,803,811`
- **编码字段**：handles[]、instances[]、abort signal listener；Promise.all；players/enemies/props/scenery/stations/ground
- **状态、事件与转换**：acquiring-all → fetched/parsed-all → signal.throwIfAborted → 每玩家每形态 clone、按高度 bake → RunAssets usable；自身 releaseUploads 只管 instances
- **失败/取消/终态**：任一失败 remove abort listener、release 所有；abort 同步触发 release，晚 make 由 M02 清；返回的 dispose 移监听、释放 instances/handles；预先已 aborted 的 signal 要等 Promise.all 后 throw
- **所有权不变量**：每位玩家一套可独立挂载的骨架；stageShared 与进化线 canonical 由各 handle 共同持有；RunAssets 不拥有 canvas/GPU context
- **测试/风险**：T [ui-model-store.test.mjs:79,145](../../scripts/ui-model-store.test.mjs#L79) 只覆盖下层；未定位完整 loadRunAssets 失败/abort 集成测试；S 成功后 abort 再 dispose 可重复释放骨架但 handles 幂等；没有聚合 timeout

## L：大厅 prefetch 与出发（不是 GPU readiness）

<a id="l01"></a>

### L01 首屏后开放的 prefetch coordinator

- **所有者/定位**：[src/run/prefetch.ts:44,74,82](../../src/run/prefetch.ts#L44)；调用方 [src/app/session.ts:408](../../src/app/session.ts#L408)
- **编码字段**：report|null（也作 opened flag）、wanted；无 timer
- **状态、事件与转换**：closed：select 仅记录 wanted；host.revealed 后 open(report)，首开触发 hold(wanted)；已 open 的 select 立即 hold；再次 open 只换 report
- **失败/取消/终态**：没有 close/reset/dispose；select 先 cancel departed；open 失败不单列错误状态
- **所有权不变量**：首屏 fonts/images 的链路先用，后续 run 预取才启动；report 与 wanted 是模块生命周期，不是 LobbyScene 生命周期
- **测试/风险**：T [ui-prepare.test.mjs:297](../../scripts/ui-prepare.test.mjs#L297) 是同类流程夹具，未直接调用本模块；S host 重建会保留 opened/wanted/旧 holds，不能视作全新冷启动

<a id="l02"></a>

### L02 按 stage 保温共享集

- **所有者/定位**：[src/run/prefetch.ts:25,39,52,90,100](../../src/run/prefetch.ts#L25)
- **编码字段**：shared Map<StageId,Preparation>；settled watcher
- **状态、事件与转换**：首次 stage 建 background preparation：loadingArt、所有区域共享模型/地面、run SFX decoded、run/boss 音乐 bytes；再次该 stage retry failed；ready 后继续持有
- **失败/取消/终态**：不同 stage 永不在这里淘汰/取消；watch 只订阅创建时的 settled Promise，retry 新 attempt 没重新挂同 watcher
- **所有权不变量**：stage preparation 的所有 handle 保持 canonical/图片/音频存活；audio soft failure 仍视为 need fulfilled；此 preparation 没 context/gpu need
- **测试/风险**：T [ui-prepare.test.mjs:297](../../scripts/ui-prepare.test.mjs#L297) 仅间接；S 访问多地图后 shared 集合累积保温；retry 再失败不触发原 settled watcher；“预取完成”不能宣称 GPU warm 完成

<a id="l03"></a>

### L03 当前 / 最近进化线 holder 轮换

- **所有者/定位**：[src/run/prefetch.ts:47,53,66,113,129](../../src/run/prefetch.ts#L47)
- **编码字段**：current、recent（各 starter+preparation）
- **状态、事件与转换**：新选择=recent → 交换 current/recent；新第三条线 → cancel 老 recent、current 下沉为 recent、新建 current；current=background、recent=keep；current failed 可 retry
- **失败/取消/终态**：recent 退出窗口后 cancel；当前 ready 继续持有；state(starter) 只报告这两个 hold 的 ready/network 进度
- **所有权不变量**：最多两条进化线的 prefetch hold；不取消别的大厅舞台或 run 同 URL 的 holder；keep 保已完成工作、不启动新工作
- **测试/风险**：T [ui-prepare.test.mjs:297](../../scripts/ui-prepare.test.mjs#L297) 同类 hold 模拟；S 本模块限“两条线”不等于总 canonical cache 限两条，LobbyScene.held 是另外一台机器

<a id="l04"></a>

### L04 出发 revision / critical hold

- **所有者/定位**：[src/run/prefetch.ts:57,63,150](../../src/run/prefetch.ts#L57)
- **编码字段**：departures 递增计数；departed Preparation<Departure>；starter/difficulty/stage/n
- **状态、事件与转换**：depart 先 cancel 旧 departure，捕获新 revision、建 critical shared+line+audio preparation；之后 select 或新 depart supersede
- **失败/取消/终态**：cancelled/failed/ready 同 P06；没有 GPU phase；本函数不直接启动 run，也没有自带 ready 后释放
- **所有权不变量**：出发 hold 与大厅保温、run 自持 handle 分立；ready 后保留资源直到下一 select/depart
- **测试/风险**：T [ui-prepare.test.mjs:266,297](../../scripts/ui-prepare.test.mjs#L266) 是基础设施契约；S 外部必须用当前 revision/导航生命周期决定提交，不能只 await 任意旧 settled

## R：renderer、GPU generation、resident、队列与分辨率

<a id="r01"></a>

### R01 AppRenderer/context generation

- **所有者/定位**：[src/rendering/app-renderer.ts:74,122,230,408](../../src/rendering/app-renderer.ts#L74)
- **编码字段**：#generation、#available、#disposed、#previous、surface/#stop；#listeners
- **状态、事件与转换**：构造 available(g0)；lost → unavailable、g++、清 warm tasks、query lost、program retention dispose、residents.release、notify；restored → 新 retention/计时器、configure、residents.restore、invalidate、available、previous=null、notify
- **失败/取消/终态**：dispose 幂等 stop loop → worldPass/programs/renderer/surface dispose；没有自身 failed 枚举；frame 在 disposed/unavailable 时返回 false
- **所有权不变量**：context 仅由 app/surface 拥有；loss 间不推进 clients，restore 不补算失去的 wall time；generation 的变化在 loss，不在 restore
- **测试/风险**：T [scripts/three-external-context.test.mjs:200](../../scripts/three-external-context.test.mjs#L200)（EGL/native context 替换）；[scripts/ui-images.browser.mjs:22](../../scripts/ui-images.browser.mjs#L22)（实际AppRenderer/browser脚本）；[scripts/three-context.browser.mjs:2](../../scripts/three-context.browser.mjs#L2)只测Three底层lost/restore，均未跑；S resident 抛错可中断后续 hook/notify；dispose 不设置 available=false、不清全资源 holder

<a id="r02"></a>

### R02 frame client 槽位与脏帧呈现

- **所有者/定位**：[src/rendering/app-renderer.ts:164,176,184,283](../../src/rendering/app-renderer.ts#L164)
- **编码字段**：#world/#ui/#input、#invalid/#previous、worldPass.stale、#display、#lastInput、#pinned；计数/stats
- **状态、事件与转换**：setUi/setWorld 替换当前槽并 invalid；release 只在仍为该身份时移除；每帧 warm→input→world.advance→ui.advance；有 worldChanged/stale 时重绘 world target；其他画面变化只拷贝 world+绘 UI；全静止进入 idle；debug.pin(number)切固定world密度、pin(null)回controller（固定值只上限截到canvas）；display大小变化reset，pixelRatio变化重建policy
- **失败/取消/终态**：无 client 自有资源回收，release 只是注销；advance/draw 抛错本层不捕获；resume 清 delta 历史和 DRS 窗口
- **所有权不变量**：输入先于模拟；UI 与 world 独立 advance；冻结 world 复用已有 target；旧 client 的 release 不能注销新 client
- **测试/风险**：T [three-external-context.test.mjs:200](../../scripts/three-external-context.test.mjs#L200) 部分；K#1 已由 app/session 的 host error 回调 dispose 会话，注销 world/input/UI，再交平台错误表面；[ui-run-session.test.mjs](../../scripts/ui-run-session.test.mjs) 为会话夹具，不是所有 renderer 失败路径验收

<a id="r03"></a>

### R03 warm GPU task queue

- **所有者/定位**：[src/rendering/app-renderer.ts:87,155,401,408](../../src/rendering/app-renderer.ts#L87)
- **编码字段**：#tasks FIFO、frame start、8ms WARM_BUDGET_MS
- **状态、事件与转换**：enqueue → queued；可绘帧 #runTasks 持续 shift 至同步预算用尽；执行 void task()；loss 清 queued；已开始的 Promise 继续异步
- **失败/取消/终态**：队列不 await、不提供 cancel/result/error handler；丢弃任务由有 generation 认识的 owner 重新发；dispose 后队列不会再消费
- **所有权不变量**：队列只负责入场，不拥有 task 中的资源或结果正确性；每个 task 必须自行处理 rejection、代际和取消
- **测试/风险**：T [ui-prepare.test.mjs:181,219,239](../../scripts/ui-prepare.test.mjs#L181) 使用 fake queue 测 owner guard，不覆盖真实队列的所有行为；S 8ms 限制同步入场，不限制 await 之后的主线程工作或异步并发量

<a id="r04"></a>

### R04 resident 注册与 GPU/CPU 分离

- **所有者/定位**：[src/rendering/app-renderer.ts:159,416,425](../../src/rendering/app-renderer.ts#L159)；通用遍历 [src/rendering/releaseUploads.ts:20](../../src/rendering/releaseUploads.ts#L20)
- **编码字段**：residents Set；unregister 闭包；每次 traversal 的 released Set；各 owner 的 CPU object refs
- **状态、事件与转换**：register → active resident；loss release GPU；restore 可选 restore；unregister → 不再通知；通用遍历 dispose geometry/material/texture/skeleton/shadow、实例只派 dispose event
- **失败/取消/终态**：unregister 不释放业务资源；通用函数不拆树不关闭图片；没有跨 owner 的全局去重（仅一次 traversal 内）；app.dispose 不逐一执行 resident.release
- **所有权不变量**：off-tree 纹理、shader closure 贴图必须 owner 单独覆盖；正常销毁与 lost uploads 两条路径不可互换
- **测试/风险**：T [native-platform.test.mjs:34](../../scripts/native-platform.test.mjs#L34) 仅 LoadedModel 路径；[three-external-context.test.mjs:200](../../scripts/three-external-context.test.mjs#L200) 部分真实 context；S 无专门覆盖全部 releaseUploads 对象类型的已定位测试；需 owner 完整列出树外资源

<a id="r05"></a>

### R05 world shader program retention

- **所有者/定位**：[src/rendering/app-renderer.ts:91,124,203,235,415,421](../../src/rendering/app-renderer.ts#L91)
- **编码字段**：#worldPrograms retention object；scene material、customDepth/DistanceMaterial
- **状态、事件与转换**：本代 empty → retain 暖过的材料变体 → pinned；run teardown 后仍持有；loss dispose retention；restore 新对象；app dispose 最终释放
- **失败/取消/终态**：无 Promise/独立失败态；compile/warm 是否成功由调用者保证；不 retain 整个 renderer program 列表
- **所有权不变量**：shader program 可跨 run 保温但不跨 context generation；material/scene 的拥有者与 program retention 拥有者分开
- **测试/风险**：T [three-external-context.test.mjs:13,145](../../scripts/three-external-context.test.mjs#L13)；S 真实保留计数机制在打补丁的 Three 中，本表只盘项目调用和已定位测试，未重审完整依赖实现

<a id="r06"></a>

### R06 world target / cached picture

- **所有者/定位**：[src/rendering/world-pass.ts:47,86,92,101,115,125](../../src/rendering/world-pass.ts#L47)
- **编码字段**：#target、#geometry/#material/#scene/#camera、#stale
- **状态、事件与转换**：new/invalidate/resize/loss → stale；fit 同尺寸 no-op；render 成功 → fresh；fresh 只 copy；inTarget 进入世界 target 后 finally 回 canvas、恢复透明 clear
- **失败/取消/终态**：draw 抛错则 stale 不被清；release/dispose 清 GPU 并 stale=true；无最终 disposed guard
- **所有权不变量**：WorldPass 拥有离屏 target 与 copy triangle；display-encoded RGBA8 图片由 world 材料产出；UI 不重做 world 渲染
- **测试/风险**：T [three-external-context.test.mjs:200](../../scripts/three-external-context.test.mjs#L200) 间接；S inTarget 恢复的是项目约定 canvas/default state，不是任意调用者的原 target 全状态

<a id="r07"></a>

### R07 GPU query 生命周期

- **所有者/定位**：[src/rendering/gpu-timer.ts:14](../../src/rendering/gpu-timer.ts#L14)
- **编码字段**：#ext|null、#open|null、#pending[{query,at}]；MAX_PENDING=8
- **状态、事件与转换**：unsupported no-op；begin → open query；end → pending；poll 按先后次序查询 available → sink(ms,at)+delete；disjoint 丢 pending；超8项删除最老；loss 清 open/pending
- **失败/取消/终态**：createQuery=null 静默不计时；无专门 dispose；lost 不 delete 已死亡句柄；restored 重新获取 extension（AppRenderer 实际换新 Timer）
- **所有权不变量**：不嵌套 query；不 finish/readPixels 阻塞测量；旧代结果不喂本代；pending 资源有数量上限
- **测试/风险**：未定位 GpuTimer 专项测试；DRS tests 注入数值不测 query；S sink 抛错、begin 后 draw 抛错、正常 app dispose 的未回收 query 路径需依实际 GL 宿主核实

<a id="r08"></a>

### R08 DRS controller：带 GPU timer 的子状态

- **所有者/定位**：[src/rendering/world-resolution.ts:80,106,124,143,159,203](../../src/rendering/world-resolution.ts#L80)
- **编码字段**：#ratio、window(start/gpu/cpu/frames/misses)、#lastFrame、#overWindows/#underSince/#holdUntil、#severeUsed/#beforeDecrease/#failedDecreases、log
- **状态、事件与转换**：采样≥500ms且≥8 world frames → 评估；有≥4 GPU samples 走 timer；连续过载两窗下降，严重过载单次双降；下降后冷却并评价收益；3s GPU+CPU 余量才上升；两次无收益停降
- **失败/取消/终态**：ratio clamp min/max；pause>1s断窗口/连续性；显式 reset 清历史但保留 ratio；旧 window GPU 数据丢；无 failed/dispose 终态
- **所有权不变量**：只有绘 world 的帧触发决策，UI 只重画不调分辨率；display/device 改变可新建 policy；日志最多240窗
- **测试/风险**：T [scripts/ui-rendering.test.mjs:26,42,56,66,72,96,107,123](../../scripts/ui-rendering.test.mjs#L26)；S 阈值为 provisional，未重新标定真手机；冻结 gap 与 reset 清理的字段不完全相同

<a id="r09"></a>

### R09 DRS controller：无 timer 的试降子状态

- **所有者/定位**：[src/rendering/world-resolution.ts:91,185](../../src/rendering/world-resolution.ts#L91)
- **编码字段**：同 R08 窗口；#trial{missShare,from}、#noTrials、#overWindows/#holdUntil
- **状态、事件与转换**：GPU samples 不足 → withoutTimer；两窗 miss>20% 且 CPU 余量 → 试降一档；冷却后的下一窗评价；改善>10% 保持（后续仍可再试）；否则 revert 到 from、noTrials=true
- **失败/取消/终态**：reset 允许重新试；没有自动向上恢复路径（除试降回滚）；与 R08 是同一 controller 的模式，不是第二套 target
- **所有权不变量**：不能无证据一直减清晰度；noTrials 只约束无 timer 分支；是否进入本模式按本窗样本而非硬件永久支持判断
- **测试/风险**：T [ui-rendering.test.mjs:80,114](../../scripts/ui-rendering.test.mjs#L80)；S GPU timing 断续会切模式，共享过载/冷却字段，不应画成互不相干两套完整机器

## F：字体（font set / metrics / page entry / residency / revision 分开）

<a id="f01"></a>

### F01 app 字体集合 cache

- **所有者/定位**：[src/ui/gpu/fonts.ts:855,859](../../src/ui/gpu/fonts.ts#L855)
- **编码字段**：pagedSets Map<base.href,{fonts,report}>；绑定 gpu adapter
- **状态、事件与转换**：base 未见 → createPagedFonts；同 base 复用集合，report 更新给最新 host；任一 report error 且 entry 仍当前 → 删除 cache、fonts.dispose；下次 host 重建
- **失败/取消/终态**：失败回调身份保护不删新的 set；正常 host dispose 未驱逐 set；无全局 shutdown
- **所有权不变量**：uikit 按 source function 缓存 Font，所以函数身份稳定；集合 app-lifetime；base.href key 不含 app identity
- **测试/风险**：T [ui-font-revision.test.mjs:340](../../scripts/ui-font-revision.test.mjs#L340) 测 metrics 错误，不直接覆盖 pagedSets 换 host；S 同 base 换 renderer 仍引用首个 adapter，需保持单 app 的生命周期假设

<a id="f02"></a>

### F02 metrics / 字体表构建 pipeline

- **所有者/定位**：[src/ui/gpu/fonts.ts:539,650,669,710,724,739,805](../../src/ui/gpu/fonts.ts#L539)
- **编码字段**：infos Promise；四个 built{start,font}；metrics Promise；tables/uikitFonts Maps；metricsIn
- **状态、事件与转换**：core manifest(no-cache) → pinned base manifest/key 对账 → 各字体 core/base JSON hash 验证 → merge → 注册稳定 page textures → uikit callback 建 Font → metrics ready
- **失败/取消/终态**：infos 错误 report 并使 metrics reject；built 字体 Promise 只有 resolve，没有自身 reject；无 AbortController/retry；新 set 才重新启动
- **所有权不变量**：metrics-ready 只表示字形表/Font 可用，不表示任何 atlas page 已解码/上传；JSON/hash/尺寸内容是信任边界
- **测试/风险**：T [scripts/ui-fonts-paged.test.mjs:58,64,96,120](../../scripts/ui-fonts-paged.test.mjs#L58)、[ui-font-revision.test.mjs:340](../../scripts/ui-font-revision.test.mjs#L340)；S set.dispose 不取消进行中的 metrics 工作，晚到仍可注册页/回调；uikit callback 永不来会一直 pending

<a id="f03"></a>

### F03 PageRegistry coordinator / core holds / base LRU

- **所有者/定位**：[src/ui/gpu/fonts.ts:290,320,326,341,417](../../src/ui/gpu/fonts.ts#L290)
- **编码字段**：pages；#decodes/#decoding/#images；#held；#clock/lastUsed；#unregister
- **状态、事件与转换**：hold(keys,lane) 取得长期 CPU handles；acquire 临时持有；last holder：pending abort→absent；decoded core 零 holder 仍保留；decoded base 无人持有时加入候选，超过64个按 lastUsed 驱逐
- **失败/取消/终态**：evict setPageImage(null)、image.release、删 decode、absent/uploadedIn=null；dispose **只** unregister 和 release #held，没有清 pages/images/decoded core/所有外部 acquisitions
- **所有权不变量**：base 上限是“无人持有的 decoded 页”64，不是总页数64；core app 常驻；base 正在显示不能淘汰；stable Texture identity 不随逐出更换
- **测试/风险**：T [ui-font-revision.test.mjs:239,250](../../scripts/ui-font-revision.test.mjs#L239)（dispose 用尚未完成页）；未定位>64页 LRU/已解码 dispose 专项；S 实际终止范围比“失败集合不留任何页”的注释窄，不能声称 CPU 图像全关闭

<a id="f04"></a>

### F04 单字体页 decode entry

- **所有者/定位**：[src/ui/gpu/fonts.ts:256,365,608](../../src/ui/gpu/fonts.ts#L256)
- **编码字段**：PageRecord.state、#decodes[key] Shared、#decoding result、#images；download+watch；hash/decoded dimensions
- **状态、事件与转换**：absent → fetching → 验 hash → decodeImage(false) → 验尺寸 → decoded；失败 → failed；下一 decoded(key) 创建新 Shared 重试；每次访问 lastUsed++
- **失败/取消/终态**：pending 无 holder release decoder、删表、state=absent；非当前 decode 成功立即 image.release；hash失败不 decode；尺寸失败先 release image；失败不会填默认字页
- **所有权不变量**：page texture 稳定；CPU像素由 registry 唯一持有；hash+尺寸均符合才交付；fetch 先释放只是释放字节，不等于关闭像素
- **测试/风险**：T [ui-fonts-paged.test.mjs:64](../../scripts/ui-fonts-paged.test.mjs#L64)（校验函数）、[ui-font-revision.test.mjs:198,211,239,261](../../scripts/ui-font-revision.test.mjs#L198)；S 这些 registry tests 用 fake decoder，不全覆盖真实 hash/decode 组合失败；core #held 失败 hold 不像 image.kept 一样迁移到新 Shared

<a id="f05"></a>

### F05 单页 GPU upload / residency

- **所有者/定位**：[src/ui/gpu/fonts.ts:330,409,444,453](../../src/ui/gpu/fonts.ts#L330)
- **编码字段**：uploadedIn、gpu.available/generation；page.texture；resident hooks
- **状态、事件与转换**：decoded → need 的 GPU upload → uploadedIn=g；resident(keys)=available && 全页 decoded 且本代；loss dispose 已上传 Texture、清 uploadedIn，保留 image；restore enqueue 所有 decoded（包括闲置保留页）
- **失败/取消/终态**：private upload 自身查 decoded/gen，由调用路径提供 available guard；release acquisition 不等于卸载 GPU；base evict 才解绑像素
- **所有权不变量**：一个 page 每 generation 一份有效上传；resident 是随 context 变化的谓词，不能用曾经 resolve 的 acquisition 永久替代
- **测试/风险**：T [ui-font-revision.test.mjs:167,179](../../scripts/ui-font-revision.test.mjs#L167)；S restore 队列与 registry.dispose 交错无 disposed guard；实际清理范围见 F03

<a id="f06"></a>

### F06 页面集合 acquisition

- **所有者/定位**：[src/ui/gpu/fonts.ts:346](../../src/ui/gpu/fonts.ts#L346)
- **编码字段**：临时 Preparation，needs 为每 page 的 decode+upload；result Promise
- **状态、事件与转换**：acquire(keys,lane) → prepare pending → all pages CPU/GPU ready → resolve；release→preparation.cancel
- **失败/取消/终态**：failed 报 report 后 reject 对应 Error；cancelled 也 reject，但无 error 时生成普通字体页失败 Error（并非直接保留 AbortError）；内部 catch 防无观察者 rejection
- **所有权不变量**：acquisition 持有 pages 到 release，ready 后不会自释放；它拥有租约，不拥有 Texture/image
- **测试/风险**：T [ui-font-revision.test.mjs:198,211,239](../../scripts/ui-font-revision.test.mjs#L198)；S 取消异常类别与 PageAcquisition 的上层 stage.release 不同，后者显式拒绝 AbortError

<a id="f07"></a>

### F07 RevisionGate latest-wins 与 committed hold

- **所有者/定位**：[src/ui/gpu/fonts.ts:192,213,237](../../src/ui/gpu/fonts.ts#L192)
- **编码字段**：#latest、#pending、#held、#disposed、commit/failed callbacks
- **状态、事件与转换**：set(value,keys) revision++；先 acquire 新、再 release 旧 pending；resident 可同步 commit，否则等 result；commit 要 revision、pending 身份、!disposed 三者均符合；替换 held 时释放上次提交租约
- **失败/取消/终态**：latest 失败 release pending、通知 failed，旧 committed 保留；旧失败/成功忽略；dispose 幂等 release pending+held，不再 commit
- **所有权不变量**：老字串/界面一直完整显示到新页全 resident；先获取再放旧避免共同页加载被打断；committed value 必须持续持有其页
- **测试/风险**：T [ui-font-revision.test.mjs:123,132,143,151,167,223](../../scripts/ui-font-revision.test.mjs#L123)；S commit 是一次性判断，之后 context loss 的重新放行交给 host/registry，不自动重新执行 commit

<a id="f08"></a>

### F08 每 UiStage 的 ready waiters / release

- **所有者/定位**：[src/ui/gpu/fonts.ts:770,800,818,829](../../src/ui/gpu/fonts.ts#L770)
- **编码字段**：holds WeakMap<stage,Hold>；Hold.gate、waiters{revision,resolve,reject}；全局 revisions
- **状态、事件与转换**：ready 先 await metrics，再收该 stage 当前 Text 页（非first还加全部core）→ new revision waiter→gate.set；commit(r) resolve 所有 <=r 的 waiters；readyNow 独立查询 metricsIn/resident
- **失败/取消/终态**：latest失败拒绝此 stage 全 waiters；release 找到 hold 后 gate.dispose、删 WeakMap、拒绝 waiters AbortError；fonts.dispose 只转 registry.dispose，不遍历 stages
- **所有权不变量**：stage 生命周期 owner 必须 fonts.release(stage)；stage identity 不等于其 root 当前文字内容，内容更新靠新 ready revision
- **测试/风险**：T [ui-font-revision.test.mjs:308,326,340](../../scripts/ui-font-revision.test.mjs#L308)；S `ready` 尚在 await metrics 时 release 找不到 hold，晚 metrics 仍能新建 hold；现有释放测试先 await metrics，未覆盖此窗口

<a id="f09"></a>

### F09 core CPU预取 holder

- **所有者/定位**：[src/ui/gpu/fonts.ts:840](../../src/ui/gpu/fonts.ts#L840)
- **编码字段**：metrics.then 后 registry.#held；没有 started/disposed flag
- **状态、事件与转换**：prefetch 等 metrics 后 hold(all core,background)，仅 CPU decode；每次调用再次加 holds
- **失败/取消/终态**：metrics失败预取静默不做（原pipeline已报告）；dispose只有F03范围；没有自行终止等待metrics的callback
- **所有权不变量**：core预取不等于ready/uploaded；held长期保留直到registry.dispose
- **测试/风险**：T [ui-font-revision.test.mjs:250,261](../../scripts/ui-font-revision.test.mjs#L250)直接测试hold而非prefetch链；S重复调用增加handles；host用prefetched限制首屏一次；dispose后metrics晚到仍可hold

<a id="f10"></a>

### F10 missing-glyph诊断记忆

- **所有者/定位**：[src/ui/gpu/fonts.ts:16,732](../../src/ui/gpu/fonts.ts#L16)
- **编码字段**：每Font包装闭包reported Set<char>；被包装的getGlyphInfo
- **状态、事件与转换**：getGlyphInfo返回缺字且未reported→记录并log codepoint/font；同字后续不报；正常glyph原样返回
- **失败/取消/终态**：缺字仍返回UIKit缺字glyph，不进入字体load失败；无reset/dispose，随Font生命周期
- **所有权不变量**：诊断集合不拥有atlas页；输入字符边界由unsupportedIn另检，不可把日志当拒绝导入
- **测试/风险**：T [scripts/ui-fonts.test.mjs:96](../../scripts/ui-fonts.test.mjs#L96)；无新增特定风险

## A：音频（wish / held track / applying / playing 分开）

<a id="a01"></a>

### A01 audio singleton / context / enabled 生命周期

- **所有者/定位**：[src/audio/engine.ts:238,294,327,660,682,696](../../src/audio/engine.ts#L238)
- **编码字段**：instance；offline decoder；ctx?、buses?、enabled；runtime.activateAudio 回调；dispose Promise
- **状态、事件与转换**：getAudio 首次创建；可先离线解码而无播放 context；Web手势激活（native在 [src/platform/native/main.ts:22](../../src/platform/native/main.ts#L22) 同步激活）start一次构建buses/context，再applyMusic；enabled 控制整个 context resume/suspend；sfx 发现非running尝试resume；dispose close context
- **失败/取消/终态**：start/resume/suspend 的 rejection 不由 engine 统一 report；dispose 清 turn、wanted/player hold、await close；没有 disposed flag，ctx/buses/instance 没清空，外部 entries/holds 不统一释放
- **所有权不变量**：页面共享一引擎；声音开关与资源持有独立；context close 不等于所有 AudioBuffer/Blob 引用释放；离线 decoder 与实时 context 不同
- **测试/风险**：T [scripts/ui-audio.browser.mjs:16](../../scripts/ui-audio.browser.mjs#L16) 为手动浏览器脚本；[scripts/audio.test.mjs](../../scripts/audio.test.mjs) 不测引擎生命周期；S dispose 后 getter 可返回 closed engine，手势与晚异步请求没有 terminal guard；共享app session.dispose不调用audio.dispose；native整体close会在 [src/platform/native/main.ts:38](../../src/platform/native/main.ts#L38) 调用，因此其终止边界在应用外层

<a id="a02"></a>

### A02 bank manifest 单飞 / 重试

- **所有者/定位**：[src/audio/engine.ts:255,263,333](../../src/audio/engine.ts#L255)
- **编码字段**：bank?、manifest?:Promise<BankJson>
- **状态、事件与转换**：absent → resources.read(assetUrl('/audio/bank.json')) → JSON parsed → bank assigned、applyMusic、Promise resolved；并发 hold/prefetch 共享 manifest
- **失败/取消/终态**：HTTP/JSON 异常 reject；catch 清 manifest=undefined，下次请求重试；无 fetch handle、lane、abort；单个 name 缺失交给 filesOf 局部失败
- **所有权不变量**：manifest 仅描述文件，不拥有 decoded buffers；加载 bank 不等于声音已存在；页面内成功 manifest 常驻
- **测试/风险**：T [ui-audio.browser.mjs:18](../../scripts/ui-audio.browser.mjs#L18) 间接；未定位 manifest fail/retry engine 单测；S read 绕 fetchAsset 调度，所有名字释放也不会中止 bank read；缺字段结构没有完整 schema 验证

<a id="a03"></a>

### A03 单 named sound/track decoded entry

- **所有者/定位**：[src/audio/engine.ts:256,350,402](../../src/audio/engine.ts#L256)
- **编码字段**：entries Map<AudioName,Shared<void>>；samples/tracks；abandon Map；failed Set；每 entry current lane、decodes[]
- **状态、事件与转换**：acquire name → entry pending → 等 manifest → 多 files decode → all success 存 samples/track → Shared.done；多持有者复用；lane 提升传播当前和之后才启动的 files
- **失败/取消/终态**：fetch/decode/name missing 失败：放开其余解码、failed.add、report、**Shared.resolve**，本次持有期间静音；仅最后 release 删除 entry/failed/sample/track；晚完成 live identity 不符则不提交
- **所有权不变量**：音频是 soft need；“handle成功”只承诺准备尝试结束，不承诺有声音；held decoded buffer 与正在播放 source 自持 buffer 不同
- **测试/风险**：T [ui-audio.browser.mjs:18–45](../../scripts/ui-audio.browser.mjs#L18) 检查共享/最后释放；[scripts/ui-audio-holders.test.mjs:36,61](../../scripts/ui-audio-holders.test.mjs#L36) 静态 holder 覆盖；S 同次持有失败无自动 retry，重复 acquire 会沿用静音 done，需所有 holder 退出后再建

<a id="a04"></a>

### A04 单 audio file 下载 / decode

- **所有者/定位**：[src/audio/engine.ts:214](../../src/audio/engine.ts#L214)
- **编码字段**：download Handle<Blob>；result Promise；offline decoder
- **状态、事件与转换**：fetchAsset→Blob.arrayBuffer→decodeAudioData→AudioBuffer；lane forwarding；解码无须真实 context running
- **失败/取消/终态**：网络错误包装文件 URL，decode 错误另包装；成功/失败都释放 download；release 只放开网络 handle，已开始 decode 不可中断；完成能否采用由 A03 identity 判断
- **所有权不变量**：此层持有 bytes 到 decode settled；AudioBuffer 无显式 dispose，靠取消提交/Map 和 source 引用回收
- **测试/风险**：T engine browser 只有正常路径间接；[audio.test.mjs](../../scripts/audio.test.mjs) 不覆盖 decode；S 取消后离线工作仍可消耗 CPU，但不会因此自动写回当前 entry

<a id="a05"></a>

### A05 音乐 bytes-only prefetch handle

- **所有者/定位**：[src/audio/engine.ts:414](../../src/audio/engine.ts#L414)
- **编码字段**：downloads[]、released、current lane、ready Promise
- **状态、事件与转换**：manifest pending → 对每 name filesOf→fetchAsset holds → bytes ready-held；设置 lane 在 manifest 前也被记住；后续 decode 可复用仍持有的 fetch Blob
- **失败/取消/终态**：name missing report后继续；任一 download 失败 aggregate catch report且 result fulfilled；release 标记并释放下载；manifest 晚到 sees released 不再开下载；释放不会 reject result
- **所有权不变量**：prefetch 只持压缩文件，绝不创建 decoded tracks；与 A03 以 URL fetch 层共享，不以 name entry 共享
- **测试/风险**：T [ui-audio.browser.mjs](../../scripts/ui-audio.browser.mjs) 未直接调用 prefetch；S 这是自定义软失败 Handle：network=null、watch no-op、release后也可能fulfilled；失败的其他下载保留到release，没有整体 fail-fast abort

<a id="a06"></a>

### A06 音频错误 / 未持有诊断去重

- **所有者/定位**：[src/audio/engine.ts:280,285,286,579,689](../../src/audio/engine.ts#L280)
- **编码字段**：listeners Set；reported Set<message>；unheld Set<SfxName>；failed Set 为 A03 状态
- **状态、事件与转换**：首次错误 message→console.error+listeners；同 message 后续不报；DEV sound 没sample且非pending/failed、未warning过→warn一次；onError 增删订阅
- **失败/取消/终态**：不 replay 注册前旧错误；load 后重试成功不清 reported/unheld；无自动过期
- **所有权不变量**：诊断去重与成功 cache 不同；不把“已经报告”当“故障已解决”；failed Set 仅标仍held的失败音名
- **测试/风险**：T [ui-audio-holders.test.mjs:36,61](../../scripts/ui-audio-holders.test.mjs#L36) 只分析调用/列表；S listener 抛错不会被隔离，在 A03 report(cause) 后可能阻止 created.resolve，属于边界回调契约未测

<a id="a07"></a>

### A07 music wish（用户/页面意图）

- **所有者/定位**：[src/audio/engine.ts:269,667](../../src/audio/engine.ts#L269)
- **编码字段**：wanted: menu/run/boss/null；runStarted/runAt 的交互
- **状态、事件与转换**：play 同 wish 直接返回；新 wish 若离开 run/boss 且runStarted则advanceRun；更新 wanted→follow；wish=run 解析为当前轮换曲
- **失败/取消/终态**：失败不撤回 wanted；同 wish 重复快照不会重试；dispose wanted=null
- **所有权不变量**：wish 描述业务意图，允许无ctx、未载入、静音、尚在换曲；不能以 wanted 当实际 playing
- **测试/风险**：T [ui-audio.browser.mjs:29,32,35](../../scripts/ui-audio.browser.mjs#L29) 正常换曲；K#18 的下层 applying 已按 hold 身份去重，见 A09；S 正常 UI 紧邻可达性的原证据限制不变

<a id="a08"></a>

### A08 player 的当前目标租约

- **所有者/定位**：[src/audio/engine.ts:265,479](../../src/audio/engine.ts#L265)
- **编码字段**：player={track,hold}|null；previous lease
- **状态、事件与转换**：follow 由 wanted/runAt 计算 target；同 target no-op；先 acquire 新 music:track(background)，再 release previous；target null 则 player=null；随后 applyMusic
- **失败/取消/终态**：取消使旧 pending holder reject AbortError；加载失败的 hold 仍 fulfilled但 tracks 无值；dispose release player
- **所有权不变量**：player 只持当前目标曲；旧音乐的淡出 source 继续拥有自己的 buffer，不需要旧 track Map 存活；外部run/boss holds仍可保温
- **测试/风险**：T [ui-audio.browser.mjs:29–45](../../scripts/ui-audio.browser.mjs#L29)；S track identity 不等于 handle/request identity，同曲新旧租约必须分开分析

<a id="a09"></a>

### A09 applyMusic 异步应用 / 去重

- **所有者/定位**：[src/audio/engine.ts:274,508](../../src/audio/engine.ts#L274)
- **编码字段**：applying:Handle<void>|null；捕获 context、target、hold；await hold.result
- **状态、事件与转换**：无 ctx/buses/bank 或 target 已在 playing 时不做；仅 applying===player.hold 才去重；新 hold 设 applying 并 await；完成后核对 player.hold 仍为本次 hold 且该曲尚未播放，才读 tracks 建 source；null target 淡出并清 playing
- **失败/取消/终态**：hold 释放则返回；finally 仅在 applying===hold 时清标记，旧完成不能清新请求；load 软失败无 buffer 时保持静音；dispose 清 player 后晚到 hold 不再能提交
- **所有权不变量**：按请求 hold 身份去重；取消后同曲重播的新 hold 独立，旧请求不得清除或替换它
- **测试/风险**：K#18 原延迟解码复现保留；[audio.test.mjs](../../scripts/audio.test.mjs) 新增受控解码下立即取消/同曲重播的定义。本次未执行该测试，也未做正式 UI 可达性或音频听验

<a id="a10"></a>

### A10 playing source / crossfade 生命周期

- **所有者/定位**：[src/audio/engine.ts:156,471,535](../../src/audio/engine.ts#L156)
- **编码字段**：playing{track,source,out,startedAt,duration,bpm}；fadeIn gain；旧Playing闭包；AudioContext自动化时间
- **状态、事件与转换**：decoded target→按拍或now+0.02排期→loop source start→立即把playing指新曲（此时可还未到start）；旧曲out曲线0.9s淡出并stop；target null 0.7s淡出→playing=null
- **失败/取消/终态**：old.source.onended 断开old.out；新source循环无自然结束；context.close终止底层播放；没有所有fading sources集合或独立failure state
- **所有权不变量**：fade-in和fade-out分两个gain，互不覆盖；“current”逻辑指最新排期source，实际可短时新旧两条并存；buffer活期由source保留
- **测试/风险**：T [scripts/audio.test.mjs:23](../../scripts/audio.test.mjs#L23) 只测untilNextBeat纯算法；browser正常切换不验证全部crossfade节点释放；S 创建source/排期异常不经report；fadeIn/source未显式disconnect

<a id="a11"></a>

### A11 run rotation / 定时检查

- **所有者/定位**：[src/audio/engine.ts:270,489,496,556](../../src/audio/engine.ts#L270)
- **编码字段**：runAt、runStarted、turn:setTimeout；captured pass identity、ctx.currentTime
- **状态、事件与转换**：run source start→runStarted=true→scheduleTurn；剩余>0.05s则setTimeout(max(1,left)s)；pass仍playing且wanted=run才轮换advanceRun、follow；离开run/boss到menu/null也按runStarted前进
- **失败/取消/终态**：schedule新run先clear旧timer；dispose clear；换boss/menu旧timer醒来由guard结束；声音关闭时context时钟不前进，timer会继续重查剩余
- **所有权不变量**：一曲按一遍时长推进轮换（source本身loop）；声音关闭不消耗轮换进度；业务暂停只是降音量，音频时钟仍前进
- **测试/风险**：没有已定位rotation/suspend timer专项；T [ui-audio.browser.mjs:32](../../scripts/ui-audio.browser.mjs#L32) 只进入run首曲；S wall-clock timer与audio-clock排期是两套时钟，不能将音频暂停和模拟暂停混写

<a id="a12"></a>

### A12 pause gain 意图 / 实际自动化

- **所有者/定位**：[src/audio/engine.ts:276,315,676](../../src/audio/engine.ts#L276)
- **编码字段**：paused boolean；buses.pause AudioParam；context.currentTime
- **状态、事件与转换**：context不存在先存paused；start按当前paused设初始gain；setPaused更新目标0.3或1、setTargetAtTime τ=0.1
- **失败/取消/终态**：不停止source、不冻结rotation；dispose跟context；重复setPaused会重新提交自动化
- **所有权不变量**：pause总线独立于duck、music mix和每曲crossfade；模拟菜单暂停与声音开关不同
- **测试/风险**：未定位引擎gain行为专项；[audio.test.mjs](../../scripts/audio.test.mjs)不涵盖；无新增特定风险

<a id="a13"></a>

### A13 SFX admission / cooldown / take记忆

- **所有者/定位**：[src/audio/engine.ts:266,580](../../src/audio/engine.ts#L266)
- **编码字段**：samples、enabled/ctx/buses；lastPlayed Map、lastTake Map；voices；RULES
- **状态、事件与转换**：无sample/disabled/未ctx→silent；非running请求resume；cooldown命中→可选fallback或drop；voices≥14且非always→drop；获准才写lastPlayed、选不重复take并算pitch/level/soundStart
- **失败/取消/终态**：被过滤不排期、不加voices；音频load失败按A03静音；cooldown和take记忆不随资源last-release清空
- **所有权不变量**：admission不会临时下载缺失音；重要cue可突破voice cap；随机只影响呈现音频，不写sim RNG
- **测试/风险**：T [ui-audio-holders.test.mjs:36,61](../../scripts/ui-audio-holders.test.mjs#L36) 静态检查完整音名/ fallback覆盖；[audio.test.mjs:5,12,19](../../scripts/audio.test.mjs#L5)只测对齐公式；S没有真实engine的cooldown/voice cap/take回归覆盖定位

<a id="a14"></a>

### A14 单 SFX voice / source 完成

- **所有者/定位**：[src/audio/engine.ts:615](../../src/audio/engine.ts#L615)
- **编码字段**：source、可选level gain；delay/offset、playbackRate；voices aggregate；onended
- **状态、事件与转换**：admitted→source连接ui/bed/sfx→按音画关键帧排期start→voices++（包含等待开始的voice）→onended voices--、level断开
- **失败/取消/终态**：没有每voice取消句柄；setEnabled暂停整个context；sample handle释放不终止正在播放source；source.start抛错不进入正常计数完成路径
- **所有权不变量**：source自己保留buffer至结束；sample cache与活跃voice两种所有权；结束回调负责精确减少一次计数
- **测试/风险**：T [audio.test.mjs:5,12,19](../../scripts/audio.test.mjs#L5)只算法；S 无source集合统一停止，context关闭清底层，没测全部onended/voices归零时序

<a id="a15"></a>

### A15 duck envelope 合并

- **所有者/定位**：[src/audio/engine.ts:277,634](../../src/audio/engine.ts#L277)
- **编码字段**：duckDepth、duckUntil；music duck/bedDuck AudioParam自动化
- **状态、事件与转换**：cue有duck→按delay/实际速率算begin/until；与现有duck重叠则取更深gain、更晚until；取消未来自动化→begin渐降、until渐回1
- **失败/取消/终态**：没有JS timer；状态靠context时钟和下一cue比较判断过期；独立于pause gain；关闭context终止
- **所有权不变量**：同时cue共享一个总线包络；bed用duck dB的一半；不是每cue各自恢复造成抢写
- **测试/风险**：未定位duck overlapping引擎专项；S暂停/声音开关/未来排期cue的交错未实际听验或自动化核实

## X：直接相关的资源消费者与 prewarm（主范围外，补全所有权链）

只取资源生命周期，不在这里重复整套导航、对局/联机协议、弹窗动画、游戏逻辑或粒子状态机。

<a id="x01"></a>

### X01 平台服务绑定与 decoded-image 所有权

- **所有者/定位**：[src/platform/resources.ts:21](../../src/platform/resources.ts#L21)；[src/platform/web/resources.ts:6](../../src/platform/web/resources.ts#L6)；[src/platform/native/resources.ts:12,25](../../src/platform/native/resources.ts#L12)
- **编码字段**：installed Resources singleton及 [Runtime绑定](../../src/platform/runtime.ts#L9)（同样由入口安装、未安装访问抛错）；Web ImageBitmap；native typed-array source；read AbortSignal
- **状态、事件与转换**：install→ready service；未install访问抛；read→bytes；decode→CPU image；Web release→bitmap.close；native release为空函数，以owner引用回收typed array
- **失败/取消/终态**：native read前和readFile使用signal，decode无signal；路径逃逸拒绝；decode异常向上；替换installed不重置已有高层cache
- **所有权不变量**：GPU Texture.dispose 不关闭CPU像素；缓存必须分别释放/丢弃source引用；Web/native的CPU终止语义不完全相同
- **测试/风险**：T [scripts/native-platform.test.mjs:17,34](../../scripts/native-platform.test.mjs#L17)；S 模块service可替换，现有store仍绑定旧owner的风险需由应用单实例约定解决

<a id="x02"></a>

### X02 首屏 readiness / reveal / 开启后台资源

详细状态记录见 [UI-HOST-FIRST](application-ui.md#ui-host-first)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：UI_SOUNDS是host租约，host.dispose release；首屏ready独立于后续预热和run prefetch；图像base仍store拥有
- **特别关注**：T `ui-font-revision`/`ui-images`/audio browser覆盖下层，未定位首屏终止全链自动测试；S 不可把nextScreenReady故障时settle的行为套到revealed Promise上

<a id="x03"></a>

### X03 每 UiStage 的 compile/font/image 放行 gate

详细状态记录见 [UI-HOST-PREPARE](application-ui.md#ui-host-prepare)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：stage不能在资源缺失时呈现/推进动画；fonts和image readiness与shader compile都要满足；generation不同不能误放行新stage
- **特别关注**：T [ui-font-revision.test.mjs](../../scripts/ui-font-revision.test.mjs)、[ui-images.test.mjs](../../scripts/ui-images.test.mjs)间接；K#1 已接应用 dispose，见 R02；S nextScreenReady 是退出等待的信号而非“永远成功加载”证明

<a id="x04"></a>

### X04 UI program retention

详细状态记录见 [UI-HOST-CONTEXT](application-ui.md#ui-host-context)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：UI shaders可跨窗口保温；world shaders由R05单独拥有；seenPrograms仅用于发现，不是实际GPU资源所有权
- **特别关注**：T [three-external-context.test.mjs:13](../../scripts/three-external-context.test.mjs#L13)测试底层retention；未定位host UI全部变体retain生命周期专项；S代际变化由新retention承担，WeakSet旧program条目会随GC去

<a id="x05"></a>

### X05 host 预热副本 / warmTarget

详细状态记录见 [UI-HOST-FIRST](application-ui.md#ui-host-first)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：预热是丢弃副本、保留program，不是把副本挂成正式页面；每个副本自有UI资源归该副本
- **特别关注**：未定位完整warmSurfaces专项；T [ui-settings-render.browser.mjs](../../scripts/ui-settings-render.browser.mjs)只是设置绘制脚本；S warmUi没有captured generation，target恢复无try/finally，shell路径没catch；未测loss/dispose/compile交错

<a id="x06"></a>

### X06 run-overlay sample prewarm 队列

详细状态记录见 [UI-OVERLAY-WARM](application-ui.md#ui-overlay-warm)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：prewarm副本与当前真实overlay所有权分立；样例一次一帧，不是全样例一个长同步任务
- **特别关注**：[scripts/ui-run-overlays.test.mjs:49](../../scripts/ui-run-overlays.test.mjs#L49)测试窗口owner隔离，不直接测试warm；S 主体dispose后，仍在images等待的then未检查warming/disposed，可继续update已dispose copy；样例不自动按GPU代际重跑

<a id="x07"></a>

### X07 run资源构建 / zone替换 coordinator

- **所有者/定位**：[src/run/createRun.ts:396,959,1000,1032,1046,1229](../../src/run/createRun.ts#L396)
- **编码字段**：disposed/failed/started/changingZone；abort；assets/view/minimap/compass/boundary/healthBars refs；build/drive Promises
- **状态、事件与转换**：初始 afterFrame→world→loadRunAssets→createRunView驱动→bakeMap→minimap/compass→X08；换区guard changingZone，cover后保留旧program→disposeScene→**提交新world/map**→重建scene→X08
- **失败/取消/终态**：build/changeZone catch→fail停止自身advance并回调；dispose abort+release音频、resident/world slot、scene、assets；晚built/loaded被dispose；换区失败不回滚旧world
- **所有权不变量**：assets跨zone保留；旧/新scene不能同时挂同一玩家rig；view只读world，提交区域由run流程决定；必须warm/全员ready才继续tick
- **测试/风险**：T [ui-steps.test.mjs:5](../../scripts/ui-steps.test.mjs#L5)和model-store只是下层；历史后三图QA非本轮重跑；S生成中途取消回收见P11；文档不能写成“资源全齐后才提交world”

<a id="x08"></a>

### X08 run GPU warm / 上传步骤 / ready barrier

- **所有者/定位**：[src/run/createRun.ts:1078,1129](../../src/run/createRun.ts#L1078)；[src/run/view/createRunView.ts:841](../../src/run/view/createRunView.ts#L841)
- **编码字段**：stopWaiting；captured generation/current()；view.warmSet；uploadSteps seen Set与纹理数组/游标；runSounds/runTrack；network.ready Promise
- **状态、事件与转换**：不可用先 subscribe restore；可用时 warmSet(all forms)→compileAsync→逐纹理 initTexture/yield→真实 draw（含 shadow）→warmSet(false)→pin programs→首局音频 attempt settled→network.ready→current guard；换区解除 changingZone，首次开局先 callbacks.onReady 提交背包，再 current guard→setWorld/started
- **失败/取消/终态**：generation变化/!available→重新start等本代；dispose直接停；本代真实错误→fail；GPU warm过程中无底层Promise硬取消；runTrack在music.play(run)接管后释放
- **所有权不变量**：一个 run 的激活包含 CPU scene、当前代 GPU、peer barrier 与本地开局持久化确认；onReady 抛错走 fail，不能注册世界 advance；声音失败是 soft fulfilled；纹理 step 不负责所有闭包资源。保存/激活最终审阅仍由主线程收尾
- **测试/风险**：T [three-external-context.test.mjs:145](../../scripts/three-external-context.test.mjs#L145)program保温、[ui-prepare.test.mjs:181](../../scripts/ui-prepare.test.mjs#L181)类比generation而非真实start；S step集合每轮新建，实际是否重复上传由Three纹理版本负责；未测所有长await后的当前代循环

<a id="x09"></a>

### X09 LobbyScene model-held cache / 选择revision

详细状态记录见 [UI-LOBBY-MODEL](application-ui.md#ui-lobby-model)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：LobbyScene 独立拥有各 clone+canonical 租约；prefetch 两线窗口不限制 held 的成功项；失败 staged 按 entry 身份移除并 release，退出 scene 才放开其余项
- **特别关注**：K#9 已补失败移表与当前请求通知，切离再选可重新获取；T [ui-host.test.mjs](../../scripts/ui-host.test.mjs) 定位消费者缓存重试，共享 store 测试不替代此层；S fits 依 layout key 重测，无独立资源释放需求（WeakMap）

<a id="x10"></a>

### X10 LobbyScene model compile / GPU resident

详细状态记录见 [UI-LOBBY-MODEL](application-ui.md#ui-lobby-model)、[UI-LOBBY-STAGE](application-ui.md#ui-lobby-stage)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：canonical GPU由M10释放，本机只负责自己的骨架/quad；compiled CPU记录只在该generation有效
- **特别关注**：K#9属于获取层，不能误算compile失败；无已定位loss与compile交错专项；Scompile完成使用this.compiled，会在loss换集合后把旧编译加入新集合，待实际时序核实

<a id="x11"></a>

### X11 CodexModelStage request / LRU / state

详细状态记录见 [UI-CODEX-MODEL](application-ui.md#ui-codex-model)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：cache拥有每个Prepared的clone和handle；mounted Content只借target/plane，不拥有canonical；state=ready是模型采用，不是已draw（见X12）
- **特别关注**：[scripts/ui-codex.test.mjs](../../scripts/ui-codex.test.mjs)只测图鉴内容数据，非此机器；S loadPrepared rejected或clone后异常没有统一handle.release；读取成功后consumer回调遇abort的窄窗口也只return，未复现

<a id="x12"></a>

### X12 Codex preview compile / 首次成像 / GPU恢复

详细状态记录见 [UI-CODEX-COMPILE](application-ui.md#ui-codex-compile)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：新模型完成draw前隐藏图，避免显示上一模型target；target、plane/material是stage所有，clone骨纹理归Prepared
- **特别关注**：无已定位直接测试；S compile reject可留下compiling=true；loss后老回调又写共享compiling=false可能扰动新请求，仅静态风险

<a id="x13"></a>

### X13 CodexThumbs 串行装载 coordinator

详细状态记录见 [UI-CODEX-THUMBS](application-ui.md#ui-codex-thumbs)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：loader至多一个在途，但ready积压可多项；未render的Prepared仍持模型租约；退出必须dispose这些ready
- **特别关注**：无已定位thumb生命周期单测；S parent若dispose后仍update有再启动风险，依赖调用者停止；loadPrepared移交失败边界同X11

<a id="x14"></a>

### X14 单 thumbnail entry / mesh holders / CPU像素resident

详细状态记录见 [UI-CODEX-THUMBS](application-ui.md#ui-codex-thumbs)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：成功缩略图不再持GLB，只持160² CPU像素+GPU纹理；每个row own material，Geometry/target由thumbs共享
- **特别关注**：无已定位直接测试；S failed queued粘住与大厅失败缓存是相似但不同机器，本轮未运行复现；同步readPixels性能未测

<a id="x15"></a>

### X15 RunView / minimap / compass 的树外资源resident

详细状态记录见 [RV01](view-tools.md#rv01)、[MP07](view-tools.md#mp07)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：shader闭包纹理不在tree遍历内，需显式dispose；ground共享地图归M09；地图烘焙base归minimap；rig.unmount恢复姿态供下zone复用
- **特别关注**：T [scripts/view.test.mjs:154](../../scripts/view.test.mjs#L154)尾骨rest pose；[scripts/view-zone-content.test.mjs](../../scripts/view-zone-content.test.mjs)场景测试非完整loss链；S未逐个重审所有VFX/地形内部对象池与closure textures，见遗漏范围

<a id="x16"></a>

### X16 UiStage dirty/layout/paint 与销毁

详细状态记录见 [UI-STAGE](application-ui.md#ui-stage)。本项作为资源依赖索引保留，与该页面属于同一生命周期。

- **资源接缝**：UiStage是树与布局所有者，不是font pages/共享图片CPU所有者；一次update后变干净不等于异步glyph/instance已完成
- **特别关注**：T [scripts/ui-stage.test.mjs:6](../../scripts/ui-stage.test.mjs#L6)保护布局期间新panel变ready还能重绘；S更新/编译已dispose stage的调用由X05/X06等owner guard承担

## 跨机器的持有 / 清理对照

| 资源                          | 共享 key / owner                           | 实际保持者                                        | 最后 release                               | context lost / restore                      | 真正终止的边界                                          |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------- | ------------------------------------------ | ------------------------------------------- | ------------------------------------------------------- |
| 下载 Blob                     | fetch 原始 URL，P04/P05                    | 每层 fetch handle；音频 bytes prefetch 可长期占住 | 表删除，未完成 abort                       | 不因为 GPU loss 取消                        | fetch 无页面级 shutdown，靠所有 holder / 宿主结束       |
| 图片 CPU pixels + base Source | kind+pathname+search，I01/I02              | ImageHandle、preparation、texture() 的 kept       | 无 kept 时释放 base+image                  | 只清 base GPU；保持CPU并重新排upload        | store 没 dispose；texture() keep 常驻到页面/进程        |
| 图片 consumer view            | 每个调用者，I04                            | UI材质/组件                                       | view.dispose 释放该view引用                | view/tree GPU cleanup；source仍store拥有    | caller dispose，不得顺带close共享pixels                 |
| canonical GLB + baked几何     | URL / height，M01/M07                      | 大厅prefetch、舞台held、run handles、codex cache  | 模型+全部baked几何dispose                  | model/baked GPU释放，CPU模型保留            | 最后canonical handle；make交付前失败须loader自己清      |
| 玩家/图鉴/大厅 skeleton clone | 每个consumer，M08                          | RunAssets、Staged、Prepared                       | consumer.dispose骨纹理；canonical另release | skeleton GPU释放，骨架CPU保留               | clone使用期不得越过canonical handle租约                 |
| 世界地面贴图                  | URL，M09                                   | stage保温 / RunAssets handles                     | Texture.dispose + image.release            | Texture GPU释放，CPU保留                    | keyedStore最后holder；共享sampler约定                   |
| font metrics + core页         | base.href/font/page，F01–F05               | font set；prefetch core hold；stage gate          | decoded core仍保留                         | 上传标记清空，全部decoded页重传             | 当前dispose只放#held和resident，不等于清全部image/cache |
| font base页                   | page key，F03/F04                          | pending和committed revision holds                 | 空闲页加入LRU，超过64才逐出                | retained CPU页都重传                        | evict解绑page image并release CPU；显示中页不可淘汰      |
| named decoded audio           | AudioName，A03                             | UI host、stage prefetch、run、player              | samples/tracks删除；pending downloads释放  | 与WebGL generation无关                      | Map不持有后仍可能由播放source保持AudioBuffer            |
| music raw bytes               | fetch URL，A05/L02                         | stage prefetch / departed                         | fetch handle全部release后离表              | 与WebGL无关                                 | 解码资源释放不自动丢raw bytes，二者独立                 |
| shader program                | material归属+renderer generation，R05/X04  | app world retention / host UI retention           | 组件销毁仍可保温                           | retention.dispose，新代重新建               | owner app/host dispose；不保CPU材质的整体生命周期       |
| target / screenshot CPU图     | WorldPass、CodexStage、CodexThumbs/minimap | 对应scene/surface owner                           | owner dispose                              | target丢GPU；thumb/minimap CPU pixels可重传 | owner卸载；不是canonical模型的一部分                    |

关键交接次序：

1. **下载完成 ≠ CPU准备完成**：模型背景条目可停在 gate；图/字体还要校验解码；音频prefetch只拿字节。
2. **CPU完成 ≠ 当前代GPU完成**：模型没有独立uploadedIn，以Three状态/run warm保证；图片与字页显式记录generation。
3. **ready ≠ release**：Preparation.ready、PageAcquisition.result、Shared.done都可能仍持有资源。音频例外是load失败也可fulfilled。
4. **loss release ≠ 业务销毁**：保留CPU图像、骨架、页面、世界；调用完整dispose会破坏恢复或下次挂载。反之，最终dispose只做GPU那半也不足以释放CPU持有。
5. **背景保温 ≠ prewarm**：L系列持资源；R03/P10排任务；X05/X06/X08实际编译/绘制；R05/X04只保已得到的program。不要把这四层缩成warm=true。
6. **音频 wish ≠ player lease ≠ applying ≠ playing ≠ audible**：wanted 可预先存在、player 可 pending/静音、applying 是本次 hold 身份、playing 可能尚未到排期 start，context 可 suspended。

## 主范围逐文件覆盖核对

| 文件                                                                               | 行数 | 对应项 / 其他内容处理                                                                                      |
| ---------------------------------------------------------------------------------- | ---: | ---------------------------------------------------------------------------------------------------------- |
| [src/prepare/asset-url.ts](../../src/prepare/asset-url.ts)                         |   14 | build-time映射的纯查表，无可变运行时机器；P05/I01与K#14标出键语义                                          |
| [src/prepare/fetch.ts](../../src/prepare/fetch.ts)                                 |  101 | P04、P05                                                                                                   |
| [src/prepare/handle.ts](../../src/prepare/handle.ts)                               |  198 | P01、P02、P03                                                                                              |
| [src/prepare/idle.ts](../../src/prepare/idle.ts)                                   |  108 | P10；allowlist/admits纯准入政策；texture-upload是已定义准入种类，当前检索到的trySchedule调用方只在模型gate |
| [src/prepare/images.ts](../../src/prepare/images.ts)                               |  334 | I01–I05；configure/viewOf是其构造工具，不重复造机器                                                        |
| [src/prepare/preparation.ts](../../src/prepare/preparation.ts)                     |  319 | P06–P09；progressOf是聚合投影，不是独立流程                                                                |
| [src/prepare/steps.ts](../../src/prepare/steps.ts)                                 |   52 | P11；runAll同步驱动同一generator，不是另一个持久状态源                                                     |
| [src/rendering/app-renderer.ts](../../src/rendering/app-renderer.ts)               |  447 | R01–R05；计数器/stats为输出观测；idle入场接P10，DRS接R08/R09                                               |
| [src/rendering/gpu-timer.ts](../../src/rendering/gpu-timer.ts)                     |   71 | R07                                                                                                        |
| [src/rendering/releaseUploads.ts](../../src/rendering/releaseUploads.ts)           |   69 | R04的无跨调用状态释放算法，单次released集合不再另列                                                        |
| [src/rendering/world-pass.ts](../../src/rendering/world-pass.ts)                   |  136 | R06                                                                                                        |
| [src/rendering/world-resolution.ts](../../src/rendering/world-resolution.ts)       |  224 | R08/R09两模式子机器；policyFor与median为纯计算                                                             |
| [src/game/models/embedded-textures.ts](../../src/game/models/embedded-textures.ts) |  103 | M05                                                                                                        |
| [src/game/models/glbSize.ts](../../src/game/models/glbSize.ts)                     |   70 | P10/M03的纯cost-proxy读取；async来自blob.arrayBuffer，无cache/owner状态                                    |
| [src/game/models/loadGlb.ts](../../src/game/models/loadGlb.ts)                     |  201 | M04、M06；validator内hasJson/hasBinary/offset是一次解析游标，作为M04输入阶段记录，不另立长期机器           |
| [src/audio/engine.ts](../../src/audio/engine.ts)                                   |  703 | A01–A15；规则/波形常量无独立生命周期；DEV log是最近60条观测环，不控制行为                                  |
| [src/audio/schedule.ts](../../src/audio/schedule.ts)                               |   14 | soundStart/untilNextBeat纯函数，无持久状态；分别见A10/A14                                                  |
| [src/run/prefetch.ts](../../src/run/prefetch.ts)                                   |  166 | L01–L04                                                                                                    |
| [src/run/view/assets.ts](../../src/run/view/assets.ts)                             |  821 | M01–M03、M07–M11；formModels/facingYaw/stationFiles与need列表为静态元数据/纯派生                           |
| [src/ui/gpu/fonts.ts](../../src/ui/gpu/fonts.ts)                                   |  887 | F01–F10；hash/check/merge/fontOf/textOf/pagesFor是读取/派生工具，不单独列状态机                            |

## 测试证据索引（源码存在，不等于本轮跑过）

本表及上文所有简写测试文件均位于 `scripts/`。只有明确写“直接”的才是对应机器的针对性检查。

| 文件 / 入口                                                                                                               | 实际覆盖的行为                                                                                                                              | 不可外推                                                                          |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [ui-prepare.test.mjs:64,78,103](../../scripts/ui-prepare.test.mjs#L64)                                                    | URL共享、lane优先级/keep、最后waiter abort                                                                                                  | CPU解码或真实GPU恢复                                                              |
| [ui-prepare.test.mjs:121,167,181,219,239,266](../../scripts/ui-prepare.test.mjs#L121)                                     | preparation三种outcome、所有失败项retry、失context保CPU重GPU、旧attempt无权提交、revision启动门                                             | `run/prefetch.ts`模块、正式导航/run.start完整接线                                 |
| [ui-prepare.test.mjs:297](../../scripts/ui-prepare.test.mjs#L297)                                                         | 以真实基础设施手工构造A/B/depart/cancel场景                                                                                                 | 它没有import真实prefetch模块，不能称其stage保温/current-recent完整集成测试        |
| [ui-idle.test.mjs:10,32](../../scripts/ui-idle.test.mjs#L10)                                                              | GLB尺寸准入、quiet门、FIFO/单步/取消                                                                                                        | 真实手机阻塞≤8ms；当前texture-upload实际入队                                      |
| [ui-steps.test.mjs:5](../../scripts/ui-steps.test.mjs#L5)                                                                 | live=false后不运行下一构建step                                                                                                              | 已分配半成品的dispose/finally保障                                                 |
| [ui-images.test.mjs:81,100,115,134,152,166,178,201,218,228,249](../../scripts/ui-images.test.mjs#L81)                     | Source/view版本、同代单上传、恢复、最后holder释放、晚decode关闭、分类key、失败重试保持Source、旧handle释放隔离、lane、无unhandled、kept迁移 | 使用fake GPU/decode的条目不等于浏览器/SDL驱动内存和context正确                    |
| [ui-images.browser.mjs:22](../../scripts/ui-images.browser.mjs#L22) `checkImageUploads`                                   | 真实AppRenderer/GL计数，10轮views与restore                                                                                                  | 本轮未调用；单图片脚本不是整款App设备验收                                         |
| [ui-model-store.test.mjs](../../scripts/ui-model-store.test.mjs)                                                          | URL共享parse、height bake复用/最后drop、canonical tail一次/clone私有骨架、idle与keep、非法GLB不悬挂；新增canonical失败清理/重试             | 大厅held失败重试另见ui-host；不覆盖RunAssets全部abort路径                         |
| [native-platform.test.mjs:17,34](../../scripts/native-platform.test.mjs#L17)                                              | native PNG/WebP方向、越界/取消读取、真实带纹理小火龙load/release                                                                            | 完整SDL页面、所有GLB骨架/贴图或实机context恢复                                    |
| [ui-font-revision.test.mjs:123,132,143,151,167,179,198,211,223,239,250,261](../../scripts/ui-font-revision.test.mjs#L123) | latest-only、保旧commit、resident立即提交、dispose、loss/restore、decode共享、失败/晚结果、hold lane                                        | GPU/decoder为fake；dispose测试只覆盖未完成页；不覆盖>64base LRU、metrics前release |
| [ui-font-revision.test.mjs:308,326,340](../../scripts/ui-font-revision.test.mjs#L308)                                     | real paged-font loader接线的ready页失败、stage release、metrics失败                                                                         | 326先等待metrics，再release，不证明metrics之前也可cancel                          |
| [ui-fonts-paged.test.mjs:58,64,96,120,162,173](../../scripts/ui-fonts-paged.test.mjs#L58)                                 | 清单/内容关系、mismatch拒绝、core/base度量与优先级、混合文字、字符边界                                                                      | 页GPU上传/已解码set最终释放                                                       |
| [ui-fonts.test.mjs:96](../../scripts/ui-fonts.test.mjs#L96)                                                               | 缺字只报一次、仍返回glyph                                                                                                                   | 用户导入边界的完整体验                                                            |
| [ui-fonts-build.test.mjs:27,79,95](../../scripts/ui-fonts-build.test.mjs#L27)                                             | 构建失败不破坏发布集、保留三版、发布锁                                                                                                      | 构建流程不在本轮机器枚举主范围；更不能替代Web全资源快照问题K#15                   |
| [ui-rendering.test.mjs:26–123](../../scripts/ui-rendering.test.mjs#L26)                                                   | DRS纯controller过载/余量/回滚/范围/暂停/迟到样本                                                                                            | GpuTimer驱动API、GPU性能或手机校准                                                |
| [three-external-context.test.mjs:13,145,200](../../scripts/three-external-context.test.mjs#L13)                           | 真实headless EGL/外部context，program retention与AppRenderer world/context替换                                                              | 不是物理手机/正式SDL用户流程；本轮没执行                                          |
| [three-context.browser.mjs:2](../../scripts/three-context.browser.mjs#L2) `checkThreeContext`                             | Three canvas的实际lost/restored事件、retain失效、OffscreenCanvas                                                                            | 不包含整个AppRenderer/资源cache组合；本轮没执行                                   |
| [audio.test.mjs](../../scripts/audio.test.mjs)                                                                            | 音画delay/offset、按拍纯计算；新增受控解码的取消/立即同曲重播                                                                               | 未听验，不覆盖全部suspend/rotation/voices/duck                                    |
| [ui-audio-holders.test.mjs:36,61](../../scripts/ui-audio-holders.test.mjs#L36)                                            | 静态遍历sfx调用与fallback确保UI/run名字被持有                                                                                               | 实际fetch/decode/cancel和音乐同曲竞态                                             |
| [ui-audio.browser.mjs:8](../../scripts/ui-audio.browser.mjs#L8) `checkAudioAcquire`                                       | 受浏览器脚本驱动的共享name fetch、两次release、menu/run/null持有集                                                                          | 脚本有固定等待，未覆盖同微任务内cancel/replay，未听验；本轮没执行                 |
| [ui-stage.test.mjs:6](../../scripts/ui-stage.test.mjs#L6)                                                                 | layout过程中instance延后ready仍请求重绘                                                                                                     | stage销毁与异步prewarm交错                                                        |
| [ui-codex.test.mjs:21](../../scripts/ui-codex.test.mjs#L21) 等                                                            | 图鉴内容/图片元数据/链接                                                                                                                    | CodexModelStage/Thumbs异步生命周期（测试未引用这些类）                            |
| [ui-run-overlays.test.mjs:49](../../scripts/ui-run-overlays.test.mjs#L49)                                                 | 新退入窗口各自控制权                                                                                                                        | warmSamples/副本异步资源释放                                                      |
| [view.test.mjs:154](../../scripts/view.test.mjs#L154)                                                                     | 下一zone复用前尾骨rest pose恢复                                                                                                             | 全部run scene/GPU resident恢复                                                    |

## 与现有代码审计的对应（保留正常机器清单）

| 旧审计项                                     | 本表归属      | 本轮处理                                                                                            |
| -------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| #1 UI失败后world继续推进                     | R02、X03      | app/session 已在 host fatal 时 dispose 会话；不外推全部 GPU 错误路径已验收                          |
| #9 大厅failed Promise复用                    | X09           | consumer held 失败项按身份移表/release；当前请求失败通知；重选可重新获取                            |
| #13 canonical尾骨准备失败漏dispose           | M02、M04、M07 | model loader 在 canonical 失败时清理尚未移交的 LoadedModel                                          |
| #14 绝对URL绕发布映射且与相对路径合key       | P05、I01、X02 | host 已改为发布映射使用的根相对路径；三层 key 语义本身未改变                                        |
| #15 build清单/复制资产不同快照               | P05上游输入   | 已改为私有 public 快照统一产生映射与字节，见 [平台 PL-18](platform.md#pl-18-构建发布阶段与字节身份) |
| #18 音乐cancel后立即同曲重播被旧applying挡住 | A07–A10       | applying 改持 hold；旧完成仅清自己且提交前核对 player.hold，保留正式 UI 可达性/听验限制             |

其余S项是源码可见的边界说明/待核实序列，不与这些已有独立复现的K项混用证据等级，也没有在本轮为每项建bug、写修复或设门禁。

## 完整性与遗漏范围

**主范围**：20个指定源码文件的跨调用、异步等待、持有/释放和代际状态均已纳入上述机器或逐文件“无独立机器”说明。字段的所有笛卡尔积组合没有机械展开；逻辑状态与真实guard/事件已经按owner分解。没有把每个资源URL/每种声音/每个字页复制为一台新机器，也没有将纯数值插值单列。

**补充范围**：X项覆盖host首屏/预热、stage、run构建与warm、lobby和codex模型/缩略图、平台CPU图片与地图树外资源的直接所有权链。它们是边界抽样扩展，不等于完整审计这些目录。

**本分册未展开（其他分册另有覆盖）**：

- `src/platform/{web,native}/render-surface.ts` 的宿主帧调度、窗口/SDL context重建内部；本文从它们交给AppRenderer的frame/lost/restored/resume回调开始。`gesture.ts`的通用手势监听、native底层音频实现也只看与本引擎接线，不逐台枚举。
- Three/UIKit及补丁内部的WebGL texture/program refcount、Font全局cache、instance buffer allocator、decode后端线程/浏览器HTTP缓存/CDN缓存。报告写项目可见拥有者与对外行为，未重审第三方实现。
- `src/run/view/**` 除assets与直接release/warm链之外的每个对象池、地形chunk、shader闭包、材质派生cache（例如VFX look memo）、实体/粒子活跃表；纯视觉插值按本清单分组规则不逐对象列。地图渲染资源有代表性owner行，但不宣称每个VFX池/闭包已逐一完整核对。
- app/run/network业务会话、导航、联机全员ready的内部协议、模拟、存档、输入、设置；只记录资源等待与提交边界。K#1涉及的运行停机归属须和宿主/对局清单合并。
- 构建/发布/母带/字体生成/Blender资产生产、发行包、网络部署的状态机；K#15 的构建修复转换见平台 PL-18，本文只保留资源上游引用。
- 全部资源字节内容、所有GLB的真实parse/canonical/clone、hash清单全集、字体实际图像、所有声轨听感。没有启动真实GPU页面、SDL、手机/手柄、音频设备或做内存/FPS测量。

**验证声明**：本轮只读源码和测试，未执行现有测试、golden、构建或故障复现。旧QA里58/80等通过数量不相加，也不记作本轮结果。本页由独立只读研究汇入。
