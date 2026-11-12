# 联机与 Harbor 状态机

基线与阅读规则见 [总清单](../STATE-MACHINES.md)。本页始于独立源码盘点；2026-11-08 按鲁棒性修复后的终局、凭据、快照与播放路径更新。表内保留未验证的边界。

## 判定与范围

“机器”按独立持久状态、事件驱动转换和不同清理/失效边界划分；不是按一个 boolean 算一台，也不是把一个跨层恢复流程算成单台。原始盘点为 **35 个协议/状态机**；本批终局屏障、留存和回收在 N23/N04 展开，不把历史计数当作最新独立 FSM 数量。每席位 link、guest、buffer 是同一机器的实例，不重复计数。Web/native 的协商和 peer 生命周期是同一逻辑协议的两份实现，逐项列出差异。

完整读取：`src/network/{codec,delta,interpolation,owner-protocol,owner,protocol,run,session,wire}.ts`、[services/harbor/server.ts](../../services/harbor/server.ts)、`src/platform/{web,native}/direct-peer.ts`、[src/ui/gpu/multiplayer-session.ts](../../src/ui/gpu/multiplayer-session.ts)。补读完整公共 [src/platform/direct-peer.ts](../../src/platform/direct-peer.ts) 接口，以及正式调用链上的网络相关函数：[src/app/session.ts](../../src/app/session.ts) 的房间挂载/start/back/dispose、[src/run/session.ts](../../src/run/session.ts) 的 leave/onEnd/状态接线、[src/run/createRun.ts](../../src/run/createRun.ts) 的 build/start/changeZone/advance/forfeit/fail/report/dispose、快照边界、共享模拟/owner 模拟入口、combat 报告/提交和凭据存储。未将这些调用方的非网络 UI 状态纳入机器计数。

契约见 [multiplayer规范](../../openspec/specs/multiplayer/spec.md)。传输协议为 8，完整世界快照为 4（新增平滑增援压力）；版本分别由 `protocol.ts` 和 `snapshot.ts` 管理，不和主进度/导出存档版本混用。以下描述当前实现，不把历史审计失败继续列作未修代码。

## 显式状态与隐式协议的区别

| 代码表示                                                                                                                                                    | 性质                                                                            | 不能替代的隐式状态                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ConnectionMode = connecting/direct/relay`，[src/network/session.ts](../../src/network/session.ts)                                                          | 显式字符串联合，并非 TS `enum`；每个 Link 持有真实选择，`state.mode` 是聚合投影 | socket 是否存在/在线、peer.open、reachable、playing/ended/leaving/closed 均不在此联合内             |
| `ClientMessage.t` / `ServerMessage.t`，[src/network/protocol.ts](../../src/network/protocol.ts)；`Packet.t`，[src/network/run.ts](../../src/network/run.ts) | 显式事件/消息 discriminant，不是会话阶段枚举                                    | 消息在什么阶段有效由房间引用、revision、sequence、life、pending refs 和集合判断                     |
| `Room.started`、`Room.ready`，[src/network/protocol.ts](../../src/network/protocol.ts)                                                                      | boolean + 成员集合投影                                                          | 收集成员、双向 transport-ready、固定席位、断线保留、expiry、恢复都未编码成统一阶段                  |
| `World.outcome = playing/victory/defeat`、`Zone.phase = active/cleared/transitioning`，[src/run/sim/state/world.ts](../../src/run/sim/state/world.ts)       | 模拟的显式领域状态                                                              | 结算广播是否送出、各客机是否收到、session.finish 是否调用、是否尚可恢复、房间是否已销毁是另一层协议 |
| `RTCDataChannel.readyState` / `RTCPeerConnection.connectionState`；native 对应回调                                                                          | 平台显式状态                                                                    | 回调是否已上报一次、回调 owner 是否还活着、协商 Promise 是否 poisoned、候选是否缓存都由额外字段编码 |
| `RoomErrorCode`，`protocol.ts`；外层 `RunSession.status`，[src/run/session.ts](../../src/run/session.ts)                                                    | 错误分类 / UI 显式状态                                                          | 错误清理是否完成、pending promise 是否拒绝、网络 run 是否仍活着不能由这些值推出                     |

因此，“有 `ConnectionMode`/消息 union”不能得出“没有隐式状态机”。也不能把 revision/life/sequence 称作同一个版本号。

## 机器清单

表中“风险”既包含由源码直接支持的缺口，也包含尚无对应交错测试的审计点；后者不表述为已复现故障。路径相对仓库；用字段和函数名定位，避免修复后的旧行号误导。

### Harbor

<a id="n01"></a>

#### N01 席位绑定、身份和替换

- **所有者/编码**：[services/harbor/server.ts](../../services/harbor/server.ts)；`Connection.room? / player=-1`、`room.sockets[]`、`tokens[]`、`state.players[]`、`connections`
- **逻辑状态**：未入房 → 已绑定在线席位 → 对局中缺席保留 → 原席位恢复；另有连接被替换、房间解绑
- **事件、守卫与转换**：enter 校验版本/build/伙伴、人数和未开局；resume 按 token 恢复原下标，先解绑旧 socket 再替换。客机重返会撤销该席位旧终局确认，必须向新连接重送终局并重新确认；发送来源仍取 socket 绑定身份，不能由 payload 更换。
- **终态/异常/取消**：destroy/shutdown 清 room 引用；无 token 轮换；替换旧连接的 close 不得删除新连接。协议错误发 error，服务器一般不主动销毁房间，客户端收到后 fail/close
- **关键不变量**：`players[i] / tokens[i] / sockets[i] / connection.player` 对齐；对局 roster 固定，缺席不 splice；payload 不能更换发送者身份
- **测试与缺口**：[scripts/network.test.mjs](../../scripts/network.test.mjs)。测试覆盖重返与伪造席位，未见“原 socket 仍在线时用同 token 替换”的专门竞争测试；未绑定连接只受 WS idle 策略约束。Harbor enter 只校验 starter，对其余 PlayerSetup 字段并非完整 schema 校验

<a id="n02"></a>

#### N02 房间组队、传输就绪与开局

- **所有者/编码**：[services/harbor/server.ts](../../services/harbor/server.ts)；`state.started`、`readyLinks:Set<from:to>`、`state.ready`、`config?`；客户端投影 [src/network/session.ts](../../src/network/session.ts)
- **逻辑状态**：空房建成/招募 → 成员已入但链路未双向确认 → 实际成员全就绪 → 已出发
- **事件、守卫与转换**：publish：host socket 存在即 ready；客机需 socket 存在且 0→id 和 id→0 两条 readyLinks。仅 host、未 started、>=2 席、ready.length===sockets.length 可 start；写 started/config，先 publish room 后广播 start。开始后忽略 transport-ready；拒绝新 enter
- **终态/异常/取消**：lobby 中客机离开只移除其席位（后续席位顺移并重算可出发），房主离开销毁整房；start 无独立超时/撤销；客户端 state.starting 锁重复请求，收到 start 解锁并进入 playing
- **关键不变量**：“ready”是传输握手，不是玩家手动准备，也不是 GPU 地图资源就绪；不等满4人；实际人数变化会重新计算可出发
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)；[ui-multiplayer.test.mjs](../../scripts/ui-multiplayer.test.mjs)。UI 测试只保护投影，不证明真实握手；readyLinks 是只增集合，依赖房间重建/开局后不用它，不承担运行中健康检查。已知缺口：席位顺移时，发往旧席位号且尚在途中的信令（如 mode:relay）会被 Harbor 投给顺移进该号的成员，使其在大厅退回中继；开局后房主会重新提供直连

<a id="n03"></a>

#### N03 房间在线名单与离队席位

- **所有者/编码**：[services/harbor/server.ts](../../services/harbor/server.ts)；`room.state.online`、`departed:Set<seat>`（协议 v10）
- **逻辑状态**：开局后每席位 在线 ↔ 离线（socket 断开/重返）→ 主动离开后 departed（终态）
- **事件、守卫与转换**：socket 绑定/断开只更新 online 并广播 room；开局后 leave-room 将席位加入 departed，不能再用凭据重返。已有 terminal 时向重返席位补发终局。没有全房间代次或全员在线屏障。
- **终态/异常/取消**：房间 destroy 终止；终局释放只等待未离队且未确认的席位
- **关键不变量**：online 只描述 Harbor 通路；对端是否可达由会话结合直连判断（N08）；departed 不可逆
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs) 覆盖大厅移除、断线只影响本席位、离线时离开、四人刷新。房间重启后无持久化恢复

<a id="n04"></a>

#### N04 房主缺席与终局保留租期

- **所有者/编码**：[services/harbor/server.ts](../../services/harbor/server.ts)；`expiry?`、host socket 槽位、room 是否仍在 Map
- **逻辑状态**：运行中 host在线 → 缺席10分钟计时 → 恢复撤销 / 超时销毁；终局首次存入 → 独立10分钟保留 → 全员确认或期限到达销毁
- **事件、守卫与转换**：开始后 host close 设置10分钟 timer，未结束时 host resume 撤销；首次 terminal 复用 expiry 改为终局保留期限，不因 host恢复或保持在线延期。已确认席位的 leave-room 只释放该连接；destroy/shutdown 清 timer
- **终态/异常/取消**：超时 destroy 通知存活成员 left/close；无主机迁移或世界持久化
- **关键不变量**：客机断线不得回收原席位；host 丢失不能使房间永久泄漏；clearTimeout 后字段仍可有旧 handle，不可把 handle 存在等同当前计时
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)覆盖短恢复；新增测试触发终局到期回调，验证已确认连接释放、缺席者到期不能重返；未等待真实十分钟，也未覆盖临界 resume 与 shutdown 竞争

<a id="n05"></a>

#### N05 Harbor 服务关闭排空

- **所有者/编码**：[services/harbor/server.ts](../../services/harbor/server.ts)；`connections`、rooms、`server.stop()` promise、10秒 deadline、进程 once 信号
- **逻辑状态**：服务中 → 停止接收并向所有 socket 发关闭帧 → 等待排空 → 完成 / 强制停止
- **事件、守卫与转换**：shutdown 先 stop；所有连接含未入房 socket 清 room 后 close1001；clear 所有 expiry/rooms；10秒到 stop(true)；finally clear deadline。SIGINT/SIGTERM 各自 once 调 shutdown
- **终态/异常/取消**：排空 promise 完成；强制截止；没有局部 shuttingDown flag/共享 shutdown Promise
- **关键不变量**：shutdown socket close 不得触发房间恢复和新的 expiry；所有连接而非仅有房成员要被关闭
- **测试与缺口**：[scripts/native-network-smoke.mjs](../../scripts/native-network-smoke.mjs)读取到 shutdown 与 abort 场景，未运行。SIGINT/SIGTERM 各自 once 不等于合并两种信号，重复 shutdown 并发的实际行为依赖 Bun，未见专门测试

### Session 与平台 peer

<a id="n06"></a>

#### N06 WS 建连、入房/恢复和重试

- **所有者/编码**：[src/network/session.ts](../../src/network/session.ts)；`socket` 身份、`connectTimer`、`retry`、`attempts`、`playing/rejoin/token/room/closed/ended/self`
- **逻辑状态**：初始建连 → 待入房响应 → 在线；运行期断开 → 重试倒计时 → resume；可全 direct 暂时无信令但仍有传输
- **事件、守卫与转换**：open 建 socket 并设10秒响应 timer；onopen 选 playing+token 的 resume、rejoin 的 resume 或 enter。room 清 timer/reset attempts。onclose：首次非 rejoin 未开局 fail；其余按0.5/1/2/4/5秒封顶重试；非 allDirect 才立即 disconnected。onopen/message/close 以 socket===this.socket 丢旧回调
- **终态/异常/取消**：最终 close 清 timer/retry 并关 socket；ended 本身不取消 WS 重连，已生成的终局或确认在 room 恢复时重送。恢复错误仍显式 fail；重返服务不可达按现有重试保留会话。
- **关键不变量**：只有当前 socket 可提交消息；重试 resume 保留原席位；allDirect 只是当前断线时短路冻结，不等于 Harbor 房间丢失后可永远续跑
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)。缺10秒超时、旧 socket 回调、纯direct信令丢失/恢复的独立测试；WS onerror 没有和其他回调相同的身份 guard（尚未证明可达破坏）

<a id="n07"></a>

#### N07 双路健康检测

- **所有者/编码**：[src/network/session.ts](../../src/network/session.ts)；全局 `lastPong`、每link.lastPong、3秒 heartbeat、peer.open、ended/self
- **逻辑状态**：各独立实例：健康 → 等 pong → 15秒未确认/发送失败 → 故障恢复；socket 与每个 direct link 各自计时
- **事件、守卫与转换**：WS OPEN 时 ping，pong 更新 WS 时间，超时 close WS；direct+open 时 P，收到 Q 更新时间，收到 P 回 Q；direct 超时或 P send 抛错 recoverTransport。peer opened 初始化时间
- **终态/异常/取消**：只有 closed 结束心跳工作并清 interval；终局已收到但 Harbor 尚未释放房间时仍维护 WS，以便确认在断线后重送。ended 会阻止重新进入普通游戏恢复，而不是停止终局交付。
- **关键不变量**：socket pong 不证明 direct 通道健康，反之亦然；不是单一“连接正常”flag。消息处理/运行推进无需等每次 pong
- **测试与缺口**：network.test 覆盖主动断链、终局断线补交及确认；direct-peer-interop 有 P/Q 互通脚本。未见纯半开与真实后台 timer 节流的专项设备验证。

<a id="n08"></a>

#### N08 每席位 direct/relay 选择与可达性

- **所有者/编码**：[src/network/session.ts](../../src/network/session.ts)；`link.mode / peer / reachable / retry / retries`
- **逻辑状态**：connecting → direct 或 relay；游戏中 direct 失败 → 仅该 link 回 relay → 房主按 5 s 起、上限 60 s 的退避重新提供直连
- **事件、守卫与转换**：开局前沿用 6 秒超时选 relay。游戏中 `dropDirect` 只重置该 link；可达性 = direct 通道打开或（WS 在线且对端在 room.online）。可达性变化调用 `onPath(peer, reachable)`；直连断开但中继仍可达时以 `onPath(peer, true)` 通知在途数据可能丢失。Harbor 广播新 departed 时房主调用 `onDeparted(peer)`。
- **终态/异常/取消**：resetPeer 清 timer/pieces、先清 peer 引用再 close；ended/closed 停止重试
- **关键不变量**：星形 topology；一条 link 故障不影响其他 link；direct-peer 只把 failed/closed 视为断开（disconnected 可自愈）
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs) 用 fake direct provider 验证单 link 回退；未覆盖真实 ICE 自愈与退避边界

<a id="n09"></a>

#### N09 SDP/ICE 串行协商

- **所有者/编码**：[src/platform/web/direct-peer.ts](../../src/platform/web/direct-peer.ts)；[src/platform/native/direct-peer.ts](../../src/platform/native/direct-peer.ts)；`negotiation:Promise`、`candidates[]`、browser remoteDescription / native remoteReady、closed
- **逻辑状态**：无远端描述、缓存候选 → 设置描述 → 顺序drain候选 → offer产生answer；initiator先排初始offer；Promise失败后链保持rejected
- **事件、守卫与转换**：accept追加到同一promise，不能与初始offer交叉；candidate先到先存；描述成功后drain；Web多处 await后检查closed；native同步调用，remoteReady在setRemoteDescription后置true。native空candidate不调底库
- **终态/异常/取消**：accept失败向session传播并弃peer/relay；初始offer失败走error callback；close清候选/隔离events，已排队工作closed时no-op；失败promise不恢复
- **关键不变量**：不在remoteDescription前add候选；offer/answer及候选与初始协商串行；失败peer不可被当作可复用成功对象
- **测试与缺口**：[scripts/direct-peer-interop.mjs](../../scripts/direct-peer-interop.mjs) candidate-first、双方offerer、立即close/late accept；本轮只读。native TURN URI转换是纯函数不另算机器；未见协商链中途reject后连续accept的专项断言

<a id="n10"></a>

#### N10 DataChannel 与回调 owner 生命期

- **所有者/编码**：[src/platform/web/direct-peer.ts](../../src/platform/web/direct-peer.ts)；[src/platform/native/direct-peer.ts](../../src/platform/native/direct-peer.ts)；`channel? / closed / opened / disconnected / events?` + 平台状态
- **逻辑状态**：无channel → 已绑定未open → open通知已发 → disconnected通知已发 → closed；opened/disconnected都是单次通知锁，与底层状态非互斥枚举
- **事件、守卫与转换**：bind拒绝closed后到达channel；notifyOpen/disconnected各一次；readyState/isOpen getter读实际可发送性；非文本/底层错误走error。send要求open；native sendMessage false 是底层已排队，不重发
- **终态/异常/取消**：close幂等；先closed/events=undefined，再关闭资源；Web移除handlers，native用events空引用隔离无法移除的callbacks
- **关键不变量**：显式关闭后无用户callbacks；一次disconnected不等于自动closed，session负责丢peer；外部cleanupNativeDirectPeers仅进程shutdown后调用
- **测试与缺口**：[direct-peer-interop.mjs](../../scripts/direct-peer-interop.mjs)覆盖双方关闭、重复close、close后send失败和late callbacks；native smoke覆盖abort。opened/disconnected二锁允许“已断开后仍底层open”的组合，依赖session马上重置；尚无多datachannel意外输入专测

<a id="n11"></a>

#### N11 数据 receiver 挂载与提前到包

- **所有者/编码**：[src/network/session.ts](../../src/network/session.ts)；`receiver? / pending[]`，返回的unsubscribe捕获receiver身份
- **逻辑状态**：未绑定且积压 → 绑定并FIFO flush → 接收中 → 解绑后再次积压
- **事件、守卫与转换**：deliver验证from在links，receiver存在直接调用，否则pending.push；receive替换当前receiver，splice待包后同步投递；unsubscribe仅当当前还是该receiver才清；disconnected丢旧pending
- **终态/异常/取消**：最终 close 清队列与 receiver。退出页可以先释放，但等待终局的离房会话保留 receiver；Run 收到终局后确认并卸载自己。receive 不是通用多消费者接口。
- **关键不变量**：最新订阅者独占消费；旧unsubscribe不能卸载新订阅；旧恢复前包不带入新run
- **测试与缺口**：network.test 覆盖首图提前到达、终局投递与立即 dispose。pending 仍没有通用容量限制；回调异常由既有 failure 边界处理，不视为可忽略消息。

<a id="n12"></a>

#### N12 direct 分片重组

- **所有者/编码**：[src/network/session.ts](../../src/network/session.ts)；每link `pieces:string`；帧头0续片/1末片；12000字符分块
- **逻辑状态**：空闲 → 收集续片 → 末片完整解码并投递 → 空闲
- **事件、守卫与转换**：P/Q优先处理不加入pieces；只接受首字符0/1；拼接超过16Mi字符失败；1时unpack，成功后清pieces再deliver；不同席位各自串
- **终态/异常/取消**：malformed/unpack失败走session.fail；resetPeer/恢复/close清pieces；无分片计时器、包ID、总片数或跨包重传
- **关键不变量**：依赖有序可靠DataChannel且每包连续发送；每link最多一个未完成包；重连必须清片，不能拼接跨代数据
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)地图跨片；[direct-peer-interop.mjs](../../scripts/direct-peer-interop.mjs)只证明大Unicode消息有序，不等于Session重组负测。缺半包中断/恶意续片/片头错误专项测试；字符阈值和wire解压字节阈值单位不同

<a id="n13"></a>

#### N13 传输背压与发送提交

- **所有者/编码**：[src/network/session.ts](../../src/network/session.ts)；`link.mode`、peer/socket open、bufferedAmount、replaceable；[services/harbor/server.ts](../../services/harbor/server.ts)
- **逻辑状态**：可发 → 可替换帧被跳过；可靠包积压 → 恢复；传输不可用 → false并恢复；成功交给底层
- **事件、守卫与转换**：先检查连接，connecting不能发；replaceable且>256KiB立即false；其余>8MiB触发恢复；direct发完所有片才true，异常recover/false；relay经signal发送。Harbor send返回0关慢连接，16MiB payload/backpressure限制
- **终态/异常/取消**：closed直接false；pack/relay signal异常有路径直接抛出；send多目标即使部分成功仍会返回false，但不回滚已送者
- **关键不变量**：true仅代表本地接受发送，不是远端已应用/ACK；跳过普通帧不得提交后继delta基准；可靠控制靠恢复全快照补偿，不存在通用消息重试队列
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)覆盖256KiB跳帧及事件/基准补发。注意 replaceable分支在8MiB判断之前，单靠普通帧再多积压也只是false；>8MiB恢复需可靠/force发送触发。未见partial direct send、Harbor发送返回0、同WS多个relay席位共享buffer竞争专测

<a id="n14"></a>

#### N14 客户端会话与终止标记

- **所有者/编码**：[src/network/session.ts](../../src/network/session.ts)；`room / starting / playing / quitting / ended / terminal / leaving / closed / error / canStart`。
- **逻辑状态**：房间连接中/就绪 → start请求中 → playing → ended但连接活着 → closed；任意活跃态可failure
- **事件、守卫与转换**：start 幂等并先处理可选凭据再 onStart；quit 记录退出意图，在线时发 Harbor 控制消息。finish 在房主保存打包终局，在客机确认已还原终局；两者标记 ended 并清凭据。room 恢复时优先重送 terminal、terminal-ack 或 quit；left 在已结束时只关闭，否则显式失败。
- **终态/异常/取消**：最终 close 注销 abort、清 retry/heartbeat/connectTimer、释放 peer/socket/队列；等待交付的 leaving 先解绑页面回调并保留传输。saveTicket 单独报告存储失败，不阻断开始和核心关闭；不对任意业务回调加 catch-all。
- **关键不变量**：finish≠close≠房间销毁；playing不会在finish清零；ended不是“全员已收到结果”；终局到达不能被正常left改写为错误页
- **测试与缺口**：network.test 保护立即退出、离线退出及终局补发；network-storage.test 保护凭据读写/清除失败。未把 ended 当作所有席位都已收到的证明。

<a id="n15"></a>

#### N15 离线主动离开交付

- **所有者/编码**：[src/network/session.ts](../../src/network/session.ts) 的 `close / message(room)`，以及 [src/network/run.ts](../../src/network/run.ts) 的 `quitting / disposed`；Session 的 `leaving / quitting / ended / terminal` 和 socket/retry。
- **逻辑状态**：主动离开 → 页面已释放、退出意图待送或终局待确认 → WS 恢复重送 → 本席位确认且请求离开后 left/完全关闭；Harbor 独立等待其他原席位确认或到期。普通重连窗口直接返回仍走延迟 leave-room。
- **事件、守卫与转换**：close(leave=true) 在已开局、无会话错误且离线/正在放弃/已结束时保留传输；清页面回调但保留必要 receiver。room 响应先恢复身份并重送退出/终局/确认，再处理 leaving。Run.quit 不再提前 finish；quit 后 dispose 仍接收终局，收到后卸载。
- **终态/异常/取消**：abort/close(false) 是进程级强制释放，不保证之后继续交付；服务永不恢复时没有新的通用超时框架。Harbor 仍使用已有房主缺席租期，终局不会因普通 leave-room 提前销房；已确认席位可单独释放。
- **关键不变量**：页面生命周期、退出意图、本机终局和房间确认是四个边界；保留必要交付不能让已销毁 UI 继续接回调，也不能由 ended 取消未交付 quit。
- **测试与缺口**：network.test 直接覆盖三人 quit→dispose、socket 关闭但 UI 尚未重连时 quit→dispose、离线只 dispose，以及漏收终局席位恢复；不等房主下一次显示帧。WAN/进程崩溃持久化不在本契约内。

<a id="n16"></a>

#### N16 重返凭据持久化

- **所有者/编码**：[src/network/session.ts](../../src/network/session.ts)；[src/ui/gpu/multiplayer-session.ts](../../src/ui/gpu/multiplayer-session.ts)；ticket `{url,code,token,build}`、restored/rejoin、平台storage
- **逻辑状态**：无凭据 / 无效凭据 → 同build且同url可显示重返入口 → 恢复尝试 → 客机start保存凭据 → finish/主动close清除；abort/close(false)保留
- **事件、守卫与转换**：parse 校验 build 与字符串，UI 匹配 url；读取失败在 mountMultiplayer 局部报告并不提供重返入口，仍允许新建/加入。Session.saveTicket 捕获保存/清除异常，经 onWarning 报告后继续当前连接；restored 仍控制跳过重复背包消费。
- **终态/异常/取消**：不兼容票据不提供入口；读写失败不修改主存档，不阻止新对局和必要清理。文件仍由平台负责；不将可选凭据故障当作正常成功。
- **关键不变量**：票据只恢复原席位，不恢复主机世界；首次加载菜单读取票据不是连接行为；restored和recovering不是同一状态
- **测试与缺口**：[network-storage.test.mjs](../../scripts/network-storage.test.mjs) 覆盖真实 mount/Session 与注入存储失败。native 凭据不是主进度原子事务。

<a id="n17"></a>

#### N17 房间窗口→Run的连接所有权交接

- **所有者/编码**：[src/ui/gpu/multiplayer-session.ts](../../src/ui/gpu/multiplayer-session.ts)；`session? / handedOff`、回调闭包和unmount
- **逻辑状态**：无会话 → 窗口拥有会话 → 建新连接前取消旧会话 → onStart先handedOff → Run接管 → 窗口卸载保留连接
- **事件、守卫与转换**：connect先cancel；构造失败更新screen error；onStart置handedOff再new MultiplayerRun/start；unmount注销/释放screen，清onChange，仅未交接才close。[src/app/session.ts](../../src/app/session.ts)回调closeRoom再start；back/应用dispose负责Run会话最终释放
- **终态/异常/取消**：cancel/未交接unmount关闭会话；已交接unmount不关闭。handedOff在connect中未重置；start/new Run抛错或上层拒绝导航时无显式交接回滚
- **关键不变量**：同时只有一个生命周期owner负责close；screen释放不能杀已交接run；“调用start”不自动证明上层已接管
- **测试与缺口**：未见mountMultiplayer handoff专项测试；ui-multiplayer测试是screen/view而非此模块。[src/app/session.ts](../../src/app/session.ts)有transition非idle早退，交接flag先置位的失败/拒绝导航路径需专门核对，不据此宣称已经泄漏复现

### MultiplayerRun 控制、恢复与所有权

<a id="n18"></a>

#### N18 完整地图投递与初始消费 rendezvous

- **所有者/编码**：[src/network/run.ts](../../src/network/run.ts)；`map? / mapResolve? / mapReject? / world? / revisions:WeakMap / revision / terminal`
- **逻辑状态**：等首图 → 首图先于consumer存单槽 / consumer先到挂promise → 消费并恢复world → 后续map覆盖待安装槽
- **事件、守卫与转换**：host publishMap生成完整快照并去snapshot.events；guest map只允许来自host，restoreWorld验证version/digest/plain finite，给world打revision，重置播放并seed owner；有mapResolve则resolve并清，否则map=world。initial取槽或挂promise，takeMap一次取走
- **终态/异常/取消**：failure/dispose 拒绝 initial；terminal 用完整快照还原并独立于地图 ready 屏障交付，初始消费者尚未到达时仍保存待取世界。快照3按机动类别重建 water 与无界游泳语义，不在数据中编码 Infinity。
- **关键不变量**：客机安装真实地图，不自行生成；首图不会因consumer晚挂载丢失；单槽是latest pending map语义；快照事件不与首动态帧重复
- **测试与缺口**：network/snapshot 测试保护正常首图、恢复及终局；六张地图另经真实 Harbor 的首图和再次发布核对。initial 仍是单消费者 promise，地图安装中再次收到更新依赖 revision 拒旧 ready。

<a id="n19"></a>

#### N19 逐席位地图准备

- **所有者/编码**：[src/network/run.ts](../../src/network/run.ts)；房主 `guests:Map<id, GuestState{revision, phase, baseline, elapsed}>`、`suspended`；客机 `revision / loadedRevision`
- **逻辑状态**：每席位 offline → loading（已发当前地图）→ playing；换区时 publishMap 对可达席位发图，不可达席位 revision 置 0 待重连
- **事件、守卫与转换**：sendMap 为该席位单独 revision++；ready 只接受该席位当前 revision。房主在仍有 loading 席位时 suspended（换区等待），offline 席位不参与。重连 hello 携带已安装 revision：一致则回 resumed，否则单独发图。
- **终态/异常/取消**：failure/dispose 拒绝等待；终局可绕过 suspended，终局发布会替换排队中的地图
- **关键不变量**：“收到地图”“GPU可用”“可推进”分开；不能用新 revision 确认旧图；重连只让该席位载入
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs) 覆盖重开客机单独收图、无人等待、排队地图被终局替换

<a id="n20"></a>

#### N20 席位断线与重连

- **所有者/编码**：[src/network/run.ts](../../src/network/run.ts) `hostPath / hostHello / guestPath / depart`；客机 `reconnecting / unacked`
- **逻辑状态**：房主视角 playing → offline（输入清零、横幅“断线”、settleZone）→ hello → loading/playing；→ departed（departPlayer、横幅“离开了对局”）。客机视角 正常 → reconnecting（resetInput）→ 发 hello、补发 unacked → 正常；房主静默 2 s 也置 reconnecting
- **事件、守卫与转换**：可达且 playing 时只清 baseline（下一帧全量）；frame.ack 修剪 unacked；有待处理终局时先接受终局
- **终态/异常/取消**：failure 终止；用户退出走 N15/N23
- **关键不变量**：任何席位断线都不暂停共享世界或其他席位。路径重置后：客机补发未确认指令和带命中/事件的 owner 包（frame.ownerAck 修剪，房主按 owner sequence 去重）；房主把已发送但客机未确认（owner.eventAck）的事件批次重新排队，客机按批次 clock 去重，未确认批次最多保留 10 s；客机同时视终局屏障失效，终局直接交付。离线时房主清零该席位冲刺，避免远端冲刺永久免伤
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs) 覆盖路径重置补发一次、四人断线/刷新只影响本席位。未验证 WAN/NAT/TURN 与实机

<a id="n21"></a>

#### N21 指令分流、去重和确认

- **所有者/编码**：[src/network/run.ts](../../src/network/run.ts)；`commands[] / ownerCommands[] / held:Map / sequence`、每guest.receivedSequence/ack；`protocol.ts`
- **逻辑状态**：新本地意图 → owned动作即时排队 / shared控制待发 → host校验/排队 → host.submit取走并ack → frame确认；相同held方向抑制发送
- **事件、守卫与转换**：move/view/dash/ult进入本机owner队列，move/view变化同时送host；其他操作只shared。host要求正安全序号、<=128命令、当前revision、非suspended、seq递增；peerCommand重绑player。相邻held可合并，不跨离散指令；离散积压>=256报错；host submit将receivedSequence复制ack并取队列
- **终态/异常/取消**：map 清队列/held；路径恢复时补发未确认指令（unacked，按 frame.ack 修剪）；非法命令fail
- **关键不变量**：ack表示submit取用而非网卡收到；正式createRun紧接step处理；held去重不能跨越离散动作改变时序；序号按席位独立
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)。无通用重放预测日志（旧v3文档已过时）；多个命令逐条enqueue后才更新receivedSequence，后段非法可留下部分队列但随后fail整会话；需要维持“出错后不得继续step”的caller契约

<a id="n22"></a>

#### N22 合作中的个人暂停

- **所有者/编码**：[src/run/createRun.ts](../../src/run/createRun.ts) `queuePause`、[src/run/session.ts](../../src/run/session.ts)
- **逻辑状态**：合作中菜单、属性、地图、选卡只改变本机界面；共享 world 不接收 pause 指令
- **事件、守卫与转换**：联机时 queuePause 不入队；地图打开只拦截地图/返回/暂停动作，移动与转向照常采样；失焦与 context loss 只取消输入
- **关键不变量**：world.paused 在合作中恒为 false（终局除外）；菜单不提供重新开始
- **测试与缺口**：本机双浏览器上下文核对地图+移动与菜单期间世界推进；触屏地图摇杆未在实机验证

<a id="n23"></a>

#### N23 主客机 quit / outcome / finish / close 终局交付

- **所有者/编码**：[src/network/run.ts](../../src/network/run.ts) 的 `quitting / disposed / terminal / terminalBarrier / pendingTerminal / terminalWorld`；[src/network/session.ts](../../src/network/session.ts) 的 `quitting / ended / terminal / leaving`；[Harbor](../../services/harbor/server.ts) 的 `quitting / terminal / terminalAcks`。
- **逻辑状态**：quit 意图或自然结束 → 房主提交正式 outcome 与一个完整终局 → Harbor 留存 → 各原席位还原终局并确认 → 收齐确认后销房；断线席位恢复后补收。
- **事件、守卫与转换**：quit 走 Harbor 控制消息；房主 onQuit 恢复权威位置并同步 applyCommand(forfeit)/publish，不等待下一帧。终局发布保存 map+snapshot+待播事件，停止普通 frame。正常连接先等待对局可靠通道的 terminal-barrier，保证其前方 frame 反馈到齐，再接受 Harbor 完整终局；断线恢复或首个重返结果直接还原。还原时清掉未安装的旧地图，finish 发 terminal-ack，apply 将终局放入既有世界并保持玩家对象身份；首图尚未消费时供 initial 取走。Harbor 只接房主终局，重复提交保留首份，按连接席位确认。
- **终态/异常/取消**：quit 后页面可以立即 dispose，但连接保留到终局确认；普通 leave-room 不提前销房；已有终局且该席位已确认时，释放该席位并发 left，缺席者的 token 保留到终局期限。WS 重连重发终局/确认；进程 abort 与 Harbor 重启不保证持久化交付。
- **关键不变量**：终局只由房主产生；本地 send 成功不代表交付；每个原席位确认前留存一份完整终局；不以渲染节奏、ready 屏障或可替换帧承载最终结果。连接 ACK 表示终局已在内存还原，不表示主存档已写入；结果保存失败由 RunSession 的待保存结果/重试负责。
- **测试与缺口**：network.test 覆盖三人立即返回、离线竞态、房主不推进帧、漏收席位恢复和事件不重复；ui-run-session 保护写盘失败不离开。未验证真实 WAN/强杀进程后结果持久化，不新增中心进度存档。

<a id="n24"></a>

#### N24 owner 生命代次屏障

- **所有者/编码**：[src/network/run.ts](../../src/network/run.ts)；每guest `alive? / revives? / life`、packet.life、guest本机life
- **逻辑状态**：当前生命owner有效 → alive改变或revives减少 → life++旧owner失效 → 客机收到新life重置本机生命动作 → 新life owner有效
- **事件、守卫与转换**：captureGrant在publish和owner接收前后检测；同tick死亡再复活虽alive仍true，revives减少也推进life。receiveOwner先更新序号/nextId，再capture并比较packet.life，不同就不写动作/伤害；guest sync lifeChanged时接受权威状态，仅保留输入方向
- **终态/异常/取消**：publishMap/resetPlayback将life归0并换revision；死亡并非owner全部攻击停止，旧已发射实体可在当前life继续结算；终局拒继续战斗
- **关键不变量**：新生命不能被旧life的冲刺/必杀/位置覆盖；life作用于revision内，不能替代map版本
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)。旧life包仍消费ownerSequence并推进nextId，作为防重/ID不复用设计需保持；突发多次生命变化仅在capture观察点采样，不是全模拟事件日志

<a id="n25"></a>

#### N25 owner 事实提交、序号与攻击ID

- **所有者/编码**：[src/network/run.ts](../../src/network/run.ts)；[src/network/owner-protocol.ts](../../src/network/owner-protocol.ts)；ownerSequence、nextId、effects/events/negative entities、revision/life；[src/run/sim/combat.ts](../../src/run/sim/combat.ts)
- **逻辑状态**：owner生成事实 → 包待送 → host验证并去重 → 写本机动作/攻击实体 → 按目标现状提交共享效果一次 → 转发他人视觉
- **事件、守卫与转换**：host必须有该guest与world，非suspended、revision匹配；seq正且严格递增、grantAck范围/life整数和数组基础形状通过，validateOwner再消费；nextId单调max；life、transitioning、outcome gate。entities强制owner=连接id；effects commitCombat只对现存活且targetable目标提交，不重做几何碰撞
- **终态/异常/取消**：旧seq/revision/life丢弃；非法包fail；world paused仍接收暂停前在途事实；map重置seq但nextId沿用；每player负ID范围分隔
- **关键不变量**：共享HP/死亡/掉落仅host提交；同一包不会重复提交；攻击ID跨恢复不复用；owner的payload不能冒充其他席位
- **测试与缺口**：network.test 保护缺字段 UltState、弹体与范围攻击在修改世界前拒绝，合法同序号随后仍可提交。validator 使用真实玩家的进化/必杀时间线校验索引和必需字段；这是协议结构检查，不重新裁定受信任队友的碰撞真实性。

<a id="n26"></a>

#### N26 host→owner grant 确认与重放

- **所有者/编码**：[src/network/owner.ts](../../src/network/owner.ts)；[src/network/run.ts](../../src/network/run.ts)；`ownerBefore / grants[] / grantSequence / grantAck`
- **逻辑状态**：权威改变owner共享计时字段 → capture差值形成新grant → 每frame重复附未确认grant → guest按id应用一次 → owner包回ack → host丢已确认grant
- **事件、守卫与转换**：grant比较fx、ult.charge/room、invulnerable增量；host写owner状态前先捕获自身改变，应用owner后把未ack grants重加，避免旧owner覆盖共享收益；guest只取id>grantAck，并将最后id回ack；lifeChanged时直接接纳权威，避免重复加grant
- **终态/异常/取消**：map/recovery清grants/seq/ack并以完整状态重建；非法ack超grantSequence显式fail；死亡/终局的早return可能延后ack清理
- **关键不变量**：不让旧快照恢复已消耗充能，也不丢host奖励；grant id和owner seq是不同轴；host grants不是“每次publish就清”的events
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)间接覆盖技能/生命反馈；未见专门丢帧、延迟ack、连续grant跨life、ack重复/回退的直接断言。允许较旧有效ack不复活已删除grant，依赖owner seq顺序；无grants队列独立容量界限

<a id="n27"></a>

#### N27 OwnerSimulation 固定步、冻结与显示预览

- **所有者/编码**：[src/network/owner.ts](../../src/network/owner.ts)；accumulator/tick/time/rng、player副本、projectiles/areas、preview；[src/network/run.ts](../../src/network/run.ts) frameSilence/localPaused
- **逻辑状态**：可推进固定tick → 不足tick只显示预览 → 冻结（localPaused/worldFrozen/终局/>0.5s无frame） → 更新恢复；另有dead停止新施法但旧实体存活
- **事件、守卫与转换**：advance先apply commands，再在非frozen/isFrozen/outcome条件下累计dt跑TICK；sync校准host.time并合并权威共享字段；present以fractional remainder预览下一步运动但不消耗owner.player状态；同一世界里用本机副本替换自身
- **终态/异常/取消**：recovery/map重建OwnerSimulation；暂停保留累积余量，不追后台时间；dead仍stepOwnedPlayer中的投射物/区域；终局不推进
- **关键不变量**：本机画面即时响应；owner不推进敌人/RNG共享世界/HP奖励；预览不改已模拟位置；frameSilence与传输心跳是两套不同活性标准
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)。这是复用既有动作runner，不是网络层重新发明各技能FSM；无权威更新0.5秒后的冻结仅在apply被调用时累计。全技能内部状态不在此次网络盘点范围

<a id="n28"></a>

#### N28 救援取消的跨端锁存

- **所有者/编码**：[src/network/owner.ts](../../src/network/owner.ts)；[src/network/run.ts](../../src/network/run.ts)；cancelRescue、player.rescue、lifeChanged、dashTime/ult.elapsed
- **逻辑状态**：无救援 → 权威救援中 → 本机动作取消但权威旧快照仍在途 → 持续声明取消 → host确认rescue=null或life改变后解锁
- **事件、守卫与转换**：applyCommand前后对比rescue产生cancelRescue=true；sync保留取消，不让旧快照重启救援；只有lifeChanged或权威无rescue清锁；host收到cancelRescue清rescue；如果仍有rescue则强制dashTime=0、ult.elapsed=-1
- **终态/异常/取消**：完整owner重建清锁；生命变化清锁；没有独立取消ACK，借authoritative.rescue事实确认
- **关键不变量**：旧救援不能复活，未取消新救援的旧冲刺不能恢复无敌；该锁不由owner.sent清掉
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)直接覆盖取消及在途冲刺；rescue没有网络级新实例编号，短时间结束后新救援与旧cancel交错是否会误取消需要专门时序测试

<a id="n29"></a>

#### N29 owner 视觉已展示/事实已发送双游标

- **所有者/编码**：[src/network/owner.ts](../../src/network/owner.ts)；[src/network/run.ts](../../src/network/run.ts)；events[]、effects[]、shown、ownerSendElapsed、ownerSequence
- **逻辑状态**：本机产生事件并立即展示 → 仍待可靠发送 → send成功清batch；send失败保留batch但不重复本机展示
- **事件、守卫与转换**：takeEvents只返回events.slice(shown)并推进shown；每TICK或有events/effects即发owner；仅send true调用sent清events/effects/shown并清elapsed。sequence每次尝试递增，可有空洞但不可倒退
- **终态/异常/取消**：recovery丢OwnerSimulation和未交付batch，以host快照重建；sent不清projectiles/areas/cancelRescue；非法超大payload失败
- **关键不变量**：视觉展示一次与权威事实交付一次是不同状态；不能在takeEvents时清effects，也不能失败时清待发送事件
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)覆盖不重播/不重复伤害部分；未见可靠owner发送连续false但未触发reset的专门batch测试。8Ki数组上限在接收validator，发送端积压何时超过需从背压恢复边界看

### 复制、播放、展示事务与失败

<a id="n30"></a>

#### N30 按客机发布调度与已发送delta基准

- **所有者/编码**：[src/network/run.ts](../../src/network/run.ts)；每 guest 的 elapsed/entityElapsed/baseline/events/grants，clock/force 与 run 级 terminal。
- **逻辑状态**：map 建立基准 → 各席位累计状态/事件 → 发送成功才提交基准与清事件；失败保持待发 → 终局转 N23，停普通 frame。
- **事件、守卫与转换**：host且非suspended且ready人数齐才publish；玩家每TICK，实体每0.1秒或攻击event催发；force或无baseline发full；其余重状态用entityDelta。成功发送才重置时钟余量、复制实体baseline、清events；每席位单独成功/失败，若恢复使suspended则停止后续fanout
- **终态/异常/取消**：map/recovery 重建基准/事件/序号；终局先于 suspended/ready 检查，交给单独可靠交付流程。grant 走自己的 ACK，不能因 send 成功而清除。
- **关键不变量**：跳帧不能推进baseline，否则后续delta会引用客机未收到的状态；慢客机不能让快客机复用错误基准；当前实现没有每秒full checkpoint（文档历史段有，不能照抄）
- **测试与缺口**：network/delta 测试保护差分、跳帧、事件补发和独立席位。普通状态仍有背压策略；终局已经不依赖 replaceable frame 或后续显示帧重试。

<a id="n31"></a>

#### N31 客机frame验证、delta重建与缓冲提交

- **所有者/编码**：[src/network/run.ts](../../src/network/run.ts)；baseline?、revision、newestClock、sequence/packet.ack、frames[]；[src/network/delta.ts](../../src/network/delta.ts)
- **逻辑状态**：map seed已有baseline → 收轻frame不改基准 / full替换基准 / delta在旧基准上生成新基准 → 入队待apply；无baseline收到delta为失败
- **事件、守卫与转换**：拒host角色收到frame/非record state/非array events；suspended或revision不符丢弃；clock有限>=0，ack安全整数且0<=ack<=本机发送sequence；小于newestClock丢弃；full以state.enemies存在识别；delta要求baseline存在；applyEntityDelta保持旧基准不变，缺实体时报错
- **终态/异常/取消**：resetPlayback 清基准和帧并重置 playbackTrimmed；最多32帧，裁掉的状态合并到下一个保留帧。若播放时钟还在已丢历史内，记录 playbackTrimmed，下一 apply 重定位；事件另排队，终局走 N23 的可靠屏障与完整快照。
- **关键不变量**：只沿本链路可靠有序delta更新；基准与可变展示World分离；light frame不丢之前重状态；同地图玩家对象身份由apply保持
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)、[network-delta.test.mjs](../../scripts/network-delta.test.mjs)。frame没有独立接收sequence，clock相等不丢，同clock重放也非幂等防御；有序可靠传输是前提。state/playerClocks/grants/delta结构验证有限，错误可能在后续apply暴露；不把类型cast视为验证

<a id="n32"></a>

#### N32 快照缓冲与播放时钟

- **所有者/编码**：[src/network/interpolation.ts](../../src/network/interpolation.ts) 的 frames、trimmedThrough/lostHistory；[src/network/run.ts](../../src/network/run.ts) 的 newestClock/renderClock/frameSilence/playbackTrimmed 及各 playerClock。
- **逻辑状态**：空/seed → 有连续历史并插值 → 正常微调；超过保留历史 → 显式重定位到最新缓冲目标 → 恢复插值；超过最新样本则冻结，不外推。
- **事件、守卫与转换**：帧队列裁剪标志或 player buffer.lostHistory 证明连续历史已丢时，renderClock 跳到 newestClock−0.15，并在随后按序消费越过事件。其余情况保留0.9/1/1.1微调与不超 newest 的规则；phase 重置仍离散。
- **终态/异常/取消**：map/recovery 重置为−0.15并 seed0；无新 frame>0.5s 冻结 owner；lostHistory 基于实际裁剪边界，不把普通稀疏样本/短抖动误判成需跳时钟。
- **关键不变量**：packet arrival不是显示时刻；未变化的远端pose不伪造新clock；插值不改不可变基准、动画px/pz仍携速度；同阶段计时才可连续插值
- **测试与缺口**：network.test 覆盖后台约10秒后恢复、事件顺序/只一次及短抖动仍微调；wire 测试覆盖相位插值。本次为内存调度夹具，没有验证浏览器真实后台节流。

<a id="n33"></a>

#### N33 远端事件时间线与本机确认旁路

- **所有者/编码**：[src/network/run.ts](../../src/network/run.ts)；guest.events队列、hostEvents、各待发送events、renderClock/clock；`newestFrameAt/eventTimes` 记录本机呈现年龄。
- **逻辑状态**：未发送积压 → 成功发送但未到播放时间 → 到时一次展示；本机confirmedContact命中数字收到即可旁路展示；终局flush剩余事件
- **事件、守卫与转换**：host事件分发给所有guest；owner视觉只发其他guest并入hostEvents，避免本人echo；host takeEvents在clock-0.15出队；guest普通事件等待renderClock；本机confirmedContact hit立即push并从batch移除；outcome结束时清完时间门槛
- **终态/异常/取消**：map/recovery丢旧events/hostEvents；owner已本机播放事件走N29；frames被裁32不裁events
- **关键不变量**：效果与产生它的显示位置应同一播放时间；本人命中火花即时，确认数字到达一次；host可播放owner事件但不把其再塞共享broadcast队列。临时文字年龄独立于播放clock：异步结算立即登记发生时间，待发批次保留born，发送ageMs，接收端保留墙钟年龄与批次时钟差中较大的值，再累计本机等待。背压/房主停帧不刷新期限，过期文字不显示但不删除可靠事件、不提前播放视觉事件。恢复前事件的年龄不随播放时钟重置而归零；缺少发生时间的恢复快照事件只失去临时文字资格。
- **测试与缺口**：network.test 覆盖本机确认、后台积压重定位后的顺序/一次播放及终局事件。事件没有独立通用容量框架；显示调度恢复依 N32 追至仍存在的历史，可靠传输及 owner 序号继续承担防重职责。

<a id="n34"></a>

#### N34 host展示坐标借用/恢复事务

- **所有者/编码**：[src/network/run.ts](../../src/network/run.ts)；hostPositions map、hostEntities?、hostPlayers/hostAttacks buffers；[src/run/createRun.ts](../../src/run/createRun.ts)
- **逻辑状态**：World保存权威态 → presentHost暂写远端插值位置与负ID攻击展示数组 → restoreHost还原权威引用/位置 → 再模拟/提交/快照
- **事件、守卫与转换**：presentHost先restore避免嵌套叠加，再保存数组引用、过滤权威正ID并加插值负ID、保存各玩家位置后写sample；step/receiveOwner/publishMap/publish及正式advance入口均restoreHost
- **动画数据**：已采样位置保持 px=x、pz=z，避免按房主 alpha 再插值；采样的地面速度由 presentHost 返回，经 createRun 交给角色动画，不能从这组已固定的坐标差重新推导。
- **终态/异常/取消**：restore清hostPositions和hostEntities，幂等；换map重新seedhost buffers；dispose靠外层释放World而无额外restore调用
- **关键不变量**：展示不能污染共享模拟、combat和snapshot；任何新增读取权威World的路径都必须在临时展示态之外；保留玩家对象身份
- **测试与缺口**：[network.test.mjs](../../scripts/network.test.mjs)覆盖present/restore及平滑；1218/1333间接覆盖结算/快照。正式host主动forfeit走`createRun.ts`的stepWorld再publish（restore在publish才发生），需审阅新逻辑是否会读取临时显示位置；目前forfeit本身只改outcome，不据此报现存污染

<a id="n35"></a>

#### N35 Run失败锁存、等待者与销毁

- **所有者/编码**：[src/network/run.ts](../../src/network/run.ts) 的 failure/disposed/quitting、stop、map/ready reject 与回调；外层 [createRun](../../src/run/createRun.ts) 负责单局资源和注册。
- **逻辑状态**：活跃/等待初图/等待ready → session失败记failure并拒等待 → UI错误/外层fail停正式循环；主动dispose卸订阅并拒等待 → session close
- **事件、守卫与转换**：receive 异常转 session.fail 并拒绝等待，初图/ready 先检查 failure。dispose 标记自身销毁，清 UI/恢复回调并拒绝等待；一般卸载 receiver，唯主动放弃的客机仍接一次终局确认后卸载，再由 Session.close 处理交付与传输。
- **终态/异常/取消**：disposed 不等于底层 socket 已关；终局交付可短暂继续但不再调用已释放页面。已知凭据异常在其 I/O 边界报告，最终 close 的核心清理不因此中断。
- **关键不变量**：待初图/准备不能悬空于已知失败；旧订阅不可继续收；网络失败须进入正式run fail链，不是只改UI标签；停止权在app/run/Session交界
- **测试与缺口**：network/storage 测试覆盖 quit→dispose、离线延迟及凭据失败；真实 createRun 夹具保护提交前/回调内取消和运行后释放。ready/initial 仍是单消费者 API，不声称支持并发多个等待者。

## 完整调用链与跨机器切面

1. **创建/加入**：[src/app/session.ts](../../src/app/session.ts) openRoom → `ui/gpu/multiplayer-session.ts` connect → N06 WS enter → N01 分配席位 → N02 room publish → N08 每host-guest建peer → N09串行协商/N10channel活性 → N08选mode并双向transport-ready → N02可start。`Room.ready`不等于地图ready。
2. **窗口交接与首图**：host start → Harbor写started/config并广播 → `Session.message(start):289` 设置playing、客机保存ticket → N17先handedOff/new Run → `app/session.ts` closeRoom/start → `run/session.ts` createRun → `createRun.ts` host造世界或guest等initial → N18 publishMap/restore → loading(world)记录安装revision → scene/assets/GPU warm → N19 ready → resumed。UI构造/资源ready的全部内部状态未计入网络清单。
3. **正常帧**：`createRun.advance:758` → host restore → submit → `run.step:382` → `stepSharedWorld`（客机动作不重复运行）→ drain共享事件 → publish N30 → guest N31重建/缓存 → N32播放 + N27本人owner.step → N29立即本机事件/可靠owner包 → N25 host验证/提交 → N24生命代次、N26 grant → N33反馈 → N34 host临时展示。OwnerSimulation由固定tick执行真实技能runner，不是旧文档中的纯移动预测。
4. **换区**：`createRun.ts` host有transitioning才prepareZone/enterZone；guest只能安装incoming；两者重新buildScene/start；N18换新revision、N19全员ready。world.zone.phase是显式sim枚举，网络屏障仍由多字段表达。
5. **运行中断线**：N07/平台断开或 N06 WS close → N08 更新该对端可达性 → `onPath(peer,false)` → N20 房主将该席位置 offline、输入清零，其余席位继续；客机 reconnecting。通路恢复 → 客机 hello → 房主 resumed 或该席位单独 N18 发图 → N19 ready → playing；离开则 N03 departed → depart。**revision决定该席位地图状态有效性，life决定owner生命状态有效性，sequence决定各类消息是否已处理，grantAck决定收益是否已应用。**
6. **主动离开/结算**：run/session.leave → createRun.forfeit → network.quit → 本机结果保存/导航；网络另保留 quit 交付。Harbor 转给 host.onQuit，同步 forfeit/publish → 留存 terminal → 所有原席位还原并 ACK → destroy/left → Session 最终 close。自然结束也走相同终局交付。
7. **进程/应用销毁**：`app/session.ts` app.dispose → room unmount → visual run.dispose → network.dispose(network.host)。客机close(false)保留票据/席位，host主动leave；AbortSignal可最终close(false)。平台native cleanup在所有peer已关后调用，不提供主机世界迁移。

## 不应合并的版本轴和排队轴

| 轴                                                                 | reset / 推进边界                                              | 拒绝 / 确认对象                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Run `revision`（房主按席位）                                       | 每次向该席位发图++，包括重连同一地图                          | ready/resumed、commands/owner/frame是否属于当前安装的完整世界                                                           |
| Run `loadedRevision` / `readyRevision`                             | 实际安装world / 预热完成上报                                  | 防“旧world刚预热完，却用新收到revision发送ready”                                                                        |
| guest `sequence` / host `receivedSequence` / `ack`                 | shared命令每包++；map/recovery归0                             | 命令接受去重 / host已submit取用确认；非owner伤害去重                                                                    |
| guest `ownerSequence` / host每席位同名计数                         | owner每次尝试发包++；map/recovery归0                          | owner动作/碰撞事实去重，即使共享命令没有变化也独立增长                                                                  |
| `life`                                                             | alive改变或个人复活次数消耗；map/recovery归0                  | 旧生命动作不能覆盖复活后状态                                                                                            |
| `grantSequence` / `grantAck`                                       | host产生grant才++；完整map归0                                 | host对owner共同字段的收益只应用一次；不是owner包处理ACK                                                                 |
| `nextId`                                                           | 每owner负区间单调增长；完整恢复保留                           | 攻击实体身份不跨恢复复用；与host正ID分离                                                                                |
| `clock / playerClocks / renderClock`                               | publish时钟/实际owner姿态样本时钟/播放时钟；完整map归0或-0.15 | 远端空间与事件播放；不是网络epoch或去重sequence                                                                         |
| `frames / events / owner.events+shown / grants / pending / pieces` | 各自消费、ACK、成功send、reset等不同边界                      | 分别是状态待应用、事件待播、本机已播但事实待发、收益待确认、receiver未挂时待投、单包待完整；不能统一成一个pending queue |

## 测试入口索引

| 范围                                           | 已读文件与入口                                                                                                                                                                                           | 能支持的判断 / 不能支持的判断                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 真Harbor+WebSocket，中转provider刻意禁用direct | [scripts/network.test.mjs](../../scripts/network.test.mjs)                                                                                                                                               | 房间、版本、席位断线/离队、地图ready、重返；不能支持真实ICE或GPU资源ready，也新增立即退出测试保护 quit→dispose，仍不覆盖 WAN                                 |
| 三/四人真Harbor与身份                          | [scripts/network.test.mjs](../../scripts/network.test.mjs)                                                                                                                                               | 2–4人/满员、身份、单席位断线不冻结、原席位、部分结算恢复；新增正式立即退出与漏收终局补发测试不等待 host.step                                                 |
| 混合direct/relay、分片与背压                   | [scripts/network.test.mjs](../../scripts/network.test.mjs)                                                                                                                                               | 真信令服务器 + **fake平台peer**；覆盖混合路由、各席位基准、fragment正常路径、单 link 回退；不是实际WebRTC握手或WAN带宽验收                                   |
| owner、本机响应、序号/生命                     | [scripts/network.test.mjs](../../scripts/network.test.mjs)                                                                                                                                               | 大多为有序可靠内存传输/虚拟抖动；验证当前owner模型、事实一次提交、救援和显示预览。函数名/测试名称仍含“预测”等历史用词，应读实际断言                          |
| delta与压缩、插值相位                          | [scripts/network-delta.test.mjs](../../scripts/network-delta.test.mjs)、[scripts/network-wire.test.mjs](../../scripts/network-wire.test.mjs)、[scripts/network.test.mjs](../../scripts/network.test.mjs) | 类型数组、负零、optional删除、基准不变、解压长度、同phase插值；wire/codec函数本身无跨调用持久状态，不计独立机器                                              |
| 原生与浏览器provider                           | [scripts/direct-peer-interop.mjs](../../scripts/direct-peer-interop.mjs)、[scripts/native-network-smoke.mjs](../../scripts/native-network-smoke.mjs)                                                     | 脚本写有双方offerer、candidate-first、大消息、有序/背压、晚回调、显式close、native/web run smoke及shutdown/abort；本轮没有运行，不扩成第二台Mac/WAN/TURN验收 |
| UI席位投影                                     | [scripts/ui-multiplayer.test.mjs](../../scripts/ui-multiplayer.test.mjs)                                                                                                                                 | seatView gating/人数/错误文案；凭据例外另由 network-storage 测试覆盖，UI投影本身不验证连接交接，不是网络协议端到端测试                                       |
| 纯快照恢复                                     | [scripts/snapshot.test.mjs](../../scripts/snapshot.test.mjs)；实现 [src/run/sim/snapshot.ts](../../src/run/sim/snapshot.ts)                                                                              | 快照3的六图传输恢复与模拟回归已在修复时核对；不得把内存/Harbor往返当成GPU自然通关                                                                            |
| 已有审计复现                                   | 2026-11-08 代码审计（含独立反查，原文不随仓库发布）                                                                                                                                                      | 第2/3/4/6/7项分别是退出丢结算、离线退出卡恢复、票据异常阻清理、owner结构缺校验、后台播放错位；本轮复核源码链，复现属既有证据                                 |

## 跨机器约束

- N14/N15/N17/N23/N35 分别维护会话结束、待交付离房、页面交接、终局确认和对象销毁。`ended` 不能替代“全员确认”；主存档失败重试也不属于网络 ACK。
- 重连串接 N06/N08 可达性 → N20 该席位 offline → hello → N18 该席位完整世界 → N19 实际安装/预热 → N31/N32 基准/播放，其他席位不经过任何屏障；终局是另一条已结束世界的可靠交付。
- N24 life、N25 owner sequence/ID、N26 grants/ACK、N28 rescue latch、N29展示/交付双游标有不同失效边界，不合成一个版本号或 pending 队列。
- N30 在发送成功后才提交差分基准，N31 接收时重建，N32/N33 到播放时间才显示；丢掉连续历史时必须同时重定位事件与实体的时间。
- 平台协商维持现有串行 Promise、候选缓存、单次通知和 close 隔离；没有引入通用状态机或可靠消息框架。

## 未覆盖和证据限制

指定范围中的生产网络源码已逐文件完整读取，调用链追到正式app/run入口、快照和共享战斗边界；没有仅以rg匹配数充当盘点。`wire.ts`/`codec.ts`/`owner-protocol.ts`/`protocol.ts`等纯转换/验证模块没有另外虚构持久机器，其作用已经归入对应边界。

原始盘点只读。未将本机 Harbor/内存传输扩写为 WAN/NAT/TURN、跨设备长局、GPU 外观或自然通关验收。未审计第三方依赖内部状态机、Harbor 外代理/TLS，也未以网络章节代替模拟/UI/主进度领域地图。

表中未见专项测试只限已读集合；未知交错与历史已复现缺陷分开，未因测试通过宣称无剩余风险。
