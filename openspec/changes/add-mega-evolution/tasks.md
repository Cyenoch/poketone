# Tasks

## 1. 模型先行

- [ ] 1.1 `src/run/balance/model.ts`：把超级形态作为最终阶段之后的一个阶段建模；对照不超级进化、X、Y 三条分支的逐图结果。日照只按天气占用率近似，并在输出中注明。
- [ ] 1.2 用模型定超级形态的生命、速度、伤害方向，以及硬爪、日照、闪焰冲锋的数值；记录对照，更新 `docs/BALANCE.md`。

## 2. 模拟

- [ ] 2.1 `content/lines/index.ts`：`MegaDef` 与 `LineDef.megas`；`charmander.ts` 写入 X / Y 数据。
- [ ] 2.2 `content/items.ts`：两块进化石；`content/abilities.ts`：硬爪、日照；`content/moves.ts`：闪焰冲锋。
- [ ] 2.3 `evolution.ts`：
  - `formOf` 读取 `player.mega`。
  - 满足条件时超级进化：补生命、无敌、`cardHold`。
  - 如果刚进化成喷火龙，等进化演出结束后再超级进化。
  - 推送 `mega` 事件。
- [ ] 2.4 `stats.ts` 与 `upgrades.ts`：超级形态的特性覆盖原特性，超级形态的招式进入候选池。
- [ ] 2.5 守卫奖杯：符合条件的玩家固定得到 X 与 Y 两块进化石选项；已超级进化或持有不变之石的玩家不再出现。
- [ ] 2.6 `state/entities.ts`、`state/events.ts`、`snapshot.ts`：新增字段与事件，快照版本提升。

## 3. 画面与资产

- [ ] 3.1 Tripo：超级喷火龙Ｘ / Ｙ 按多视图流程制作。
  - 先 `--dry-run`。
  - 记录来源。
  - 侧视图确认朝向后，再写 `formModels` / `facingYaw`。
- [ ] 3.2 超级进化演出、X 的蓝焰与终极技换色、闪焰冲锋 VFX，按 `skill-vfx` 流程。
- [ ] 3.3 ElevenLabs：超级进化与闪焰冲锋音效。
  - 写入 manifest。
  - `bun run audio:master` 母带与 QC。
  - 按 `timing.json` 对齐。
- [ ] 3.4 图鉴收录超级形态；新增文字跑 `bun run test:ui`。

## 4. 测试与验证

- [ ] 4.1 `evolution.test.mjs`：
  - 火恐龙拿到进化石后，先进化再超级进化。
  - 超级形态跨图保留。
  - 不变之石持有者不会得到进化石选项。
  - 超级进化只补新增的最大生命。
- [ ] 4.2 `stats.test.mjs`：硬爪只作用于物理招式；日照在超级进化时和每次入图时设置大晴天。
- [ ] 4.3 `coop.test.mjs` / `snapshot.test.mjs`：两名玩家分别走 X 和 Y；快照恢复超级形态。
- [ ] 4.4 `view.test.mjs`：超级形态有模型映射与朝向。
- [ ] 4.5 `bun run test:sim`；`bun run golden --write` 有意重录并复跑一次。
- [ ] 4.6 浏览器 1280×800 与 844×390：
  - 奖杯里的二选一。
  - 超级进化演出。
  - X 与 Y 的模型朝向和体型。
- [ ] 4.7 `bun run check`；独立 Agent 审阅。

## 5. 规范同步与后续

- [ ] 5.1 同步 `combat-builds`、`balance-tuning` 主规范；在 `src/run/sim/content/README.md` 登记 `megas`。
- [ ] 5.2 后续单独立项：超级妙蛙花、超级水箭龟、超级耿鬼、超级胡地。
