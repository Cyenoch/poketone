# 生产部署

生产按入口分区：两个 Web 源站各连接同机 Harbor，房间不跨区共享。

| 入口                       | CDN        |
| -------------------------- | ---------- |
| `poketone.bingzi.dev`      | Cloudflare |
| `poketone.xiaoshuiguai.cn` | EdgeOne    |

Coolify 保留两个 Docker Image 应用：Web `ghcr.io/cyenoch/poketone` 和 Harbor `ghcr.io/cyenoch/poketone-harbor`，两者都部署到上述两台服务器。Web 监听 8080、健康检查 `/healthz`；Harbor 监听 8787、健康检查 `/health`，固定内部容器名 `poketone-harbor`，不映射公网端口。

两个 Web 的 production runtime `HARBOR_UPSTREAM=http://poketone-harbor:8787`。浏览器连接当前 origin 的 WS/WSS `/multiplayer`，nginx 用本机 Docker `coolify` 网络的 DNS 解析同机 Harbor。这里 HTTP 只在同机 Docker 内网使用；不再经过 sslip.io、公网 TLS 或另一台服务器。CDN 的 WebSocket 开关必须开启。

Harbor 房间在进程内存中。同一区域每台服务器只运行一个 Harbor；跨入口房间码不互通。不提供跨域名联机。原生客户端默认连接 `poketone.bingzi.dev`（`scripts/native-build.mjs`）。

Web 镜像通过 nginx entrypoint envsubst 加载 HARBOR_UPSTREAM；默认 `http://harbor:8787` 仅供本地 Compose。保留 300 秒读写超时、Upgrade、动态 Docker DNS 以及 HTTPS 上游的证书校验。环境变量变更需重新部署容器。固定 Harbor 名称意味着更新会替换旧容器；发布会中断当前房间，玩家需重新组队。

## 流水线

`.github/workflows/ci.yml` 在 PR、main push 与手动触发时执行。Bun 版本取 `packageManager`，安装使用 `--frozen-lockfile`。现有 typecheck、lint、format、simulation、UI、golden、Bun Web build、网络及部署测试门禁均保留，Actions 固定完整 SHA。

UI 字体 base 集（`public/fonts/gpu/base/<key>/`，不入库；`docs/fonts-paging-design.md`）由单独的 `fonts` 任务准备，key 取自 `public/fonts/gpu/core/manifest.json` 的 `base`：先查 Actions 缓存；未命中时下载同 key 的 GitHub Release 资产 `fonts-base-<key>/base.tar`（在本地用 `bun run fonts:base` 生成后上传）；两者都没有才在 CI 里从头生成（msdf-atlas-gen 由 `scripts/fonts/install-msdf-atlas-gen.sh` 从校验过 SHA-256 的源码构建；2 vCPU 的 runner 约 40 分钟，所以该任务超时 90 分钟）。verify 只从缓存恢复，缺失即失败。改了 base 集的配方（新 key）时，先在本地 `bun run fonts:base`，再 `tar -cf base.tar -C public/fonts/gpu/base <key>` 并 `gh release create fonts-base-<key> base.tar`，可省去 CI 的冷启动生成。base 集随 `dist/` 进入镜像，镜像因此增大约 179 MB（三个字重共 849 页，客户端只按需取用）。

UI 字体（`/fonts/gpu/`）每次部署只带当前一版：core 集提交前修剪到 1 版，base 集只有当前 key。构建脚本保留最近 3 次发布只保护本地和并发构建，不覆盖已部署的客户端：部署改动了字体（新的游戏文字或 base 配方）后，部署前已打开的会话若按需请求旧版尚未取到的页（content 页或 base 页）会 404，并明确报字体错误，刷新后恢复（朋友测试阶段接受，不在镜像里保留旧版）。会话内的保证不变：清单只指向配对的哈希文件，每个 json 和页面按摘要校验，不一致即明确失败，不会画错字或方块。

verify 上传 `dist/` 和 `bun build services/harbor/server.ts --target=bun` 生成的服务端 bundle。publish 发布两个 amd64/arm64 镜像，使用相同完整 commit SHA 标签：`ghcr.io/cyenoch/poketone` 与 `ghcr.io/cyenoch/poketone-harbor`。Harbor 镜像只有固定版本 Bun 与 bundle，以非 root 用户运行，不含前端资源或 node_modules。

publish 与 production deploy 只在上游仓库 `main` 上运行；fork 只执行校验。production deploy 需要：

| 类型                    | 名称                  | 值                                                             |
| ----------------------- | --------------------- | -------------------------------------------------------------- |
| GitHub variable         | `COOLIFY_URL`         | Coolify 实例的 HTTPS 地址                                      |
| GitHub variable         | `COOLIFY_WEB_UUID`    | Web 应用 UUID                                                  |
| GitHub variable         | `COOLIFY_HARBOR_UUID` | Harbor 应用 UUID                                               |
| GitHub variable         | `HARBOR_UPSTREAM`     | `http://poketone-harbor:8787`，仅在 Web 应用未配置此变量时补入 |
| GitHub secret           | `COOLIFY_TOKEN`       | read/write/deploy token                                        |
| Coolify Web runtime env | `HARBOR_UPSTREAM`     | 同上，必须在两个 Web 源站生效                                  |

脚本先读取 Web 的环境变量作预检。已配置的生产 HARBOR_UPSTREAM 由运维管理，不覆盖；缺失或空值才用 GitHub variable 补齐（只有 preview 值不算生产已配置）。然后 PATCH Harbor 镜像名和标签、POST `/deploy`，等待 finished 且 `running:healthy`；成功后补齐 Web upstream、PATCH Web 镜像名和标签并部署。Web 返回的所有部署 UUID 都必须 finished，应用状态必须 healthy。Harbor 失败时不修改/部署 Web；Web 失败不伪造整体成功，也不自动回滚 Harbor。双应用不是原子发布。

部署脚本不创建应用、不变更域名/CDN/服务器。`packages: write` 只授予 publish；token 只交给 production deploy，不输出 API 响应或环境变量值，拒绝不安全的 Coolify URL 与相同的两个应用 UUID。生产流水线串行执行。

## 部署与回滚

CI 的模拟检查入口为 `scripts/ci-scope.mjs`，由 `.github/workflows/ci.yml` 的 `Select simulation checks` 调用。PR 比较 base/head，push 比较 before/head；手动运行、强制推送及没有可用基线的首次 push 执行全部模拟检查。

- `src/run/sim/`、`src/run/balance/`、`src/run/lab.ts`、`src/run/createRun.ts`、golden 脚本、依赖清单/锁、TypeScript 配置或依赖补丁变更：执行 sim 和 golden。`createRun.ts` 管理固定步长与模拟推进，属于确定性风险入口。
- sim 测试文件、`assets/` 或 `src/run/view/` 变更：执行 sim（该命令也包含模型和视图契约），不单独触发 golden。
- 仅网络、部署或 UI 变更：保留类型、lint、格式、UI、构建、部署及网络检查，不等待无关的 sim/golden。流程或范围选择脚本本身变更也不自动扩大到全量模拟。

1. Harbor 和 Web 都部署到主服务器及附加服务器，两者处于各自服务器的 `coolify` Docker 网络。
2. Harbor 配置固定内部容器名 `poketone-harbor`；两个 Web 统一设置 production runtime `HARBOR_UPSTREAM=http://poketone-harbor:8787`。GitHub production variable 使用相同值。
3. CI 先更新 Harbor 的两台服务器并等待 healthy，再更新 Web 的两台服务器；保留现有两个应用 UUID。无需创建新应用或修改 Web 域名。
4. 分别执行 `bun deploy/smoke.mjs https://poketone.bingzi.dev` 和 `bun deploy/smoke.mjs https://poketone.xiaoshuiguai.cn`，每个入口都必须能建房、加入和中转。默认不再执行跨入口同房测试。

回滚镜像时先 Harbor、后 Web，保持同机 upstream 和双服务器拓扑。Harbor 重启会丢失该区域的内存房间；这里没有数据库、跨进程房间复制或无损滚动发布。

## 本地容器验证

需要 Bun、Docker / Compose，以及已准备好的字体 base 集。生产不使用这些 Compose 文件。

```sh
bun run check
bun build services/harbor/server.ts --target=bun --outfile=deploy/.harbor/server.js
export BUN_VERSION="$(bun -p 'require("./package.json").packageManager.split("@")[1]')"
export POKETONE_IMAGE=poketone POKETONE_TAG=local
docker compose -p poketone-local -f deploy/compose.yml -f deploy/compose.local.yml build
docker compose -p poketone-local -f deploy/compose.yml -f deploy/compose.local.yml up -d --wait
bun deploy/smoke.mjs http://127.0.0.1:8080
docker compose -p poketone-local -f deploy/compose.yml -f deploy/compose.local.yml down
```

`deploy/smoke.mjs [webA] [webB]` 检查两入口首页和 healthz 返回 200，让 A 建房、B 加入同一房间，并验证中转消息。省略 webB 时两客户端使用同一入口。双源站测试可临时把 Harbor 8787 发布到宿主机，再在另一个 Docker network 启动第二个 web，设置 `HARBOR_UPSTREAM=http://host.docker.internal:<发布端口>`；Linux 按需添加 `--add-host=host.docker.internal:host-gateway`。测试后删除临时容器、网络与端口。

现有 `scripts/qa/multiplayer.mjs` 固定启动开发环境且依赖开发钩子，不直接测试生产容器。网页缓存策略保持不变：index 不缓存，内容哈希资源 immutable，非哈希资源七天并重新验证。
