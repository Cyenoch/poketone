# Design

## 现状

```ts
// content/params/zones.ts
export function zoneClock(stage, zone, t) {
  return t + zonesOf(stage)[zone]!.clockOffset * Math.min(1, t / 20); // clockOffset 全为 0
}
export function zoneHealthClock(stage, zone, t) {
  return Math.max(zoneClock(stage, zone, t), CAMPAIGN_HP_CLOCK[stage.id]); // 只有生命有下限
}
```

入图时 `world.spawn` 也被重置（`credit: 0`、`pressure: 0.5`），前 20 秒压力调节停在中性值。结果是：怪的数量和攻势像森林开局，只有血量像后期。玩家带着成型构筑进图，前两三分钟几乎没有压力。

## 方案

- 已有的 `clockOffset` 机制就是为此准备的，只是值都是 0。把 `CAMPAIGN_HP_CLOCK` 改名为 `CAMPAIGN_ENTRY_CLOCK`，作为每张图的入图时钟：
  - `zoneClock = t + entry × min(1, t / ENTRY_RAMP_SECONDS)`，`ENTRY_RAMP_SECONDS` 从 20 改为约 8，入图后很快到位，又不会在载入完成的瞬间满场刷怪。
  - `zoneHealthClock` 删除，生命和其他曲线读同一个时钟。原来生命下限是硬下限（入图第 0 秒就满额），改为同样 8 秒升到位；在此之前刷出的少量怪生命略低，可接受，模型里核对。
- 同伴成长读同一时钟，敌我仍同步成长（现在同伴读的是无下限的时钟，同样偏弱）。
- 刷新额度 `credit` 入图时仍从 0 开始，`SPAWN_CREDIT_MAX` 保证不会一次刷出一大波；在场上限按新时钟计算，第一分钟就能达到对应的密度。
- 起始值：沿用 480 秒（等于前一张图 8 分钟时的强度）。用 `bun run balance:model` 对照入图后 0–120 秒的压力指数，目标是与前一张图最后两分钟接近、略低，给玩家喘息的余地而不是断层。若模型显示后段地图仍偏弱，再按路线位置分别定值（例如 480 / 480 / 540 / 540 / 600）。
- 守卫（`bossHp` 固定参考时点）、时间轴事件、名单解锁、狂暴触发时刻都读局部时间 `t`，不受影响。

## 与路线分支的关系

`add-route-branches` 把强度改为按路线位置读取时，把 `CAMPAIGN_ENTRY_CLOCK` 一并换成按路线步数索引的数组。本 change 可以先上线，不依赖大版本。

## 风险

- 难度上升：这是用户要的。困难难度下入图节奏也会同步变快，靠模型的逐难度报告确认没有越过可通关线。
- 联机：队伍倍率照常在新时钟之上应用，不额外叠加。
