# Proposal

## Why

合作实测反馈：守卫在小地图和大地图上只是一个点，找不到守卫在哪；队友倒地时没人察觉、也不知道在哪（倒地者的模型被隐藏）；救援读条会被自己受到的伤害打断，围攻下几乎救不起来。

## What Changes

- 小地图和大地图上的守卫改为带金边的大红徽记，外绕向外扩散的金环；超出小地图范围时贴边并带指向守卫的楔形。
- 倒地的队友在两张地图上带红色扩散环，超出小地图范围时贴边；屏外队友标记改为红色警示（心跳放大、红环外扩、红底警示徽、头像变暗）。
- 倒地者所在位置的世界里出现席位色救援圈（救援半径）、向外扩散的涟漪、光柱和悬浮宝石，穿透遮挡可见。
- 队友倒地时出一次边缘危险消息（队友名 + 倒地）；个人复活当刻站起的不提示。
- 救援读条不再被救援者受到的伤害打断；移动、冲刺、必杀、再次点按、救援者倒下或目标离开半径仍会结束。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `multiplayer`：救援读条不受伤害打断；队友倒地事件（仅合作）。
- `gpu-presentation`：守卫与倒地队友在地图、屏外标记和世界里的提示。

## Impact

`sim/hurt.ts`、`sim/rescue.ts`、`state/events.ts`（新增合作专属 `down` 事件，单机不产生，golden 不变）、`createRun.ts` 通知、`view/minimapLayers.ts`、`view/player-rings.ts`、`ui/gpu/run-edge-indicators.ts`。无新增文案字符与协议版本变化。
