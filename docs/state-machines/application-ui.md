# 应用与 GPU UI 状态机

本清单按生命周期边界拆出 **84 项机器/共用模式**（不是84个独立类或进程）；每项附owner、编码字段、逻辑状态、转换、取消/终态、不变量和测试/风险。

基线与整体范围见 [总清单](../STATE-MACHINES.md)。本页状态机研究只读源码，没有在该阶段执行测试或正式GPU页面。

2026-11-08 修复后的相关条目已按工作区 diff 定向更新；原扫描计数、行号和历史复现保留，不表示重新全量读取或执行。保存重试、激活前背包提交及网络交付已完成独立审阅后的修正。

这里的“机器”按所有权或生命周期区分：同一对象可有并行机器（例如图鉴窗口、浏览历史、模型请求、旋转）；显式 `kind/phase` 只是编码的一部分。共享 tween / 装饰 / 图元生命周期按模式合并，避免给每个插值数值编造一台机器。报告中的“不变量”指代码所依赖或表达的行为契约；注明风险时不表示已满足。

证据：**源码**＝本次直接静态读取；**既有审计 #N**＝引用 2026-11-08 代码审计第 N 项的既有结论（原文不随仓库发布），未重新复现；**测试**＝定位到仓库里的测试定义/断言，未执行；**待验证**＝可见时序缺口或边界，不能称玩家已遇到的故障。`无直接测试` 限于本次扫描的 `scripts/*.test.mjs` 和 `scripts/*browser.mjs`，不否定历史人工 QA。

## A. 应用与运行会话

<a id="ui-app-boot"></a>

### UI-APP-BOOT — Web 会话创建、错误页与重试

- **Owner**：[src/App.tsx:12–61,78–105](../../src/App.tsx#L12)。
- **编码**：React `session/view/gpuAttempt/gpuError`；effect 内 `disposed/current/AbortController`；`createAppSession` Promise。
- **逻辑状态**：未创建 → 创建中 → 已挂载；创建/运行错误 → 错误页；重试 → 新 attempt；effect 清理 → 注销。
- **事件 / guards / 转换**：非 WebRenderSurface 显式抛错；完成时 `disposed` 判晚到，晚到 session 立即 dispose；回调只在未销毁时写 React；renderer 起不来时重试整页 reload，否则 attempt++ 重建 session。
- **取消 / 终态**：清理先置 disposed、abort，再 dispose current、删除开发 getter。
- **不变量**：旧 attempt 不能写新 view；最多一个 effect 会话拥有 UI；开发测试钩子随会话撤销。
- **测试 / 风险**：**#1** 的修复在共享 `createAppSession`：host error 先销毁会话再通知平台；创建尚未返回时另记录 failure，取得 host 后 dispose 并抛错。[ui-run-session.test.mjs](../../scripts/ui-run-session.test.mjs) 有准备中/已激活会话的替代依赖夹具，不是正式 React 错误页验收。开发 `__poketoneGrant` 的独立 effect 仍由 session 引用注册/清理。

<a id="ui-app-route"></a>

### UI-APP-ROUTE — 页面 / 对局对象所有权交接

- **Owner**：[src/app/session.ts:63–90,227–253,254–350,352–367](../../src/app/session.ts#L63)。
- **编码**：`route/screen/run/unmount/devBadge/network/runPick/pick/disposed/reopenRoom`，SceneTransition 回调。
- **逻辑状态**：大厅拥有 screen+LobbyScene；研究所拥有 screen；对局拥有 run；过场中旧 owner 保留到 commit；最终 disposed。
- **事件 / guards / 转换**：`start` 仅 idle 且 starter 解锁；`show` 先 dispose run/devBadge、调用旧 unmount，才建新页面并 register；单人 retry 再 start；多人 retry 置 reopenRoom、back，下一大厅重开房间。
- **取消 / 终态**：dispose 按 transition→room→save→run→network→screen→host→input→audio-listener 清理；back 先 dispose network 再导航。
- **不变量**：页面 owner 与 host 注册配对；screen 不应与 run 同时成为当前业务页面；仅当前 run 的 onFinish 修改进度。
- **测试 / 风险**：[ui-run-session.test.mjs](../../scripts/ui-run-session.test.mjs) 覆盖共享 app/run 会话的保存与 fatal 接线，替换了绘制等依赖。**#4** 凭据异常已由网络边界转 warning；**#2/#3** 新的终局交付与离房保留由 [网络分册](network.md) 和主线程最终审阅收束。不把任意 cleanup 抛错都概括为已处理。

<a id="ui-app-transition"></a>

### UI-APP-TRANSITION — 遮罩导航与页面就绪屏障

- **Owner**：[src/ui/scene-transition.ts:7–53](../../src/ui/scene-transition.ts#L7)；接线 [src/app/session.ts:82–90](../../src/app/session.ts#L82)。
- **编码**：`phase/#timer/#disposed/#commit/#hold/#changed`；两个 `runtime.nextFrame()`；下一 screen readiness Promise。
- **逻辑状态**：idle → covering/计时 → 等两帧 → commit/等待资源 → revealing → idle；disposed 为吸收态。
- **事件 / guards / 转换**：navigate 仅 idle；260ms 后 swap，两帧确保画出遮罩；先取得 hold 再 commit；非 run 等 nextScreenReady，run 不等该屏障；reveal 340ms 后 idle。
- **取消 / 终态**：dispose 清 timer；每次 await 后检查 disposed。没有取消底层 hold，只阻止提交后续 phase。
- **不变量**：一次只接受一个导航；旧页清理不得早于遮罩完成；揭幕不得早于目标就绪。
- **测试 / 风险**：未找到直接 SceneTransition 测试。`void swap()` 没有 rejection handler，commit/hold 抛错可使 phase 留 covering；这是静态待验证路径，不声称本次复现。

<a id="ui-app-progress"></a>

### UI-APP-PROGRESS — 进度修改 / 存档导入提交

- **Owner**：[src/app/session.ts:60,128–188,264–281](../../src/app/session.ts#L60)。
- **编码**：`progressLoad.status/progress`、`pick/settings`、`change(apply)` 返回值、storage 调用、notification；`onStarted():boolean`、`onFinish():{ok,note|error}` 与存档 dialog 回调。
- **逻辑状态**：locked（只读）或 ready → 算候选值 → 持久化 → 提交内存/刷新；失败 → 原记录并通知。导入可把 locked 转 ready。
- **事件 / guards / 转换**：change 先拒绝 locked，再 apply/saveProgress，成功才换 progressLoad；load 先 decodeSave+storage.save，再赋 progress/settings、音频、screen；结算 onFinish 返回保存成败；首次开局 onStarted 返回背包清空保存结果，重返不重复消费。
- **取消 / 终态**：失败返回 false；结果背包依返回值决定是否显示已保存；导入成功关闭窗口。
- **不变量**：存储拒绝时不能预先提交内存进度；非法导入不得覆盖；结算只经现有 recordRun。
- **测试 / 风险**：**#8/#19** 已收紧进度/设置与外壳校验，见 [ui-save-import.test.mjs](../../scripts/ui-save-import.test.mjs)、[native-save.test.mjs](../../scripts/native-save.test.mjs)。**#20/#21** 新增 [ui-run-session.test.mjs](../../scripts/ui-run-session.test.mjs) 会话夹具。主线程仍需最终审阅：`change` 的 try 包住保存后的 `refreshScreen`，后者异常时数据可能已写入却返回 false；该语义边界尚未作为本次复现或已修结论。

<a id="ui-app-prefs"></a>

### UI-APP-PREFS — 设置预览、持久化与宿主同步

- **Owner**：[src/app/session.ts:76–77,91–127,189–192,374–397](../../src/app/session.ts#L76)。
- **编码**：`settings/settingsOpen/modalActive`、`state()` 派生、host/run `.update`、`devBadge` 存在性。
- **逻辑状态**：设置关闭/请求打开/显示/请求关闭；偏好立即生效，保存成功或失败通知；dev badge 随 devMode×screen 有无创建/销毁。
- **事件 / guards / 转换**：开关先更新 settings 和 audio，再 saveSettings；成功失败都 sync；host 通知 modalActive；run 收到合并的 modalActive||settingsOpen。
- **取消 / 终态**：页面切换销毁 badge；app disposed 后 sync 无效；保存失败不回滚已生效偏好。
- **不变量**：偏好只有 app 一份权威副本，仅 sound/devMode/uiScale；host/dialog 通过回调同步；设置退场与业务请求关闭是不同时间点。
- **测试 / 风险**：**#19** 已移除 rumble 与旧格式迁移；[ui-settings.test.mjs](../../scripts/ui-settings.test.mjs) 定位三项设置与存档焦点导航，存储校验另见平台 PL-14/15。本次未执行 browser 脚本。与 UI-APP-PROGRESS 的“先存储后提交”不同，不能误并成同一种事务。

<a id="ui-app-save-window"></a>

### UI-APP-SAVE-WINDOW — 存档窗口单例与屏幕栈挂载

- **Owner**：[src/app/session.ts:69,155–188,357](../../src/app/session.ts#L69)。
- **编码**：`saveWindow` 卸载闭包、`route`、dialog/unregister 局部引用。
- **逻辑状态**：未挂载 → 导出文本初始化 → 注册 modal screen → 退场等待 → closed 回调卸载。
- **事件 / guards / 转换**：已有 saveWindow 或 route=run 拒绝打开；locked 以空文本+错误打开；closed 调 saveWindow，清引用后 unregister/dispose。
- **取消 / 终态**：app dispose 主动调用 saveWindow；后续异步文本操作由 dialog 的 disposed/closing 屏蔽。
- **不变量**：只有一个存档窗口；由 app 拥有 dispose，host 只负责栈/绘制。
- **测试 / 风险**：[ui-save-dialog.test.mjs](../../scripts/ui-save-dialog.test.mjs) 测内部编辑，不测 app 单例与设置交叉退场；既有审计 **#11** 在此交接暴露。

<a id="ui-app-reveal-work"></a>

### UI-APP-REVEAL-WORK — 首屏揭幕后预取、菜单音乐和提示去重

- **Owner**：[src/app/session.ts:75,79–81,86–89,128–130,233–236,329,347,351,408–413](../../src/app/session.ts#L75)。
- **编码**：`revealed/quietUntil/notification/noteId`、host.revealed Promise、audio error unsubscribe。
- **逻辑状态**：等待揭幕 → 开启后续预取 / 播菜单音乐；导航时有声或150ms静默窗；通知无/带递增id；disposed。
- **事件 / guards / 转换**：revealed 完成且未 dispose 才 openPrefetch；当前非 run 才 menu；出发声设置 quietUntil，covering 不重复过场声；重复文本也递增 id 触发 toast 重播。
- **取消 / 终态**：app dispose 移除音频错误监听；晚到 revealed 不执行工作。
- **不变量**：首屏之前不启动后续菜单预取；id 区分同文案不同通知；UI 持有所需音效由 host 管。
- **测试 / 风险**：[ui-audio-holders.test.mjs](../../scripts/ui-audio-holders.test.mjs) 仅静态音效持有；**#18** 下层已按 hold 身份去重，见 [资源 A09](resources.md#a09)。正式 UI 紧邻取消/重播的原可达性限制不变；host fail/dispose 不 settle revealed（区别于 nextScreenReady），只靠 disposed guard 防后效。

<a id="ui-room-ownership"></a>

### UI-ROOM-OWNERSHIP — 联机窗口连接、重返凭据及向对局移交

- **Owner**：[src/ui/gpu/multiplayer-session.ts:14–85](../../src/ui/gpu/multiplayer-session.ts#L14)；[src/app/session.ts:193–225](../../src/app/session.ts#L193)。
- **编码**：`session/handedOff/ticket/room`；`onChange/onTicket/onWarning/onStart`、register/unregister。
- **逻辑状态**：未连接 → connecting → 房间更新 → handedOff（run 接管）；取消/关窗 → 关闭连接；创建异常 → error view。
- **事件 / guards / 转换**：loadRejoin 读取失败记录并通知，继续无凭据的窗口；connect 先 cancel 旧 session；onStart 先置 handedOff 再构造 MultiplayerRun 并 start；移交触发父层 closeRoom，但卸载不会 close 已移交连接；重返仅 ticket.url 匹配。网络 session 的凭据写入/清除异常通过 onWarning 报告。
- **取消 / 终态**：取消清 onChange、close、清引用；screen 卸载后只在 !handedOff 时 close。
- **不变量**：连接在窗口与 run 之间只有一个 owner；窗口卸载不得杀死刚接管的 run；旧连接事件不得更新新窗口。
- **测试 / 风险**：[ui-multiplayer.test.mjs](../../scripts/ui-multiplayer.test.mjs) 主要 view/keypad；**#4** 新增 [network-storage.test.mjs](../../scripts/network-storage.test.mjs) 定位凭据故障隔离，完整网络交付由主线程收尾。connect 的 catch 仍将创建失败统一成“连接中断”。

<a id="ui-run-boot"></a>

### UI-RUN-BOOT — 单局会话加载、快照和失效

- **Owner**：[src/run/session.ts:46–75,207–230,255–262,274–295](../../src/run/session.ts#L46)。
- **编码**：`run/snap/status/error/zoneLoading/disposed/refreshQueued`、multiplayer connection callback、unregister。
- **逻辑状态**：loading → ready；loading/ready → error；ready↔zoneLoading；联机 suspended/reconnecting 为并行输入；dispose。
- **事件 / guards / 转换**：createRun onReady 先调用 onStarted；返回 false 则抛出背包保存失败，进入 error；成功后才设置 ready、sound、恢复暂停，返回 createRun 激活世界。onError 记录消息；onSnapshot 更新 snap；连接/地图载入变化 refresh。
- **取消 / 终态**：dispose 断 connection callback，unregister，清 banner timers，dispose run/overlays/hud；微任务检查 disposed。
- **不变量**：run 创建后才注册 HUD/overlay/controller；HUD 的 snapshot/theme 与最近快照一致；背包提交成功前没有世界 advance 注册；host fatal 由应用 owner dispose，区别于本局 error 窗口。
- **测试 / 风险**：[ui-run-session.test.mjs](../../scripts/ui-run-session.test.mjs) 有背包拒绝/重试与 host fatal 会话夹具；createRun 激活顺序仍需主线程最终审阅，不以替代依赖夹具称正式 Web/native 验收。

<a id="ui-run-overlay-select"></a>

### UI-RUN-OVERLAY-SELECT — 对局覆盖层优先级与互斥

- **Owner**：[src/run/session.ts:49–62,77–135](../../src/run/session.ts#L49)。
- **编码**：`status/result.saved/stats/paused/quitting/mapOpen/banishing/snap.pending/snap.dialog/zoneLoading`，网络 `reconnecting/suspended`。
- **逻辑状态**：save-error（result 未保存）> error > result > reconnecting > loading > choice > stats > pause > station > none；另有 HUD blocked / visible / notice。
- **事件 / guards / 转换**：所有快照和 UI 意图触发 refresh；单人 pending 自动优先，合作 pending 仅 !stats&&!paused&&!mapOpen 时显示；choice dismissible 取决于 multiplayer。
- **取消 / 终态**：priority 改变由 overlays.update 接管旧树；save-error 只提供保存重试，无退出/关闭入口；成功后显示 result 或执行此前 leaving 意图。result/error 通过其各自按钮或 session dispose 离开。
- **不变量**：一次只产生一个 RunOverlayState；modal 与 dock 区分；HUD blocked 同时考虑 app modal、overlay modal、mapOpen。
- **测试 / 风险**：[ui-run-choice.test.mjs:195,252](../../scripts/ui-run-choice.test.mjs#L195)、[ui-run-overlays.test.mjs:63](../../scripts/ui-run-overlays.test.mjs#L63) 测下层；无完整优先级组合测试。显式 kind 列表不包含上述跨 flag 的实际机器。

<a id="ui-run-pause"></a>

### UI-RUN-PAUSE — 暂停意图、属性、地图与退出确认

- **Owner**：[src/run/session.ts:136–153,156–160,174–188,248–258](../../src/run/session.ts#L136)。
- **编码**：`paused/stats{sheet,from}/quitting/mapOpen/modalActive/result/snap.pending/dialog`。
- **逻辑状态**：游戏 → pause → quit-question/cancel；游戏或 pause → stats → 回到原 paused 意图；地图打开单独屏蔽；失焦暂停请求。
- **事件 / guards / 转换**：setPaused 发 `paused||stats!==null`；openStats 被 modal/map 挡住；closeStats 用 paused 恢复；pause request 拒绝 modal、单人 pending、station、result；退出确认只改 quitting。
- **取消 / 终态**：closeStats 清 stats；leave 导向 UI-RUN-LEAVE；dispose 终止 controller。
- **不变量**：关闭属性不能误恢复原本暂停的世界；地图和 app modal 不可穿透统计快捷键；`from` 存在但当前恢复依赖 paused。
- **测试 / 风险**：下层 [ui-input.test.mjs](../../scripts/ui-input.test.mjs) 测动作上下文，网络测试测 pause intent；没有本 session 状态组合专测。

<a id="ui-run-leave"></a>

### UI-RUN-LEAVE — 放弃/重开、终局回调与结算去向

- **Owner**：[src/run/session.ts:55–57,141–148,169–191,263–271](../../src/run/session.ts#L55)；[src/app/session.ts:277–293](../../src/app/session.ts#L277)。
- **编码**：`leaving/status/result{result,note,saved}`、saveResult、onFinish/onRetry/onLobby 回调；network owner。
- **逻辑状态**：无离开意图 → retry/lobby 意图；ready 时发送 forfeit 等 onEnd；未 ready 直接导航；onEnd → 未保存结果 → 保存成功后结算/导航，或 save-error 留存重试。
- **事件 / guards / 转换**：已有 leaving 拒绝重复；onEnd 先存 result，saveResult 调 onFinish；失败保留 saved=false 与 leaving，成功才置 saved=true、记录 note 并执行原去向。save-error 的 retry 只重试保存；多人重开回大厅房间。
- **取消 / 终态**：父级导航 dispose run；onEnd 仍依赖 createRun 一次上报，保存重试不重复上报；saved=true 后不再次调用 onFinish。窗口没有丢弃未保存结果的退出操作；会话级 fatal/dispose 是另一个边界。
- **不变量**：每局记账一次；只有完成结算才能交付正常退出；有意退出和网络恢复状态不能互相覆盖。
- **测试 / 风险**：**#20** 的自然结算、重开/返回保存失败后重试由 [ui-run-session.test.mjs](../../scripts/ui-run-session.test.mjs) 会话夹具定位；[ui-run-overlays.test.mjs](../../scripts/ui-run-overlays.test.mjs) 检查 save-error 只重试、不响应取消离开。真实 createRun 的注册、拒绝与取消另由 ui-run-activation.test.mjs 保护；**#2/#3** 见网络地图。

<a id="ui-run-banish"></a>

### UI-RUN-BANISH — 当前待选卡的放逐武装状态

- **Owner**：[src/run/session.ts:59,94–105,192–203](../../src/run/session.ts#L59)。
- **编码**：`banishing:number|null` 与 `snap.pending.id`，pick/banish 命令 card id。
- **逻辑状态**：未武装 → 武装当前 pending id → 放逐提交/取消；新 pending 自动表现为未武装。
- **事件 / guards / 转换**：toggle 比较 id；pick 读取当前 pending，发 pick 或 banish；banish 后清 id；无 pending 不提交。
- **取消 / 终态**：新卡身份使旧武装失效；session dispose 终结。
- **不变量**：武装状态不跨卡继承；命令携带 pending id 让模拟拒绝过期选择。
- **测试 / 风险**：[combat.test.mjs:980](../../scripts/combat.test.mjs#L980) 是 stale reroll 防护；UI banish 具体按键在 choice 内容层；未见 session 层乱序专测。

<a id="ui-run-banners"></a>

### UI-RUN-BANNERS — 单条战斗消息与持续等待

- **Owner**：[src/run/session.ts](../../src/run/session.ts)；[src/ui/gpu/run-hud.ts](../../src/ui/gpu/run-hud.ts)；[src/run/createRun.ts](../../src/run/createRun.ts)。
- **编码**：`notice/noticeId/noticeTimer/noticeExpiresAt/refreshQueued/disposed`；HUD `noticeId/noticePose/noticeHeight`。
- **逻辑状态**：空 → 显示 → 过期；危险优先，重复不续期，较低优先级不排队；窗口隐藏不冻结期限；waiting 派生持续提示。
- **事件 / guards / 转换**：createRun 依事件语义和玩家身份分派，守卫/暴走由常驻 HUD 承接；会话扣除网络交付年龄后使用一个计时器。刷新也核对单调时钟，后台计时器延迟不能使过期文字复活。
- **取消 / 终态**：换区、错误、结算及 dispose 清理当前消息和计时器；微任务晚到检查 disposed；新提示替换前取消旧计时器。
- **不变量**：消息不离开生命组侧列，不接管输入；世界危险事件不因通知合并或过期而丢失；个人收益不发给其他玩家。
- **测试 / 风险**：`ui-run-session.test.mjs` 覆盖优先级、过期与清理，`ui-run-activation.test.mjs` 覆盖事件归属；联机交付年龄由网络测试覆盖。绘制布局和墨迹仍须用正式 GPU 页面检查。

## B. GPU 宿主、舞台和输入所有权

<a id="ui-host-life"></a>

### UI-HOST-LIFE — GPU 宿主启动、fatal 与清理

- **Owner**：[src/ui/gpu/app-host.ts:125–158,194–199,967–983,1352–1371](../../src/ui/gpu/app-host.ts#L125)。
- **编码**：`signal/destroyed/failed/contextLost/state/forceDraw`、platform/texture/uiSounds、app.setUi/resident/listen 注销闭包。
- **逻辑状态**：创建中 → active；创建 abort → reject；active → failed（画布隐藏/输入取消）；active/failed → destroyed。
- **事件 / guards / 转换**：创建先设字体/图片 loader 与音效 hold，背景通过 `/art/lobby/backdrop.webp` 进入发布映射；微任务后检查 abort；advance/draw catch 调 fail；fail 单次执行并 settle readiness waiters、取消输入，再经 app 回调 dispose 会话并报告平台错误；idle 综合多个状态。
- **取消 / 终态**：dispose 幂等，释放宿主所拥有对象；screen/run 的 dispose 属调用者。
- **不变量**：已销毁 host 不再更新/绘制；图像/声音 hold 配对释放；fatal 不能被当成功。
- **测试 / 风险**：**#1/#14** 分别有 [ui-run-session.test.mjs](../../scripts/ui-run-session.test.mjs) fatal 会话夹具和 [ui-host.test.mjs](../../scripts/ui-host.test.mjs) 背景路径夹具；均不是正式 GPU 页面验收。部分初始化仍在统一清理覆盖之前，不能外推为所有构造异常均已验证。

<a id="ui-host-stack"></a>

### UI-HOST-STACK — screen 栈与单一 run 注册

- **Owner**：[src/ui/gpu/app-host.ts:190–193,210–214,991–1012,1257–1305](../../src/ui/gpu/app-host.ts#L190)。
- **编码**：`screens/screen/runLayer/prepared/runModal/runBlocked`，返回的 unregister 闭包。
- **逻辑状态**：空 → 基础 screen → overlay screen（顶层接管）；或唯一 run；注销恢复下层；下层 dimmed/covered 且时钟停走。
- **事件 / guards / 转换**：registerScreen push 后取消旧输入、绑定焦点、resize/focus；unregister splice 再取 last；registerRun 重复时抛错；模态变化取消旧按键/摇杆。
- **取消 / 终态**：unregister 释放 fonts stage hold；app owner 再 dispose 页面；run 注销清引用。
- **不变量**：屏幕栈顶接输入，下层保留绘制；run 最多一份；注销闭包依赖恰好调用一次。
- **测试 / 风险**：独立 host 夹具为既有审计证据。registerScreen 的 splice(indexOf(next),1) 没有二次注销防护，误重入会删别的末项；当前调用约定是单次，未证明正式路径重入。

<a id="ui-host-prepare"></a>

### UI-HOST-PREPARE — UI 程序、字体、图片准备屏障

- **Owner**：[src/ui/gpu/app-host.ts:797–855,1001–1011,1026–1050,1076–1082,1348–1350](../../src/ui/gpu/app-host.ts#L797)。
- **编码**：`compiling:Set<UiStage>`、`preparing:Map<stage,{token,done}>`、app.generation、prepared WeakSet、preparedHud/Overlays/Dialog/Codex、screenWaiters/preparingWaiters。
- **逻辑状态**：未准备 → compile/pages/images 等待 → ready；同 stage 新 revision 替代旧准备；failed/aborted/lost/destroyed。
- **事件 / guards / 转换**：prepare 检测新程序/缺页/未上传图片；等待 Promise.all；只有当前 token 且 GPU available/generation 匹配才能删 compiling；旧 token 跟随新 done；overlay revision 重建再 prepare。
- **取消 / 终态**：AbortError 不升级 fatal；其他 failure→host fail；screen waiter 在 ready/fail/dispose 都 settle；context loss 清集合。
- **不变量**：未就绪 stage 不绘制也不接输入，动画 delta=0；旧准备不得释放新 hold；遮罩不能永久等待已失败 host。
- **测试 / 风险**：[ui-prepare.test.mjs](../../scripts/ui-prepare.test.mjs) 和 [ui-font-revision.test.mjs](../../scripts/ui-font-revision.test.mjs) 保护下层 revision/generation，但未找到完整 host 多窗口准备测试。screen unregister 未直接删 compiling/preparing，晚到结果依字体 release/host 状态处理。

<a id="ui-host-first"></a>

### UI-HOST-FIRST — 首屏揭幕与后台预热副本

- **Owner**：[src/ui/gpu/app-host.ts:857–966,1136–1154](../../src/ui/gpu/app-host.ts#L857)。
- **编码**：`prefetched/firstScreenReady/revealed/reveal`；first screen 引用；warmTarget、warmUi Promise、临时 Settings/Toast/Lobby/Lab 对象。
- **逻辑状态**：仅背景 → 等首屏页/图片/UI声音 → revealed → 后台 core-font prefetch/各页面预热；失败/销毁跳过揭幕。
- **事件 / guards / 转换**：draw 首次触发 Promise.all；完成后检查 destroyed/failed，允许所有 screen revealed，通知 app；预热每个副本 layout→images→compile→offscreen draw→dispose。
- **取消 / 终态**：预热成功失败均 dispose 副本；warmUi 在 await 后检查 available/destroyed；host dispose 释放 warmTarget。
- **不变量**：预热的副本不接受用户输入；首屏所需资源先于后续资源；首屏 promise 是单次门闩。
- **测试 / 风险**：没有直接 host 首屏测试。`warmSurfaces` 副本未集中追踪，部分后续 `stage.update(0)` 可在 host 销毁后继续；`warmUi(shell.stage)` 无 rejection handler。静态待验证，不能把 lower-level prepare 测试算作覆盖。

<a id="ui-host-context"></a>

### UI-HOST-CONTEXT — UI context 丢失、驻留资源与恢复

- **Owner**：[src/ui/gpu/app-host.ts:725–768,797–804,1122–1135](../../src/ui/gpu/app-host.ts#L725)。
- **编码**：`contextLost/renderer/retention/seenPrograms`、编译集合、prepared 标记、lastSize；app resident hooks。
- **逻辑状态**：可用 → lost（输入停/上传释放/准备失效） → restored（新 renderer retention、重新准备）→ disposed。
- **事件 / guards / 转换**：lost 包括隐藏 screen 和退场树 releaseUploads；native field setCovered(true)；restore 取 app.renderer、resize/所有 stage invalidate；后续 draw 归因保留 UI programs。
- **取消 / 终态**：dispose 注销 resident/retention；字体/图像 CPU 资源由各自 registry 持有。
- **不变量**：旧 GL program 不跨 generation 复用；context loss 不等同业务页面销毁；保留 UI programs 不能吞掉 world programs 所有权。
- **测试 / 风险**：[ui-font-revision.test.mjs:167,179](../../scripts/ui-font-revision.test.mjs#L167) 下层恢复测试；历史 native/接缝 QA，未重跑真实 context-loss。模型预览还拥有自己的编译机器，不能只靠 host 证明其安全。

<a id="ui-host-settings"></a>

### UI-HOST-SETTINGS — 设置窗口请求状态与退场对象共存

- **Owner**：[src/ui/gpu/app-host.ts:185–187,368–421,1083–1095,1307–1345](../../src/ui/gpu/app-host.ts#L185)。
- **编码**：`state.settingsOpen/dialog/closing/dialogSettings/dialogCanSave/modalActive`，dialog.exitFinished。
- **逻辑状态**：无窗口 → 打开/准备 → 可交互 → closing（对象还在） → 无窗口；退场期间再次请求打开 → 旧对象释放后重建。
- **事件 / guards / 转换**：open 构造并 notifyModal(true)；closeDialog cancelInput+dialog.close+closing；onSave 同时请求设置关闭和打开存档；外部偏好/canSave 变化在非 closing 时重建。
- **取消 / 终态**：220ms 退场完成释放 fonts/dialog，notifyModal(false)；不再额外 cancelInput 清掉新窗口已接管的按压；必要时立刻 createDialog；host dispose 立即销毁。
- **不变量**：业务请求关闭与动画 owner 释放分开；旧窗口只可画退场；设置和存档交叉动画不得丢输入。
- **测试 / 风险**：**#11** 已统一目标选择，新增 [ui-host.test.mjs](../../scripts/ui-host.test.mjs) 的 settings-save-input 夹具；核对真实宿主逻辑但替换绘制依赖，不是设备或退场视觉验收。本次未重跑历史 browser 脚本。

<a id="ui-host-codex"></a>

### UI-HOST-CODEX — 图鉴异步 import、打开与退场

- **Owner**：[src/ui/gpu/app-host.ts:188–189,423–460,1043–1061](../../src/ui/gpu/app-host.ts#L188)。
- **编码**：`codexLoading/codex/state.busy/dialog/screen/runLayer/destroyed/failed`、捕获的 `homeScreen/homeRun/homeWindow` 与 stillHome、overlays.codexHome revision、import Promise、opened 闭包、exitFinished。
- **逻辑状态**：未加载 → 加载模块 → 显示/准备 → 关闭动画 → dispose；加载失败通知并可重试。
- **事件 / guards / 转换**：打开拒绝 busy/dialog/已开/正在加载/无 home；home 为当前 screen 或非退出确认的暂停窗 codexHome revision。捕获 screen/runLayer/homeWindow，成功后 stillHome 校验三者及宿主存活，再检查 busy/dialog 并创建 codex、notifyModal；close 请求只 closeWindow，帧驱动释放。
- **取消 / 终态**：模块加载不取消；成败回调均检查 stillHome，旧页面结果不打开图鉴也不通知新页面。暂停关闭立即使 codexHome=null，退场绘制仍 isModal 不代表请求有效；重开暂停的新 revision 也不能接旧请求。图鉴窗口退出取消输入/字体 hold/dispose。
- **不变量**：异步完成必须仍属于发起页面；同一时间最多一个 codex 实例。
- **测试 / 风险**：**#10** 已补来源身份与暂停 revision 检查；[ui-host.test.mjs](../../scripts/ui-host.test.mjs) 有切研究所、进入/替换对局、关闭暂停后 import 完成的夹具；[ui-codex.test.mjs](../../scripts/ui-codex.test.mjs) 仍仅为内容表测试。本次未执行正式页面切换。

<a id="ui-host-target"></a>

### UI-HOST-TARGET — 多输入路径的模态目标仲裁

- **Owner**：[src/ui/gpu/app-host.ts:248–291,629–691,1161–1240](../../src/ui/gpu/app-host.ts#L248)。
- **编码**：`activeTarget()`、`owner()`、`syncInputOwner()`、`inputOwner/inputRevision/choiceRevision/pressedTarget/pressedRevision`、state.busy/shell.blocking/compiling/closing/inputFocused。
- **逻辑状态**：blocked；settings；codex；overlay；screen；gameplay；合作 choice 与 gameplay 共用 owner。
- **事件 / guards / 转换**：指针、键盘导航与 gamepad owner 复用 activeTarget，跳过 closing 设置树；尚未准备好的当前窗口仍阻挡下层。syncInputOwner 在接收 pointerdown/keyDown 前及 sample 时共用：目标/revision 变化先 cancelInput，再接新按压，避免下一采样误清首个按压；choice revision 仅取消卡手势，不取消移动。gamepad frame 动作逐条执行，owner 变更即停；confirm/cancel/resume 后消费剩余动作；键盘物理快捷键仍保留各自用途。
- **取消 / 终态**：blur、busy、窗口/目标变化、context loss、dispose 取消持有；目标未编译时不接输入。
- **不变量**：旧按下不能激活新窗口；三输入应选同一业务 owner；一帧旧动作不能在新页复用。
- **测试 / 风险**：[ui-input.test.mjs](../../scripts/ui-input.test.mjs)、[ui-run-choice.test.mjs](../../scripts/ui-run-choice.test.mjs) 为局部契约；**#11** 的设置→存档三输入交接定位在 [ui-host.test.mjs](../../scripts/ui-host.test.mjs)。合成输入不表示已完成真实设备矩阵。

<a id="ui-host-pointers"></a>

### UI-HOST-POINTERS — 指针捕获、HUD/地图/摇杆/卡片分流

- **Owner**：[src/ui/gpu/app-host.ts:206–209,273–320,462–590](../../src/ui/gpu/app-host.ts#L206)。
- **编码**：`pointers/hudPointers/mapPointers/worldPointer`、MenuInput press、pressedTarget/revision、hovered/rehover。
- **逻辑状态**：无捕获 → toast/menu/codex model/HUD/map tap/world stick owner；拖动；正常释放或 cancel。
- **事件 / guards / 转换**：第一次切 touch 的 run touch 只切模式；down 优先 shell/toast/activeTarget，dock 外保留世界；地图以8px判断点击；浮动摇杆半径52×runScale，8px死区；up 比对 owner/revision、长按消费后才 activate。
- **取消 / 终态**：cancelInput 全量释放 captures、HUD turn/stick、controller；单个 cancel 只归还对应 id；第二 dock touch 被消费而不泄到世界。
- **不变量**：每手指只有一个手势归属；取消不得提交点击；旧卡 revision 的 release 不操作新卡；世界摇杆至多一个指针。
- **测试 / 风险**：[ui-menu-input.test.mjs](../../scripts/ui-menu-input.test.mjs) 单指/取消、[ui-run-choice.test.mjs:252](../../scripts/ui-run-choice.test.mjs#L252) held-turn；没有全部 host pointer 分流的正式单测。大厅 swipe 初始化依宿主先拿到 target，空白区捕获是否完整需真实入口验证。

<a id="ui-host-mode"></a>

### UI-HOST-MODE — 输入模式、焦点可见性和光标

- **Owner**：[src/ui/gpu/app-host.ts:181–244,515–516,629–640,696–724,1171–1239](../../src/ui/gpu/app-host.ts#L181)。
- **编码**：`inputMode/coarse/focusVisible/previousInputTime`、ActionInput.onActivity/onUnsupported，platform cursor/focus，所有 screen focus/coarse flags。
- **逻辑状态**：keyboard（可见焦点）↔mouse（光标/无焦点框）↔touch（coarse）↔gamepad（焦点框/无光标）；窗口失焦/手柄断开。
- **事件 / guards / 转换**：活动切换更新所有 glyph/焦点；touch↔非touch 取消旧手势；键重复不重新声明模式；blur/断开 cancelInput、controller.blur；震动发送及 stop/reset 链已删除。
- **取消 / 终态**：会话 input.dispose、host 停平台监听；模式是 view，不等同 ActionInput 的设备认领机器。
- **不变量**：模式变化同步所有可见 surface；控制器断连立即归零；鼠标移动可以取回 pointer 模式。
- **测试 / 风险**：[ui-input.test.mjs:44,65,92,105,124](../../scripts/ui-input.test.mjs#L44) 为平台动作层；真实硬件未验证。**#12** SDL key 规范化为上游关联，不在此子任务逐项盘点。

<a id="ui-host-toast-focus"></a>

### UI-HOST-TOAST-FOCUS — Toast 的 Tab 接力与安装提示一次性声明

- **Owner**：[src/ui/gpu/app-host.ts:164–180,294–301,591–623,1068–1074,1315–1324](../../src/ui/gpu/app-host.ts#L164)。
- **编码**：`hint:due/shown/done/toastId/toastOwner`、toast.keyed/visible、screen.tabEdge、platform.claimInstallHint。
- **逻辑状态**：hint 到期但 portrait 暂缓 → claimed/shown → done；普通通知替代 hint；屏幕末控制 Tab→toast close→返回屏幕。
- **事件 / guards / 转换**：首屏揭幕后 hint=due；只有横屏、未failed/destroyed才 claim；新 notification id 重播 toast；toast 不主动抢焦点，只有无 dialog/codex/run/modal/busy/lost 时进入 ring。
- **取消 / 终态**：toast 消失、被新窗口盖住或 owner 改变后 leaveToast；hint dismiss 标 done；普通通知 dismiss 回父层清 notification。
- **不变量**：Toast 非 modal；安装提示只声明一次；关闭/超时恢复原 surface focusVisible。
- **测试 / 风险**：历史 [ui-toast.browser.mjs](../../scripts/ui-toast.browser.mjs) 测 timer/focus，host Tab ring 未直接测；安装提示依平台 claim 持久化，平台故障不在此展开。

<a id="ui-shell"></a>

### UI-SHELL — 竖屏遮罩与过场绘制并行状态

- **Owner**：[src/ui/gpu/app-shell.ts:73–77,139–165,178–227](../../src/ui/gpu/app-shell.ts#L73)；host `onPortrait:710`。
- **编码**：`phase/age/phaseAge/portrait`，curtain materials.visible、notice.display。
- **逻辑状态**：idle landscape 不挡；covering/revealing 挡；portrait 优先显示 notice 并挡，无论导航 phase。
- **事件 / guards / 转换**：setTransition 重置 phaseAge、covering 重置总 age；setPortrait 隐藏 curtain 但保留 phase；update 继续推进 curtain 计算；返回横屏恢复当前 phase 的视觉。
- **取消 / 终态**：host dispose→shell dispose；业务导航时钟在 SceneTransition，shell 不自己提交页面。
- **不变量**：blocking=portrait||phase!=idle；竖屏不清空页面状态；资源准备不能因 notice 被误当完成。
- **测试 / 风险**：无直接 shell 生命周期测试；竖屏只阻塞输入/显示，是否暂停 world 属 run/platform 链，不能从 shell 注释推断已暂停。

<a id="ui-stage"></a>

### UI-STAGE — 布局/动画 dirty、绘制请求和资源阶段

- **Owner**：[src/ui/gpu/stage.ts:8–12,15–84,97–145](../../src/ui/gpu/stage.ts#L8)。
- **编码**：`dirty/layoutGrid/viewport/motion`、全局 framebufferRatio，UIKit requestFrame。
- **逻辑状态**：clean → invalidated → layout/motion update → dirty 待绘制 → clean；GPU upload release 与对象 dispose 分开。
- **事件 / guards / 转换**：update 先记录清 dirty，运行 motion、DPR layoutGrid 变更重排，UIKit 更新可再次置 dirty；render/compile 在 UI renderer 状态事务内运行。
- **取消 / 终态**：withUiState finally 恢复 renderer；releaseUploads 保留树；dispose 先 motion 再逆序组件清理。
- **不变量**：布局过程中产生的帧请求不能丢；每 stage 先设置自己的像素网格；UI toneMapping 等不得污染 world。
- **测试 / 风险**：[ui-stage.test.mjs:6](../../scripts/ui-stage.test.mjs#L6)、[ui-edge-snap.test.mjs:8,41,91](../../scripts/ui-edge-snap.test.mjs#L8)；完整 GL 清理不是这些纯布局测试的范围。

<a id="ui-gesture"></a>

### UI-GESTURE — MenuInput 单指点击/拖动/hover

- **Owner**：[src/ui/gpu/menu-input.ts:13–90](../../src/ui/gpu/menu-input.ts#L13)。
- **编码**：`press{id,index,x,y,lastY,dragged}/pressedIndex/resting`，target callbacks。
- **逻辑状态**：idle/hover → pressed → dragged（不可逆）→ release/cancel；鼠标 resting 可在滚动后重新 hit。
- **事件 / guards / 转换**：只接受第一个 id；8px 后 dragged，取消 pressed 并滚动；up 必须同 id、未drag、仍同 hit，先清按压再 activate；leave 只清hover；refresh 不影响press。
- **取消 / 终态**：cancel 可指定 id，全量取消不自动清 resting；目标销毁前 host 调 cancel/leave。
- **不变量**：拖滚不能变点击；第二根手指不能偷 owner；业务回调看到的按压已释放。
- **测试 / 风险**：[ui-menu-input.test.mjs:41,51,66,74,88,103](../../scripts/ui-menu-input.test.mjs#L41) 明确覆盖；目标替换的 revision 防护在 host，不在本类。

<a id="ui-motion"></a>

### UI-MOTION — keyed tween 的替换、完成和取消（共享模式）

- **Owner**：[src/ui/gpu/motion.ts:20–71](../../src/ui/gpu/motion.ts#L20)；`codex-parts.ts:208–260`、`settings-dialog.ts:707` 的 per-property ColorTween。
- **编码**：`time/group/tracks:Map<object,stop>`；颜色缓存 target/property/targetHex/value。
- **逻辑状态**：无 track → 动画中 → 完成移除；新 animate 同对象替换旧 track；duration=0 立即提交；dispose 后清空。
- **事件 / guards / 转换**：替换从当前可见值开始；onComplete 删 track/group；颜色目标相同不重启；forget 取消该对象所有颜色轨道。
- **取消 / 终态**：cancel(state)、forget(target)、motion.dispose；所属组件卸载必须主动 cancel 自己的对象。
- **不变量**：同 state 最多一条 tween；已释放控件不能再被旧 callback 写属性。
- **测试 / 风险**：[ui-motion.test.mjs:5,24](../../scripts/ui-motion.test.mjs#L5)、[ui-focus-mark.test.mjs:6,34,54](../../scripts/ui-focus-mark.test.mjs#L6)；直接创建 Tween（station swing）需额外 stop/remove，不完全由 tracks 代管。

<a id="ui-control-visual"></a>

### UI-CONTROL-VISUAL — 按钮/焦点/选中/禁用反馈与装饰时钟（共享模式）

- **Owner**：`game-button.ts:63–67,153–259`、`focus-mark.ts:31–86`、`hover-pattern.ts:43–44,130–165`、`segment-face.ts:57–58,79–141`、`codex-parts.ts:69–135`，均在 `src/ui/gpu/`。
- **编码**：hovered/focused/focusVisible/pressed/disabled/selected，上一 target、tween value、pattern focused/elapsed；全局 idle.time/previous。
- **逻辑状态**：rest/lit/pressed/disabled；focus marker 淡入/淡出；pattern lit 时 drift、unlit 原地停；遮挡 surface delta=0 冻结。
- **事件 / guards / 转换**：输入 owner 提供 flags，组件只派生视觉；禁用压过按压/点亮；同值去重；15Hz/30Hz idleTicked 合并重绘。
- **取消 / 终态**：组件 dispose 取消 tween、释放 marker/pattern 等；共享 clock 本身应用级无 reset。
- **不变量**：视觉禁用不等于业务 guard（调用者仍需 enabled）；聚焦只改变呈现，不更改模拟；装饰连续相位不单列为业务机器。
- **测试 / 风险**：[ui-hover-pattern.test.mjs:13,43](../../scripts/ui-hover-pattern.test.mjs#L13)、focus-mark/motion 测试；同模式覆盖 `currency.ts:75`、`dialog-surface.ts:101`、lobby launch/cards、lab tile、choice cards/banner、multiplayer seat arrival/spinners、HUD ready/slot pulses、toast press 等，各业务提交时序另列。

<a id="ui-tip"></a>

### UI-TIP — 提示框锚点、退场保留与布局就绪

- **Owner**：[src/ui/gpu/tooltip.ts:74–86,137–186,254–259](../../src/ui/gpu/tooltip.ts#L74)。
- **编码**：`want/anchor/raw/laid/side/edge/avoid/motion`。
- **逻辑状态**：hidden → 新锚点等待字体/尺寸 → entering/shown → want=null 但旧 anchor 保留退场 → hidden；clear 立即隐藏。
- **事件 / guards / 转换**：show 按 anchor 身份去重；改目标启动120ms，关100ms；字体出现才换行，update 定位；opacity归零才清anchor。
- **取消 / 终态**：目标树拆前 clear；dispose cancel motion/remove/dispose。
- **不变量**：退场可继续用原锚点定位；提示不接业务点击；不应引用已拆控件。
- **测试 / 风险**：未见独立 tooltip 生命周期测试。相同 anchor 文案更新被 `if(anchor===want)return` 忽略，lab 可变余额/锁原因同锚点变化时需验证；这是源码可见限制，未新复现。

<a id="ui-tip-press"></a>

### UI-TIP-PRESS — 长按/锁定点击提示（共用重复模式）

- **Owner**：[src/ui/gpu/lobby.ts:488–495,1760–1855](../../src/ui/gpu/lobby.ts#L488)；`lab.ts:152–156,1010–1046`；`codex.ts:184–187,1414–1448,1502–1512`；`run-overlays.ts:139–141,1126–1146,1408–1420`。
- **编码**：`tipPress{index,at,x,y,fired}/touchTip/hoveredTip/hovered/focusVisible/elapsed`。
- **逻辑状态**：未持有 → 等长按 → fired/showing；短点锁控件 toggle tip；鼠标hover/键盘focus为平行提示来源。
- **事件 / guards / 转换**：移动>10px取消未触发长按；450ms后fired；pointerUp fired 返回true阻止激活；触摸提示优先于hover再focus；换目标/导航/滚动/重建依各实现清除。
- **取消 / 终态**：host cancel 调 pointerUp(false)；窗口/内容dispose；codex额外owner id防二指。
- **不变量**：长按不得再执行原按钮；已删除控件索引不得继续解释为新控件。纯模式相同但 lobby/lab 没有 codex 的 pointer owner 字段，依 host 门控。
- **测试 / 风险**：MenuInput 的测试不覆盖这层先行 pointerDown；lab.buildSection 不像 codex.rebuildControls 清全部 tip refs，切栏后索引重用属于待验证边界。

<a id="ui-layer"></a>

### UI-LAYER — 相对层级/透明度的响应式订阅寿命

- **Owner**：[src/ui/gpu/layer.ts:18–67](../../src/ui/gpu/layer.ts#L18)。
- **编码**：WeakMap `stackOffsets/ownOpacity`，entry对象，abortableEffect，parentContainer/orderInfo/properties信号。
- **逻辑状态**：首次注册 → 挂父/换父/祖先属性变更自动重算；再次调用更新 own值；component.abort 结束订阅。
- **事件 / guards / 转换**：stack相对parent majorIndex；fade乘parent inheritedOpacity；属性相同不写，分别专属slot。
- **取消 / 终态**：component abort注销effect；WeakMap随对象回收。
- **不变量**：子fade不覆盖祖先fade；fade不重排层级；同component重复调用不产生第二份effect。
- **测试 / 风险**：[ui-layer.test.mjs:9,34,54](../../scripts/ui-layer.test.mjs#L9)；这是树关系/订阅生命周期，并非每个opacity数值一台机器。

<a id="ui-glyphs"></a>

### UI-GLYPHS — 全局输入提示符注册与刷新

- **Owner**：[src/ui/gpu/input-glyph.ts:4–15,18–58,131–134](../../src/ui/gpu/input-glyph.ts#L4)；辅助 `input-hint.ts:60–84,113–122`。
- **编码**：全局 `mode/mounted:Set<InputGlyph>`；每glyph action/keyboard；InputHint `shown/coarsePointer/backing.visible`。
- **逻辑状态**：构造注册 → 按键鼠/touch/gamepad family 显示 → 模式变化重画 → dispose注销；独立 backing 与UI树显隐同步。
- **事件 / guards / 转换**：同kind/family不重绘，仍保存mode；touch隐藏；family切换重建shape子树；hint shown×!coarse 决定 backing。
- **取消 / 终态**：InputGlyph.dispose 从全局set删除再super；hint手动释放树外mesh。
- **不变量**：卸载glyph不再接模式广播；隐藏UI树不能留独立backing；Switch物理位置文字符号按既有bindings。
- **测试 / 风险**：[ui-input.test.mjs](../../scripts/ui-input.test.mjs)、[ui-run-hud-layout.test.mjs:58](../../scripts/ui-run-hud-layout.test.mjs#L58) 间接测试；全局mode/mounted跨host共享，依单host应用约定，未单测并存host。

<a id="ui-gpu-parts"></a>

### UI-GPU-PARTS — UI 图元/图片视图的创建、附着、释放（共享所有权模式）

- **Owner**：[src/ui/gpu/box-shadow.ts:43,99](../../src/ui/gpu/box-shadow.ts#L43)、`icons.ts`、`marks.ts`、`screen-parts.ts`、`run-choice-surface.ts:112–124,152–206`、`run-station-surface.ts`、`run-hud-surface.ts`、`run-overlays-surface.ts`、`toast-surface.ts`、`map-swatch.ts`、`slant-plate.ts`、`inner-screen.ts`、`outlined-text.ts:47`、`scroll-fade.ts:80`、`station-art.ts`、`tag.ts`。
- **编码**：Content/mesh/geometry/material/Texture引用、拥有的parts数组/map；部分 `abortSignal` 清理callback、尺寸cache。
- **逻辑状态**：allocated → mounted/drawing（或hidden） → GPU uploads释放可重建；最终disposed。图片views异步就绪回调invalidate，底层fetch由ImageStore管理。
- **事件 / guards / 转换**：parent按页面/子树重建拆parts；ChoiceArt预先持七张纹理；图片就绪刷新；resize只改缓存与几何，不新增业务状态。
- **取消 / 终态**：显式dispose或Content.abort释放本组件资产；传入共享纹理的装饰只dispose自身材质几何，纹理owner另管。
- **不变量**：拥有者和借用者区别必须保留；stage.releaseUploads与最终dispose不同；拆树时取消仍引用它的动画。
- **测试 / 风险**：[ui-layer.test.mjs](../../scripts/ui-layer.test.mjs)、[ui-images.test.mjs](../../scripts/ui-images.test.mjs)、[ui-model-store.test.mjs](../../scripts/ui-model-store.test.mjs) 分别保护局部资源契约；未测每种图元完整GL清理。此项列清共用模式，shader纯函数/常量表不是独立状态机。

## C. 大厅、研究所、设置、存档、图鉴、联机页

<a id="ui-lobby-pick"></a>

### UI-LOBBY-PICK — 伙伴/地图/难度选择与出发锁

- **Owner**：[src/ui/gpu/lobby.ts:475–487,703,758,947–960,999–1067,1236–1266,1536–1568](../../src/ui/gpu/lobby.ts#L475)。
- **编码**：`progress/selected/difficulty/map/departing/revealed/covered`，callbacks.pick/start，scene引用。
- **逻辑状态**：未揭幕不可命中 → 正常选择；每候选 unlocked/locked，选中另算；departing 一次性锁住输入直到卸载。
- **事件 / guards / 转换**：pick拒绝锁定/同项；difficulty reason guard；地图选择更新map与label并changed；changed提交父级pick；depart先锁定/按压/spin再start；外部 progress 导入 update 重建伙伴信息。
- **取消 / 终态**：scene/window覆盖时停止空闲；页面unmount销毁；departing无本地失败回退，依导航成功或页面重建。
- **不变量**：选择有效性由 `validPick`/unlock契约和局部guard共同保证；出发不得重复提交；禁用选项仍可聚焦看原因。
- **测试 / 风险**：prefetch 下层 [ui-prepare.test.mjs:297](../../scripts/ui-prepare.test.mjs#L297)；未见 GpuLobby 直接状态机测试。start回调拒绝/抛错时departing已置true，需评估正式可达性，未复现。

<a id="ui-lobby-nav"></a>

### UI-LOBBY-NAV — 大厅 roving focus 与轮播手势

- **Owner**：[src/ui/gpu/lobby.ts:479–495,1571–1795](../../src/ui/gpu/lobby.ts#L479)。
- **编码**：focused/hovered/pressed/focusVisible、controls/groups、pointer/wheel/swipe{done}、coarse/departing。
- **逻辑状态**：未聚焦/控件分组聚焦；伙伴轮播 idle→wheel累积或swipe armed→一次切换；发车后冻结。
- **事件 / guards / 转换**：Tab只包含当前radio项；箭头组内focus+activate、锁项只focus；Q/E/Page切伙伴；wheel仅hero区域累积到阈值；swipe横向越阈值且大于纵向后置done只切一次；Esc隐藏焦点。
- **取消 / 终态**：pointerUp清swipe；host cancelInput触发pointerUp；离页dispose。
- **不变量**：一gesture最多切一伙伴；滚轮不应抢右决定列；focus索引应属于当前controls。
- **测试 / 风险**：无直接lobby导航测试；动态buildPartner会改info controls，而host只有overlay revision，未为lobby controls重建加revision，旧按下/释放跨重建需验证。

<a id="ui-lobby-model"></a>

### UI-LOBBY-MODEL — 大厅模型请求身份和缓存持有

- **Owner**：[src/ui/gpu/lobby-scene.ts:207–224,287–327,335–363,518–535](../../src/ui/gpu/lobby-scene.ts#L207)。
- **编码**：`form/request/disposed/current/held<Map<url,{handle,stagedPromise}>>/compiled`。
- **逻辑状态**：无form → fetch/instantiate → compile → current；旧选择留keep lane；新选择使旧完成失效；当前请求失败记录并通知；dispose。
- **事件 / guards / 转换**：show同form忽略；request++；fetch和compile完成两处检查request/disposed；model按URL共享Promise，当前interactive、其余keep。
- **取消 / 终态**：staged 失败只在 held 仍指向该 entry 时移表并释放 handle，再抛出；切换成功缓存只降 lane；dispose 释放全部 handles，晚到实例通过 staged.then dispose；context loss 清 compiled。
- **不变量**：仅最新选择可成为current；同URL只一个held请求；失败缓存应允许后续重试。
- **测试 / 风险**：**#9** 失败项已移除，切离后重新选择可重新获取；[ui-host.test.mjs](../../scripts/ui-host.test.mjs) 的 lobby-retry 覆盖消费者缓存，shared store 测试仍不是该层替代。show 同 form 仍忽略，不宣称自动重试；旧 compile completion 的跨选择复用竞态仍需验证。

<a id="ui-lobby-stage"></a>

### UI-LOBBY-STAGE — 伙伴离场/入场、覆盖暂停与世界层占用

- **Owner**：[src/ui/gpu/lobby-scene.ts:209–226,264–283,301–305,329–333,365–393,395–451,504–535](../../src/ui/gpu/lobby-scene.ts#L209)；`lobby.ts:639,1253–1265`。
- **编码**：`current/leaving{prepared,age}/heroAge/since/covered/layout/dirty/age`，turntable、releaseWorld/releaseResident。
- **逻辑状态**：未布局/covered不推进；旧伙伴sink-out并保留到160ms；新伙伴ready后420ms进入；空闲clip/sway；lost仅释放GPU；dispose解除world owner。
- **事件 / guards / 转换**：pick将current转leaving并清turntable；advance移除过期leaving、挂current；covered隐藏/揭幕后恢复；dirty或入退场或30Hz tick请求绘制。
- **取消 / 终态**：页面销毁清world/resident和模型copy；快速再次切换覆盖leaving引用，缓存仍持对象。
- **不变量**：3D大厅不能和run争同一world注册；窗口覆盖只冻结，不重新载模型；渲染不修改游戏模拟。
- **测试 / 风险**：无直接LobbyScene过场/覆盖测试；背景路径与host缓存交叠关联 **#14**；模型generation编译安全另在UI-LOBBY-MODEL，不靠纯动画验收证明。

<a id="ui-lab-sections"></a>

### UI-LAB-SECTIONS — 研究所分栏重建、控件/焦点与滚动

- **Owner**：[src/ui/gpu/lab.ts:138–156,259,316–348,741–755,855–1007,1033–1085](../../src/ui/gpu/lab.ts#L138)。
- **编码**：`section/progress/controls/fixed/sectionControls/sectionParts/tiles/focused/columns/compact/content.scrollPosition`。
- **逻辑状态**：combat/其他section；换栏/档案容量变化/列数变更重建；旧controls/resources退出，新controls建立；焦点与滚动保留/显露。
- **事件 / guards / 转换**：showSection同栏no-op；buildSection先dispose旧parts/control再构造；Tab仅当前tab；方向gridStep；Home/End到首尾tile；focus触发reveal。
- **取消 / 终态**：清旧tile tween；dispose全section/fixed资源；tip行为见UI-TIP-PRESS。
- **不变量**：动态controls由当前section构成；旧tile动作不进入新栏；焦点/hover/tip索引需要与重建同步。
- **测试 / 风险**：[lab.test.mjs](../../scripts/lab.test.mjs) 测领域购买规则，不测GpuLab rebuild；sectionParts释放后 `hovered/touchTip` 未全部重置，属静态接缝风险。

<a id="ui-lab-actions"></a>

### UI-LAB-ACTIONS — 购买门槛与档案库选择提交

- **Owner**：[src/ui/gpu/lab.ts:480–525,691–725,749–770](../../src/ui/gpu/lab.ts#L480)；[src/app/session.ts:335–339,138–153](../../src/app/session.ts#L335)。
- **编码**：progress.lab/stardust/archive、item.max/nextCost/labLock、archiveSlots；control.locked、父回调update。
- **逻辑状态**：tile ready/short/maxed；档案项 selected/unselected/free/full；点击请求→父持久化→新progress刷新，或拒绝/失败保持。
- **事件 / guards / 转换**：锁时ui-denied；buyable才callbacks.buy；archive满只能取消已选项；没有乐观改本地progress，靠同步父层change更新。
- **取消 / 终态**：失败不变更选中/余额；成功可能增加archive slots触发section重建；离页销毁。
- **不变量**：UI不自扣钱、不自造进度；满档案不能加未选项但仍可移除；错误不伪装购买成功。
- **测试 / 风险**：[lab.test.mjs:274,357](../../scripts/lab.test.mjs#L274) 与相关progress规则；[ui-save-import.test.mjs](../../scripts/ui-save-import.test.mjs)只下层存储。GPU表现依进度回调，未验证存储异常下整页交互。

<a id="ui-settings-controls"></a>

### UI-SETTINGS-CONTROLS — 设置窗口内部关闭锁、控件可用性和焦点环

- **Owner**：[src/ui/gpu/settings-dialog.ts:78–122,499–526,644–705,801–822,866–990](../../src/ui/gpu/settings-dialog.ts#L78)。
- **编码**：`settings/selected/closing/exitRemaining/pressed/hovered/focusVisible/needsReveal/lastLayout/controls[].enabled`。
- **逻辑状态**：entering/open→closing→exitFinished；sound/devMode 开关；uiScale min/mid/max；focus在可用控件循环。
- **事件 / guards / 转换**：commit更新本地、refresh/resize、onChange；缩放夹到min/max；当前selected变disabled后找下个；closing挡focus/navigate/activate/scroll；afterLayout递减220ms。
- **取消 / 终态**：close幂等，清pressed；host在exitFinished才dispose；本类不销毁自己。
- **不变量**：退场仍画但不得再次提交；禁用scale按钮从Tab剔除；onChange只有真实可用动作提交。
- **测试 / 风险**：**#19** 已恢复三项设置；[ui-settings.test.mjs](../../scripts/ui-settings.test.mjs) 定位各设置操作及到存档按钮的焦点链。本次未执行历史 browser 脚本；**#11** 交接由宿主 activeTarget 处理。

<a id="ui-settings-layout"></a>

### UI-SETTINGS-LAYOUT — 测量触发紧凑布局的单向锁存

- **Owner**：[src/ui/gpu/settings-dialog.ts:55,68–69,559–640,866–899](../../src/ui/gpu/settings-dialog.ts#L55)。
- **编码**：`width/height/sizedFor/squeezed/compact/switchTravel/lastLayout/needsReveal`。
- **逻辑状态**：新尺寸roomy → 若overflow则squeezed compact；同尺寸不自动弹回；新尺寸重置squeezed；等待布局后reveal。
- **事件 / guards / 转换**：resize检测width,height,scale key；短横屏直接compact；afterLayout若非compact却body可滚则squeezed=true再次resize；switchTravel变化以0时长重设knob。
- **取消 / 终态**：窗口dispose；变更尺寸为新测量周期。
- **不变量**：避免roomy/compact互相反馈振荡；focus reveal在测量完成后执行；viewport.scale与偏好值不同但偏好不被写回。
- **测试 / 风险**：[ui-viewport.test.mjs](../../scripts/ui-viewport.test.mjs)/[ui-edge-snap.test.mjs](../../scripts/ui-edge-snap.test.mjs)只纯布局基础；历史设置browser有尺寸矩阵，未执行当前版本。

<a id="ui-save-life"></a>

### UI-SAVE-LIFE — 存档入退场与原生输入表面覆盖

- **Owner**：[src/ui/gpu/save-dialog.ts:57–63,164–173,309–374,434–475,736–777,838–850](../../src/ui/gpu/save-dialog.ts#L57)。
- **编码**：`disposed/closing/elapsed/settled/closeElapsed/covered/keyboardOpen/fieldFocused/input.overlay/placed`。
- **逻辑状态**：entering（field隐藏）→220ms settled→原生field可见；covered/GPU键盘/closing时隐藏并blur；closing220ms→closed回调卸载。
- **事件 / guards / 转换**：showField谓词 `settled&&!closing&&!covered&&!keyboardOpen`；输入focus选全文；Tab leave交回canvas；setCovered同步blur；布局定位原生bounds。
- **取消 / 终态**：requestClose幂等；disposed取消buffer订阅、input及GPU资源；closed由父销毁，因此重复afterLayout依赖父及时unregister。
- **不变量**：native field不得穿过遮罩/弹窗/退出动画；UI隐藏不等同buffer销毁；GPU键盘与native editor不能同时占焦点。
- **测试 / 风险**：[ui-save-dialog.test.mjs:98,123,145](../../scripts/ui-save-dialog.test.mjs#L98)；未完整覆盖covered/context-loss与异步panel交叉。

<a id="ui-save-io"></a>

### UI-SAVE-IO — 导入/复制/文件面板异步操作锁

- **Owner**：[src/ui/gpu/save-dialog.ts:58,385–396,408–431,514–562](../../src/ui/gpu/save-dialog.ts#L58)。
- **编码**：`pending/disposed/closing/error/initial/buffer.text/order`、TextServices Promise。
- **逻辑状态**：idle（copy/load可用性派生）→pending（只允许close）→成功/取消→idle；失败显示error；load成功→closing。
- **事件 / guards / 转换**：初始相同文本不允许load；pending锁按钮；copy/open/save await完成只在未dispose&&!closing时通知/换文本；load同步调用父decode+save，成功才关闭；copy失败选全文便于手动复制。
- **取消 / 终态**：关窗不取消系统panel Promise，只丢弃晚到结果；finally清pending，disposed不paint。
- **不变量**：一次只一普通I/O；失败不提交导入；关闭以后文件结果不得覆盖buffer或发成功通知。
- **测试 / 风险**：[ui-save-dialog.test.mjs:98,123](../../scripts/ui-save-dialog.test.mjs#L98)、[ui-save-import.test.mjs:40](../../scripts/ui-save-import.test.mjs#L40)；pending只限制控件，native field的可编辑性取决于TextServices，openFile期间编辑晚到被覆盖的顺序需验证。

<a id="ui-save-keyboard"></a>

### UI-SAVE-KEYBOARD — GPU键盘与带revision的异步粘贴

- **Owner**：[src/ui/gpu/save-dialog.ts:75–78,455–512,680–702](../../src/ui/gpu/save-dialog.ts#L75)；[src/ui/gpu/text-keyboard.ts:5–37](../../src/ui/gpu/text-keyboard.ts#L5)。
- **编码**：`keyboardOpen/lowercase/order/baseCount/focused`、键值数组；捕获 `buffer.revision`。
- **逻辑状态**：native/普通field → gamepad虚拟键盘；大/小写；等待paste→提交或revision失效；完成/Cancel返回普通窗口。
- **事件 / guards / 转换**：well被gamepad激活开键盘；splice controls并聚焦第一key；Cancel先关键盘；paste await后要求未disposed、未closing、revision未变；Aa/Page切case。
- **取消 / 终态**：键盘关闭blur/focusCanvas；dispose所有键；异步paste不能取消下载但可以丢弃。
- **不变量**：GPU与native编辑同一buffer；晚到paste不得用旧选区覆盖新编辑；关闭keyboard本身不改变buffer revision。
- **测试 / 风险**：[ui-save-dialog.test.mjs:123](../../scripts/ui-save-dialog.test.mjs#L123)覆盖共享buffer/单次import；未见paste revision乱序与关闭键盘期间paste完成测试。

<a id="ui-text-buffer"></a>

### UI-TEXT-BUFFER — 文本、选区锚点、revision与拖动选择

- **Owner**：[src/ui/text-buffer.ts:2–78](../../src/ui/text-buffer.ts#L2)；[src/ui/gpu/save-dialog.ts:56,705–734,779–832](../../src/ui/gpu/save-dialog.ts#L56)。
- **编码**：`text/anchor/cursor/revision/listeners`；dragAnchor、selectionLayout/selectionState/previewRevision。
- **逻辑状态**：collapsed/forward-selection/backward-selection；mouse selection armed/dragging/released；编辑产生新revision；GPU selection渲染待布局→同步。
- **事件 / guards / 转换**：set夹UTF16偏移且同值不通知；move不extend先折叠选区；adjacent避surrogate；replace/delete；GPU命中glyph定index、drag拉选区，revision变更使caret滚入视口。
- **取消 / 终态**：pointerUp清dragAnchor并消费点击；订阅返回unsubscribe；buffer本身无dispose，随dialog回收。
- **不变量**：UTF16偏移与平台一致；所有编辑路径同一revision；GPU selection不得成为另一个文本源。
- **测试 / 风险**：[ui-text-buffer.test.mjs:5](../../scripts/ui-text-buffer.test.mjs#L5)、[ui-save-dialog.test.mjs:145](../../scripts/ui-save-dialog.test.mjs#L145)；[native-text.test.mjs:76,106](../../scripts/native-text.test.mjs#L76)是平台边界关联。IME和剪贴板服务内部未在此盘点。

<a id="ui-codex-data"></a>

### UI-CODEX-DATA — 内容注册表的一次生成缓存

- **所有者/编码**：[codexSections](../../src/run/codex.ts#L960) 的模块级cached引用。
- **状态与转换**：未建立→首次查询按当前注册表生成六类内容→后续复用同一数组；构造抛错时赋值不完成，下次仍可尝试。
- **终态/不变量**：没有清除或热刷新；内容在应用生命期内静态。它不拥有图片/模型资源，不属于导航历史或窗口开闭状态；调用者应按只读集合使用。
- **证据**：[ui-codex.test](../../scripts/ui-codex.test.mjs)保护内容覆盖/引用有效性；没有新增缓存计数测试。此项由主线程补读缓存定义及调用边界。

<a id="ui-codex-nav"></a>

### UI-CODEX-NAV — 类别/条目/链接历史与回退恢复

- **Owner**：[src/ui/gpu/codex.ts:151–178,447–543,578–598,965–1024,1212–1337](../../src/ui/gpu/codex.ts#L151)。
- **编码**：`section/selectedKey/memory/trail<Stop>/restoring/entries/details/controls/focused/focusIndex/needsReveal`。
- **逻辑状态**：直接浏览（每类别记当前条目）→跟随ref（压入页面、两scroll、link）→Back恢复；跳回已在trail的条目裁短trail；直接pick清trail。
- **事件 / guards / 转换**：rebuildControls清pressed/hover/tip，focus落已选row；Tab/current group导航；Esc先tip再trail再窗口；restoreScroll等pending为空后一次性恢复并钳位，避免reveal夺回滚动。
- **取消 / 终态**：dispose旧list/detail时忘记颜色轨道、释放owned；window closing阻导航；退出释放全部。
- **不变量**：trail不重复页面；回退恢复用户scroll/link焦点；旧控件索引不可跨子树继承。
- **测试 / 风险**：[ui-codex.test.mjs:21](../../scripts/ui-codex.test.mjs#L21)测ref合法性，**不测trail/scroll/history**；历史图鉴QA不是本次验证。

<a id="ui-codex-reveal"></a>

### UI-CODEX-REVEAL — 图鉴列表/详情的资源与布局延迟揭幕

- **Owner**：[src/ui/gpu/codex.ts:192–199,616–673,1492–1501,1513–1532](../../src/ui/gpu/codex.ts#L192)。
- **编码**：`pending[{state,images,wraps,waited,frames,start}]`、listIn/detailIn、wrap.laid、restoring。
- **逻辑状态**：新子树透明 →等图/文字换行/至少两帧→入场；超过REVEAL_WAIT_MS即放行；新同state替代旧等待。
- **事件 / guards / 转换**：fadeIn先filter旧state/cancel旧tween；afterLayout累计frames/waited；ready或超时start并从队列去除；无animate立即显示。
- **取消 / 终态**：换条目替换等待项；stage.dispose取消轨道；历史scroll恢复等队列清空。
- **不变量**：旧详情完成不能揭幕新详情；最终布局之前不恢复历史scroll；视觉超时放行不同于宿主字体硬屏障。
- **测试 / 风险**：无直接测试；REVEAL_WAIT_MS的视觉fallback不能被误认为资产加载成功。

<a id="ui-codex-window"></a>

### UI-CODEX-WINDOW — 图鉴关闭计时及输入锁

- **Owner**：[src/ui/gpu/codex.ts:188–210,1106–1142,1212–1218,1237–1252,1473–1475,1571–1585](../../src/ui/gpu/codex.ts#L188)。
- **编码**：`closing/exitRemaining/enterFade/enterMove`，options.onClose、host拥有的codex引用。
- **逻辑状态**：entering/open → closing（220ms）→ exitFinished→host dispose。
- **事件 / guards / 转换**：closeWindow幂等，清pressed/tooltip，启动退场；focus/navigate/activate在closing拒绝；frame倒计时。
- **取消 / 终态**：host可直接dispose；model request、thumb request在dispose各自abort。
- **不变量**：对象存在不等于可输入；退出前所有资源owner仍有效；退场完成才将modal归还。
- **测试 / 风险**：没有专门窗口退场自动测试；关联UI-HOST-CODEX和 **#10**，不能仅测class.closeWindow证明异步来源安全。

<a id="ui-codex-pointer"></a>

### UI-CODEX-POINTER — 模型旋转与双面板滚动的单指归属

- **Owner**：[src/ui/gpu/codex.ts:179–186,1353–1374,1414–1467](../../src/ui/gpu/codex.ts#L179)。
- **编码**：`owner/turning{x}/pressPane/pointer/tipPress`。
- **逻辑状态**：idle → 按下model=turning，按下pane=scroll来源，按下tip=长按；释放/取消归idle。
- **事件 / guards / 转换**：owner已有则忽略第二指；move同owner时drag模型；turning时scroll拒绝；键盘scroll默认detail，鼠标由pressPane或当前pointer选pane；right stick只有model聚焦时turn。
- **取消 / 终态**：pointerUp(undefined,false)全取消；其他id不能清owner；关闭时host cancelInput。
- **不变量**：模型拖动不能同时滚详情；第二指不能重置第一指姿态；按下后滚动所属pane固定。
- **测试 / 风险**：无直接codex gesture测试；MenuInput测试不涵盖此附加owner层。

<a id="ui-codex-model"></a>

### UI-CODEX-MODEL — 模型预览请求、LRU和资源持有

- **Owner**：[src/ui/gpu/codex-model.ts:67–109,202–216,224–285,363–371](../../src/ui/gpu/codex-model.ts#L67)。
- **编码**：`wanted/request/current/cache/state/content/mesh`；loadPrepared handle与abort监听。
- **逻辑状态**：idle → loading → ready/error；同URL no-op；LRU命中立即use；切换取消旧request、隐藏旧mesh；dispose。
- **事件 / guards / 转换**：show取消旧请求，重置turntable/yaw；完成只在request未aborted时入cache，超CACHE逐出dispose；content.abort只清同一mounted content引用。
- **取消 / 终态**：request abort释放model handle；loadPrepared后检查signal防晚到；dispose释放所有cache.loaded。
- **不变量**：新条目不能短暂画出旧模型；每实例骨骼/handle归明确owner；缓存逐出不得伤共享canonical。
- **测试 / 风险**：[ui-model-store.test.mjs](../../scripts/ui-model-store.test.mjs)只共享下层，不测此LRU。error后同wanted重show直接return，需切其他条目或重开才retry；与大厅永久失败Promise问题不同。

<a id="ui-codex-compile"></a>

### UI-CODEX-COMPILE — 预览离屏编译、绘制和context恢复

- **Owner**：[src/ui/gpu/codex-model.ts:204–214,301–361](../../src/ui/gpu/codex-model.ts#L204)；[src/ui/gpu/codex.ts:201,1533–1561](../../src/ui/gpu/codex.ts#L201)。
- **编码**：`compiled:WeakSet/compiling/dirty/current/target/mesh`、捕获的compiled集合；窗口 `modelAsked`。
- **逻辑状态**：loaded但未编译 → compiling（mesh hidden）→ dirty待render→rendered/mesh visible；context loss重置编译；dirty请求被modelAsked合并。
- **事件 / guards / 转换**：render按尺寸重设target；未compiled且!compiling才compileAsync；then清compiling、标旧集合current、onChange；render成功后清dirty/露mesh；window render清modelAsked。
- **取消 / 终态**：releaseUploads清GPU、换WeakSet/compiling=false；dispose释放target和模型，但compile Promise本身没abort/generation/disposed guard。
- **不变量**：当前context编译后才能露模型；旧compile不得解锁新代编译或触碰已释放UI。
- **测试 / 风险**：未见直接编译竞态测试。源码缺reject处理及回调生命周期guard，属需验证的旧完成/未处理拒绝边界；不能仅凭host generation检查替它背书。

<a id="ui-codex-spin"></a>

### UI-CODEX-SPIN — 手动旋转后延迟恢复自动转台

- **Owner**：[src/ui/gpu/codex-model.ts:212–213,246–247,288–312](../../src/ui/gpu/codex-model.ts#L212)。
- **编码**：`yaw/sinceTurn/current/content.isVisible/isClipped/compiled/dirty`。
- **逻辑状态**：auto-spin → manual turn → cooldown → auto-spin；无模型/不可见/未编译时冻结推进。
- **事件 / guards / 转换**：turn/drag只有current时更新yaw并将sinceTurn置0；update到SPIN_RESUME_MS恢复spin；30Hz tick标dirty，手动turn即时dirty。
- **取消 / 终态**：show新模型reset；dispose停止外部update。不是单纯插值：手动/自动所有权有明确延迟门槛。
- **不变量**：用户操作优先，自动旋转不得马上抢回；被裁掉模型不耗转台更新。
- **测试 / 风险**：无直接转台时序测试，真实鼠标/手柄未验。

<a id="ui-codex-thumbs"></a>

### UI-CODEX-THUMBS — 缩略图串行加载、GPU拍照和CPU缓存

- **Owner**：[src/ui/gpu/codex-model.ts:374–494](../../src/ui/gpu/codex-model.ts#L374)。
- **编码**：`thumbs<Map<url,{texture,meshes,queued}>>/queue/loading/ready[]/target`、request.signal。
- **逻辑状态**：未请求 → queued → loading（一次一项）→ ready排队 → 一帧一项render/readback → CPU texture缓存；失败保留空图；dispose。
- **事件 / guards / 转换**：mount注册mesh并去重queue；content.abort删mesh/材质；update开始下一load；render取ready一项，拍照后释放GLB并更新所有mesh。
- **取消 / 终态**：dispose abort loading、释放ready、GPU/texture、清thumbs；loss保留CPU像素再上传。
- **不变量**：每URL共享缩略图；离屏render结束释放暂持模型；晚到取消请求不得入ready。
- **测试 / 风险**：无直接队列测试。load失败不清thumb.queued，当前Codex实例以后不再排该URL；render/readback抛错也不在本函数finally释放prepared；静态待验证。

<a id="ui-room-page"></a>

### UI-ROOM-PAGE — 联机菜单、数字输入、连接、房间与错误

- **Owner**：[src/ui/gpu/multiplayer.ts:134–145,147–309,327–465,496–608](../../src/ui/gpu/multiplayer.ts#L134)；`multiplayer-view.ts:21–49`、`multiplayer-seat.ts:109–158`。
- **编码**：`state/entering/code/page/focused/hovered/pressed/ready/lastError/groups`，SessionState.room/self/mode/canStart/starting/error/ready seats。
- **逻辑状态**：menu→entry(empty/partial/6位)→joining→room(waiting/connecting/ready/starting)；entryError留在输入页，其他error独立页；back/cancel可回menu或close。
- **事件 / guards / 转换**：6位且未连接/出错才submit；connecting期间锁输入；digit满6位焦点到join；编辑错误code先cancel旧session；gamepad B先删数字，物理Backspace删；Enter提交但gamepadConfirm按当前数字键；room start取canStart&&!error。
- **取消 / 终态**：callbacks.cancel断连接但保留code；close卸载screen，连接所有权由UI-ROOM-OWNERSHIP决定；页变重选合法focus。
- **不变量**：未填满四席也可在2–4人ready时出发；房主/本机/空席不混淆；ready不由玩家按钮设置；刷新不重建常驻页面树。
- **测试 / 风险**：[ui-multiplayer.test.mjs:6,63,92,142,212](../../scripts/ui-multiplayer.test.mjs#L6)覆盖视图映射、键盘/gamepad差异、布局；不证明网络交接/凭据异常安全。席位arrival/spinner为UI-CONTROL-VISUAL模式。

## D. 对局覆盖层、HUD 与短暂反馈

<a id="ui-overlay-tree"></a>

### UI-OVERLAY-TREE — 当前覆盖层内容、重建与关闭

- **Owner**：[src/ui/gpu/run-overlays.ts:153–194,252–347,433–487,892–979,1406–1437,1628–1693](../../src/ui/gpu/run-overlays.ts#L153)。
- **编码**：`state/signature/visibleKind/frame/content/window/revision/builtOverEmpty/closing/exitLeft/fade/entrance`。
- **逻辑状态**：empty；loading；solo choice；coop dock；pause/stats/station/result/error/save-error/reconnecting；closing；同kind内容复用/新kind重建。
- **事件 / guards / 转换**：signature相同不重建；flight中同deal不接受更新；kind变更可能retireFrame，same kind clearFrame(preserveContent)后build；state=null时choice/loading立即卸载，其他160ms退场；result首次与loading即刻显示。
- **取消 / 终态**：clearFrame取消control动画、清tip、释放当前frame；dispose加上leavingWindows/预热副本全部释放。
- **不变量**：ControlSet只属于本次window；每build revision++使旧手势失效；frame/content共同判modal，不是只看state.kind。
- **测试 / 风险**：[ui-run-overlays.test.mjs:49](../../scripts/ui-run-overlays.test.mjs#L49)保护旧pause closeIndex不污染result，但不验证整树GL释放或全部kind迁移。

<a id="ui-overlay-retired"></a>

### UI-OVERLAY-RETIRED — 旧窗口退场资源包

- **Owner**：[src/ui/gpu/run-overlays.ts:152,305–307,1421–1428,1502–1626](../../src/ui/gpu/run-overlays.ts#L152)。
- **编码**：`leavingWindows[{remaining,tick,dispose}]`；闭包捕获旧frame/content/controls/surfaces/presses，独立opacity/leave/shadow/dim。
- **逻辑状态**：current → retired/render-only →160ms后disposed；可同时有新current和多个retired。
- **事件 / guards / 转换**：retire将旧frame固定绝对布局、关闭焦点pattern/cursor，将owner引用从current清走；旧leave tween/tick继续；afterLayout逐个倒计时dispose。
- **取消 / 终态**：主overlay dispose提前dispose全部退休窗口；每退休dispose取消捕获的所有动画、owned资源/组件/dim。
- **不变量**：退休窗不持controls输入，资源仍活到退场结束；新controls不能复用旧closeIndex；isModal仍可被leavingWindows维持。
- **测试 / 风险**：[ui-run-overlays.test.mjs:49](../../scripts/ui-run-overlays.test.mjs#L49)只小切面。retireFrame不像clearFrame清scrollFades，资源/回调转移是否完整需进一步验证，未做内存测量。

<a id="ui-overlay-input"></a>

### UI-OVERLAY-INPUT — 覆盖层焦点、滚动和dock混合输入

- **Owner**：[src/ui/gpu/run-overlays.ts:175–187,229–231,898–927,1060–1240,1250–1404](../../src/ui/gpu/run-overlays.ts#L175)。
- **编码**：`selected/focusVisible/pressedIndex/initializingFocus/userScrolled/needsReveal/lastLayout`、controls.enabled/locked、closing/picking/choiceOpen。
- **逻辑状态**：未聚焦/可用焦点/锁定但可提示；用户滚动抑制自动reveal；closing/flight时吞输入；dock内部卡片owner，外部游戏。
- **事件 / guards / 转换**：暂停确认默认Cancel；stats→pause聚焦属性；quit-question取消恢复放弃项；pointer focus与stats hover分开；Esc先关tip；choiceKey仅接数字/RXZ/Tab/Enter/Page/Esc，保留战斗键；choiceAction消费同一旧帧余下卡命令。
- **取消 / 终态**：重建清pressed/tooltip；host revision变更取消手势；dock flight内命中哨兵，防穿透触发摇杆。
- **不变量**：locked可聚焦但不执行业务；重复键不重复选卡；用户滚动后动画不能抢回scroll；modal与dock的键分流不同。
- **测试 / 风险**：[ui-run-choice.test.mjs:195,252](../../scripts/ui-run-choice.test.mjs#L195)、[ui-run-overlays.test.mjs:63](../../scripts/ui-run-overlays.test.mjs#L63)；host三输入仲裁 **#11** 是外层不同机器。

<a id="ui-choice-deal"></a>

### UI-CHOICE-DEAL — 待选身份、发牌保护与同卡更新

- **Owner**：[src/ui/gpu/run-choice-content.ts:46–57,317–398,512,728,1037–1082,1467–1534](../../src/ui/gpu/run-choice-content.ts#L46)。
- **编码**：`state.dealKey/pending.id/source/bannerCard/dealtAt/elapsed/cards/banner/flight`、count/banishing/dismissible。
- **逻辑状态**：新deal构建→前150ms防误触→可选；reroll更新deal重新发牌；pending身份变化重新stamp banner；same deal只更新count/banish。
- **事件 / guards / 转换**：bannerCard捕获字符串，避免pending对象原地修改导致漏判；newDeal clearCards/flight、记录dealtAt；action种类可见性改变才重建actions；dock布局与solo不同。
- **取消 / 终态**：新deal废旧flight；clearCards取消lift/veil并释放图元；dispose完整移除所有布局盒。
- **不变量**：旧牌点击不能用于新deal；发牌guard从每次新deal起算；same deal不得重播所有内容。
- **测试 / 风险**：[ui-run-choice.test.mjs:195](../../scripts/ui-run-choice.test.mjs#L195)误触/单次pick；[combat.test.mjs:402,980](../../scripts/combat.test.mjs#L402)下层stale card；不同输入/原地pending修改仍需组合验证。

<a id="ui-choice-pick"></a>

### UI-CHOICE-PICK — 选卡飞行与一次性提交

- **Owner**：[src/ui/gpu/run-choice-content.ts:362–368,1138–1173,1500–1534](../../src/ui/gpu/run-choice-content.ts#L362)；`run-overlays.ts:287–302`。
- **编码**：`flight{index,elapsed,dx,dy,landed}`、cards.from、dealKey、dealtAt。
- **逻辑状态**：ready→flying→landed-waiting-for-run；收到新deal/none后释放；banish走立即提交支路。
- **事件 / guards / 转换**：拒绝已有flight/150ms内/不可选卡；捕获HUD槽位置，冻结各卡当前pose；280ms时先landed=true再callbacks.pick；后续帧不重复提交；父overlay同deal更新不能打断flight。
- **取消 / 终态**：窗口消失/新deal/dispose使flight不再推进；没有独立timer；晚于飞行动画的模拟回答仍保留picking锁。
- **不变量**：一次选择只提交一次；提交时机由落地决定；非选中卡淡出不能变额外pick；动画数字在此影响业务，须独立列出。
- **测试 / 风险**：[ui-run-choice.test.mjs:195–249](../../scripts/ui-run-choice.test.mjs#L195)覆盖single-pick、dock边界、旧帧命令消费；没有确认网络拒绝/长期无回答后的UI退出行为。

<a id="ui-choice-actions"></a>

### UI-CHOICE-ACTIONS — 重抽/放逐/稍后动作和计数门槛

- **Owner**：[src/ui/gpu/run-choice-content.ts:910–977,1007–1082,1175–1198](../../src/ui/gpu/run-choice-content.ts#L910)；[src/run/session.ts:199–203](../../src/run/session.ts#L199)。
- **编码**：rerolls/skips/banishes、banishing、dismissible、actions[]、flight。
- **逻辑状态**：动作可用/用尽但focusable；banish未武装/武装；coop可defer；flight期间所有提交锁住。
- **事件 / guards / 转换**：count<=0或flight拒绝；reroll/skip发携card id的命令，banish调父toggle，defer发choices=false；卡可放逐性由banishKey；物理shortcut仅当actions确实含该kind才执行。
- **取消 / 终态**：newdeal重置flight，session以pending.id隔离banish；defer保留机会。
- **不变量**：用尽动作不能发命令；稍后不能消耗pending；放逐训练等不可banish卡不得提交。
- **测试 / 风险**：[ui-run-overlays.test.mjs:63](../../scripts/ui-run-overlays.test.mjs#L63)、[ui-run-choice.test.mjs:195](../../scripts/ui-run-choice.test.mjs#L195)。源码buildActions当前只push reroll/defer/banish，虽state/文档/按键分支保留skip，X会因actions中无skip被吞；此为静态发现，待后续复核，不声称本次运行复现。

<a id="ui-station-forget"></a>

### UI-STATION-FORGET — 先选目标再遗忘的确认状态

- **Owner**：[src/ui/gpu/run-overlays-station.ts:59–82,104–135,215–265,626–665](../../src/ui/gpu/run-overlays-station.ts#L59)。
- **编码**：`view/signature/selectedForget`、entries.lock、controls.selected/locked、局部swing/lifts。
- **逻辑状态**：无目标→目标选中→点同项取消；外部view变化保留仍有效目标，否则清；确认发forget后清选择。
- **事件 / guards / 转换**：选项可focus但最后招式等锁不得activate；点击设selectedForget、清signature再invalidate父overlay rebuild；确认携view.id；未选按钮锁并显示提示。
- **取消 / 终态**：view更换/目标消失清选；close发leave在父层；clear停止swing、取消lifts/释放旧树；dispose。
- **不变量**：选中与执行分开；命令属于当前dialog id；不能遗忘最后合法招式；UI不直接修改模拟。
- **测试 / 风险**：[scripts/stations.test.mjs](../../scripts/stations.test.mjs)测试模拟遗忘/过期dialog，未直接保护本UI选中→rebuild→confirm时序。

<a id="ui-station-fuse"></a>

### UI-STATION-FUSE — 融合材料准备与提交门槛

- **Owner**：[src/ui/gpu/run-overlays-station.ts:75–82,285–434,457,611–623](../../src/ui/gpu/run-overlays-station.ts#L75)。
- **编码**：`view.kind/id/parts[].owned/level/ready/move/signature`；port/halo/haloStarted。
- **逻辑状态**：缺材料/未满级→part-ready→all-ready可融合；点击提交后等下一view/窗口消失。
- **事件 / guards / 转换**：view signature变化重建；ready决定button是否locked与halo；fuse命令携dialog id；动画只跟随part readiness。
- **取消 / 终态**：leave或换kind清树与halo；每次build重新建立ready视觉；模拟决定最终结果。
- **不变量**：缺材料/未满级不能融合；UI不自合成；一次站点使用规则在模拟维护。
- **测试 / 风险**：[stations.test.mjs](../../scripts/stations.test.mjs)、[coop.test.mjs:125](../../scripts/coop.test.mjs#L125)是业务下层；UI无pending提交flag，重复动作防护依后续view/模拟dialog id，不能从按钮动画推断幂等。

<a id="ui-result-bag"></a>

### UI-RESULT-BAG — 结算身份、背包选择与成功提交后确认

- **Owner**：[src/ui/gpu/run-overlays-result.ts:158–195,196–334,337–354,466–494](../../src/ui/gpu/run-overlays-result.ts#L158)。
- **编码**：`state/resultIdentity/kept/signature/backpackSize/tiles`；keepItems boolean。
- **逻辑状态**：新RunResult重置kept；选择项未选/已选/容量满；点击→父存储成功才确认；retry/exit结束页面。
- **事件 / guards / 转换**：相同result对象可重build而保留kept；toggle计算next，超容量或keepItems=false则保持；成功paintBag+invalidate重建controls；backpackSize=null表示无可保存能力。
- **取消 / 终态**：新result身份重置kept；clear释放控件资源不清kept；dispose最终移除。
- **不变量**：UI“已带走”必须代表保存成功；不超容量；同一次结果重布局不丢选择。
- **测试 / 风险**：[lab.test.mjs:313](../../scripts/lab.test.mjs#L313)是背包领域；[ui-run-overlays.test.mjs:49](../../scripts/ui-run-overlays.test.mjs#L49)仅控件身份。未见GPU结算保存失败后保持未选的直接测试；natural onFinish一次性依UI-RUN-LEAVE。

<a id="ui-stats-detail"></a>

### UI-STATS-DETAIL — 属性明细 hover/focus优先级与稳定布局显露

- **Owner**：[src/ui/gpu/run-overlays-stats-panel.ts:70–78,280–315,415–447,491–553](../../src/ui/gpu/run-overlays-stats-panel.ts#L70)。
- **编码**：每row `focused/over/detail/shown/placed/wrapWidth`，全局focusVisible/compact；父overlay selected。
- **逻辑状态**：无明细→hover row优先或focus row→隐藏测量/定位→位置连续稳定后visible；换行/resize重新计算。
- **事件 / guards / 转换**：setFocused/setPointerOver调用paint；非open row立即visibility hidden并清placed/shown；afterLayout首次位置写入，下一次相同才shown；背景press触发父blur。
- **取消 / 终态**：父frame销毁持有header/details；content.dispose释放row动画/rings/root；旧open row不再可见。
- **不变量**：只开一项detail；hover临时覆盖focus，hover离开恢复focus；未稳定定位不能先闪在旧位置。
- **测试 / 风险**：[stats.test.mjs](../../scripts/stats.test.mjs)是数值来源契约；未找到此GPU detail显露状态测试。普通tooltip与detail是两个独立机制，不能混写。

<a id="ui-loading-tips"></a>

### UI-LOADING-TIPS — 载入文案轮播与内容复用

- **Owner**：[src/ui/gpu/run-overlays-loading.ts:177–183,291–341](../../src/ui/gpu/run-overlays-loading.ts#L177)；`run-overlays.ts:458–462`。
- **编码**：`elapsed/firstTip/lastTip/tipAt/viewportKey`，map/zone标题；内容对象保留。
- **逻辑状态**：首条提示→每3200ms下一条→240ms入场；同loading换区只换标题；被host编译hold时delta=0。
- **事件 / guards / 转换**：update推进轮播、avatar/gauge；show仅更新地图/区数，重用对象保留时钟。
- **取消 / 终态**：overlay离loading立即clear/dispose；没有自己的加载成功判定。
- **不变量**：假进度动画不宣告资源ready；真实资源门槛由run/host控制。
- **测试 / 风险**：无直接loading-tip测试；网络 `suspended` 与 `reconnecting` 区分在run session，不能由此外观类推网络状态。

<a id="ui-overlay-warm"></a>

### UI-OVERLAY-WARM — 对局窗口样本后台预热

- **Owner**：[src/ui/gpu/run-overlays.ts:157–159,1698–1735](../../src/ui/gpu/run-overlays.ts#L157)；`run-overlays-samples.ts`。
- **编码**：`warmSamples/warming:Set<GpuRunOverlays>`、images.uploaded/compile Promise、inertCallbacks。
- **逻辑状态**：未开始→首次loading创建样本队列→每帧取一份构建→等图/编译→释放副本；run dispose提前释放。
- **事件 / guards / 转换**：warming.add后Promise链；done仅在Set.delete成功时dispose，避免重复清理；样本动作无业务副作用。
- **取消 / 终态**：父dispose释放warming并清set；但promise链的copy.stage.update仍可能晚到。
- **不变量**：预热不能执行游戏命令；副本退出必须释放；已disposed副本不应继续被update/compile。
- **测试 / 风险**：未直接测。`done`有幂等保护但 `.then(()=>copy.stage.update(0))`无Set.has/disposed guard，父销毁期间的晚到图像需验证。

<a id="ui-hud-state"></a>

### UI-HUD-STATE — HUD可见性、遮挡、选卡共存与交互门控

- **Owner**：[src/ui/gpu/run-hud.ts:274,374–381,840–859,884–889,1022–1071,1278–1308,1430,1545–1552](../../src/ui/gpu/run-hud.ts#L274)。
- **编码**：`state{snapshot,visible,blocked,notice}/choiceOpen/coarse/selected/hovered/idleWait`、controls.enabled。
- **逻辑状态**：未就绪隐藏→visible；modal/map/app窗口导致blocked；coop choiceOpen隐藏slots但保持几何和技能；blocked暂停装饰idle。
- **事件 / guards / 转换**：update blocked即cancel held；setWindowOpen淡readout；setChoiceOpen只隐藏slot视觉不删布局；interact被blocked/choiceOpen门控；action检查visible/blocked。
- **取消 / 终态**：session dispose hud；host window与hud变化调用cancelInput；不自暂停sim。
- **不变量**：HUD不可用时不执行业务动作；隐藏slots仍能给card flight提供中心；HUD只消费snapshot。
- **测试 / 风险**：[ui-run-choice.test.mjs:252](../../scripts/ui-run-choice.test.mjs#L252)、[ui-run-hud-layout.test.mjs:58](../../scripts/ui-run-hud-layout.test.mjs#L58)；与UI-HOST-LIFE既有 **#1** 相同结论：屏蔽输入不等于暂停。

<a id="ui-hud-hold"></a>

### UI-HUD-HOLD — 多指按钮、按下即发技能和按住转向

- **Owner**：[src/ui/gpu/run-hud.ts:311,378,1545–1629](../../src/ui/gpu/run-hud.ts#L311)。
- **编码**：`held:Map<pointerId,controlIndex>/turn/state.blocked/coarse`、stick origin/knob位置。
- **逻辑状态**：idle→held一个或多个control；dash/ult在down已触发；left/right持续turn；普通pause/interact在up提交。
- **事件 / guards / 转换**：down命中才加入held；move离开原hit等同cancel；up先delete并复位press，再决定提交；turn为所有held左右数的sign。
- **取消 / 终态**：cancel一个或全部走up(cancel=true)，转向回0；host单独管理world stick并actions.move(0,0)。
- **不变量**：release不能重复触发已在down执行的技能；二指左右可抵消；modal切换不得遗留转向。
- **测试 / 风险**：[ui-run-choice.test.mjs:252](../../scripts/ui-run-choice.test.mjs#L252)有held turn→choice仍可技能；未逐项测多指取消/断开所有排列。

<a id="ui-hud-hp"></a>

### UI-HUD-HP — HP损失残条、保持/追赶、治疗打断

- **Owner**：[src/ui/gpu/run-hud.ts:314–322,359–367,1091–1190](../../src/ui/gpu/run-hud.ts#L314)。
- **编码**：每HealthBar `target/state{fill,trail,lead}/chipAge/glow`、hit与前快照HP；healAge。
- **逻辑状态**：首次初始化→正常；hit→350ms hold→残条drain；连续hit并入当前周期；治疗越过trail终止残条；大治疗lead+glow。
- **事件 / guards / 转换**：同target无hit不处理；只有trail<=fill的新hit开周期；新hit取消fill tween/glow；治疗达到trail取消chipAge；实际fill/chip/lead分开渲染。
- **取消 / 终态**：更强事件cancel旧轨道；stage.dispose终止；player/boss共用逻辑但curve不同。
- **不变量**：连续受伤不无限重置hold；初次snapshot不伪造失血；治疗不能留下错误红残条。
- **测试 / 风险**：未发现针对HUD HealthBar时序测试；这不是只有数值lerp，包含事件合并和取消策略，故独列。

<a id="ui-hud-xp"></a>

### UI-HUD-XP — 跨多级经验圈的逐圈提交

- **Owner**：[src/ui/gpu/run-hud.ts:368–373,919–926,1197–1248](../../src/ui/gpu/run-hud.ts#L368)。
- **编码**：`xpShown{progress,goal,trail,hold,glow}`、medalPose、level文字。
- **逻辑状态**：未初始化→追goal→碰整级→满圈hold/levelBeat→下一圈；多级burst重复；新run/回退重置。
- **事件 / guards / 转换**：snapshot goal=level+xpShare；低于当前或首次直接重置；每帧封顶速度；跨整数只到一圈终点，hold到0才重置trail。
- **取消 / 终态**：lower goal清hold/glow；stage.dispose取消medal tween。
- **不变量**：一次经验爆发逐级显示，不跳过等级反馈；UI level显示和snapshot实际level允许短暂追赶但不得写回sim。
- **测试 / 风险**：无直接XP圈测试；数值动画含离散“跨级提交/等待”，不能归为无状态纯插值。

<a id="ui-hud-prompt"></a>

### UI-HUD-PROMPT — 地标/站点/选卡/救援交互提示显隐

- **Owner**：[src/ui/gpu/run-hud-interact.ts:81–85,133–235](../../src/ui/gpu/run-hud-interact.ts#L81)。
- **编码**：`kind/art/shown/pressed/coarse/pose`、blocked/count/progress/exitLabel输入。
- **逻辑状态**：hidden→进入shown；prompt类型切换替换图标；blocked/kind=null→退出动画→row display:none；救援百分比/待选数随输入更新。
- **事件 / guards / 转换**：kind变化dispose旧art；show谓词kind&&!blocked；退出onUpdate只有!shown&&alpha=0才隐藏，逆转可安全重现。
- **取消 / 终态**：dispose cancel pose/资源；HUD请求blocked时hidden，业务interact由父guard。
- **不变量**：旧exit不能隐藏新prompt；展示副本不拥有救援进度；离区目的地文字与当前zone来自同快照。
- **测试 / 风险**：[ui-run-hud-layout.test.mjs:58](../../scripts/ui-run-hud-layout.test.mjs#L58)验证输入模式/单行布局；没测显隐动画逆转的所有时序。

<a id="ui-hud-edge"></a>

### UI-HUD-EDGE — 离屏标记入视野/出视野/隐藏保持

- **Owner**：[src/ui/gpu/run-edge-indicators.ts:19–29,130–207,222–308](../../src/ui/gpu/run-edge-indicators.ts#L19)。
- **编码**：每Marker `opacity/x/y/form`，world存在/alive/onScreen、全局visible/clock、nameplates。
- **逻辑状态**：屏内nameplate；屏外marker淡入；返回屏内marker在旧边界位置淡出；opacity0以x=NaN清定位；down叠danger/pulse；world人员减少隐藏多余项。
- **事件 / guards / 转换**：同插值world/camera投影；shown改变opacity以150ms过渡；再次出屏从NaN直接放新边缘；guard偏移/障碍避让；boss缺失走fadeout。
- **取消 / 终态**：HUD blocked root隐藏且早return（内部opacity不推进）；dispose root。
- **不变量**：标记只读世界；不镜像后方目标；fadeout不得追目标穿过屏幕；消失后下次位置无旧缓存拖尾。
- **测试 / 风险**：[ui-run-edge-indicators.test.mjs:113,151,206,230,256,291](../../scripts/ui-run-edge-indicators.test.mjs#L113)专门覆盖；不可替代物理设备视觉验收。

<a id="ui-hud-numbers"></a>

### UI-HUD-NUMBERS — 战斗浮字的限流、池化和到期回收

- **Owner**：[src/ui/gpu/run-damage-numbers.ts:16–42,73–76,193–322](../../src/ui/gpu/run-damage-numbers.ts#L16)。
- **编码**：`active/pool/spawnedThisFrame/font`，每item life/max/pop/kind/position；geometry.instanceCount。
- **逻辑状态**：pooled/new→active待font或可绘制→expired/offscreen→pool；font懒解析；每帧出生计数归零。
- **事件 / guards / 转换**：30 active上限、普通每帧5个（crit例外但仍受active cap）；spawnEvade另一入口；update减少life，投影null立即回收；没font仍消耗寿命；数字要求page0否则抛错。
- **取消 / 终态**：run/hud dispose释放mesh/probe/geometry/material；object pool随owner回收。
- **不变量**：不无限增长；视觉随机不写sim；回收对象复用前覆盖完整字段；字形page契约显式失败。
- **测试 / 风险**：[ui-glyph-sweep.test.mjs](../../scripts/ui-glyph-sweep.test.mjs)及字体集测试保护部分字形契约，未见池化/限流直接单测；高位金额显示slice(-6)是现有表示策略，不在此改动。

<a id="ui-hud-feedback"></a>

### UI-HUD-FEEDBACK — 短暂反馈触发与持续低血警示（合并模式）

- **Owner**：[src/ui/gpu/run-edge-glow.ts:23–69](../../src/ui/gpu/run-edge-glow.ts#L23)；`run-hud.ts:775–839,977–1008,1250–1278,1298–1308,1453–1510`。
- **编码**：`hurtAge/low/lowAge`、前snapshot/current readiness、dash/ult pose、ultReady、slot.sweep{ready,shown,cd,since}、shieldTarget。
- **逻辑状态**：受击重触发→380ms消退；低血false→true开始1100ms脉冲，恢复清零；技能未ready→ready单次pulse；施法/冷却重置sweep；同值不重复触发。
- **事件 / guards / 转换**：flash重置hurtAge；setLowHp仅边缘变化重置phase；ready crossing由previous snapshot判定；blocked停止装饰idle tick，hurt短效仍按delta处理。
- **取消 / 终态**：新事件替代对应UiMotion轨道；dispose取消/释放，其他数值插值并入UI-MOTION。
- **不变量**：同一snapshot反复刷新不反复庆祝ready；受击与低血并行不互相覆盖；ready视觉不得直接施法。
- **测试 / 风险**：没有专门反馈时序单测；这是共享pattern汇总，不逐个光晕/盾条/槽位单列。

<a id="ui-toast"></a>

### UI-TOAST — 消息寿命、hover暂停、替换与关闭幂等

- **Owner**：[src/ui/gpu/toast.ts:35–44,135–198,226–229,246–262,303–356](../../src/ui/gpu/toast.ts#L35)。
- **编码**：`message/duration/remaining/hovered/focused/pressed/exiting/dismissed/kind`。
- **逻辑状态**：无消息→entering/shown→hover/focus时暂停倒计时→resume→dismiss请求→exit220ms→hidden；替换文本重置寿命。
- **事件 / guards / 转换**：同message/duration/kind no-op；新消息取消exiting；null消息清focus/hover/press并退场；duration<=0不自动消失；dismiss先置锁再回调，父层setMessage(null)。
- **取消 / 终态**：dispose清motion/图元；dismissed防同一消息多次通知；exiting仍visible但hit只接受message非null。
- **不变量**：超时只提交一次；hover/focus暂停剩余时长而非重新满时长；退出不响应旧close。
- **测试 / 风险**：[scripts/ui-toast.browser.mjs](../../scripts/ui-toast.browser.mjs)有寿命/暂停/替换断言，但引用已不存在的loadUiFonts，当前可执行性不足；host notification id重播和Tab接力另见UI-HOST-TOAST-FOCUS。

## E. 字体就绪、持有和诊断

<a id="ui-font-revision"></a>

### UI-FONT-REVISION — 最新文本/页面revision门闩

状态、转换、取消和测试的唯一详细记录见 [资源 F07](resources.md#f07)。本条保留UI索引；不把同一字体生命周期重复计作另一套机器。

<a id="ui-font-pages"></a>

### UI-FONT-PAGES — 字体页fetch/decode/upload、持有与LRU

状态、转换、取消和测试的唯一详细记录见 [资源 F03](resources.md#f03)、[资源 F04](resources.md#f04)、[资源 F05](resources.md#f05)、[资源 F06](resources.md#f06)。本条保留UI索引；不把同一字体生命周期重复计作另一套机器。

<a id="ui-font-load"></a>

### UI-FONT-LOAD — 字体清单/metrics和图片验证的异步所有权

状态、转换、取消和测试的唯一详细记录见 [资源 F02](resources.md#f02)、[资源 F04](resources.md#f04)。本条保留UI索引；不把同一字体生命周期重复计作另一套机器。

<a id="ui-font-stage"></a>

### UI-FONT-STAGE — 每stage字体hold与等待者revision

状态、转换、取消和测试的唯一详细记录见 [资源 F08](resources.md#f08)。本条保留UI索引；不把同一字体生命周期重复计作另一套机器。

<a id="ui-font-cache"></a>

### UI-FONT-CACHE — 应用级font set复用、失败剔除和错误接收者更换

状态、转换、取消和测试的唯一详细记录见 [资源 F01](resources.md#f01)。本条保留UI索引；不把同一字体生命周期重复计作另一套机器。

<a id="ui-font-diagnostic"></a>

### UI-FONT-DIAGNOSTIC — 缺字只报告一次的font wrapper

状态、转换、取消和测试的唯一详细记录见 [资源 F10](resources.md#f10)。本条保留UI索引；不把同一字体生命周期重复计作另一套机器。

## 审计问题关联与证据边界

| 既有编号                  | 本范围关联机器                                          | 本次读取能确认的边界                                                                       |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| #1 UI失败世界继续         | UI-APP-BOOT / UI-HOST-LIFE / UI-RUN-BOOT / UI-HUD-STATE | 已接应用 dispose，再报告平台错误；准备中/运行中夹具见 ui-run-session。                     |
| #2 多人主动退出丢终局     | UI-RUN-LEAVE / UI-APP-ROUTE / UI-ROOM-OWNERSHIP         | 保存确认后才导航；网络终局保留/交付由主线程更新网络分册并最终审阅。                        |
| #3 离线退出卡恢复         | UI-RUN-LEAVE / UI-APP-ROUTE                             | 网络退出意图已有保留路径；仍不把本地 leaving 当作 quit 已交付。                            |
| #4 重返凭据异常打断核心链 | UI-ROOM-OWNERSHIP / UI-APP-ROUTE                        | loadRejoin 失败继续无凭据连接；onTicket 失败通过 warning 独立报告。                        |
| #5 上次选择读失败         | UI-APP-BOOT / UI-APP-ROUTE                              | native 偏好读取错误警告并回默认选择；主存档错误仍拒绝，见平台 PL-15。                      |
| #8 无效成绩时间导入       | UI-APP-PROGRESS / UI-SAVE-IO                            | 时间要求有限非负，计数要求安全整数；读写和导出均校验，见平台 PL-14。                       |
| #9 大厅失败Promise缓存    | UI-LOBBY-MODEL                                          | 失败 staged 按 entry 身份移表并 release，重选可重新获取；有消费者夹具。                    |
| #10 旧图鉴打开附着新页    | UI-HOST-CODEX                                           | import 成败核对 screen/runLayer、暂停 codexHome revision 及宿主存活。                      |
| #11 三输入接管分叉        | UI-HOST-SETTINGS / UI-HOST-TARGET                       | 三输入共用 activeTarget；syncInputOwner 在 pointerdown/keyDown/sample 同步，保护首个按压。 |
| #12 SDL键规范化缺项       | UI-HOST-TARGET / UI-HOST-MODE                           | PAGEUP/PAGEDOWN、KP_ENTER、GRAVE 映射已补齐；平台 PL-07 定位合成事件测试。                 |
| #13 模型准备失败泄漏      | UI-LOBBY-MODEL / UI-CODEX-MODEL                         | canonicalModel 抛错由模型 loader dispose，详见资源 M04/M07。                               |
| #14 背景URL哈希映射       | UI-HOST-LIFE / UI-LOBBY-STAGE                           | host 改用 `/art/lobby/backdrop.webp` 经发布路径映射；未重跑正式构建页面。                  |
| #18 同曲重播去重          | UI-APP-REVEAL-WORK                                      | applying 按 hold 去重，详见资源 A09；不扩大原正式 UI 可达性证据。                          |
| #19 设置/迁移政策         | UI-APP-PREFS / UI-SETTINGS-CONTROLS / UI-APP-PROGRESS   | 仅 sound/devMode/uiScale；旧字段/外壳拒绝，默认旧 save.txt 保留并报错。                    |

本次额外暴露的待复核接缝：SceneTransition未处理swap拒绝；预热副本在父销毁后仍可能继续Promise链；CodexModelStage编译回调未带generation/disposed guard；CodexThumbs失败后queued不复位；font ready在metrics之前release的竞态；tooltip同anchor不同文本不刷新；choice skips/X分支存在但actions不加入skip。它们在对应条目中标为源码限制或待验证，不提升为本次已复现问题，不混入分级审计的已确认结论。

## 初次盘点的扫描、读取与漏读说明

1. **全部责任文件已枚举与词法扫描**：[src/App.tsx](../../src/App.tsx)、[src/app/session.ts](../../src/app/session.ts)、[src/run/session.ts](../../src/run/session.ts)、`src/ui/**`，合计 **79文件 / 27,279行**，其中UI76文件。扫描了字段/局部可变变量、构造与dispose、公开/私有方法、Promise/async、timer/microtask、AbortController、事件订阅、callback、Map/Set、revision/generation和显隐/焦点guard。扫描范围逐文件列在下表；主线程另补读了 `src/run/codex.ts` 的一次生成缓存。词法扫描不是宣称每个shader/坐标公式逐行人工审阅。
2. **逐段深入读取**：App 1–109；app/session 1–429；run/session 1–297；app-host 1–1389；scene-transition 1–53；text-buffer 1–78；stage 1–145；menu-input 1–90；motion 1–71；layer 1–67；toast 1–357；tooltip 1–260。字体1–78、175–516、539–887；lobby所有字段及选择/出发/输入/覆盖/清理；lobby-scene字段和constructor、show/model/compile/advance/draw/release/dispose；lab字段与section/action/focus/tip/clear；settings字段、visibility/commit/resize/controls/afterLayout/dispose；save字段和input构造回调、visibility/I/O/keyboard/focus/selection/dispose；codex字段与rebuild/history/ready/focus/gesture/window/afterLayout/cleanup；codex-model全部生命周期段；multiplayer-session全部，multiplayer字段/构造动作/refresh/keypad/navigation/cleanup；run-overlays所有状态/控制/重建/退场/预热方法，choice所有身份/动作/提交/时钟/清理，station/result/stats/loading所有行为方法；HUD所有state更新/HP-XP/输入/反馈/清理，damage/edge/interact所有生命周期段。
3. **按共用模式扫描并抽读**：按钮、ring/ball/pattern、图元几何/纹理、字体标记、布局helper与surface shader。其owner与覆盖文件在UI-CONTROL-VISUAL、UI-GPU-PARTS和下方覆盖矩阵中列清。纯glsl颜色/路径、几何坐标、文字/图标常量、静态布局参数没有逐个状态条目；不把每个size cache当一台独立业务机器。
4. **文档上下文**：读取README、docs/README、docs/STATUS、CLAUDE、PRODUCT的入口与约束；DESIGN、GPU迁移/交接按标题和状态/输入/生命周期段核对，保留历史日期边界；盘点时读取初版19项审计；当前汇总已补充为24项。较长文档合并读取有输出截断，未宣称DESIGN与全部历史迁移正文逐行审阅。此领域盘点阶段未修改OpenSpec。
5. **测试读取**：枚举 `scripts/*.test.mjs` 与 `*browser.mjs` 的test名称/源码import，再深入查看ui-save-dialog、ui-run-choice、ui-run-overlays相关断言；font-revision、menu-input、motion、focus-mark、hover-pattern、stage、edge-indicators、multiplayer等逐条定位测试名；下层network/sim/storage测试仅按明确保护的契约引用。没有执行命令来声称任何测试通过。历史settings/toast browser脚本引用旧loadUiFonts，不能把存在文件称为当前可执行覆盖。
6. **明确漏读/边界外**：没有穷尽 `src/platform/**` 的输入认领/IME/文件/全屏/存储状态机、`src/network/**` 的socket/WebRTC/rejoin/quit交付、[src/run/createRun.ts](../../src/run/createRun.ts) 的固定步长/资源/zone barrier、`src/rendering/**` 的frame/context与动态分辨率、`src/prepare/**` 的下载/解码/idle queue、`src/audio/**` 的播放与解码、sim/game/codex内容数据；仅跟踪这些边界在本范围的调用点。这些范围另见联机、资源、模拟、平台和画面反馈分册；不能只以本文件宣称整个仓库机器已穷尽。
7. **未做**：浏览器/SDL/物理手机/手柄交互、截图/录屏、注入故障、跑测试、内存/性能测量、golden重录、库API实现核验。`src/ui`内未精读的部分集中在图形构造、布局/数学公式和文案，不是刻意遗漏某个页面目录；但只有静态扫描仍可能漏掉依赖库内部隐含生命周期。

## 机器之间的关键交接（文本索引）

- App effect → createAppSession → host.revealed → prefetch/menu music；host fatal 回调先销毁会话再报告平台错误，晚到 host 同样释放。
- app.start → SceneTransition.cover → app.show → registerScreen/Run → host.prepare → reveal；不混淆业务phase、shader/font readiness和可输入状态。
- settings.close → save.register（动画交叠）→旧dialog.dispose；三输入共用 activeTarget，旧树完成退场不清新窗口按压。
- openCodex → 捕获 screen/runLayer/暂停 codexHome revision → dynamic import → stillHome → 新Codex；页面替换或暂停关闭后，旧成败结果均不影响当前页面。
- run.onEnd → result.saved=false → onFinish 保存确认 → result/原 leaving；失败保持 save-error 仅重试，重试成功后才执行原导航意图。
- run.snapshot → overlay selector → overlay tree/revision → host输入owner → choice flight → run.send →新snapshot；在flight提交前不得绕过动画重复执行。
- modal/context/busy变化 → cancelInput → captures/HUD held/world stick/gamepad上下文；取消输入与暂停世界是两项不同契约。
- font stage ready → RevisionGate → PageRegistry → upload generation；stage release必须终结waiter，不能只释放GPU拷贝。

## 全部责任文件覆盖矩阵

<details>
<summary>展开79个文件的读取范围</summary>

R＝生命周期行为段深入读取；S＝全文件字段/方法/异步/清理词法扫描并抽读，没有宣称所有构造、shader或数值公式逐行验证。共用模式覆盖不等于每个图元各有独立状态机。

| 文件                                                                                   | 行数 | 读取级别 | 对应机器或排除理由                                               |
| -------------------------------------------------------------------------------------- | ---: | -------- | ---------------------------------------------------------------- |
| [src/App.tsx](../../src/App.tsx)                                                       |  109 | R        | UI-APP-BOOT                                                      |
| [src/app/session.ts](../../src/app/session.ts)                                         |  429 | R        | UI-APP-*、UI-ROOM-OWNERSHIP                                      |
| [src/run/session.ts](../../src/run/session.ts)                                         |  297 | R        | UI-RUN-*                                                         |
| [src/ui/gpu/app-host.ts](../../src/ui/gpu/app-host.ts)                                 | 1389 | R        | UI-HOST-*                                                        |
| [src/ui/gpu/app-shell.ts](../../src/ui/gpu/app-shell.ts)                               |  282 | R        | UI-SHELL                                                         |
| [src/ui/gpu/box-shadow.ts](../../src/ui/gpu/box-shadow.ts)                             |  199 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/codex-model.ts](../../src/ui/gpu/codex-model.ts)                           |  494 | R        | UI-CODEX-MODEL/COMPILE/SPIN/THUMBS                               |
| [src/ui/gpu/codex-parts.ts](../../src/ui/gpu/codex-parts.ts)                           |  260 | R        | UI-MOTION、UI-CONTROL-VISUAL、UI-GPU-PARTS                       |
| [src/ui/gpu/codex.ts](../../src/ui/gpu/codex.ts)                                       | 1586 | R        | UI-CODEX-NAV/REVEAL/WINDOW/POINTER、UI-TIP-PRESS                 |
| [src/ui/gpu/crisp-line.ts](../../src/ui/gpu/crisp-line.ts)                             |   11 | S        | 像素边缘纯计算，无独立状态机                                     |
| [src/ui/gpu/currency.ts](../../src/ui/gpu/currency.ts)                                 |  108 | R        | UI-CONTROL-VISUAL                                                |
| [src/ui/gpu/dialog-backdrop.ts](../../src/ui/gpu/dialog-backdrop.ts)                   |  105 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/dialog-surface.ts](../../src/ui/gpu/dialog-surface.ts)                     |  117 | S        | UI-CONTROL-VISUAL + UI-GPU-PARTS                                 |
| [src/ui/gpu/focus-mark.ts](../../src/ui/gpu/focus-mark.ts)                             |   87 | R        | UI-CONTROL-VISUAL                                                |
| [src/ui/gpu/fonts.ts](../../src/ui/gpu/fonts.ts)                                       |  887 | R        | UI-FONT-*                                                        |
| [src/ui/gpu/fullscreen-icon.ts](../../src/ui/gpu/fullscreen-icon.ts)                   |   36 | S        | UI-GPU-PARTS：按传入active更换图标；真实fullscreen机器在platform |
| [src/ui/gpu/game-button.ts](../../src/ui/gpu/game-button.ts)                           |  260 | R        | UI-CONTROL-VISUAL                                                |
| [src/ui/gpu/grayscale-image.ts](../../src/ui/gpu/grayscale-image.ts)                   |   30 | S        | 材质扩展/属性映射，无额外生命周期                                |
| [src/ui/gpu/grid-nav.ts](../../src/ui/gpu/grid-nav.ts)                                 |   79 | S        | gridStep纯空间选择，状态归调用者                                 |
| [src/ui/gpu/hover-pattern.ts](../../src/ui/gpu/hover-pattern.ts)                       |  166 | R        | UI-CONTROL-VISUAL                                                |
| [src/ui/gpu/icons.ts](../../src/ui/gpu/icons.ts)                                       |  230 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/inner-screen.ts](../../src/ui/gpu/inner-screen.ts)                         |  153 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/input-glyph.ts](../../src/ui/gpu/input-glyph.ts)                           |  135 | R        | UI-GLYPHS                                                        |
| [src/ui/gpu/input-hint.ts](../../src/ui/gpu/input-hint.ts)                             |  123 | R        | UI-GLYPHS                                                        |
| [src/ui/gpu/lab.ts](../../src/ui/gpu/lab.ts)                                           | 1250 | R        | UI-LAB-SECTIONS/ACTIONS、UI-TIP-PRESS                            |
| [src/ui/gpu/layer.ts](../../src/ui/gpu/layer.ts)                                       |   67 | R        | UI-LAYER                                                         |
| [src/ui/gpu/line-break.ts](../../src/ui/gpu/line-break.ts)                             |   92 | S        | 换行/字宽纯计算，无独立状态机                                    |
| [src/ui/gpu/lobby-scene.ts](../../src/ui/gpu/lobby-scene.ts)                           |  536 | R        | UI-LOBBY-MODEL/STAGE                                             |
| [src/ui/gpu/lobby.ts](../../src/ui/gpu/lobby.ts)                                       | 1918 | R        | UI-LOBBY-PICK/NAV、UI-TIP-PRESS、UI-CONTROL-VISUAL               |
| [src/ui/gpu/map-swatch.ts](../../src/ui/gpu/map-swatch.ts)                             |  118 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/marks.ts](../../src/ui/gpu/marks.ts)                                       |   28 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/menu-input.ts](../../src/ui/gpu/menu-input.ts)                             |   90 | R        | UI-GESTURE                                                       |
| [src/ui/gpu/motion.ts](../../src/ui/gpu/motion.ts)                                     |   71 | R        | UI-MOTION、UI-CONTROL-VISUAL                                     |
| [src/ui/gpu/multiplayer-seat.ts](../../src/ui/gpu/multiplayer-seat.ts)                 |  160 | R        | UI-ROOM-PAGE、UI-CONTROL-VISUAL                                  |
| [src/ui/gpu/multiplayer-session.ts](../../src/ui/gpu/multiplayer-session.ts)           |   85 | R        | UI-ROOM-OWNERSHIP                                                |
| [src/ui/gpu/multiplayer-view.ts](../../src/ui/gpu/multiplayer-view.ts)                 |   50 | R        | UI-ROOM-PAGE的纯派生view，无自主生命周期                         |
| [src/ui/gpu/multiplayer.ts](../../src/ui/gpu/multiplayer.ts)                           |  609 | R        | UI-ROOM-PAGE                                                     |
| [src/ui/gpu/outlined-text.ts](../../src/ui/gpu/outlined-text.ts)                       |   64 | R        | UI-GPU-PARTS：文字副本的同步/释放                                |
| [src/ui/gpu/run-choice-content.ts](../../src/ui/gpu/run-choice-content.ts)             | 1702 | R        | UI-CHOICE-DEAL/PICK/ACTIONS、UI-CONTROL-VISUAL                   |
| [src/ui/gpu/run-choice-surface.ts](../../src/ui/gpu/run-choice-surface.ts)             |  626 | R/S      | UI-GPU-PARTS：ChoiceArt持有；其余shader只扫描                    |
| [src/ui/gpu/run-damage-numbers.ts](../../src/ui/gpu/run-damage-numbers.ts)             |  331 | R        | UI-HUD-NUMBERS                                                   |
| [src/ui/gpu/run-dev-readout.ts](../../src/ui/gpu/run-dev-readout.ts)                   |   49 | S        | UI-GPU-PARTS：set/place/dispose；创建销毁由app/HUD的devMode拥有  |
| [src/ui/gpu/run-edge-glow.ts](../../src/ui/gpu/run-edge-glow.ts)                       |  131 | R        | UI-HUD-FEEDBACK                                                  |
| [src/ui/gpu/run-edge-indicators.ts](../../src/ui/gpu/run-edge-indicators.ts)           |  341 | R        | UI-HUD-EDGE                                                      |
| [src/ui/gpu/run-hud-interact.ts](../../src/ui/gpu/run-hud-interact.ts)                 |  236 | R        | UI-HUD-PROMPT                                                    |
| [src/ui/gpu/run-hud-surface.ts](../../src/ui/gpu/run-hud-surface.ts)                   |  274 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/run-hud.ts](../../src/ui/gpu/run-hud.ts)                                   | 1690 | R        | UI-HUD-STATE/HOLD/HP/XP/FEEDBACK、UI-RUN-BANNERS                 |
| [src/ui/gpu/run-overlays-control.ts](../../src/ui/gpu/run-overlays-control.ts)         |   26 | S        | control接口类型，无独立状态机                                    |
| [src/ui/gpu/run-overlays-icons.ts](../../src/ui/gpu/run-overlays-icons.ts)             |  386 | S        | UI-GPU-PARTS：图标构造/abort释放，路径未逐点读                   |
| [src/ui/gpu/run-overlays-loading.ts](../../src/ui/gpu/run-overlays-loading.ts)         |  341 | R        | UI-LOADING-TIPS、UI-CONTROL-VISUAL                               |
| [src/ui/gpu/run-overlays-result.ts](../../src/ui/gpu/run-overlays-result.ts)           |  495 | R        | UI-RESULT-BAG                                                    |
| [src/ui/gpu/run-overlays-samples.ts](../../src/ui/gpu/run-overlays-samples.ts)         |  101 | S        | 预热样本数据，无自主状态，见UI-OVERLAY-WARM                      |
| [src/ui/gpu/run-overlays-station.ts](../../src/ui/gpu/run-overlays-station.ts)         |  666 | R        | UI-STATION-FORGET/FUSE                                           |
| [src/ui/gpu/run-overlays-stats-panel.ts](../../src/ui/gpu/run-overlays-stats-panel.ts) |  644 | R        | UI-STATS-DETAIL                                                  |
| [src/ui/gpu/run-overlays-stats.ts](../../src/ui/gpu/run-overlays-stats.ts)             |  219 | S        | 属性分组/来源计算，无UI生命周期                                  |
| [src/ui/gpu/run-overlays-surface.ts](../../src/ui/gpu/run-overlays-surface.ts)         |  190 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/run-overlays.ts](../../src/ui/gpu/run-overlays.ts)                         | 1743 | R        | UI-OVERLAY-TREE/RETIRED/INPUT/WARM                               |
| [src/ui/gpu/run-station-surface.ts](../../src/ui/gpu/run-station-surface.ts)           |  204 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/save-dialog.ts](../../src/ui/gpu/save-dialog.ts)                           |  851 | R        | UI-SAVE-*、UI-TEXT-BUFFER                                        |
| [src/ui/gpu/screen-parts.ts](../../src/ui/gpu/screen-parts.ts)                         |  460 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/scroll-fade.ts](../../src/ui/gpu/scroll-fade.ts)                           |   85 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/scroll-reveal.ts](../../src/ui/gpu/scroll-reveal.ts)                       |   32 | R        | scroll命令helper，无自主计时/owner，状态归screen                 |
| [src/ui/gpu/segment-face.ts](../../src/ui/gpu/segment-face.ts)                         |  142 | S        | UI-CONTROL-VISUAL + UI-GPU-PARTS                                 |
| [src/ui/gpu/settings-dialog.ts](../../src/ui/gpu/settings-dialog.ts)                   |  991 | R        | UI-SETTINGS-CONTROLS/LAYOUT、UI-CONTROL-VISUAL                   |
| [src/ui/gpu/sha256.ts](../../src/ui/gpu/sha256.ts)                                     |   67 | S        | 哈希纯计算，无跨调用状态机                                       |
| [src/ui/gpu/slant-plate.ts](../../src/ui/gpu/slant-plate.ts)                           |  209 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/stage.ts](../../src/ui/gpu/stage.ts)                                       |  145 | R        | UI-STAGE                                                         |
| [src/ui/gpu/station-art.ts](../../src/ui/gpu/station-art.ts)                           |   32 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/tag.ts](../../src/ui/gpu/tag.ts)                                           |  135 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/text-fit.ts](../../src/ui/gpu/text-fit.ts)                                 |   45 | S        | 截断/换行helper，无自主生命周期                                  |
| [src/ui/gpu/text-keyboard.ts](../../src/ui/gpu/text-keyboard.ts)                       |   37 | R        | UI-SAVE-KEYBOARD                                                 |
| [src/ui/gpu/toast-surface.ts](../../src/ui/gpu/toast-surface.ts)                       |  111 | S        | UI-GPU-PARTS：附着/尺寸更新/手动或abort释放；视觉公式未逐行读    |
| [src/ui/gpu/toast.ts](../../src/ui/gpu/toast.ts)                                       |  357 | R        | UI-TOAST                                                         |
| [src/ui/gpu/tooltip.ts](../../src/ui/gpu/tooltip.ts)                                   |  260 | R        | UI-TIP                                                           |
| [src/ui/gpu/ui-shader.ts](../../src/ui/gpu/ui-shader.ts)                               |   26 | S        | 材质构造标识，无额外异步机器                                     |
| [src/ui/gpu/viewport.ts](../../src/ui/gpu/viewport.ts)                                 |   56 | R        | viewport/fitScale纯计算，状态归UI-STAGE/host                     |
| [src/ui/player-colors.ts](../../src/ui/player-colors.ts)                               |    2 | S        | 席位色常量，无状态机                                             |
| [src/ui/scene-transition.ts](../../src/ui/scene-transition.ts)                         |   53 | R        | UI-APP-TRANSITION                                                |
| [src/ui/text-buffer.ts](../../src/ui/text-buffer.ts)                                   |   78 | R        | UI-TEXT-BUFFER                                                   |

</details>
