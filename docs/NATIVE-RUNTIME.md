# Native 运行（2026-11-07）

> 运行基线为 2026-11-07；2026-11-08 按修复源码定向更新存档、输入与失败边界，未重跑原生应用。

当前是仓库内的 **Bun + SDL + WebGL2 应用入口**。启动进入正式大厅，可选择伙伴、地图和已解锁难度，进入研究所、图鉴和设置，出发、重开、结算后返回大厅。Web 与 native 使用同一 `app/session.ts`、GPU 宿主和对局会话，不维护两套导航/进度/音频调度。

存档窗口、编辑状态和导入流程现由两端共享；native 使用 SDL 文本/剪贴板和真正的 AppKit 文件面板。手柄通过同一语义动作入口接入，硬件矩阵仍待实机验收。native 与 Web 都可 DataChannel 直连，也保留 Harbor 中转与恢复。macOS arm64 可构建不依赖仓库、Bun PATH 或当前目录的独立 `.app`，见 [打包说明](NATIVE-PACKAGING.md)；发布签名、公证和第二台机器仍未验证。

```sh
bun install
bun run native
# 本地 Harbor 或其他服务地址：
bun run native --harbor ws://127.0.0.1:8787/multiplayer
# 与自己的记录隔离：
bun run native --save /tmp/poketone-native-session/save.v3.txt
# 聚焦平台契约 + 可见 SDL 的真实渲染烟测，不加入 Web 的日常 check：
bun run test:native
```

已在 macOS arm64、Bun 1.4.4、ANGLE Metal 上运行。入口每次将当前源码编译到 `node_modules/.cache/poketone/native.mjs`，资源从当前仓库 `public/` 读取，不启动 Web 服务，也不读取旧实验目录。字体基础字集仍须按现有流程先生成（`bun run fonts:base`）。默认存档为 `~/.poketone/save.v3.txt`，内容就是 Web 导出的存档码；启动时校验，损坏或不支持的版本直接报错，不覆盖原文件。保存先写同目录临时文件并 flush，再 rename。设置 → 存档可编辑、导入、复制、打开与导出文件。伙伴/难度/地图偏好另存为 `save.v3.txt.pick.json`，不进入可移植存档；缺失时使用默认选择，JSON 损坏或文件读取错误会记录带路径警告并使用默认选择，不阻止有效进度加载。

全屏按钮在进入后保留，图标切换为退出动作；F11 使用同一个 native 切换函数。大厅、研究所、设置、HUD 和局内窗口共用全屏状态与图标。

## 实现与契约定位

跨端行为与发行范围见 [platform-services](../openspec/specs/platform-services/spec.md)，存档行为见 [progress-save](../openspec/specs/progress-save/spec.md)。源码所有权和取消/关闭顺序分别在 [平台状态地图](state-machines/platform.md)、[应用状态地图](state-machines/application-ui.md) 与 [资源状态地图](state-machines/resources.md) 维护，不在此复制模块清单。

## 依赖修复

修在依赖本身，通过 Bun patch 固定；不增加游戏内兼容分支：

1. `webgl-node@1.6.2` 把 `EXT_disjoint_timer_query_webgl2` 列为支持，却返回 `{}`，没有扩展常量，也没有完整的 64 位结果接口。删除这条错误声明。native 的 GPU timer 不可用；共享动态分辨率使用已经存在的无 timer 策略。后端补齐扩展后应删除这个补丁并重新验证，不能填假常量。
2. `three@0.186.1` 的 WebGLAnimation.stop 在循环从未启动时也调用 self.cancelAnimationFrame。Bun 有 self、没有浏览器 rAF，导致 renderer.dispose 崩溃。补丁只在 isAnimating 为 true 时取消帧；修改 source 和应用实际导入的 module build。不安装全局 rAF/cAF 垫片。

3. Three 提供真实外部 context（`canvas:null`）、程序保留句柄和显式 context 生命周期 API。共享 renderer 不读私有 properties/usedTimes，不造 anchor mesh；native context 被替换时新建 renderer，并从已有 CPU 资源和会话重新预热。
4. UIKit 提供 `requestLayout()` / `setBorderWidthGrid()`，删除 flexGrow 翻转和 protected 字段访问。
5. SDL JS 绑定在 restore/minimize/maximize 方法及事件里错误地把 fullscreen 一律清零。补丁移除这个无依据写入，保留 setFullscreen 的真实结果。macOS 26 的 Space 全屏路径失败，因此启动前明确配置 SDL 桌面全屏：占满当前显示器，不创建新 Space，不把最大化伪称全屏。

native 仍会报告一次 `KHR_parallel_shader_compile extension not supported`，使用 Three 自带的同步编译路径。没有隐藏这条警告，也没有据此降低画质。

## 实测与限制

2026-11-07 的运行、应用、性能对比和接缝检查是历史结果，不将历史通过结果当作当前验收。

原生 GPU timer 仍不可用；不能把同步 render 提交时间直接当作 GPU 时间或跨端性能增益。真实手柄、手机输入、Windows/Linux、WAN NAT/TURN、Safari/Firefox RTC、发布签名与公证、第二台 Mac、长局压力测试尚未覆盖。烟测注入 SDL 事件，不等同于 OS 输入验收。

## 存档排查

默认路径与覆盖参数见上文命令。先保留原文件，再按错误定位路径、权限或格式；不要以重新初始化覆盖坏档。当前仍为 progress v4 / 导入导出外壳 v3，仅接受声音、开发者模式、UI 缩放三项设置；旧外壳、旧字段均拒绝，不迁移。默认目录缺少 `save.v3.txt` 但存在旧 `save.txt` 时明确报错并保留旧文件，不自动生成替代存档；已有 `save.v3.txt` 时读取当前路径。`--save` 只指定文件路径，内容仍须通过当前校验。

结算写入失败保留该局结果，显示只有「重试」的「记录保存失败」窗口；成功后才显示结算或继续此前重开/返回意图。背包消费写入失败时，准备好的世界不激活。GPU host fatal 则销毁应用会话后交给平台错误表面。源码转换见 [应用状态地图](state-machines/application-ui.md#ui-run-leave)；保存与激活接线仍待主线程最终审阅，本次未验收正式 App。
