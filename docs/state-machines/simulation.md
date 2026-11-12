# 玩法与模拟状态机

基线与阅读方法见 [总清单](../STATE-MACHINES.md)。本页覆盖sim全目录与createRun世界/对局边界：170个文件（169个TS、1个README）、25,607行。118个分解条目包括共享骨架、物种分支与并行子机器，不是118个独立系统。注册覆盖矩阵保留在附录。

独立状态机盘点本身只读源码；主线程随后对导航快照和熔岩DoT做了聚焦复现（审计23、24）。其余静态候选不冒充已复现问题。

2026-11-10 增量更新：正式路线每图单关，跨图沿 Z 的准备/提交与在线屏障，只有塔关出口胜利；局部接口仍称 zone。

2026-11-08 已按修复 diff 更新开局提交、骰子初始化、环境归属与快照条目；初次扫描数量/行号保留，不表示全量重审。本次文档更新未跑模拟、golden 或正式页面；保存/激活最终接线仍待主线程审阅。

计入：跨 tick/命令/异步完成保存历史并改变后续可执行动作的字段组合；显式小 union 与隐式 timer/flag/数组成员资格一起列。并行子机器分列；物种只是同一执行器的数据参数时合组，并在末尾枚举。**不把每个数值计算、随机数公式、纯派生条件、普通同步循环或每个内容条目膨胀成一个机器。** 表内“逻辑态”是审计归纳，未声称代码存在对应 enum。

Owner 简写：除 [createRun.ts](../../src/run/createRun.ts) 指 [src/run/createRun.ts](../../src/run/createRun.ts) 外，其他源码路径均相对 `src/run/sim/`；测试路径相对 `scripts/`。行号为本次读取版本。“测试”表示既有测试源码关联定位（部分正文核对），**此次没有运行测试**；“间接”或“未见专测”不能理解为已覆盖整个机器。

公共生命周期（各行引用以下规则）：

- **F（冻结）**：[world.ts:391](../../src/run/sim/world.ts#L391) 先处理全部命令，再因 outcome 非 playing 或 `isFrozen` 返回；暂停、切区、单人可见卡/站点停止整个 sim 时间。多人选卡/站点不冻结全队。终局本身不清空各对象，也不是 `applyCommand` 的总 guard。
- **Q（清场）**：[zones.ts:71](../../src/run/sim/zones.ts#L71) 在 cleared 的 tick 尾复活倒下队友、磁吸掉落、清空敌人/弹体/area/hazard；不会运行这些对象的自然到期回调。若全员倒下，[world.ts:424](../../src/run/sim/world.ts#L424) 判负优先，跳过 sweep。
- **Z（换区）**：[zones.ts:147](../../src/run/sim/zones.ts#L147) 仅接受 transitioning 且 prepared.zone 为下一 index；重建地图/nav、清空场上对象、重置 zone tick/spawn/boss/rampage/RNG。保留全局 time/tick/nextId 和玩家成长、HP/盾、招式冷却、冲刺库存/回充、`fx/procs`、大招 charge/room、同伴及其冷却。清玩家 statuses、进行中大招、crossed；重定位并清输入/速度/dashTime/dialog/rescue，多人 choosing=false。站点按 **slot 且 kind 相同** 继承 id/used。
- **R（恢复）**：[snapshot.ts:26,41](../../src/run/sim/snapshot.ts#L26) 深拷贝动态普通数据，校验版本/mapDigest/有限数据，nav 按 continuation 重新构造；局部 closure、WeakMap、模块级 scratch 不进入快照。序列化通过不代表每个字段组合的语义都合法。
- **E（敌人共同取消）**：[enemies.ts:42](../../src/run/sim/enemies.ts#L42) 先表面、DoT/停止判定、decay，再技能/brain，再位移/接触/削减 stagger，最后移除 hp<=0。守卫受 interrupted 时重置 chase/phaseTime 并删 action/foresight（83）；普通敌人由具体 skill 自己处理。`attacksBlocked` 与 `interrupted` 不相同。所有场上机器遵守 F/Q/Z。

## 1. 世界、准备、结束与切区边界

<a id="w01"></a>

### W01 世界冻结原因

- **所有者/定位**：[world.ts:211,225,391](../../src/run/sim/world.ts#L211)
- **编码与逻辑状态**：`paused × outcome × zone.phase × players.{alive,choosing,pending,cardHold,dialog}`；running / explicit-pause / solo-choice / solo-station / transitioning / terminal（可以重叠）
- **守卫与转换**：pause 命令赋值；单人 cardShown 或 dialog 冻结；多人个人选择继续 sim；命令先于冻结 guard
- **终态/取消/恢复**：F；撤销对应冻结原因后恢复；R 原样携带
- **关键不变量**：一个“解除暂停”不能消除卡/站点/切区冻结；冻结时 time/tick 不增长，但命令仍可改变构筑
- **测试/风险**：[coop.test.mjs:49,82](../../scripts/coop.test.mjs#L49)、[stations.test.mjs:30](../../scripts/stations.test.mjs#L30)、[lab.test.mjs:232](../../scripts/lab.test.mjs#L232)。风险：不能把 frozen 简化为 paused；终局后直接调用 applyCommand 仍能 pick/ult/interact 等，终态吸收性部分依赖宿主停输入

<a id="w02"></a>

### W02 世界终局

- **所有者/定位**：[world.ts:230,420](../../src/run/sim/world.ts#L230)；[zones.ts:52](../../src/run/sim/zones.ts#L52)
- **编码与逻辑状态**：`outcome=playing/victory/defeat`，结合个人 revives、全队 alive
- **守卫与转换**：forfeit→defeat；伤害后个人复活→救援→全灭判负；塔关出口→victory；其他五图出口→下一地图
- **终态/取消/恢复**：终局停止后续 tick；没有自动清理场上数组；createRun 接管结算
- **关键不变量**：守卫与最后玩家同 tick 死亡判负；击败塔守卫只 cleared，必须离开才胜利
- **测试/风险**：[coop.test.mjs:195,399](../../scripts/coop.test.mjs#L195)、[zones.test.mjs:207](../../scripts/zones.test.mjs#L207)、[lab.test.mjs:209,232](../../scripts/lab.test.mjs#L209)。风险：不要把 clear、victory、reported 合为一个终态

<a id="w03"></a>

### W03 待选队列与卡片身份

- **所有者/定位**：[world.ts:547,571,260,370](../../src/run/sim/world.ts#L547)
- **编码与逻辑状态**：`pending[]`、front.options、card.id、choosing/cardHold；empty / queued-unrolled / rolled-front / visible / deferred / answered
- **守卫与转换**：XP 每跨一级或 chest 入队；只首卡 roll；pick/skip 消费首卡；reroll/banish 换新 id；多人 choices/interact 手动打开
- **终态/取消/恢复**：死亡保留 pending 但隐藏；revive 后可打开；Z 多人带队列、关闭 choosing；R 保留 id/options
- **关键不变量**：旧 id 不得回答新卡；后卡在前卡改变构筑后才 roll；站点不能在待选卡下改 kit
- **测试/风险**：[combat.test.mjs:402,980](../../scripts/combat.test.mjs#L402)、[coop.test.mjs:49,92](../../scripts/coop.test.mjs#L49)、[lab.test.mjs:114,135](../../scripts/lab.test.mjs#L114)。风险：pick guard 校验 id/index/alive，不要求 cardShown，显示状态不是 sim 权限条件

<a id="w04"></a>

### W04 单局构建和启动

- **所有者/定位**：[createRun.ts:396,959,1000,1078](../../src/run/createRun.ts#L396)
- **编码与逻辑状态**：`world/view/assets` 存在性，`started/failed/disposed/changingZone`、app.available/generation；constructing→world→assets→scene→GPU warm→sound/network-ready→started
- **守卫与转换**：首帧后建 world；compile/upload/draw；关键音频与 network.ready 完成后，首次开局先 callbacks.onReady（run session 的 onStarted 提交背包），成功且 current guard 通过才注册 app.setWorld 并置 started；context generation 失效重走 start
- **终态/取消/恢复**：disposed 各 await 后中止/释放，abort 资源请求；失败置 failed；context 不可用订阅等待恢复；Z 复用 start
- **关键不变量**：初次 started 前不推进 sim、不结算未开始局；背包保存拒绝使 onReady 抛错并进入 failed，世界不激活；准备等待不累积追赶 tick
- **测试/风险**：[ui-prepare.test.mjs:121,181,219,239,266](../../scripts/ui-prepare.test.mjs#L121) 是通用准备设施的**间接**覆盖，不是此 closure 实测。风险：多 flags 可构成非法组合；本次未做正式 Web/native 生命周期

<a id="w05"></a>

### W05 菜单/地图暂停意图

- **所有者/定位**：[createRun.ts:436,474,500,557,1223](../../src/run/createRun.ts#L436)
- **编码与逻辑状态**：`menuPaused/mapOpen` 与 `world.paused`；normal / map-paused / menu-paused / remote-paused
- **守卫与转换**：大地图仅在 playing 且无其他冻结时开；关闭地图仅撤销自身 pause；菜单优先；blur/context release 请求 pause
- **终态/取消/恢复**：关闭 map/menu 各自送 pause；context restore 只恢复 GPU，不自动取消菜单暂停；R world.pause 与本地 UI flags 来源不同
- **关键不变量**：menuPaused=true 时关地图不能误送 unpause；输入取消清动作队列并向 guest 发送零移动
- **测试/风险**：未见 createRun 大地图/菜单组合直接单测；网络/UI 测试仅相关。风险：一个 bool 承载共享暂停，多来源所有权由宿主/网络保证

<a id="w06"></a>

### W06 固定步进与命中停顿

- **所有者/定位**：[createRun.ts:563,758](../../src/run/createRun.ts#L563)
- **编码与逻辑状态**：`accumulator`、`hitStopUntil/Scale`、network host/suspended；normal-step / hit-stop / frozen-command-only / guest-apply / suspended
- **守卫与转换**：dt clamp；只主机/单人积累固定 TICK；最多 MAX_STEPS；frozen 仍执行命令；guest apply；suspended 清输入/累计并等地图
- **终态/取消/恢复**：Z resume 清 accumulator；失败/dispose/切区禁止 advance；真实时间 hit-stop 到点恢复
- **关键不变量**：等待/暂停不补算战斗；模拟与渲染时钟不同；一帧多个 step 只首 step 取命令
- **测试/风险**：[ui-run-activation.test.mjs](../../scripts/ui-run-activation.test.mjs) 以真实宿主/模拟、替代绘制验证受伤后固定步推进，以及受伤与必杀演出重合后的恢复；不是设备验收。风险：hit-stop 是宿主节拍，不进 world snapshot

<a id="w07"></a>

### W07 区域提交与准备屏障

- **所有者/定位**：[zones.ts:133,147](../../src/run/sim/zones.ts#L133)；[createRun.ts:824,1046](../../src/run/createRun.ts#L824)
- **编码与逻辑状态**：`zone.phase=transitioning`、prepared.zone、`changingZone`、incoming World；requested→assembling→committed→scene/warm/ready→active
- **守卫与转换**：出口置 transitioning；changeZone 单飞 guard；prepare 生成 scratch；enterZone 检查下一 index；guest incoming 整体替换；ready 才放开 changingZone
- **终态/取消/恢复**：失败走 fail，不能继续 tick；disposed 中止；R/网络新地图恢复；本地 old view 先 dispose
- **关键不变量**：prepare 不改 live world；新场景完成前即使 world.phase 已 active，也不能 advance；站点使用次数跨区
- **测试/风险**：[zones.test.mjs:130,187,207](../../scripts/zones.test.mjs#L130)、[coop.test.mjs:125,444](../../scripts/coop.test.mjs#L125)。风险：模拟提交先于 scene 成功；失败没有回滚旧地图，依靠 failed 停止

<a id="w08"></a>

### W08 尾声与一次上报

- **所有者/定位**：[createRun.ts:898,916,1177](../../src/run/createRun.ts#L898)
- **编码与逻辑状态**：`ended/reported/holdLeftMs/started/disposed`；playing→end-hold→reported→disposed
- **守卫与转换**：outcome 终局触发音效/hold；绘制帧耗尽 hold 后 onEnd；forfeit 立即 settle(false)；guest quit 后 report(defeat)
- **终态/取消/恢复**：report 一次锁；未 started 放弃不结算；dispose 无隐式结算；隐藏/context loss 不推进 hold
- **关键不变量**：ended 表示开始尾声，reported 表示已上报回调，不代表持久化成功；run/session 另以 result.saved 留存失败结果并重试，见 [UI-RUN-LEAVE](application-ui.md#ui-run-leave)
- **测试/风险**：[lab.test.mjs:232](../../scripts/lab.test.mjs#L232) 只验证 sim forfeit；[ui-run-session.test.mjs](../../scripts/ui-run-session.test.mjs) 为保存成败与导航的会话夹具，不等于本 closure 全转换或网络终局交付验收；最终整合由主线程收尾

<a id="w09"></a>

### W09 失败锁存与释放

- **所有者/定位**：[createRun.ts:506,1229](../../src/run/createRun.ts#L506)
- **编码与逻辑状态**：failed/disposed 两个单向 latch、abort、release 回调；live→failed（停止）/disposed（释放）
- **守卫与转换**：首次 fail 清队列/输入、网络失败通知、onError；dispose 置 latch 后取消订阅、释放音频/scene/assets
- **终态/取消/恢复**：不恢复 failed；context loss 使用 W04 的可恢复路径而不是 fail；dispose 幂等
- **关键不变量**：fail≠outcome defeat，不能伪造结算；释放次序影响后续 new run
- **测试/风险**：未见此 closure 直接异常路径单测。风险：清理链某一步抛错会截断其后释放；onError 的上层处理未审

<a id="w10"></a>

### W10 守卫召唤/暴走/出口

- **所有者/定位**：[director.ts:378,429](../../src/run/sim/director.ts#L378)；[currentZone.ts:42](../../src/run/sim/currentZone.ts#L42)；[zones.ts:31,71](../../src/run/sim/zones.ts#L31)
- **编码与逻辑状态**：`zone.phase,bossId,rampage`；未召唤→守卫存活→cleared/出口→transitioning 或 victory；rampage 是并行 latch
- **守卫与转换**：活跃地标且 bossId=null 主动召唤；zone 时间>=stage.duration 自动 rampage 并补召唤；boss kill clearZone
- **终态/取消/恢复**：Q 清场；Z 重置守卫/rampage；R 保留；clear 时已生成奖励后走普通拾取
- **关键不变量**：在正规 interact/director 入口每区一守卫；summonGuardian 本身不做重复 guard；守卫出生生命/伤害/速度使用固定参考时点，不读取局部召唤时刻或玩家战力；狂暴仍增强增援；清场无额外击杀/掉落
- **测试/风险**：[zones.test.mjs:57,102,130,394](../../scripts/zones.test.mjs#L57)。风险：直接调用 summonGuardian 绕过调用者 guard；rampage 清场后仍为 true 至 Z，不能单独用它判断战斗中

<a id="w11"></a>

### W11 掉落吸附与结算

- **所有者/定位**：[world.ts:474,505,529,536](../../src/run/sim/world.ts#L474)
- **编码与逻辑状态**：pickup array、`magnet/kind/value`；ground→homing→collected；XP 可并堆
- **守卫与转换**：非 chest 进入吸取半径开 magnet；clear 全开；距离<=0.8 结算移除；出口立即收剩余；>260 合并未磁吸 XP
- **终态/取消/恢复**：Z 不带 pickups，离开前结清；全灭后停止；R 带磁吸/当前位置
- **关键不变量**：XP/chest/stardust 发给全队（包括倒地），berry 仅最近活人；同一物体只一次 credit
- **测试/风险**：[coop.test.mjs:92,330](../../scripts/coop.test.mjs#L92)、[zones.test.mjs:394,444](../../scripts/zones.test.mjs#L394)、[lab.test.mjs:191,209](../../scripts/lab.test.mjs#L191)。风险：最后出口结清会新排卡，此时可直接 victory；这是清场奖励与选卡的接缝

## 2. 玩家生命、动作、成长与站点

<a id="p01"></a>

### P01 玩家倒地/保命/复活

- **所有者/定位**：[hurt.ts:15](../../src/run/sim/hurt.ts#L15)；[world.ts:377,420](../../src/run/sim/world.ts#L377)；[rescue.ts:35](../../src/run/sim/rescue.ts#L35)
- **编码与逻辑状态**：hp/alive/revives/ult.elapsed/dialog/choosing；alive→lethal-check→saved 或 down→personal/team revive；全队 down→defeat
- **守卫与转换**：伤害经过无敌/闪避/盾；hp<=0先 lethalSave；否则 alive=false；tick 尾 revives>0 先个人复活；清场/救援可团队复活
- **终态/取消/恢复**：死亡清 dialog、多人 choosing、大招；保留构筑、卡、fx、既存攻击；revive 清 statuses；Z/Q/F/R 见公共规则
- **关键不变量**：down 的 hp=0；个人复活优先于救援；死亡不自动删除已发射的弹体/area
- **测试/风险**：[survival-items.test.mjs:35,46](../../scripts/survival-items.test.mjs#L35)、[coop.test.mjs:195](../../scripts/coop.test.mjs#L195)、[lab.test.mjs:244](../../scripts/lab.test.mjs#L244)。风险：`alive` 不是所有伤害来源的统一 owner guard，已释放攻击可继续击杀/充能

<a id="p02"></a>

### P02 移动/冰面/救援停止

- **所有者/定位**：[player-movement.ts:16,50,72](../../src/run/sim/player-movement.ts#L16)
- **编码与逻辑状态**：input/vx/vz/moving/dashTime/onIce；idle / accelerating / walking / braking / ice-drift / dashing / rescue-or-down stop
- **守卫与转换**：move 归一化并清 rescue；velocity 向输入收敛；冰面换惯性分支；dashTime>0 优先；无输入且冰上速度<0.01 归零
- **终态/取消/恢复**：down/rescue movePlayer 清速度与 dash；installField 清输入/速度；F 停计时；R 保留动力学
- **关键不变量**：画面只读 moving；dash 瞬间速度优先于 walking slow；表面 speed 仍通过 mover 应用
- **测试/风险**：[coop.test.mjs:218](../../scripts/coop.test.mjs#L218)、[late-zones.test.mjs:183](../../scripts/late-zones.test.mjs#L183)、[nav.test.mjs:450](../../scripts/nav.test.mjs#L450)。风险：死亡时 updatePlayer 提前 return，某些运动字段要靠其他路径/复活时清理

<a id="p03"></a>

### P03 冲刺库存与回充

- **所有者/定位**：[player-movement.ts:29,117](../../src/run/sim/player-movement.ts#L29)
- **编码与逻辑状态**：dashes/dashCooldown/dashTime；full / missing-charges-recharging / depleted，并行 dash active
- **守卫与转换**：alive、库存>0、未 frozen 接受 dash；减库存，首缺口启动回充；每 cooldown 只回一格；full→timer=0
- **终态/取消/恢复**：跨区取消 dashTime、保留库存/回充；死亡不回充；恢复后继续；救援启动取消 dash
- **关键不变量**：0<=dashes<=当前容量（recharge 时 clamp）；重复 dash 可以连续花多格重置 dashTime
- **测试/风险**：[items.test.mjs:58](../../scripts/items.test.mjs#L58)、[coop.test.mjs:218](../../scripts/coop.test.mjs#L218)。风险：无“dashTime>0 不许再 dash”guard，是允许连冲而非去抖

<a id="p04"></a>

### P04 无敌帧与护盾恢复

- **所有者/定位**：[hurt.ts:15,86](../../src/run/sim/hurt.ts#L15)；[world.ts:436](../../src/run/sim/world.ts#L436)
- **编码与逻辑状态**：invulnerable/hurt/shield/lastHurt；vulnerable / iframe / dashing-immune；shield full / damaged-wait / refilling
- **守卫与转换**：受击/闪避写 iframe；dash 直接免伤；进化/大招/救援/护主抬高无敌；无伤够 SHIELD.delay 后 refill
- **终态/取消/恢复**：F 停衰减；down 的 timer 停；Z 保留 shield/lastHurt/iframe；R 保留
- **关键不变量**：护盾先于 HP；shield<=属性上限由更新 clamp；真实落地 hit 才更新 lastHurt/断救援
- **测试/风险**：[items.test.mjs:30](../../scripts/items.test.mjs#L30)、[partners.test.mjs:219](../../scripts/partners.test.mjs#L219)、[survival-items.test.mjs:59](../../scripts/survival-items.test.mjs#L59)。风险：护盾恢复按 world.time，和本地 fx 倒计时并非同一种时间

<a id="p05"></a>

### P05 救援引导

- **所有者/定位**：[rescue.ts:8,24,59](../../src/run/sim/rescue.ts#L8)
- **编码与逻辑状态**：`rescue=null/{target,elapsed}`；idle / nearby-eligible / channeling / completed / cancelled
- **守卫与转换**：最近无个人复活的倒地队友；救援者 alive、无 dialog/choosing、零输入才能开始；每 tick 核对目标/距离；elapsed 足额 revive
- **终态/取消/恢复**：move非零/dash/ult/再次interact/真实受伤/选卡/越距/目标复活/死亡/换区取消；开始救援取消大招；R 可续读条
- **关键不变量**：多名救援者不叠加速度；伤害处理先于最终完成 tick；channel 时普通招式/trigger tick/ult 不更新
- **测试/风险**：[coop.test.mjs:168,195,399,425](../../scripts/coop.test.mjs#L168)。风险：暂停、救援分别停止哪些 timer 不同；某些 fx 在救援期间暂停，但 procWindow 继续走

<a id="p06"></a>

### P06 成长/进化/延迟选卡

- **所有者/定位**：[evolution.ts:18,33](../../src/run/sim/evolution.ts#L18)；[world.ts:571](../../src/run/sim/world.ts#L571)
- **编码与逻辑状态**：`level/xp/xpNext/stage/cardHold/invulnerable`；积累→升级→未到门槛/成熟/进化→卡延后→可选
- **守卫与转换**：while xp>=xpNext 可一次跨多级；stageFor 找最高已达阶段；只 stage 增长；进化在 roll 卡之前
- **终态/取消/恢复**：死亡者仍分 XP、stage 成长，但 gainXp 把其 hp压回0；多人 cardHold立即0；Z/R保留成长与剩余 hold
- **关键不变量**：stage 单调；成熟可不换 form；大招运行 stage 锁在施放时，不能随进化改 timeline
- **测试/风险**：[evolution.test.mjs:46,71,85](../../scripts/evolution.test.mjs#L46)、[coop.test.mjs:92](../../scripts/coop.test.mjs#L92)。风险：cardHold 与无敌复用同一时长不是同一状态，不能删掉其一

<a id="p07"></a>

### P07 构筑资格和封顶

- **所有者/定位**：[upgrades.ts:174,183,263,340](../../src/run/sim/upgrades.ts#L174)
- **编码与逻辑状态**：moves/items level、slot、tmCase、banished/training；unlearned-locked / offerable / owned / capped / banished
- **守卫与转换**：等级/阶段解锁；卡消费教招/升级；TM case 单向开启 cap；候选不足用 train 填；同伴属性改变道具供给
- **终态/取消/恢复**：构筑与 banished 跨区/死亡/R；forget/fuse 移除旧招并放逐；new run 重置
- **关键不变量**：pending front 是命令入口的可信候选；applyChoice 本身只对部分契约硬校验；TM case 每局最多一次
- **测试/风险**：[evolution.test.mjs:85,103,120](../../scripts/evolution.test.mjs#L85)、[stations.test.mjs:179,199](../../scripts/stations.test.mjs#L179)、[lab.test.mjs:91,114](../../scripts/lab.test.mjs#L91)。风险：卡数据与直接 applyChoice 并非同一信任边界；纯 rarity/伤害系数未单独列为机器

<a id="p08"></a>

### P08 站点会话

- **所有者/定位**：[stations.ts:37,46,61](../../src/run/sim/stations.ts#L37)；[world.ts:305](../../src/run/sim/world.ts#L305)
- **编码与逻辑状态**：`dialog=null/{id,station}` + station.kind/used + pending；outside/near/open/answered/closed/used
- **守卫与转换**：interact alive、无 dialog、无 pending，且在范围内；forget/fuse/leave 校验 dialog id 和站点类型
- **终态/取消/恢复**：leave/death/Z 清 dialog；单人 open 冻结，多人不冻；R 保留站点/对话 id
- **关键不变量**：旧对话 id不能操作新对话；有 pending 时不得改 kit；“可打开”和“能使用”分别判断
- **测试/风险**：[stations.test.mjs:30,105,123](../../scripts/stations.test.mjs#L30)、[coop.test.mjs:125](../../scripts/coop.test.mjs#L125)。风险：多人开窗后移远仍保留 dialog，提交不重新测距离；不能推断窗口自动锁玩家位置

<a id="p09"></a>

### P09 融合材料与使用资格

- **所有者/定位**：[fusion.ts:21,57](../../src/run/sim/fusion.ts#L21)；[world.ts:317](../../src/run/sim/world.ts#L317)；[zones.ts:109](../../src/run/sim/zones.ts#L109)
- **编码与逻辑状态**：pair owned/level、station.used[player]、fused move；not-ready→ready-unused→fused-used
- **守卫与转换**：两招达到 MAX_MOVE_LEVEL、Bill对话匹配、无 pending、未使用→替换较早槽、合并 mods、放逐原料、used追加
- **终态/取消/恢复**：跨区按站点槽/类型继承 used；R保留；融合成功关窗；不能再次融合
- **关键不变量**：每玩家每个对应 Bill 身份只一次；释放一槽，原招式的场上弹体/area不立即删
- **测试/风险**：[stations.test.mjs:140,238](../../scripts/stations.test.mjs#L140)、[coop.test.mjs:125](../../scripts/coop.test.mjs#L125)。风险：以后改变站点排序或数量会影响 once-per-run 身份；不是由全局 player.fused 编码

<a id="p10"></a>

### P10 遗忘/放逐/退款

- **所有者/定位**：[stations.ts:75](../../src/run/sim/stations.ts#L75)；[world.ts:305](../../src/run/sim/world.ts#L305)
- **编码与逻辑状态**：owned→forgotten+banished+refund；move 最后一格保护
- **守卫与转换**：找到目标，move数>1；移除、banished、立即按最新 stats 退款；item 移除后 clamp HP
- **终态/取消/恢复**：dialog保持；跨区/复活不恢复忘掉内容；既存弹体/area与 fx 残余不清
- **关键不变量**：不可忘最后招；同一个已移除 id 重复请求不重复退款；卡队列未清前禁止
- **测试/风险**：[stations.test.mjs:71,105,123](../../scripts/stations.test.mjs#L71)。风险：item fx 是孤立残余字典，只有仍拥有的 trigger 被迭代；删除道具不主动擦 key

## 3. 玩家招式、弹体、Area 与终极技

<a id="a01"></a>

### A01 自动攻击冷却与等目标

- **所有者/定位**：[attacks.ts:35](../../src/run/sim/attacks.ts#L35)；[upgrades.ts:209](../../src/run/sim/upgrades.ts#L209)；[createRun.ts:260](../../src/run/createRun.ts#L260)
- **编码与逻辑状态**：MoveState.cooldown/waiting；initial-cooldown→ready→waiting-target 或 cooling
- **守卫与转换**：cooldown<=0 尝试 cast；cast false→0.2s重试且 waiting=true；成功删 waiting、设完整 cd
- **终态/取消/恢复**：alive且非 rescue 的 owner 才更新新施放；F停；Z/R保留；forget/fuse替换 state
- **关键不变量**：waiting 的HUD就绪度=1，即使 cooldown>0；无目标不花整个冷却
- **测试/风险**：[archetypes.test.mjs:258](../../scripts/archetypes.test.mjs#L258)、全招式 `:249`。风险：重置 cooldown 的 trigger 不同时删 waiting，表现要按二者组合读

<a id="a02"></a>

### A02 弹体等待/碰撞/寿命

- **所有者/定位**：[attacks.ts:60](../../src/run/sim/attacks.ts#L60)；[archetypes/kit.ts:185,308](../../src/run/sim/archetypes/kit.ts#L185)
- **编码与逻辑状态**：Projectile.delay/life/hit/pierce；queued-follow-owner→flying→piercing/spent/cover/expired→removed
- **守卫与转换**：delay>0只扣 delay并跟随owner，释放后life才扣；命中未在hit内的敌人；命中数>pierce终止；cover置life=0
- **终态/取消/恢复**：Q/Z硬删；死亡/forget不取消已创建对象；R保留；owner删除并非受支持契约
- **关键不变量**：同一弹体同一敌人最多记一次；延迟时不耗飞行寿命；已命中过的id跨恢复存在
- **测试/风险**：[combat.test.mjs:182,202,224,640](../../scripts/combat.test.mjs#L182)、[archetypes.test.mjs:249](../../scripts/archetypes.test.mjs#L249)。实现：[archetypes/bolt.ts:20](../../src/run/sim/archetypes/bolt.ts#L20)、[archetypes/barrage.ts:9](../../src/run/sim/archetypes/barrage.ts#L9)，并被 homing/bloom 复用。风险：循环中append/过滤时序决定首帧生效

<a id="a03"></a>

### A03 追踪弹再选目标

- **所有者/定位**：[archetypes/homing.ts:16,28](../../src/run/sim/archetypes/homing.ts#L16)
- **编码与逻辑状态**：target id/-1、hit、velocity；locked→target-lost→retargeted 或 ballistic-searching
- **守卫与转换**：现目标死亡/under/不存在则网格内另选未命中目标；无候选保持速度下次再搜
- **终态/取消/恢复**：A02终止；Z删；R带target/velocity/hit
- **关键不变量**：不凭 target id不存在删弹体；复用 A02穿透/碰撞
- **测试/风险**：[archetypes.test.mjs:93,109,145](../../scripts/archetypes.test.mjs#L93)。`drain` 与 homing 同机器；风险：targetable 过滤部分依赖 grid.rebuild 排除 under

<a id="a04"></a>

### A04 命中哨兵与爆破

- **所有者/定位**：[archetypes/orb.ts:12](../../src/run/sim/archetypes/orb.ts#L12)、[archetypes/lob.ts:63](../../src/run/sim/archetypes/lob.ts#L63)、[archetypes/burst.ts:12](../../src/run/sim/archetypes/burst.ts#L12)
- **编码与逻辑状态**：life、hit数组的 `-1` 哨兵；flight→detonated→burst Area
- **守卫与转换**：orb首次碰体/cover/寿命结束爆炸；lob重力飞行不碰体，cover/到期爆炸；explode仅hit为空时追加-1
- **终态/取消/恢复**：A02；Q/Z直接删除不会补爆；R哨兵阻止二次爆
- **关键不变量**：一个投射物恰好一次explode；后续是独立area，非原shot还活着
- **测试/风险**：[combat.test.mjs:182,214](../../scripts/combat.test.mjs#L182)、[archetypes.test.mjs:162](../../scripts/archetypes.test.mjs#L162)。风险：hit既存敌人id又存爆炸哨兵，消费者不能只按命中数量解释

<a id="a05"></a>

### A05 波前和命中集合

- **所有者/定位**：[archetypes/wave.ts:18,45](../../src/run/sim/archetypes/wave.ts#L18)
- **编码与逻辑状态**：life/dur、hit[]、隐含已走距离；launched→advancing-band→expired
- **守卫与转换**：每tick波带几何+各lane遮挡，记hit后推开/伤害；不使用pierce结束
- **终态/取消/恢复**：Q/Z删、owner死亡继续、R还原hit；到期filter
- **关键不变量**：每敌人每wave至多一次；遮挡只挡相应lane
- **测试/风险**：[archetypes.test.mjs:187](../../scripts/archetypes.test.mjs#L187)。风险：这是移动带，不可套普通shot的单点碰撞/cover终止

<a id="a06"></a>

### A06 区域伤害阶段

- **所有者/定位**：[attacks.ts:119,142](../../src/run/sim/attacks.ts#L119)；[archetypes/kit.ts:225](../../src/run/sim/archetypes/kit.ts#L225)
- **编码与逻辑状态**：Area.life/maxLife/delay/tickTimer/tick/follow/move；warning→active-pulsing→residue→expired
- **守卫与转换**：先扣life/跟随/track；delay>0返回；tickTimer到期击中；tick=99让短寿命area只打一次；move=null不结算damage
- **终态/取消/恢复**：第二遍expire回调后filter；Q/Z无expire；死亡/forget不取消；R保存
- **关键不变量**：延迟包含在life；follows位置，不重新选方向；终帧先更新再移除
- **测试/风险**：[combat.test.mjs:238,278,302](../../scripts/combat.test.mjs#L238)、[archetypes.test.mjs:212,249](../../scripts/archetypes.test.mjs#L212)。模块：cone/beam/spin/strike/smite/nova/burst；风险：>=与>临界tick及新增area迭代顺序不是统一的

<a id="a07"></a>

### A07 旋涡吸引和收束

- **所有者/定位**：[archetypes/vortex.ts:43,61](../../src/run/sim/archetypes/vortex.ts#L43)
- **编码与逻辑状态**：A06 + expire；warning→pull+pulse→collapse burst
- **守卫与转换**：delay过后每tick吸附/周期伤害，life<=0在expire生成burst
- **终态/取消/恢复**：只有自然到期collapse；Q/Z取消没有finale；R保留timer
- **关键不变量**：pull尊重poise与nav；burst只在到期回调生成一次
- **测试/风险**：[stations.test.mjs:238](../../scripts/stations.test.mjs#L238)涵盖融合，vortex一般由全招式/战斗间接覆盖。风险：硬清空与正常到期不可混同

<a id="a08"></a>

### A08 花束光束与终花

- **所有者/定位**：[archetypes/bloom.ts:37,121](../../src/run/sim/archetypes/bloom.ts#L37)
- **编码与逻辑状态**：delay/life/tickTimer/count/released/follow；beam-charge→beam+leaf-release→flower-finale
- **守卫与转换**：每tick重裁beam；delay过后按生命进度计算due，released单调补发叶片；life<=0生成finale
- **终态/取消/恢复**：Q/Z取消不补未发叶/花；死亡后继续；R保存released
- **关键不变量**：每个leaf索引发一次；leaf成独立bolt；beam/petal/leaf各自伤害窗口
- **测试/风险**：[stations.test.mjs:238](../../scripts/stations.test.mjs#L238)、[archetypes.test.mjs:249](../../scripts/archetypes.test.mjs#L249)。风险：finale是加入area数组，不能将其视为纯VFX

<a id="a09"></a>

### A09 火风暴分阶段释放

- **所有者/定位**：[archetypes/firestorm.ts:37,90](../../src/run/sim/archetypes/firestorm.ts#L37)
- **编码与逻辑状态**：life/maxLife/delay/released/tickTimer/radius；jet-feeding→vortex+pulses→spiral-arms→blast
- **守卫与转换**：jet从cast开始早于delay结束；released共享jet/spiral索引；delay过后吸附/周期tick；life<=0finale
- **终态/取消/恢复**：同 A08；R带released/半径；Z硬取消
- **关键不变量**：多个重叠时间线，不是单条 windup-active；每子段索引只消费一次
- **测试/风险**：[stations.test.mjs:238](../../scripts/stations.test.mjs#L238)。风险：抽成统一“delay不伤害”会破坏前置jet

<a id="a10"></a>

### A10 旋转喷流

- **所有者/定位**：[archetypes/sprinkler.ts:29,55](../../src/run/sim/archetypes/sprinkler.ts#L29)
- **编码与逻辑状态**：released=0/1、life/tickTimer/angle/count/follow；shell-opening→rotating-jets→splash
- **守卫与转换**：首drive用released锁一次壳击；按tickTimer旋转多jet；到期finale
- **终态/取消/恢复**：Q/Z取消；死亡后跟随尸体位置继续；R保存开场锁
- **关键不变量**：开场只一次；喷射持续转；渲染不能写angle/time
- **测试/风险**：[stations.test.mjs:238](../../scripts/stations.test.mjs#L238)。风险：released在这里是布尔哨兵，在bloom中是计数，不能统一语义

<a id="a11"></a>

### A11 雷球悬浮与落爆

- **所有者/定位**：[archetypes/rod.ts:27,52](../../src/run/sim/archetypes/rod.ts#L27)
- **编码与逻辑状态**：delay/life/tickTimer/count；flight-wait→hover-chain-pulses→fall-burst
- **守卫与转换**：delay过后每tick选目标chain；life<=0finale
- **终态/取消/恢复**：Q/Z硬取消；R还原；owner死亡不自动取消
- **关键不变量**：每脉冲重新取可见目标；等待无伤害；最后burst独立
- **测试/风险**：[stations.test.mjs:238](../../scripts/stations.test.mjs#L238)。风险：chain事件可为空点列，不代表没有时间推进

<a id="a12"></a>

### A12 大招充能和时间线

- **所有者/定位**：[ultimates/index.ts:46,68,86,109](../../src/run/sim/ultimates/index.ts#L46)
- **编码与逻辑状态**：charge/room、elapsed=-1或>=0、next/stage、origin/aim；charging→ready→casting→charging
- **守卫与转换**：alive且charge>=1且非casting才fire；耗charge、锁stage和aim；update按时间排序依次消费pulses；最后elapsed=-1；casting禁充能
- **终态/取消/恢复**：死亡/开始救援/Z取消，不退款；F停；救援中不update；R保存游标和施放阶段
- **关键不变量**：charge<=1、room有上限；同一pulse只执行一次；升级不改当前cast tier
- **测试/风险**：[evolution.test.mjs:143,202,236](../../scripts/evolution.test.mjs#L143)。四timeline：frenzy-plant/blast-burn/hydro-cannon/volt-tackle ([content/ultimates.ts:169](../../src/run/sim/content/ultimates.ts#L169))；风险：最后pulse当tick结束后，后续同tick伤害可能已可再充能

<a id="a13"></a>

### A13 大招跳跃目标消费

- **所有者/定位**：[ultimates/index.ts:252](../../src/run/sim/ultimates/index.ts#L252)
- **编码与逻辑状态**：ult.pathX/pathZ/crossed[] + next；hop-ready→next-unvisited-target→hop-consumed
- **守卫与转换**：从上个点选最近可见且未crossed；找到写crossed/路径；找不到本pulse仍被next消费
- **终态/取消/恢复**：fire清crossed；死亡取消elapsed、Z同时清crossed；R保留
- **关键不变量**：每目标最多作为一次hop落点（周围blast可重复伤）；不移动玩家实体
- **测试/风险**：[evolution.test.mjs:236](../../scripts/evolution.test.mjs#L236)是间接；未见单独hop重复/无目标/恢复专测。风险：不可将此路径当玩家冲刺状态

瞬时 [archetypes/chain.ts:11](../../src/run/sim/archetypes/chain.ts#L11) 在单次cast内用局部struck集合求链，**没有跨tick状态**，归入 A01 的施放动作而非额外机器；`fusionParts.ts` 是这些机器的命中/收尾动作库。

## 4. 异常、触发器与可消耗次数

`Player.fx` 的 key 由 [stats.ts:42](../../src/run/sim/stats.ts#L42) 构造：`item:<id>#<trigger-index>` / `ability:<id>#<trigger-index>`，再拼各规则的后缀。其状态均由 R 携带、Z保留；玩家死亡时 tick trigger 停止，救援时同样跳过 tick trigger；但命中/击杀 trigger 可由已经释放的攻击调用。下表的“消耗”主要是 fx 次数/额度，而非从 items 数组移除物品。

<a id="s01"></a>

### S01 状态附加/续时/消耗

- **所有者/定位**：[status.ts:38,70,105,115](../../src/run/sim/status.ts#L38)；[content/statuses.ts:41](../../src/run/sim/content/statuses.ts#L41)
- **编码与逻辑状态**：statuses[]成员、time/power/source；absent→applied→refreshed/sustained→expired/consumed
- **守卫与转换**：apply重置time/source，max-power取较强power；sustain只抬time；decay删除time<=0；consume显式移除
- **终态/取消/恢复**：玩家复活/Z清空；敌人Q/Z清空；F暂停；R携带；owner不存在仍可能留source
- **关键不变量**：同一id正常最多一项；dot/stop在decay前读、slow在后读；source为最近apply，不一定是最强power原owner
- **测试/风险**：[combat.test.mjs:1032,1115](../../scripts/combat.test.mjs#L1032)、[triggered-items.test.mjs:50](../../scripts/triggered-items.test.mjs#L50)。涵盖burn/paralysis/sleep/wet/poison/slow/root/chill/freeze/curse/marked；风险：不同apply/sustain的来源覆盖语义不可互换

<a id="s02"></a>

### S02 冰冻堆叠与睡眠唤醒

- **所有者/定位**：[status.ts:86,193](../../src/run/sim/status.ts#L86)；[content/statuses.ts:98](../../src/run/sim/content/statuses.ts#L98)
- **编码与逻辑状态**：chill.stacks、sleep存在性；chill1→2→freeze；sleep→woken
- **守卫与转换**：inflict达到builds.count消费chill再inflict freeze；直接命中wake先删带wakeBonus状态并放大本次伤害
- **终态/取消/恢复**：到期/consume/Z复位；F/R同S01；freeze可打断/禁起手，sleep仅interrupt不是blocksAttacks
- **关键不变量**：build转换发生在inflict，直接apply chill并不会自动转换；wake只对带wakeBonus状态
- **测试/风险**：[triggered-items.test.mjs:50](../../scripts/triggered-items.test.mjs#L50)、[combat.test.mjs:468,736](../../scripts/combat.test.mjs#L468)。风险：把apply与inflict合并或把sleep视作统一沉默会改变行为

<a id="s03"></a>

### S03 元素反应和防再入

- **所有者/定位**：[combat.ts:226](../../src/run/sim/combat.ts#L226)；[content/reactions.ts:25](../../src/run/sim/content/reactions.ts#L25)
- **编码与逻辑状态**：primed异常存在 + Hit.secondary；unprimed→primed→reaction-consumed/preserved
- **守卫与转换**：wet+electric=shock消费；burn+water=steam消费并兑现剩余DoT；burn+grass=wildfire保留并传播；按registry首匹配
- **终态/取消/恢复**：无独立timer，附着在S01；secondary禁止再次reaction；Q/Z清
- **关键不变量**：一次主命中最多一种reaction，邻伤不能递归反应；传播仍可建立后续primed
- **测试/风险**：战斗/全招式/确定性为间接，未见三个反应全部专测。风险：顺序在wake与主伤害之间，不能看成纯乘数

<a id="s04"></a>

### S04 硬直与抗硬直期

- **所有者/定位**：[poise.ts:21,33](../../src/run/sim/poise.ts#L21)；[enemies.ts:61,148](../../src/run/sim/enemies.ts#L61)
- **编码与逻辑状态**：stagger>immune / (0,immune] / 0；held→immune→ready
- **守卫与转换**：足够knock或flinch；boss/已有stagger/charge/dash/recover拒绝；release时抬到STAGGER.released形成免打断窗口
- **终态/取消/恢复**：每tick接触后减；sleep不清此timer；Q/Z移除；R续算
- **关键不变量**：同一timer编码两阶段；免疫段不能误判为停止；guardian不stagger
- **测试/风险**：[combat.test.mjs:1183,1207](../../scripts/combat.test.mjs#L1183)、[triggered-items.test.mjs:69](../../scripts/triggered-items.test.mjs#L69)。风险：读取时点在末尾衰减之前，边界少一tick会改变取消结果

<a id="t01"></a>

### T01 有限保命与后续爆发

- **所有者/定位**：[hurt.ts:58](../../src/run/sim/hurt.ts#L58)；[triggers/player.ts:97](../../src/run/sim/triggers/player.ts#L97)
- **编码与逻辑状态**：fx[`key:used`或`:stageN`]、`:at`、`:burst`；eligible→saved→cooldown/uses-exhausted→eligible；queued-burst→spent
- **守卫与转换**：致死时按trigger顺序，次数/冷却/概率满足则恢复HP、无敌、记使用；下一trigger tick消费burst
- **终态/取消/恢复**：不从items移除；stage档仅进化切换key带来新额度；死亡不返还，Z/R保留；queued burst可能因救援延迟
- **关键不变量**：首个成功save独占这次致死；每run/每stage额度不同；burst先清锁再造成伤害
- **测试/风险**：[survival-items.test.mjs:35,46](../../scripts/survival-items.test.mjs#L35)。实例 focus-band/focus-sash/revive/max-revive/rainbow-wing；风险：item复活与P01个人revives是两套顺序相连的机器

<a id="t02"></a>

### T02 格挡冷却

- **所有者/定位**：[hurt.ts:44](../../src/run/sim/hurt.ts#L44)；[triggers/player.ts:171](../../src/run/sim/triggers/player.ts#L171)
- **编码与逻辑状态**：fx[key]；block-ready(缺失/<=0)→spent-cooling→ready
- **守卫与转换**：伤害检查先blocked，命中即设every；tick倒计时
- **终态/取消/恢复**：死亡/救援暂停返还timer；Z/R保留
- **关键不变量**：一次block免整击并给iframe；正常伤害/lastHurt不发生
- **测试/风险**：[survival-items.test.mjs:59](../../scripts/survival-items.test.mjs#L59)。实例 guard-spec；风险：周期在tick trigger里，不能改成world.time差而保持救援语义

<a id="t03"></a>

### T03 受伤/命中边沿增益

- **所有者/定位**：[triggers/player.ts:19,26,41](../../src/run/sim/triggers/player.ts#L19)
- **编码与逻辑状态**：fx[key]/`:cd`/`:seen`；unobserved→baselined→armed→buff-active+cooldown→expired
- **守卫与转换**：首次只建baseline；hurt比较lastHurt递增；dash/ult观察0→1；概率且cooling=0触发；可加iframe/重置招式cd
- **终态/取消/恢复**：tick trigger暂停规则同上；Z不清seen或buff；R继续
- **关键不变量**：事件按“上次观察”而非直接事件队列；持续on不重复触发；buff时长与触发cd独立
- **测试/风险**：[survival-items.test.mjs:73](../../scripts/survival-items.test.mjs#L73)。smoke-ball/adrenaline-orb(hurt)、shed-shell(dash)、poke-flute(ult)。风险：首次观察同tick施放、连续冲刺没有0采样、救援间隔、Z清动作却保留seen可能漏/延后触发

<a id="t04"></a>

### T04 静止蓄积增益

- **所有者/定位**：[triggers/player.ts:47](../../src/run/sim/triggers/player.ts#L47)
- **编码与逻辑状态**：`:still`累计、fx[key]active；moving→waiting-still→buffing→moving-reset
- **守卫与转换**：moving清still；静止累计>=delay持续补满seconds；离开静止立即key=0
- **终态/取消/恢复**：Z把moving=false但保留still；F停；死亡/救援停tick；R保留
- **关键不变量**：静止buff不是每隔seconds重施；“无输入”不等于moving=false（冰面）
- **测试/风险**：metal-powder；未见直接静止/冰面/换区专测。风险：跨区静止蓄积继承是当前代码行为

<a id="t05a"></a>

### T05a 受伤附状态

- **所有者/定位**：[triggers/player.ts:26,65](../../src/run/sim/triggers/player.ts#L26)
- **编码与逻辑状态**：statusOnHurt的`:seen/:cd`；unobserved→baselined→ready→hurt-edge-consumed/cooling→ready
- **守卫与转换**：lastHurt严格增大且cd<=0才给范围内targetable敌人异常；首次只记baseline；cooling时仍消耗观察边沿
- **终态/取消/恢复**：F停，死亡/救援不采样；Z保留fx；R保留
- **关键不变量**：同一受击时刻不重复触发；受击和tick采样是两个时间点
- **测试/风险**：未见adamant-orb受击专测。风险：首次采样前受击或暂停采样期间多次受击会折叠/漏掉边沿

<a id="t05b"></a>

### T05b 冲刺起止边沿

- **所有者/定位**：[triggers/player.ts:113](../../src/run/sim/triggers/player.ts#L113)
- **编码与逻辑状态**：dashBurst的`:dashing`与dashTime；idle→dashing→idle，按start/end配置消费一侧边沿
- **守卫与转换**：缺省was=0，0→1或1→0发一次burst；与buff首次baseline规则不同
- **终态/取消/恢复**：Z保留记忆但清dashTime；F停，死亡/救援期间不采样；R保留
- **关键不变量**：同一观察边沿只一次；timer清零不等于fx清零
- **测试/风险**：[survival-items.test.mjs:86](../../scripts/survival-items.test.mjs#L86)覆盖soda-pop开始；iron-ball结束缺直接专测。风险：换区后仍`:dashing=1`可在新区观察到结束边沿，应明确产品意图

<a id="t06"></a>

### T06 条件治疗与周期电击

- **所有者/定位**：[triggers/heals.ts:16,28](../../src/run/sim/triggers/heals.ts#L16)；[triggers/zap.ts:7](../../src/run/sim/triggers/zap.ts#L7)
- **编码与逻辑状态**：fx[key]倒计时；heal-below ready/cooling；periodic waiting/check；zap cooling/ready-no-target
- **守卫与转换**：below阈值且cd过才heal；healEvery完整周期检查且满血也消耗周期；zap无目标时不重置、每tick重试
- **终态/取消/恢复**：Z/R保留；死亡/救援停tick；F停
- **关键不变量**：三种“没触发时保不保留就绪”不同，不能统一due helper
- **测试/风险**：[items.test.mjs:118](../../scripts/items.test.mjs#L118)、[triggers.test.mjs:35,48](../../scripts/triggers.test.mjs#L35)；lum-berry periodic主要间接。实例sitrus-berry/lum-berry/static

<a id="t07"></a>

### T07 周期触发器

- **所有者/定位**：[triggers/periodic.ts:13,21,63,72](../../src/run/sim/triggers/periodic.ts#L13)
- **编码与逻辑状态**：fx[key]timer；waiting→due-consumed→waiting
- **守卫与转换**：strike/markStrongest/spreadStatus 先重置周期再找目标/传播；无目标也消费；传播计每carrier限额
- **终态/取消/恢复**：Z/R保留；状态本身随S01；death/rescue/F暂停计时
- **关键不变量**：与zap不同；spread只给无该status邻居，按目标数量截断
- **测试/风险**：[triggered-items.test.mjs:114](../../scripts/triggered-items.test.mjs#L114)。old-rod/electirizer/sun-stone/lustrous-orb/silver-wing、silph-scope、burn-heal；风险：mark原有power按max-power刷新

<a id="t08"></a>

### T08 触发配额窗口

- **所有者/定位**：[world.ts:443](../../src/run/sim/world.ts#L443)；[triggers/healOnHit.ts:7](../../src/run/sim/triggers/healOnHit.ts#L7)、[triggers/onHit.ts:42](../../src/run/sim/triggers/onHit.ts#L42)
- **编码与逻辑状态**：procWindow、procs[key]；window-open→quota-used→capped→next-window-reset
- **守卫与转换**：每秒procWindow>=1清procs；匹配草系hit或主crit且有target才记额度
- **终态/取消/恢复**：death时window不走；rescue时window仍走；Z/R保留
- **关键不变量**：每玩家共享一秒窗口、每trigger独立计数；不是滑动窗口；secondary critStrike不再触发
- **测试/风险**：[triggers.test.mjs:58](../../scripts/triggers.test.mjs#L58)；thunder-stone多目标额度间接。风险：已发射攻击在倒地时仍可调用hit，而window冻结

<a id="t09"></a>

### T09 过量治疗储存

- **所有者/定位**：[combat.ts:271](../../src/run/sim/combat.ts#L271)；[triggers/player.ts:133](../../src/run/sim/triggers/player.ts#L133)
- **编码与逻辑状态**：fx[key]stored、`:t`；empty→charged→periodic-spend→empty
- **守卫与转换**：overheal累加至cap；每周期找可见目标，找到才清stored并造成damage；无目标保stored但重置timer
- **终态/取消/恢复**：Z/R保留，owner死不heal；tick暂停同上
- **关键不变量**：先将stored归零再造成二次伤害；Enigma同时可把overheal转shield（P04资源，没有单独timer）
- **测试/风险**：[survival-items.test.mjs:99](../../scripts/survival-items.test.mjs#L99)。fresh-water/enigma-berry；风险：触发伤害生成的新heal可能再入储存，不能在造成伤害后才清

<a id="t10"></a>

### T10 连杀时效

- **所有者/定位**：[triggers/scaling.ts:19](../../src/run/sim/triggers/scaling.ts#L19)
- **编码与逻辑状态**：fx[key]streak、`:kills/:at`；baseline→streak-growing→expired
- **守卫与转换**：首次以当前kills建基线；新kills累计并更新时间；无kill超过STREAK_GAP归零
- **终态/取消/恢复**：Z/R保留；tick采样暂停可能延迟读变化；world.time继续的救援期间可使间隔到期
- **关键不变量**：连杀timer按全局time，不是递减dt；其他 kills/unhurt/speed/armor/missingHp measure只是缓存派生量，不拆机器
- **测试/风险**：[triggered-items.test.mjs:130](../../scripts/triggered-items.test.mjs#L130)仅派生missingHp覆盖；cell-battery连杀窗口未见直接专测。风险：不能把所有scaling函数都称状态机

<a id="t11"></a>

### T11 击杀爆发防再入

- **所有者/定位**：[triggers/burstOnKill.ts:11](../../src/run/sim/triggers/burstOnKill.ts#L11)
- **编码与逻辑状态**：模块级 bursting=false/true；idle→executing-burst→idle
- **守卫与转换**：满足requires/概率后置true；递归kill见true跳过同类burst；finally清false
- **终态/取消/恢复**：同步调用栈内完成，R不携带；异常也finally解锁
- **关键不变量**：防击杀爆炸无限递归；shared模块状态不能跨异步step保持
- **测试/风险**：[triggered-items.test.mjs:95](../../scripts/triggered-items.test.mjs#L95)。ice-heal/fire-stone/ice-stone/leaf-stone/griseous-orb；风险：全模块锁而非每玩家锁，嵌套另一玩家同类也被抑制

<a id="t12"></a>

### T12 道具取得的即时初始化

- **所有者/定位**：[world.ts](../../src/run/sim/world.ts) 的 createWorld/createPlayer、pickEffects/rollDice；[stats.ts:147](../../src/run/sim/stats.ts#L147)
- **编码与逻辑状态**：fx[`dice:level`]存在性；unrolled→rolled-persistent；rare-candy pick→extra-level-queue
- **守卫与转换**：选道具卡 onPick.roll 调 rollDice 存种子骰面；onPick.levels 重复 gainXp，子卡排在当前卡后。createWorld 将本局 RNG 传入 createPlayer，背包一级骰子先 rollDice，再计算初始满 HP/盾
- **终态/取消/恢复**：Z/R 保留；忘道具不清骰面；背包初始化只执行所携道具的随机 roll，不把新局构建当作升级选卡，也不在快照恢复时重掷
- **关键不变量**：每次onPick确定一次结果，不在stat重算时重掷；稀有糖不是每tick效果
- **测试/风险**：**#22** 的同种子/玩家顺序初始化、存储携带、初始满生命、升级不重掷一级及背包糖果不赠等级定位在 [lab.test.mjs](../../scripts/lab.test.mjs)；原 [survival-items.test.mjs:124](../../scripts/survival-items.test.mjs#L124) 仍为取得道具路径。测试定义不等于本次执行

其余 trigger `healOnKill / inflictOnHit / bonk / execute / contactStatus / contactSpread` 没有自己的跨tick游标：它们分别是生命/异常/命中机器的动作；`execute` 在命中内置hp=0，由统一伤害尾部结算死亡（[triggers/onHit.ts:33](../../src/run/sim/triggers/onHit.ts#L33)，[triggered-items.test.mjs:82](../../scripts/triggered-items.test.mjs#L82)）；contact模板不额外记忆（[triggers/index.ts:158](../../src/run/sim/triggers/index.ts#L158)）。没有遗漏成“未处理的状态机”。

## 5. 刷怪、敌人生命、同伴

<a id="d01"></a>

### D01 刷怪信用与上限

- **所有者/定位**：[director.ts](../../src/run/sim/director.ts)、[director-pressure.ts](../../src/run/sim/director-pressure.ts)
- **编码与逻辑状态**：zone.tick、spawn.pool/credit/anchor/pressure、rampage；roster-locked→enabled；budget-accumulating→spawn-ready→cap-held；中性压力→观察队伍→平滑供给
- **守卫与转换**：仅active更新zone.tick；到roster时点加入一次；credit>=1且cap未满刷怪并花credit；anchor轮换活人；credit上限。常规供给由最受压玩家的近身敌群、近期受伤及倒地信号调节；开局/入区渐入，守卫和暴走回中性
- **终态/取消/恢复**：cleared停止director；Z重置调度与压力；R保留调度及平滑压力；全局F停止
- **关键不变量**：roster顺序/anchor/随机调用顺序是确定性状态；未成功放置也可能消费credit；基础人数倍率按队伍而非仅活人缩放；压力只改普通供给，不改存活敌人属性或事件，不来自画面/相机
- **测试/风险**：[combat.test.mjs](../../scripts/combat.test.mjs)、[coop.test.mjs](../../scripts/coop.test.mjs)、[zones.test.mjs](../../scripts/zones.test.mjs)、[snapshot.test.mjs](../../scripts/snapshot.test.mjs)。风险：忽略pressure恢复会改变后续刷怪；模型密度/命中期望不等同实际空间/伤害突发

<a id="d02"></a>

### D02 一次性区域事件

- **所有者/定位**：[director.ts:443](../../src/run/sim/director.ts#L443)；[beats.ts:51](../../src/run/sim/beats.ts#L51)
- **编码与逻辑状态**：spawn.fired[`kind@time`]；scheduled→fired；beat.kind=alpha/elite-wave/swarm/stampede/eruption
- **守卫与转换**：zone时钟减难度early到点，先记fired再执行；一次tick可消费多个beat
- **终态/取消/恢复**：Z重置fired，R保留；即使spawn失败该beat不重试
- **关键不变量**：相同kind@at去重；alpha标记使捕获概率不同；eruption启动另一个多tick机器H11
- **测试/风险**：[late-zones.test.mjs:90,404](../../scripts/late-zones.test.mjs#L90)、[partners.test.mjs:53](../../scripts/partners.test.mjs#L53)、确定性测试间接。风险：同kind同时刻的两条内容会互相压掉；内容编辑是机器输入变更

<a id="d03"></a>

### D03 冲锋敌人退场

- **所有者/定位**：[beats.ts:96](../../src/run/sim/beats.ts#L96)；[enemies.ts:79,144,195](../../src/run/sim/enemies.ts#L79)
- **编码与逻辑状态**：charge=true、dash方向、加速speed、hp；stampeding→blocked-normal-chase 或 left-arena-removed
- **守卫与转换**：固定方向冲；nav前进不足半步取消charge并除去加速；越ARENA_HALF+6置hp=0
- **终态/取消/恢复**：无kill/loot/capture；Q/Z删；R保留charge方向
- **关键不变量**：charge绕过普通skill/guardian；出场可越arena边界；停止加速只一次
- **测试/风险**：[zone-skills.test.mjs](../../scripts/zone-skills.test.mjs)、[nav.test.mjs](../../scripts/nav.test.mjs)主要间接，未见专门“冲群受阻→普通追击”行为测试

<a id="d04"></a>

### D04 敌人生命与移除

- **所有者/定位**：[enemies.ts:42](../../src/run/sim/enemies.ts#L42)；[combat.ts:127,287](../../src/run/sim/combat.ts#L127)；[director.ts:418](../../src/run/sim/director.ts#L418)
- **编码与逻辑状态**：hp、world.enemies成员、elite/alpha/boss、phase、hardened/flash；alive→dying/removed
- **守卫与转换**：主伤/DoT 致死走 killEnemy；dotSource=-1 传 null killer，玩家来源仍严格 findPlayer。环境死亡保留基础掉落/守卫全队奖励/clear，不增加个人 kills、不捕获、不触发玩家 kill hook，也不取玩家树果加成；自爆/离场/搁浅置 hp=0 仍走无奖移除；filter 通常在 enemy pass 尾
- **终态/取消/恢复**：Q清场无奖励；Z全删；R包括尚未filter的尸体；终局停止
- **关键不变量**：伤害入口hp<=0 guard阻重复kill；killEnemy函数自己没有幂等latch，调用者保证一次
- **测试/风险**：[lab.test.mjs:160,178](../../scripts/lab.test.mjs#L160)、[zone-skills.test.mjs:693](../../scripts/zone-skills.test.mjs#L693)；[combat.test.mjs](../../scripts/combat.test.mjs) 新增 **#24** 环境与玩家 DoT、精英/守卫收益及无效玩家来源拒绝的定义。player 攻击发生在 enemy filter 之后，尸体可留至下 tick，不可仅用数组成员判活着

<a id="d05"></a>

### D05 视线缓存资格

- **所有者/定位**：[enemies.ts:165,179](../../src/run/sim/enemies.ts#L165)
- **编码与逻辑状态**：sightline、(tick+id)%4、distance；routed→close-cached-direct→stale/recheck→routed
- **守卫与转换**：<6才考虑追踪；每4tick分散检查walkable line；无route时直追；出距离清sightline
- **终态/取消/恢复**：Z删enemy；R保留缓存；F不重查
- **关键不变量**：近身直追不等于跳过nav碰撞；cache可暂时旧值
- **测试/风险**：[nav.test.mjs:494](../../scripts/nav.test.mjs#L494)；风险：移动/攻击若在视图调用flowDirection会写demand，破坏确定性

<a id="d06"></a>

### D06 同伴捕获与行动

- **所有者/定位**：[partners.ts:89,155](../../src/run/sim/partners.ts#L89)
- **编码与逻辑状态**：world.partners成员、owner、cooldown、位置/目标条件；uncaptured→captured→following/chasing/attacking/cooling/regrouping/owner-down
- **守卫与转换**：elite kill、slot可用、种子概率 capture；update时owner活才减timer；远距瞬移归队；shot边走边射，tackle/cloud/pulse追敌近身后触发
- **终态/取消/恢复**：不死亡无HP；owner-down停止行为，separate仍可分开重叠；Q保留；Z重定位且保留cooldown；R原样
- **关键不变量**：guardian不可被同伴选为攻击目标；每tick初始count防新捕获立即行动；攻击无目标保持ready
- **测试/风险**：[partners.test.mjs:53,74,88,130,170,267](../../scripts/partners.test.mjs#L53)；风险：减少伙伴槽不驱逐已捕获伙伴；类型由具体species.skill映射成4种style

<a id="d07"></a>

### D07 同伴护主

- **所有者/定位**：[partners.ts:124](../../src/run/sim/partners.ts#L124)；[enemies.ts:223](../../src/run/sim/enemies.ts#L223)
- **编码与逻辑状态**：partner.guard与owner.invulnerable；ready→guarding-hit-absorbed-by-iframe→rest→ready
- **守卫与转换**：非boss接触伤害已落地且owner仍活；选择可达/绳距内最近ready伙伴；赋guard cd、抬owner无敌
- **终态/取消/恢复**：owner-down timer停止；Z/R保留；不存在“伙伴被打死”态
- **关键不变量**：护主在首击之后，不能追溯取消首击；多个伙伴轮替，不一次全部消耗
- **测试/风险**：[partners.test.mjs:219](../../scripts/partners.test.mjs#L219)。风险：不能把guard解释成伙伴护盾HP或主动挡掉所有来源

## 6. 普通敌人技能家族（全部技能注册项）

本节区分“施法者状态”和“发出的hazard状态”；后者见第7节。普通敌人被 `charge` 接管时不运行skill。普通技能只在有活人目标时step。后续所有 skill/guardian 对象遵循 F/Q/Z/R；已经释放的hazard是否随caster取消由H家族决定，不能从Enemy.phase推断。

<a id="k01"></a>

### K01 通用预警骨架

- **所有者/定位**：[skills/telegraph.ts:55,121,149](../../src/run/sim/skills/telegraph.ts#L55)
- **编码与逻辑状态**：phase/phaseTime/attackTimer/dashX/Z/strikes；chase-cooling→eligible→windup→release或dash→recover→chase
- **守卫与转换**：timer仅chase递减；起手要求非attacksBlocked、range/视线、必要walkable；成功设jitter cd；windup严格>阈值才release；repeat重新aim短windup
- **终态/取消/恢复**：interrupted立刻enter(chase)，不清attackTimer；已释放加STAGGER.released；R全保存；under在此执行器非法恢复chase
- **关键不变量**：paralysis阻止新起手，不必取消现有windup；sleep/stagger才interrupt；通用lunge连段restrike不另查attacksBlocked
- **测试/风险**：[combat.test.mjs:603,658,776,796,1183](../../scripts/combat.test.mjs#L603)、[zone-skills.test.mjs:339](../../scripts/zone-skills.test.mjs#L339)。风险：恢复chase不等于重设全冷却；通用lunge和guardian连段paralysis语义不同

<a id="k02"></a>

### K02 突进连段

- **所有者/定位**：[skills/lunge.ts:50,83](../../src/run/sim/skills/lunge.ts#L50)
- **编码与逻辑状态**：K01 + lunge.repeat/strikes、stopsAtCover；windup→dash→repeat-windup/ recover
- **守卫与转换**：ground charge起手查walkable；flyer dive运行时cover可提前结束；每次连击减strikes并重新aim
- **终态/取消/恢复**：E与K01；flame-trail另附H08；Q/Z清
- **关键不变量**：注册：belly-slide/fire-punch/dive/roll/flame-charge/horn-attack/double-peck/triple-peck/take-down/horn-rush/razor-dash/flame-trail/aqua-jet/megahorn
- **测试/风险**：[combat.test.mjs:658,776,817](../../scripts/combat.test.mjs#L658)、[zone-skills.test.mjs:339,412](../../scripts/zone-skills.test.mjs#L339)。风险：dash结束的当前return可能仍给dash速度，必须按调用顺序看位置

<a id="k03"></a>

### K03 齐射与随体预警

- **所有者/定位**：[skills/shot.ts:114,177](../../src/run/sim/skills/shot.ts#L114)
- **编码与逻辑状态**：K01 windup + 一或多条 `*-warn` hazard；锁定→随caster平移→warning到期生成射弹
- **守卫与转换**：起手计算固定方向/坡度；warning逐tick更新发射位置/cover长度；由warning.life<=0发射，不是telegraph.release
- **终态/取消/恢复**：活跃caster丢失warning直接删；shot发出后通常caster=-1独立；Q/Z清
- **关键不变量**：icicle/flamethrower/poison-sting/ember/thunder-shock/poison-fan/pay-day/spike-cannon/water-gun/pin-missile 同族；每lane一次发射
- **测试/风险**：[combat.test.mjs:603,640](../../scripts/combat.test.mjs#L603)、[zone-skills.test.mjs:240,644](../../scripts/zone-skills.test.mjs#L240)、[late-zones.test.mjs:153](../../scripts/late-zones.test.mjs#L153)。风险：双timer（enemy与hazard）并行，不能只查phase验证是否已射出

<a id="k04"></a>

### K04 抛射技能

- **所有者/定位**：[skills/acid.ts:120](../../src/run/sim/skills/acid.ts#L120)
- **编码与逻辑状态**：K01 cast + acid/egg flying；windup→release-target-now→chase
- **守卫与转换**：release读此时target位置弹道；acid一球，egg-bomb一球、egg-barrage三点
- **终态/取消/恢复**：风up可取消，已release不依赖caster；落地由H04接管
- **关键不变量**：不同于起手时锁地面的landing；egg没有持续毒池
- **测试/风险**：[combat.test.mjs:832](../../scripts/combat.test.mjs#L832)、[zone-skills.test.mjs:224](../../scripts/zone-skills.test.mjs#L224)。风险：仅看warning图形会误判锁定时点

<a id="k05"></a>

### K05 光束/粉尘持续施放

- **所有者/定位**：[skills/psybeam.ts:45,101](../../src/run/sim/skills/psybeam.ts#L45)；[skills/stunSpore.ts:13,32](../../src/run/sim/skills/stunSpore.ts#L13)
- **编码与逻辑状态**：K01 + hazard.life>active；charging→beam/cloud-active→expire
- **守卫与转换**：起手创建固定beam/云；life过windup窗口后生效；beam可按iframe重复hit，cloud续slow
- **终态/取消/恢复**：仅预警阶段取消caster；active后继续；Q/Z删
- **关键不变量**：psybeam/psybeam-heavy/vine-bind/ice-beam/stun-spore；beam打中才slow，cloud在区域可直接sustain
- **测试/风险**：[combat.test.mjs:867,900,1008](../../scripts/combat.test.mjs#L867)、[zone-skills.test.mjs:254](../../scripts/zone-skills.test.mjs#L254)。风险：临界tick已落到active时不再校验caster，死亡取消测试要覆盖边界

<a id="k06"></a>

### K06 环形一次击发

- **所有者/定位**：[skills/radial.ts:29,76](../../src/run/sim/skills/radial.ts#L29)
- **编码与逻辑状态**：K01 + ring.dmg sentinel/life；follow-caster-warning→one-hit→harmless-residue；self-destruct另dead
- **守卫与转换**：activeCaster每次核对，ring跟caster；life<=active击中后dmg=0；self-destruct after置caster.hp=0并death event
- **终态/取消/恢复**：出手前死亡/interrupt取消；击中后不再依赖caster；Q/Z删；自爆不奖励
- **关键不变量**：sing/sing-wide/dragon-pulse/discharge/discharge-wide/discharge-quick/dragon-rage/self-destruct；仅一次圈伤
- **测试/风险**：[combat.test.mjs:693,736,752](../../scripts/combat.test.mjs#L693)、[late-zones.test.mjs:153](../../scripts/late-zones.test.mjs#L153)。风险：自爆死亡与combat.killEnemy两条终止路径不能合并

<a id="k07"></a>

### K07 遁地/跳跃/落地

- **所有者/定位**：[skills/landing.ts:108,152](../../src/run/sim/skills/landing.ts#L108)
- **编码与逻辑状态**：phase=under/windup/dash/recover、phaseTime、landing hazard；chase→under→arrive 或 chase→windup→airborne→land→recover
- **守卫与转换**：timer到期且目标地standable；跳跃还查walkable；under不可选中；跳跃dash向circle收敛；多圈末个为实体落点
- **终态/取消/恢复**：interrupted回chase，圈失caster取消；body死亡取消未命中圈；Q/Z清；R保留圈与phase
- **关键不变量**：melt/triple-burrow/burrow/shadow-sneak/dig（under）；body-slam/leap/leap-heavy/high-jump-kick（jump）；triple仅一个身体
- **测试/风险**：[zone-skills.test.mjs:111,146,164](../../scripts/zone-skills.test.mjs#L111)、[late-zones.test.mjs:168](../../scripts/late-zones.test.mjs#L168)。风险：under是通用phase但含“潜地/瞬移”不同含义；landingOf读数组关系也是状态

<a id="k08"></a>

### K08 连发孢子

- **所有者/定位**：[skills/spore.ts:79](../../src/run/sim/skills/spore.ts#L79)
- **编码与逻辑状态**：attackTimer、phase=windup、phaseTime；reload→volley→burst-in-progress→reload
- **守卫与转换**：attacksBlocked直接return冻结reload/连射；无目标/遮挡就绪重试；burst按before<at<=now发后续volley
- **终态/取消/恢复**：**sleep不会阻止该族volley**（无interrupted检查）；paralysis/freeze会暂停；Q/Z删，R续连射
- **关键不变量**：spore/bubble/bubble-burst；连射仍移动，每个子弹重新瞄准
- **测试/风险**：[zone-skills.test.mjs:240](../../scripts/zone-skills.test.mjs#L240)、[combat.test.mjs:343](../../scripts/combat.test.mjs#L343)。风险：phase名windup在此是已在连射，不是可统一取消的准备态

<a id="k09"></a>

### K09 硬化护盾

- **所有者/定位**：[skills/harden.ts:8](../../src/run/sim/skills/harden.ts#L8)；[enemies.ts:51](../../src/run/sim/enemies.ts#L51)
- **编码与逻辑状态**：K01 + hardened>0；normal→windup→hardened→normal
- **守卫与转换**：release写duration；enemy loop每tick减；combat仅direct乘减伤
- **终态/取消/恢复**：interrupted可取消未release；已harden计时独立，即使睡眠也衰减；Q/Z清；R保留
- **关键不变量**：metapod/kakuna/omanyte同族；DoT不减伤；hardenDamage缺省取HARDEN.damage
- **测试/风险**：[combat.test.mjs:575](../../scripts/combat.test.mjs#L575)。风险：hardened与attack phase正交

<a id="k10a"></a>

### K10a 光环冷却

- **所有者/定位**：[skills/aura.ts:17](../../src/run/sim/skills/aura.ts#L17)
- **编码与逻辑状态**：attackTimer；aura-ready/cooling/interrupt-paused；aura与fire-aura共用
- **守卫与转换**：非interrupted时扣timer，到期圈伤并加every；aura成功伤害续poison，fire-aura不毒
- **终态/取消/恢复**：睡眠/硬直暂停计时，非reset；Q/Z删caster；R保timer；F停
- **关键不变量**：无windup；paralysis的attacksBlocked不在本函数guard中
- **测试/风险**：[zone-skills.test.mjs:180](../../scripts/zone-skills.test.mjs#L180)。风险：不能把所有status禁攻都解释成关闭持续气场

<a id="k10b"></a>

### K10b 移动尾迹

- **所有者/定位**：[skills/trail.ts:13,31](../../src/run/sim/skills/trail.ts#L13)
- **编码与逻辑状态**：attackTimer + 同caster acid-pool列表/最新池位置；cooling→due→spawned或too-close-suppressed→cooling
- **守卫与转换**：非interrupted且speed>0才扣；到期先加every，再判距最近池>=0.15；普通敌人超pool上限淘汰最旧
- **终态/取消/恢复**：已留池独立留至life到期；Q/Z删；R保timer与池；F停
- **关键不变量**：guardian用同一sludgeTrail生成器但不同世界tick节拍且不套普通池数上限；speed与实际位移不同
- **测试/风险**：[late-zones.test.mjs:112,153](../../scripts/late-zones.test.mjs#L112)。风险：由于位置抑制，cooldown到期不保证产生新池；池数组本身参与状态

<a id="k11"></a>

### K11 全局节拍治疗

- **所有者/定位**：[skills/healPulse.ts:15,28,48](../../src/run/sim/skills/healPulse.ts#L15)
- **编码与逻辑状态**：隐式全局相位 `world.tick % round(every/TICK)` + alive/interrupt/attackblock；inactive→pulse-due→inactive
- **守卫与转换**：固定世界节拍才pulse；最低id覆盖者负责一次heal；用px/pz防更新顺序影响
- **终态/取消/恢复**：被中断错过该拍不补；Q/Z删；R恢复global tick；无个人reload
- **关键不变量**：clefairy/chansey；不自疗/不疗boss，多圈不叠；这是无本地timer的周期机器
- **测试/风险**：[zone-skills.test.mjs:204](../../scripts/zone-skills.test.mjs#L204)。风险：变更每个物种every会破坏共同“同拍最低id”假设

<a id="k12"></a>

### K12 瞬移锁点与攻击

- **所有者/定位**：[skills/teleport.ts:36](../../src/run/sim/skills/teleport.ts#L36)
- **编码与逻辑状态**：phase/chase timer/teleport-mark/phaseTime；chase→under-destination-mark→teleported-windup→beam→chase
- **守卫与转换**：近距且非blocked，有有限seeded合法目的点才开始；under>=0.4找mark传送；随后完整psybeam预警
- **终态/取消/恢复**：interrupted回chase，marker取消；mark丢失回chase；Q/Z清；R续marker
- **关键不变量**：kadabra；目的地合法、传送不做长距离插值；传送与射线有两段独立预警
- **测试/风险**：[late-zones.test.mjs:130](../../scripts/late-zones.test.mjs#L130)。风险：复用under造成targetable=false；不能提前把teleport mark当beam计时

<a id="k13"></a>

### K13 回旋骨头/落石起手

- **所有者/定位**：[skills/boomerang.ts:105](../../src/run/sim/skills/boomerang.ts#L105)；[skills/rockfall.ts:63](../../src/run/sim/skills/rockfall.ts#L63)
- **编码与逻辑状态**：K01 cast型施放，两种独立hazard后续：bone往返、rockfall落圈
- **守卫与转换**：bonemerang release throwBone；rockfall起手锁多个地圈，caster保持windup
- **终态/取消/恢复**：K01取消；已出骨头按H05，落石按H03；Q/Z删；R保留
- **关键不变量**：cubone/rhydon各实现；施放与hazard独立，不需要复制K01
- **测试/风险**：[zone-skills.test.mjs:366,386](../../scripts/zone-skills.test.mjs#L366)。风险：bonemerang普通敌人不检查bonesOut，等待全回收是部分guardian的额外guard

## 7. Hazard 家族与并行场地效果

[hazards.ts:24](../../src/run/sim/hazards.ts#L24) 对所有hazard：delay>0仅扣delay；否则先积分位置/重力并扣life，再运行kind rule，末尾filter life>0；往数组append的新hazard可能在**同一次迭代**被处理。各kind的“life=0”“dmg=0”“caster=-1”不等价。表内共用Q/Z硬清与R还原。

<a id="h01"></a>

### H01 敌方弹体

- **所有者/定位**：[hazards.ts:24](../../src/run/sim/hazards.ts#L24)；[skills/kit.ts:20](../../src/run/sim/skills/kit.ts#L20)
- **编码与逻辑状态**：delay/life/dmg、位置速度，缺省rule；scheduled→flying→hit/cover/expired
- **守卫与转换**：无自定义update的kind走plain shot，碰体且damagePlayer成功才life=0；poison/slow同步附加
- **终态/取消/恢复**：发射后通常无caster依赖；被iframe躲掉不消费；Q/Z删；R携带delay/life
- **关键不变量**：spore/bubble/slash/rock-shard与K03各种射弹；延迟不扣life、不移动
- **测试/风险**：[combat.test.mjs:343,603](../../scripts/combat.test.mjs#L343)、[zone-skills.test.mjs:240](../../scripts/zone-skills.test.mjs#L240)。静态疑点：命中后内层player循环不break、不查life，重叠玩家可能同tick被同一“单击”shot命中；未运行复现

<a id="h02"></a>

### H02 跟随/静态预警

- **所有者/定位**：[skills/lunge.ts:147](../../src/run/sim/skills/lunge.ts#L147)、[skills/shot.ts:177](../../src/run/sim/skills/shot.ts#L177)、[skills/teleport.ts:109](../../src/run/sim/skills/teleport.ts#L109)
- **编码与逻辑状态**：caster/life/kind；warning-follow/static→released或expired/cancelled
- **守卫与转换**：dash-warn/bone-warn followCaster；shot-warn到期fire；teleport-mark仅合法caster存在
- **终态/取消/恢复**：caster>=0时可被death/interrupt取消；旧守卫dash-warn很多默认caster=-1，留静态线直至到期
- **关键不变量**：提示不是统一全无害：某些warning的到期是生成攻击动作
- **测试/风险**：[combat.test.mjs:640,680,796](../../scripts/combat.test.mjs#L640)、[late-zones.test.mjs:571](../../scripts/late-zones.test.mjs#L571)。风险：同名dash-warn有绑定/不绑定两种生命周期

<a id="h03"></a>

### H03 落点一次伤害

- **所有者/定位**：[skills/landing.ts:52,82,217](../../src/run/sim/skills/landing.ts#L52)、[skills/rockfall.ts:89](../../src/run/sim/skills/rockfall.ts#L89)；[bosses/zone-hazards.ts:70](../../src/run/sim/bosses/zone-hazards.ts#L70)
- **编码与逻辑状态**：life、dmg>0/0、caster、可选delay/pool；warning→one-hit→residue
- **守卫与转换**：landing由brain主动landingHit；rockfall/crabhammer/thunder-bolt life<=0.3打一圈；boss-fall同样可留pool
- **终态/取消/恢复**：landing与boss-fall打前始终查caster；strikeCircle仅life>residue分支查caster；Q/Z硬删无hit
- **关键不变量**：dmg=0锁住不重复；landing多个圈可一个身体；fall delay只延后出生
- **测试/风险**：[zone-skills.test.mjs:146,164,386](../../scripts/zone-skills.test.mjs#L146)、[late-zones.test.mjs:463](../../scripts/late-zones.test.mjs#L463)。风险：这三个落圈取消临界规则不同，不能机械合并

<a id="h04"></a>

### H04 弹体衍生池/爆炸

- **所有者/定位**：[skills/acid.ts:144,161,180](../../src/run/sim/skills/acid.ts#L144)；[bosses/zone-hazards.ts:127](../../src/run/sim/bosses/zone-hazards.ts#L127)
- **编码与逻辑状态**：acid/egg/boss-shot life，后继池/爆炸对象；flying→land/contact→spawn-successor→removed
- **守卫与转换**：重力/cover/到期酸液或蛋落地；酸液splash+池，蛋一次blast+residue；boss-shot到期/cover/成功命中留可选pool
- **终态/取消/恢复**：已释放不依赖caster；Q/Z直接丢弃不生成残留；R带母子实体
- **关键不变量**：同一次落地只建一次后继；field clear不应把清理解释成自然到期爆炸
- **测试/风险**：[combat.test.mjs:832](../../scripts/combat.test.mjs#L832)、[zone-skills.test.mjs:224](../../scripts/zone-skills.test.mjs#L224)、[late-zones.test.mjs:380,571](../../scripts/late-zones.test.mjs#L380)

<a id="h05"></a>

### H05 回旋骨头往返

- **所有者/定位**：[skills/boomerang.ts:37,65,125](../../src/run/sim/skills/boomerang.ts#L37)
- **编码与逻辑状态**：length剩余外飞距离、life、caster、vx/vz；outbound→returning→caught/dropped/timeout
- **守卫与转换**：length递减至<=0转追thrower当前位置；返回时thrower不活或距离<CATCH终止；cover可阻断（piercesCover例外）
- **终态/取消/恢复**：外飞段caster死亡不立即drop，进入return才检查；sleep不取消已飞骨头；Q/Z删；R保留返程
- **关键不变量**：两段都可hit，以玩家iframe限频，无每腿hit集合；MAX_FLIGHT保证终止
- **测试/风险**：[zone-skills.test.mjs:366](../../scripts/zone-skills.test.mjs#L366)、[late-zones.test.mjs:437](../../scripts/late-zones.test.mjs#L437)。风险：bonesOut扫描的是数组关系，不只Enemy timer

<a id="h06"></a>

### H06 持续光束/扫射

- **所有者/定位**：[skills/psybeam.ts:101](../../src/run/sim/skills/psybeam.ts#L101)、[skills/stunSpore.ts:32](../../src/run/sim/skills/stunSpore.ts#L32)；[bosses/hazards.ts:59,74](../../src/run/sim/bosses/hazards.ts#L59)；[bosses/zone-hazards.ts:118,220](../../src/run/sim/bosses/zone-hazards.ts#L118)
- **编码与逻辑状态**：life>active/<=active；charging→continuous-active→expired；sweep角度由life生成
- **守卫与转换**：windup核对caster；active几何每tick伤害（iframe限制）或sustain slow；sweep逐角度测cover
- **终态/取消/恢复**：active后beam/fissure/hydro/sweep不再查caster；stun云同样；Q/Z/R通用
- **关键不变量**：固定/扫动几何与warning一致；不能把active当一次性命中
- **测试/风险**：[combat.test.mjs:867,900](../../scripts/combat.test.mjs#L867)、[zone-skills.test.mjs:308,786](../../scripts/zone-skills.test.mjs#L308)、[late-zones.test.mjs:505](../../scripts/late-zones.test.mjs#L505)。风险：过阈值当tick失去caster不会走预警取消分支

<a id="h07"></a>

### H07 环形消耗和残留

- **所有者/定位**：[skills/radial.ts:76](../../src/run/sim/skills/radial.ts#L76)；[bosses/zone-hazards.ts:145](../../src/run/sim/bosses/zone-hazards.ts#L145)
- **编码与逻辑状态**：dmg sentinel；charging-follow→hit-spent→residue
- **守卫与转换**：radial跟caster直到hit；cone按固定扇形，打前始终cancelled；life<=active击一次后dmg=0
- **终态/取消/恢复**：中断可取消未hit；spent残留不再要求caster；Q/Z/R通用
- **关键不变量**：圈、扇形只击一次；selfDestruct/club/song/fire-blast复用但after动作各异
- **测试/风险**：[combat.test.mjs:693,736,752](../../scripts/combat.test.mjs#L693)、[late-zones.test.mjs:240](../../scripts/late-zones.test.mjs#L240)

<a id="h08"></a>

### H08 持续尾迹/地面池

- **所有者/定位**：[skills/lunge.ts:103,119,157](../../src/run/sim/skills/lunge.ts#L103)；[skills/trail.ts:13](../../src/run/sim/skills/trail.ts#L13)；[bosses/zone-guardians.ts:516,647](../../src/run/sim/bosses/zone-guardians.ts#L516)
- **编码与逻辑状态**：flame-trail.length/caster/kind→burning-trail；acid/burning/ice pool life
- **守卫与转换**：普通charge蓄trail，dash延长，结束/失caster且length>0→新burning-trail；guardian直接建burning/ice并延长，结束把caster=-1；sludge按池数/距离受限
- **终态/取消/恢复**：燃烧/酸/冰残留可独立存活到期；停止未移动charge不点燃；Q/Z/R通用
- **关键不变量**：同名地面残留来自不同生成机器；每HURT_TICKS火焰伤害、acid每tick续poison、ice仅改变移动
- **测试/风险**：[zone-skills.test.mjs:412](../../scripts/zone-skills.test.mjs#L412)、[late-zones.test.mjs:112,183,360](../../scripts/late-zones.test.mjs#L112)。风险：guardian trail与普通flame-trail不是同一引燃规则

<a id="h09"></a>

### H09 追踪鬼火/旋风

- **所有者/定位**：[bosses/hazards.ts:84](../../src/run/sim/bosses/hazards.ts#L84)；[bosses/zone-hazards.ts:260](../../src/run/sim/bosses/zone-hazards.ts#L260)
- **编码与逻辑状态**：life/duration、dmg、velocity；arming-homing→armed-homing→broken/residue或removed
- **守卫与转换**：nearest活人追踪；arm时间到才可hit；twister命中清dmg/速度留0.3残留，ghost-fire命中life=0
- **终态/取消/恢复**：caster死亡/睡眠不取消独立追踪物；超时/Q/Z删；R保位置速度
- **关键不变量**：正常首个成功hit停止；两kind收尾不同
- **测试/风险**：[zone-skills.test.mjs:786](../../scripts/zone-skills.test.mjs#L786)、[late-zones.test.mjs:240](../../scripts/late-zones.test.mjs#L240)间接；未见ghost-fire全取消/命中专测

<a id="h10a"></a>

### H10a 收缩边界命中集合

- **所有者/定位**：[bosses/zone-hazards.ts:152](../../src/run/sim/bosses/zone-hazards.ts#L152)
- **编码与逻辑状态**：closing-box.life/active/length/gap/hit[]；warning→shrinking→expired，每个player另有unhit/hit子态
- **守卫与转换**：life<=active开始收缩；墙段碰撞且hit成功才记id；gap的安全开口跳过
- **终态/取消/恢复**：全阶段失去activeCaster即life=0；F/Q/Z/R通用
- **关键不变量**：无敌躲过不消耗一次命中；同一盒每玩家最多成功hit一次；几何half随life收缩
- **测试/风险**：[late-zones.test.mjs:304](../../scripts/late-zones.test.mjs#L304)。风险：hit[]与caster取消需随快照恢复，不能仅存当前半径

<a id="h10b"></a>

### H10b 随体环绕

- **所有者/定位**：[bosses/zone-hazards.ts:178](../../src/run/sim/bosses/zone-hazards.ts#L178)
- **编码与逻辑状态**：orbit.caster/duration/life/length；active-following→expired/cancelled，角度由age派生
- **守卫与转换**：每tick跟caster中心移动，四个轨道点碰撞；无windup/dmg-spent子态
- **终态/取消/恢复**：activeCaster不存在立即删；Q/Z/R通用
- **关键不变量**：轨道中央安全；命中间隔由玩家iframe控制，不是orbit.hit集合
- **测试/风险**：[late-zones.test.mjs:360,505](../../scripts/late-zones.test.mjs#L360)。风险：盾timer与orbit.life并行，中断可取消轨道而hardened仍剩余

<a id="h10c"></a>

### H10c 诅咒标记追踪和锁定

- **所有者/定位**：[bosses/zone-hazards.ts:202](../../src/run/sim/bosses/zone-hazards.ts#L202)
- **编码与逻辑状态**：curse-mark.target/life/active/dmg及可选delay；delayed→tracking→position-locked→detonated→residue
- **守卫与转换**：life>active+0.3跟活target；其后锁位置；life<=0.3爆一次，dmg=0
- **终态/取消/恢复**：tracking时目标死即取消；锁后目标死不阻其他活人受伤；未spent全程查caster；F/Q/Z/R通用
- **关键不变量**：跟踪与锁点有不同guard；dmg=0防再次爆炸
- **测试/风险**：[late-zones.test.mjs:333](../../scripts/late-zones.test.mjs#L333)。风险：阈值跨越顺序不可改为一直跟到爆炸；跨区硬删不引爆

<a id="h10d"></a>

### H10d 低血冰雾

- **所有者/定位**：[bosses/zone-hazards.ts:240](../../src/run/sim/bosses/zone-hazards.ts#L240)；[bosses/zone-guardians.ts:596](../../src/run/sim/bosses/zone-guardians.ts#L596)
- **编码与逻辑状态**：ice-mist对象存在性/life/caster，boss低HP；absent→created→refreshed-following→expired/cancelled
- **守卫与转换**：Lapras低HP每brain tick复用同caster对象并life=0.5+TICK；hazard按HURT_TICKS伤害/续slow
- **终态/取消/恢复**：activeCaster失效立即置0；停止续命自然到期；恢复brain可能重建；F/Q/Z/R通用
- **关键不变量**：一caster保单一稳定id；mist与主体action独立
- **测试/风险**：[late-zones.test.mjs:240](../../scripts/late-zones.test.mjs#L240)仅全guardian节拍间接；未见mist身份/睡醒专测。风险：续命在brain、伤害在hazard，顺序决定是否出现一帧空隙

<a id="h11"></a>

### H11 喷发排程

- **所有者/定位**：[bosses/zone-hazards.ts:284](../../src/run/sim/bosses/zone-hazards.ts#L284)；[beats.ts:52](../../src/run/sim/beats.ts#L52)
- **编码与逻辑状态**：eruption.duration/life/length（下一发时刻）、world.hazards pending marks；scheduled→cadence-active→spent
- **守卫与转换**：age>=length且length<duration发下一轮并加every；按轮换活人、每屏warning<6、每人pending<2限额建fall
- **终态/取消/恢复**：初始eruption无caster；Q/Z删；F停；R保存length；错过预算轮不补
- **关键不变量**：持续10秒节拍、每人pending上限；各屏预算避免远队友饥饿
- **测试/风险**：[late-zones.test.mjs:404,535,619](../../scripts/late-zones.test.mjs#L404)。风险：length在此编码时钟，其他hazard是几何长度

<a id="h12"></a>

### H12 地表持续效果

- **所有者/定位**：[surface-effects.ts:19,35](../../src/run/sim/surface-effects.ts#L19)；[bosses/hazards.ts:110](../../src/run/sim/bosses/hazards.ts#L110)
- **编码与逻辑状态**：身处surface/patch + statuses time + global tick%15；outside→inside-sustain/pulse→outside-linger
- **守卫与转换**：水熄burn续wet；熔岩给非fire enemy burn；玩家熔岩/embers按节拍伤害；quicksand/pit拉动，pit续slow；ice见P02
- **终态/取消/恢复**：静态地形不消失，动态pit到期；离开后异常自然decay；Z清status/地形重建；R带地图和异常
- **关键不变量**：位置决定接触，status 记离开后的剩余；免疫/冲刺仍走 damagePlayer；环境 source=-1 的致死归属在 D04 转 null，不冒领玩家收益
- **测试/风险**：[zone-skills.test.mjs:460,478](../../scripts/zone-skills.test.mjs#L460)、[late-zones.test.mjs:183](../../scripts/late-zones.test.mjs#L183)。审计24 的“玩家 -1 不存在”是修复前真实火山地图上受控残血腕力的复现；当前环境致死已接 D04，定义见 [combat.test.mjs](../../scripts/combat.test.mjs)，不把旧复现或新测试外推成自然长局验收

## 8. 守卫 brain：9 个独立实现 + 13 个共享执行器分支

所有守卫先受 E 的 sleep/freeze interrupt 调度：回chase、phaseTime=0，删action/foresight；并不自动撤销独立已发射物/护盾，hazard按H规则取消。paralysis仅阻止代码明确检查的起手/追击。HP<一半通常是每次计算的guard，**不是独立的持久“狂暴phase”**；它与世界rampage不是同一机器。死亡走W10/Q，换区不恢复旧守卫；R保留phase/timer/辅助字段和hazard数组关系。

<a id="b01"></a>

### B01 飞天螳螂

- **所有者/定位**：[bosses/scyther.ts:36,117](../../src/run/sim/bosses/scyther.ts#L36)
- **编码与逻辑状态**：phase/phaseTime、attackTimer>0区分Air Slash；chase→dash-windup→dash→recover 或 slash-windup→chase
- **守卫与转换**：追逐够时长、范围、walkable、非blocked才dash；低HP且非blocked用Air Slash替代recover；attackTimer扣到0发radial blades
- **终态/取消/恢复**：E打断后重新chase；resumeChase给种子jitter；dash warning无caster可留到期；Q/Z/R通用
- **关键不变量**：同一个windup的两种子态由attackTimer判别；已windup的paralysis不取消
- **测试/风险**：[combat.test.mjs:468,482,505](../../scripts/combat.test.mjs#L468)。风险：attackTimer在此是倒计时，与其他boss的枚举/序号完全不同

<a id="b02"></a>

### B02 凯罗斯

- **所有者/定位**：[bosses/pinsir.ts:43](../../src/run/sim/bosses/pinsir.ts#L43)
- **编码与逻辑状态**：phase/phaseTime、attackTimer连slam余数、landing数组；chase→windup→jump→relock-chain或recover
- **守卫与转换**：范围+walkable；低HP起手chain3；每次落地可能shards；若余数且非blocked且可slam继续；短windup/长recover用phaseTime偏移
- **终态/取消/恢复**：E取消；missing circle转恢复；Q/Z/R通用
- **关键不变量**：attackTimer是余数非秒；shards低血实时判定，链长度起手确定
- **测试/风险**：[zone-skills.test.mjs:283](../../scripts/zone-skills.test.mjs#L283)。风险：负phaseTime用于长recover，是合法状态

<a id="b03"></a>

### B03 尼多王

- **所有者/定位**：[bosses/nidoking.ts:43,142](../../src/run/sim/bosses/nidoking.ts#L43)
- **编码与逻辑状态**：attackTimer攻击序号奇偶、phase、stomp hazard的dmg；chase→fissure-windup→active-lines→optional-stomp→recover；另一轮spikes即刻→chase
- **守卫与转换**：奇数fissure，偶数acid globs；低HP增加线数；跨FISSURE.active且非blocked触发stomp；等待stomping数组关系归零
- **终态/取消/恢复**：E/Q/Z；已飞acid独立；R保存序号/圈dmg
- **关键不变量**：每次边界跨越只发一次stomp；dash phase实际不位移
- **测试/风险**：[zone-skills.test.mjs:308](../../scripts/zone-skills.test.mjs#L308)。风险：只看phaseTime无法判断何时能进入recover

<a id="b04"></a>

### B04 穿山王

- **所有者/定位**：[bosses/sandslash.ts:44,97,122](../../src/run/sim/bosses/sandslash.ts#L44)
- **编码与逻辑状态**：attackTimer攻击序号、phase=under或windup/dash；dig/roll交替
- **守卫与转换**：dig需目标bodyFits；roll需walkable/range；首选不合法试另一种；成功才加序号；under到点落地，低HP留坑/碎片
- **终态/取消/恢复**：E唤醒在原处；Q/Z/R通用；dig recovery用负偏移
- **关键不变量**：under不受攻击/接触；dig与roll有不同恢复时间，不能从union值单看
- **测试/风险**：[zone-skills.test.mjs:521](../../scripts/zone-skills.test.mjs#L521)。风险：只序号递增成功，和共享新boss失败也轮换不同

<a id="b05"></a>

### B05 嘎啦嘎啦

- **所有者/定位**：[bosses/marowak.ts:49](../../src/run/sim/bosses/marowak.ts#L49)
- **编码与逻辑状态**：attackTimer=THROW/CLUB/RING、bonesOut、phaseTime；throw windup→bones-in-flight-walking→chase；club→recover→ring-wait+rest
- **守卫与转换**：range/非blocked/无在途骨；近处club，远处throw；低HP双骨；club后低HP且非blocked放环；环没回收时phaseTime反复0
- **终态/取消/恢复**：E重置phase仍可能等bonesOut；已飞骨H05；Q/Z/R通用
- **关键不变量**：同一轮新throw等所有骨回收；RING recover从最后骨回收后算
- **测试/风险**：[zone-skills.test.mjs:571](../../scripts/zone-skills.test.mjs#L571)。风险：attackTimer是三个命令常量，不是冷却

<a id="b06"></a>

### B06 化石翼龙

- **所有者/定位**：[bosses/aerodactyl.ts:41](../../src/run/sim/bosses/aerodactyl.ts#L41)
- **编码与逻辑状态**：attackTimer奇偶、strikes、phase；dive-windup→dash→reaim-dive或recover；rockSlide并行
- **守卫与转换**：正常交替dive/rock；低HP所有轮次double-dive，最后附rock；blocked可截链/不发rock
- **终态/取消/恢复**：E/Q/Z/R；飞行跨nav障碍但warning/落石独立
- **关键不变量**：strikes是剩余dive；短第二次windup用phaseTime偏移
- **测试/风险**：[zone-skills.test.mjs:602](../../scripts/zone-skills.test.mjs#L602)。风险：低血状态在循环中重读，不是整轮快照

<a id="b07"></a>

### B07 巨钳蟹

- **所有者/定位**：[bosses/kingler.ts:58](../../src/run/sim/bosses/kingler.ts#L58)
- **编码与逻辑状态**：attackTimer=HAMMER/BUBBLES/RUSH、strikes、phase；近hammer、远moving-bubble-windup、低HP双rush→hammer
- **守卫与转换**：低HP/距离/walkable优先rush；其他近hammer/远bubble；chained rush重新aim；blocked截链；bubble release再查视线
- **终态/取消/恢复**：E/Q/Z/R；warning失caster按H；bubble已发独立
- **关键不变量**：bubble windup期间继续行走；hammer/rush windup静止；相同phase不同motion
- **测试/风险**：[zone-skills.test.mjs:735](../../scripts/zone-skills.test.mjs#L735)。风险：不能用phase=windup一律令speed=0

<a id="b08"></a>

### B08 暴鲤龙

- **所有者/定位**：[bosses/gyarados.ts:39,94](../../src/run/sim/bosses/gyarados.ts#L39)
- **编码与逻辑状态**：attackTimer奇偶/strikes + twistersOut；pump-windup→beam-active→chain-pump/recover；twister-release→chase
- **守卫与转换**：正常轮到twister且没有上一组才放，否则pump；低HP改三pump；blocked截续段；低HP休息更长
- **终态/取消/恢复**：E/Q/Z/R；twister H09可独立追踪
- **关键不变量**：twistersOut由数组成员锁，不是倒计时；dash phase是beam active静止
- **测试/风险**：[zone-skills.test.mjs:786](../../scripts/zone-skills.test.mjs#L786)。风险：已删caster并不自动清twister，清场由Q兜住

<a id="b09"></a>

### B09 宝石海星

- **所有者/定位**：[bosses/starmie.ts:46](../../src/run/sim/bosses/starmie.ts#L46)
- **编码与逻辑状态**：attackTimer奇偶、strikes、phaseTime、dash方向；odd zigzag→recover；even moving-bolt-sequence→chase
- **守卫与转换**：奇数spin、偶数bolt（以代码为准）；spin预先画全路径；dash每segment减strikes改方向；bolt每gap减strikes锁新目标点
- **终态/取消/恢复**：E取消整轮；paralysis不取消已运行spin/volley；Q/Z/R
- **关键不变量**：spin与bolt复用dash/strikes但计时含义不同；低HP增加数量
- **测试/风险**：[zone-skills.test.mjs:837](../../scripts/zone-skills.test.mjs#L837)。风险：文件注释的“odd bolts”与代码奇偶相反，审计不沿用错误注释

<a id="b10"></a>

### B10 共享守卫执行器

- **所有者/定位**：[bosses/zone-kit.ts:23](../../src/run/sim/bosses/zone-kit.ts#L23)；[bosses/zone-guardians.ts:537,582](../../src/run/sim/bosses/zone-guardians.ts#L537)
- **编码与逻辑状态**：optional action{attack,windup,active,recover,speed,chain,gap}，phase/phaseTime/attackTimer；chase→windup或under→dash(active)→chain或recover→chase
- **守卫与转换**：追逐够时长、<20、非blocked、!bonesOut才choose；按species+序号；失败也推进序号；>=windup release；>=active complete；>=recover删action
- **终态/取消/恢复**：E删除action/foresight；R必须保存二者；Q/Z删除；已有hazard自管
- **关键不变量**：非chase阶段需要action；dash不总代表身体冲刺；部分choose仅发hazard并立即返回chase
- **测试/风险**：[late-zones.test.mjs:240,601](../../scripts/late-zones.test.mjs#L240)。风险：`attack:string`不能静态保证所有action名、phase、字段搭配合法

<a id="b11"></a>

### B11 鬼斯通守卫

- **所有者/定位**：[bosses/zone-guardians.ts:332,37,474](../../src/run/sim/bosses/zone-guardians.ts#L332)
- **编码与逻辑状态**：B10，turn%2；haunter-guardian shadow / night-shade
- **守卫与转换**：odd under锁落点→释放→低HP重复shadow→最终ghost burst；even风up锁5lane→shots
- **终态/取消/恢复**：E/Q/Z/R；shadow mark丢失无落地hit；低HP连段仍受attacksBlocked
- **关键不变量**：shadow短暂under不可选中，夜影沿原warning发射
- **测试/风险**：[late-zones.test.mjs:266,571](../../scripts/late-zones.test.mjs#L266)。风险：chain收尾与harmless residue是不同对象

<a id="b12"></a>

### B12 臭臭泥

- **所有者/定位**：[bosses/zone-guardians.ts:340,540,590](../../src/run/sim/bosses/zone-guardians.ts#L340)
- **编码与逻辑状态**：B10 turn%2 + sludgeTrail；muk falls / sludge-slam
- **守卫与转换**：odd落毒圈后回chase；even合法walkable才跳slam；落地留pool，低HP加毒shot；chase/dash每15tick留trail
- **终态/取消/恢复**：E/Q/Z/R；已留pool独立；失败转下一招
- **关键不变量**：身体落点由landing圈；trail与主动攻击正交
- **测试/风险**：[late-zones.test.mjs:293,601](../../scripts/late-zones.test.mjs#L293)。风险：trail按world.tick发，非action timer

<a id="b13"></a>

### B13 魔墙人偶

- **所有者/定位**：[bosses/zone-guardians.ts:348,151,190](../../src/run/sim/bosses/zone-guardians.ts#L348)
- **编码与逻辑状态**：B10 turn%2 + hardened/closing-box/orbit-less shield；mr-mime cage / light-shield
- **守卫与转换**：odd closing-box，low双盒；even直接dash shield，同时创建有独立windup的beam
- **终态/取消/恢复**：E取消brain动作但不把hardened置0；hazards按activeCaster取消；Q/Z/R
- **关键不变量**：盾和beam两时钟；盒有gap与hit[]独立记忆
- **测试/风险**：[late-zones.test.mjs:304,463](../../scripts/late-zones.test.mjs#L304)。风险：shield持续时phase并不windup

<a id="b14"></a>

### B14 大嘴蝠

- **所有者/定位**：[bosses/zone-guardians.ts:352,78,564](../../src/run/sim/bosses/zone-guardians.ts#L352)
- **编码与逻辑状态**：B10 turn%2；golbat sonic / dive-chain
- **守卫与转换**：odd sonic cone；evendive，low重复dive后sonicBurst
- **终态/取消/恢复**：E/Q/Z/R；已出shot独立；低HP/blocked决定续段
- **关键不变量**：近身扇形和飞行长lane两套几何；dash链次数锁进action
- **测试/风险**：[late-zones.test.mjs:240](../../scripts/late-zones.test.mjs#L240)间接覆盖全13；未见此species所有分支单独长测试

<a id="b15"></a>

### B15 胡地

- **所有者/定位**：[bosses/zone-guardians.ts:376,222,614](../../src/run/sim/bosses/zone-guardians.ts#L376)
- **编码与逻辑状态**：B10 turn%3 + foresight{left,timer}；alakazam blink / psychic-fan / future-sight
- **守卫与转换**：1合法blink→under→传送；low结束接fan；2 fan；0启动独立延迟落点序列后chase
- **终态/取消/恢复**：E同时取消foresight；attacksBlocked暂停其timer；Q/Z/R保留或清场
- **关键不变量**：预知未来运行期间主体可继续其他phase；每次pulse记录当时目标点
- **测试/风险**：[late-zones.test.mjs:333](../../scripts/late-zones.test.mjs#L333)。风险：仅保存action无法恢复整场攻击

<a id="b16"></a>

### B16 幽灵嘎啦嘎啦

- **所有者/定位**：[bosses/zone-guardians.ts:385,241,263,645](../../src/run/sim/bosses/zone-guardians.ts#L385)
- **编码与逻辑状态**：B10 + bonesOut + ghost-fire数量；marowak-ghost shadow-bones / ghost-fires / bone-club
- **守卫与转换**：low近距优先club；每3轮ghostFires补到上限；其他shadowBones锁count，release穿墙骨；dash等骨返回，lowclub后补fire
- **终态/取消/恢复**：E/Q/Z/R；已出ghost-fire和骨各自H05/H09
- **关键不变量**：warning时锁定骨数量，HP跨半不改已预告count；ghost-fire池数量上限
- **测试/风险**：[late-zones.test.mjs:437,560](../../scripts/late-zones.test.mjs#L437)。风险：a.chain这里编码骨数，不是B10一般续段数（complete只匹配特定attack分支）

<a id="b17"></a>

### B17 耿鬼

- **所有者/定位**：[bosses/zone-guardians.ts:393,283](../../src/run/sim/bosses/zone-guardians.ts#L393)
- **编码与逻辑状态**：B10 turn%3 + curse-mark；gengar shadow-ball / shadow-chain / curse
- **守卫与转换**：1锁3lane并发留毒pool球；2 under shadow连；0 curse，low点两活人，第二个delay0.5
- **终态/取消/恢复**：E/Q/Z/R；诅咒标H10c跟随→锁定，不属于主体action
- **关键不变量**：诅咒跟随时目标死亡才取消；锁定后按圈伤活人
- **测试/风险**：[late-zones.test.mjs:266,333,571](../../scripts/late-zones.test.mjs#L266)。风险：curse choose直接chase，主体无需等所有标记爆炸

<a id="b18"></a>

### B18 白海狮

- **所有者/定位**：[bosses/zone-guardians.ts:402,516,647](../../src/run/sim/bosses/zone-guardians.ts#L402)
- **编码与逻辑状态**：B10 turn%2 + ice-trail.length/life/caster；dewgong freeze-beam / slide
- **守卫与转换**：odd beam；even slide，低HP连滑并落冰；active时延长trail，末尾脱离caster
- **终态/取消/恢复**：E/Q/Z/R；trail到期前继续影响玩家惯性
- **关键不变量**：冰迹寿命独立于brain恢复；slide方向锁定，低血决定chain
- **测试/风险**：[late-zones.test.mjs:360](../../scripts/late-zones.test.mjs#L360)。风险：中断发生在trail.caster=-1之前/之后影响增长而非统一删除

<a id="b19"></a>

### B19 铁甲贝

- **所有者/定位**：[bosses/zone-guardians.ts:409,151](../../src/run/sim/bosses/zone-guardians.ts#L409)
- **编码与逻辑状态**：B10 turn%2 + hardened/orbit；cloyster icicle-fan / shell
- **守卫与转换**：odd7lane投射，recover直接设未缩放常量；even立刻shield-active带orbit，low附falls
- **终态/取消/恢复**：E/Q/Z/R；orbit随caster中断，hardened继续自然衰减
- **关键不变量**：盾减伤只hardened>0；投射用exact warned lanes
- **测试/风险**：[late-zones.test.mjs:360,463,505,571](../../scripts/late-zones.test.mjs#L360)。风险：此fan recovery有特例，不可统一乘telegraphScale

<a id="b20"></a>

### B20 拉普拉斯

- **所有者/定位**：[bosses/zone-guardians.ts:417,596](../../src/run/sim/bosses/zone-guardians.ts#L417)
- **编码与逻辑状态**：B10 turn奇偶/模3 + 单一ice-mist；lapras freeze-fan / delayed-falls / low-song
- **守卫与转换**：low且turn%3=0先song，否则奇beam偶falls；low持续刷新mist.life或创建一个
- **终态/取消/恢复**：E使mist取消，恢复brain可重建；Q/Z/R；falls按delay
- **关键不变量**：mist为独立稳定id；shot/落冰/song可与mist并行
- **测试/风险**：[late-zones.test.mjs:240,505](../../scripts/late-zones.test.mjs#L240)主要间接；未见mist唯一身份/反复睡醒专测

<a id="b21"></a>

### B21 鸭嘴火兽

- **所有者/定位**：[bosses/zone-guardians.ts:427,474](../../src/run/sim/bosses/zone-guardians.ts#L427)
- **编码与逻辑状态**：B10 turn%2；magmar flame-fan / lava-dive
- **守卫与转换**：odd3beam；even under落地，留6秒fire pool，low附burst
- **终态/取消/恢复**：E/Q/Z/R；pool释放后独立
- **关键不变量**：lava-dive不是移动dash，是teleport landing；不把火地伤害归成body contact
- **测试/风险**：[late-zones.test.mjs:380](../../scripts/late-zones.test.mjs#L380)

<a id="b22"></a>

### B22 风速狗

- **所有者/定位**：[bosses/zone-guardians.ts:435,306,564](../../src/run/sim/bosses/zone-guardians.ts#L435)
- **编码与逻辑状态**：B10 turn%2 + chained dash + trail；arcanine extreme-speed / flame-ring
- **守卫与转换**：odd连续extreme dashes（每次短gap）；low留burning trail，最后接fire-blast；even六点缺一口flameRing
- **终态/取消/恢复**：E/Q/Z/R；落圈/火地独立
- **关键不变量**：有出口的环是6/7点；三冲和fire-blast是顺序子态
- **测试/风险**：[late-zones.test.mjs:380,601](../../scripts/late-zones.test.mjs#L380)。风险：通用action.chain只在complete特定attack才续

<a id="b23"></a>

### B23 快龙

- **所有者/定位**：[bosses/zone-guardians.ts:439](../../src/run/sim/bosses/zone-guardians.ts#L439)
- **编码与逻辑状态**：B10 turn奇偶/模3；dragonite hyper-beam / meteor-falls / low-hyper-sweep
- **守卫与转换**：low且%3=0 sweep优先，否则oddbeam/even延迟meteor池
- **终态/取消/恢复**：E/Q/Z/R；释放后的active sweep不再依赖caster（H06）
- **关键不变量**：sweep按当前角度与cover判定，不是整片warning全伤害
- **测试/风险**：[late-zones.test.mjs:380,505](../../scripts/late-zones.test.mjs#L380)

<a id="b24"></a>

### B24 未来预知并行排程

- **所有者/定位**：[bosses/zone-guardians.ts:381,614](../../src/run/sim/bosses/zone-guardians.ts#L381)
- **编码与逻辑状态**：foresight可选对象、left/timer；absent→scheduled-multi-record→drained→absent
- **守卫与转换**：独立于phase每0.5秒锁一次当时target，left--，发有2×tele延迟的boss-fall；blocked暂停
- **终态/取消/恢复**：interrupted删除；已创建fall按caster生命周期；Q/Z删；R保存left和timer
- **关键不变量**：不是一次将所有圈放在同坐标；暂停后保持未录数量
- **测试/风险**：[late-zones.test.mjs:333](../../scripts/late-zones.test.mjs#L333)。风险：choose后来再写foresight会覆盖旧对象，持续任务与主体时钟要一起审

<a id="b25"></a>

### B25 硬化护盾并行计时

- **所有者/定位**：[bosses/zone-guardians.ts:151](../../src/run/sim/bosses/zone-guardians.ts#L151)；[enemies.ts:51](../../src/run/sim/enemies.ts#L51)；[combat.ts:156](../../src/run/sim/combat.ts#L156)
- **编码与逻辑状态**：hardened/hardenDamage；open→shield-active→open，与action phase并行
- **守卫与转换**：shield直接设duration与倍率，enemy loop减timer，direct-hit读取；DoT绕过
- **终态/取消/恢复**：interrupt不会清hardened；Q/Z删除；R保留数值；expire后hardenDamage残留但不生效
- **关键不变量**：不用action存在性判断shield；不能把DoT当direct hit减伤
- **测试/风险**：[late-zones.test.mjs:463](../../scripts/late-zones.test.mjs#L463)。风险：复用harden与guardian shield的默认倍率规则需保留

H10a–H10d 的 box/orbit/curse/mist 是各自并行子机器，B13/B17/B19/B20通过对象关系启动它们；不应将“一个brain函数”误认成“一个有限状态变量”。

## 9. 模拟基础设施与宿主交接的状态

这里列的是影响复现/恢复的基础设施机器，与前述玩法机器分开。一般数学和同步算法scratch不计为玩法状态机。

<a id="i01"></a>

### I01 导航流场增量搜索

- **所有者/定位**：[nav/flow.ts:21,92,129,181](../../src/run/sim/nav/flow.ts#L21)；[nav/nav.ts:50](../../src/run/sim/nav/nav.ts#L50)
- **编码与逻辑状态**：layer.field存在性、dirty/seeds/published/demand、nav.clock/cursor、flow.layer/settled/queue；unrequested→requested-unpublished→integrating→published→stale→refresh；idle-no-demand
- **守卫与转换**：request标记需求；目标换格/blocker dirty且仍有demand才轮询；每tick预算结算；queue空交换work/cost并发布；无活人target不继续
- **终态/取消/恢复**：F暂停；Z新nav；R按published seeds全算再重放settled前缀；运行搜索不被新目标抢断
- **关键不变量**：永不向reader暴露半成品work；层创建顺序是调度顺序；无需求层不刷
- **测试/风险**：[nav.test.mjs:396,411,473](../../scripts/nav.test.mjs#L396)、[snapshot.test.mjs:185](../../scripts/snapshot.test.mjs#L185)。风险：dirty变更中途的恢复依赖当时blocker重建是否等价；只序列化cost或只记目标都不够

<a id="i02"></a>

### I02 动态阻挡器

- **所有者/定位**：[nav/blockers.ts:14,23,31](../../src/run/sim/nav/blockers.ts#L14)
- **编码与逻辑状态**：blockers[]/nextBlockerId、grid hard/soft/near计数、field.dirty；absent→installed→removed（id不复用）
- **守卫与转换**：安装加对应网格引用计数；移除必须找到id并扣；dirty置true
- **终态/取消/恢复**：Z整nav替换；R按安装顺序和id重建；重复remove显式失败
- **关键不变量**：重叠blocker彼此独立；地形pass不因动态blocker重算
- **测试/风险**：[nav.test.mjs:411](../../scripts/nav.test.mjs#L411)、[mapgen.test.mjs:301,376](../../scripts/mapgen.test.mjs#L301)。风险：快照恢复不是只拷贝blocker坐标，引用计数/排序需重建

<a id="i03"></a>

### I03 世界/导航快照恢复

- **所有者/定位**：[snapshot.ts:26,41,60](../../src/run/sim/snapshot.ts#L26)；[nav/continuation.ts:21,44](../../src/run/sim/nav/continuation.ts#L21)
- **编码与逻辑状态**：version=3/mapDigest、dynamic、navigation continuation（layers[].mobility/field）；live→detached-snapshot→validated-restored 或 rejected
- **守卫与转换**：dynamic 与 navigation 都经 plain 校验，只允许普通有限数据；map 匹配；nav profile 编码为已知 mobility 类，恢复时从 mobilityClasses 取完整 profile，保留 water/游泳/两栖语义，再恢复层顺序、发布场及运行队列；未知类别或顺序不符显式失败
- **终态/取消/恢复**：不改原world/snapshot；恢复不是new-run初始化；Z与R是不同动作（Z有意取消很多状态）
- **关键不变量**：snapshot 无 mutable alias；nav 缓存不靠旧进程；不把 profile 中的 Infinity 直接序列化；新 World 字段必须普通数据。导航修复2→3、增援压力3→4均与progress v4/存档外壳v3无关，没有旧快照迁移
- **测试/风险**：**#23** 的六图网络 codec 往返、coast 活跃导航续跑及非法 mobility 定位在 [snapshot.test.mjs](../../scripts/snapshot.test.mjs)；[coop.test.mjs](../../scripts/coop.test.mjs) 为相关恢复测试。未覆盖全部 boss/hazard 暂停点或所有 gameplay union 关系，不代表正式页面联机/全部种子验收

<a id="i04"></a>

### I04 派生属性缓存

- **所有者/定位**：[stats.ts:292](../../src/run/sim/stats.ts#L292)
- **编码与逻辑状态**：module generation + WeakMap[player]{generation,low,stats}；absent/stale→computed→cached→invalidated
- **守卫与转换**：每tick和升级refresh；LOW_HP跨阈值read立即重新算；同代不变则复用
- **终态/取消/恢复**：不进R，恢复新对象冷缓存；Z后下一step refresh；F期间command修改需使用playerStats等fresh入口
- **关键不变量**：顺序是契约，tick trigger修改fx通常下一tick进stats；纯fold不是机器
- **测试/风险**：[stats.test.mjs:21](../../scripts/stats.test.mjs#L21)、[triggered-items.test.mjs:130](../../scripts/triggered-items.test.mjs#L130)、snapshot跨worker；风险：同tick修改属性但没refresh可读旧值，不能随意新增内部写入

<a id="i05"></a>

### I05 事件排空与HUD快照

- **所有者/定位**：[createRun.ts:399,812,853](../../src/run/createRun.ts#L399)；[state/events.ts:1](../../src/run/sim/state/events.ts#L1)
- **编码与逻辑状态**：world.events队列、snapshotTimer/lastPending/lastDialog/lastSnapshot；events-pending→drained/published；snapshot-dirty→sent→unchanged-suppressed
- **守卫与转换**：每帧splice事件并分shared副本；HUD0.1秒或pending/dialog引用变或首次terminal时快照；JSON相等不发
- **终态/取消/恢复**：Z保world.events待drain；R带未排空events但不带host的lastSnapshot；dispose放弃未消费presentation
- **关键不变量**：events是输出事实，消费不应倒灌sim；卡id变/同引用对象变化需定时snapshot弥补
- **测试/风险**：[snapshot.test.mjs:130,185](../../scripts/snapshot.test.mjs#L130)覆盖未drain事件；UI tests主要消费层。风险：重连恢复事件是否重复播由network边界负责，本轮未展开

<a id="i06"></a>

### I06 地图准备与验收重试

- **所有者/定位**：[world.ts:130](../../src/run/sim/world.ts#L130)；[zones.ts:90,133](../../src/run/sim/zones.ts#L90)
- **编码与逻辑状态**：seed attempt、scratch world/Field、prepared.zone；candidate→validated→accepted 或 rejected→retry→failed
- **守卫与转换**：仅MapGenError允许有限8次换seed；其他错误上抛；zone派生seed固定，prepare不消费live ids
- **终态/取消/恢复**：成功Field才交enterZone；失败不安装；build/changeZone错误走W09；不通过快照恢复局部同步循环
- **关键不变量**：未验收field不替换live；新局seed来源在宿主，模拟内部seed固定
- **测试/风险**：[mapgen.test.mjs:213,220](../../scripts/mapgen.test.mjs#L213)、[zones.test.mjs:187](../../scripts/zones.test.mjs#L187)。这是准备事务的一部分，不把每个地图数学步骤当状态机

导航恢复的历史失败（审计23）：修复前六图 seed7 双人新世界里，coast 的 swim/amphibious 层在直接恢复时拒绝 Infinity，经网络 codec 后又丢失 water；其余五图在该次检查中通过。当前 I03 已改用快照 v3 的 mobility 类与完整有限数据校验；本次未重跑该历史复现。

多人执行模式边界也在范围内：[world.ts:383,388,391,428,462](../../src/run/sim/world.ts#L383) 分别提供全量step、shared step与owner attack step。shared只更新本机新施放/移动，健康、异常、procWindow等仍走共享updatePlayer；owner step不推进world.time、director或共享生命，但继续本机攻击。[attacks.ts:63,122,134](../../src/run/sim/attacks.ts#L63) 的所有权筛选还读取**实体id符号**：attackOwner不匹配且id<0才跳过，不能概括成“所有非本机实体都跳过”。[combat.ts:25,40,82,127](../../src/run/sim/combat.ts#L25) 的Ctx.report将hit/status/pull/heal变为事实输出，commitCombat再核对敌人存在/活着/targetable后结算，命中不重测host空间范围；函数自身没有packet序号去重。这里的模式由调用入口传入，未再虚构一个sim内持久enum；排队、revision、确认、重放、去重是`src/network/**`的外部状态机，本轮明确未展开。关联测试源码：[scripts/network.test.mjs:498,1294,1333,1371,1486](../../scripts/network.test.mjs#L498)，不是本轮运行证据。

额外状态容器核对：

- [grid.ts:10](../../src/run/sim/grid.ts#L10) 的cells/used由world每次重建，是本tick派生空间索引；非跨tick玩法机器，但调用顺序决定under是否被候选检索排除。[world.ts:399,404,406](../../src/run/sim/world.ts#L399) 三次重建在玩家/导演/敌人阶段之间。
- [nav/astar.ts:34](../../src/run/sim/nav/astar.ts#L34) 的stamp/seen/heap/chain在每次同步findPath重置并完成；[nav/heap.ts](../../src/run/sim/nav/heap.ts) queue有empty/nonempty，不是独立游戏行为。[nav/buckets.ts](../../src/run/sim/nav/buckets.ts) 的队列则作为 I01 的**跨tick搜索状态**必须恢复。
- [nav/movement.ts:30,114](../../src/run/sim/nav/movement.ts#L30) 的normal/wallContact是同步move-and-slide临时scratch，每次projection重设；[math.ts:70](../../src/run/sim/math.ts#L70) 的reducedHi/reducedLo同样为同步数值scratch。没有把它们作为独立玩法机器。
- [sight.ts:72](../../src/run/sim/sight.ts#L72) solidsOf是按不可变obstacle数组缓存；跨区换数组、新进程重建，不携带玩法历史。若以后原地改obstacle数组会破坏缓存假设。
- [triggers/index.ts:61](../../src/run/sim/triggers/index.ts#L61) lazy registry、[ultimates/index.ts:24](../../src/run/sim/ultimates/index.ts#L24) sorted timelines、[content/lines/index.ts:69](../../src/run/sim/content/lines/index.ts#L69) form映射都是模块初始化缓存；与 T11 的动态重入锁不同。
- [rng.ts:2](../../src/run/sim/rng.ts#L2) 的mulberry32 state是全局确定性历史，R保留、Z重种，已在W07/D01记录；数值递推本身不列为游戏状态机。
- [movement.ts](../../src/run/sim/movement.ts) weave/strafe、[wind.ts](../../src/run/sim/wind.ts)、[noise.ts](../../src/run/sim/noise.ts)、[viewFootprint.ts](../../src/run/sim/viewFootprint.ts)、surface采样、terrain几何、type倍率、rarity/升级系数、stat fold是即时派生或纯函数。没有因其含if/union就算一个机器。
- `mapgen/{layout,pads,playable,props,puddles,sites,spec,stamps,types,validate,walls,water}.ts` 是 I06 内同步生成/验收管线：放pad有限候选、puddle缩放重试、prop尝试计数均不跨tick；没有隐藏的运行期地图演化机器。生成的immutable map供模拟读取。

## 10. 跨区与恢复矩阵（容易遗漏的状态）

| 状态                                                         | 死亡 / 清场                                                 | enterZone                                                     | snapshot/restore                      |
| ------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------- |
| 玩家 pending/options/id、成长、banished、tmCase、消耗次数fx  | 倒地保留，选择隐藏；清场复活后可用                          | 保留；多人choosing=false                                      | 保留                                  |
| input、vx/vz、moving、dashTime、dialog、rescue               | 各取消路径分别处理；死亡不保证每运动字段即时归零            | 全清并重定位                                                  | 原样保留，恢复不是取消                |
| dash库存/回充、move cooldown/waiting、HP/盾、lastHurt/iframe | 死亡不继续玩家tick；复活赋HP与iframe但不补满所有资源        | 保留                                                          | 保留                                  |
| 玩家status                                                   | 死亡时仍可能保留，revive清；F停decay                        | 清空                                                          | 保留剩余time/source/stacks            |
| ult charge/room vs elapsed/next/stage/path/crossed           | 死亡elapsed=-1；不refund；已产生别的攻击对象不自动删        | elapsed=-1、crossed=[]，charge/room保留；其他inactive游标残留 | 全保留，活cast续timeline              |
| Player.fx 的seen/dashing/still/burst/stored/uses/time        | 不统一清；tick trigger死亡/救援停；已飞攻击仍可触发hit/kill | **全部保留**                                                  | 全保留                                |
| partner cooldown/guard                                       | owner倒下停止扣；clear保留同伴                              | 保留timer并移到owner身后                                      | 保留                                  |
| Enemy phase/timers/action/foresight/harden/charge/status     | 战斗死亡或无奖离场；Q硬删                                   | 全删                                                          | 全保留                                |
| projectiles、area、hazards                                   | owner死后不少效果继续；Q直接清空不执行expire                | 全删，不触发finale/land                                       | 连同命中集合/哨兵/延迟一起保留        |
| pickups                                                      | clear磁吸；全灭后冻结                                       | 出口已结清，安装时清空                                        | 保留                                  |
| station id/used                                              | 死亡不恢复次数                                              | **slot+kind**相同时沿用                                       | 保留                                  |
| director pool/fired/credit/anchor、zone tick/rampage/boss    | cleared停止director；rampage不立即回false                   | 重置                                                          | 保留                                  |
| world time/tick/nextId、RNG                                  | playing推进；终态停止                                       | time/tick/nextId续，RNG换zone流                               | 全保留                                |
| nav flow运行队列/dirty/demand/cursor                         | playing刷新；F停；不直接由death取消，活target集改变         | 新nav并prime                                                  | 按continuation重放                    |
| createRun flags/accumulator/hold/report/snapshot节流         | 宿主生命周期决定                                            | clearing accumulator、重新warm                                | 不进world快照，需network/宿主单独负责 |

## 11. 主要结论与证据边界

1. 状态空间是 **多个正交机器的乘积**：world pause/outcome、zone生命周期、每玩家卡/站点/生命/救援/动作、每个施法者与每个hazard的时序并行。列World enum无法覆盖当前实现。
2. 最高密度的隐式编码是 `Enemy.attackTimer`（倒计时、攻击奇偶序号、攻击kind常量、连段余数）、`phase="dash"`（冲刺/跳跃/静止beam/在途骨头/施法有效期）、`Area.released`（开场锁/累计发射数）和 `Hazard.length/dmg/caster`（几何/计时/一次结算/所有权）。不能给同名字段假设统一语义。
3. **取消是分层且不一致的**：普通telegraph、slowShots、持续aura的sleep/paralysis规则不同；一些beam/fall只在windup查caster，另一些直到hit都查；旧guardian的无caster warning可留到期。清场/换区是硬取消，不触发自然到期爆炸或融合finale。
4. **Z与R是不同契约**：换区有意取消攻击和异常但保留成长/冷却/fx；快照则应恢复整个未完进程，包括foresight、pending id、bone返程、已命中集合、流场搜索进度。仅“JSON可序列化”不是状态恢复充分条件。
5. 已有测试对9种旧brain、13种新guardian公共节拍、普通技能、卡队列、区域清场、救援和确定性有相当多行为断言；但不是每个机器/每条取消边的完整覆盖。createRun异步准备/失败/结算closure、fx采样跨区、ghost-fire/ice-mist等仍主要是间接测试或缺少专测。
6. **候选与后续复核**：H12 环境 DoT 归属与 I03 导航恢复的审计23/24 已有本批源码修复，见对应条目。其余初次盘点候选未在本次改动：H01 普通敌方 shot 命中后未跳出 player 循环；T05b 跨区保留 `:dashing` 而清 dashTime 可产生新区结束边沿；W01 终态后 applyCommand 仍可改状态，依赖宿主输入/调用约束。它们仍需核对预期和可达性，不把盘点当验收。

范围完整性与明确未审：

- 本次完成了给定sim目录的逐文件枚举、声明/状态写入扫描、所有运行注册族与核心转换路径核对，枚举映射在附录；没有故意排除某个普通技能或守卫brain。同步几何/数值/算法循环的非机器判定见第9节。
- `src/network/**`、[src/run/session.ts](../../src/run/session.ts)、[src/app/session.ts](../../src/app/session.ts)、渲染/VFX/音频、平台、存档/结算持久化内部不在本请求范围。只记录createRun对这些模块的调用边界，不宣称审完重连协议、UI过场或onEnd入账实现。
- 没有运行任何游戏模拟测试、golden、浏览器、native、手机或多人实机；也没有新建测试、录屏或证明所有可达状态组合穷尽。表内测试是既有源码定位，不是此次通过证据。
- 已按要求读README、docs/README、STATUS、CLAUDE。盘点时主规范仍在本次接入change内，尚未归档；当前规范位于 `openspec/specs/{simulation,combat-builds,world-progression}/spec.md`。本页源码地图不把规范结构验证当作行为通过。
- 工作树存在其他人在改的文档/配置；本报告的line和hash是一个读取快照，后续引用须按manifest比对。未改动这些文件。

## 附录 A. 普通敌人技能注册项 → 实现模块 → 物种

[skills/index.ts:97](../../src/run/sim/skills/index.ts#L97) 的 **60 个注册项**全部列出。K01是共享telegraph骨架，以下K项说明各运行族；同一行的物种只改参数，不复制成独立机器。物种key来自[content/enemies.ts](../../src/run/sim/content/enemies.ts)。

| 注册项            | 机器 / 定义位置                                                                | 使用物种                                                                                 |
| ----------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `trail`           | K10b；[skills/trail.ts:31](../../src/run/sim/skills/trail.ts#L31)              | 臭泥 `grimer`                                                                            |
| `teleport`        | K12；[skills/teleport.ts:36](../../src/run/sim/skills/teleport.ts#L36)         | 勇基拉 `kadabra`                                                                         |
| `sing`            | K06；[skills/radial.ts:51](../../src/run/sim/skills/radial.ts#L51)             | 胖丁 `jigglypuff`                                                                        |
| `sing-wide`       | K06；[skills/radial.ts:52](../../src/run/sim/skills/radial.ts#L52)             | 胖可丁 `wigglytuff`                                                                      |
| `dragon-pulse`    | K06；[skills/radial.ts:53](../../src/run/sim/skills/radial.ts#L53)             | 迷你龙 `dratini`                                                                         |
| `icicle`          | K03；[skills/shot.ts:149](../../src/run/sim/skills/shot.ts#L149)               | 大舌贝 `shellder`                                                                        |
| `flamethrower`    | K03；[skills/shot.ts:150](../../src/run/sim/skills/shot.ts#L150)               | 九尾 `ninetales`                                                                         |
| `ice-beam`        | K05；[skills/psybeam.ts:84](../../src/run/sim/skills/psybeam.ts#L84)           | 迷唇姐 `jynx`                                                                            |
| `belly-slide`     | K02；[skills/lunge.ts:83](../../src/run/sim/skills/lunge.ts#L83)               | 小海狮 `seel`                                                                            |
| `fire-punch`      | K02；[skills/lunge.ts:84](../../src/run/sim/skills/lunge.ts#L84)               | 快拳郎 `hitmonchan`                                                                      |
| `melt`            | K07；[skills/landing.ts:207](../../src/run/sim/skills/landing.ts#L207)         | 水伊布 `vaporeon`                                                                        |
| `body-slam`       | K07；[skills/landing.ts:208](../../src/run/sim/skills/landing.ts#L208)         | 卡比兽 `snorlax`                                                                         |
| `triple-burrow`   | K07；[skills/landing.ts:209](../../src/run/sim/skills/landing.ts#L209)         | 三地鼠 `dugtrio`                                                                         |
| `fire-aura`       | K10a；[skills/aura.ts:41](../../src/run/sim/skills/aura.ts#L41)                | 火伊布 `flareon`                                                                         |
| `dive`            | K02；[skills/lunge.ts:88](../../src/run/sim/skills/lunge.ts#L88)               | 烈雀 `spearow`、大针蜂 `beedrill`、比比鸟 `pidgeotto`、大嘴雀 `fearow`                   |
| `roll`            | K02；[skills/lunge.ts:89](../../src/run/sim/skills/lunge.ts#L89)               | 小拳石 `geodude`、隆隆石 `graveler`、隆隆岩 `golem`、穿山鼠 `sandshrew`、海星星 `staryu` |
| `acid`            | K04；[skills/acid.ts:120](../../src/run/sim/skills/acid.ts#L120)               | 阿柏蛇 `ekans`、臭臭花 `gloom`、阿柏怪 `arbok`                                           |
| `stun-spore`      | K05；[skills/stunSpore.ts:13](../../src/run/sim/skills/stunSpore.ts#L13)       | 派拉斯 `paras`、巴大蝶 `butterfree`、派拉斯特 `parasect`、霸王花 `vileplume`             |
| `psybeam`         | K05；[skills/psybeam.ts:85](../../src/run/sim/skills/psybeam.ts#L85)           | 毛球 `venonat`、摩鲁蛾 `venomoth`、可达鸭 `psyduck`                                      |
| `harden`          | K09；[skills/harden.ts:8](../../src/run/sim/skills/harden.ts#L8)               | 铁甲蛹 `metapod`、铁壳蛹 `kakuna`、菊石兽 `omanyte`                                      |
| `poison-sting`    | K03；[skills/shot.ts:151](../../src/run/sim/skills/shot.ts#L151)               | 尼多兰 `nidoran-f`、尼多朗 `nidoran-m`                                                   |
| `ember`           | K03；[skills/shot.ts:152](../../src/run/sim/skills/shot.ts#L152)               | 六尾 `vulpix`                                                                            |
| `flame-charge`    | K02；[skills/lunge.ts:90](../../src/run/sim/skills/lunge.ts#L90)               | 卡蒂狗 `growlithe`、小火马 `ponyta`                                                      |
| `discharge`       | K06；[skills/radial.ts:54](../../src/run/sim/skills/radial.ts#L54)             | 霹雳电球 `voltorb`                                                                       |
| `self-destruct`   | K06；[skills/radial.ts:58](../../src/run/sim/skills/radial.ts#L58)             | 顽皮雷弹 `electrode`                                                                     |
| `spore`           | K08；[skills/spore.ts:107](../../src/run/sim/skills/spore.ts#L107)             | 走路草 `oddish`                                                                          |
| `poison-fan`      | K03；[skills/shot.ts:154](../../src/run/sim/skills/shot.ts#L154)               | 尼多娜 `nidorina`                                                                        |
| `thunder-shock`   | K03；[skills/shot.ts:153](../../src/run/sim/skills/shot.ts#L153)               | 小磁怪 `magnemite`                                                                       |
| `bubble`          | K08；[skills/spore.ts:108](../../src/run/sim/skills/spore.ts#L108)             | 蚊香蝌蚪 `poliwag`                                                                       |
| `bubble-burst`    | K08；[skills/spore.ts:109](../../src/run/sim/skills/spore.ts#L109)             | 蚊香君 `poliwhirl`                                                                       |
| `egg-bomb`        | K04；[skills/acid.ts:128](../../src/run/sim/skills/acid.ts#L128)               | 蛋蛋 `exeggcute`                                                                         |
| `egg-barrage`     | K04；[skills/acid.ts:136](../../src/run/sim/skills/acid.ts#L136)               | 椰蛋树 `exeggutor`                                                                       |
| `horn-attack`     | K02；[skills/lunge.ts:91](../../src/run/sim/skills/lunge.ts#L91)               | 尼多力诺 `nidorino`                                                                      |
| `vine-bind`       | K05；[skills/psybeam.ts:86](../../src/run/sim/skills/psybeam.ts#L86)           | 蔓藤怪 `tangela`                                                                         |
| `burrow`          | K07；[skills/landing.ts:210](../../src/run/sim/skills/landing.ts#L210)         | 地鼠 `diglett`                                                                           |
| `shadow-sneak`    | K07；[skills/landing.ts:211](../../src/run/sim/skills/landing.ts#L211)         | 鬼斯通 `haunter`                                                                         |
| `leap`            | K07；[skills/landing.ts:212](../../src/run/sim/skills/landing.ts#L212)         | 猴怪 `mankey`、蚊香泳士 `poliwrath`                                                      |
| `leap-heavy`      | K07；[skills/landing.ts:213](../../src/run/sim/skills/landing.ts#L213)         | 火暴猴 `primeape`、大舌头 `lickitung`                                                    |
| `aura`            | K10a；[skills/aura.ts:40](../../src/run/sim/skills/aura.ts#L40)                | 瓦斯弹 `koffing`、双弹瓦斯 `weezing`、玛瑙水母 `tentacool`                               |
| `heal-pulse`      | K11；[skills/healPulse.ts:48](../../src/run/sim/skills/healPulse.ts#L48)       | 皮皮 `clefairy`、吉利蛋 `chansey`                                                        |
| `double-peck`     | K02；[skills/lunge.ts:92](../../src/run/sim/skills/lunge.ts#L92)               | 嘟嘟 `doduo`                                                                             |
| `triple-peck`     | K02；[skills/lunge.ts:93](../../src/run/sim/skills/lunge.ts#L93)               | 嘟嘟利 `dodrio`                                                                          |
| `pay-day`         | K03；[skills/shot.ts:155](../../src/run/sim/skills/shot.ts#L155)               | 喵喵 `meowth`                                                                            |
| `bonemerang`      | K13/H05；[skills/boomerang.ts:105](../../src/run/sim/skills/boomerang.ts#L105) | 卡拉卡拉 `cubone`                                                                        |
| `take-down`       | K02；[skills/lunge.ts:94](../../src/run/sim/skills/lunge.ts#L94)               | 肯泰罗 `tauros`                                                                          |
| `high-jump-kick`  | K07；[skills/landing.ts:214](../../src/run/sim/skills/landing.ts#L214)         | 飞腿郎 `hitmonlee`                                                                       |
| `horn-rush`       | K02；[skills/lunge.ts:95](../../src/run/sim/skills/lunge.ts#L95)               | 独角犀牛 `rhyhorn`                                                                       |
| `dig`             | K07；[skills/landing.ts:215](../../src/run/sim/skills/landing.ts#L215)         | 大岩蛇 `onix`                                                                            |
| `flame-trail`     | K02；[skills/lunge.ts:97](../../src/run/sim/skills/lunge.ts#L97)               | 烈焰马 `rapidash`                                                                        |
| `razor-dash`      | K02；[skills/lunge.ts:96](../../src/run/sim/skills/lunge.ts#L96)               | 镰刀盔 `kabutops`                                                                        |
| `spike-cannon`    | K03；[skills/shot.ts:156](../../src/run/sim/skills/shot.ts#L156)               | 多刺菊石兽 `omastar`                                                                     |
| `rockfall`        | K13/H03；[skills/rockfall.ts:63](../../src/run/sim/skills/rockfall.ts#L63)     | 钻角犀兽 `rhydon`                                                                        |
| `aqua-jet`        | K02；[skills/lunge.ts:98](../../src/run/sim/skills/lunge.ts#L98)               | 化石盔 `kabuto`                                                                          |
| `megahorn`        | K02；[skills/lunge.ts:100](../../src/run/sim/skills/lunge.ts#L100)             | 金鱼王 `seaking`                                                                         |
| `psybeam-heavy`   | K05；[skills/psybeam.ts:87](../../src/run/sim/skills/psybeam.ts#L87)           | 哥达鸭 `golduck`                                                                         |
| `water-gun`       | K03；[skills/shot.ts:157](../../src/run/sim/skills/shot.ts#L157)               | 海刺龙 `seadra`                                                                          |
| `pin-missile`     | K03；[skills/shot.ts:158](../../src/run/sim/skills/shot.ts#L158)               | 雷伊布 `jolteon`                                                                         |
| `discharge-wide`  | K06；[skills/radial.ts:62](../../src/run/sim/skills/radial.ts#L62)             | 三合一磁怪 `magneton`                                                                    |
| `discharge-quick` | K06；[skills/radial.ts:66](../../src/run/sim/skills/radial.ts#L66)             | 电击兽 `electabuzz`                                                                      |
| `dragon-rage`     | K06；[skills/radial.ts:70](../../src/run/sim/skills/radial.ts#L70)             | 哈克龙 `dragonair`                                                                       |

无普通skill字段的物种也在范围内：`caterpie`、`weedle`、`rattata`、`pidgey`、`scyther`、`zubat`、`raticate`、`pinsir`、`gastly`、`nidoking`、`sandslash`、`machop`、`marowak`、`aerodactyl`、`krabby`、`kingler`、`gyarados`、`starmie`、`slowpoke`、`haunter-guardian`、`muk`、`mr-mime`、`golbat`、`alakazam`、`marowak-ghost`、`gengar`、`dewgong`、`cloyster`、`lapras`、`magmar`、`arcanine`、`dragonite`。这些仍走共同移动/接触/死亡机器，当前区guardian另由brains表分派；“无skill”不表示无brain。

## 附录 B. 玩家招式、大招与进化数据的覆盖

[archetypes/index.ts:28](../../src/run/sim/archetypes/index.ts#L28) 的 **19 个key**（drain复用homing实现）及全部28个招式。每个招式均受A01冷却/等待机器控制。

| archetype   | 机器 / 定义位置                                                                                              | 内容招式                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `bolt`      | A02；[archetypes/bolt.ts:44](../../src/run/sim/archetypes/bolt.ts#L44)                                       | 火花 `ember`、水枪 `water-gun`、电击 `thunder-shock` |
| `cone`      | A06；[archetypes/cone.ts:18](../../src/run/sim/archetypes/cone.ts#L18)                                       | 喷射火焰 `flamethrower`、催眠粉 `sleep-powder`       |
| `vortex`    | A07；[archetypes/vortex.ts:61](../../src/run/sim/archetypes/vortex.ts#L61)                                   | 火焰旋涡 `fire-spin`、潮旋 `whirlpool`               |
| `orb`       | A04；[archetypes/orb.ts:12](../../src/run/sim/archetypes/orb.ts#L12)                                         | 大字爆炎 `fire-blast`、电球 `electro-ball`           |
| `strike`    | A06；[archetypes/strike.ts:9](../../src/run/sim/archetypes/strike.ts#L9)                                     | 藤鞭 `vine-whip`                                     |
| `barrage`   | A02；[archetypes/barrage.ts:9](../../src/run/sim/archetypes/barrage.ts#L9)                                   | 飞叶快刀 `razor-leaf`、泡沫 `bubble`                 |
| `beam`      | A06；[archetypes/beam.ts:37](../../src/run/sim/archetypes/beam.ts#L37)                                       | 日光束 `solar-beam`、水炮 `hydro-pump`               |
| `spin`      | A06；[archetypes/spin.ts:9](../../src/run/sim/archetypes/spin.ts#L9)                                         | 高速旋转 `rapid-spin`                                |
| `chain`     | A01（施放即同步链击，无独立跨tick实体）；[archetypes/chain.ts:11](../../src/run/sim/archetypes/chain.ts#L11) | 十万伏特 `thunderbolt`                               |
| `smite`     | A06；[archetypes/smite.ts:10](../../src/run/sim/archetypes/smite.ts#L10)                                     | 打雷 `thunder`                                       |
| `nova`      | A06；[archetypes/nova.ts:11](../../src/run/sim/archetypes/nova.ts#L11)                                       | 喷烟 `lava-plume`、放电 `discharge`                  |
| `homing`    | A03；[archetypes/homing.ts:52](../../src/run/sim/archetypes/homing.ts#L52)                                   | 鬼火 `will-o-wisp`、电击波 `shock-wave`              |
| `drain`     | A03；[archetypes/homing.ts:52](../../src/run/sim/archetypes/homing.ts#L52)                                   | 终极吸取 `giga-drain`                                |
| `lob`       | A04；[archetypes/lob.ts:63](../../src/run/sim/archetypes/lob.ts#L63)                                         | 种子炸弹 `seed-bomb`                                 |
| `wave`      | A05；[archetypes/wave.ts:45](../../src/run/sim/archetypes/wave.ts#L45)                                       | 冲浪 `surf`                                          |
| `bloom`     | A08；[archetypes/bloom.ts:121](../../src/run/sim/archetypes/bloom.ts#L121)                                   | 花朵光束 `floral-beam`                               |
| `firestorm` | A09；[archetypes/firestorm.ts:90](../../src/run/sim/archetypes/firestorm.ts#L90)                             | 烈焰旋风 `fire-whirl`                                |
| `sprinkler` | A10；[archetypes/sprinkler.ts:55](../../src/run/sim/archetypes/sprinkler.ts#L55)                             | 水旋涡 `hydro-spiral`                                |
| `rod`       | A11；[archetypes/rod.ts:52](../../src/run/sim/archetypes/rod.ts#L52)                                         | 电球风暴 `ball-storm`                                |

12个area rule全部对应：`cone`→A06；`vortex`→A07；`beam`→A06；`spin`→A06；`strike`→A06；`burst`→A04/A06；`smite`→A06；`nova`→A06；`bloom`→A08；`firestorm`→A09；`sprinkler`→A10；`rod`→A11。[archetypes/kit.ts](../../src/run/sim/archetypes/kit.ts)为共享发射/命中/pulse驱动；[archetypes/fusionParts.ts](../../src/run/sim/archetypes/fusionParts.ts)只负责融合子弹/末段的创建与几何，子对象生命周期归A02–A11。

| 进化线 / 数据模块                                                                          | 阶段                                                       | ultimate / Pulse kinds                                    |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------- |
| `charmander`；[content/lines/charmander.ts](../../src/run/sim/content/lines/charmander.ts) | Lv1 charmander → Lv16 charmeleon → Lv35 charizard（P06）   | `blast-burn`：ring, spots, lines, strike（A12，hop另A13） |
| `bulbasaur`；[content/lines/bulbasaur.ts](../../src/run/sim/content/lines/bulbasaur.ts)    | Lv1 bulbasaur → Lv16 ivysaur → Lv33 venusaur（P06）        | `frenzy-plant`：lines, heal, ring（A12，hop另A13）        |
| `squirtle`；[content/lines/squirtle.ts](../../src/run/sim/content/lines/squirtle.ts)       | Lv1 squirtle → Lv16 wartortle → Lv35 blastoise（P06）      | `hydro-cannon`：ring, sweep（A12，hop另A13）              |
| `pikachu`；[content/lines/pikachu.ts](../../src/run/sim/content/lines/pikachu.ts)          | Lv1 pikachu → Lv16 mature（形态不变） → Lv34 raichu（P06） | `volt-tackle`：strike, hop（A12，hop另A13）               |

全部ultimate由[content/ultimates.ts](../../src/run/sim/content/ultimates.ts)声明、[ultimates/index.ts](../../src/run/sim/ultimates/index.ts)执行；ring/spots/lines/strike/sweep/heal是timeline发出的即时pulse形状，hop额外携带路径/visited记忆。没有将每个数值tier或每个pulse当独立状态机。

## 附录 C. 守卫注册覆盖

[bosses/index.ts:26](../../src/run/sim/bosses/index.ts#L26)共 **22个brain key**，用于6张stage的22区/层：9个独立实现 + 13个共享zoneGuardian执行器的species分支（B10骨架，B11–B23分支，B24/B25并行机器）。

| 地图 / 区层   | species = brain    | 机器 / 实现模块                                                             |
| ------------- | ------------------ | --------------------------------------------------------------------------- |
| `forest` / 1  | `scyther`          | B01；[bosses/scyther.ts](../../src/run/sim/bosses/scyther.ts)               |
| `forest` / 2  | `pinsir`           | B02；[bosses/pinsir.ts](../../src/run/sim/bosses/pinsir.ts)                 |
| `forest` / 3  | `nidoking`         | B03；[bosses/nidoking.ts](../../src/run/sim/bosses/nidoking.ts)             |
| `desert` / 1  | `sandslash`        | B04；[bosses/sandslash.ts](../../src/run/sim/bosses/sandslash.ts)           |
| `desert` / 2  | `marowak`          | B05；[bosses/marowak.ts](../../src/run/sim/bosses/marowak.ts)               |
| `desert` / 3  | `aerodactyl`       | B06；[bosses/aerodactyl.ts](../../src/run/sim/bosses/aerodactyl.ts)         |
| `coast` / 1   | `kingler`          | B07；[bosses/kingler.ts](../../src/run/sim/bosses/kingler.ts)               |
| `coast` / 2   | `gyarados`         | B08；[bosses/gyarados.ts](../../src/run/sim/bosses/gyarados.ts)             |
| `coast` / 3   | `starmie`          | B09；[bosses/starmie.ts](../../src/run/sim/bosses/starmie.ts)               |
| `glacier` / 1 | `dewgong`          | B18；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |
| `glacier` / 2 | `cloyster`         | B19；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |
| `glacier` / 3 | `lapras`           | B20；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |
| `volcano` / 1 | `magmar`           | B21；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |
| `volcano` / 2 | `arcanine`         | B22；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |
| `volcano` / 3 | `dragonite`        | B23；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |
| `tower` / 1   | `haunter-guardian` | B11；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |
| `tower` / 2   | `muk`              | B12；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |
| `tower` / 3   | `mr-mime`          | B13；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |
| `tower` / 4   | `golbat`           | B14；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |
| `tower` / 5   | `alakazam`         | B15；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |
| `tower` / 6   | `marowak-ghost`    | B16；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |
| `tower` / 7   | `gengar`           | B17；[bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts) |

`bosses/kit.ts`提供旧brain共享定向/恢复动作，[bosses/zone-kit.ts](../../src/run/sim/bosses/zone-kit.ts)提供新brain action构造/时长；[bosses/hazards.ts](../../src/run/sim/bosses/hazards.ts)和[bosses/zone-hazards.ts](../../src/run/sim/bosses/zone-hazards.ts)为独立攻击对象规则，见下一表。所有stage内容模块：`content/stages/{forest,desert,coast,glacier,volcano,tower}.ts`，共享beat参数位于`beatTemplates.ts`，注册与数据约束在`index.ts`。

## 附录 D. 全部hazard kind覆盖

[hazards.ts:17](../../src/run/sim/hazards.ts#L17) 合并skill/guardian/slash后共有 **68 个kind**。不以“所有hazard都有life”概括其生命周期，按取消与收尾行为分组如下。

| 机器 | kind集合                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H01  | `slash`, `rock-shard`, `spore`, `bubble`, `icicle`, `flamethrower`, `poison-sting`, `ember`, `thunder-shock`, `poison-fan`, `pay-day`, `spike-cannon`, `water-gun`, `pin-missile`                                                    |
| H02  | `teleport-mark`, `dash-warn`, `bone-warn`, `icicle-warn`, `flamethrower-warn`, `poison-sting-warn`, `ember-warn`, `thunder-shock-warn`, `poison-fan-warn`, `pay-day-warn`, `spike-cannon-warn`, `water-gun-warn`, `pin-missile-warn` |
| H03  | `landing`, `rockfall`, `boss-fall`, `crabhammer`, `thunder-bolt`                                                                                                                                                                     |
| H04  | `acid`, `egg`, `egg-blast`, `boss-shot`                                                                                                                                                                                              |
| H05  | `bone`                                                                                                                                                                                                                               |
| H06  | `stun-spore`, `ice-beam`, `psybeam`, `vine`, `boss-beam`, `sweep`, `fissure`, `hydro-pump`                                                                                                                                           |
| H07  | `sing`, `sing-wide`, `dragon-pulse`, `discharge`, `discharge-wide`, `discharge-quick`, `dragon-rage`, `self-destruct`, `cone`, `stomp`                                                                                               |
| H08  | `flame-trail`, `burning-trail`, `acid-pool`, `ice-trail`, `burning-pool`                                                                                                                                                             |
| H09  | `ghost-fire`, `twister`                                                                                                                                                                                                              |
| H10a | `closing-box`                                                                                                                                                                                                                        |
| H10b | `orbit`                                                                                                                                                                                                                              |
| H10c | `curse-mark`                                                                                                                                                                                                                         |
| H10d | `ice-mist`                                                                                                                                                                                                                           |
| H11  | `eruption`                                                                                                                                                                                                                           |
| H12  | `quicksand-pit`                                                                                                                                                                                                                      |

## 附录 E. trigger注册族与全部使用内容

[triggers/index.ts:64](../../src/run/sim/triggers/index.ts#L64)的 **23种trigger**全部列出；同名trigger共享机器，item/ability key负责隔离其fx/procs。纯乘数或同步副作用仍列在覆盖索引，明确不另算状态机。

| Trigger          | 机器 / 定义位置                                                                                                          | 使用道具 / 特性                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `healOnHit`      | T08；[triggers/healOnHit.ts:7](../../src/run/sim/triggers/healOnHit.ts#L7)                                               | ability `photosynthesis`                                                                                             |
| `contactStatus`  | S01 / D04；接触瞬时动作，无自有记忆；[triggers/contactStatus.ts:5](../../src/run/sim/triggers/contactStatus.ts#L5)       | ability `static`                                                                                                     |
| `zap`            | T06；[triggers/zap.ts:7](../../src/run/sim/triggers/zap.ts#L7)                                                           | ability `static`                                                                                                     |
| `healBelow`      | T06；[triggers/heals.ts:16](../../src/run/sim/triggers/heals.ts#L16)                                                     | item `sitrus-berry`                                                                                                  |
| `healEvery`      | T06；[triggers/heals.ts:28](../../src/run/sim/triggers/heals.ts#L28)                                                     | item `lum-berry`                                                                                                     |
| `healOnKill`     | P01/P04/T09资源写入；同步概率动作，无自有timer；[triggers/heals.ts:40](../../src/run/sim/triggers/heals.ts#L40)          | item `berry-juice`                                                                                                   |
| `inflictOnHit`   | S01/S02/S04；同步apply/stack/flinch；[triggers/onHit.ts:14](../../src/run/sim/triggers/onHit.ts#L14)                     | item `grip-claw`, item `flame-orb`, item `toxic-orb`, item `snowball`, item `awakening`, item `kings-rock`           |
| `bonk`           | 同步概率伤害乘数；只有RNG推进，不另计状态机；[triggers/onHit.ts:25](../../src/run/sim/triggers/onHit.ts#L25)             | item `stick`                                                                                                         |
| `execute`        | D04；把未过阈值普通敌人hp置0，由damageEnemy完成一次kill；[triggers/onHit.ts:34](../../src/run/sim/triggers/onHit.ts#L34) | item `razor-fang`                                                                                                    |
| `critStrike`     | T08；[triggers/onHit.ts:42](../../src/run/sim/triggers/onHit.ts#L42)                                                     | item `thunder-stone`                                                                                                 |
| `burstOnKill`    | T11；[triggers/burstOnKill.ts:13](../../src/run/sim/triggers/burstOnKill.ts#L13)                                         | item `ice-heal`, item `fire-stone`, item `ice-stone`, item `leaf-stone`, item `griseous-orb`                         |
| `strike`         | T07；[triggers/periodic.ts:21](../../src/run/sim/triggers/periodic.ts#L21)                                               | item `old-rod`, item `electirizer`, item `sun-stone`, item `lustrous-orb`, item `silver-wing`                        |
| `markStrongest`  | T07/S01；[triggers/periodic.ts:63](../../src/run/sim/triggers/periodic.ts#L63)                                           | item `silph-scope`                                                                                                   |
| `spreadStatus`   | T07/S01；[triggers/periodic.ts:72](../../src/run/sim/triggers/periodic.ts#L72)                                           | item `burn-heal`                                                                                                     |
| `contactSpread`  | S01/D04；接触瞬时动作，无自有记忆；[triggers/contactSpread.ts:5](../../src/run/sim/triggers/contactSpread.ts#L5)         | item `sticky-barb`                                                                                                   |
| `scaling`        | T10连杀；其他measure仅派生缓存；[triggers/scaling.ts:10](../../src/run/sim/triggers/scaling.ts#L10)                      | item `metronome`, item `cell-battery`, item `bicycle`, item `reaper-cloth`, item `thick-club`, item `rage-candy-bar` |
| `buff`           | T03/T04；[triggers/player.ts:41](../../src/run/sim/triggers/player.ts#L41)                                               | item `smoke-ball`, item `adrenaline-orb`, item `metal-powder`, item `shed-shell`, item `poke-flute`                  |
| `statusOnHurt`   | T05a；[triggers/player.ts:65](../../src/run/sim/triggers/player.ts#L65)                                                  | item `adamant-orb`                                                                                                   |
| `lethalSave`     | T01；[triggers/player.ts:97](../../src/run/sim/triggers/player.ts#L97)                                                   | item `focus-band`, item `focus-sash`, item `revive`, item `max-revive`, item `rainbow-wing`                          |
| `dashBurst`      | T05b；[triggers/player.ts:113](../../src/run/sim/triggers/player.ts#L113)                                                | item `soda-pop`, item `iron-ball`                                                                                    |
| `overhealStore`  | T09；[triggers/player.ts:133](../../src/run/sim/triggers/player.ts#L133)                                                 | item `fresh-water`                                                                                                   |
| `overhealShield` | P04/T09；无自有timer；[triggers/player.ts:169](../../src/run/sim/triggers/player.ts#L169)                                | item `enigma-berry`                                                                                                  |
| `block`          | T02；[triggers/player.ts:172](../../src/run/sim/triggers/player.ts#L172)                                                 | item `guard-spec`                                                                                                    |

`loaded-dice` 和 `rare-candy` 属于 T12 的 onPick，不在 trigger registry；开局背包通过 createPlayer 以本局 RNG 执行骰子 roll，未调用整条 world.pickEffects 升级选卡路径。[hurt.ts](../../src/run/sim/hurt.ts) 读 lethalSave/block，[combat.ts](../../src/run/sim/combat.ts) 读 overhealShield，模块声明的 hook 不等于所有执行都在 fire() 内。其余仅 modifier/rules 的道具是构筑数据，影响 P04/P07/D06 等现有机器，不因每个 item 有 level 就新增机器。

## 附录 F. 同伴与刷怪事件的分派覆盖

[beats.ts:51](../../src/run/sim/beats.ts#L51)共有alpha、elite-wave、swarm、stampede、eruption五类。一次性timeline去重归D02，冲群成员归D03，eruption后续时序归H11；没有把即时创建一批敌人的循环单独列为机器。

[partners.ts:58](../../src/run/sim/partners.ts#L58)按skills.partner映射4种形态；以下是内容定义的style映射，**并非承诺每个guardian/物种均可实际收服**，实际capture入口仍要求相应elite死亡与槽位/概率。

| Style  | 内容定义映射的species                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tackle | `caterpie`, `weedle`, `rattata`, `pidgey`, `scyther`, `spearow`, `zubat`, `geodude`, `metapod`, `kakuna`, `growlithe`, `beedrill`, `raticate`, `pidgeotto`, `fearow`, `graveler`, `golem`, `diglett`, `mankey`, `sandshrew`, `nidorino`, `primeape`, `pinsir`, `gastly`, `haunter`, `nidoking`, `doduo`, `ponyta`, `tauros`, `sandslash`, `machop`, `hitmonlee`, `rhyhorn`, `dodrio`, `onix`, `marowak`, `rapidash`, `kabutops`, `aerodactyl`, `krabby`, `omanyte`, `kabuto`, `kingler`, `lickitung`, `seaking`, `poliwrath`, `gyarados`, `staryu`, `starmie`, `seel`, `slowpoke`, `vaporeon`, `snorlax`, `dugtrio`, `hitmonchan`, `haunter-guardian`, `muk`, `mr-mime`, `golbat`, `alakazam`, `marowak-ghost`, `gengar`, `dewgong`, `cloyster`, `lapras`, `magmar`, `arcanine`, `dragonite` |
| shot   | `oddish`, `ekans`, `venonat`, `nidoran-f`, `nidoran-m`, `vulpix`, `gloom`, `arbok`, `venomoth`, `nidorina`, `poliwag`, `psyduck`, `magnemite`, `poliwhirl`, `exeggcute`, `tangela`, `exeggutor`, `meowth`, `cubone`, `omastar`, `golduck`, `seadra`, `jolteon`, `kadabra`, `jynx`, `shellder`, `ninetales`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| cloud  | `paras`, `butterfree`, `parasect`, `vileplume`, `koffing`, `weezing`, `tentacool`, `grimer`, `flareon`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| pulse  | `voltorb`, `electrode`, `clefairy`, `rhydon`, `chansey`, `magneton`, `electabuzz`, `dragonair`, `jigglypuff`, `wigglytuff`, `dratini`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

生命周期均为D06/D07；tackle/shot/cloud/pulse的攻击几何与同步伤害不同，但均使用Partner.cooldown，未进入普通Enemy.phase技能机器。

## 附录 G. 全文件扫描清单与分类

<details>
<summary>展开170个文件的覆盖矩阵</summary>

所有文件都参与路径枚举/内容hash与状态声明扫描；核心更新器、注册实现族、初始化/取消/恢复调用路径进行了逐段核对。参数表与纯几何模块按声明、调用和状态写入核查，**未声称每一行都进行了等深度人工审查**。以下分类是审计入口，不代表模块只与一个机器相关。

| 文件（相对项目根）                                                                               | 行数 | 审计归属                                  |
| ------------------------------------------------------------------------------------------------ | ---: | ----------------------------------------- |
| [src/run/sim/archetypes/barrage.ts](../../src/run/sim/archetypes/barrage.ts)                     |   27 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/beam.ts](../../src/run/sim/archetypes/beam.ts)                           |   63 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/bloom.ts](../../src/run/sim/archetypes/bloom.ts)                         |  147 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/bolt.ts](../../src/run/sim/archetypes/bolt.ts)                           |   47 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/burst.ts](../../src/run/sim/archetypes/burst.ts)                         |   22 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/chain.ts](../../src/run/sim/archetypes/chain.ts)                         |   34 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/cone.ts](../../src/run/sim/archetypes/cone.ts)                           |   37 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/firestorm.ts](../../src/run/sim/archetypes/firestorm.ts)                 |  114 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/fusionParts.ts](../../src/run/sim/archetypes/fusionParts.ts)             |  115 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/homing.ts](../../src/run/sim/archetypes/homing.ts)                       |   73 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/index.ts](../../src/run/sim/archetypes/index.ts)                         |   66 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/kit.ts](../../src/run/sim/archetypes/kit.ts)                             |  351 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/lob.ts](../../src/run/sim/archetypes/lob.ts)                             |   91 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/nova.ts](../../src/run/sim/archetypes/nova.ts)                           |   22 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/orb.ts](../../src/run/sim/archetypes/orb.ts)                             |   24 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/rod.ts](../../src/run/sim/archetypes/rod.ts)                             |   78 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/smite.ts](../../src/run/sim/archetypes/smite.ts)                         |   26 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/spin.ts](../../src/run/sim/archetypes/spin.ts)                           |   17 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/sprinkler.ts](../../src/run/sim/archetypes/sprinkler.ts)                 |   78 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/strike.ts](../../src/run/sim/archetypes/strike.ts)                       |   32 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/vortex.ts](../../src/run/sim/archetypes/vortex.ts)                       |   78 | A01–A11；招式/area执行器                  |
| [src/run/sim/archetypes/wave.ts](../../src/run/sim/archetypes/wave.ts)                           |   72 | A01–A11；招式/area执行器                  |
| [src/run/sim/attacks.ts](../../src/run/sim/attacks.ts)                                           |  163 | A01–A11                                   |
| [src/run/sim/beats.ts](../../src/run/sim/beats.ts)                                               |  122 | D02/D03/H11                               |
| [src/run/sim/bosses/aerodactyl.ts](../../src/run/sim/bosses/aerodactyl.ts)                       |  133 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/gyarados.ts](../../src/run/sim/bosses/gyarados.ts)                           |  149 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/hazards.ts](../../src/run/sim/bosses/hazards.ts)                             |  127 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/index.ts](../../src/run/sim/bosses/index.ts)                                 |   55 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/kingler.ts](../../src/run/sim/bosses/kingler.ts)                             |  201 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/marowak.ts](../../src/run/sim/bosses/marowak.ts)                             |  148 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/nidoking.ts](../../src/run/sim/bosses/nidoking.ts)                           |  167 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/pinsir.ts](../../src/run/sim/bosses/pinsir.ts)                               |  154 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/sandslash.ts](../../src/run/sim/bosses/sandslash.ts)                         |  179 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/scyther.ts](../../src/run/sim/bosses/scyther.ts)                             |  141 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/starmie.ts](../../src/run/sim/bosses/starmie.ts)                             |  159 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/zone-guardians.ts](../../src/run/sim/bosses/zone-guardians.ts)               |  679 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/zone-hazards.ts](../../src/run/sim/bosses/zone-hazards.ts)                   |  322 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/bosses/zone-kit.ts](../../src/run/sim/bosses/zone-kit.ts)                           |  257 | B01–B25/H；守卫brain及独立hazard          |
| [src/run/sim/combat.ts](../../src/run/sim/combat.ts)                                             |  329 | D04/S03/T09；伤害/奖励                    |
| [src/run/sim/content/README.md](../../src/run/sim/content/README.md)                             |   46 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/abilities.ts](../../src/run/sim/content/abilities.ts)                       |   68 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/difficulties.ts](../../src/run/sim/content/difficulties.ts)                 |   68 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/effects.ts](../../src/run/sim/content/effects.ts)                           |  219 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/elements.ts](../../src/run/sim/content/elements.ts)                         |  118 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/enemies.ts](../../src/run/sim/content/enemies.ts)                           | 1641 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/fusions.ts](../../src/run/sim/content/fusions.ts)                           |   32 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/items.ts](../../src/run/sim/content/items.ts)                               |  944 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/lines/bulbasaur.ts](../../src/run/sim/content/lines/bulbasaur.ts)           |   54 | P06/A12；进化线数据                       |
| [src/run/sim/content/lines/charmander.ts](../../src/run/sim/content/lines/charmander.ts)         |   54 | P06/A12；进化线数据                       |
| [src/run/sim/content/lines/index.ts](../../src/run/sim/content/lines/index.ts)                   |  112 | P06/A12；进化线数据                       |
| [src/run/sim/content/lines/pikachu.ts](../../src/run/sim/content/lines/pikachu.ts)               |   41 | P06/A12；进化线数据                       |
| [src/run/sim/content/lines/squirtle.ts](../../src/run/sim/content/lines/squirtle.ts)             |   54 | P06/A12；进化线数据                       |
| [src/run/sim/content/moves.ts](../../src/run/sim/content/moves.ts)                               |  575 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/params/cards.ts](../../src/run/sim/content/params/cards.ts)                 |   95 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/params/combat.ts](../../src/run/sim/content/params/combat.ts)               |   30 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/params/coop.ts](../../src/run/sim/content/params/coop.ts)                   |   19 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/params/economy.ts](../../src/run/sim/content/params/economy.ts)             |   60 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/params/guardian.ts](../../src/run/sim/content/params/guardian.ts)           |   20 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/params/late-zones.ts](../../src/run/sim/content/params/late-zones.ts)       |   83 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/params/moves.ts](../../src/run/sim/content/params/moves.ts)                 |    8 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/params/pacing.ts](../../src/run/sim/content/params/pacing.ts)               |   78 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/params/partners.ts](../../src/run/sim/content/params/partners.ts)           |   19 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/params/player.ts](../../src/run/sim/content/params/player.ts)               |   78 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/params/ultimates.ts](../../src/run/sim/content/params/ultimates.ts)         |   13 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/params/zones.ts](../../src/run/sim/content/params/zones.ts)                 |  157 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/reactions.ts](../../src/run/sim/content/reactions.ts)                       |   51 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/stages/beatTemplates.ts](../../src/run/sim/content/stages/beatTemplates.ts) |   42 | D01/D02/W10；zone/beat/guardian配置       |
| [src/run/sim/content/stages/coast.ts](../../src/run/sim/content/stages/coast.ts)                 |  186 | D01/D02/W10；zone/beat/guardian配置       |
| [src/run/sim/content/stages/desert.ts](../../src/run/sim/content/stages/desert.ts)               |  222 | D01/D02/W10；zone/beat/guardian配置       |
| [src/run/sim/content/stages/forest.ts](../../src/run/sim/content/stages/forest.ts)               |  176 | D01/D02/W10；zone/beat/guardian配置       |
| [src/run/sim/content/stages/glacier.ts](../../src/run/sim/content/stages/glacier.ts)             |  187 | D01/D02/W10；zone/beat/guardian配置       |
| [src/run/sim/content/stages/index.ts](../../src/run/sim/content/stages/index.ts)                 |   97 | D01/D02/W10；zone/beat/guardian配置       |
| [src/run/sim/content/stages/tower.ts](../../src/run/sim/content/stages/tower.ts)                 |  325 | D01/D02/W10；zone/beat/guardian配置       |
| [src/run/sim/content/stages/volcano.ts](../../src/run/sim/content/stages/volcano.ts)             |  183 | D01/D02/W10；zone/beat/guardian配置       |
| [src/run/sim/content/stations.ts](../../src/run/sim/content/stations.ts)                         |    6 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/statuses.ts](../../src/run/sim/content/statuses.ts)                         |  145 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/content/triggers.ts](../../src/run/sim/content/triggers.ts)                         |  362 | 内容/数值/触发配置；见A–F覆盖映射         |
| [src/run/sim/currentZone.ts](../../src/run/sim/currentZone.ts)                                   |   45 | W10；zone读取/clear写入                   |
| [src/run/sim/director.ts](../../src/run/sim/director.ts)                                         |  474 | D01–D04/W10                               |
| [src/run/sim/enemies.ts](../../src/run/sim/enemies.ts)                                           |  234 | D03–D05/K/B/E                             |
| [src/run/sim/evolution.ts](../../src/run/sim/evolution.ts)                                       |   58 | P06                                       |
| [src/run/sim/fusion.ts](../../src/run/sim/fusion.ts)                                             |   77 | P09                                       |
| [src/run/sim/grid.ts](../../src/run/sim/grid.ts)                                                 |   47 | tick空间索引派生状态                      |
| [src/run/sim/hazards.ts](../../src/run/sim/hazards.ts)                                           |   65 | H01–H12                                   |
| [src/run/sim/hurt.ts](../../src/run/sim/hurt.ts)                                                 |   92 | P01/P04/T01/T02                           |
| [src/run/sim/mapgen/index.ts](../../src/run/sim/mapgen/index.ts)                                 |  113 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/mapgen/layout.ts](../../src/run/sim/mapgen/layout.ts)                               |  165 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/mapgen/pads.ts](../../src/run/sim/mapgen/pads.ts)                                   |   87 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/mapgen/playable.ts](../../src/run/sim/mapgen/playable.ts)                           |  118 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/mapgen/props.ts](../../src/run/sim/mapgen/props.ts)                                 |  113 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/mapgen/puddles.ts](../../src/run/sim/mapgen/puddles.ts)                             |  422 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/mapgen/sites.ts](../../src/run/sim/mapgen/sites.ts)                                 |   91 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/mapgen/spec.ts](../../src/run/sim/mapgen/spec.ts)                                   |  121 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/mapgen/stamps.ts](../../src/run/sim/mapgen/stamps.ts)                               |   60 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/mapgen/types.ts](../../src/run/sim/mapgen/types.ts)                                 |   71 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/mapgen/validate.ts](../../src/run/sim/mapgen/validate.ts)                           |   86 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/mapgen/walls.ts](../../src/run/sim/mapgen/walls.ts)                                 |   39 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/mapgen/water.ts](../../src/run/sim/mapgen/water.ts)                                 |   42 | I06；同步地图生成/校验及immutable数据     |
| [src/run/sim/math.ts](../../src/run/sim/math.ts)                                                 |  241 | 纯数学+同步scratch                        |
| [src/run/sim/movement.ts](../../src/run/sim/movement.ts)                                         |   37 | 纯heading派生                             |
| [src/run/sim/nav/astar.ts](../../src/run/sim/nav/astar.ts)                                       |  124 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/blockers.ts](../../src/run/sim/nav/blockers.ts)                                 |  119 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/buckets.ts](../../src/run/sim/nav/buckets.ts)                                   |   42 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/continuation.ts](../../src/run/sim/nav/continuation.ts)                         |   67 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/flow.ts](../../src/run/sim/nav/flow.ts)                                         |  319 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/grid.ts](../../src/run/sim/nav/grid.ts)                                         |  168 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/heap.ts](../../src/run/sim/nav/heap.ts)                                         |   74 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/index.ts](../../src/run/sim/nav/index.ts)                                       |   24 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/line.ts](../../src/run/sim/nav/line.ts)                                         |   65 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/movement.ts](../../src/run/sim/nav/movement.ts)                                 |  288 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/nav.ts](../../src/run/sim/nav/nav.ts)                                           |   59 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/profiles.ts](../../src/run/sim/nav/profiles.ts)                                 |  260 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/reach.ts](../../src/run/sim/nav/reach.ts)                                       |   70 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/nav/walkable.ts](../../src/run/sim/nav/walkable.ts)                                 |  261 | I01–I03；nav连续搜索或同步几何/算法helper |
| [src/run/sim/noise.ts](../../src/run/sim/noise.ts)                                               |   32 | 纯噪声                                    |
| [src/run/sim/partners.ts](../../src/run/sim/partners.ts)                                         |  393 | D06/D07                                   |
| [src/run/sim/player-movement.ts](../../src/run/sim/player-movement.ts)                           |  128 | P02/P03                                   |
| [src/run/sim/poise.ts](../../src/run/sim/poise.ts)                                               |   38 | S04                                       |
| [src/run/sim/rescue.ts](../../src/run/sim/rescue.ts)                                             |   78 | P05                                       |
| [src/run/sim/rng.ts](../../src/run/sim/rng.ts)                                                   |   30 | 确定性序列基础状态，非玩法phase           |
| [src/run/sim/sight.ts](../../src/run/sim/sight.ts)                                               |  230 | 视线纯查询+immutable几何cache             |
| [src/run/sim/skills/acid.ts](../../src/run/sim/skills/acid.ts)                                   |  201 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/aura.ts](../../src/run/sim/skills/aura.ts)                                   |   41 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/boomerang.ts](../../src/run/sim/skills/boomerang.ts)                         |  156 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/harden.ts](../../src/run/sim/skills/harden.ts)                               |   16 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/healPulse.ts](../../src/run/sim/skills/healPulse.ts)                         |   55 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/index.ts](../../src/run/sim/skills/index.ts)                                 |  179 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/kit.ts](../../src/run/sim/skills/kit.ts)                                     |  120 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/landing.ts](../../src/run/sim/skills/landing.ts)                             |  224 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/lunge.ts](../../src/run/sim/skills/lunge.ts)                                 |  181 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/psybeam.ts](../../src/run/sim/skills/psybeam.ts)                             |  119 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/radial.ts](../../src/run/sim/skills/radial.ts)                               |  129 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/rockfall.ts](../../src/run/sim/skills/rockfall.ts)                           |  102 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/shot.ts](../../src/run/sim/skills/shot.ts)                                   |  224 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/spore.ts](../../src/run/sim/skills/spore.ts)                                 |  114 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/stunSpore.ts](../../src/run/sim/skills/stunSpore.ts)                         |   49 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/telegraph.ts](../../src/run/sim/skills/telegraph.ts)                         |  161 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/teleport.ts](../../src/run/sim/skills/teleport.ts)                           |  115 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/skills/trail.ts](../../src/run/sim/skills/trail.ts)                                 |   64 | K01–K13/H；技能注册、共享执行器与hazard   |
| [src/run/sim/snapshot.ts](../../src/run/sim/snapshot.ts)                                         |  125 | I03/R                                     |
| [src/run/sim/state/commands.ts](../../src/run/sim/state/commands.ts)                             |   30 | 全部machine的序列化schema/commands/events |
| [src/run/sim/state/entities.ts](../../src/run/sim/state/entities.ts)                             |  419 | 全部machine的序列化schema/commands/events |
| [src/run/sim/state/events.ts](../../src/run/sim/state/events.ts)                                 |  152 | 全部machine的序列化schema/commands/events |
| [src/run/sim/state/world.ts](../../src/run/sim/state/world.ts)                                   |   63 | 全部machine的序列化schema/commands/events |
| [src/run/sim/stations.ts](../../src/run/sim/stations.ts)                                         |   95 | P08–P10                                   |
| [src/run/sim/stats.ts](../../src/run/sim/stats.ts)                                               |  317 | I04；其余纯属性折叠                       |
| [src/run/sim/status.ts](../../src/run/sim/status.ts)                                             |  203 | S01/S02/E                                 |
| [src/run/sim/surface-effects.ts](../../src/run/sim/surface-effects.ts)                           |   73 | H12/P02                                   |
| [src/run/sim/surface.ts](../../src/run/sim/surface.ts)                                           |  144 | 表面查询/数值                             |
| [src/run/sim/terrain.ts](../../src/run/sim/terrain.ts)                                           |  158 | 地形查询/构造                             |
| [src/run/sim/triggers/burstOnKill.ts](../../src/run/sim/triggers/burstOnKill.ts)                 |   36 | T/S/P；触发器注册和fx/proc写入            |
| [src/run/sim/triggers/contactSpread.ts](../../src/run/sim/triggers/contactSpread.ts)             |    5 | T/S/P；触发器注册和fx/proc写入            |
| [src/run/sim/triggers/contactStatus.ts](../../src/run/sim/triggers/contactStatus.ts)             |    5 | T/S/P；触发器注册和fx/proc写入            |
| [src/run/sim/triggers/healOnHit.ts](../../src/run/sim/triggers/healOnHit.ts)                     |   15 | T/S/P；触发器注册和fx/proc写入            |
| [src/run/sim/triggers/heals.ts](../../src/run/sim/triggers/heals.ts)                             |   45 | T/S/P；触发器注册和fx/proc写入            |
| [src/run/sim/triggers/index.ts](../../src/run/sim/triggers/index.ts)                             |  186 | T/S/P；触发器注册和fx/proc写入            |
| [src/run/sim/triggers/kit.ts](../../src/run/sim/triggers/kit.ts)                                 |   89 | T/S/P；触发器注册和fx/proc写入            |
| [src/run/sim/triggers/onHit.ts](../../src/run/sim/triggers/onHit.ts)                             |   76 | T/S/P；触发器注册和fx/proc写入            |
| [src/run/sim/triggers/periodic.ts](../../src/run/sim/triggers/periodic.ts)                       |   95 | T/S/P；触发器注册和fx/proc写入            |
| [src/run/sim/triggers/player.ts](../../src/run/sim/triggers/player.ts)                           |  177 | T/S/P；触发器注册和fx/proc写入            |
| [src/run/sim/triggers/scaling.ts](../../src/run/sim/triggers/scaling.ts)                         |   42 | T/S/P；触发器注册和fx/proc写入            |
| [src/run/sim/triggers/zap.ts](../../src/run/sim/triggers/zap.ts)                                 |   34 | T/S/P；触发器注册和fx/proc写入            |
| [src/run/sim/ultimates/index.ts](../../src/run/sim/ultimates/index.ts)                           |  396 | A12/A13；timeline声明与执行               |
| [src/run/sim/content/ultimates.ts](../../src/run/sim/content/ultimates.ts)                       |  299 | A12/A13；timeline声明与执行               |
| [src/run/sim/upgrades.ts](../../src/run/sim/upgrades.ts)                                         |  394 | W03/P07/P10/A01                           |
| [src/run/sim/viewFootprint.ts](../../src/run/sim/viewFootprint.ts)                               |   91 | 视野空间查询                              |
| [src/run/sim/wind.ts](../../src/run/sim/wind.ts)                                                 |   27 | 确定性风场派生                            |
| [src/run/sim/world.ts](../../src/run/sim/world.ts)                                               |  586 | W01–W03/P01–P07/I05；共享/owner步进入口   |
| [src/run/sim/zones.ts](../../src/run/sim/zones.ts)                                               |  189 | W02/W07/W10/Q/Z                           |
| [src/run/createRun.ts](../../src/run/createRun.ts)                                               | 1257 | W04–W09/I05；宿主边界                     |

独立盘点阶段只运行文件/注册表提取和报告一致性核查，没有启动测试runner。数据注册模块导入时自身的静态校验被执行，这不属于游戏行为测试。

</details>

## 最终只读核查

- 给定范围：170文件、25,607行；manifest之后新增/删除/内容hash变化均为0，范围内`git status --short`为空。
- 主表：118个短ID，无重复；每行均保留owner/编码与逻辑态/guard与转换/取消和恢复/不变量/测试与风险六列。共享骨架和特例分别列，所以条目数不能解读为最小自动机数。
- 注册覆盖：60技能key→15实现模块，19 archetype→28招式，22 guardian brain→6地图22区层，68 hazard kind，23 trigger kind，12 area rule，4进化线/大招，5 beat kind，4 partner style。提取的注册集合与报告映射相等，未漏key。
- 所有显式文件行号引用均在实际文件范围内；这验证定位可用性，不替代逻辑审查或测试。
- 范围内未故意遗留未盘点的注册行为族；无法由静态读码证明所有动态组合可达性、所有恢复时点或边缘帧行为。范围外模块、盘点阶段未运行测试与尚未复现的其余风险均已明确列出。
