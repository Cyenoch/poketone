# 平台、输入与存储状态机

阅读方法、基线和覆盖边界见 [总清单](../STATE-MACHINES.md)。这里描述代码已经表达的状态，不要求为每项新增类、枚举或框架。源码链接的行号是本次阅读的定位线索；以后优先按类/函数名查找。

2026-11-08 按修复 diff 更新受影响条目；本次只核对源码与测试定义，未执行设备或产品测试。旧复现仍属原审计。

## PL-01 物理手柄连接身份

- **所有者/编码**：[WebGamepads](../../src/platform/web/gamepad.ts#L21)、[NativeGamepads](../../src/platform/native/gamepad.ts#L19) 的 `serial/devices/token`；native 额外保留两次采样之间的 `pressed`。
- **状态/转换**：未连接 → 发现/打开 → 可采样 → 拔出/关闭。浏览器连接事件或轮询补发现；SDL remap 清空按压并换 token，相当于新的逻辑设备。
- **守卫/终态**：同一 native device 不重复打开；已关闭设备不采样；移除/销毁清除身份并释放监听/句柄。GamepadSource 仅 sample/dispose，没有震动发送、stop 或 reset 链。
- **不变量**：可复用的浏览器 index、SDL id 不等于连接身份；旧按压不能归到新连接。native 的短按事件补偿不能被下一次实时 buttons 快照覆盖。
- **证据**：共享输入测试覆盖部分断连语义；物理热插拔/不同驱动未在本次验收。

## PL-02 活跃手柄认领与回中

- **所有者/编码**：[ActionInput.sample](../../src/platform/input.ts#L199) 的 `activeToken/previous/unsupported/neutral`。
- **状态/转换**：无主 → 已按键认领但等待回中 → 可操作；`blocked` 或 cancel 回到等待回中；活跃设备消失回到无主。
- **守卫/终态**：只接纳 mapped 设备；首次按下认领时清掉待处理动作，不把用于认领的按键立即用于确认。按钮/摇杆全部归零后才解除 neutral；unsupported 通知按连接 token 去重。
- **不变量**：一个时刻只有一个活跃手柄；断开必须清输入并向宿主报告 disconnected，暂停决策属于宿主。
- **证据**：[ui-input.test](../../scripts/ui-input.test.mjs)；不能由合成采样推断实际设备已验收。

## PL-03 键盘取消与重新武装

- **所有者/编码**：[ActionInput](../../src/platform/input.ts#L145) 的 `keys/blockedKeys/pending`。
- **状态/转换**：松开 → 按住 → cancel 后仍按住但被阻断 → keyUp 或新的非 repeat keyDown → 可重新接受。
- **守卫/终态**：失焦期间可能丢 keyUp，因此新的非重复按下是重新武装依据；被阻断的 repeat 不能重新产生移动或确认。动作由 sample 一次取走；dispose 清空。
- **不变量**：切页、暂停、失焦后不能把旧按压带入新界面。
- **证据**：[ui-input.test](../../scripts/ui-input.test.mjs)、[ui-menu-input.test](../../scripts/ui-menu-input.test.mjs)。

## PL-04 移动/转向来源与输入上下文

- **所有者/编码**：[ActionInput](../../src/platform/input.ts#L128) 的独立 `moveOwner/turnOwner`、各设备轴值，以及 sample 的 `gameplay/choice/navigation/blocked`。
- **状态/转换**：移动和转向各自在 keyboard/touch/gamepad 之间被有效活动认领；零轴不会无故抢回所有权。context 由 GPU host 决定，同一手柄摇杆在导航时变成滚动/导航转向。
- **守卫/终态**：blocked 不输出动作；非 gameplay/choice 不输出移动转向。cancel 清轴，但不是销毁设备；dispose 才释放 source。
- **不变量**：不能以“最后用了哪种提示图标”代替移动/转向各自的 owner；界面输入目标由 [UI-HOST-TARGET](application-ui.md#ui-host-target) 的 syncInputOwner 在 pointerdown、keyDown 与 sample 时共同同步。SDL 键码适配修复见 PL-07。
- **证据**：[ui-input.test](../../scripts/ui-input.test.mjs)。

## PL-05 导航方向滞回与连发

- **所有者/编码**：[ActionInput.sample](../../src/platform/input.ts#L276) 的 `direction/repeatAt`。
- **状态/转换**：无方向 → 首次方向动作 → 等待初始延迟 → 持续重复；方向改变重新计时，回中清方向。摇杆进入阈值0.55、保持阈值0.35；300ms初延迟、110ms重复。
- **守卫/终态**：只在 navigation/choice 使用；choice 的方向来自十字键。cancel/断连解除保持。
- **不变量**：连发是有记忆的输入协议，不能只按当前轴符号每帧确认一次。
- **证据**：[ui-input.test](../../scripts/ui-input.test.mjs)；这些数值记录当前实现，不另设发布数字门禁。

## PL-06 震动许可与冷却

**已移除，仅保留编号。** **#19** 修复已删除设置、ActionInput.feedback、冷却字段及两端 rumble/stop/reset 链；当前不存在此状态机。输入归零、断连和设备销毁继续由 PL-01–04 负责，后续编号不重排。设置仅 sound/devMode/uiScale，校验见 PL-14/15。

## PL-07 平台指针、文本键和失焦归属

- **所有者/编码**：[NativeUiSurface.listen](../../src/platform/native/ui-surface.ts#L89) 的 `editingKeys/fingers/nextFinger/#captured`；[WebUiSurface.listen](../../src/platform/web/ui-surface.ts#L108) 依赖 canvas capture、焦点和 DOM visibility。
- **状态/转换**：指针 down 建立连续身份，move 保留，up/cancel 移除；native touch 过滤鼠标合成事件。文字输入消费的 scancode 被记录，配套 keyUp 不再泄露给游戏。键码已补 PAGEUP/PAGEDOWN→PageUp/PageDown、KP_ENTER→NumpadEnter（key=Enter）、GRAVE→Backquote。
- **守卫/终态**：native blur/hide/minimize 取消 fingers、释放 capture、清编辑按键并 blur 文本；Web blur/hidden/lostpointercapture 向共享 host 取消对应状态。停止监听与 dispose 是不同清理职责。
- **不变量**：文本编辑不能同时触发游戏快捷键；指针离开窗口后的释放要能结束按压。控件拖拽/点击阈值由 UI 机器负责。
- **证据**：[native-text.test](../../scripts/native-text.test.mjs)、[native-platform.test](../../scripts/native-platform.test.mjs)；**#12** 的合成 SDL 事件到共享导航定位在 [native-ui-input.test](../../scripts/native-ui-input.test.mjs)，不表示已验实体键盘。

## PL-08 文本选区与修订

- **所有者/编码**：[TextBuffer](../../src/ui/text-buffer.ts#L2) 的 `text/anchor/cursor/revision` 与订阅集合。
- **状态/转换**：折叠光标 ↔ 正向/反向选区；输入替换选区后折叠；左右移动、Home/End、shift扩选、delete/backspace 更新修订并通知。
- **守卫/终态**：set 将偏移限定在文本内，无变化不发布；左右移动跨完整 surrogate pair。卸载通过取消订阅结束观察；buffer本身没有 disposed 状态。
- **不变量**：UTF-16偏移、选择方向、GPU键盘和平台编辑器共享一份权威文本；不可用第二份显示文本反向覆盖选区。
- **证据**：[ui-text-buffer.test](../../scripts/ui-text-buffer.test.mjs)；这不等于支持所有 Unicode 字形或复杂字素导航。

## PL-09 平台编辑器焦点

- **所有者/编码**：[NativeTextServices](../../src/platform/native/text.ts#L12) 的 `active?: Editor`；[Web createInput](../../src/platform/web/text.ts#L7) 的 textarea、buffer订阅、visible/invalid和系统焦点。
- **状态/转换**：创建但未聚焦 → 编辑中 → blur/交还窗口；native 聚焦另一 editor 先通知旧 owner 失焦。Tab/Esc交还给窗口，已提交文本进入 buffer；clipboard错误回传当前editor。
- **守卫/终态**：旧 editor 的 blur/dispose 不能清掉新 active；Web通过 field身份判断 selectionchange，dispose移除节点/订阅；native service dispose同时关闭文件服务。
- **不变量**：文字服务拥有输入/剪贴板，业务导入验证属于存档窗口；渲染文字和系统编辑表面边界不能混为“全DOM”。
- **证据**：[native-text.test](../../scripts/native-text.test.mjs)、[ui-save-dialog.test](../../scripts/ui-save-dialog.test.mjs)；没有本次真实IME验收。

## PL-10 文件选择、异步回调与销毁

- **所有者/编码**：[NativeFileDialogs](../../src/platform/native/file-dialogs.ts#L16) 的 `library/pending/disposed`，对应 [AppKit sheet](../../src/platform/native/platform-dialogs.m)；Web openFile/saveFile 在 [text.ts](../../src/platform/web/text.ts#L73)。
- **状态/转换**：未载库 → 空闲 → sheet打开 → 回调已到、等待离开原生调用栈 → 释放句柄 → 空闲。等待期间dispose发cancel，回调后才关闭FFI库。
- **守卫/终态**：disposed后不可choose；一个native sheet未结束前不允许第二个。无window/open失败显式reject；用户cancel返回null。Web等待change/cancel，读取失败reject；下载object URL稍后撤销。
- **不变量**：不能在AppKit回调栈中卸载仍在执行的库；取消不伪装成成功导入/导出。调用窗口还须检查自己的异步请求归属，见UI清单。
- **证据**：本次静态追踪；历史native接缝QA提供具体批次实机范围，不把FFI路径读取当作重验。

## PL-11 首次手势、全屏与横屏请求

- **所有者/编码**：[gesture.ts](../../src/platform/gesture.ts#L7) 的 handlers集合；[landscape.ts](../../src/platform/landscape.ts#L14) 的 `wanted/requesting/stopFirstGesture` 和浏览器fullscreen状态。
- **状态/转换**：无订阅 ↔ 等待手势；handler返回true解除自身。全屏为无需请求/等首个touchend/请求中/全屏/用户退出，退出后不重新武装首手势；后续需显式控件。
- **守卫/终态**：installed、API可用性和粗指针决定初次请求；requesting阻止并发；请求finally复位，失败具体warn，不冒充已经全屏。fullscreenchange后才尝试方向锁。
- **不变量**：普通后续游戏触摸不反复抢全屏；权限拒绝不应该结束对局。iOS安装提示只有成功写入“已提示”才能认领，存储不可用保持不显示。
- **证据**：[ui-fullscreen.test](../../scripts/ui-fullscreen.test.mjs)；浏览器手势/方向锁与物理Safari仍需独立验收。

## PL-12 Web挂载与故障表面

- **所有者/编码**：[main.tsx](../../src/main.tsx#L28) 的 `AppRenderer | Error`，React [RenderBoundary](../../src/RenderBoundary.tsx#L8) 的 error，以及 [WebUiSurface](../../src/platform/web/ui-surface.ts#L13) 的 `#mounted/#style/#tabIndex`。
- **状态/转换**：创建page级canvas/renderer → React会话挂载；创建失败移除canvas并进入启动错误表面。UI surface首次present保存原样式/挂探针，dispose恢复；React渲染异常进入Boundary的错误页，重新加载重建整个页面。
- **守卫/终态**：未present的StrictMode取消实例不修改后继canvas；renderer位于React effect重播之外。错误页显示本身不是世界暂停信号。
- **不变量**：canvas 与会话不同生命周期；**#1** 已在 createAppSession 的 host error 回调先 dispose 会话，再报告平台错误；创建中晚到 host 也清理并抛错。停止世界来自显式会话销毁，不是错误页本身。
- **证据**：[ui-run-session.test](../../scripts/ui-run-session.test.mjs) 的准备中/已激活会话夹具；本次未运行正式错误页。

## PL-13 原生应用启动、晚到会话与退出

- **所有者/编码**：[createNativeApp](../../src/platform/native/main.ts#L14) 的 `abort/session/closed`，平台renderer的surface/frame循环另见资源清单。
- **状态/转换**：读取存档/安装服务 → 创建surface/renderer → 等createAppSession → 运行；window beforeClose、信号或fail进入close。
- **守卫/终态**：closed防重复退出；先abort、dispose会话、清直连、移除信号，再等待audio.dispose、dispose renderer。若异步创建会话晚于close，返回后立即dispose它；创建catch执行close再抛错。
- **不变量**：退出意图胜过晚到的创建结果；**#4** 凭据写入/清除异常已由网络 session 转为 warning，不再中断该链。这描述具体修复，不宣称每个 cleanup 抛错后都已保证继续清理。
- **证据**：静态追踪及有日期的native QA；未重验关闭中的真实文件sheet/audio。

## PL-14 正式进度加载与提交

- **所有者/编码**：[ProgressLoad](../../src/run/progress.ts#L65) 的 ready/locked；[webAppStorage.save](../../src/platform/web/app-storage.ts#L8) 的 previous/written；[nativeAppStorage](../../src/platform/native/app-storage.ts#L7) 的缓存save；[writeTextFile](../../src/platform/native/save.ts#L44) 的临时文件/rename。
- **状态/转换**：Web读到可解释进度→ready，无法解释则保留原数据并locked；完整导入先校验，再写progress/settings，部分失败按written逆序恢复，恢复也失败则AggregateError。native缺文件产生初始数据，损坏/其他读取错误向外抛；完整文件flush后rename成功才更新内存缓存。
- **守卫/终态**：上层 change 先保存再更新应用 progress。progress 仍为 v4、导入导出外壳仍为 v3；旧外壳和未知字段拒绝，时间须有限非负、计数须非负安全整数，写入/导出前也验证。native 默认路径优先 `save.v3.txt`；缺少当前文件但存在旧 `save.txt` 时报错保留原文件，不迁移。
- **不变量**：**#20/#21** 已将未保存 result 留在 run session，save-error 只允许重试，成功后才结算/导航；背包消费失败不注册世界 advance。原子文件替换不等于整个业务天然有事务性，最终保存接线审阅仍由主线程完成，见 [UI-APP-PROGRESS](application-ui.md#ui-app-progress)。
- **证据**：[native-save.test](../../scripts/native-save.test.mjs)、[ui-save-import.test](../../scripts/ui-save-import.test.mjs)、[ui-run-session.test](../../scripts/ui-run-session.test.mjs) 为当前测试定位。

## PL-15 便利偏好与重返凭据

- **所有者/编码**：[lobbyPick](../../src/lobbyPick.ts#L29)、[settings](../../src/settings.ts#L22)、两端AppStorage及[联机窗口会话](../../src/ui/gpu/multiplayer-session.ts#L26)。
- **状态/转换**：偏好缺失/可解析/不可解析 → 当前有效选择；解锁变化后validPick重新收敛。Web写偏好失败保持本会话选择；重返凭据则在房间开始、恢复、finish/close时保存或清除。
- **守卫/终态**：便利偏好与正式进度分离。**#5**：native `.pick.json` 缺失用默认选择；JSON/文件读取错误记录带路径 warning 后回默认，其他非预期异常仍抛出。**#4**：loadRejoin 失败通知并继续无凭据窗口；session 捕获凭据写入/清除失败并报告 warning，网络交付另见网络分册。
- **不变量**：不可将“缓存不了选角/重返”升级成“不能游玩或不能退出”；也不可把主存档损坏默认为新档。普通解析函数本身是纯转换，不单独计数成状态机。
- **证据**：原可选存储复现是历史失败；当前定义见 [native-save.test](../../scripts/native-save.test.mjs)、[network-storage.test](../../scripts/network-storage.test.mjs)。Web 设置使用同一三项严格校验，拒绝旧字段后保留原存储并警告，本会话使用默认值；无自动迁移/重写。

## PL-16 开发服务重建与整页刷新

- **所有者/编码**：[serveWeb](../../scripts/web.mjs#L62) 的 `files/buildError/revision/instance/building/dirty/stopped/timer/streams/watchers`。
- **状态/转换**：启动构建→可服务；文件变化debounce后重建，构建中再次变化只标dirty，结束后再跑一次。成功换files并递增revision、SSE通知；失败保留原files并发送error；客户端成功且版本不同才整页reload。
- **守卫/终态**：stopped后不再广播/递归重建；stop关watcher、SSE和服务；启动失败先stop。实际异步bundle不能取消，清单不声称stop会中断其工作。
- **不变量**：GPU/音频/世界不能当作普通模块热替换幸存；同一次实例的版本身份含instance，重启服务不会误用旧revision。
- **证据**：[web.test](../../scripts/web.test.mjs)。这是开发工具生命周期，不属于发布游戏内功能。

## PL-17 本机代理与开发服务组合生命周期

- **所有者/编码**：[multiplayerProxy](../../scripts/web.mjs#L16) 的peer/socket/pending；[dev.mjs](../../scripts/dev.mjs#L6) 的harbor/web引用。
- **状态/转换**：代理先接上游、缓存早到消息，再升级下游、flush pending，任一连接关闭带动另一端；连接失败返回502，upgrade失败关上游。组合启动先Harbor后Web，第二步失败或信号到来依序停止已有服务。
- **守卫/终态**：正式收发前有两端不同的ready时点；pending消息不能在绑定socket前丢失。固定端口冲突显式失败，不默默换端口。
- **不变量**：工具自身拥有的连接/进程才由其关闭；生产Harbor状态另见联机清单。
- **证据**：[web.test](../../scripts/web.test.mjs)及既有Harbor测试；本次未新启正式开发服务。

## PL-18 构建发布阶段与字节身份

- **所有者/编码**：[bundleWeb/buildWeb](../../scripts/web-build.mjs) 中的资源清单、临时 public 快照、StyleX 目录、bundle 结果与输出目录。
- **状态/转换**：buildWeb 先把 public 解引用复制到私有临时目录 → 从快照生成一次 URL 映射 → bundle 使用该映射 → 普通文件/哈希副本均从同一快照复制 → 写 bundle。public 快照和 StyleX 临时目录各在 finally 释放；中途失败抛出。
- **守卫/终态**：这是一项由顺序副作用编码的构建流程，不是持久运行的游戏机器；发布所需的不变量是“清单、哈希名与实际字节来自同一快照”。
- **修复边界**：**#15** 的清单/字节二次读取差异已收敛到同一快照；这不是输出目录的原子发布或失败回滚，不能在图里虚构额外事务。
- **证据**：[build.test](../../scripts/build.test.mjs) 已加入构建期间源资源变化及符号链接字节的检查定义；本次文档更新未运行构建。native 打包另有手册，不把资产生成工具计作应用内状态机。

## PL-19 SDL帧泵、呈现失败与context重建

- **所有者/编码**：[NativeRenderSurface](../../src/platform/native/render-surface.ts#L87) 的 `timer/stopped/recovering/#events/#waiters`，window.visible/minimized、context与renderer引用。
- **状态/转换**：可见→排一帧→frame返回是否呈现→swap成功后继续；没有呈现则8ms后再取帧；隐藏/最小化清timer，show/restore在可见且未stopped时重新resize并排帧。首次swap失败进入recreateContext，重建后再次失败显式终止。
- **守卫/终态**：recreate先通知lost、释放旧renderer/context，再创建新的并通知restored；成功swap清recovering。frame异常置stopped、释放waiters并报告平台fail；stop清监听/timer、放行waiters；最终dispose销毁context/window。
- **不变量**：窗口可见性、待绘帧、是否成功呈现、context恢复是不同状态；nextFrame等待者只在frame结束或stop放行，隐藏不会冒充已经呈现。AppRenderer的generation/资源恢复另见 [R01](resources.md#r01)。
- **证据**：静态读取与既有native QA。本次没有SDL窗口，也没有实机swap失败/恢复注入。

## PL-20 Web帧泵与context事件绑定

- **所有者/编码**：[WebRenderSurface.start](../../src/platform/web/render-surface.ts#L28) 的animationLoop、canvas事件监听、document visibility和返回的停止闭包。
- **状态/转换**：创建renderer→注册frame/lost/restored/input/resume→帧循环；visible通知resume；浏览器context事件转发给AppRenderer；stop停loop并解除监听，dispose请求context loss。
- **守卫/终态**：项目的lost/restored监听在Three自身监听之后注册；具体恢复状态由 [R01](resources.md#r01) 管理，不能把setAnimationLoop存在当作context可用。页面/React会话之间的生命周期边界见PL-12。
- **不变量**：平台表面提供调度与事件，世界/页面是否可推进由上层机器判断；失焦清输入不等于frame loop已经停止。
- **证据**：相关headless/浏览器诊断脚本的限制见资源分册；未在本次启动浏览器。

## 范围说明

本页读取共享输入、Web/SDL游戏手柄与surface、全屏/手势、文本/剪贴板/文件sheet、应用启动、两端存储和本机Web服务/构建。Resources/Runtime的安装函数、路径转换、错误格式化和纯校验不是独立的多阶段机器；它们的调用生命周期在所属条目中记录。第三方浏览器/SDL/FFI内部状态与操作系统文件原子性实现不在源码审计范围内。
