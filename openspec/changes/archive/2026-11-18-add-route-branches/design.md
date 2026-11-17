# Design

本 change 遵守 [野外与路线规划](../archive/2026-11-18-add-field-events/design.md#共用约定) 的共用约定：随机只用世界 rng，共享结果由房主结算，新增世界字段时提升快照版本，内容写成 `sim/content/` 下带稳定 ID 的数据表。

## 现状

- `content/campaign.ts`：`STAGE_ROUTE` 是固定的六图列表。`nextField(world)` 返回列表里的下一张图。`routeProgress(world)` 返回 `(index + local) / 6`，`enemy-aim.ts:20` 和 `enemy-dodge.ts:112` 用它把敌人预判和躲避从早期参数插值到后期参数。
- `content/params/campaign.ts`：`CAMPAIGN_GROWTH` 按地图给出 hp / dmg / xp / guardian 成长；已归档的 `tune-map-entry-pace` 用 `CAMPAIGN_ENTRY_CLOCK` 与 `ENTRY_RAMP_SECONDS` 统一怪群和同伴的入图时钟。`params/zones.ts` 的 `zoneFactorsFor` 与 `zoneClock` 仍按 `stage.id` 读取，`zoneFactorsFor` 还叠加地图 `enemyHp`。
- `zones.ts`：横幅写 `${index + 1}/6`；`zoneSeed` 用 `mixSeed(seed, STAGE_ROUTE.indexOf(stage))` 区分每张图的种子；`interactInZone` 在出口处调用 `nextField` 决定胜利还是转场；`prepareZone` / `enterZone` 都按 `nextField` 校验目的地。
- `currentZone.ts`（`guide-field-exit`）：`ZoneState.exit: {x, z} | null`。`clearZone` 用 `exitSpot` 在守卫倒下处找位置：要求与地标格双向可达（`routeReach`），站得下最大的玩家体型，不与站点交互范围重叠，找不到就退回地标。`atExit` 判断玩家是否在 `EXIT_RADIUS = 2.4` 内。
- 画面：`view/exitPortal.ts` 只画一个出口（亮环 + 40 高的光柱）；`ui/gpu/run-hud.ts:1203` 写 `x/6 地图名`，`:1290` 写「前往下一图」；`ui/gpu/lobby.ts:750` 按 `STAGE_ROUTE` 横排六张图。
- 平衡：`scripts/balance-model.ts` 的 `campaign` 模式沿 `CAMPAIGN_FIELDS`（六图）连续推进。

## 决定

### 1. 路线分层，每局 4 张图

```ts
// content/campaign.ts
export const ROUTE_TIERS = [
  ["forest"],
  ["desert", "coast"],
  ["glacier", "volcano"],
  ["tower"],
] as const;
```

- 每层选一张图，每局 4 张图。没走的图下一局可能走到，这就是重玩的动力。
- 新增世界字段 `world.route: StageId[]`，记录已进入的地图（含当前地图）。路线位置 `routeStep(world) = world.route.length - 1`，取值 0–3。
- `STAGE_ROUTE` 删除。用到它的地方改为：
  - 遍历全部地图：用 `ROUTE_TIERS.flat()`。
  - 显示路线位置：用 `routeStep`。
- `routeProgress` 改为 `(routeStep + local) / ROUTE_TIERS.length`。
- `zoneSeed` 改用 `mixSeed(seed, STAGE_INDEX[stage])`，其中 `STAGE_INDEX` 是 `ROUTE_TIERS.flat()` 里的固定序号。同一种子、同一张图生成同一张地图，与走到它的路线无关，种子码挑战（`add-seed-challenges`）因此可以复现。
- `CAMPAIGN_FIELDS` 改为 `routeFields(route)`，平衡模型和 golden 都按一条具体路线展开。

**为什么是 4 张而不是 6 张**：分层的意义在于"放弃另一张"。如果每层两张都要走，就只是在选顺序，路线差异很小。代价是每局正常阶段从 60 分钟降到 40 分钟，经验曲线要重新校准，让最终进化仍落在第 3 张图前后（见第 2 节）。用户 2026-11-17 确认 4 张。

### 2. 强度按路线位置

```ts
// content/params/campaign.ts
export const ROUTE_GROWTH: readonly { hp: number; dmg: number; xp: number; guardian: number }[] = [
  /* 第 0–3 步 */
];
export const ROUTE_ENTRY_CLOCK: readonly number[] = [0, 480, 480, 480]; // tune-map-entry-pace 的入图时钟，按步数
```

- `zoneFactorsFor(stage, zone)` 改为显式接收路线 `step` 的接口，`zoneClock(step, localSeconds)` 同样不再从地图推断位置。地图自己的 `StageDef` 仍决定敌人名单、守卫种类和地形；路线位置决定数值成长。沙漠和海岸在第 1 步强度一样，冰川和火山在第 2 步强度一样。
- 删除 `StageDef.enemyHp` 和各地图的该字段，不把旧倍率移到另一个地图字段。起始曲线第 0 步取森林、第 3 步取塔，第 1、2 步对同层地图的旧**实际**生命与守卫因子（含旧 `enemyHp`）取均值，其余成长取同层均值；单纯删除旧倍率会无意提高整层耐久。之后按四条连续路线模型校准，**先改模型，后定正式数值**。同伴不乘敌人专用耐久倍率。
- `xp` 成长要让 4 张图走完时的等级和进化节点与现在 6 张图的相对位置接近：第一次进化在第 1 步，最终进化在第 2 步后段。具体值以模型输出为准。
- 守卫的固定参考时点规则（`raise-zone-guardians`）不变，只是强度来源从地图换成路线位置。
- 后区守卫强化：现在沙漠、海岸用中段节奏，冰川、火山、塔用后段节奏，森林用基础节奏。改为第 0 步基础、第 1 步中段、第 2–3 步后段，和原来的分组一致。

采用四步成长与 8 秒入图升温。普通难度、无研究、每格八个构筑的模型中，小火龙四条路线的完成率为 11.9%–12.8%，历史六图参考为 29.2%。进入沙漠的样本在前两分钟的条件存活率为 96.9%。损失更多出现在中后段与守卫战，因此保留入图时钟。该估计计入路线精英率，奖杯、交易与视野收益留给实局观察。

### 3. 多出口

```ts
// state/world.ts
export interface ZoneExit {
  x: number;
  z: number;
  to: StageId | null;
  marker: MarkerId | null;
}
export interface ZoneState {
  /* … */ exits: ZoneExit[];
  leaving: number | null;
} // 替换 exit
```

- **出口数量**：守卫倒下时 `clearZone` 用世界 rng 决定。
  - 下一层有两张图时，每张图一个出口。另有 25% 概率多开一个出口，目标是其中一张图、配不同的标记，这对应"偶尔 3 个"。
  - 下一层只有塔时，开 2 个去塔的出口，标记不同。
- 塔关只开一个出口，`to` 与 `marker` 均为 `null`，使用后结束整局。
- **位置**：沿用 `exitSpot` 的全部条件。第一个出口在守卫倒下处，其余出口在以它为圆心、半径 6 的圆上按固定角度试位。出口之间至少相隔 `2 × EXIT_RADIUS + 1`，保证同一次交互不会同时落在两个出口里。某个出口找不到合规位置时，在地标周围同样试位；仍然不行就少开这个"额外"出口。每张目标地图至少保留一个出口，这一点由测试保护。
- **使用**：`atExit` 返回所在出口的序号或 `null`，序号 0 不能当作未命中。`interactInZone` 把第一个合法序号写入 `world.zone.leaving`，`nextField` 读取已采用出口的 `to`，无选择不能当作塔终局。合作中房主按命令顺序只接受第一次选择。
- **准备与提交**：`prepareZone` 在 scratch 中规划所选地图、追加后的路线、标记和词条，保持旧世界不变；`enterZone` 核对同一选择后一次提交，才把目的地追加到 `world.route` 并安装标记。准备重试不得重复抽取真实世界随机数、重复推路线或发入图奖励。提交后重置出口与选择。
- 清区后 `zoneAction` 优先判断出口，规则和现在一样：地标不再作为出口。

### 4. 奖励标记

新增 `content/route.ts`，定义 `routeMarkers: Record<MarkerId, MarkerDef>`。标记只在进入下一图时生效一次：

| ID            | 名称       | 正作出处         | 效果                                  |
| ------------- | ---------- | ---------------- | ------------------------------------- |
| `chests`      | 宝箱       | 地上的道具球     | 入图时在 building 平台额外放 3 个宝箱 |
| `elite-nest`  | 精英巢     | 群聚的强壮个体   | 本图精英生成率 ×2，精英掉落的宝箱翻倍 |
| `pokecenter`  | 宝可梦中心 | 回复             | 入图时全队回满生命、清除异常状态      |
| `research`    | 研究资料   | 博士的委托       | 本图星星沙子掉率 ×2                   |
| `gengar-deal` | 耿鬼的交易 | 幽灵系的诅咒交易 | 入图时出现耿鬼祭坛（见下）            |

- **耿鬼的交易**由祭坛提供。玩家在三件不同的合法传说道具（`rarity: 3`）中选一件。只有一至两件时全部展示，没有合法道具时不开交易。选定后，该玩家本局最大生命 ×0.85，可以叠加。每名玩家每张图最多成交一次。未成交时保留最大生命。
- 标记由世界 rng 抽取，同一组出口里不重复。第 1 步之后才可能出现耿鬼的交易，宝可梦中心不会出现在去塔的出口上。权重写在 `content/route.ts`，可以调。

### 5. 守卫奖杯

- 新增拾取物种类 `trophy`。守卫倒下时给每名存活玩家掉一个，走与宝箱相同的个人拾取与飞行结算。退出时还在飞的奖杯按 `guide-field-exit` 的规则结算，不丢失。
- 拾取后复用宝箱的选择对话。候选来源包括以下内容。
  - 史诗或传说道具。
  - 本线的招式强化：已有招式直接升一级，没有可升的就换成道具。
  - 后续 change 加入的特殊道具：`deepen-builds` 的联系绳、特性膏药，`add-mega-evolution` 的超级石。
- 有三个合法候选时展示三个，只有一至两个时全部展示。所有候选耗尽才提供训练。道具栏位与品质限制照常生效。

### 6. 地图词条

- 进入第 1、2 步的地图时，用世界 rng 判定是否带一个词条：第 1 步 25%，第 2 步 40%；森林和塔不带。结果写入 `world.modifier: ModifierId | null`。
- 宝可梦中心标记和词条可以同时出现；耿鬼的交易不受词条影响。

| ID              | 名称     | 玩法                                                                                                                     | 解除                                                    |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `dark-cave`     | 黑暗洞穴 | 每名玩家只照亮身边一圈。火系、电系玩家的照亮半径更大，对应小火龙的尾巴火焰和皮卡丘的电光。小地图只显示照亮范围内的东西。 | 地图上放一个「招式学习器 闪光」拾取物，捡到后整张图照亮 |
| `fog`           | 浓雾     | 小地图和罗盘只显示守卫地标与出口，其余标记消失                                                                           | 「招式学习器 清除浓雾」拾取物，捡到后恢复               |
| `boss-sighting` | 头目出没 | 精英生成率 ×1.6，精英生命 ×1.15                                                                                          | 无                                                      |

- 照亮半径写成数据，由模拟给出，画面只读取。敌人生成仍在屏外，规则不变。
- 出口光柱和守卫标记在任何词条下都可见。`guide-field-exit` 的"知道该去哪"优先于词条带来的难度。

### 7. 画面与界面

- **大厅**：路线改为 4 列分层图，每层列出可能的地图，层间连线。没有地图单选，也不加说明文字。
- **HUD**：`x/4 地图名`。原来第 1290 行的「前往下一图」在有多个出口时改为显示离玩家最近的出口的目标。
- **出口**：`exitPortal.ts` 改为按 `zone.exits` 建多个实例。光柱颜色按目标地图的主题色，柱顶悬浮标记图标和目标地图名。小地图和大地图上每个出口用同款扩散环，标签是地图名。罗盘指向最近的出口。
- **词条**：入图横幅显示词条名，例如「黑暗洞穴」。黑暗洞穴用 `grade.ts` 同一套色调方式压暗，再按照亮半径开孔，不加后期处理通道。浓雾用场景雾。

### 8. 联机与快照

- `world.route`、`zone.exits`、`zone.leaving`、`world.marker`、`world.modifier` 和照亮状态都是普通可序列化数据，进入快照，`SNAPSHOT_VERSION` 提升一次。
- 出口、标记和词条都由房主的世界 rng 决定；耿鬼交易和奖杯选择是个人选择，按现有对话规则结算。
- 访客加入时从快照恢复路线位置，HUD 显示的路线位置相同。

## 不做

- 不做可回头的地图网，路线只向前。
- 不做按地图分别配置的成长表；地图之间的差异只来自名单和地形。
- 不加商店。宝可梦中心只回复，不卖东西。

## 风险

- 4 图路线显著改变经验曲线和进化节点。必须先改模型、对照 4 条路线组合的到达率与进化等级，再改 `ROUTE_GROWTH`。golden 有意变化。
- 多出口落点在狭窄地形里可能挤不下。用测试覆盖五张室外图 × 多个种子：每张目标地图至少一个出口、出口互不重叠、全部双向可达。
- 黑暗洞穴在手机屏幕上可能太难看清。只在 844×390 截图确认照亮半径后才定值。
