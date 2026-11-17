# Proposal

## Why

联机目前是大厅上的弹窗：进入房间后伙伴、训练师和难度都不可再改，房间只能只读显示「6 关探险 · 普通」。用户要求联机成为独立页面，并允许在房间里修改人物（训练师）、宝可梦与任务（路线/难度）。

## What Changes

- 联机由大厅弹窗改为与研究所同级的独立页面，通过共享幕布进出（标题「联机」）；覆盖入口（创建/加入/重返）、输入房间码、一至四人房间、等待房主、出发中和错误/断开。
- 每位玩家在开局前可修改自己的训练师和伙伴（只能选本机已解锁的伙伴）；房主可修改任务（路线与难度）。所有成员实时看到变更。
- 协议新增客户端消息 `setup`（本人伙伴与训练师）和 `mission`（仅房主）；房间状态带当前任务，`start` 不再携带地图与难度而使用房间任务。**BREAKING**：`PROTOCOL_VERSION` 12，旧客户端以版本不同被拒。
- Harbor 和客户端校验：未知训练师/伙伴、非房主修改任务明确拒绝；出发后的修改不生效。
- 房间内本人的修改同步回本机大厅偏好（`LobbyPick`）。

非目标：不增加玩家手动「准备」开关；不改变局内同步、重返或终局协议；不新增地图（路线仍只有「6 关探险」）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `multiplayer`: 房间开局前可修改席位训练师/伙伴与房主任务，含校验、广播和出发后冻结。
- `gpu-presentation`: 联机成为经幕布进入的独立页面，替代大厅上的弹窗。

## Impact

- 协议与服务：`src/network/protocol.ts`、`src/network/session.ts`、`services/harbor/server.ts`、`scripts/network.test.mjs`（以及调用 `start()` 的测试/冒烟脚本）。
- 页面与导航：`src/ui/gpu/multiplayer*.ts`、`src/app/session.ts`（新增 `room` 页面路由）。
- 文档：`docs/state-machines/network.md`、`docs/state-machines/application-ui.md`（若描述了房间窗口）。
