# 玩法数值入口

AI Agent 从这里定位所有可调玩法数据。内容表和参数都在本目录，消费者直接导入所属文件；公式、状态转换、随机调用与运行缓存留在执行模块。行为契约见 [balance-tuning](../../../../openspec/specs/balance-tuning/spec.md)，分析方法见 [平衡手册](../../../../docs/BALANCE.md)。本页只维护索引，不复制数值表。

## 改什么 → 去哪

以下路径均相对本目录。完整条目在内容文件，跨条目共享参数在 `params/`。

| 领域                 | 唯一数据入口                                                        | 作用与主要消费者                                                                                                         |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 基础形态、进化与被动 | `lines/*.ts`、`abilities.ts`                                        | 属性、体型、进化门槛、被动；stats/evolution/图鉴                                                                         |
| 玩家战斗与机动       | `params/player.ts`、`params/combat.ts`                              | 属性上限、伤害/击退、冲刺、无敌、攻击高度/视线；world/hurt/movement/sight                                                |
| 普通怪、精英与头目   | `enemies.ts`、`difficulties.ts`、`params/pacing.ts`                 | 物种基础属性、难度、生命曲线、头目倍率、刷新/容量/暴走；director/beats/模型                                              |
| 动态增援压力         | `params/pacing.ts` 的 `DIRECTOR_PRESSURE`                           | 邻近半径/权重、受伤记忆秒数、平滑秒数、供给上下限和开局/入区缓冲；director-pressure/模型                                 |
| 区域与楼层承接       | `params/zones.ts`                                                   | 区域倍率、原成长时钟和敌人生命时钟下限；director/partners/模型                                                           |
| 敌人技能与走位       | `params/enemy-skills.ts`、`params/enemy-motion.ts`                  | 预警、阶段时间、范围、弹速、伤害份额、追击/绕行；skills/enemies/movement/VFX/模型                                        |
| 守卫与后区危险物     | `params/guardian.ts`、`params/late-zones.ts`、`params/zones.ts`     | 连段、阶段、命中几何、伤害倍率、风场/喷发；后图守卫强化（追击加速、追加落点节拍、固定属性基准）；bosses/hazards/VFX/模型 |
| 招式与融合           | `moves.ts`、`fusions.ts`、`params/moves.ts`、`params/archetypes.ts` | 基础伤害/冷却、融合配方、形状/命中/选敌；attacks/archetypes/模型/VFX                                                     |
| 属性、状态与元素反应 | `elements.ts`、`statuses.ts`、`reactions.ts`                        | 克制、持续效果、反应伤害与消费；combat/status/模型/图鉴                                                                  |
| 道具与触发效果       | `items.ts`、`triggers.ts`、`params/trigger-runtime.ts`              | 道具成长、概率、触发参数及共用击退/标记；triggers/stats/模型                                                             |
| 选卡与构筑           | `params/cards.ts`                                                   | 权重、稀有度、升级/融合上限、幸运、保底与训练；upgrades/模型/GPU选卡                                                     |
| 同伴                 | `params/partners.ts`                                                | 捕获、栏位、护主、跟随与攻击；partners/模型/VFX                                                                          |
| 终极技               | `ultimates.ts`、`params/ultimates.ts`                               | 各档脉冲时间线、充能、伤害与无敌；ultimates/模型/VFX/图鉴                                                                |
| 地图与刷怪编排       | `stages/*.ts`、`stages/beatTemplates.ts`                            | 区域敌池、时间线、地图布局/地表生成输入、守卫；mapgen/director/模型                                                      |
| 地表与机动类别       | `mobility.ts`、`params/environment.ts`                              | 爬坡/降落/水域资格、涉水深度、熔岩/流沙/冰面；nav/surface/movement/VFX                                                   |
| 站点                 | `stations.ts`、`params/stations.ts`                                 | 服务费用/成长、碰撞体与操作距离；stations/mapgen/图鉴                                                                    |
| 掉落与拾取           | `params/economy.ts`                                                 | 星星沙子、树果、经验份数/散布、吸附速度与收集距离；combat/world/模型                                                     |
| 研究与局外成长       | `lab.ts`、`params/economy.ts`、`params/progression.ts`              | 研究条目与费用、角色解锁、背包容量、经验级别偏移；run/lab/progress/stats                                                 |
| 多人                 | `params/coop.ts`                                                    | 固定席位人数倍率、救援距离/时长/恢复；director/rescue/world/模型                                                         |

六关路线与每关时限、成长基线见 `campaign.ts`、`params/campaign.ts`；各图旧区域名单合并为一场渐进内容，正式 `stageDefs` 每图仅一项。预判物种系数、提前量上限和选择性躲避的反应/距离/冷却见 `params/enemy-ai.ts`，决策只读已发生运动和已存在攻击；同一快照继续推进可复现。

道具容量由 `params/cards.ts` 的基础与最大栏位定义；研究所 `slot-vit` 的四级上限由两者之差生成，购买价格见 `params/economy.ts`。候选、HUD 与模型读取同一玩家容量，学习器盒独立。

## 生命调优的边界

- `HP_CURVE` 是共享基础成长，**也影响同伴输出**。只想改敌人生命时，改 `ENEMY_HEALTH`；不要直接增强共享曲线。
- `ENEMY_HEALTH` 的早期/后期增幅使用敌人生命时钟。`ALPHA_HP` 在同期精英基础上额外相乘，只作用头目；普通精英不叠加头目倍率。
- `GUARDIAN_HP` 使用守卫独立曲线，不叠加怪群增幅；生命、伤害和速度统一按 `GUARDIAN_REFERENCE_SECONDS` 校准，与实际召唤时间和玩家战力无关。
- `CAMPAIGN_HP_CLOCK` 给后续地图固定的生命成长下限。`zoneClock` 仍管伤害、速度、刷新、事件和同伴，不能为修复生命回落而改动所有时钟。
- 地图 `enemyHp`、路线、难度、人数倍率各自应用一次。比较时注明地图、区域、区内时间、席位数和难度。
- 生命在敌人出生时确定；修改曲线不会给已在场的敌人实时补血。模型采用聚合近似，不能把其平均怪等同于场上每一只。
- `DIRECTOR_PRESSURE` 只调普通增援，不改生命或容量；压力越高供给越低。它与模型中越高越易清场的 `pressure`（清怪供需比）不是同一指标。改供给会改变经验收入，须复算完整成长。

## 单位与相互影响

时间用秒，`tick` 单独注明；距离为世界单位 u，角度为弧度，速率通常为每秒。字段旁的说明区分绝对伤害、基础伤害份额、概率、速度和倍数。修改有阶段的技能时，一起检查准备、活动、残留和再次触发的时间关系。

属性合成为 `(base + Σadd) × (1 + Σpct) × Πmul ÷ Πdiv + Σextra`。同样是冷却降低，升级卡记录减少份额，道具乘数记录保留份额；先看 `content/effects.ts` 与相应字段说明，不能混填。

经验收入同时受刷怪、物种经验、区域、人数、拾取和构筑影响；改变经验曲线会移动进化与选卡出现时点。生命增加虽然不改掉落定义，仍可能降低击杀与升级速度，因此要检查完整成长，而不只是固定构筑的耗时。

## AI 调整流程

1. 先固定基线提交、地图/区域、种子、难度、伙伴、研究所、背包和席位数；定位上表的数据源及消费者。
2. 用 OpenSpec 记录行为变化。只整理数据时保持数值、顺序、随机消耗与公式运算顺序，先通过原 golden；不得重录掩盖搬迁差异。
3. 修改对应数据和必要公式；模型、画面预警、碰撞和图鉴读取同一来源。新增头目生命不能让模型多算击杀、经验或宝箱。
4. 运行相关现有测试、类型检查，以及同条件前后成长分析。实际行为有意改变时，说明原因后更新回放；记录模型假设、受控夹具及正式游玩的区别。
5. 实验数字只放日期 QA。验证完成后同步 OpenSpec，不在本索引或手册复制当前参数值。

## 不属于玩法调参的数据

寻路/网格预算、缓存容量、快照版本、容差、种子混合、固定步长及数值算法常数仍由所属工程模块维护；它们不能被当成难度旋钮。几何换算、数组索引、必然命中和初始值不机械提取。地形生成的算法系数与镜头投影公式留在实现，地图可调输入在 `stages`。

纯视觉颜色、动画、布局、音频混音与设备参数留在各自领域。`src/run/balance/` 的玩家水平、命中/拾取近似、预算和目标区间是**分析假设**，不作为运行时玩法参数或阻塞门禁。
