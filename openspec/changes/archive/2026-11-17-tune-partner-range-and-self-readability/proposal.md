# Proposal

## Why

同伴原先追离自己最近、且在主人 7 单位内的敌人，目标一出界就立刻回到跟随位，在边界上来回抖动；它也不会优先处理贴着玩家的敌人。画面上同伴用玩家的暖黄脚环、全强度出手特效，混战中比玩家本人更显眼，而玩家被敌群和特效盖住后很难找到自己。

## What Changes

- 同伴在主人周围的战斗范围内自由活动并自动攻击，优先攻击离主人最近的敌人；当前目标保持到出现明显更近（`PARTNER.retarget`）的敌人为止。
- 同伴离主人超过 `roam` 后停止战斗、跟随主人，回到 `rejoin` 以内才重新战斗；两个距离之间的回差防止抖动。不强行把同伴限制或推回某个范围。远距离瞬移归队（`regroup`）保持不变。
- 远程同伴在射程外会靠近目标，射程内跟随站位并射击。
- 只有本地玩家有描边：暖黄反向外壳外轮廓，在特效之后绘制，只描外轮廓、不压在自身模型上。敌人、守卫、队友和同伴都不描边。
- 本地玩家脚环在单机下也显示（暖黄），并绘制在敌群与特效之上，但不覆盖玩家自身模型。
- 同伴不描边，脚环改为淡奶白，出手特效强度约减半。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `combat-builds`：同伴的战斗范围、目标优先级与归队行为。
- `gpu-presentation`：本地玩家在混战中的定位提示与同伴视觉降权。

## Impact

`sim/partners.ts`、`sim/content/params/partners.ts`、`state/entities.ts`（`Partner` 新增 `target`、`returning`，不做存档迁移）、`sim/zones.ts`；`view/outline.ts`（新）、`view/playerRig.ts`、`view/player-rings.ts`、`view/vfx/partners.ts`。模拟行为改变，golden 需要在工作树其他未提交改动落定后重录。
