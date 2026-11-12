# 输入设备接入与排障

输入认领、回中、焦点、权限与失焦规则只在 [platform-services](../openspec/specs/platform-services/spec.md) 维护；实际转换见 [平台状态地图](state-machines/platform.md)。本页用于接入设备和定位问题，不维护实施计划或另一套按键定义。

## 操作与识别

完整键位和上下文以 [bindings](../src/platform/input.ts) 为准，页面键帽读取同一动作表。左杆移动、右杆X转镜头；右杆Y不提供瞄准或俯仰。方向键用于导航，肩键用于页签/类别；多人构筑确认使用页面显示的专用键，不按旧提案猜测。

确认/返回按物理南/东位置：Xbox为A/B，PlayStation为×/○，Switch为B/A。名称用于键帽家族，不代表已验证该型号的全部能力。只有有效输入认领设备，连接或手柄静止不会自动选择页面。正式选卡已没有跳过按钮。

## Web 排查顺序

1. 在应用页面获得焦点，实际按一次手柄，再检查浏览器是否暴露设备和标准mapping。数组槽可能稀疏，设备index不是永久身份。
2. 查看是否在安全上下文、顶层页面或具备适当的 `gamepad` Permissions Policy；iframe权限、隐私限制和平台支持不能由游戏伪造。非标准mapping不靠名称猜按键。
3. 游戏内导航成功不代表全屏、音频、剪贴板或系统文件操作取得了浏览器用户激活。检查对应错误，并使用平台允许的实际点击/按键。
4. Steam Input可将内置或实体手柄转换成虚拟设备，也可模拟键鼠；检查配置是否重复发送。网页不能根据虚拟ID断言真实型号或Steam Deck硬件。

资料入口：[Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API)、[Permissions Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/gamepad)、[User activation](https://developer.mozilla.org/en-US/docs/Web/Security/User_activation)。原平台调研日期为2026-11-07；实际支持以当前浏览器和设备实测为准。

## SDL 排查顺序

检查 [native/gamepad.ts](../src/platform/native/gamepad.ts) 的设备身份、mapping和轴归一化；驱动若已给归一化浮点值，不能再按整数轴缩放。快速按下/松开是否跨帧保留、全屏/失焦/重连后是否重新认领，分别沿状态地图定位。输入事件成功不等于真实硬件成功。

`NativeUiSurface` 已补齐 PAGEUP/PAGEDOWN、KP_ENTER、GRAVE 到共享物理键码的映射；小键盘确认保留 `code=NumpadEnter`、`key=Enter`。合成事件测试定位在 [native-ui-input.test.mjs](../scripts/native-ui-input.test.mjs)，不等于实体键盘验收。当前没有手柄震动设置、反馈或 stop/reset 链；`GamepadSource` 仅有 sample/dispose，两端继续清除输入状态，SDL 释放设备句柄。

## 证据入口

- 既有输入检查以合成输入为主；native 语义动作、文本/文件等已接入，不能恢复成旧提案的“尚未实施”。本手册更新未运行设备检查。
- [剩余设备验收](../openspec/changes/complete-shared-ui-acceptance/design.md)：真实USB/Bluetooth、设备轴端点、拔插、浏览器权限和逐屏闭环集中在该change，不在此再建任务表。
