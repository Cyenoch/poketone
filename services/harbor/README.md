# Harbor

poketone 的可选在线服务，使用 Bun。提供房间、WebRTC 信令、WebSocket 中转及终局交付。游戏模拟与主进度存档仍在客户端。

启动：

```sh
bun install --frozen-lockfile
bun run harbor
```

默认监听 `0.0.0.0:8787`。`GET /health` 返回服务状态，`/multiplayer` 升级为 WebSocket。日常开发只需在根目录运行 `bun run dev`，它同时启动固定 5173 的 Web 和固定 8787 的 Harbor，Web 的 `/multiplayer` 代理到该 Harbor。端口占用立即报错，不换端口；Ctrl+C 同时关闭两者。`bun run harbor` 保留给单独调试服务端；不要与 `bun run dev` 重复启动。`bun run preview` 固定 4173，联机时需另行运行 Harbor。

环境变量：

| 变量          | 默认      | 用途                                                 |
| ------------- | --------- | ---------------------------------------------------- |
| `HOST`        | `0.0.0.0` | 监听地址                                             |
| `PORT`        | `8787`    | 监听端口                                             |
| `ICE_SERVERS` | `[]`      | 标准 `RTCIceServer[]` JSON，供客户端使用 STUN / TURN |

例如使用自己部署的 STUN / TURN：

```sh
ICE_SERVERS='[{"urls":"stun:relay.example.com:3478"},{"urls":"turn:relay.example.com:3478","username":"player","credential":"replace-me"}]' bun run harbor
```

Harbor **不是 TURN 服务器**。当前中转直接复用 Bun WebSocket，无需部署 TURN 就能组队。配置 STUN 可以帮助跨 NAT 的 WebRTC 直连；配置标准 TURN 可以让 WebRTC 自身使用中继。未配置 ICE 服务时，仍会尝试局域网等可直连路径，不能直连则使用 Harbor。

生产使用 [独立 Docker Image 应用](../../deploy/README.md)：新加坡与小水怪各运行一个 Harbor，固定内部容器名 `poketone-harbor`；各自 Web 使用 `HARBOR_UPSTREAM=http://poketone-harbor:8787` 通过同机 Docker 网络代理。两个入口房间独立，不支持跨入口房间码。Compose 只供本地测试。Web 自动使用当前 origin 的 WS/WSS，不需要构建时域名；开发由 Bun Web 服务代理本机 8787。Native 使用 `--harbor wss://<游戏域名>/multiplayer`。`/health` 用于服务健康检查，客户端启动时不调用它。SIGTERM / SIGINT 发送关闭帧并在最多 10 秒内退出；Coolify / Compose 停止宽限 15 秒。

房间仅存在内存中，每房间支持 2–4 人，满员拒绝第 5 人。重启会清空房间与中转会话；已经建立的 WebRTC 可暂时维持帧传输；恢复和可靠终局交付仍依赖 Harbor 在线。无需数据库、账号登录或反作弊系统。

房主与每位客机独立协商 WebRTC 或 Harbor 中转；信令和中转包都定向路由，发送者身份由连接确定，客机不可向其他客机发送。实际成员全部握手就绪后房主可出发。对局期间成员名单固定，任一席位掉线时全队等待其重返并重新载入快照。

主动放弃由房主提交终局，Harbor 仅在内存保留该房间的一份终局，补发给断线恢复的原席位，全部确认或首次存入终局十分钟后销房。已确认席位返回大厅可以单独断开，普通离房不能抢先删除队友的待交付结果；这不是跨进程或服务重启后的持久存档。客户端与服务端必须使用匹配的协议和构建，升级时同时更新。

协议、对局规则与验证记录见 [联机实现](../../docs/MULTIPLAYER.md)。
