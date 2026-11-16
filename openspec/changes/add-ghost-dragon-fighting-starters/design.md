# Design

## Context

现有 `content/lines`、`moves`、`abilities`、`ultimates` 与 `fusions` 为唯一玩法定义；每条线必须有融合配方。升级只抽本线技能，追加注册表不会扩张其他线的技能池。形态和敌人注册表彼此独立，同名物种不能让玩家引用 `/models/enemies/`。实现遵循 [平衡手册](../../../docs/BALANCE.md) 与 [内容索引](../../../src/run/sim/content/README.md)。

## Goals / Non-Goals

Goals：三条线有不同距离、状态和成长节奏；保留旧线与其随机消耗；玩法参数同步供模型、声画使用。

Non-Goals：不新增敌人、存档迁移、抽卡规则或新 UI 系统。模型与音频文件、VFX 和大厅由对应代理接入，本任务不代替真实画面验收。

## Decisions

### 进化线与招式

| 线      | 定位、特性                                                             | 四招 kit（顺序为门槛 1/2/28/40）                     | 进化招式                  | 进化等级 | 终极技                                           |
| ------- | ---------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------- | -------- | ------------------------------------------------ |
| gastly  | 诅咒游击；`shadow-shroud` 幽影：闪避 20/24/28%，异常伤害 +20/35/50%    | shadow-ball / smog / hex / sludge-bomb               | night-shade / dream-eater | 1/28/54  | phantom-night：先诅咒，后持续毒伤与幽灵爆发      |
| dratini | 蓄势贯穿；`dragon-scale` 龙鳞：龙属性伤害 ×0.9/1.15/1.45，护甲 +3/6/10 | dragon-breath / twister / dragon-pulse / dragon-rush | aqua-tail / hurricane     | 1/32/60  | draco-meteor：龙息放射，进化后增加落星与终结震荡 |
| machop  | 近身连打；`guts` 毅力：护甲 +20/24/28，物理伤害 ×1.08/1.12/1.16        | karate-chop / low-sweep / brick-break / focus-blast  | seismic-toss / cross-chop | 1/28/54  | seismic-barrage：近身连续震击，终击击退          |

三个融合配方维持现有站点契约：smog + hex → nightmare-vortex（firestorm）；twister + dragon-pulse → dragon-tempest（tempest，2026-11-17 由 bloom 改为专属形态：数量即龙脉束数）；karate-chop + brick-break → hundred-fists（combo）。融合沿用站点契约与 fusionParts 终爆，不添加新的融合引擎。

### 形态与参考数据

数据源为项目保留的 0.8.83 `derived/pokemon.json`（全国编号、基础 HP/速度、身高），参照已有线的衰减比例：进化 HP = 起始 HP × √(参考 HP / 起始参考 HP)，速度 = 起始速度 × (参考 Spe / 起始参考 Spe)^¼，接触半径 = 0.36 × (参考身高 / 起始参考身高)^¼。模型显示高度独立采用同样的四次根压缩，避免蛇形原作身长变成屏幕高度；最终值写入 lines，不在运行时读取参考文件。

| 形态（编号）    | 参考 HP / Spe / 身高 dm | 游戏 HP / 速度 / 半径 / 高度 |
| --------------- | ----------------------- | ---------------------------- |
| gastly (92)     | 30 / 80 / 13            | 90 / 4.2 / 0.36 / 1          |
| haunter (93)    | 45 / 95 / 16            | 110 / 4.384 / 0.379 / 1.053  |
| gengar (94)     | 60 / 110 / 15           | 127 / 4.548 / 0.373 / 1.036  |
| dratini (147)   | 41 / 50 / 18            | 103 / 3.9 / 0.36 / 1         |
| dragonair (148) | 61 / 70 / 40            | 126 / 4.242 / 0.44 / 1.221   |
| dragonite (149) | 91 / 80 / 22            | 153 / 4.386 / 0.379 / 1.051  |
| machop (66)     | 70 / 35 / 8             | 125 / 3.6 / 0.36 / 1         |
| machoke (67)    | 80 / 45 / 15            | 134 / 3.833 / 0.421 / 1.17   |
| machamp (68)    | 90 / 55 / 16            | 142 / 4.031 / 0.428 / 1.189  |

鬼斯线全程 ghost/poison；迷你龙/哈克龙 dragon，快龙 dragon/flying；腕力线 fighting。全部沿用玩家现有地面机动契约；幽影表现通过闪避事件而非穿地形或无敌分支。

### 连击与模型

`combo` 是唯一新原型：施放时锁定前向，按固定间隔产生同向扇形命中，各拳跟随玩家位置；首拳有 0.08 s 前摇，拳间 0.14 s，最后一拳伤害 ×1.6、击退 5，其他拳击退 0.4。拳数来自 count，升级加拳；不能用 strike 的前后交替鞭击冒充。复用 Area 的 count/released 表达末拳，不添加玩家持久状态。

毒与灼伤分别保留最强施加伤害、刷新占用而不按弹数叠层。模型使用同一状态定义估算毒伤，显式保留状态占用和近战接敌率近似；诅咒易伤根据占用估算，避免把纯伤害数字当真实通关验收。

## VFX/audio handoff

以下 ID 已固定，可以据此开始制作。数值为无升级的几何/时间；最终伤害与冷却以源码为准。投射物 life 为发射后寿命；范围 life 包含 delay；升级可改变 area/dur/count，画面读取正式实例。所有命中时点以 30 Hz 模拟事件为准。

| move id（名称）           | archetype / 命中形状            | delay / life / radius 或 length（秒/u）                                                                                                                                            | 外观与音频意图                                                                             |
| ------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| shadow-ball 暗影球        | homing / 球                     | 0；life 1.5；r .24；speed 14                                                                                                                                                       | 紫黑压缩幽灵球，短尾，空洞轻击                                                             |
| smog 浊雾                 | vortex / 圆                     | delay .25；life 2.25；r 1.5；每 .3 tick                                                                                                                                            | 紫绿毒雾涡旋，收缩毒爆，低声气流                                                           |
| hex 祸不单行              | smite / 圆                      | delay .4；life .65；r 1.5                                                                                                                                                          | 地面幽灵咒印后向内刺爆；延迟命中音                                                         |
| sludge-bomb 污泥炸弹      | lob / 落点圆                    | 飞行 .75；弹r .25；爆r 1.6                                                                                                                                                         | 暗紫毒团弧线，落地黏液溅散                                                                 |
| night-shade 黑夜魔影      | nova / 周身圆                   | delay 0；life .3；r 2.3                                                                                                                                                            | 影子向外掠过，短促低频冲击                                                                 |
| dream-eater 食梦          | drain / 追踪球                  | delay 0；life 1.5；r .23；speed 12                                                                                                                                                 | 紫红幽光追击；吸取碎光回流                                                                 |
| dragon-breath 龙息        | bolt / 穿透球                   | delay 0；life 1.2；r .24；speed 18；pierce 2                                                                                                                                       | 蓝紫细长龙息，连续贯穿脆响                                                                 |
| twister 龙卷风            | vortex / 圆                     | delay .25；life 2.05；r 1.45；每 .3 tick                                                                                                                                           | 窄风柱卷起碎屑，风切声                                                                     |
| dragon-pulse 龙之波动     | beam / 直线                     | delay .3；life 1.05；width .65；length 17；每 .15 tick                                                                                                                             | 蓝紫龙形窄光束，蓄力后贯穿                                                                 |
| dragon-rush 龙之俯冲      | wave / 移动带                   | delay 0；life 1；横向半宽1.3；纵深半宽.5；speed 10                                                                                                                                 | 龙首冲击波向前推进；不移动玩家本体                                                         |
| aqua-tail 水流尾          | strike / 交替扇形               | 每拳 delay i×.12；life .22+delay；length 2.5；半角1.2                                                                                                                              | 尾扫水弧，清脆水鞭                                                                         |
| hurricane 暴风            | smite / 圆                      | delay .65；life .9；r 1.6；count 2                                                                                                                                                 | 两处风眼锁定后垂直爆风                                                                     |
| karate-chop 空手劈        | combo / 前向扇形                | delay .08+i×.14；life delay+.16；length 2.4；半角.8；count 2                                                                                                                       | 两记短掌刃，末击更重                                                                       |
| low-sweep 下盘踢          | spin / 随身圆                   | delay 0；life .65；r 2；每 .3 tick                                                                                                                                                 | 低位腿扫与土尘环，缠根减速                                                                 |
| brick-break 劈瓦          | combo / 前向扇形                | 同 combo；length 2.6；count 3                                                                                                                                                      | 三段橙白拳压，末击破碎感                                                                   |
| focus-blast 真气弹        | orb / 球与爆炸圆                | delay 0；life 1.4；弹r .3；爆r1.5；speed10                                                                                                                                         | 橙白凝气球，沉重气爆                                                                       |
| seismic-toss 地球上投     | nova / 周身圆                   | delay 0；life .3；r 2.3                                                                                                                                                            | 踏地上掀震荡；不移动敌人高度                                                               |
| cross-chop 十字劈         | combo / 前向扇形                | 同 combo；length 2.5；count 2                                                                                                                                                      | 交叉掌刃，末击 X 形短闪                                                                    |
| nightmare-vortex 噩梦漩涡 | firestorm / 涡旋+喷流+螺旋+爆炸 | delay .3；持续2；r1.1；继承 FIRESTORM 几何                                                                                                                                         | 幽灵咒印涡旋，紫色火舌；禁止直接复用火焰橙色                                               |
| dragon-tempest 苍龙风暴   | tempest / 多道光束+各自终爆     | delay .45+i×.04；持续 .9×dur；每束 width .7、length8，起于身周 r1.1 风暴缘；束数=⌊数量⌋（基础2，上限12），各指不同敌人（间隔≥.38rad），不足时从风暴缘扇开汇向主目标；每束终爆 r1.4 | 风暴缘龙卷聚气后喷出 N 道龙脉，金/青双股风旋缠绕，束头青光与龙星终爆；数量升级必须多出一束 |
| hundred-fists 百裂拳      | combo / 前向扇形                | 同 combo；length2.8；count4（融合后加继承拳数）                                                                                                                                    | 密集四臂残影；末击短暂停顿感，避免每拳叠大爆炸                                             |

终极技均复用 `Pulse`，使用既有 look 字段（由 type 区分视觉语言），不增加新事件结构；具体多档时序见 `content/ultimates.ts`：

| ultimate id     | 基础与升级阶段的形状/时点                                                                                                      | 外观/声音                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| phantom-night   | t0 ring r3.2/4/4.8 curse；t .4 至2.0 每.4 ring r2.8/3.4/4 poison；第二档加 t2.2 ring r4；第三档 t2.2 strike count4 r1.5 range7 | 先深紫咒圈，随后五次幽毒脉冲，终段幽影合拢；look ring/embers/blast/meteor |
| draco-meteor    | t0 lines count3/5/7 length8/10/12 halfwidth.5；t .45/.9/1.35 strikes count1/2/3 r1.5 range9；第三档 t1.8 ring r4               | 蓝紫龙脉放射与落星，不画火焰陨石；look roots/meteor/blast                 |
| seismic-barrage | t0/.22/.44 rings r2.5/2.8/3.1；第二档再 .66/.88；第三档再1.1/1.32；终击为最后一拳后.22，r3.2/3.6/4，knock7                     | 米白拳影与橙色冲击环，逐拳短重音，末击碎岩；look ring/blast               |

模型：补齐九个 `formModels` 条目与实测动画参数；缺资产应由已有 preparation 错误表面明确失败，不用敌人实例静默替代。VFX：新增 combo 的默认样式和区域绘制，注册 21 个 move look 与三套终极技元素外观。音频：按命中关键帧绑定，低音量连击避免密集叠加。UI：starterOrder 追加 gastly/dratini/machop，现有解锁表没有条目即初始可选；图鉴读取注册表。

具体编译接线：`src/run/view/vfx/defaults.ts` 的 shot 默认表增加 `combo: null`，area 默认表增加 combo 扇形；`src/run/view/vfx/ultimates.ts` 的配色表加入 `phantom-night`、`draco-meteor`、`seismic-barrage`。连击实例 `Area.released` 是该拳的零起算序号，`Area.count` 是总拳数，末拳满足 `released === count - 1`；所有拳共享锁定方向，视觉在 delay 内只预备、命中后 linger .16 s。此表由 VFX 代理实施，不由模拟代理编辑。

## Risks / Trade-offs

- [近战解析近似] → 比较同一接敌率，并用模拟测试验证锁向、前摇与末击；真人走位留给整合验收。
- [新属性克制改变不同地图表现] → 三难度连续路线加固定构筑对照，不只调森林单体数字。
- [毒与咒模型缺口] → 只补真实新增机制，保留假设说明；旧线 golden 用原值核对。
- [并行资产未完成] → 不跨所有权写模型/VFX/大厅，报告明确未完成接线。
