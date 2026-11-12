# 音频

**需要新音效或音乐时，用项目的 ElevenLabs MCP 生成，按本文的风格和规则做，不要手写合成、不要从别处拿素材。** MCP 的连接与登录见 [ELEVENLABS-MCP.md](ELEVENLABS-MCP.md)。

正式声画契约见 [asset-pipeline](../openspec/specs/asset-pipeline/spec.md)。本页维护制作、母带和接入方法；发布条目与取样选择只维护在 `assets/audio/elevenlabs/manifest.json`，时序数据由 `master/timing.json` 生成。

## 声音身份

一句话：**明亮、干净、干（音效不带混响）的海岸冒险，卡通但不幼稚**。对应 [PRODUCT.md](../PRODUCT.md) 的品牌（明亮、清晰、干净、灵动、不过于儿童化）。

|      | 要                                                                                                          | 不要                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 音乐 | 有旋律、有编排发展的乐队 / 民谣：原声吉他、小提琴 / 长笛 / 口哨主旋律、贝斯、真鼓组、手风琴、弦乐，铜管点缀 | 马林巴、卡林巴、钟琴、拨奏弦乐做主奏或循环音型（听起来就是“叮咚叮咚”）；人声、合唱、重失真、大混响 |
| 音效 | 干声、近距离、短尾巴；确认 / 拾取 / 升级可以用马林巴、钟琴                                                  | 尖、亮、嘶嘶的高频（见「舒适度」）                                                                 |
| 通用 | 原创风格；中频留空给预警音                                                                                  | 任何宝可梦的曲目或叫声；提示词里写作品名、曲名、艺人名                                             |

项目没有官方宝可梦音乐授权（见 PRODUCT.md），所以全部是原创风格，不模仿已有旋律。

### 局内 BGM 的情绪（来自三轮试听反馈）

**宝可梦野外 / 道路主题的感觉：明亮、好奇、乐观，有一个好记的旋律勾子，弹跳的律动，带一点点悬念；轻快但不激烈，不是战斗曲，也不是休闲放松。**

被否决的三个方向各错在哪：民谣和轻快乐队太“冒险 / 轻松”，不像肉鸽局内；合成器摇滚、taiko 管弦、街机摇滚太“战斗爽”，也没有宝可梦的味道。目标在两者之间。

- 旋律：一个四小节左右、带小跳进的**勾子**（长笛 / 小号 / 双簧管 / 合成器长笛），乐句之间留空；中频保持干净，给局内很密的音效留位置。
- 律动：弹跳、切分的贝斯，轻的鼓（军鼓轻敲、铃鼓、响指、踩镲），**不要**失真吉他、taiko、摇滚鼓组，这些就是“战斗”。
- 情绪：好奇和乐观为主，桥段转小调时只带一点悬念，不要升到高潮；中速约 120–126 BPM。
- 头目曲在同一语言里再抬一档紧张度，不要变成慌乱。
- 提示词里直接写：`curious, adventurous and optimistic with a thread of gentle suspense, lively but not intense, not a battle track`。
- 原创：不模仿任何已有旋律，提示词里不写作品名。
- 能量平稳对局内曲是对的，**RMS 起伏小既不能证明它好听，也不能证明它单调**。
- **方向已定：F**（乐队 + 弦乐 + 小号的 JRPG 野外，G 大调 124 BPM）。听感反馈是“其实还可以”，不是“很好”，后续仍可调。G（管弦）、H（合成器流行）没被选中，留作备选。

**调性与速度做成一个家族**，方便按小节切换：局内曲和头目曲同速度、关系大小调（如 E 小调 ↔ G 大调），菜单可以更亮。风格选定后其余曲子对齐到它。

## 舒适度：不能突然刺耳，也不能突然很响

大事件（头目、进化、终极技、宝箱）仍然要响，所以**削的是尖，不是响**。母带对每个声音都强制：

1. **峰值上限按事件大小**：小 / UI −6 dBFS，中 −3，大 −1。越小的声音越不可能冲出来。
2. **4 kHz 以上的能量占比上限**：高频出现的声音 15%，其他 40%。超了就加一个高频搁架衰减（最多 −12 dB），日志里会写 `tamed`。人耳最敏感在 2–5 kHz，真正让人累的是这一段里又响又嘶的东西。
3. 响度目标按层级（见「响度与混音」），大事件保留 −18 dBFS RMS。
4. 起音有 2 ms 淡入，避免爆音点击。

5. **一秒内会响好几次的战斗提示音不能是纯音**：纯音（钟声、`ping`、`chime`、`beep`、`alarm`）重复出现就是“叮叮叮”，而且 4 kHz 占比抓不到它（`crit` 的钟声在 1.6–2.5 kHz）。`bun run audio:master --report` 的 `tonal` 列是最强频率附近 ±6% 里的能量占比，高频出现的声音超过 70% 会标 `TONAL`。拾取类（糖果）的钟声不算问题，那是奖励反馈；战斗反馈（会心、预警、危险）要用钝的撞击、轻敲、气声。

**EQ 救不了的要重新生成**：旧版 `revive` 有 100% 的能量在 4 kHz 以上，压 12 dB 还是 98%。

提示词用词决定了尖不尖（4 kHz 以上能量占比，实测）：

| 提示词                                                                              | 结果          |
| ----------------------------------------------------------------------------------- | ------------- |
| `bright / sharp / sparkle / metallic / zap / shimmer`（电属性、会心、复活的第一版） | 52–100%，刺耳 |
| `muted, rounded, warm, dull, soft` + `no high-pitched squeal / sparkle`（第二版）   | 0–21%         |

检查：`bun run audio:master --report <id>` 的 `>4k` 列和 `HARSH` 标记；`HARSH` 只是告诉你母带会把它压暗多少，压得多的最好换 take。

## 声画同步：重音要落在画面的关键帧上

不能画面演完了声音才出来，也不能声音先响而画面还没开始。做法不是把每个音效的重音都裁到 0 ms，而是**记下每个音效的重音点，接入时把它排到特效的关键帧上**。

- 每次母带都会写 `master/timing.json`：`lenMs`（总长）、`hitMs`（第一次进入自身峰值 −6 dB 以内的时刻，也就是真正“打到”的时刻）、`peakMs`（最响的时刻）。
- 接入公式（Web Audio）：`startAt = 事件时刻 + 特效关键帧(ms) − hitMs`。结果为负时不能提前播，改成 `source.start(0, 偏移 = −startAt)` 跳过前奏；结果为正就延后 `start(when)`。
- 容差：重音与关键帧相差 ±40 ms 内（约 1 个模拟 tick = 33 ms）算对齐。视频行业常引用的“察觉不到”窗口是声音早约 45 ms 或晚约 125 ms 以内（ITU-R BT.1359，测的是说话画面，不是游戏音效，资料里正负号的写法还不一致），所以对打击类声音要取更严的值：声音晚比声音早更难受。
- 带前奏的声音（`evolve`、`chest`、`level`、`ui-transition`、`ui-start`）必须和一个已知时长的画面前奏配对，下表逐个核对过；新增这类声音时要先确认画面里有对应的前奏，没有就把前奏裁掉（母带里把 `hitMs` 压到 ≤ 15 ms）。

## 向大作学的做法（2026-11-05 调研，对照本项目）

来源见「调研来源」。只收能落到这个游戏上的做法；“我们现在”一栏是读代码确认的。

| 做法                                                                                                                         | 谁这么做                                                         | 我们现在                                                                                              | 差距 / 下一步                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **优先级阶梯 + 余量策略**：事先写清谁能“领唱”；事件变密时是重新分配谁领唱，而不是整体变响                                    | Riot（Sandy Zhou：“可读性有上限，混音失去层级，玩家就失去信息”） | 有层级（小 / 中 / 大 / UI）、冷却、14 声部上限、`always`；大事件压低音乐，垫底层（`bed`）同时压低一半 | 让位只按音量，不按频段                                                       |
| **重要度系统**：按“谁对我威胁最大”（距离、是否在攻击我）动态调整混音，次要的压低                                             | 暴雪《守望先锋》（GDC 2016 “Play by Sound”）                     | 14 m 内才出声；同一批事件只播一个预警，红色优先                                                       | 没有按距离给音量                                                             |
| **按频段让位，不只压音量**：关键音出现时只挖掉其他声音的对应频段（侧链 / 动态 EQ），整体不变小                               | 《博德之门 3》（Audiokinetic 讲座）                              | 按音量压音乐和垫底层，不按频段                                                                        | Web Audio 能做（`BiquadFilterNode` 当动态 EQ），但没做过，先听真机混音再决定 |
| **内容变体 + 音高和音量随机 + 分层**，让战斗声不重复                                                                         | 《星战：原力释放》《Conan》（Designing Sound 2009）              | 多条轮换、不连续重复、±6% 音高、±1.5 dB 音量                                                          | 没有分层                                                                     |
| **轻重分档**：轻击、重击、格挡分别是不同事件                                                                                 | 《Conan》（Hit Light / Hit Heavy / Blocked …）                   | 只有 `hit` / `crit`，削弱时降音高；击中按属性分四族                                                   | 按伤害大小在 `hit` 里挑“重”的变体是低成本改法                                |
| **冲击 = 起音 + 主体 + 尾巴**；高频冲击要短尾巴，起音和主体的时间差决定“大小和力度”                                          | 多位游戏音效师的教程（不是标准）                                 | 每个声音是一条成品 take；击中音按招式属性分火 / 水 / 草 / 电四族，其余属性用通用击中                  | 没有运行时分层                                                               |
| **预警音和攻击音分开**，先警告、后快攻；预警可以是抽象音，不必模仿来源                                                       | Epic《Paragon》（狼群预警是合成器琶音）、Redstart《Fang Tango》  | 蓝 / 红两类预警，按前摇开始发                                                                         | 红蓝已能分开；不同攻击（俯冲、滚动、毒液）共用同一个预警                     |
| **奖励音可以是悦耳的音调，高频提示音要短、不烦人**；“英雄音”只给大成就                                                       | Google Material 声音规范、Boom Library 休闲 UI 合集              | 糖果、升级、宝箱用钟声，战斗反馈已改成非纯音                                                          | 一致（见「舒适度」第 5 条）                                                  |
| **响度按平台和收听方式**：主机 −24 LUFS（Sony ASWG-R001，微软 / 任天堂沿用），手机外放约 −16 到 −18 LUFS，戴耳机安静环境 −24 | Sony、IESD / G.A.N.G.、Rob Bridgett（2015）                      | 音乐 −20 LUFS，音效按层级 RMS；**整局混音的积分响度没测过**                                           | 录一段真实对局测积分响度；手机外放偏轻时整体提升，而不是只把单个声音调响     |

**由此定下的规则（以后生成或接入时照做）：**

1. 新声音先说清它在阶梯上的位置：领唱（预警、受伤、头目、升级）还是垫底（命中、击倒、糖果）。垫底的声音要短（尾巴 ≤ 160 ms）、不亮、不是纯音（奖励类除外）。
2. 同一类事件分轻重，不要一条声音包所有情况。
3. 预警音只服务“要躲了”，不和攻击命中声共用素材。
4. 测混音时看整局的积分响度和层级，不只看单个文件的电平。

## 什么该单独做，什么不该

先问这几个问题，答案决定要不要生成、生成几条：

1. **它一秒触发几次？** 每秒几次以上 → 按「高频」做：多条真实不同的 take 轮换，短、软、不亮。
2. **玩家要靠它做决定吗（预警、危险）？** 是 → 独立的音色，放在中频，不被音乐和命中声淹没。
3. **已有同族声音能代表它吗？**（同属性、同状态、同类 UI）能 → 不做。
4. **一局里只发生几次、是个大时刻吗？** 是 → 单独做，1–2 条，把独特性花在这里。
5. **区别只在画面上吗？**（不同宝可梦、不同敌人、不同招式）是 → 不做。

### 音乐

| 情况                                     | 做法                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------- |
| 整体状态大切换（菜单、跑图、头目、胜负） | 各一首单独的曲子                                                      |
| 强度渐进（越打越紧）                     | 不另做曲子；用音量 / 滤波 / 分层。AI 目前出不了分轨，所以暂时没有分层 |
| 一次性的反馈（升级、进化、宝箱）         | 做成音效点缀，**不要重启或打断音乐**；不做成曲子                      |
| 选角、研究所、工坊、选卡、暂停           | 不另做：沿用菜单曲，或把跑图曲压低 / 加低通                           |
| 每只宝可梦 / 每种敌人                    | 不做                                                                  |
| 新地图                                   | 新增 1 首跑图曲（同家族），头目曲复用                                 |

### 音效：按频率决定变体数

| 频率                  | 例子                               | 变体            | 要求                                                       |
| --------------------- | ---------------------------------- | --------------- | ---------------------------------------------------------- |
| 高频（每秒数次）      | 命中、击倒、糖果、光标移动         | 3–4 条真实 take | 短（≤约 220 ms）、起音快、不亮；窄范围变调 ±6%；不连续重复 |
| 中频（每秒 0.2–2 次） | 会心、受伤、反应、冲刺、树果、升级 | 2–3             | 同上，但可以稍长                                           |
| 低频的大时刻          | 头目、进化、终极技、宝箱、守卫倒下 | 1–2             | 独立、完整；挑不出好坏时两条都留，让听的人选               |
| UI                    | 确认、返回、禁用                   | **1 条**        | UI 要稳定统一，不随机化                                    |

- **变体要靠重新生成，不能靠一条录音变调**：变调出来的“变体”有可察觉的规律。变调只用来做窄范围抖动（`engine.ts` 的 `PITCH_JITTER`，±6%）。
- **招式按属性做家族，不逐招式做**：火 / 水 / 草 / 电各一族（`cast-*`），只给慢而重的招式用；高频的弹丸、连射靠命中声反馈。
- **新宝可梦、新招式、新敌人默认不新增声音**，先归到已有的族；只有出现新属性才加一个 `cast-<属性>`。预警招式确实需要时，加**一个**通用预警音，不按敌人分。
- 层级沿用 [GAME-FEEL.md](GAME-FEEL.md) 的小 / 中 / 大三层，另加 UI。

## 提示词模板

### 音乐（按顺序叙述编排）

依据 ElevenLabs 官方的音乐提示指南：把编排按时间顺序讲出来，承重的是 `start with`、`just`、`then`、`bring in` 这几个小词；指定的 BPM 和调性会被精确遵守；正文里写 `no X` 能排除。

```text
Instrumental <风格> for a video game <用途>, <调性>, <BPM> BPM.
Start with just <乐器> for <n> bars, then bring in <乐器>, then at about 0:08 <主旋律乐器>
plays a catchy, singable melody in long flowing phrases. Around 0:25 a contrasting bridge
adds <乐器> with a lifting chord change, then at 0:38 the main melody returns with the full
band, and the music settles back to the opening groove by the end so it can loop.
<制作风格>, no vocals, no marimba, no glockenspiel, no repetitive plucked ostinato.
```

- **不要写** `ostinato`、`steady constant energy`、`no dramatic swells`、`no big build`：这正是第一批被听成“叮咚叮咚”的原因（LESSONS.md「音频」）。
- 写清楚情绪目标（见「局内 BGM 的情绪」），不要只写风格：同样是“好听的冒险曲”，民谣和轻快乐队就不像肉鸽局内。
- **先出 45–60 秒的几种风格让人听**（每首约 700–900 credits），选定方向再出全套。官方的“作曲计划”（逐段指定时长和风格）只在 API 里，这个 MCP 没有。
- 速度写 `124 BPM` 这样的具体数；循环曲让结尾回到开头的律动。

### 音效

`<一个具体的声音，写质地 / 音高 / 起音>, dry close-mic, no reverb, no music, no voice`

- 一条提示词只写一个声音，不写画面词和电影词（模型指南的要求）。
- 高频声音写 `very short`、`soft`、`muted`；避免 `bright / sharp / sparkle / metallic / zap`。
- 重击类写 `mid-range knock/crack ... audible on a small speaker`：手机放不出 300 Hz 以下（LESSONS.md「音频」）。
- 要有持续结构时把结构写出来（`rising ... for about one second and ending in ...`），不要只靠时长。
- `duration_seconds` 最小 0.5；`prompt_influence` 用 0.5。

## 响度与混音（起始值，未经试听校准）

母带把每个声音放到同一个相对水平，最终平衡在代码里用总线增益调。

| 类别              | 目标                  | 峰值上限     |
| ----------------- | --------------------- | ------------ |
| 音效·小           | 活动区间 RMS −26 dBFS | −6 dBFS      |
| 音效·中 / 大 / UI | −22 / −18 / −24 dBFS  | −3 / −1 / −6 |
| 音乐循环          | −20 LUFS（积分）      | 约 −1.5 dBFS |

这些数只保证同类声音之间一致，音乐与音效的平衡要在总线里听着调。音乐 −20 LUFS 取在主机（−24）与手持（−18）的常见参考之间，不是硬指标（来自项目技能 `.agents/skills/audio-design`）。

运行时的混音在 `src/audio/engine.ts`（数值是起始值，没有按耳朵校准）：总线分 Music（0.5）/ SFX（0.9）/ UI（0.8），主总线带压缩器防叠加削波；头目、危险、进化、终极技、精英倒下、红色预警出现时音乐压低 3–6 dB 并在音效结束后恢复；暂停时音乐降到 0.3 倍而不是停。冷却、声部上限（14）和“重要的声音不让位”沿用旧设计，写在 `RULES` 表里。

## 流程

MCP 工具在 Claude Code 里是延迟加载的：用 `ToolSearch` 以**精确名字**选（不支持通配符），常用的是 `mcp__elevenlabs__creative_add_flow_node`、`creative_run_flow_nodes`、`creative_get_flow_run_status`、`creative_update_node`。

1. **先按上一节判断要不要生成。**
2. 复用 flow `Ak3RbtQLnUYWennQTQkg`。每个声音一个节点：`creative_add_flow_node`，`node_type: sfx` / `music`，`model_id: eleven_text_to_sound_v2` / `eleven_music_v2_5`，把 `duration_seconds`、`prompt_influence`（音乐用 `instrumental: true`）放进 `model_parameters`。**不要用 `creative_generate_in_flow` 做音效 / 音乐**：它不接受时长参数。想改提示词用 `creative_update_node`，再重新运行。
3. `creative_run_flow_nodes` 生成，`generations_count` 每次最多 4（要更多就再运行一次）；用 `creative_get_flow_run_status` 轮询，结果里的 `content_url` 是带签名的 MP3 链接，约 2–3 小时过期，**立刻 `curl` 到 `raw/`**（远程 MCP 不会写本机文件）。命名：音效 `sfx-<id>-<n>.mp3`，音乐 / 短曲 `<id>-<n>.mp3`（id 本身带 `music-` / `jingle-`）。
4. **一次不要提交太多**：分批、跑完一批再跑下一批，一批不超过约 30 条，否则会 429（被拒的不扣费；个别单条会显示 pending 后自动重试）。
5. **多生成再筛**：把 take 登记进 `manifest.json`（`pick` 先留空），运行 `bun run audio:master --report <id>`（只覆盖音效），看峰值、起音、衰减、`>4k` 占比、质心，按标记剔除。标记是建议不是闸门：被 `maxMs` 裁掉的长衰减可以接受；近乎无声的母带会直接拒绝。
6. 在 `manifest.json` 填 `pick`（顺序即成品编号，如 `hit-1`、`hit-2`），运行 `bun run audio:master [id]` 生成 `master/`；脚本会列出每个成品的 RMS / 峰值，偏轻（被峰值限住）时会写 `LOW-LEVEL`，并清掉旧的多余输出。
7. **让人听，用 `master/` 的文件。** 没听过的东西不要写成“已验证”。

价格：音效约 3.3 credits/秒（按请求时长），音乐约 15 credits/秒（60 秒约 900）。`estimate_only` 的结果偏高约 1.8 倍（一次预估 8,222，实际 4,484）。余额看不到，大批量前先问一下。

### `manifest.json` 字段

| 字段                                | 含义                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `kind`                              | `sfx` / `loop` / `jingle`                                                                                               |
| `tier`（sfx）                       | `small` / `medium` / `large` / `ui`，决定响度、峰值上限和默认最大长度                                                   |
| `frequent`（sfx）                   | 高频声音：报告里检查起音 ≤ 40 ms、衰减 ≤ 160 ms、质心 ≤ 5 kHz、纯音占比 ≤ 70%（`TONAL`），并用更严的 4 kHz 以上占比上限 |
| `maxMs`（sfx，可选）                | 覆盖该层默认的最大长度                                                                                                  |
| `bpm` `startSec` `loopBars`（loop） | 速度、起点（裁掉前奏）、循环小节数；脚本在名义终点 ±1 拍里找拍型最吻合的位置并烘焙交叉淡入                              |
| `spend`（可选）                     | 这一条目花的 credits 和日期                                                                                             |
| `takes[]`                           | `file`、`generationId`，改过提示词的 take 带自己的 `prompt`                                                             |
| `pick`                              | 选用的 take（空则跳过）                                                                                                 |
| `note`                              | 备注，例如“已被听感否决”                                                                                                |

## 接入

素材 → `bank.json` → `src/audio/engine.ts` → 事件。

- **文件**：`src/audio/engine.ts`（引擎、`SFX_NAMES`、`RULES`、总线增益常量）、`schedule.ts`（重音对齐和按拍切换的纯函数，`scripts/audio.test.mjs` 测它）、`useAppAudio.ts`（菜单、界面、转场）。局内由 `src/run/createRun.ts` 的 `drain` 把事件翻译成声音。
- **载入**：启动时 `fetch` + 解码全部音效（不需要用户手势，用一个离线 context 解码）；真正的 AudioContext 在第一次点击 / 按键时才创建，之前请求的菜单音乐等它起来再放。音乐按需解码，在大厅时预解码局内曲和头目曲。声音不是硬依赖：音效、音乐或 `bank.json` 载入 / 解码失败时，引擎经 `onError` 报一次（弹短消息并给出文件名，开发日志 `console.error`），那个声音在本次持有期间静音，持有照常就绪，所以首屏、出发和大厅预取都不会因声音失败而卡住或报「无法显示游戏界面」；最后一个持有者释放后，下次持有会重新载入。字体、模型、图片仍是硬依赖。
- **每个声音**：同名多条轮换且不连续重复，高频声音带 ±6% 的变调抖动，UI 不抖动；冷却和声部上限（14，重要的声音不受限）在 `RULES`；冷却里被丢掉的声音可以指定 `fallback`（会心 `crit` 冷却 0.35 s，内退回这一击属性的击中音，红色预警退回蓝色，不留空洞）。带抖动的声音同时有 ±1.5 dB 的音量随机。垫底的高频声音（`bed`：各种击中、会心、击倒、糖果、冲刺）走单独的总线，任何会压低音乐的提示音出现时，它们也一起压低一半的分贝数。`sfx(name, { pitch, gainDb, keyMs })` 的 `gainDb` 是叠加在混音上的音量偏移（糖果连拾用它渐强），`keyMs` 是“从现在起多久后画面关键帧到”，引擎据此用 `soundStart` 排期。
- **局内事件**（`createRun.ts`）：命中 / 会心 / 击倒 / 拾取 / 升级 / 冲刺 / 受伤 / 预警（14 m 内）/ 横幅 / 进化（关键帧 390 ms）/ 终极技 / 复活 / 伙伴加入 / 宝箱（关键帧 360 ms）。慢而重的招式（光束、漩涡、落雷、冲击波、浪、抛射和融合招）按属性出 `cast-*`，按画面延迟排期（`cast` 事件自带这一次释放的 `windup`，`createRun.ts` 直接用它）：漩涡 +250 ms、光束 +300 ms、花朵光束 +450 ms、烈焰旋风 +300 ms、电球风暴 +350 ms、落雷 = 这一次的 `dur`（基础 0.55 s，随持续时间升级和属性变长）；其余招式靠命中声。道具增益生效（`buff`：烟雾球、胆怯球、金属粉、美丽空壳、宝可梦之笛）复用 `berry`、音高 ×1.15，只在受击触发时播（静止、冲刺、终极技触发的太频繁或已有自己的声音，只出画面）；伙伴护主（`partner-guard`，只给伙伴的主人）复用闪避 / 格挡的 `dash`。同一批事件里的叠加规则见「声画同步」末尾。
- **音乐**：大厅及其窗口（研究所、图鉴、设置、存档）放菜单曲；局内放跑图曲的轮换（`engine.ts` 的 `RUN_TRACKS`，`music.play("run")`）：一首放完一遍后按拍换下一首，离开局内时轮换前进，所以下一局从下一首开始；守卫存在（`snapshot.boss`）时按拍切到头目曲；一局结束淡出，胜利短曲延后 350 ms（避开守卫倒下的停顿，不和 `elite-kill` 叠加），失败短曲延后 250 ms。离开局内后回到菜单曲。
- **界面**：GPU 界面各自调用 `getAudio().sfx(...)`（`src/ui/gpu/` 的大厅、研究所、图鉴、存档、局内弹窗与选卡）：确认 → `ui-confirm`，返回 / 关闭 / 取消 → `ui-back`，不可用的控件 → `ui-denied`，焦点或选择移动 → `ui-move`，出发 → `ui-start`（并让出转场音），转场开始 → `ui-transition`（关键帧 293 ms）。`useAppAudio.ts` 只管载入、声音开关、菜单曲和转场音。局内触屏控件不发点击音。
- **设置**：“声音”开关同时管音效和音乐（挂起整个 AudioContext）。
- **开发句柄**：开发构建里 `window.__poketoneAudio()` 返回 context 状态、已解码的音效数、当前音乐和最近 60 次播放（含排期的 `delay` / `offset`），浏览器核对用；生产构建没有。
- **格式**：音效 FLAC（无损、无编解码延迟，高频反馈要的就是延迟准），音乐 AAC。依据是调研：MP3 有编码填充会让循环有缝；Safari 对 Ogg Opus 支持不稳；AAC 各浏览器都能解码。循环曲首尾已在文件里交叉淡入，`source.loop = true` 整段循环。
- **内存**：只解码正在要的那首：局内是当前跑图曲 + 头目曲（各约 30 MB / 20 MB，立体声 32 位浮点），换曲时旧的那首放掉。大厅只下载（不解码）三首跑图曲和头目曲的字节（约 5 MB），换曲时直接从内存解码，不再走网络。局的就绪只等第一首（`music.runTrack()`）。

### 加一个新声音

1. 按「流程」生成、挑 take、母带。2. 在 `manifest.json` 给它加 `ship: "<游戏里的名字>"`。3. 音效：把名字加进 `engine.ts` 的 `SFX_NAMES` 和 `RULES`，在对应事件处调用 `audio.sfx(...)`，并在「声画同步」的表里核对关键帧。4. `bun run audio:master`，再 `bun run audio:master --publish`。

## 未验证

- **除「真人试听反馈」表里的几条外，没有任何声音被人耳听过。** 母带后只量了电平、时长、峰值，选 take 靠起音 / 衰减 / 质心 / 4 kHz 以上占比这类指标，能抓住近乎无声、拖尾、嘶、过亮，抓不住“好不好听”。
- 局内 BGM 的 F / G / H 只量了速度（123.0 / 120.2 / 126.0 BPM，与要求的 124 / 120 / 126 相符）和能量走势：G 有起伏（3.8 dB，开头较轻，最后一秒淡出，循环点已避开）；F、H 全程几乎不变（0.9 / 0.7 dB，从第一秒起满编），大概没有照“先只有贝斯和鼓再加入”的叙述走。像不像宝可梦、是不是肉鸽局内，只有人能判断。
- 胜负短曲只量了形状（起音、满响时长、衰减），没听过，也没比较音乐引擎和音效引擎哪个更好。
- 在无头 Chrome 里核对过：素材载入、点击后解锁、各界面音、局内事件触发、守卫时按拍切到头目曲、一局结束停音乐、设置开关挂起 / 恢复，排期数值（`delay` / `offset`）与预期一致。**没有人在游戏里听过混音**：`BUS_GAIN`、压低量、各层响度都是起始值。
- **没有在 iOS Safari 真机上验证** `decodeAudioData`、AudioContext 解锁和循环无缝。
- 母带的舒适度规则（峰值上限、4 kHz 占比上限、各层响度）是按指标定的起始值，没有按耳朵校准。仍偏尖的声音：`evolve`、`chest`、`cast-grass-2`（已被压暗，但 2–8 kHz 峰值仍接近 −1 到 −6 dBFS）。
- 手机外放：`elite-kill`、`ult`、`boss`、`hurt` 已选质心较高的 take，但没有在手机上听过。
- 部分稀有声音挑不出好坏，两条都留了（`level`、`danger`、`evolve` 等），听完删掉不要的。
- 循环曲的接缝是按拍型相关度选的（C 0.76、D 0.48、E 0.52），不等于听起来无缝。
- 跑图曲 → 头目曲按拍交叉淡入这件事没有人听过；各文件的起点也没有对齐到强拍。
- 请求时长不精确：音乐 8 秒得到 9 秒、6 秒得到 7.5 秒，请求 3 秒的胜利短曲有一条生成了 9 秒；音效有时比请求的短得多（见 LESSONS.md）。所以多出几条，量过再选。

## 调研来源

| 结论                                                                                | 来源（可靠度）                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 音乐提示词：按顺序叙述编排，BPM 和调性会被遵守，正文里可写 `no X`；作曲计划只在 API | [ElevenLabs 音乐提示指南](https://elevenlabs.io/docs/overview/capabilities/music/best-practices) 与 [Composition Plans](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans)（官方文档）                                                                                                                                |
| 渐进强度用分层，大状态切换用整段替换，短反馈用点缀音且不重启音乐                    | [Audiokinetic](https://www.audiokinetic.com/en/blog/how-to-use-interactive-music-to-score-gameplay/)（原文打不开，只看到搜索摘要）、[Abratabia](https://abratabia.com/web-game-audio/dynamic-game-music.php)（博客）                                                                                                                            |
| 变体数：高频 3–6、低频 1–2；不要靠变调做变体；避免连续重复                          | [Game Juice](https://gamejuice.pages.dev/articles/audio-variation-sound-pool)（博客经验，不是标准）                                                                                                                                                                                                                                             |
| 声部上限与优先级，高优先级抢低优先级的声部                                          | [Path of Exile 开发者回帖](https://pathofexile.com/forum/view-thread/3318839)（论坛，数字可能过时）                                                                                                                                                                                                                                             |
| 密集弹幕里叠加音量、限制总响度                                                      | [Godot 论坛](https://forum.godotengine.org/t/need-advice-on-designing-an-audio-playing-system-for-a-bullet-hell-game/140320)（已读，讨论简短）                                                                                                                                                                                                  |
| 闪避压低音乐的数值与坑                                                              | [Game Developer：Ducking](https://www.gamedeveloper.com/audio/game-audio-theory-ducking)（已读，2009 年）                                                                                                                                                                                                                                       |
| MP3 循环有缝，AAC / Opus 更好，需精确循环点                                         | [Web Audio 讨论](https://www.github.com/WebAudio/web-audio-api/discussions/2505)（讨论串）                                                                                                                                                                                                                                                      |
| Safari 的 Opus 支持历史不稳                                                         | [WebKit Bug 238546](https://bugs.webkit.org/show_bug.cgi?id=238546)（Bug 记录，需要真机复核）                                                                                                                                                                                                                                                   |
| 音效提示词的写法                                                                    | ElevenLabs MCP `creative_get_model_guide`（官方指南）                                                                                                                                                                                                                                                                                           |
| 优先级阶梯、余量策略、密集时“重新分配谁领唱”而不是整体变响                          | [Player.One 采访 Riot Sandy Zhou](https://www.player.one/teamfights-exploration-how-riot-games-sound-designer-sandy-zhou-designs-adaptive-environmental-162190)（已读，采访）                                                                                                                                                                   |
| 按威胁动态调整混音的重要度系统                                                      | [GDC Vault：Overwatch – Play by Sound](https://gdcvault.com/play/1023010/Overwatch-The-Elusive-Goal-Play)、[PC Gamer 报道](https://www.pcgamer.com/uk/how-overwatch-uses-sound-to-pinpoint-threats-you-cant-see)（只看到摘要）                                                                                                                  |
| 按频段侧链让位                                                                      | [Audiokinetic：Baldur's Gate 3 Side-chaining](https://www.audiokinetic.com/learn/videos/CZ2tGrpi0Ww)（视频，只看到摘要）                                                                                                                                                                                                                        |
| 变体 + 音高音量随机 + 分层；轻重分档                                                | [Designing Sound：Force Unleashed / Conan 的音频实现](https://designingsound.org/2009/12/01/audio-implementation-on-star-wars-the-force-unleashed-and-conan/)（已读，2009 年）                                                                                                                                                                  |
| 冲击的起音 / 主体 / 尾巴，高频冲击短尾巴                                            | [Violet Recording：打击音怎么做](https://violetrecording.com/how-to-make-impact-sounds/)、[bugnet：分层](https://bugnet.io/blog/how-to-layer-sounds-for-impact)（教程，经验）                                                                                                                                                                   |
| 预警先于快攻、可以是抽象音                                                          | [Prima：Paragon 的音频预警](https://primagames.com/featured/importance-paragon-audio-telegraphs-epic)、[Audiokinetic：Fang Tango](https://www.audiokinetic.com/zh/blog/fang-tango)（采访 / 博客，只看到摘要）                                                                                                                                   |
| 高频提示音短而不烦、英雄音只给大事件                                                | [Material Design：Applying sound to UI](https://m2.material.io/design/sound/applying-sound-to-ui.html)（官方规范，只看到摘要）                                                                                                                                                                                                                  |
| 主机 −24 LUFS、手机按收听方式 −16 到 −24                                            | [Audio Media International：Rob Bridgett 谈手机响度](https://audiomediainternational.com/mobile-loudness-an-adaptive-approach/)（已读，2015 年）、[IESD 参考电平](https://www.audiogang.org/wp-content/uploads/2015/04/IESD-Mix-Ref-Levels-v03.02.pdf)、[ITU-R BS.2434](https://www.itu.int/dms_pub/itu-r/opb/rep/R-REP-BS.2434-2018-PDF-E.pdf) |

找不到爆款幸存者类游戏（《吸血鬼幸存者》《土豆兄弟》）自己的音频复盘；搜到的只有玩家抱怨后期音效造成听觉疲劳，这也是高频声音要短、软、不亮的原因。《吸血鬼幸存者》的配乐是每个关卡不同风格、编排丰富的完整曲子，而不是极简循环（报道，非开发者复盘）。
