# platform-services Specification

## Purpose

定义浏览器与 SDL 宿主向共享游戏提供输入、文本、存储和窗口能力的边界，使平台差异不复制玩法或页面逻辑，同时准确约束原生发行的支持范围。

## Requirements

### Requirement: 共享应用生命周期

Web 与 native SHALL 共享大厅、研究所、对局、重开与返回大厅的状态流程；退出应用 SHALL 终止本次拥有的资源、连接和恢复计时器。

#### Scenario: 联机恢复中关闭应用

- **WHEN** 用户在服务不可达或重连期间退出应用
- **THEN** 本次连接和计时器结束，不因后台恢复任务阻止退出

### Requirement: 语义输入与文本服务

键鼠、触控和手柄 SHALL 进入同一语义操作与焦点规则；物理快捷键与文本输入 SHALL 保持各自用途。剪贴板与系统文件操作 SHALL 使用对应平台服务。

#### Scenario: 文本编辑占用焦点

- **WHEN** 用户编辑存档文本
- **THEN** 输入作用于编辑器，不意外触发游戏快捷操作；取消系统面板后可继续使用应用

### Requirement: 原生独立包

macOS arm64 独立包 SHALL 包含所需运行时、发布资源和原生依赖；启动 MUST 不依赖仓库、工作目录或用户 PATH 中的 Bun。

#### Scenario: 从任意工作目录启动

- **WHEN** 在受支持的 macOS arm64 环境中从仓库之外启动独立包
- **THEN** 能进入大厅并读取包内资源，无需 Web 服务或源码目录

### Requirement: 支持范围如实报告

发行说明 SHALL 区分本机开发、独立包、签名/公证和跨机器验证；没有证据的平台与设备 MUST 保持未验证状态。

#### Scenario: 只有本机 ad-hoc 包证据

- **WHEN** 已在本机验证独立包，但未做公证或第二台机器验证
- **THEN** 记录本机通过，不宣称已完成公开发行或其他操作系统支持

### Requirement: 输入认领与重新武装

应用 SHALL 只认领一个有效手柄，不因连接事件或漂移抢占当前输入；切换输入目标、失焦或设备断开时 SHALL 清除旧轴和未提交动作。持续按住的确认/技能 SHALL 在松开后重新可用，摇杆 SHALL 回中后再参与新窗口导航；已经确认的业务提交 MUST NOT 被误清。

#### Scenario: 移动时打开选卡

- **WHEN** 玩家持续推杆移动并打开需要导航的窗口
- **THEN** 旧移动输入不会立即选中或确认卡片，回中后才允许新窗口导航

#### Scenario: 正在输入的设备断开

- **WHEN** 当前手柄断开或应用失焦
- **THEN** 移动、转向与持续按键归零，不自动恢复游戏或让其他设备的连接通知触发动作

### Requirement: 平台权限明确失败

游戏内操作可通过手柄访问 SHALL 不等同于浏览器已经授予音频、全屏、剪贴板或系统文件权限。权限不满足时 SHALL 明确反馈并保留当前状态，不把失败显示为成功。

#### Scenario: 手柄请求受限系统操作

- **WHEN** 手柄触发的系统操作缺少浏览器要求的用户激活或权限
- **THEN** 不伪造全屏、复制或文件提交成功，玩家仍可返回并以平台允许的方式操作

## References

- [src/app/session.ts](../../../src/app/session.ts)
- [src/platform/app-storage.ts](../../../src/platform/app-storage.ts)
- [docs/NATIVE-RUNTIME.md](../../../docs/NATIVE-RUNTIME.md)
- [docs/NATIVE-PACKAGING.md](../../../docs/NATIVE-PACKAGING.md)
- [docs/state-machines/platform.md](../../../docs/state-machines/platform.md)

规范定义行为契约；文档导航见 [文档入口](../../../docs/README.md)。规范同步和格式校验不表示所有场景已经通过验收。
