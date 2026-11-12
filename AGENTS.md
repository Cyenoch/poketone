# 项目协作

非明确要求不创建分支；保留他人的改动。采用满足当前需求的最小完整实现，先复用已有设施，不预建通用引擎、兼容 shim、旧接口转发或双实现路径。校验放在真实信任边界，不用 catch-all 将失败伪装成成功。

## 文档与 OpenSpec

先读 [README](README.md)、[文档目录](docs/README.md) 和目标能力主规范；架构/命令见 [CLAUDE](CLAUDE.md)，产品定位与视觉参数见 [PRODUCT](PRODUCT.md) 与 [DESIGN](DESIGN.md)。

本项目使用 OpenSpec。新增能力、行为变化、跨模块重构和分步验收先读对应 `openspec/specs/<capability>/spec.md`，用 `bun run spec:list` 找已有 change；没有同目的 change 时按 [项目工作流](docs/OPENSPEC.md)建立 proposal、delta specs、必要 design 与 tasks。普通文案修正和不改契约的小修不强制建 change。已授权工作继续推进，不因流程重复索要确认。

`openspec/specs` 是行为契约的唯一来源，活动 `changes` 管设计和待办，`docs` 仅维护有独立用途的手册/源码地图；日期验证证据不入库。其他入口引用来源，不复制完整规则或任务状态。已承接的旧计划删除，不留跳转壳或另一份活动副本。归档前核对实际实现、勾选已完成任务、同步规范并运行 `bun run spec:check`；结构通过不等于产品验收。

本仓库统一用 `bun run spec <子命令>` 调用锁定版本；官方生成工作流中写作 `openspec ...` 的示例也按此执行，避免命中机器上不同版本的全局 CLI。

## UI 与宿主

继续 UI/宿主工作前读 [GPU 规范](openspec/specs/gpu-presentation/spec.md)、[平台规范](openspec/specs/platform-services/spec.md)、DESIGN 及 [未完成验收](openspec/changes/complete-shared-ui-acceptance/design.md)。实现生命周期查 [源码地图](docs/STATE-MACHINES.md)。历史停工、线程所有权和过时接线状态不再作为当前指令；已有用户验收不能外推成当前整树全量验收。

正常可见 UI 由共享 Three/WebGL 绘制，Web 与 SDL 共用；不新增正常可见 DOM UI，不用 DOM/CSS 截图或模拟器冒充 GPU UI。文本输入、文件和平台错误表面使用明确的平台服务边界。

保真迁移，不借迁移重新设计。样式、动画、时序、交互尽量与已确认的最新视觉基准一致；库没内置或实现麻烦不是简化理由。关键页面对照截图和动态录制，不以 Yoga 布局盒居中、常量断言或隔离探针替代正式页面的文字墨迹和视觉验收。已被大厅取代的旧首页构图不再作为回退目标。

用户于 2026-11-05 明确取消“减少动态”：不监听 `prefers-reduced-motion`，不添加相关控件和分支。设置仅保留声音、开发者模式、UI 缩放三项；不添加手柄震动设置或反馈，不兼容旧字段/旧存档，不添加迁移路径。原生默认目录中的旧 `save.txt` 不自动迁移，拒绝时保留原文件。

冻结已完成菜单/设置按压细节和无关 Toast 打磨，优先完成真实验收缺口；未批准的视觉变化先说明原因与替代方案。页面细节还须读相应 `.impeccable/surfaces/` 简报。

## 验证与报告

模拟保持纯净、固定步长和种子随机，画面只读；行为不变时 golden 不得重录。测试保护当前可观察行为，沿用 `scripts/*.test.mjs`，不写复述实现、常量或历史删除证明的测试，不设外观偏好类阻塞门禁。

按改动风险选择验证，实际运行结果与引用旧证据分别说明。物理设备、正式 App 和合成夹具不可互相冒充。重要阶段尽可能使用独立 agent 审阅。

界面文案少而准确：信息只说一次，优先用结构、标签、状态和交互自解释，补充帮助按需出现。发生失败要显式可观测，错误带定位上下文。
