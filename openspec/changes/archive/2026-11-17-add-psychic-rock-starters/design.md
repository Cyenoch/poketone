# Design

## Context

沿用 [add-ghost-dragon-fighting-starters](../../add-ghost-dragon-fighting-starters/design.md) 的接线路径：`content/lines`、`moves`、`abilities`、`ultimates`、`fusions` 为唯一玩法定义；模型、VFX、音频、图标与大厅读取同一 ID。实现遵循 [平衡手册](../../../../docs/BALANCE.md) 与 [内容索引](../../../../src/run/sim/content/README.md)。

## Goals / Non-Goals

Goals：两条线有不同距离、控制与成长节奏；保留旧线与随机消耗；大厅九枚徽章可读并更换背景。

Non-Goals：不新增原型、状态、敌人、存档迁移或 UI 系统。

## Decisions

### 进化线与招式

| 线      | 定位、特性                                                                              | 四招 kit（门槛 1/2/28/40）                    | 进化招式                | 进化等级 | 终极技          |
| ------- | --------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------- | -------- | --------------- |
| abra    | 念力控场；`synchronize` 同步：冷却 ×0.94/0.9/0.86，额外冲刺 +1/1/2                      | confusion / hypnosis / psybeam / psychic      | future-sight / psyshock | 1/28/54  | psychic-field   |
| geodude | 重装岩崩；`sturdy` 结实：最大生命 +10/15/20%，护甲 +12/16/20，地面属性伤害 ×1.1/1.2/1.3 | rock-throw / rollout / magnitude / rock-slide | earthquake / stone-edge | 1/28/54  | rockslide-quake |

融合：psybeam + psychic → psystrike（bloom）；magnitude + rock-slide → tectonic-rage（rod）。均复用既有融合原型。

凯西线靠睡眠（`wakeBonus` ×1.8）与高单次伤害配合：先催眠/精神击破让敌人睡着，再用精神强念、预知未来打醒。同步的额外冲刺对应凯西的瞬移，不另做传送机制。小拳石线全部物理、无状态，靠高生命护甲、地面加成与大范围击退。

### 形态与参考数据

公式同上一批：进化 HP = 起始 HP × √(参考 HP 比)，速度 × (参考 Spe 比)^¼，半径与显示高度 × (身高比)^¼。

| 形态（编号）  | 参考 HP / Spe / 身高 dm | 游戏 HP / 速度 / 半径 / 高度 |
| ------------- | ----------------------- | ---------------------------- |
| abra (63)     | 25 / 90 / 9             | 85 / 4.4 / 0.36 / 1          |
| kadabra (64)  | 40 / 105 / 13           | 108 / 4.573 / 0.395 / 1.096  |
| alakazam (65) | 55 / 120 / 15           | 126 / 4.728 / 0.409 / 1.136  |
| geodude (74)  | 40 / 20 / 4             | 135 / 3.4 / 0.36 / 1         |
| graveler (75) | 55 / 35 / 10            | 158 / 3.911 / 0.453 / 1.257  |
| golem (76)    | 80 / 45 / 14            | 191 / 4.164 / 0.492 / 1.368  |

凯西线全程 psychic；小拳石线全程 rock/ground。全部沿用玩家地面机动契约。

## VFX/audio handoff

ID 固定；数值为无升级的几何/时间，最终伤害与冷却以 `content/moves.ts` 为准。几何常量见 `content/params/archetypes.ts`。

| move id（名称）        | archetype / 命中形状   | delay / life / 尺寸                          | 外观与音频意图                                       |
| ---------------------- | ---------------------- | -------------------------------------------- | ---------------------------------------------------- |
| confusion 念力         | barrage / 小弹         | life 1.1；r .22；speed 16；count 2；pierce 1 | 粉紫念力光片，轻颤嗡鸣                               |
| hypnosis 催眠术        | cone / 扇形            | life 1.2；length 3；tick .2；sleep           | 同心粉色波纹向前扩散，柔和催眠音；不要用草系孢子     |
| psybeam 幻象光线       | beam / 直线            | delay .3；width .6；length 17；每 .15 tick   | 彩虹偏粉的螺旋光束                                   |
| psychic 精神强念       | smite / 圆             | delay .45；r 1.6；count 2                    | 目标处念力压缩、扭曲后爆开，低沉压迫音               |
| future-sight 预知未来  | smite / 圆             | delay 1.2；r 2.1；count 1                    | 地面预言符印长时间蓄力，天上光柱落下；长延迟必须可读 |
| psyshock 精神冲击      | chain / 跳跃           | 即时；4 跳；CHAIN range 10                   | 粉色念力碎晶在敌人间折射，短促卡通晶片音             |
| rock-throw 落石        | lob / 落点圆           | 飞行 .75；弹r .25；爆r 1.2                   | 灰褐石块抛物线，落地碎石与尘                         |
| rollout 滚动           | wave / 移动带          | life 1.1；半宽 1.2；speed 8                  | 滚动的岩球前推碾压，不移动玩家本体；圆润滚动撞击音   |
| magnitude 震级         | spin / 随身圆          | life .9；r 2.6；每 .3 tick                   | 脚下地面龟裂与尘环一圈圈震荡                         |
| rock-slide 岩崩        | smite / 圆             | delay .55；r 1.2；count 3                    | 天上落下多块岩石，落地重击                           |
| earthquake 地震        | nova / 周身圆          | 即时；r 3.2                                  | 大范围地面隆起波，短促有重量的卡通震音               |
| stone-edge 尖石攻击    | strike / 交替扇形      | length 2.6；STRIKE 几何                      | 地面刺出尖石扇，清脆碎岩                             |
| psystrike 精神击破     | bloom / 光束+碎片+终爆 | 继承 BLOOM 几何；sleep                       | 粉紫光束，沿途念力碎片，终点大型念力绽放；不用花瓣   |
| tectonic-rage 地裂岩崩 | rod / 落点+余震+爆炸   | 继承 ROD 几何                                | 巨岩砸入地面，余震裂纹 tick，终爆岩柱；不用电光      |

终极技复用 `Pulse`：

| ultimate id     | 形状/时点                                                                                                                 | 外观/声音                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| psychic-field   | t0 ring r3.4/4/4.6 pull2 sleep；t.5 lines count4/6/8 length7/9/11；第二档起 t.9 strike×3 最强目标；第三档 t1.3 blast r4.5 | 粉紫念力领域收拢，放射念力线，落光柱 |
| rockslide-quake | t0 ring r2.8；t.3 起每 .3 strike count2/3/4（3/4/5 次）；终 ring blast r3.5/4/4.5 knock6                                  | 震地后连续落岩，终段地裂             |

音频：`cast-psychic`/`hit-psychic`、`cast-rock`/`hit-rock`、`cast-ground`/`hit-ground` 各 2–3 变体，按命中关键帧绑定。UI：starterOrder 追加 abra/geodude；图鉴读取注册表。

用户反馈后的呈现：岩石与地面声音使用圆润、短促、有弹性和重量的卡通音色，不用写实摩擦、金属敲击或电影轰鸣。催眠术为胸前螺旋盘及逐命中节拍推进的粉紫开口波环；命中与合作预测接触事件携带来源招式，催眠术不重启敌人白闪或生成通用白色／金色火花，其他攻击已有闪光正常结束。伤害、会心与睡眠判定保持原规则。

## Risks / Trade-offs

- [睡眠收益依赖构筑] → 模型只估计睡眠占用，真人体验留给整合验收。
- [隆隆岩生命偏高] → 速度最低、无控制，平衡模型三难度对照后再调。
