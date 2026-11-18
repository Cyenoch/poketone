# Tasks

## 1. 模型先行

- [x] 1.1 `src/run/balance/model.ts`：
  - 支持特性选择、不变之石与进化奇石路线、皮卡丘留形路线、通信线在交换前的停留时间。
  - 支持天气占用率参数，誓约组合只在合作样本里估算。
  - 输出注明哪些是解析近似。
- [x] 1.2 用模型对齐改名后的正作特性和新特性、电气球、天气特性与天气道具的数值；记录改前改后对照，更新 `docs/BALANCE.md`。

## 2. 模拟

- [x] 2.1 `content/lines/index.ts`：`EvolveStage.needs`、`abilities` 结构；各线数据改用正作特性表；皮卡丘雷丘阶段需要雷之石；豪力、鬼斯通、勇基拉、隆隆石的最终阶段需要通信交换。
- [x] 2.2 `evolution.ts`：`stageFor(player)` 读等级、条件和不变之石；联系绳在进化时消耗；`stats.ts` 读当前形态在 `player.abilitySlot` 上的特性。
- [x] 2.3 `zones.ts` 合作交换交互：双向确认、时限、房主结算；守卫奖杯候选在满足条件时必含联系绳。
- [x] 2.4 `content/items.ts`：电气球、联系绳、不变之石、特性膏药、炽热岩石、潮湿岩石，以及沙沙岩石延长沙暴。
- [x] 2.5 `Choice` 种类 `ability`：第一次进化时二选一；特性膏药立即换成隐藏特性。
- [x] 2.6 `archetypes/weather.ts` 与大晴天、求雨、沙暴招式；天气中的前摇、范围、冷却修正；叶绿素、太阳之力、雨盘、沙隐、无防守、浮游、避雷针。
- [x] 2.7 `content/pledges.ts` 与三种誓约招式；组合判定、组合场与全队状态。
- [x] 2.8 `state/entities.ts` 与 `snapshot.ts`：新增字段，快照版本提升。

## 3. 画面与资产

- [x] 3.1 天气招式、誓约柱和三种组合场的 VFX，按 `skill-vfx` 流程；交换进化复用进化演出。
- [x] 3.2 ElevenLabs：天气招式 3 个、誓约 3 个、组合场 3 个、交换 1 个音效；写入 manifest，`bun run audio:master` 母带与 QC，按 `timing.json` 对齐，遵守舒适音量规则。
- [x] 3.3 道具图标与特性名进入图鉴（`ui-codex`），新增文字跑 `bun run test:ui` 检查字形覆盖。

## 4. 测试与验证

- [x] 4.1 `evolution.test.mjs`：
  - 皮卡丘没有雷之石不进化，有雷之石则进化。
  - 不变之石阻止进化，进化奇石在此期间持续生效。
  - 联系绳消耗、合作交换双向确认与超时。
  - 奖杯必含联系绳。
- [x] 4.2 `stats.test.mjs` / `triggered-items.test.mjs`：特性按形态 + 栏位读取，鬼斯通进化为耿鬼后浮游变为诅咒之躯；天气特性只在对应天气生效；电气球只对皮卡丘形态生效。
- [x] 4.3 `archetypes.test.mjs` / `combat.test.mjs`：天气覆盖规则；雨中打雷没有前摇；誓约组合只在两种不同誓约于时空窗口内相遇时生成一次。
- [x] 4.4 `coop.test.mjs` / `snapshot.test.mjs`：交换与组合由房主结算，快照恢复交换请求和组合场。
- [x] 4.5 `bun run test:sim`；`bun run golden --write` 有意重录并复跑一次确认稳定。
- [x] 4.6 浏览器 1280×800 与 844×390：特性二选一对话、天气与誓约演出；两人联机完成一次交换进化和一次誓约组合。
- [x] 4.7 `bun run check`；独立 Agent 审阅。

## 5. 规范同步

- [x] 5.1 同步 `combat-builds`、`balance-tuning` 主规范；在 `src/run/sim/content/README.md` 登记誓约表、新道具和特性；在 `docs/STATE-MACHINES.md` 补交换请求的生命周期。
