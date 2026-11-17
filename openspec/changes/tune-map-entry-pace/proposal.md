# Proposal

## Why

用户 2026-11-17 反馈：进入下一张图后出怪慢、怪也弱。原因在 `content/params/zones.ts`：每张图的 `clockOffset` 都是 0，`zoneClock` 从 0 秒重新开始，所以刷新速率（`SPAWN_CURVE`，0 分钟约 1.1/秒，10 分钟约 7.6/秒）、在场上限（`LIVE_CAP`，60 → 220）、伤害和移动速度全部回到森林开局的水平。现在只有生命有下限（`CAMPAIGN_HP_CLOCK`，480 秒），其余节奏都被重置了。

## What Changes

- 每张后续地图有一个固定的入图时钟：刷新速率、在场上限、伤害、速度和生命都从这个时钟起算，几秒内升到位，不再从 0 开始。森林不变。
- 入图时钟取代只管生命的 `CAMPAIGN_HP_CLOCK`，按路线位置定值（现在六图，`add-route-branches` 落地后改为四步），先用分析模型定值再改参数。
- 守卫仍用固定参考时点，不受影响；时间轴事件、名单解锁和狂暴时刻仍按本图局部时间。
- 平滑压力调节保持不变，它只在入图宽限期后按队伍状况微调供给。

## Capabilities

### Modified Capabilities

- `simulation`：「后续区域承接敌人耐久」扩展为承接全部怪群节奏。
- `balance-tuning`：入图节奏纳入分析模型。

## Impact

`content/params/zones.ts`、`content/params/campaign.ts`、`director.ts`、`partners.ts`（同伴成长读同一时钟）、`balance/model.ts`、`balance/coop.ts`、`dev/readout.ts`、`docs/BALANCE.md`；有意改变 golden。无存档、界面或资源改动。可以先于大版本单独上线；`add-route-branches` 把定值改为按路线位置。
