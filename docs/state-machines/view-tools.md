# 画面反馈与分析工具状态机

基线和总览见 [状态机地图](../STATE-MACHINES.md)。本页完整分类了view（93个文件）、dev（3个）、balance（9个）与runArt（1个）；assets缓存由资源分册负责。本页状态机研究只读源码，没有在该阶段运行测试或设备。

2026-11-08 按本批 diff 定向更新 BM01/BM04/BM06 的守卫奖励、糖果成长与 HP 概率分布转换。其余盘点范围、行数与源哈希保留初次记录，不表示全量重审；本次文档更新未运行模型或产品测试。

共71个条目，包含生命周期、帧提交协议、状态投影和缓存锁存；P类投影不计作独立游戏状态机。新增的静态风险留在对应条目供后续核验，不把它们冒充已经复现的缺陷。

## 判定与合并规则

这里的“状态机”包括没有 enum、靠成员/闭包字段、Map/WeakMap、计时器、池前缀、资源是否已挂载来决定后继行为的机器。为避免把所有分支夸称独立 FSM，分类如下：

- **M**：跨帧/跨调用保存历史的生命周期（包含连续变量与离散 guard 组成的混合状态机）。
- **F**：调用顺序编码的帧事务/构建协议；状态藏在 cursor/count/生成器位置中。
- **P**：重要的“模拟状态 → 画面”投影，自己不保存独立生命周期，但其 guard 不应从全应用清单漏掉。它们不是第二套 gameplay 状态机。
- **C**：首次使用后保持的缓存/补丁锁存。

共享同一 owner、计时器与终结逻辑的具体火/水/草/电配方按家族归并。纯 GLSL 函数、几何生成、色表、一次性局部算术循环、每帧 sin/cos 本身不逐对象登记。持续 effect 的已发射粒子可以在模拟对象消失后自然消退，不能误称为“取消后全部立即消失”。

表中 `T…` 是下面的测试源码索引，**只表示已存在的相关测试，均未在本任务运行**。“间接”指保护上游 sim 契约或少数渲染例子，不能当作当前机器完整验收。“无直接”表示在 `scripts/*test.mjs` 的导入与用例检索中未找到直接契约覆盖，不等于证明任何地方都没有测试。

## A. 世界视图、角色与敌人

<a id="rv01"></a>

### RV01 世界视图分步构建与销毁（F+M）

- **所有者/定位**：[src/run/view/createRunView.ts:156,171,204,786,841,845,853](../../src/run/view/createRunView.ts#L156)；调用边界 [src/run/createRun.ts:1000,1032,1046,1078](../../src/run/createRun.ts#L1000)
- **编码字段**：生成器游标、`scene/disposables/avatars`、返回前后 RunView 是否可达；外部 `view/changingZone/disposed`
- **逻辑状态**：未构建 → 分步构建 → 已交付 → warm 全形态 → 正常绘制；上传释放但 CPU 存活；最终销毁
- **触发、守卫与转换**：多个 `yield/yield*` 暂停/续建；外部 start 调 warmSet；换区先 disposeScene 再重建；releaseUploads 不是 dispose
- **终态/取消/不变量**：dispose 对每个形态 unmount、释放 VFX/自身 disposables/阴影并清空 scene；借用的 RunAssets 后释放。没有本地 disposed guard，也没有构建中 finally；`prepare/steps.ts:36` 取消只抛 AbortError、不调用 generator.return，半建图的清理不由返回的 dispose 覆盖
- **测试与风险**：T1/T2/T3 仅部分。半建取消/失败是明确源码清理缺口；本任务未复现 GPU 泄漏。旧视图与新视图不得同时 mount 同一 player.holder

<a id="rv02"></a>

### RV02 角色rig挂载与还原（M）

- **所有者/定位**：[src/run/view/playerRig.ts:44,64,103,117,142](../../src/run/view/playerRig.ts#L44)
- **编码字段**：`originals/made/ghosts/mixer/run/idle/tail`、holder 的 parent、替换后 material/customDepthMaterial
- **逻辑状态**：未挂载 → 自有材质/剪影/动画活动 → 卸载并恢复源模型
- **触发、守卫与转换**：mount 保存原材质，绑定共享 skeleton 的 ghost，启动 run+idle；缺动画显式 throw；unmount 停止并 uncache mixer
- **终态/取消/不变量**：ghost 只 detach，不拥有模型 geometry/skeleton；holder 移除、原材质/深度材质恢复、自建材质 dispose、尾巴回静止。模型本体由 assets owner 持有；同一 rig 不支持重复业务使用后的复活
- **测试与风险**：T1 [view.test.mjs:107,128,143,154](../../scripts/view.test.mjs#L107)。缺 clip 在部分材料/ghost 已建后抛错，无局部 rollback；卸载必须早于下一区再次 mount

<a id="rv03"></a>

### RV03 形态切换与预热显示（M）

- **所有者/定位**：[src/run/view/createRunView.ts:441,454,462,640,841](../../src/run/view/createRunView.ts#L441)
- **编码字段**：`Avatar.forms/form/rig/head`、各 `holder.visible`
- **逻辑状态**：整条进化线预挂载且隐藏 → 当前形态显示；warm 时全部显示 → 当前形态显示
- **触发、守卫与转换**：`formOf(player).id !== body.form` 隐藏旧 holder，切换 rig/head 并显示新形态；warmSet(on) 临时覆盖 visibility
- **终态/取消/不变量**：同一玩家常规只显示当前形态；inactive rigs 保留而不每帧 update，切回时保留各自动画时间。mature 若 form id 不变不切模型；evolve 事件的光柱另属 FX12
- **测试与风险**：T1 间接、T10 仅模拟进化。所有形态必须预载，否则 show throw；warm 与 frame 的先后由外部 start 协议保证

<a id="rv04"></a>

### RV04 idle/run混合与冲刺形变（M）

- **所有者/定位**：[src/run/view/createRunView.ts:640,651,658,660,679,685](../../src/run/view/createRunView.ts#L640)
- **编码字段**：`runWeight`、group yaw、mixer/action.time、run/idle weights、`dashTime`
- **逻辑状态**：idle ↔ 混合 ↔ run；可叠加 dash 拉伸；暂停冻结时间
- **触发、守卫与转换**：速度 `>0.1` 决定目标权重，以 dt 平滑；yaw 最短角追赶；run timeScale 按 clipSpeed/cadence 限幅；mixer 后纠正 footFloor，再更新尾巴
- **终态/取消/不变量**：无独立终态，卸载归 RV02；dt=0 不推进混合/骨骼。动画不能反写模拟位置，脚底修正只加在 group.y
- **测试与风险**：T1 直接保护脚底；并未覆盖全角色 idle/run/dash 视觉。每帧呼吸 sin 不单列机器

<a id="rv05"></a>

### RV05 存活边沿与受击闪烁（M）

- **所有者/定位**：[src/run/view/createRunView.ts:140,475,669](../../src/run/view/createRunView.ts#L140)；[src/run/view/vfx.ts:808](../../src/run/view/vfx.ts#L808)
- **编码字段**：`body.alive` 历史、`player.alive/invulnerable/hurt`、group.visible、elapsed
- **逻辑状态**：存活可见 ↔ 受伤无敌闪烁；存活 → 首帧 faint → 死亡隐藏；复活 → 可见/闪烁
- **触发、守卫与转换**：仅 `body.alive && !player.alive` 发一次 faint；随后同步 alive；死亡优先于 blink；blink 同时要求两个 timer>0
- **终态/取消/不变量**：死亡仍更新 rig/muzzle，不是释放；同一对象复活可再次形成死亡边沿；全视图销毁才释放。创建时已死亡不会补发 faint
- **测试与风险**：T10 仅 sim 复活/死亡；无直接 view 边沿测试。多步 death→revive 在两个 render 之间可能不被边沿采样观察到

<a id="rv06"></a>

### RV06 头骨枪口跟随（M）

- **所有者/定位**：[src/run/view/createRunView.ts:137,485,689](../../src/run/view/createRunView.ts#L137)
- **编码字段**：当前 form 的 `head`、可复用 `muzzle`、`muzzles: Map<PlayerId,Muzzle>`
- **逻辑状态**：无头骨/无 muzzle → 有头骨/更新 muzzle；切形态可反向转换
- **触发、守卫与转换**：frameMuzzle：!head 删 map；有 head 读取 world position、模型朝向，写 map；供 shot 首帧发射偏移
- **终态/取消/不变量**：以 player id 为键；身体隐藏/死亡不自动删除 muzzle，shot 过滤依赖上游模拟；卸载整视图结束引用
- **测试与风险**：无直接；与 FX04 耦合。不能假设 muzzle map 只含存活者

<a id="rv07"></a>

### RV07 尾骨激励与回弹（M）

- **所有者/定位**：[src/run/view/tail.ts:168,177,202](../../src/run/view/tail.ts#L168)
- **编码字段**：`rest[]/yaw/yawRate/pitch/pitchRate`、bone.quaternion
- **逻辑状态**：静止 → 转向/跑动激励 → 跟随回弹 → 限位停止角速度；暂停；dispose 恢复 rest
- **触发、守卫与转换**：dt≤0 return；dt 封顶、子步；turn/speed/run 改目标；越 yaw/pitch 限制则夹紧并把对应 rate 清零
- **终态/取消/不变量**：dispose 恢复 bone 姿态，数组不重置/无 disposed guard；销毁后不应再 update。`rigTail:23` 是一次性骨骼扩展/重权重，不是第二个播放 FSM，调用限定 freshly loaded model
- **测试与风险**：T1 `:154` 直接检验 moving tail unmount→同模型下一 zone。速度/限位/大 dt 只是源码检查

<a id="rv08"></a>

### RV08 敌人与同伴实例帧提交（F）

- **所有者/定位**：[src/run/view/createRunView.ts:358,511,592,625](../../src/run/view/createRunView.ts#L358)
- **编码字段**：species InstancedMesh、`counts/blobCount`、fade/shell attributes、silhouette.count、按实体 ID 保存的 `gaitPhases`
- **逻辑状态**：每帧清计数 → 敌人槽 → 同伴槽 → commit 前缀
- **触发、守卫与转换**：敌人先提交；partner 共享 species 池并将 color/fade/shell 重置为天然色/1/0；超容量跳过；末尾 clamp count
- **步态生命周期**：首次绘制按 ID 起相位，此后由当前速度与 dt 累积；dt=0 保持，敌人/同伴离开世界时删除。相位只属于视图，不使用总 elapsed 乘当前速度，也不写回模拟。
- **终态/取消/不变量**：无每只对象常驻槽身份，下一帧重填；不再出现即从有效前缀消失；复制/借用 geometry 按 disposables 所有权释放。guardian容量2、普通species320、blob700
- **测试与风险**：T2 仅部分；T10 partner sim间接。容量耗尽可能漏画同伴；必须重置共享 attributes，不能把上帧敌人护盾/隐身带给同伴

<a id="rv09"></a>

### RV09 敌人动作视觉投影（P）

- **所有者/定位**：[src/run/view/enemyMotion.ts:34,122,134,142](../../src/run/view/enemyMotion.ts#L34)；消费者 `createRunView.ts:548`
- **编码字段**：`phase/phaseTime/action/brain`、alpha、hazard.life、stopped、flash
- **逻辑状态**：windup/under/dash/recover 对应蓄力、埋地/淡出、跳跃/俯冲、出土/淡入；默认 standing
- **触发、守卫与转换**：boss action 优先；blink、sludge-slam、lava-dive、shadow、flyer 与旧 guardian brain 分支；普通 teleport/leap/slides/burrow/melt；Sandslash recover 用 spent landing hazard 而非仅 phaseTime
- **终态/取消/不变量**：完全只读投影，不保存 phase；sim 中断/对象消失即改画或不再画。每帧小跳、呼吸不单列
- **测试与风险**：T2 `:176`（ghost/teleport），T10 zone/late-zones sim间接。遗漏 action 分支会画错 phase，但本层不控制 gameplay 转换

<a id="rv10"></a>

### RV10 铁甲贝壳闭合记忆（M）

- **所有者/定位**：[src/run/view/createRunView.ts:364,513,555](../../src/run/view/createRunView.ts#L364)；`cloysterShell.ts:9`
- **编码字段**：`shellEnds: Map<enemyId,end>`、`hardened`、插值frameTime、aShellClose
- **逻辑状态**：无记录/开壳 → closing → closed → opening → 清记录
- **触发、守卫与转换**：hardened>0 时记录 world.time+hardened；闭合按 shieldEnd−shieldTime 起算；到 end 才开，closure==0 且 time>end 删记录
- **终态/取消/不变量**：攻击 phase 被中断不会提前开壳；尾端 timer 独立于 action。伙伴 cloyster 强制 aShellClose=0；记录随 expiry/视图销毁结束
- **测试与风险**：T10 [late-zones.test.mjs:360,463](../../scripts/late-zones.test.mjs#L360) 是sim护盾；未找到壳动画直接测试。失去目标只靠expiry清 map，须保持 id 在本 view 唯一

<a id="rv11"></a>

### RV11 血条尾迹与死亡退场（M）

- **所有者/定位**：[src/run/view/healthBars.ts:35,116,120,145,171,192](../../src/run/view/healthBars.ts#L35)
- **编码字段**：map[id] 的 `ratio/chip/hold/flash/shown/death/alive`、seen
- **逻辑状态**：未追踪满血 → 受伤显示/闪光 → chip hold → chip drain → 安静隐藏但保留 → 敌人消失死亡pop → delete
- **触发、守卫与转换**：受伤下降>1e−4刷新 flash/shown；只有 chip已落定才重启hold，连续命中合并；untargetable置shown=0；未seen且alive启动0.32s死亡
- **终态/取消/不变量**：幸存隐藏条不删除，下一伤从实际HP接续；死亡timer过期删。boss跳过；提交最多360。healthBars在换区outlive view（外部createRun:1031），没有reset方法
- **测试与风险**：无直接测试。需要核对跨区旧条、实体id复用以及heal时chip/ratio关系；这是风险提示，未动态复现

<a id="rv12"></a>

### RV12 镜头震动衰减（M）

- **所有者/定位**：[src/run/view/cameraShake.ts:24](../../src/run/view/cameraShake.ts#L24)；`createRunView.ts:793`
- **编码字段**：trauma、clock
- **逻辑状态**：静止 → trauma累加 → 振动衰减 → 静止；暂停保留trauma
- **触发、守卫与转换**：add封顶1；apply在trauma≤0直接return；否则用trauma²画偏移，减DECAY*dt
- **终态/取消/不变量**：每帧先重置/aim camera，再apply；否则偏移可能累计；dt=0仍可施加同相偏移但不衰减；销毁闭包结束
- **测试与风险**：[camera.test.mjs](../../scripts/camera.test.mjs) 只测camera yaw，不能冒称shake覆盖。无直接trauma测试

<a id="rv13"></a>

### RV13 守卫冲刺结束边沿（M）

- **所有者/定位**：[src/run/view/createRunView.ts:501,752](../../src/run/view/createRunView.ts#L501)
- **编码字段**：`guardianWasDashing`、当前boss存在、phase
- **逻辑状态**：非dash → dash锁存 → dash结束边沿 → 非dash
- **触发、守卫与转换**：guardian存在、previous dash且当前!dash、距本地<8 才shake.add；每帧改 previous
- **终态/取消/不变量**：boss消失时不会产生落地震动；采样间完全发生的dash不可见；无独立资源，随view结束
- **测试与风险**：无直接。该边沿并非run event，不能只看事件分发表盘点

<a id="rv14"></a>

### RV14 游戏与反馈时钟（M）

- **所有者/定位**：[src/run/view/createRunView.ts:502,791,806](../../src/run/view/createRunView.ts#L502)；`environment/wind.ts:18,29`
- **编码字段**：elapsed、hitClock、lastFrameAt、uWindTime/uWindScroll、fx.time各自时钟
- **逻辑状态**：游戏推进 / hit-stop慢速 / 暂停dt0；风向改变但累积平移连续
- **触发、守卫与转换**：elapsed/风/VFX按dt；hitClock仅dt>0时累计真实now−lastFrameAt；lastFrameAt每次frame都更新
- **终态/取消/不变量**：不共享同一时基；暂停frame若持续被调用会刷新真实基准；若owner长期不调用frame，再次dt>0可能带入间隔，须以owner调用契约判断。风uniform是累计状态，具体云/草/雨正弦不再独立列
- **测试与风险**：T1仅wind用于rig fixture；无直接时基测试

<a id="rv15"></a>

### RV15 障碍遮挡淡出（M）

- **所有者/定位**：[src/run/view/createRunView.ts:705](../../src/run/view/createRunView.ts#L705)
- **编码字段**：每障碍 `aFade[]`、camera/player投影、changed
- **逻辑状态**：不遮挡目标1 ↔ 遮挡目标0.28，连续平滑过渡
- **触发、守卫与转换**：比玩家近且覆盖投影reach才淡；dt*8 lerp；abs变化>0.002才写回及标记upload
- **终态/取消/不变量**：数组跨帧保留，dt0冻结；dispose属于视图props。没有“终态删除”，目标恢复1逐渐回实
- **测试与风险**：无直接；这是真实历史插值，区别于无历史shader可见性

<a id="rv16"></a>

### RV16 地标/出口投影（P）

- **所有者/定位**：[src/run/view/landmark.ts:97](../../src/run/view/landmark.ts#L97)
- **编码字段**：`zone.phase/bossId`、column.visible、三种材质opacity/color
- **逻辑状态**：召唤地标 → 交战变暗/无柱 → 已清区出口颜色
- **触发、守卫与转换**：cleared = phase!=active；fighting=!cleared&&bossId!=null；各帧覆盖材质
- **终态/取消/不变量**：状态源只在sim；几何/自建材质dispose，source.geometry借用。闪烁sin排除；出口文案状态属外部UI
- **测试与风险**：T10 zones间接；无直接地标视觉生命周期测试

<a id="rv17"></a>

### RV17 边界墙显隐与停钟（M）

- **所有者/定位**：[src/run/view/boundaryWall.ts:63,114,117](../../src/run/view/boundaryWall.ts#L63)
- **编码字段**：mesh.visible、uPlayer、uTime
- **逻辑状态**：远离边界隐藏且时钟冻结 ↔ 进入REVEAL显示并推进时钟
- **触发、守卫与转换**：edge−max(abs(x),abs(z))<REVEAL；隐藏早退
- **终态/取消/不变量**：不重建geometry；离开不重置uTime；dispose材质/几何。纯闪纹不单列
- **测试与风险**：无直接；clock不会跟全局时间连续，属于当前实现

<a id="rv18"></a>

### RV18 材质输出补丁锁存（C）

- **所有者/定位**：[src/run/view/grade.ts:45,47,76](../../src/run/view/grade.ts#L45)
- **编码字段**：模块WeakSet<Material> `patched`、首次grade参数、material.needsUpdate
- **逻辑状态**：未打输出补丁 → 已固定graded/plain方案
- **触发、守卫与转换**：applyWorldOutput遍历未patched材质；patchOutput先加入WeakSet、链接onBeforeCompile，设needsUpdate
- **终态/取消/不变量**：同material再次调用不会更换首次grade策略；GC按material弱引用回收。context release不移除标记，已有compile回调仍在；`createGrade:106`是静态全屏材质资源，归RV01
- **测试与风险**：T2 `:273` 仅渲染使用补丁；未直接测试首次策略锁存/二次调用

## B. VFX 调度、阶段与实例池

<a id="fx01"></a>

### FX01 效果帧提交顺序（F）

- **所有者/定位**：[src/run/view/vfx.ts:231,310,403,864](../../src/run/view/vfx.ts#L231)
- **编码字段**：fx.time/dt/viewYaw、frame、各renderer counts/queues、root
- **逻辑状态**：收事件 → begin重建层 → replay/状态/弹体/区域/残响/危险/拾取 → end上传 → 放开tell预留 → sprites.update → 清feedback批次
- **触发、守卫与转换**：`handle`可先于update；update严格按417–451顺序；tells.select另由view在画敌人前调用
- **终态/取消/不变量**：dispose所有自建GPU层与pickup mesh、clear root；逻辑maps/arrays无显式clear，owner必须放弃Vfx。外部view.disposal取消后不再调用。不是每种招式各自开timer
- **测试与风险**：T3、T2部分。改变begin/end/replay次序可能抹掉本帧形状或让warning被普通粒子占位

<a id="fx02"></a>

### FX02 延迟定位的玩家事件（M）

- **所有者/定位**：[src/run/view/vfx.ts:175,250,356,454](../../src/run/view/vfx.ts#L175)
- **编码字段**：`playerEvents[]`
- **逻辑状态**：空 → 延迟等待玩家坐标 → 重放/丢弃不存在owner → 空
- **触发、守卫与转换**：dash/level/revive/hurt/drain/evolve/ult/heal/buff入队；update按player id找当前位置再触发配方；最后length=0
- **终态/取消/不变量**：队列按一次update消费；没有历史dedup；复现源事件必须由上游保证不重复；不再update时等待至Vfx销毁
- **测试与风险**：无直接；事件位置取渲染时玩家坐标，并非事件产生时坐标

<a id="fx03"></a>

### FX03 投射反馈批次去重（M）

- **所有者/定位**：[src/run/view/vfx.ts:245,340,451](../../src/run/view/vfx.ts#L245)
- **编码字段**：projectileBeats Map<id,tick>、shots
- **逻辑状态**：本批未见 → 已处理某tick → 较旧/相同tick忽略；下一update后重新空
- **触发、守卫与转换**：`seenTick>=event.tick` break；ended移除/recycle track；ended且无track补launch；hits循环hit，terrain补hit，expired fade
- **终态/取消/不变量**：去重仅覆盖一次事件批次，update末clear；不保存全历史。结束FX必须靠feedback，普通sweep仅回收而不猜hit/fade
- **测试与风险**：无直接；跨批重送同tick仍会播；同id同tick多个包仅首个生效，依赖事件聚合契约

<a id="fx04"></a>

### FX04 弹体呈现跟踪与回收（M）

- **所有者/定位**：[src/run/view/vfx.ts:133,241,474,529](../../src/run/view/vfx.ts#L133)
- **编码字段**：shots Map、freeShots[]、track.id/seen/ox/oy/oz/age、frame
- **逻辑状态**：delayed未出现 → 首次launch → 枪口到sim轨道融合 → fly → feedback结束/本帧未seen → 回收
- **触发、守卫与转换**：delay>0 skip；新track初始化全部字段；朝向同向且launch!=chest才取muzzle偏移；age/0.15衰减；sweep按frame清理
- **终态/取消/不变量**：free上限128，超出不保留；实体消失不强制清先前粒子；只读sim。每frame fly配方共享，不逐move建机器
- **测试与风险**：T2/T3仅间接。跳过的delayed对象会被sweep；对track/事件排序和id生命周期有契约依赖

<a id="fx05"></a>

### FX05 区域蓄力/首次击发锁存（M）

- **所有者/定位**：[src/run/view/vfx.ts:159,242,533,537](../../src/run/view/vfx.ts#L159)
- **编码字段**：areas Map、freeAreas[]、delay(firstSeen)、struck、seen、area.delay/life/follow
- **逻辑状态**：新区域/预警charge → 首次激活strike → 持续live → sim对象消失回收
- **触发、守卫与转换**：首见捕获delay；`area.delay<=0&&!struck`只触发一次strike；每帧live(charge)；follow以owner插值位置，edge-launch偏移身体边缘
- **终态/取消/不变量**：free上限64；新track重置struck/delay；没有独立结束回调；伤害区消失后只有已emit/stamp/echo残留自然结束
- **测试与风险**：T3间接。首次见到时可能已消耗部分windup，charge按首次采样剩余delay归一化；same-id对象替换不一定重新strike

<a id="fx06"></a>

### FX06 危险预警与消耗边沿（M）

- **所有者/定位**：[src/run/view/vfx.ts:167,247,573,769,781](../../src/run/view/vfx.ts#L167)
- **编码字段**：warnings Map、WarnTrack.life/seen/struck、hazard.dmg/delay
- **逻辑状态**：delay隐藏 → 已跟踪蓄力 → spent首帧burst → residue → unseen删除
- **触发、守卫与转换**：delay>0跳过；warning()捕获首见life；`!struck&&dmg<=0`只fresh一次；sweep未seen清理
- **终态/取消/不变量**：无free pool；不是所有hazard都用warning。已出生后取消由sim移除，begin重建清掉即时形状；残粒子不强制取消
- **测试与风险**：T2 `:124` delayed falls；T10 late-zones取消是上游sim测试。life用首见值，低采样率可能压缩可见预警

<a id="fx07"></a>

### FX07 敌方弹体和落点投影（P）

- **所有者/定位**：[src/run/view/vfx/enemySkills.ts:197,209,333,345](../../src/run/view/vfx/enemySkills.ts#L197)；`zoneSkills.ts:254,266,358,370`；`desertSkills.ts:77,98,182,223`；`guardianSkills.ts:283,304,314,330,348`；`common.ts:276,289,331`
- **编码字段**：hazard.kind/delay/life/dmg/length，sim创建的warn/projectile/pool关联
- **逻辑状态**：预警 → 飞行/抛物 → 落点/爆发/池或轨迹 → 淡出；某些只有其中几段
- **触发、守卫与转换**：common dispatcher先跳delay；kind分别选择shot-warn/shot、egg→egg-blast、acid→acid-pool、bone-warn→bone；trail length≤0不画；pool随life淡
- **终态/取消/不变量**：不在view把一个kind转成另一个，转移由sim创建/删除hazard完成；同族只共享绘制协议，不伪造view持久state。expiry/sweep删除即停止即时形状
- **测试与风险**：T2 finite geometry；T10 combat、zone-skills、late-zones为sim契约。具体模块全覆盖见下方配方矩阵

<a id="fx08"></a>

### FX08 守卫范围预警投影（P）

- **所有者/定位**：[src/run/view/vfx/enemySkills.ts:242,365,395](../../src/run/view/vfx/enemySkills.ts#L242)；`zoneSkills.ts:119,277,315,341`；`desertSkills.ts:123`；`coastSkills.ts:74,115`；`guardianSkills.ts:75,113,146,152,185,210`
- **编码字段**：life vs active/windup/residue；dmg/fresh；duration、radius/angle/gap
- **逻辑状态**：蓄力/蓄力 → 活跃lane/radial/fall/closing-wall/sweep → 花火/余迹 → gone
- **触发、守卫与转换**：radial/beam比较life>active；fall/landing/stomp以dmg>0或fresh；guardian sweep预警扇→实际旋转beam；closing-box从预警到收缩，沿sim boxHalf保留gap
- **终态/取消/不变量**：freshness由FX06独占；即时图元每帧重建；画面必须使用sim范围及cover cut；eruption调度hazard在vfx.ts:757明确不直接绘制，其子boss-fall/pool才画
- **测试与风险**：T2 `:124,189`、T10 guardians/geometry间接。不能把P类当sim攻击phase所有者

<a id="fx09"></a>

### FX09 追踪标记锁定投影（P）

- **所有者/定位**：[src/run/view/vfx/guardianSkills.ts:260](../../src/run/view/vfx/guardianSkills.ts#L260)
- **编码字段**：h.life、h.active、h.duration、h.dmg，locked
- **逻辑状态**：跟随标记紫色 → 锁定红色+内圈 → spent紫色残圈 → gone
- **触发、守卫与转换**：locked = life<=active+0.3；dmg>0画预警，否则0.3s residue
- **终态/取消/不变量**：跟随/坐标锁定本身由sim负责；view只把guard可见化，无本地locked历史
- **测试与风险**：T10 [late-zones.test.mjs:333](../../scripts/late-zones.test.mjs#L333)仅sim。缺少直接view锁定标识测试

<a id="fx10"></a>

### FX10 海岸陷阱武装投影（P）

- **所有者/定位**：[src/run/view/vfx/coastSkills.ts:156](../../src/run/view/vfx/coastSkills.ts#L156)
- **编码字段**：`TWISTER.life-hazard.life >= arm`、hazard.dmg/fresh/life
- **逻辑状态**：未武装低alpha → 已武装高alpha → 碰撞spent爆水一次/余迹 → gone
- **触发、守卫与转换**：armed由age阈值，dmg<=0走fresh splash并return
- **终态/取消/不变量**：一次burst记忆来自FX06；旧粒子按FX14结束
- **测试与风险**：T10相关海岸sim间接；没有完整view arm/spent测试

<a id="fx11"></a>

### FX11 球状风暴逐次落雷（M）

- **所有者/定位**：[src/run/view/vfx/fusion.ts:298,304,338](../../src/run/view/vfx/fusion.ts#L298)
- **编码字段**：**模块级**WeakMap<Area,number> `struck`；area.delay/maxLife/life；strikes
- **逻辑状态**：抛球flight → 悬浮 → 新strike编号播雷 → 悬浮 → burst另区/对象回收
- **触发、守卫与转换**：delay>0不计strike；floor((elapsed−flight)/tick)+1超过map值时set并发一组bolt/flash/spark
- **终态/取消/不变量**：弱键按Area对象身份，不是area.id，也不归Vfx实例；无clear/reset。跳过多个编号仅播一次，不逐个追补；area销毁后键可GC
- **测试与风险**：无直接。多个Vfx读取同Area会共享去重；snapshot替换同id但新对象会重计。是否发生需主代理核对网络/对象复用边界

<a id="fx12"></a>

### FX12 短效果残响池（M）

- **所有者/定位**：[src/run/view/vfx/fx.ts:122,133,164](../../src/run/view/vfx/fx.ts#L122)；`ultimates.ts:119,159,168`
- **编码字段**：Echoes.items/live/capacity/step、echo.draw/age/life/points/recipe参数
- **逻辑状态**：可复用slot → add age0 → 各帧draw(progress) → age>=life回收slot
- **触发、守卫与转换**：live>=capacity(实际64)拒绝新增；update先age再draw；compact稳定前缀；各种链、鞭、进化柱、终极技脉冲和同伴子弹共用
- **终态/取消/不变量**：echo到期后不再提交图元；里面已emit粒子可更久；没有自身GPU资源/单独dispose；废弃Vfx后结束owner。points保留引用直至slot复用/owner回收
- **测试与风险**：T3直接保护火终极技首帧半径与embers间隔释放，其余间接。dt一次超过life可不画该echo；不按每个echo配方重复计数

<a id="fx13"></a>

### FX13 治疗光环队列（M）

- **所有者/定位**：[src/run/view/vfx.ts:253,394,787](../../src/run/view/vfx.ts#L253)；`zoneSkills.ts:233,240`
- **编码字段**：mends[]、Mend.age、MEND_SECONDS
- **逻辑状态**：新治疗pulse → grow ring → ≥0.55秒从列表移除
- **触发、守卫与转换**：事件age=0；每update先mendRing，再age+=dt，保留age<limit；age==0额外喷星
- **终态/取消/不变量**：没有一次性spawned位；若初始若干update dt=0，age仍0、会重复spray；这是源码可达条件，未做运行复现。mends无硬容量，源事件频率控制
- **测试与风险**：T10 `zone-skills:204`只检验sim治疗。无直接view timer测试

<a id="fx14"></a>

### FX14 粒子池寿命与落地（M）

- **所有者/定位**：[src/run/view/vfx/sprites.ts:340,391,498](../../src/run/view/vfx/sprites.ts#L340)；`pool.ts:6`
- **编码字段**：Particle.spec/age/life/x/y/z/v*/floor、pool/live/step
- **逻辑状态**：free → emitted → airborne → 落地衰减（可持续受重力夹地）→ age>=1 retired
- **触发、守卫与转换**：满capacity不emit；emit全部字段重置并随机life；advance先age，再drag/gravity/move，y<floor夹地且平面速度衰减
- **终态/取消/不变量**：compact保持活跃绘制顺序、退役对象移至前缀外供复用；capacity2800；dt0不age；dispose几何/材质，不clear CPU pool
- **测试与风险**：T3部分间接。并非粒子对象删除；不能把floor碰撞理解成立即终止

<a id="fx15"></a>

### FX15 即时粒子和预警预留（F）

- **所有者/定位**：[src/run/view/vfx/sprites.ts:347,445,478,482](../../src/run/view/vfx/sprites.ts#L347)；`vfx.ts:447`
- **编码字段**：immediate[]/drawn/immediateCapacity/reserved/held
- **逻辑状态**：普通immediate写入且预留tell → release开放预留 → 最后写tell → 上传并drawn=0、重新held
- **触发、守卫与转换**：draw到capacity−held即拒绝；release仅held=0；update将持久粒子+immediate合并、上传count、复位
- **终态/取消/不变量**：必须每帧release之后画tells、再update；不持有一帧以上的immediate；reserved不保护其他renderer危险贴花容量
- **测试与风险**：T3/T2仅间接。错误调用顺序会静默丢告警而无异常

<a id="fx16"></a>

### FX16 贴花帧写入协议（F）

- **所有者/定位**：[src/run/view/vfx/decals.ts:302,351,368,393,403,418,465](../../src/run/view/vfx/decals.ts#L302)
- **编码字段**：count/capacity/o、data、geometry.instanceCount
- **逻辑状态**：begin空 → put选slot → tint/rect/args补齐 → end已提交；满池invalid-slot
- **触发、守卫与转换**：put满容量设置o=−1，后续链式setter no-op；begin先提交已有stamps再允许live shapes
- **终态/取消/不变量**：immediate形状不重提交即下一帧消失；put不初始化所有颜色字段，配方必须按链协议填充；dispose只geometry，material由Vfx owner释放；danger与player池独立
- **测试与风险**：T2/T3间接；静默丢图元是实际容量行为，不作性能评价

<a id="fx17"></a>

### FX17 残留贴花衰减（M）

- **所有者/定位**：[src/run/view/vfx/decals.ts:280,307,350,358,428](../../src/run/view/vfx/decals.ts#L280)
- **编码字段**：stamps[]/stamped、Stamp.age/life/yaw/colors等、step
- **逻辑状态**：事件留痕 → 下次begin age+重提 → fade → 到期slot复用
- **触发、守卫与转换**：stamp上限capacity/2；按stamped前缀保留；restamp若age>=life剔除，否则put/tint/args
- **终态/取消/不变量**：同帧begin之后创建的stamp要下一次begin才进入GPU数据；此时不是立即绘制。半池预留给live形状；事件结束不清其他stamp
- **测试与风险**：T3首帧测试覆盖特定事件调用顺序，非所有stamp。容量满静默拒绝；不重复登记每种焦痕/涟漪

<a id="fx18"></a>

### FX18 轨迹带收集/提交（F）

- **所有者/定位**：[src/run/view/vfx/ribbons.ts:95,137,143,157,293](../../src/run/view/vfx/ribbons.ts#L95)
- **编码字段**：strip/points、vertices/indexCount、capacity
- **逻辑状态**：帧空 → 收strip点 → flush一条strip → 收下一条 → end上传
- **触发、守卫与转换**：point达MAX_POINTS丢点；flush先points=0，n<2或vertices超容量则整条不提交；end设置drawRange/visible
- **终态/取消/不变量**：begin清所有cursor；未flush点不能跨帧；dispose geometry/material；bolt内部也走point/flush
- **测试与风险**：T2/T3间接。flush拒绝后点已消耗；不是可以稍后retry的队列

<a id="fx19"></a>

### FX19 体积效果帧提交（F）

- **所有者/定位**：[src/run/view/vfx/volumes.ts:209,241,246,263,270,284](../../src/run/view/vfx/volumes.ts#L209)
- **编码字段**：每类Volume.count、instanceMatrix与interleavedBuffer
- **逻辑状态**：begin → add各实例 → end(commit可见前缀) → 下一begin
- **触发、守卫与转换**：超mesh容量return；end设count和visible并标记上传范围
- **终态/取消/不变量**：beams/orbs/funnels/whirls各自有限容量；形状不重提即消失；dispose自有geometry/material/mesh
- **测试与风险**：T2有限geometry、T3火效果间接；没有通用溢出/清零契约测试

<a id="fx20"></a>

### FX20 敌人预警排名与回收（M）

- **所有者/定位**：[src/run/view/vfx/tells.ts:51,96,103,122,164,180](../../src/run/view/vfx/tells.ts#L51)
- **编码字段**：pool/live、byEnemy、shown[]、start NaN、seen/frame、glint/age/severity/rank/shown
- **逻辑状态**：未记录 → 待首次select → 存活蓄力但未入选/入选 → glint过期但红!保留 → 取消/phase结束/死亡回收
- **触发、守卫与转换**：重复tell事件重置start；phase windup或under且hp>0才seen；首次select定起点（即使远处）；按danger优先/距离选最多6；seen不匹配删map并swap尾
- **终态/取消/不变量**：pool128，容量满拒绝新增；shown决定身体tint+头顶glyph一致；红glint过后!持续到windup结束；不单靠age删tell
- **测试与风险**：T10 combat:796是事件侧；无直接Tells pool/rank/cancel测试。不能把“未shown”当取消，远处年龄照走

<a id="fx21"></a>

### FX21 状态标记与护盾投影（P+F）

- **所有者/定位**：[src/run/view/vfx/status.ts:139,150,169,189](../../src/run/view/vfx/status.ts#L139)；`enemySkills.ts:293`；`zoneSkills.ts:148,219`；`coastSkills.ts:185`
- **编码字段**：状态bitmask、ORDER、time/1.4、budget/wanted/keep、body scratch；enemy.phase/hardened/interrupted
- **逻辑状态**：无状态→优先首状态+轮换次状态；拥挤抽样/距离隐藏；护盾/光环活动或中断降亮度
- **触发、守卫与转换**：玩家先画且存活guard；敌人≤2slot、次slot按clock轮换，稳定hash决定超额保留；硬化、光环等按sim flags投影
- **终态/取消/不变量**：无每实体状态历史；每frame重提，终止由sim状态消失/对象不在集合决定。module body/axes是同步scratch，不是跨帧语义状态；图元生命归FX14/15
- **测试与风险**：T10 status/技能sim间接；未直接验证状态优先级、budget与中断呈现

<a id="fx22"></a>

### FX22 拾取/同伴实例提交（F）

- **所有者/定位**：[src/run/view/vfx.ts:813,202](../../src/run/view/vfx.ts#L813)；`vfx/partners.ts:49,62,105`
- **编码字段**：pickup各mesh计数；world.pickups/partners；伙伴攻击event、echo/particle
- **逻辑状态**：无实体 → 帧内提交可见前缀 → 不再出现清前缀；伙伴攻击/护主为独立短effect
- **触发、守卫与转换**：每frame counts归零、kind选择mesh、容量clamp；伙伴marker按当前world.partners；attack/guard从事件派发
- **终态/取消/不变量**：只是集合呈现；不能推导已拾取/已捕获流程由此控制。伙伴实体消失不取消已发出的echo；与RV08共享同伴呈现范围
- **测试与风险**：T10伙伴sim间接；无直接拾取/同伴呈现生命周期测试

<a id="fx23"></a>

### FX23 效果配方缓存（C）

- **所有者/定位**：[src/run/view/vfx/defaults.ts:221,224,236](../../src/run/view/vfx/defaults.ts#L221)
- **编码字段**：模块shotCache/areaCache，以archetype或kind+type为键
- **逻辑状态**：未构造recipe → memoized recipe → 后续复用
- **触发、守卫与转换**：cache miss用factory构造；不存在shot factory显式throw；hit返回同Look
- **终态/取消/不变量**：缓存只持有配方与sprite specs，不拥有GPU资源；进程级不清理，有限内容key域；不是assets缓存，故本篇登记
- **测试与风险**：无直接缓存测试；recipe如果以后加可变per-instance字段，会跨对象共享

### VFX 配方覆盖矩阵（不把共享池里的每个视觉对象重复计数）

| 覆盖模块                                                                      | 配方/阶段族与已检查 guard                                                                                                                                                                                           | 归属                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `vfx/common.ts`                                                               | hit/contact/crit、enemy death、player faint、dash、level/revive、hurt、terrain impact均一次event发射；hit在sprites.load>0.8时省略可选次级粒子；spore/slash/dash/air-slash warning按hazard/guardian timer读出        | FX02–04、FX07–08、FX12、FX14–18；RV05/13           |
| `vfx/fire.ts`                                                                 | ember/fireBlast发射→fly→hit/fade；fireBlastBurst/fireSpinBurst只strike；fireSpin delay蓄力→active旋涡→life尾段fade；flamethrower持续cone；spreadBurn事件残粒                                                        | FX04–05、FX12、FX14–19                             |
| `vfx/electric.ts`                                                             | thunderShock/electroBall弹体；electroBurst strike；thunder只在delay>0画蓄力，strike落雷；chain/electrocute/arcs使用echo                                                                                             | FX04–05、FX12                                      |
| `vfx/grass.ts`                                                                | razorLeaf弹体；vineWhip strike创建短鞭echo；sleepPowder持续区域末尾淡出；solarBeam delay>0蓄力，激活beam，life≤尾阈值消退                                                                                           | FX04–05、FX12                                      |
| `vfx/water.ts`                                                                | waterGun/bubble弹体；rapidSpin按maxLife−life入场与life退场；hydroPump预警/beam；steamBurst一次反应                                                                                                                  | FX04–05、FX12                                      |
| `vfx/homing.ts`                                                               | willOWisp/shockWave/gigaDrain共享shot fly/hit；drainBack创建从目标到玩家的echo，轨迹时间属于Echo.age/life                                                                                                           | FX04、FX12                                         |
| `vfx/lob.ts`                                                                  | seedBomb飞行与预计落点，seedBombBurst strike；本地落点估算循环是当次计算，不是持续模拟副本                                                                                                                          | FX04–05                                            |
| `vfx/nova.ts`                                                                 | lavaPlume/discharge strike，电放射echo；无各自拥有的持久timer                                                                                                                                                       | FX05、FX12                                         |
| `vfx/wave.ts`                                                                 | surf fly按sim波前重提ribbon；whirlpool delay→active→fade；whirlpoolBurst strike                                                                                                                                     | FX04–05                                            |
| `vfx/fusion.ts`                                                               | floralBeam复用solarBeam；floralBloom strike；fireWhirl `elapsed<jetFor`喷流喂入→`delay<=0&&elapsed>=jetFor`螺旋臂→fade；hydroSpiral入场/旋转beam/尾段fade；ballStorm flight→hover/strike计数；三种burst复用其他家族 | FX05、**FX11**、FX12                               |
| `vfx/ultimates.ts`                                                            | evolve柱；ultCast普通起手（blast-burn起手特例不重复画）；ultPulse按look派发root/root-lane、fire-release、ember-patch、magma-lane、fall、cannon、sky-bolt、hop及粒子/贴花。pulse调度不在view，event来一次起一组      | FX02、FX12、FX14–19；T3只覆盖火系列部分            |
| `vfx/items.ts`                                                                | itemBurst、healCue、buffCue只发event配方，所发粒子/贴花有自衰减；没有本地buff active flag                                                                                                                           | FX02、FX14/17                                      |
| `vfx/partners.ts`                                                             | partnerMarker每帧；melee/shot/pulse式attack、guard事件；shot轨迹echo随age消退，非绑定partner是否仍存在                                                                                                              | FX12、FX22、RV08                                   |
| `vfx/defaults.ts`                                                             | archetype默认shot/band和disc/sector/lane：delay guard、charge、active/fade；生成的Look memoized                                                                                                                     | FX04–05、FX23                                      |
| `vfx/enemySkills.ts`                                                          | 射线warn/flight、radial charge/active、硬化/roll体表、acid flight/pool、stun-spore、psybeam/ice-beam                                                                                                                | FX07–08、FX21                                      |
| `vfx/zoneSkills.ts`                                                           | landing、gas/fire aura被interrupted降亮/停发粒子、gastly body；独立mends；egg/egg-blast、vine、fissure、stomp、shard、bubble                                                                                        | FX06–08、FX13、FX21                                |
| `vfx/desertSkills.ts`                                                         | bone warn/shot、rockfall、flame/burning trail、quicksand-pit、surface patches；静态ice-slick交terrain，返回不画；其他surface patch每帧绘制                                                                          | FX06–08、FX16/19；表面patch列表生命周期仍由sim持有 |
| `vfx/coastSkills.ts`                                                          | crabhammer/thunder-bolt strike、hydro-pump蓄力/beam、twister arm/spent；tentacool body                                                                                                                              | FX06/08/10/21                                      |
| `vfx/guardianSkills.ts`                                                       | teleport-mark、boss-fall、boss-beam、cone、sweep、closing-box、orbit、curse-mark、boss-shot、ghost-fire、ice-trail/ice-mist/burning-pool；派生phase见FX07–10                                                        | FX06–10                                            |
| `vfx/tells.ts`、`status.ts`                                                   | 前者是有记忆的挑选/去重/结束；后者bitmask优先+轮换+budget，仅投影                                                                                                                                                   | FX20、FX21                                         |
| `vfx/fx.ts`、`pool.ts`、`sprites.ts`、`decals.ts`、`ribbons.ts`、`volumes.ts` | echo/持久粒子/残留stamp与帧重提buffer的真正生命周期owner；compact为共享稳定压缩，不另开一台机器                                                                                                                     | FX12、FX14–19                                      |
| `vfx/gl.ts`、`palette.ts`                                                     | 材质与上传helper/颜色常量，不有自己的实体生命周期                                                                                                                                                                   | 扫描排除；资源归调用owner                          |

## C. 环境、构建与局部缓存

<a id="ev01"></a>

### EV01 环境/小地图分步构建（F）

- **所有者/定位**：`environment/ground.ts:183,200,272,314`；`minimapBake.ts:23,27,78,91`；`environment/scatter.ts:58`；`foliage.ts:141,183,193,203,215`；`dressing.ts:52`（均在`src/run/view/`）
- **编码字段**：generator执行位置、row/cell cursor、CPU channel/pixel arrays、已完成layers/entries
- **逻辑状态**：创建CPU缓存 → 多批扫描/散布 → 生成纹理/geometry → 交付拥有dispose的view或DataTexture
- **触发、守卫与转换**：每固定行段yield；foliage按grass/flowers/reeds配置选择并依序yield；minimap先ground再pads/props再边界后DataTexture
- **终态/取消/不变量**：成功资源交给RV01或MP07；中途drive取消的职责见RV01，不能把纯数据bake无GPU分配与已经mount模型/建材质的阶段混为一谈。scatter随机按seed+cell，无额外业务状态
- **测试与风险**：T4（空植被与dressing合法位置）、T5静态terrain，T9 drive取消。未测各半建点rollback

<a id="ev02"></a>

### EV02 分块实例重打包缓存（M）

- **所有者/定位**：[src/run/view/environment/chunkedInstances.ts:19,62,69](../../src/run/view/environment/chunkedInstances.ts#L19)；消费`foliage.ts:217`、`dressing.ts:185`
- **编码字段**：sorted源实例、packedChunks Set、drawn、attribute buffer、boxes/grown
- **逻辑状态**：初始未pack → 缺可见块需repack → 保留缓存 → 发现新可见块再pack
- **触发、守卫与转换**：仅当“某非空块可见且不在packedChunks”才重打包；使用grown box及reach+MARGIN扩余量；若无missing直接返回旧drawn
- **终态/取消/不变量**：**仅旧块离开视野不会触发收缩**；旧内容可继续留缓存，shader/视野规则负责可见结果。attribute归对应geometry释放，无每块独立dispose
- **测试与风险**：无直接chunk测试；T4间接。不把此缓存策略作性能优劣声明

<a id="ev03"></a>

### EV03 局部灯池选择缓存（M）

- **所有者/定位**：[src/run/view/environment/dressing.ts:175,180,185](../../src/run/view/environment/dressing.ts#L175)
- **编码字段**：localPools[]、lastPoolEye、uSceneryPools/uSceneryPoolCount
- **逻辑状态**：初始化一盏seed使shader挂接 → 初次选择 → 视点变化小继续缓存 → 变化>1重新选
- **触发、守卫与转换**：distanceToSquared(camera.position)>1且有localPools；按距离排序，frustum过滤，互距≥4，最多选4
- **终态/取消/不变量**：没有独立GPU池对象；uniform引用共享给terrain；整view重建替换。相机原地只改朝向且位置没变，不会因frustum变化单独刷新
- **测试与风险**：无直接；缓存键只有camera.position，是否足够依赖正式camera动作，不在此断言视觉bug

<a id="ev04"></a>

### EV04 脚印步距和环形寿命（M）

- **所有者/定位**：[src/run/view/environment/footprints.ts:24,74,123,128](../../src/run/view/environment/footprints.ts#L24)
- **编码字段**：walkers[x,z,travel,side]、cursor、latest、CAPACITY192、实例birth、wind clock
- **逻辑状态**：行走累距 → 左右交替留印 → 192槽循环覆盖；脚印fresh→fade/washed→不可见；死亡/飞行/瞬移重置步距
- **触发、守卫与转换**：死亡、distance>2、flying清travel；跨size*1.8门槛取模并翻side；水/lava/earth遮罩拒绝印；写birth并增加instanceCount；latest+life决定mesh整体隐藏
- **终态/取消/不变量**：单印消失由shader按birth与洗刷历史推导，CPU不逐印删除，instanceCount只增至cap；水冲走后计算间隔波峰，目标是不在回潮后重现；dispose geometry/material，不dispose借用纹理
- **测试与风险**：无直接；shader只枚举有限过去波峰，契约依赖look.lifetime与SURF_PERIOD；本篇没做视觉复验

<a id="ev05"></a>

### EV05 涉水者帧队列（F）

- **所有者/定位**：[src/run/view/environment/water.ts:203,208,216](../../src/run/view/environment/water.ts#L203)
- **编码字段**：pool[]、queued、distance、uWaderCount/uWaders
- **逻辑状态**：帧空 → wade入队 → 距本地排序并选MAX_WADERS → upload uniforms → queued=0
- **触发、守卫与转换**：只有waterDepth>0入队；所有pool slots按是否本帧queued设distance或Infinity；update后计数清空
- **终态/取消/不变量**：槽对象跨帧复用、water mesh稳定；未排入不会继续作为有效wader；dispose geometry/material/mesh。ring phase按slot，并不锁定entity id
- **测试与风险**：无直接。调用方必须每次frame末update一次，否则queue跨帧积累；纯水纹正弦排除

<a id="ev06"></a>

### EV06 区域装饰资源生命周期（M）

- **所有者/定位**：`src/run/view/themes/{coast.ts:8,tower.ts:14,volcano.ts:8,forest.ts:7,desert.ts:6}`；`environment/{coast-weather.ts:19,tower.ts:24,112,volcano.ts:20,47,lava.ts:206}`；`createRunView.ts:234,833,853`
- **编码字段**：decorate是否返回、zone/theme选择、借用uniform/材质、返回dispose，volcano材质dispose listener
- **逻辑状态**：本区无装饰或创建本区装饰 → 每帧更新当前uniform → 上传释放可恢复 → 换区/销毁释放
- **触发、守卫与转换**：主题在createRunView构建时快照选择；tropic无coast weather；forest挂motes、desert按zone atmosphere选dust强度；tower按floor额外vigil；volcano绑定crust/flow并装enemy patch
- **终态/取消/不变量**：主题变化由整个view重建处理，非在旧decorate中热切；tower stonework、lava look显式释放闭包纹理，volcano altar crust通过material.dispose listener释放。纹理CPU数据仍保留，不把context release误当业务结束
- **测试与风险**：T2 shader render部分；无逐主题context恢复/换区完整测试。shader闭包资源需纳入upload release核对，见RV01/MP07区别

<a id="ev07"></a>

### EV07 塔遮挡容量投影（P+F）

- **所有者/定位**：[src/run/view/towerCutaway.ts:51,63](../../src/run/view/towerCutaway.ts#L51)；`environment/tower.ts:192`
- **编码字段**：uTowerReveal[32]/count、alive/life/delay；vigil player vectors
- **逻辑状态**：少量实体精确reveal → 超过32退到每玩家大范围reveal → 数量下降恢复精确
- **触发、守卫与转换**：每帧reset count，先alive players，再life>0且delay≤0 hazards，再hp>0 enemies；超过32用全部world.players位置半径22；vigil每帧覆写坐标
- **终态/取消/不变量**：没有独立历史或淡入timer；uniform资源挂在terrain material生命期。fallback这里是明确容量分支，不是async恢复；fallback包含倒下玩家（按现有代码）
- **测试与风险**：无直接；T2仅材料组合部分，未验证遮挡视觉

环境持续风时钟登记于RV14；草/花/芦苇摆动、云影、海浪、雨、沙尘、森林motes、塔雾/蜡烛、火山尘粒的解析动画不各建机器，资源归EV01/EV06/RV01。`player-rings.ts`的常驻多人开关及逐帧贴地是集合投影，归RV08/RV05关联；它没有alive隐藏guard，不能从角色身体死亡推导脚环也隐藏。

## D. 小地图、全图与罗盘

<a id="mp01"></a>

### MP01 小地图/全图开合（M）

- **所有者/定位**：[src/run/view/minimap.ts:239,356,382,411](../../src/run/view/minimap.ts#L239)
- **编码字段**：open、pose.alpha、motion target、full.display/opacity、mapAlpha/inkOpacity
- **逻辑状态**：mini → full entering → full shown → mini；重入可中断当前motion
- **触发、守卫与转换**：相同value return；切换先cancel(pose)，open时alpha0、160ms ease到1，close立即display none；hit根据open切mini或整full关闭区域
- **终态/取消/不变量**：dispose先cancel(pose)；full关闭时不独立销毁地图资源；暂停游戏的mapOpen/menuPaused属于外部createRun，不复制成minimap自己的simulation状态
- **测试与风险**：无直接minimap测试；旧QA不是本次验收。连续开关、resize/暂停中motion为重点风险

<a id="mp02"></a>

### MP02 小地图脏标记与布局收敛（M）

- **所有者/定位**：[src/run/view/minimap.ts:240,247,250,305,330,336](../../src/run/view/minimap.ts#L240)
- **编码字段**：dirty、lastWorld/Alpha/Yaw、miniSize/requestedMiniSize/fittedMiniSize/fullSize、danger
- **逻辑状态**：初始脏 → draw干净 → dt0缓存；resize/实测尺寸/restore/开图→脏；layout再收敛
- **触发、守卫与转换**：update仅dt!=0或dirty绘制；afterLayout按slot.maxHeight算fit，测量mini.size变化>0.1置dirty；draw在open时只更新full，mini只有!open或dirty才更新；danger以dt平滑
- **终态/取消/不变量**：dirty完成draw后清；暂停仍可通过dirty重画；本地world被替换但dt=0且未置dirty，单换lastWorld不保证draw；rebuild才换base地形
- **测试与风险**：无直接；边界：地图内容/position原地变更在paused且无dirty可能缓存旧图，必须由owner契约判定

<a id="mp03"></a>

### MP03 罗盘帧缓存（M）

- **所有者/定位**：[src/run/view/compassBar.ts:160,168,265,275,290,295](../../src/run/view/compassBar.ts#L160)
- **编码字段**：lastWorld/lastTick/lastAlpha/lastYaw、dirty、panel测量尺寸
- **逻辑状态**：脏/世界或tick或插值或yaw变→draw → 相同frame缓存
- **触发、守卫与转换**：same要求四者相等且!dirty；resize/restore置dirty；afterLayout dirty则重draw
- **终态/取消/不变量**：不依赖_dt，不随暂停重复图元；world对象内容原地变而tick等不变时会缓存；terrain/image加载回调只有stage.invalidate，纹理更新独立于几何dirty
- **测试与风险**：无直接；不要称为一次性烘焙，罗盘是按frame键复用

<a id="mp04"></a>

### MP04 罗盘正后方方向滞回（M）

- **所有者/定位**：[src/run/view/compassBar.ts:159,200,208,258](../../src/run/view/compassBar.ts#L159)
- **编码字段**：sides Map<string,−1|1>、seen、bearing
- **逻辑状态**：正前自由bearing → 左/右边缘pin → 正后方保留上次side → 回前方重新确定side → 目标消失删key
- **触发、守卫与转换**：abs(angle)<170°才更新左右；abs(angle)>80°pin到side*80°且降alpha；首次正后默认right；seen不含key则delete
- **终态/取消/不变量**：防±π跳边靠历史side；不靠sin动画。keys为station:id/chest:id/boss/landmark；player死时不提交目标并清sides，复活重新选side
- **测试与风险**：无直接；重建/死亡/目标类别变化都会失去hysteresis历史

<a id="mp05"></a>

### MP05 站点标签复用（M）

- **所有者/定位**：[src/run/view/minimapLayers.ts:65,231,256,310,358,371](../../src/run/view/minimapLayers.ts#L65)
- **编码字段**：labels Map<stationId,MapLabel>、panel/text、label.opacity、全局opacity、seen
- **逻辑状态**：未创建 → onMap懒创建/显示 → offMap隐藏并保留 → 回到onMap复用 → dispose
- **触发、守卫与转换**：站点在图内才seen并建label；可用性变更alpha；不seen设display none；setOpacity同步现有label
- **终态/取消/不变量**：隐藏不delete，单地图站点数限定增长；dispose每Text+panel并detach；几何icon与label有不同是否onMap规则，不能把label隐藏当站点已销毁
- **测试与风险**：无直接。复用同station id但改变kind不会重建固定文案，依赖world/站点在本map生命期不换身份

<a id="mp06"></a>

### MP06 地图图元池扩容（F+M）

- **所有者/定位**：[src/run/view/mapInk.ts:41,115,130,146,167,172](../../src/run/view/mapInk.ts#L41)
- **编码字段**：capacity/count、4组attributes、geometry、inkSize
- **逻辑状态**：初始cap0 → begin/count0 → add → 满容量grow64或×2且复制旧data → end有效前缀 → 下帧复用
- **触发、守卫与转换**：grow先dispose旧geometry的GPU上传，再换attributes；end标dirty且设instanceCount；afterLayout取content.size
- **终态/取消/不变量**：grow是重配上传而非放弃CPU geometry；不按每一marker建mesh；borrowed icon texture不由MapInk.dispose单独释放；测量plane保持layout稳定
- **测试与风险**：无直接；扩大池时保留本帧旧内容、不可把geometry.dispose理解为owner已terminal

<a id="mp07"></a>

### MP07 地图资源上传与最终释放（M）

- **所有者/定位**：[src/run/view/minimap.ts:44,151,391,402,411](../../src/run/view/minimap.ts#L44)；`compassBar.ts:33,86,295,303,310`；`mapInk.ts:176,180,183`；`minimapLayers.ts:43,365`
- **编码字段**：retained DataTexture/base/icons、material.needsUpdate、attribute.needsUpdate、UI节点parent、motion
- **逻辑状态**：活跃上传 → releaseUploads仅GPU失效 → restore标记重传/dirty → 活跃；final dispose拆树
- **触发、守卫与转换**：base/maps sampler藏compile闭包所以显式dispose上传；restore保留CPU data/icon image再needsUpdate；final先cancel动画、dispose children、remove parent
- **终态/取消/不变量**：base由createMinimap持有释放；icon从共享images.texture借出，缓存与ImageBitmap生命期引用他人负责的image-store机器，本篇不重复列；material/geometry与icon源所有权不能混同
- **测试与风险**：T6 images store、T9 prepare间接；本篇未验证正式context-loss。没有内部dead flag阻止dispose后restore，owner须保证终止

<a id="mp08"></a>

### MP08 地图压力聚合帧协议（F）

- **所有者/定位**：[src/run/view/minimapLayers.ts:60,67,116,128,165,171,350](../../src/run/view/minimapLayers.ts#L60)
- **编码字段**：pressure[]、counts/sumX/sumY/touched、occupied、各MapInk counts
- **逻辑状态**：每帧清pressure+begin → 聚合touched格 → 提交heat并清该格累计 → markers/icons → end
- **触发、守卫与转换**：首次counts[i]==0登记touched；只遍历occupied清sum/count；special boss/elite单独处理；full与mini mask不同
- **终态/取消/不变量**：touched后方旧值不读；counts非0导致不登记格，若中间异常没有正常cleanup后继续update可能残留，外部一般失败终止。只是帧scratch协议，无跨帧敌人热量记忆
- **测试与风险**：无直接；这不构成“缓存每个敌人”的第二套状态机

## E. 开发者工具、diagnostics record/flush 对应行为

**命名核对：**当前 `src/run/dev/` 只有 `layers.ts`、`readout.ts`、`runLog.ts`。在 `src/` 搜索 diagnostics/diagnostic/record()/flush() 后，没有找到独立 diagnostics record/flush 生命周期接口；`record()`出现在网络对象结构校验，`flush()`出现在VFX ribbon提交，均不是诊断日志写出。以下登记用户所指诊断功能的实际对应行为：runLog记录/快照下载、readout聚合/发布/窗口清空。不存在的异步磁盘flush队列不补造。

<a id="dv01"></a>

### DV01 开发图层切换与重建（M）

- **所有者/定位**：[src/run/view/debug/layers.ts:57,86,224,359](../../src/run/view/debug/layers.ts#L57)；声明[src/run/dev/layers.ts:1](../../src/run/dev/layers.ts#L1)；生命周期调用边界`createRun.ts:363,371,518,1213`
- **编码字段**：外部devMode/layers Set/debug?、内部labels?、geometry count/root
- **逻辑状态**：disabled/无layers → 创建所选overlay → update所选层 → toggle时dispose再build → disabled/zone销毁
- **触发、守卫与转换**：syncDebug总先dispose；仅devMode&&layers.size&&view重建；states在构建时决定是否创建DebugLabels；每帧count清0，写线，setDrawRange
- **终态/取消/不变量**：只读sim/nav，不能申请flow field或修改需求；dispose labels/geometry/material并detach root。enabled是Set引用，但正式使用每次修改后rebuild，不应随意单改states而不重建
- **测试与风险**：T7直接静态headless契约；states标签被投影null避开，所以没有覆盖真正文字创建/显示

<a id="dv02"></a>

### DV02 调试标签池（M）

- **所有者/定位**：[src/run/view/debug/labels.ts:8,20,33,68,72](../../src/run/view/debug/labels.ts#L8)
- **编码字段**：labels[]、used、Text.display/parent
- **逻辑状态**：无label → 视口内目标首次需要懒建 → 使用前缀 → 余量隐藏保留 → 复用/最终dispose
- **触发、守卫与转换**：近24范围、投影非null且在viewport才占slot；used与目标顺序绑定，不按enemy id；未用尾槽display none
- **终态/取消/不变量**：无单label删除；历史最高并发label数保留到overlay dispose；终结removeFromParent+dispose
- **测试与风险**：T7仅offscreen分支；无直接有文字池增长/复用测试

<a id="dv03"></a>

### DV03 读数采样窗口与翻页（M）

- **所有者/定位**：[src/run/dev/readout.ts:27,61,166](../../src/run/dev/readout.ts#L27)
- **编码字段**：page、elapsed、frames/presented/worldDrawn、presentedSeen/worldSeen/lastGpuAt、4个Window(total/worst/count)
- **逻辑状态**：初始等待首帧即发布 → 累计采样 → 0.25秒发布 → 清窗口；page0→1→2→0
- **触发、守卫与转换**：nextPage改page并elapsed=REFRESH，不立即publish；frame累计外部stats计数差；gpuAt变化且gpuMs非null才采GPU；阈值前return；publish后重置总计
- **终态/取消/不变量**：没有异步flush或持久化；累计每frame发生，文字约按dt窗口输出；切dev off外部丢panel，再开新panel。窗口不重放旧GPU结果
- **测试与风险**：无直接readout测试。publish抛错会阻止后续清零；stats计数需同一owner单调，reset/替换时差值可能负，未复现

<a id="dv04"></a>

### DV04 DPS滑动采样窗口（M）

- **所有者/定位**：[src/run/dev/readout.ts:78,147,186](../../src/run/dev/readout.ts#L78)
- **编码字段**：samples[{time,damage:Map}]
- **逻辑状态**：无DPS样本 → 单点（显示--）→ 多点5秒窗口 → 老样本淘汰
- **触发、守卫与转换**：仅refresh时且last.time!=world.time才push；while length>1且首点距今>5shift；span>0才计算damage差/span
- **终态/取消/不变量**：pause的相同sim time不重复采样；无样本也不伪称0DPS；随panel销毁结束。DPS使用move累计damage同id增长假设，不维护已移除move独立机
- **测试与风险**：无直接；长gap后可能只留一条显示--，换move id缺旧基线按0；不能把它的数值当本任务实测

<a id="dv05"></a>

### DV05 运行日志容量与曝光去重（M）

- **所有者/定位**：[src/run/dev/runLog.ts:58,61,64,79,85](../../src/run/dev/runLog.ts#L58)
- **编码字段**：entries[]、dropped、exposed Set<player:card>、seed?
- **逻辑状态**：未观察 → 观察并锁seed；卡未曝光 → 首次曝光记录 → 同id略过；记录空间可用→已满开始dropped累计
- **触发、守卫与转换**：每个card事件记answer；每player cardShown且key未exposed记exposure并clone options；entries<4000才push，else dropped++
- **终态/取消/不变量**：**只有entries有上限，exposed Set没有淘汰，达到4000后仍add新key**；重复answer事件不去重；data返回entries引用而非冻结副本；export不清空
- **测试与风险**：无直接runLog测试；sim card测试只是上游。不能概括为“全部诊断状态有界”或“事件幂等”

<a id="dv06"></a>

### DV06 日志里程碑与结果锁存（M）

- **所有者/定位**：[src/run/dev/runLog.ts:65,117,120,125,129](../../src/run/dev/runLog.ts#L65)
- **编码字段**：levelAt5、guardianSpawn?/Defeat?、result?、forfeited
- **逻辑状态**：各事实unknown(null)→first observed锁存；playing无result→首次非playing结果锁存；forfeit标记先置true
- **触发、守卫与转换**：time≥300且没player键记录level；bossId非null首次spawn；zone.phase!=active首次defeat；!result&&outcome!=playing提交结果；forfeit调observe(world,[])
- **终态/取消/不变量**：首次事实此后不覆盖；**结果锁存不停止observe记录更多entries**；多区只保留首次guardian时刻；forfeit发生在已记录result之后不会回写result.forfeit；离开后外部window保留runLog供下载
- **测试与风险**：无直接；粗帧观察是“首次看到时刻”，不一定精准事件发生tick；关卡转换world.zone.phase会影响首次defeat推断

<a id="dv07"></a>

### DV07 日志下载URL生命周期（M）

- **所有者/定位**：[src/run/dev/runLog.ts:146](../../src/run/dev/runLog.ts#L146)；调用`createRun.ts:534`
- **编码字段**：Blob、objectURL、临时a元素、setTimeout handle未保留
- **逻辑状态**：数据序列化 → URL有效 → 点击下载 → 1s后revoke
- **触发、守卫与转换**：F9非repeat调用download；每次独立URL、1000ms timer
- **终态/取消/不变量**：不清日志、不flush到固定文件、不等待浏览器成功反馈；没有dispose取消timer；revoke防永久留URL。使用document是开发工具导出，不是正常可见DOM UI
- **测试与风险**：无直接。JSON/stringify/URL/create/click抛错在revoke调度前会中断；native是否可达由owner负责，本任务未启动宿主

## F. 数值分析工具的模拟阶段

这里是 `balance/` 的分析模型，不能把它的1秒近似阶段、概率质量和closed-form占用率冒充实际30Hz游戏/真人结果。只登记状态，不报告任何胜率、帧率或性能结论。

<a id="bm01"></a>

### BM01 分析样本/区域/守卫阶段（M）

- **所有者/定位**：[src/run/balance/model.ts:1949,2001,2163,2220,2477,2527](../../src/run/balance/model.ts#L1949)
- **编码字段**：Track.done/zone/zoneStart/boss{hp,max,dmgScale}/bossTtk/clearAt/clear/zoneClears、alive/survival、t
- **逻辑状态**：新样本 → 区域未召唤 → guardian在场 → 超时rampage → guardian死后下区 或 final clear；也可生存质量趋零/单区horizon结束
- **触发、守卫与转换**：step 每1秒；逐关召唤秒数默认参考时点，可由 RunOptions 指定；tz≥summon&&!boss 建固定参考属性的 boss；rampage 在到达时限且守卫已在场或本步召唤时进入；半血切换攻击预算/曝光率；alive<1e−4 置 done。boss.hp≤0 时先以一只宝箱与六颗分别向上取整的 XP 糖果进入 BM04，乘当前 XP 倍率，再进入下一 zone 或 final clear；单区 duration+120 外置 done
- **终态/取消/不变量**：done样本停止step；全部不running break；末尾聚合冻结最后alive而非统一归0。换区保留build/HP/partners/ult等，清boss/fired/eruption/crowd/elite待捕；无异步cancel/GPU资源
- **测试与风险**：T8 原有塔七层/guardianHP 检查；**#16** 新增守卫宝箱与取整 XP 影响后续区域构筑的模型对照。死亡与 boss 死同一步均可进入处理，done 与 clear 语义需按代码顺序理解；分析不是自然通关验收

<a id="bm02"></a>

### BM02 区域事件一次触发（M）

- **所有者/定位**：[src/run/balance/model.ts:1993,2177,2188,2287,2485](../../src/run/balance/model.ts#L1993)
- **编码字段**：fired Set<kind@at>、临时本秒fired、eruptionUntil、beats[]
- **逻辑状态**：每zone某beat待触发 → 已触发锁存；eruption off→active(until)→off
- **触发、守卫与转换**：tz≥at−earlyBy且未fired才加入；crowd追加living，elite追加eliteHp/cohort；hazard置eruptionUntil；tz<until每秒带入eruption hits
- **终态/取消/不变量**：换区clear fired并eruptionUntil=0；不为eruption加敌人；同key一次，多个eruption的until是赋值不是并行列表
- **测试与风险**：T8 `model:178`直接保护eruption不加敌人；beat时序/重复key无直接额外测试

<a id="bm03"></a>

### BM03 敌群库存与捕获队列（M）

- **所有者/定位**：[src/run/balance/model.ts:1957,1969,2212,2315,2344,2505](../../src/run/balance/model.ts#L1957)
- **编码字段**：approaching/living/eliteHp/elitesDue[{n,chance}]/killed/killRate/partners/captureRng
- **逻辑状态**：生成库存 → approaching → living → 清杀；精英cohort排队 → fractional kill消费 → 捕获成功或消耗失败/满槽略过
- **触发、守卫与转换**：未达cap才加spawn stock；approach按速度比例到场；damage清库存；capture FIFO以min(left,due.n,1)消耗；有空slot才用独立captureRngroll，成功从field.pool挑species
- **终态/取消/不变量**：cohort耗尽shift；满伙伴槽也消费kill份额、不继续roll；换区清pending elite/crowd保留partners；captureRng与卡片rng分离避免相互改roll
- **测试与风险**：T8 runModel间接；T10伙伴sim不是近似捕获队列测试。普通小数精英每秒累积队列，不把每条cohort独立算机器

<a id="bm04"></a>

### BM04 解析模型成长与选卡（M）

- **所有者/定位**：[model.ts](../../src/run/balance/model.ts) 的 gainXp/applyPick/previewChoice、growthBefore/recordGrowth、offer/settleRewards；[budget.ts](../../src/run/balance/budget.ts) 的 referencePlayer/itemValues；[survival.ts](../../src/run/balance/survival.ts) 的 growHp/refund
- **编码字段**：player.xp/level/xpNext/stage 是成长来源；Track.levelAt/chestCredit、learnedAt/itemAt/fusedAt、env.exposure/offers；本次奖励 pending 队列与 first 候选；不再保留 Track.xp/level/stage 副本
- **逻辑状态**：普通/精英奖励或守卫奖励 → 宝箱先入队 → XP 跨级时成长并追加选卡 → 依序选卡 → 糖果即时等级再追加子卡 → 队列耗尽；换区保留成长
- **触发、守卫与转换**：gainXp 逐级更新 xpNext/evolve；首机会在入队时 roll，后续在前项生效后 roll；applyPick 执行糖果即时等级。recordGrowth 写 levelAt，进化时加无敌并退还 perStage 保命次数，再按新增上限补 HP（BM06）；offer 记录首次取得/融合时间
- **终态/取消/不变量**：没有 UI 确认等待；previewChoice 给每个候选独立 player/RNG 副本，评估即时等级及全部附加选卡，不消费正式选卡 RNG、不截断合法奖励链；正式 offer 才提交。itemValues 复用该预览路径，referencePlayer 的 xpNext 与参考等级一致
- **测试与风险**：**#16/#17** 的守卫奖励、部分 XP/进化/全部糖果子卡，以及公开 itemValues/成长输出对照定义在 [model.test.mjs](../../scripts/model.test.mjs)；部分采用受控掉落/策略，不等于正式概率平衡或自然成长验收

<a id="bm05"></a>

### BM05 解析模型必杀窗口（M）

- **所有者/定位**：[src/run/balance/model.ts:1975,2323,2366,2396](../../src/run/balance/model.ts#L1975)；`ultimate.ts:23,90`
- **编码字段**：ultCharge、casting、invulnerable、ults[]
- **逻辑状态**：charging → 满charge等待本秒检查 → casting → countdown结束 → charging；无敌窗口可与进化叠加
- **触发、守卫与转换**：casting>0先减STEP，else charge≥1启动；cast总damage/heal在这一秒入账，casting=duration、charge=0；秒末casting≤0才charge；invulnerable以STEP减、用于这一秒exposed比例
- **终态/取消/不变量**：不是逐pulse重放器；冷却/charging整秒量化，casting刚跨0也要下一步才能走else-if发新cast；终态随sample.done冻结；不在ultimate.ts另造状态机
- **测试与风险**：T8模型伤害间接；T10 ultimate模拟charge测试不是本模型施放窗口验证

<a id="bm06"></a>

### BM06 生存概率和保命次数迁移（M）

- **所有者/定位**：[src/run/balance/survival.ts:30,37,135,190,214,279](../../src/run/balance/survival.ts#L30)
- **编码字段**：HpState.layers[u][hpBin]、carry；本步deaths/catchDeaths、charges/fallback/fallbackFirst/lifts
- **逻辑状态**：存活概率质量在 HP/已花 charge 二维状态迁移；damage→保命分支→恢复 HP 或吸收死亡；heal/poison drift；进化退还 charge；最大 HP 改变时 growHp 重映射存活 bins
- **触发、守卫与转换**：每 step 先半 drift→ordinary/catch 复合 Poisson→按 charge/fallback 顺序救回死亡质量→低 HP lift→后半 drift；charge 耗用移动到 u+1；refund 把 u 移回 u−spentPerStage。growHp 按旧绝对 HP 加新增上限、再映到新上限，carry 同步缩放
- **终态/取消/不变量**：普通 heal/growHp 不复活死亡质量；growHp 保留已用保命层，不额外退还次数；上限增长补新增部分，保留缺血量。refund 保持 HP 概率质量；lifts 是占用率近似而非真实单个 cooldown timer
- **测试与风险**：T11 原有 drain/Poisson/catches/save；新增 growHp 的死亡质量、缺血量及已耗保命保留定义，未外推全部复合进化路径。MAX_EVENTS 截断剩余按死亡处理是模型假设，非游戏规则

<a id="bm07"></a>

### BM07 区域命中计时重放（F）

- **所有者/定位**：[src/run/balance/output.ts:205](../../src/run/balance/output.ts#L205)
- **编码字段**：局部left/wait/timer/ticks
- **逻辑状态**：delay等待 → periodic damaging tick → life耗尽返回
- **触发、守卫与转换**：每模拟TICK先减left；wait>0只减wait，否则timer减到≤0加tick计hit；最后left≤0退出
- **终态/取消/不变量**：所有状态限于函数调用，但它确实逐步重放计时器；输出areaTicks。无持久资源/取消，不登记周围纯几何与概率公式
- **测试与风险**：T8 `model:88`对lone-target cast/tick间接验证。delay跨0那个tick不立即命中、expiry判定在tick后，必须保持与sim次序一致

<a id="bm08"></a>

### BM08 分析触发器状态投影（C+P）

- **所有者/定位**：[src/run/balance/triggers.ts:117,319](../../src/run/balance/triggers.ts#L117)；`model.ts:966,2227`
- **编码字段**：player.fx[diceKey]、fx[triggerKey]、fx[key:share]、player.hp、env.frac/kills/rates
- **逻辑状态**：dice级别未初始化→固定平均face；每秒measure覆盖scaling/buff份额；HP代表值由概率均值投影
- **触发、守卫与转换**：onPick.roll的每owned level用??=固定循环face；scaling赋measure；buff写存在位1及share；measure同步player.hp供playerStats
- **终态/取消/不变量**：这是模型私有Player的状态投影，允许写分析样本，不能移植成view写sim；没有真实buff到期/单独随机掷骰生命周期；新分析run用newTrack新player
- **测试与风险**：T8/T11间接；重用同player时dice键不重新roll，intended模型假设。其余triggerModels是closed-form函数，不逐trigger列runtime FSM

## G. 测试与证据索引

| 索引 | 实际检查的测试源码                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 保护的可观察契约与限制                                                                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | [scripts/view.test.mjs:107,128,143,154](../../scripts/view.test.mjs#L107)                                                                                                                                                                                                                                                                                                                                                                                               | 脚底跟随skinned混合结果、avatar世界变换不污染局部floor、尾/壳不误设floor、moving tail卸载恢复并再次挂载。其余`:248,284,303,347`是出生/瞄准与相机足迹，无shake或整view生命周期验证                          |
| T2   | [scripts/view-zone-content.test.mjs:124,176,189,241,273](../../scripts/view-zone-content.test.mjs#L124)                                                                                                                                                                                                                                                                                                                                                                 | 延迟fall不提早显示、新hazard有限geometry、Kadabra fade只读sim、closing-box逃生gap、材质组合/真实EGL用例。`:26,48`属于assets负责人的资源清单/别名资源释放引用；本篇不重盘资产cache                          |
| T3   | [scripts/ultimate-fire-vfx.test.mjs:9,65](../../scripts/ultimate-fire-vfx.test.mjs#L9)                                                                                                                                                                                                                                                                                                                                                                                  | blast-burn特定disc在首渲染frame覆盖全事件radius；embers在下一伤害tick前释放可见geometry。不是全部技能phase/取消/池耗尽覆盖                                                                                 |
| T4   | [scripts/map-dressing.test.mjs:8,38](../../scripts/map-dressing.test.mjs#L8)                                                                                                                                                                                                                                                                                                                                                                                            | decoration位置不占pad/passage等；室内无植被theme不分配植物mesh且可dispose。未直接检验chunk缓存或light-pool dirty键                                                                                         |
| T5   | [scripts/terrain-geometry.test.mjs:5](../../scripts/terrain-geometry.test.mjs#L5)                                                                                                                                                                                                                                                                                                                                                                                       | cliff细分保留穿行高度且不越过crevasse；纯几何正确性，不是异步构建取消测试                                                                                                                                  |
| T6   | [scripts/ui-images.test.mjs](../../scripts/ui-images.test.mjs)、[scripts/ui-model-store.test.mjs](../../scripts/ui-model-store.test.mjs)                                                                                                                                                                                                                                                                                                                                | 只用于共享image/model-store所有权与准备边界引用；缓存细目交其他负责人；不当作minimap/compass本身的交互生命周期覆盖                                                                                         |
| T7   | [scripts/ui-dev-layers.test.mjs:9](../../scripts/ui-dev-layers.test.mjs#L9)                                                                                                                                                                                                                                                                                                                                                                                             | 每debug layer不修改world/nav、dispose后scene/root空；标签anchor刻意返回null，没有真实文字池路径                                                                                                            |
| T8   | [scripts/model.test.mjs](../../scripts/model.test.mjs)                                                                                                                                                                                                                                                                                                                                                                                                                  | move closed-form与模拟cast timing、相对变化、guardianHP、塔层、eruption；新增守卫奖励、糖果预览与成长/itemValues对照。受控概率不等于正式平衡；固定build coop见[coop.test.mjs](../../scripts/coop.test.mjs) |
| T9   | [scripts/ui-steps.test.mjs](../../scripts/ui-steps.test.mjs)、[scripts/ui-prepare.test.mjs](../../scripts/ui-prepare.test.mjs)                                                                                                                                                                                                                                                                                                                                          | prepare/drive调度与取消边界，属外部owner；不能据此断言createRunView构建途中资源全部清理                                                                                                                    |
| T10  | [scripts/evolution.test.mjs:46,71,143,236](../../scripts/evolution.test.mjs#L46)；[partners.test.mjs:53,74,88,219](../../scripts/partners.test.mjs#L53)；[combat.test.mjs:575,603,693,736,796,1008](../../scripts/combat.test.mjs#L575)；[zone-skills.test.mjs:111,146,164,180,204](../../scripts/zone-skills.test.mjs#L111)；[late-zones.test.mjs:240,333,360,404,463,505,535](../../scripts/late-zones.test.mjs#L240)；[zones.test.mjs](../../scripts/zones.test.mjs) | 上游sim行为契约参考：进化/终极技/同伴/预警中断/护盾/区域等。**不是对应view视觉或对象池的直接测试**                                                                                                         |
| T11  | [scripts/model-survival.test.mjs](../../scripts/model-survival.test.mjs)                                                                                                                                                                                                                                                                                                                                                                                                | HP drift、Poisson/连击与Monte Carlo、有限save、shield、治疗、guardian节奏、shared volley、sleep/paralysis、Bonk/Fang；新增growHp保留缺血/死亡/已耗保命。测试存在不等于本次运行或正式数值验收               |

本页状态机盘点阶段未跑 typecheck/lint/build/test/golden；没有生成游戏截图、动态录制或实测性能数据。报告中的风险都是源码边界分析；只有注明“源码可达”的条件判断，不冒称已经发生的用户回归。

## H. 汇总应保留的接口与风险边界

1. **资产cache仅引用。** `assets.ts`中的加载/缓存/共享model/dispose/releaseUploads机器由其他负责人负责；本篇只记录view借用模型、rig临时材质/ghost、minimap icons借用image store。不要重复统计assets机器。
2. **环境重建在外部。** `createRun.ts:1000–1069`提供buildScene/disposeScene/changeZone。已只读核对“旧图先unmount→更新zone→新图→warm”的接缝，完整run/session/准备/网络FSM应由主清单owner登记，不由本篇越界重做。
3. **暂停不等于统一停钟。** elapsed/VFX/wind/骨骼用dt，hitClock有真实时钟门控，tells用插值world.time，footprints用wind clock，readout用传入dt及sim time样本。任何统一重构都必须保留这些区别。
4. **短效结束不都由sim id驱动。** shot/area/warning map通过seen/frame清理；echo/particle/stamp按life；mends独立数组；tells还依赖enemy phase与rank；ballStorm WeakMap按对象身份；跟踪器去除与剩余粒子退场不是同一动作。
5. **帧协议有顺序要求。** live decals/ribbons/volumes/MapInk需要begin→write→end；sprites需要普通draw→release→tell.draw→update；water wade→update；MapLayers touched格必须结算清零。这些状态都藏在counter/cursor，不能因为没有enum漏掉。
6. **具体待核验风险。** 半建view取消无finally；moving rig异常建造无局部rollback；healthBars跨区保留；mend age0+dt0重复spray；ballStorm模块WeakMap跨Vfx共享；诊断exposed Set没有与entries相同上限；minimap/compass脏键之外的原地变更；局部光池只按相机位置刷新。此处只登记，不提出未经授权的实现改动。
7. **纯计算排除边界。** balance `guardianCycle/zoneGuardianCycle/guardianExposure/occupancy/defenceOf/buildOutput/damageEvents`虽描述技能或状态，都是当次closed-form分析；`ultimate.ts`把timeline累计为一次cast的damage/duration，不实际运行pulse排程；`coop.ts`是固定build预算而非多人比赛状态机。真正持久推进在BM01–06/BM08，短周期重放在BM07。

## I. 扫描排除范围

- `src/screens/runArt.ts:1–7`：三个纯URL拼接函数（move/item/station icon），**没有cache、timer、ref或异步状态**。图片的获取/持有不是本文件的机器。
- 静态theme/config/type：`stageThemes.ts`、`zoneThemes.ts`、`themes/types.ts`、六theme的色/几何/布局/参数大表。六theme的decorate资源接缝已在EV06登记；不能把每个颜色或天气预设当独立FSM。
- GLSL/材质/几何：`architecture.ts`、`enemyLook.ts`、`materials.ts`、`patchShader.ts`、`terrain.ts`、`walls.ts`、`environment/terrainGeometry.ts`、`environment/noise.ts`、`environment/clouds.ts`、`environment/ice-surface.ts`、`environment/glacier-surface.ts`、`environment/coast-{dressing,landmark,reef}.ts`、`environment/desert-landmark.ts`等。`grade.patched`的一次性WeakSet已单列RV18；材料资源在RV01/RV02/EV06释放。
- 环境解析动画/数据生成：草/花/芦苇顶点与placement细节、太阳池静态geometry、森林/沙尘/海面/雨/塔雾/火山气体shader、lava crust/flow纹理算法、tower stonework纹理。异步分步游标、分块缓存、脚印环、水中单位队列、light-pool筛选和wind时钟已纳入；不按每根草/每滴雨/每次sin phase列对象FSM。
- VFX sprite specs、颜色表、GLSL形状、flicker/seed/hash、drag reach、每帧rate随机小数、当前轨迹几何：纳入共享pool/renderer使用，不额外登记。完整配方模块矩阵在B节。
- balance静态排除：`skill.ts` profiles/pick policies，`targets.ts`目标范围，`budget.ts`试算/对比/警告，`coop.ts`固定build分析；`output.ts`除areaTicks以外的volley/cohort闭式求值，`triggers.ts`除setMeasures以外的公式表，`ultimate.ts`timeline折叠均无跨调用生命周期。
- 调用边界只读引用：[src/run/createRun.ts](../../src/run/createRun.ts)、[src/prepare/steps.ts](../../src/prepare/steps.ts)、[src/prepare/images.ts](../../src/prepare/images.ts)接口、sim/types/content与相关测试；不声称已完成这些范围的全应用盘点。

## 逐文件覆盖索引

<details>
<summary>展开106个文件的读取范围与摘要</summary>

以下列出分工范围的全部 **106 个文件**：view 93（含仅引用assets 1）、dev 3、balance 9、runArt 1。即105个文件完成本篇分类，1个assets文件仅引用；没有未归类文件。条目共 **71**，其中包含M/F/P/C不同类型，不等同于71台独立业务FSM。

读取时HEAD：`bae88fa1d34e70bcae4f2c86f434379d0436b700`（工作区非干净，HEAD不代表全部内容）。路径+内容合并SHA-256：`53a7a558f14b35762a47dc6be7d3a430aa2fafbc6c28c40cec8691800dfafb84`。每文件SHA-256截前12位只作本篇来源核对。

| 文件                                                                                               | 行数 | 覆盖 / 排除理由                                           | SHA-256前12位  |
| -------------------------------------------------------------------------------------------------- | ---: | --------------------------------------------------------- | -------------- |
| [src/run/balance/budget.ts](../../src/run/balance/budget.ts)                                       |  313 | 排除：预算试算、克隆build比较、警告格式；无持续机器       | `8972a62e024a` |
| [src/run/balance/coop.ts](../../src/run/balance/coop.ts)                                           |   54 | 排除：固定build的closed-form grouped/split预算            | `3c06cd00b989` |
| [src/run/balance/model.ts](../../src/run/balance/model.ts)                                         | 2678 | BM01–BM05/BM08；其余closed-form分析排除                   | `3e54f5ab2556` |
| [src/run/balance/output.ts](../../src/run/balance/output.ts)                                       |  830 | BM07；其余volley/伤害预算公式排除                         | `a28612d0fab2` |
| [src/run/balance/skill.ts](../../src/run/balance/skill.ts)                                         |  101 | 排除：SkillProfile/PickPolicy常量                         | `b2f03d3137d3` |
| [src/run/balance/survival.ts](../../src/run/balance/survival.ts)                                   |  286 | BM06；其他pmf helper归其过程                              | `ee444341564e` |
| [src/run/balance/targets.ts](../../src/run/balance/targets.ts)                                     |   36 | 排除：数值目标/范围常量                                   | `86b1d550bd86` |
| [src/run/balance/triggers.ts](../../src/run/balance/triggers.ts)                                   |  333 | BM08；其余模型公式表排除                                  | `ec5094728a45` |
| [src/run/balance/ultimate.ts](../../src/run/balance/ultimate.ts)                                   |  103 | BM05引用；本文件timeline折叠与charge公式无持久timer       | `4a72703a34bd` |
| [src/run/dev/layers.ts](../../src/run/dev/layers.ts)                                               |   23 | DV01字典/legend，无独立开关owner                          | `5788b6f00ec7` |
| [src/run/dev/readout.ts](../../src/run/dev/readout.ts)                                             |  202 | DV03/DV04                                                 | `b7dff091173f` |
| [src/run/dev/runLog.ts](../../src/run/dev/runLog.ts)                                               |  156 | DV05–DV07                                                 | `31a06b2cd54f` |
| [src/run/view/architecture.ts](../../src/run/view/architecture.ts)                                 |   53 | 排除：GLSL/一次性patch；EV03光池引用                      | `eb66e6826c1a` |
| [src/run/view/assets.ts](../../src/run/view/assets.ts)                                             |  821 | 仅引用：资产缓存由其他负责人负责                          | `c1d93e59f3ae` |
| [src/run/view/boundaryWall.ts](../../src/run/view/boundaryWall.ts)                                 |  129 | RV17                                                      | `51cd07f799ac` |
| [src/run/view/cameraShake.ts](../../src/run/view/cameraShake.ts)                                   |   41 | RV12                                                      | `a771a3fbf17b` |
| [src/run/view/cloysterShell.ts](../../src/run/view/cloysterShell.ts)                               |   42 | RV10（shader部分排除）                                    | `b34ad9c94ba9` |
| [src/run/view/compassBar.ts](../../src/run/view/compassBar.ts)                                     |  323 | MP03/MP04/MP07                                            | `c2a0e5c490be` |
| [src/run/view/createRunView.ts](../../src/run/view/createRunView.ts)                               |  861 | RV01–RV10/RV13–RV16；FX01接线                             | `1cbb4861b39e` |
| [src/run/view/debug/labels.ts](../../src/run/view/debug/labels.ts)                                 |   78 | DV02                                                      | `1b0a0ac1ebe5` |
| [src/run/view/debug/layers.ts](../../src/run/view/debug/layers.ts)                                 |  367 | DV01                                                      | `6a2483a1c9dc` |
| [src/run/view/enemyLook.ts](../../src/run/view/enemyLook.ts)                                       |   65 | 排除：材质外观patch；RV08资源                             | `d286f0c44dac` |
| [src/run/view/enemyMotion.ts](../../src/run/view/enemyMotion.ts)                                   |  162 | RV09（P）                                                 | `fbfd126c0b45` |
| [src/run/view/environment/chunkedInstances.ts](../../src/run/view/environment/chunkedInstances.ts) |   90 | EV02                                                      | `40c4ab6c51fc` |
| [src/run/view/environment/clouds.ts](../../src/run/view/environment/clouds.ts)                     |   37 | 排除：共享风uniform的shader场，关联RV14                   | `35d4093214f3` |
| [src/run/view/environment/coast-dressing.ts](../../src/run/view/environment/coast-dressing.ts)     |    9 | 排除：纯放置predicate                                     | `88106309d534` |
| [src/run/view/environment/coast-landmark.ts](../../src/run/view/environment/coast-landmark.ts)     |   21 | 排除：材质patch，资源EV06                                 | `7c6b359af38c` |
| [src/run/view/environment/coast-reef.ts](../../src/run/view/environment/coast-reef.ts)             |   22 | 排除：材质patch                                           | `51c67347640e` |
| [src/run/view/environment/coast-weather.ts](../../src/run/view/environment/coast-weather.ts)       |  110 | EV06；雨/闪电解析动画排除                                 | `02d357bc6ac4` |
| [src/run/view/environment/desert-dust.ts](../../src/run/view/environment/desert-dust.ts)           |   61 | EV06；解析粒子动画排除                                    | `d968fcc43430` |
| [src/run/view/environment/desert-landmark.ts](../../src/run/view/environment/desert-landmark.ts)   |   26 | 排除：材质patch                                           | `96f44a043d6a` |
| [src/run/view/environment/dressing.ts](../../src/run/view/environment/dressing.ts)                 |  221 | EV01/EV02/EV03                                            | `6e8fd4f924e3` |
| [src/run/view/environment/flowers.ts](../../src/run/view/environment/flowers.ts)                   |  175 | EV01；静态geometry/vertex排除                             | `f17996010876` |
| [src/run/view/environment/foliage.ts](../../src/run/view/environment/foliage.ts)                   |  233 | EV01/EV02                                                 | `ef7af18c2573` |
| [src/run/view/environment/footprints.ts](../../src/run/view/environment/footprints.ts)             |  178 | EV04                                                      | `654fa0d32695` |
| [src/run/view/environment/forest.ts](../../src/run/view/environment/forest.ts)                     |  104 | EV06；motes/材质解析动画排除                              | `0c76c8b34581` |
| [src/run/view/environment/glacier-surface.ts](../../src/run/view/environment/glacier-surface.ts)   |   84 | 排除：冰地shaderpatch                                     | `5a8f890f6619` |
| [src/run/view/environment/grass.ts](../../src/run/view/environment/grass.ts)                       |  125 | EV01；静态geometry/vertex排除                             | `340ccae044cb` |
| [src/run/view/environment/ground.ts](../../src/run/view/environment/ground.ts)                     |  492 | EV01；纹理/GLSL算术排除                                   | `9dcbb71b799d` |
| [src/run/view/environment/ice-surface.ts](../../src/run/view/environment/ice-surface.ts)           |   61 | 排除：冰面GLSL/颜色                                       | `c7009f810f0d` |
| [src/run/view/environment/lava.ts](../../src/run/view/environment/lava.ts)                         |  258 | EV06；crust/flow纹理算法与GLSL排除                        | `dd12155a0c3c` |
| [src/run/view/environment/noise.ts](../../src/run/view/environment/noise.ts)                       |   28 | 排除：纯噪声/GLSL                                         | `772cc854bc32` |
| [src/run/view/environment/reeds.ts](../../src/run/view/environment/reeds.ts)                       |   94 | EV01；静态geometry/vertex排除                             | `4795ddc9001d` |
| [src/run/view/environment/scatter.ts](../../src/run/view/environment/scatter.ts)                   |   77 | EV01                                                      | `b0dc667c65dc` |
| [src/run/view/environment/sea.ts](../../src/run/view/environment/sea.ts)                           |  200 | 排除：按clock解析海浪/湿痕，无CPU池；EV04引用surf洗刷公式 | `64bba232508f` |
| [src/run/view/environment/sunlight.ts](../../src/run/view/environment/sunlight.ts)                 |   86 | 排除：静态geometry/解析闪动；RV01资源                     | `5fa47647143e` |
| [src/run/view/environment/terrainGeometry.ts](../../src/run/view/environment/terrainGeometry.ts)   |   90 | 排除：一次性geometry算法/局部顶点去重Map                  | `84196f2ae8ad` |
| [src/run/view/environment/tower.ts](../../src/run/view/environment/tower.ts)                       |  213 | EV06/EV07；纹理烘焙、atmosphere解析动画排除               | `edf52c056eda` |
| [src/run/view/environment/volcano.ts](../../src/run/view/environment/volcano.ts)                   |  154 | EV06，material.dispose listener管理crust；解析动画排除    | `12fa2573d0fe` |
| [src/run/view/environment/water.ts](../../src/run/view/environment/water.ts)                       |  237 | EV05；其余解析water shader排除                            | `bb758bfc1c98` |
| [src/run/view/environment/wind.ts](../../src/run/view/environment/wind.ts)                         |   96 | RV14共享累计clock/scroll；摆动GLSL排除                    | `2727ca163b06` |
| [src/run/view/grade.ts](../../src/run/view/grade.ts)                                               |  136 | RV18；createGrade静态资源归RV01                           | `c57d847ec412` |
| [src/run/view/healthBars.ts](../../src/run/view/healthBars.ts)                                     |  229 | RV11                                                      | `dd7899ea7390` |
| [src/run/view/landmark.ts](../../src/run/view/landmark.ts)                                         |  120 | RV16（P）                                                 | `4df50fc7fe9a` |
| [src/run/view/mapInk.ts](../../src/run/view/mapInk.ts)                                             |  188 | MP06/MP07                                                 | `5cb520400e3d` |
| [src/run/view/materials.ts](../../src/run/view/materials.ts)                                       |   72 | 排除：材质工厂；RV02所有权                                | `69e3569e23a1` |
| [src/run/view/minimap.ts](../../src/run/view/minimap.ts)                                           |  440 | MP01/MP02/MP07                                            | `b53debfed904` |
| [src/run/view/minimapBake.ts](../../src/run/view/minimapBake.ts)                                   |  172 | EV01；静态颜色算法排除                                    | `92dac09b0698` |
| [src/run/view/minimapLayers.ts](../../src/run/view/minimapLayers.ts)                               |  379 | MP05/MP08/MP07                                            | `d17281d9448e` |
| [src/run/view/patchShader.ts](../../src/run/view/patchShader.ts)                                   |   32 | 排除：同步shader组合，无独立执行timer                     | `daf990bc54c2` |
| [src/run/view/player-rings.ts](../../src/run/view/player-rings.ts)                                 |   56 | 集合投影/静态挂载，关联RV08；脚环不按alive隐藏            | `a434a3a915db` |
| [src/run/view/playerRig.ts](../../src/run/view/playerRig.ts)                                       |  154 | RV02/RV04/RV07                                            | `3837f53c7270` |
| [src/run/view/stageThemes.ts](../../src/run/view/stageThemes.ts)                                   |   33 | 排除：主题/atmosphere索引与纯glslVec                      | `eba4fe8e525d` |
| [src/run/view/tail.ts](../../src/run/view/tail.ts)                                                 |  232 | RV07；rigTail一次性资源预处理引用                         | `dd86efb6772b` |
| [src/run/view/terrain.ts](../../src/run/view/terrain.ts)                                           |  481 | RV01/EV06资源，几何/GLSL排除                              | `8325c1598bda` |
| [src/run/view/themes/coast.ts](../../src/run/view/themes/coast.ts)                                 |  278 | EV06构建/释放资源；其余theme/atmosphere静态配置排除       | `90fc8b5dfa80` |
| [src/run/view/themes/desert.ts](../../src/run/view/themes/desert.ts)                               |  252 | EV06构建/释放资源；其余theme/atmosphere静态配置排除       | `9cc6774640ed` |
| [src/run/view/themes/forest.ts](../../src/run/view/themes/forest.ts)                               |  262 | EV06构建/释放资源；其余theme/atmosphere静态配置排除       | `7640c8a274d3` |
| [src/run/view/themes/glacier.ts](../../src/run/view/themes/glacier.ts)                             |  261 | 排除：静态theme/atmosphere/type配置，无独立生命周期       | `73c5644b7d7f` |
| [src/run/view/themes/tower.ts](../../src/run/view/themes/tower.ts)                                 |  341 | EV06构建/释放资源；其余theme/atmosphere静态配置排除       | `29bcb62d1115` |
| [src/run/view/themes/types.ts](../../src/run/view/themes/types.ts)                                 |  203 | 排除：静态theme/atmosphere/type配置，无独立生命周期       | `499c67370ee6` |
| [src/run/view/themes/volcano.ts](../../src/run/view/themes/volcano.ts)                             |  262 | EV06构建/释放资源；其余theme/atmosphere静态配置排除       | `e11b1e5b5cb5` |
| [src/run/view/towerCutaway.ts](../../src/run/view/towerCutaway.ts)                                 |   87 | EV07（P+F）                                               | `d61b176d06c0` |
| [src/run/view/vfx/coastSkills.ts](../../src/run/view/vfx/coastSkills.ts)                           |  205 | FX06/08/10/21                                             | `20a7957f799c` |
| [src/run/view/vfx/common.ts](../../src/run/view/vfx/common.ts)                                     |  338 | FX02/04/07/08/12/14/17                                    | `9d7c823a16a9` |
| [src/run/view/vfx/decals.ts](../../src/run/view/vfx/decals.ts)                                     |  474 | FX16/FX17                                                 | `3f058226a9ec` |
| [src/run/view/vfx/defaults.ts](../../src/run/view/vfx/defaults.ts)                                 |  244 | FX04/FX05/FX23                                            | `9ffe7f53182d` |
| [src/run/view/vfx/desertSkills.ts](../../src/run/view/vfx/desertSkills.ts)                         |  261 | FX06–08                                                   | `d9a3821bcfcd` |
| [src/run/view/vfx/electric.ts](../../src/run/view/vfx/electric.ts)                                 |  374 | FX04/FX05/FX12                                            | `5378cd1743e6` |
| [src/run/view/vfx/enemySkills.ts](../../src/run/view/vfx/enemySkills.ts)                           |  442 | FX07/08/21                                                | `3ab825e2aae8` |
| [src/run/view/vfx/fire.ts](../../src/run/view/vfx/fire.ts)                                         |  459 | FX04/FX05                                                 | `b96151138010` |
| [src/run/view/vfx/fusion.ts](../../src/run/view/vfx/fusion.ts)                                     |  352 | FX05/FX11/FX12                                            | `b33e83639d5f` |
| [src/run/view/vfx/fx.ts](../../src/run/view/vfx/fx.ts)                                             |  184 | FX12；其余helper排除                                      | `17b8bdde8f71` |
| [src/run/view/vfx/gl.ts](../../src/run/view/vfx/gl.ts)                                             |   91 | 排除：材质/上传工具，归调用池owner                        | `59ebe5315552` |
| [src/run/view/vfx/grass.ts](../../src/run/view/vfx/grass.ts)                                       |  364 | FX04/FX05/FX12                                            | `dff87dfe513e` |
| [src/run/view/vfx/guardianSkills.ts](../../src/run/view/vfx/guardianSkills.ts)                     |  360 | FX06–09                                                   | `a58f6e05163c` |
| [src/run/view/vfx/homing.ts](../../src/run/view/vfx/homing.ts)                                     |  249 | FX04/FX12                                                 | `74b67351f9c7` |
| [src/run/view/vfx/items.ts](../../src/run/view/vfx/items.ts)                                       |  105 | FX02/FX14/FX17                                            | `c67a0f2a83f5` |
| [src/run/view/vfx/lob.ts](../../src/run/view/vfx/lob.ts)                                           |  112 | FX04/FX05                                                 | `de021451a2a8` |
| [src/run/view/vfx/nova.ts](../../src/run/view/vfx/nova.ts)                                         |  147 | FX05/FX12                                                 | `e6086385727e` |
| [src/run/view/vfx/palette.ts](../../src/run/view/vfx/palette.ts)                                   |   75 | 排除：纯颜色表                                            | `10b235982ad1` |
| [src/run/view/vfx/partners.ts](../../src/run/view/vfx/partners.ts)                                 |  139 | FX12/FX22                                                 | `604f3b04f90a` |
| [src/run/view/vfx/pool.ts](../../src/run/view/vfx/pool.ts)                                         |   19 | FX12/14/17共同compact helper                              | `05a7ec79d526` |
| [src/run/view/vfx/ribbons.ts](../../src/run/view/vfx/ribbons.ts)                                   |  304 | FX18                                                      | `1b0a1b948456` |
| [src/run/view/vfx/sprites.ts](../../src/run/view/vfx/sprites.ts)                                   |  582 | FX14/FX15                                                 | `fd527aca49bb` |
| [src/run/view/vfx/status.ts](../../src/run/view/vfx/status.ts)                                     |  418 | FX21（P+F）                                               | `28b3e5ef5fe6` |
| [src/run/view/vfx/tells.ts](../../src/run/view/vfx/tells.ts)                                       |  230 | FX20                                                      | `8745f8d7b4e3` |
| [src/run/view/vfx/ultimates.ts](../../src/run/view/vfx/ultimates.ts)                               |  494 | FX02/FX12/FX14–19                                         | `2fc78d8af340` |
| [src/run/view/vfx/volumes.ts](../../src/run/view/vfx/volumes.ts)                                   |  310 | FX19                                                      | `3e710a957e20` |
| [src/run/view/vfx/water.ts](../../src/run/view/vfx/water.ts)                                       |  408 | FX04/FX05                                                 | `d3e5c2923a4d` |
| [src/run/view/vfx/wave.ts](../../src/run/view/vfx/wave.ts)                                         |  185 | FX04/FX05                                                 | `d2ef35db0c93` |
| [src/run/view/vfx/zoneSkills.ts](../../src/run/view/vfx/zoneSkills.ts)                             |  377 | FX06–08/FX13/FX21                                         | `c3e804515a87` |
| [src/run/view/vfx.ts](../../src/run/view/vfx.ts)                                                   |  880 | FX01–FX06/FX13/FX22及配方dispatch                         | `a3479dad69ac` |
| [src/run/view/walls.ts](../../src/run/view/walls.ts)                                               |  178 | 排除：一次性geometry/资源工厂，归RV01                     | `7d920fc804e1` |
| [src/run/view/zoneThemes.ts](../../src/run/view/zoneThemes.ts)                                     |    9 | 排除：按当前zone纯选择theme                               | `efd07e9a0ee2` |
| [src/screens/runArt.ts](../../src/screens/runArt.ts)                                               |    7 | 排除：纯URL函数，无机器                                   | `aef2dc19e5bf` |

</details>

## K. 自查范围

已以字段/guard/删除/回收/构建/释放位置交叉检索，核对了71个ID无重复、106个路径全覆盖、每个表项含owner位置/编码字段/逻辑状态/转换/终结不变量/测试与风险。未请其他子代理审阅，遵循本任务禁止再委派的要求。此自查只检查清单完整性与源码对应，不代表游戏运行验收。
