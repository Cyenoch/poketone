# Tasks

## 1. 第 1 期内容确认与资产

- [x] 1.1 与用户确认第 1 期内容：九种交互点与塔内幽灵、四种天气、异色（用户 2026-11-17 全部同意）。
- [ ] 1.2 新物种模型按 Tripo 多视图流程生成并记录来源：赫拉克罗斯、凯罗斯、小卡比兽、卡比兽、鲤鱼王、暴鲤龙、化石翼龙、嘎啦嘎啦；侧视图检查朝向后再加 `facingYaw`。
- [ ] 1.3 交互点场景模型走 Blender 脚本：甜甜蜜树、道具球、钓鱼木桩、化石岩层、巢穴、泉水、蛋。
- [ ] 1.4 ElevenLabs 音效：四种天气起始与循环、宝可梦之笛、钓鱼、挖掘、巢穴开启、异色闪光、蛋孵化、霹雳电球预警；写入 manifest、母带处理、按 `timing.json` 对齐关键帧。

## 2. 模拟

- [ ] 2.1 `StageZone.beats` 改为时间窗，新增 `StageZone.events`；进入区域时用区域 rng 排定 `world.zone.schedule`，`fired` 改用表内下标；`world.eventsUsed` 保证同局不重复。
- [ ] 2.2 `beats.ts` 新增 `horde` 与 `outbreak`；`content/events.ts` 事件表。
- [ ] 2.3 `content/weather.ts` 与 `world.weather`：预告、持续、属性倍率（`combat.ts`）、招式调整（`stats.ts`）、持续伤害（`hurt.ts`，属性免疫，守卫减半）。
- [ ] 2.4 地图规格加入 `site` 平台；`mapgen/playable.ts` 对 site 平台做站点同款检查；`StageZone.sites` 分配种类。
- [ ] 2.5 `content/sites.ts`、`content/params/sites.ts`、`world.sites` 与 `sim/sites/<kind>.ts`（九种 + 检视镜）；`interact` 顺序改为救援 → 区域 → 交互点 → 站点，`createRun.ts` 提示同序。
- [ ] 2.6 事件专属敌人写入 `content/enemies.ts`（不进普通名单）；巨大化精英、幽灵免伤、蛋的步数与孵化、引导打断。
- [ ] 2.7 异色：`Enemy.shiny`、概率与每图上限、逃离、星星沙子、`Player.dex` 本局计数；结算写入进度 v5 `dex`（依赖 `extend-progress-v5`）。
- [ ] 2.8 世界快照版本加一，覆盖 schedule、eventsUsed、weather、sites、outbreak、shiny、dex、egg。
- [ ] 2.9 解析模型新增"事件收益"项，估算每图额外经验、宝箱卡与星星沙子。

## 3. 画面与界面

- [ ] 3.1 交互点场景物件、小地图与罗盘图标、引导进度环、交互提示复用站点组件。
- [ ] 3.2 天气画面（天空色、粒子）、预告横幅、HUD 天气图标与剩余时间。
- [ ] 3.3 异色配色参数（`view/assets.ts`）、闪光与消息提示；图鉴敌人条目显示遇见、击败、异色次数与异色模型切换。

## 4. 验证

- [ ] 4.1 新增 sim 测试：同种子排定一致且快照恢复不重抽；同局事件不重复；沙暴免疫；两人同 tick 交互只结算一次；引导打断；异色逃离不计击败；`dex` 只入账一次。
- [ ] 4.2 `bun run test:sim`、`bun run golden --write`（有意行为变化）、`bun run balance:model` 对照事件收益。
- [ ] 4.3 `bun run test:ui`；浏览器 1280×800 与 844×390 查看天气、交互点、异色；联机两人试玩交互点与天气。

## 5. 大版本其他 change（各自立项，见 design.md 总表）

- [ ] 5.1 `guide-field-exit`：出口指引（本期交互顺序依赖它统一的前两项）。
- [ ] 5.2 `extend-progress-v5`：进度 v5（本期 `dex` 依赖它）。
- [ ] 5.3 `add-route-branches`：第 2 期 分岔路线。
- [ ] 5.4 `deepen-builds`：第 3 期 构筑深度（天气招式、特性、道具在本期天气基础上扩展）。
- [ ] 5.5 `add-challenge-rules`、`redesign-lab`：第 4 期 挑战规则、徽章与研究所。
- [ ] 5.6 `add-shiny-looks`：异色外观（复用本期异色配色）。
- [ ] 5.7 `add-partner-bond`：伙伴羁绊。
- [ ] 5.8 `add-mega-evolution`：喷火龙 X / Y 超级进化分支。
- [ ] 5.9 `add-battle-tower`：对战塔无尽。
- [ ] 5.10 `add-seed-challenges`：种子码挑战。
