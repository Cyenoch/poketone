# 地图生成与排查

地图的可玩性、失败和区域行为只在 [world-progression](../openspec/specs/world-progression/spec.md) 维护。本页说明如何生成和定位问题；各图名单、尺寸和数值由 [stages](../src/run/sim/content/stages/index.ts) 定义，不抄白盒时期的占位内容。

## 流水线

```
resolveLayout(seed, spec)    布局：可选楼层模板、通道与图章，整体取正方形的 8 种旋转/镜像之一；每条坡道各加一条通道
createTerrain(seed, spec, passages)
                             基础高度场 → 梯田（缓坡与陡崖混合，坡度双峰；通道内一律用最宽的缓坡）→ 3×3 模糊
applyStamps                  图章：台地、环形岩丘（带显式缓坡）、沟槽（通道处留堤道）叠在梯田上
buildWalls                   有模板时，把旋转后的墙/柱/墓碑落到最终墙格；选址导航先登记墙格阻挡
buildSurface                 静态水位/熔岩水位先进入选址导航，地块不得占用液体
placePads                    在基础地形上挑平整地块（不压通道），压平，边缘 3 单位平滑过渡
placePuddles                 先定每张图的一组轮廓（一个主水体 + 各种小水洼），由大到小挖进最低的平缓处，水线正好落在设计的轮廓上
buildSurface                 最终高度场生成统一水深/熔岩深度，交给最终导航和视图
placeProps                   岩石、树、灌木、场外的墙；避开地块、水洼、出生空地和陡坡，实体道具不压通道
validateMap                  在最终地形（重新建的导航）上逐条复查地形保证，违反就抛错
装配导航                      最终地形的导航登记实体道具阻挡，交给世界（不再重建）
createWorld → furnishMap     放站点（也是阻挡），然后在最终导航上做可玩性验收（checkPlayable）
```

通道、图章和地块先表达作者意图；水体与道具依次装配。选址用中间导航筛选，站点/道具/墙全部安装后的最终导航才交给可玩性检查。每区重新生成独立场地恢复探索价值，不只是把时间重置。

入口从 [mapgen](../src/run/sim/mapgen/index.ts) 追到 [world](../src/run/sim/world.ts) 与 [zones](../src/run/sim/zones.ts)。地图和布局各用自己的种子流，不从玩法随机流借数；重试与调度边界按源码维护，不另造后台分支。

## 调整规格

先查 `MapSpec` 与该图/区的配置。修改模板时检查旋转/镜像后的墙格、通道、坡道和地标；修改液面时同步看 [surface](../src/run/sim/surface.ts) 的深度/类型采样及导航机动类别，不能只改shader外观。

塔层使用自己的内容与模板；六图都有正式入口，不再借森林名单作为当前说明。地面、游泳、两栖和飞行层分别按机动配置生成。冰面滑移属于玩家移动规则，水域与熔岩作用属于地表规则，不能从旧白盒报告推出“尚未实现”。

## 失败定位

1. 记录种子、地图/区域、构建身份和实际错误。
2. 区分中间选址失败、最终地形保证失败与安装全部阻挡后的 `checkPlayable` 失败。
3. 检查真实最大身体在出生点、站点交互圈、地标及必需通道能否往返；单看中心格可达不足以定位问题。
4. 用 [导航手册](NAVIGATION.md) 查 `routeReach` / `bodyFits` / 墙格与流场，使用独立诊断缓冲，不让可视化改变正式模拟。

不要通过删必需内容或跳过最终检查让种子“通过”。海岸导航快照恢复（见 [模拟地图 I03](state-machines/simulation.md#i03)）与本机地图生成成功是两个边界。

## 验证入口

```sh
bun test scripts/mapgen.test.mjs scripts/nav.test.mjs scripts/stations.test.mjs scripts/zones.test.mjs
```

按实际修改选择聚焦检查；大种子扫描和正式页面检查在对应change中记录，不在手册继续追加阶段任务或通过数量。
