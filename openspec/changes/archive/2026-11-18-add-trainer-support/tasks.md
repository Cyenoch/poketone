# Tasks

## 1. 模型与数据

- [x] 1.1 `sim/content/trainers.ts`、`content/params/trainers.ts`：道具与被动数据；`src/trainers.ts` 只保留呈现字段，对白分三档。
- [x] 1.2 `balance:model`：加入四种道具（按冷却折算的平均收益）与被动，核对四人同一量级；记录到 `docs/BALANCE.md`。

## 2. 模拟

- [x] 2.1 `RunConfig.players[].trainer`、`Player.trainer` / `assistReady`；世界快照版本加一；联机设置沿用房间训练师。
- [x] 2.2 `assist` 指令与结算（`sim/trainers.ts`）、短时强化接入 `stats.ts`、`assist` 事件。
- [x] 2.3 被动：遗忘返还（`stations.ts`）、同伴伤害与攻击间隔（`partners.ts`）、异色率与图鉴计数（依赖 `add-field-events` / `redesign-lab`）、小地图读取距离（画面参数）。
- [x] 2.4 sim 测试：冷却、倒下不可用、半径内队友、无伤害；被动不改变宝可梦基础数值；联机重连保留冷却。
- [x] 2.5 `bun run test:sim`；`bun run golden --write` 有意重录。

## 3. 画面、界面与输入

- [x] 3.1 `platform/input.ts`：`assist`（键盘 G、手柄 RB）；触屏按钮在终极技旁、小一号。
- [x] 3.2 HUD 道具图标与冷却；大厅训练师卡显示道具与被动（图标 + 短名，展开看详情）。UI 设计按 impeccable 流程，只由 Claude 设计实现。
- [x] 3.3 道具投掷与生效特效（`skill-vfx`）；训练师短切入；按羁绊分档的对白。
- [x] 3.4 ElevenLabs 四个道具音效，manifest、母带、`timing.json` 对齐，遵守舒适音量规则。
- [x] 3.5 `bun run test:ui`；浏览器 1280×800 与 844×390，键鼠、触屏、手柄各用一次；两人联机互相加血。

## 4. 收尾

- [x] 4.1 独立 Agent 审阅；同步主规范；更新 `README.md` 操作说明与 `PRODUCT.md` 中训练师的描述。
