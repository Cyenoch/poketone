# Proposal

## Why

用户要求：除初始三只外，其余伙伴都要满足条件才能使用，未解锁的显示剪影。现在只有皮卡丘要靠研究点数解锁，其余伙伴开局即可用，长期目标不足；大厅和图鉴也没有“还没得到”的样子。

## What Changes

- 小火龙、妙蛙种子、杰尼龟开局可用；其余六只按条件解锁，条件只读已有进度字段（研究点数、各难度通关数、各伙伴最佳记录），不新增存档字段：
  - 皮卡丘：累计研究 2,500；小拳石：累计研究 8,000。
  - 腕力：通关普通；鬼斯：通关困难。
  - 凯西：4 个不同伙伴通关（任意难度）；迷你龙：3 个不同伙伴通关困难或更高。
- `starterUnlocks` 改为带 `kind` 的条件联合类型；`starterUnlocked`、`starterLock`、`runUnlocks` 由它推出。
- 大厅：未解锁伙伴以灰球上的墨色剪影出现，可聚焦，焦点或悬停时提示条件锁签；不可选择，激活无效果，‹ › 与手柄切换跳过它们。
- 图鉴宝可梦页：未解锁系列在列表和关联卡片中显示剪影，详情以二维剪影立绘代替模型，显示名字、条件锁签和进化链，隐藏种族值、特性、终极技等招式内容。
- `BallBadge` 增加剪影模式，供其他界面复用。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `progress-save`：新增「伙伴解锁条件」。
- `gpu-presentation`：新增「未解锁伙伴不可选」。
- `encyclopedia`：新增「未解锁伙伴页」。

## Impact

- `src/run/sim/content/params/progression.ts`、`src/run/progress.ts`、`src/run/locks.ts`。
- `src/ui/gpu/ball.ts`、`lobby.ts`、`lock-chip.ts`、`codex.ts`、`codex-parts.ts`；鬼斯剪影遮罩 `public/art/portraits/silhouettes/gastly.webp`；`app-host.ts` 与 `app/session.ts` 把进度交给图鉴。
- 模拟行为不变，golden 摘要不应因本 change 改变；`starterOrder` 不变。
