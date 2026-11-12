# 在本项目使用 OpenSpec

本项目采用官方 `spec-driven` schema，开发依赖精确固定为 `@fission-ai/openspec@1.16.1`。所有命令从仓库根目录用 `bun run spec` 执行，生成技能中的 `openspec ...` 示例也替换为此入口；不依赖机器的全局 CLI。

```sh
bun install --frozen-lockfile
bun run spec --version
bun run spec:list
bun run spec:specs
bun run spec:check
```

## 找到唯一来源

文档归属规则见 [documentation 主规范](../openspec/specs/documentation/spec.md)，入口见 [文档目录](README.md)。行为修改更新目标主规范的 delta；当前任务只查对应 change；数值查领域源码，视觉参数查 DESIGN；手册说明如何运行和排查；有日期的QA证据不保存在仓库中。

清理旧文档时，先承接唯一有效信息，再删除旧正文并修引用，不建立另一份 docs/archive 或跳转壳。历史原文可用 `git show <commit>:<path>` 追溯。OpenSpec 归档保留的是完成变更的证据，不作为另一份当前规范维护。

## 开始与实施

先用 `spec:list` 查同目的 change。新行为、跨模块重构和分步验收按项目要求建立或更新 change；错字、链接等不改契约的小修直接完成。纯工具/文档变更没有规范增量时可使用官方 `skip_specs: true`，不要虚构产品需求。

已生成官方 Codex 技能和 Claude `/opsx:*` 入口：explore、propose、apply、update、sync、archive，以及 verify、bulk-archive。先读各技能返回的指令，按当前用户授权推进；不另造工作流或重复请求授权。

不使用聊天命令时：

```sh
bun run spec new change <name>
bun run spec status --change <name> --json
bun run spec instructions proposal --change <name> --json
# 根据依赖图取得 specs / design / tasks 的 instructions 并完成真实产物
bun run spec instructions apply --change <name> --json
bun run spec validate <name> --strict --no-interactive
```

新增能力写 ADDED；修改既有需求写完整 MODIFIED 块，保留未改变的场景。格式和上下文以当前版本的 `instructions` 为准。任务只在实际完成后勾选；结构验证不替代代码、正式画面或设备验收。

## 同步与归档

```sh
bun run spec archive <name> --yes
bun run spec:check
```

官方 CLI 验证、同步 delta 并归档。`--yes` 省去终端确认，不代表完成未做的任务；不用 `--no-validate` 绕过错误，也不用 `--skip-specs` 隐藏未同步增量。仅归档实际完成的工作。CI Verify 运行相同的 `spec:check`。

## 维护生成文件

```sh
bun run spec update --dry-run
bun run spec update
```

先检查 dry-run：update 会读取执行者的全局 profile，不能无意增删仓库工作流。升级时更新精确开发依赖、锁文件和官方生成文件，检查 diff 与 strict；不修改个人全局安装或 profile。`.agents/skills/openspec-*`、`.claude/skills/openspec-*` 和 `.claude/commands/opsx` 由 CLI 管理，不手改。

官方依据：[Concepts](https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md)、[Workflows](https://github.com/Fission-AI/OpenSpec/blob/main/docs/workflows.md)（2026-11-08 核对）。主规范是行为来源，change 保存拟议差异、设计与任务；实现步骤不属于行为规范。本项目在此基础上保留必要的操作手册。
