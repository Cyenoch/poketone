# ElevenLabs MCP

本项目直接连接 [ElevenLabs 官方托管 MCP](https://elevenlabs.io/mcp)：`https://api.elevenlabs.io/v1/mcp`。使用客户端原生 HTTP 与 OAuth 支持，无需本地 MCP 进程、Python、启动脚本或 API Key。

官方 [2026-11-03 更新说明](https://elevenlabs.io/blog/introducing-voice-music-image-and-video-generation-in-the-elevenlabs-mcp)明确托管 MCP 支持音乐和音效生成。旧本地 MCP 已停止维护，不再使用。

## 配置

- Codex：`.codex/config.toml`；已在本机 `~/.codex/config.toml` 中将当前项目标记为受信任，以加载项目配置。
- Claude Code：`.mcp.json`；本机的 `.claude/settings.local.json` 仅批准 `elevenlabs` 这个项目服务。首次在此目录运行 Claude，仍需接受客户端的项目信任提示，此后本地批准配置才会生效。
- 两者连接同一官方 URL，各自由客户端管理 OAuth 登录、令牌保存与刷新。项目配置不包含密钥或本机目录。
- Codex 的工具超时设为 300 秒，为音频生成留出时间。
- 移动项目无需改 MCP 配置；换机器后重新信任项目并登录账号即可。

## 使用

在项目目录分别执行，按浏览器提示登录 ElevenLabs 并授权工作区：

```sh
codex mcp login elevenlabs
claude mcp login elevenlabs
```

Claude 也可在会话内通过 `/mcp` 登录。重新加载助手会话后，通过 `/mcp` 查看连接与实际工具。`codex mcp get elevenlabs` 只证明配置被识别；`claude mcp get elevenlabs` 会检查已批准服务的连接状态。工具名称、参数和时长限制以登录后返回的工具定义为准，不沿用旧本地 MCP 的限制。

生成结果保存在 ElevenCreative 工作区，远程 MCP 不会写入本机目录：结果里的 `content_url` 是约 2–3 小时过期的签名链接，用 `curl` 下载。**风格、什么该做、提示词模板、生成与母带的完整流程见 [AUDIO.md](AUDIO.md)**，这里只管连接。

可直接对助手说：

> 按 docs/AUDIO.md，为新地图生成一首跑图 BGM。

> 按 docs/AUDIO.md，评估新增的“水属性终极技”需不需要新音效，需要就生成。

生成音频会消耗 ElevenLabs 额度。MCP 握手、列出工具和读取配置不会生成音频。
