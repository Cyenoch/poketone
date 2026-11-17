# Design

## Context

需求见 proposal。现状：`app/session.ts` 的 `openRoom()` 在大厅上用 `mountMultiplayer()` 挂一个模态窗口（`GpuMultiplayer` + `DialogFrame`），玩家设置在建立连接时固定进 `enter`，房主的地图/难度在 `start` 消息里才发出；`Room.ready` 是传输握手，不是玩家准备。Harbor 按 `room.state.players` 生成开局配置，开局后客机凭票 `resume` 时收到同一份 `room.config`。导航由 `SceneTransition` 驱动，`研究所` 用 `InnerScreenFrame` 作为大厅之外页面的统一外框。

## Goals / Non-Goals

**Goals:** 联机成为独立页面，入口/输码/房间/错误共用一页；开局前席位可改训练师与伙伴、房主可改任务；所有成员实时看到；Harbor 是唯一权威。

**Non-Goals:** 手动准备开关、观战、房间列表、聊天、多地图（路线仍只有「6 关探险」）、局内或重返协议变化。

## Decisions

1. **页面路由。** `AppScreen` 增加 `room`，幕布标题「联机」；大厅的联机入口 `navigate("room")`，返回 `navigate("lobby")`。联机局「再来一局」直接回到 `room`，不再先进大厅再弹窗（删除 `reopenRoom`）。页面卸载时：会话未交接则关闭，已交接给对局则保留（沿用 `handedOff`）。房间页不提供存档窗口入口（`canSave` 在 `run`/`room` 为假），避免导入进度让房间里的已选伙伴失效。
2. **页面结构。** `InnerScreenFrame`（返回、斜切标题牌、设置）下按状态切换。进房前是落地页：左卡为本机伙伴（精灵球徽章）与「创建房间」CTA（及「重返」），右卡为六格房间码、其下「加入房间」CTA（满 6 位才可用）与右侧数字键盘；数字键可直接输入，不再跳到第二步。进房后顶栏中间是球红房间码牌（房间码、连接状态、人数、「复制」），舞台区是四张席位卡（伙伴属性卡面 + P 色描边、训练师立绘、伙伴名斜切牌、训练师与属性标签；空位为等待加入），底部 dock 分组「训练师」「伙伴」与路线 + 难度分段 + 出发（客机显示房主难度标签与「等待房主」）。训练师/伙伴选择只在房间内出现。连接中（已发 enter 未收到 room）锁定选择。
3. **协议（版本 12）。** 新增 `Room.mission {stage, difficulty}`；`enter` 在建房时可带 `mission`（缺省 `forest`/普通），加入时忽略；`setup {starter, trainer}` 更新发送者席位；`mission {stage, difficulty}` 只允许房主；`start` 不再携带参数，使用房间任务。每次修改由 Harbor 写入 `room.state` 并 `publish`，所有成员收到同一份房间。
4. **校验。** Harbor：`setup` 要求 `starter` 是已知伙伴（`Object.hasOwn(starters)`）、`trainer` 通过 `isTrainerId`；`mission` 要求发送者是席位 0、`stage` 为可玩地图、难度存在；非法值回 `error`。客户端 `room`/`start` 消息同样拒绝未知伙伴、训练师和任务。本机是否解锁伙伴/训练师只能由客户端判断（Harbor 不知道进度）：dock 列出全部伙伴与训练师，未解锁者为剪影/锁定头像，可聚焦并在悬停/聚焦时显示 `starterLock`/`trainerLock` 条件，但不能选中；难度分段沿用 `difficultyLock`。其他席位总是按其所选显示，不按本机进度遮挡。
5. **出发后的修改。** 开局后 Harbor 对 `setup`/`mission` 不改状态、不回错误：客户端可能在房主出发的同一刻发出修改，回错误会让这位客机的会话失败。效果等同拒绝：配置停在开局那一刻，所有端一致；客户端自己在 `playing` 后也不再发送。
6. **就绪状态。** 房间没有玩家准备开关，`ready` 只表示传输握手；修改选择不改变 `ready`，也不需要重新握手。房主出发时以 Harbor 当时的最新选择生成配置。
7. **重返。** 修改只在开局前允许，开局配置由最新的 `room.state.players` 与 `mission` 生成并存为 `room.config`；客机重返收到的仍是这份配置，因此保留房间内最后的选择。
8. **本机偏好。** 本人在房间改训练师/伙伴，以及房主改难度，都写回 `LobbyPick`（与大厅选择同一路径 `storage.savePick`）；客机看到的房主任务不写入本机偏好。回到大厅时显示的就是房间里最后用过的选择。

## Risks / Trade-offs

- [修改与出发竞争] → Harbor 串行处理，开局后静默忽略；配置以 Harbor 开局时的状态为准，测试覆盖开局后修改不改变配置且会话不失败。
- [房主修改难度时客机误读] → 客机任务标签随每次 room 广播更新。
- [旧客户端] → 协议版本提升，混用以「版本不同」拒绝。
- [布局在 667×375 偏紧] → 紧凑尺寸、伙伴徽章缩到触控下限 44，截图核对。
