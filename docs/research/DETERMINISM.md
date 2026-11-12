# 跨引擎确定性实测（2026-11-05）

> 问题：同一种子、同一串指令，在 V8（Node、Chrome）和 JavaScriptCore（Safari）里跑出来是否逐位一致？
> 结论（已按 §4.2 修复，见 §6：现在三引擎逐位一致）：修复前**不一致**。地图的离散布局一致，模拟在 1–3 分钟内分叉，三个引擎两两不同（连 Node 和 Chrome 都不同）。原因是非正确舍入的 `Math` 函数各家实现不同，外加 JSC 的整数次幂 `**` 用的是反复平方。

## 1. 怎么测的

工具在 `scripts/determinism/`：

- `run.mjs`：先把 `src/` 和 `golden.mjs` 冻结成快照（别的 agent 正在改 `src/`），在快照上跑一遍 `bun run golden` 确认一致，然后从快照的 `golden.mjs` 自动生成可在浏览器跑的 replay，用 Vite 打成**同一个** ES 模块，分别在 bun（JSC）、无头 Chrome（V8）、Playwright WebKit（JSC）里执行。全程不依赖 rAF，浏览器里用 `page.evaluate` 驱动。
- `harness.mjs`：
  - golden v2 的全部 11 个用例；
  - 64 个种子（golden 的 4242、7 加上 1–62）逐阶段、逐位的地图哈希：地形高度、平台、水洼形状、水深网格、`shoreDistance` 采样、道具、导航网格及各层；
  - Math 探针：包住 `sin` / `cos` / `atan2` / `hypot` 等函数，统计调用次数，对每次调用的输入和输出位模式做哈希。
- 探针版本另打一个包，`**` 降级为 `Math.pow`，这样运算符也能被统计。
- 语料对比：
  - 输入是模拟实际用到的值（蓄水池抽样，每个函数最多 4 万个），另有 2 万个合成输入；
  - 输入以位模式十六进制传进浏览器，并回显校验，确认传输无损；
  - 每个引擎冷跑一次、预热 20 轮后再跑一次（看 JIT 分层会不会改结果）。
- `bisect.mjs`：逐 tick 的全精度状态哈希加逐 tick 的 Math 输入 / 输出哈希，找出第一个分叉的 tick，以及出问题那次调用的参数、结果和调用者。
- 当时还有 `det-trig.mjs` 和 `--pure-driver`：用只含四则运算的 sin/cos 替换 golden 输入驱动里的 `Math.cos/sin`，让剩下的差异只可能来自模拟本身。§6 之后 golden 驱动直接用 `sim/math.ts`，这两样已删除。

运行：`PLAYWRIGHT_CORE=<playwright-core 目录> bun scripts/determinism/run.mjs`（不设时自动取 npx 缓存里的 playwright-core）。

环境：

- 一台 Apple Silicon Mac（macOS 27）；
- Node 26.13.0（V8 14.6.202.34-node.40）；
- Chrome 157.0.8103.39 headless；
- Playwright WebKit 27.2（缓存的 `webkit-2359`，由 playwright-core 1.64.1 驱动，它本身期望的是 2370）。

## 2. 结果

### 2.1 自检

- 快照上的 `pnpm golden` 通过；打包后的 Node 结果和 `scripts/golden.json` 11/11 一致，说明这份 replay 忠实于 golden。
- 每个浏览器自己跑两次（两个新实例）完全一致；冷 / 热语料结果也一致：**引擎内部是确定的，差异只在引擎之间**。

### 2.2 golden 摘要（原驱动，`end` 字段）

| 用例                                | Node                           | Chrome                         | WebKit                         | 首个不同采样 tick（Chrome / WebKit） |
| ----------------------------------- | ------------------------------ | ------------------------------ | ------------------------------ | ------------------------------------ |
| solo/charmander/d0/s4242            | 16924 victory ba259b422eaa5563 | 16924 victory c33e3c48848cfc0e | 16924 victory 79f7493aff0a5a6a | 15300 / 12300                        |
| solo/bulbasaur/d1/s4242             | 16812 victory cb6e3252142344c5 | 15660 victory 1bbe1c5b37c8f052 | 16060 victory 52ac308cffdade95 | 5700 / 5700                          |
| solo/squirtle/d2/s4242              | 17996 victory 7099a53475aa059e | 17436 victory a957bd1f2c099388 | 17556 victory 98890043d69a5a92 | 2100 / 1800                          |
| solo/pikachu/d0/s4242               | 18600 playing 7184c62971d219e9 | 18600 playing 65557b8a1aea5db5 | 17757 victory a0ff30d3d74947ad | 5700 / 5700                          |
| solo/charmander/d1/s7               | 16065 victory 98cc72219e929b4e | 16065 victory 6db3f947796e6968 | 16065 victory a6d287daeb4bdaec | 5700 / 5700                          |
| solo/bulbasaur/d2/s7                | 16127 victory 282f0862af17116e | 18369 victory faf3993041f03b58 | 16133 victory b74abed130ddf8f0 | 4500 / 4500                          |
| solo/squirtle/d0/s7                 | 16794 victory 39586451d9f2d5f2 | 18083 victory 7e9c6799c92d6c2d | 18341 victory e3f7c838d5f9c0f8 | 12000 / 10800                        |
| solo/pikachu/d1/s7                  | 18600 playing 300a6b561fc6c804 | 18600 playing e7c127e335e7ccbd | 18600 playing 4ae2c6c354f1ae7a | 5400 / 3300                          |
| coop/charmander+squirtle/d1/s7      | 15546 victory 8e360dd60ad93442 | 17614 victory 1be2b3768916c202 | 17018 victory 00455ad942eb1a9f | 6600 / 5700                          |
| mortal/squirtle/d0/s4242            | 5966 defeat 58a7c9371eee1efd   | 同 Node                        | 同 Node                        | —                                    |
| stations/bulbasaur+charmander/d1/s7 | 9000 playing 70668e43bbb9ae6c  | 9000 playing 1b225f160a19ba08  | 9000 playing 828a99043e97eab2  | 4200 / 4200                          |

- 分叉不是末位噪声，而是结局不同：
  - 合作局 Node 在 15546 tick 胜利，WebKit 在 17018，Chrome 在 17614；
  - 皮卡丘 s4242 在 WebKit 里打赢了守护者，在 V8 里没有。
- `--pure-driver`（驱动不再用 `Math.cos/sin`）：Chrome 仍有 8/11、WebKit 仍有 10/11 个用例分叉。所以**模拟本身**就会分叉，不只是测试驱动的问题。
- 只有 mortal（5966 tick 就死亡）三家一致。

### 2.3 第一个分叉点（bisect，`--pure-driver`）

| 对比                        | 首个全精度状态差异 | 首个出错调用                                                                                                                                                                  |
| --------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| squirtle/d2/s4242 vs WebKit | tick 155           | tick 2，`Math.hypot` 差 1 ULP（同输入）                                                                                                                                       |
| coop vs WebKit              | tick 1             | 创建世界时就已不同：`terrain.ts` `rawHeight` 的 `hypot(-58,-58)`，`pads.ts` `placePads` 的 `hypot`，`puddles.ts` `stream` / `ringMean` 的 `sin`；之后的刷怪与移动输入已经不同 |
| squirtle/d2/s4242 vs Chrome | tick 68            | tick 68，`Math.sin` 差 1 ULP                                                                                                                                                  |
| coop vs Chrome              | tick 135           | `director.ts` `ringPoint` 的 `Math.cos` 差 1 ULP，随后传到 `reachableSpot`、`nearestPlayer`（`**2` 的输入）、`enemies.ts` 的 `steerToward` / `displace`                       |

1 ULP 的误差进入位置 → 距离比较 → 目标选择 / 命中判定，几十秒内就放大成不同的击杀、掉落和升级卡。

### 2.4 地图（64 个种子）

| 阶段                                | Node vs Chrome | Node vs WebKit |
| ----------------------------------- | -------------- | -------------- |
| 地形高度（Float32）                 | 64/64 一致     | 64/64 一致     |
| 平台位置                            | 64/64 一致     | 64/64 一致     |
| 水深网格（Float32）                 | 64/64 一致     | 64/64 一致     |
| 道具 / 障碍                         | 64/64 一致     | 64/64 一致     |
| 导航网格与各层（golden 的两个种子） | 一致           | 一致           |
| 水洼形状参数（Float64）             | 53/64 不同     | 61/64 不同     |
| `shoreDistance` 采样（Float64）     | 53/64 不同     | 63/64 不同     |

- 模拟只读 Float32 的水深网格（`enemies.ts` 的 `waterDepthAt`），所以眼下地图对玩法而言是一致的。不同的只有水洼轮廓的末位，而 view（水面、芦苇、地面混合、小地图）要读它。
- 但这是**侥幸**：
  - 一致靠的是 Float32 舍入把末位误差吞掉了，以及 `hypot(x,z) < r` 这类阈值没被跨过；
  - 换一组种子、或者 2B 加新图章，就可能有一格高度或一个道具不同，进而导航不同。

### 2.5 各函数的实现差异（合成语料，每个函数 4000 个输入）

| 函数                   | Node≠WebKit          | Node≠Chrome | 最大误差 | 说明                                                             |
| ---------------------- | -------------------- | ----------- | -------- | ---------------------------------------------------------------- |
| sin / cos              | 4–5%                 | 3%          | 1 ULP    | WebKit 和 Apple libm 4000/4000 一致；两个 V8 构建也互不相同      |
| tan                    | 39%                  | 4%          | 2 ULP    |                                                                  |
| atan / asin / acos     | 4–18%                | 2–8%        | 1 ULP    |                                                                  |
| atan2 / exp / log      | 2–19%                | 2–19%       | 1 ULP    | Chrome 与 WebKit 几乎一致（都接近 libm），Node 不同              |
| hypot                  | 38%                  | 0           | 2 ULP    | 两个 V8 构建一致，JSC 有自己的实现                               |
| cbrt                   | 11%                  | 8%          | 1 ULP    |                                                                  |
| `**` / pow（整数指数） | 指数 3–8 时 29–71%   | 0           | 4 ULP    | JSC 用反复平方；`x ** 2` 三家一致（等于 `x*x`）；V8 接近正确舍入 |
| pow（非整数指数）      | 抽样 1970 个全部一致 | 0           |          | 规范仍不保证                                                     |

`Math.sqrt`、四则运算、`Math.round` / `floor`、`Math.imul`、Float32 转换都是 IEEE 正确舍入或精确运算，三家一致。

## 3. 调用点清单（`src/run/sim`，以及 `src/run/lab.ts`）

调用次数来自 7 个 golden 用例加 64 张地图的探针统计。

- **`Math.hypot`**（约 7600 万次，最热）：
  - `world.ts`：214、367、376、415、438
  - `combat.ts`：76、127、148
  - `enemies.ts`：93、159、204
  - `enemyAttacks.ts`：223、382
  - `hazards.ts`：25
  - `director.ts`：209
  - `partners.ts`：133、171、193、224、255、284、295、313、320、379
  - `sight.ts`：125、143、154
  - `stations.ts`：60
  - `terrain.ts`：37
  - `ultimates/index.ts`：103、228、260、279、333
  - `bosses/scyther.ts`：39
  - `archetypes/`：
    - `bloom`：83
    - `firestorm`：98
    - `fusionParts`：56
    - `homing`：36、37、42
    - `kit`：117、133、251、273、280
    - `nova`：24
    - `rod`：62
    - `vortex`：21
    - `wave`：20
  - `mapgen/`：
    - `pads`：38、39
    - `props`：42、43、45
    - `puddles`：83、86、96、296、331、332、348、365
    - `validate`：51、55、59
- **`Math.sin` / `Math.cos`**（约 300 万 / 260 万次）：
  - `director.ts`：193、194、315、316、324、325（刷怪环）
  - `enemies.ts`：262、263
  - `enemyAttacks.ts`：137–139
  - `nav/movement.ts`：87、88
  - `partners.ts`：293、294
  - `status.ts`：120
  - `wind.ts`：25
  - `ultimates/index.ts`：172、173、188、189、239、240
  - `bosses/scyther.ts`：107、108、112、113
  - `archetypes/`：
    - `firestorm`：60、61
    - `kit`：123、124
    - `sprinkler`：45
  - `mapgen/puddles.ts`：159、160、177、178、195、196、206、207、233、234、263、264、273、274、382
- **`Math.atan2`**（2.7 万次）：
  - `partners.ts`：292
  - `ultimates/index.ts`：184、224、227
  - `archetypes/sprinkler.ts`：68
- **`Math.atan`**：`ultimates/index.ts`：230
- **`Math.acos`**：`archetypes/kit.ts`：283（扇形命中）
- **`Math.exp`**：`stats.ts`：88（`areaGrowth`）
- **`**` 指数 ≥ 3 或非常量**（JSC 与 V8 会不同）：
  - `upgrades.ts`：48（`(1 + a) ** 3`）
  - `stats.ts`：248（`0.93 ** claw`）
  - `stats.ts`：253（`(1 - TRAIN.cd) ** training.cd`）
  - `stats.ts`：358（`level ** 1.65`，外面有 `Math.round`）
  - `director.ts`：72（`base ** (t / 60)`）
  - `mapgen/puddles.ts`：264（`t ** 4`）
  - `lab.ts`：63（`growth ** level`，有 `Math.round`）
- **`** 2`**（约 1.8 亿次，三家一致，因为等于 `x*x`）：
  - `director.ts`：87、118
  - `enemies.ts`：216
  - `partners.ts`：263
  - `nav/movement.ts`：251
  - `nav/blockers.ts`：48
  - `ultimates/index.ts`：357、370
  - `archetypes/`：
    - `homing`：16、19
    - `lob`：18、20、21
    - `kit`：91
  - `mapgen/puddles.ts`：146

行号对应 2026-11-05 的快照；重构期间会漂移，用 `grep -rnE "Math\.(sin|cos|tan|atan2?|asin|acos|exp|log|pow|hypot|cbrt)\b|\*\*" src/run/sim` 重新生成。

## 4. 建议

### 4.1 先判断要不要逐位一致

README 写的联机方案是「主机运行模拟，客户端发指令、收快照」。照这个方案：

- 模拟只在主机上跑，客户端不需要逐位一致的模拟；
- 但**地图**是每个端各自用种子生成的，view 也读它（地形、水岸、道具、导航）。这部分必须一致，或者被校验。
- 将来若做客户端预测、回放分享、断线换主机或锁步，模拟也必须逐位一致。

### 4.2 最小的确定性替换（建议在 2B 之前做，一次性改 golden）

新建 `src/run/sim/math.ts`，只用四则运算加 `Math.sqrt` / `round` / `floor`，调用点直接改用它（不留 `Math.*` 的兼容分支）：

1. **`hypot(x, z) = Math.sqrt(x*x + z*z)`**：
   - 改动最大（约 70 处），但最简单，而且比 `Math.hypot` 还快；
   - 游戏坐标在 ±100 量级，不存在上溢 / 下溢的问题。
2. **`sin` / `cos`**：Cody–Waite 两段 π/2 规约，加 fdlibm `__kernel_sin` / `__kernel_cos` 的多项式系数（以十进制字面量写死），约 40 行。
3. **`atan2` / `atan` / `acos`**：
   - 移植 fdlibm 的 `atan` 多项式，约 40 行；
   - `acos(c)` 改为 `atan2(sqrt(1 - c*c), c)`；kit.ts:283 更好的做法是不求角，直接比较 `cos` 值：`dot / distance >= Math.cos(a.angle)`，其中 `cos(a.angle)` 用新的 `cos` 算。
4. **`**`**：
   - `x ** 2` 可以留着（三家一致），但为了统一，lint 只放行字面量 2；
   - 整数指数改为显式乘法，或用 `powInt(x, n)`（固定顺序的连乘）；
   - 非整数指数：
     - `xpForLevel` 的 `level ** 1.65` 改成查表（`Math.round` 之后的整数表，直接写成字面量）；
     - `rampageFactor` 改成 `exp(y * LN_BASE)`，用确定性的 `exp`；
     - `areaGrowth` 的 `Math.exp` 同理。`exp` 约 25 行：`2^k` 规约加多项式。
5. **防回归**：用 oxlint 的 `no-restricted-properties` 在 `src/run/sim/**`、`lab.ts` 里禁用 `Math.sin/cos/tan/atan/atan2/asin/acos/exp/log/pow/hypot/cbrt`。oxlint 若不支持对 `**` 用 `no-restricted-syntax`，就在 `pnpm check` 里加一条 grep。

**golden 影响**：

- 所有 11 个用例和所有种子的地图摘要都会变一次，需要 `pnpm golden --write`，提交说明里注明是有意变更。
- 预计只是末位误差：玩法、平衡和 `covers` 都不受影响。若有用例丢了 covers，说明它原本就在临界点上，换驱动参数即可。
- 道具 / 平台布局个别种子可能因为阈值翻转而不同。
- 改完后用 `run.mjs --pure-driver` 应得到「三家一致」。golden 自己的驱动里那两个 `Math.cos/sin` 也要换成 `sim/math.ts`，否则 golden 在 Chrome / Safari 里会因为输入不同而失败。

**性能**：`sqrt` 版本的 hypot 不比 `Math.hypot` 慢；sin/cos 每局约 300 万次，多项式版本在 JIT 下与原生同量级（未测）。

### 4.3 联机保护：主机下发地图校验和

- 主机在开局消息里带上 `seed` 和地图摘要，取 §1 的各阶段哈希：地形高度、水深、平台、道具、导航；Float64 的水洼参数也要包括。
- 客户端生成地图后比对：
  - 不一致就**直接报错并退出房间**（「地图不一致：引擎差异」），不悄悄继续；
  - 或者退一步，由主机下发地图数据本身（一张 Float32 高度图约 100 KB 量级）。
- 摘要函数放在 sim 侧（纯函数，`mapgen/` 里），校验在网络层。
- 即使做完 §4.2，校验和仍然有用：它还能挡住版本不一致、内容表不一致的客户端。

### 4.4 便宜的 CI 检查

- `.github/workflows/ci.yml` 已经跑 `bun run golden`。在它后面加一个 job：
  - 依赖：`playwright-core` 作为 devDependency 精确锁版本，再执行 `playwright install --with-deps webkit chromium`；
  - 命令：`bun scripts/determinism/run.mjs --engines bun,webkit,chrome`（本机全量约 4–5 分钟，可用 `--cases` 只跑 4 个单人用例加合作用例来减半）。
- 注意：CI 是 Ubuntu，Linux 版 WebKit 用的是 glibc 的数学库，**不等于** macOS / iOS Safari。所以：
  - 在 §4.2 之前，CI 结果不能代表 Safari；
  - 在 §4.2 之后，sim 不再调用平台数学库，任何引擎、任何平台都应一致。这时 CI 守的是「有人又引入了 `Math.sin`」，lint 规则是第一道防线，CI 是第二道。

## 5. 没能确认的

- 只测了一台 Apple Silicon Mac。iOS Safari（同为 Apple libm，但 CPU 和系统版本不同）、Intel Mac、Windows / Linux / Android 上的 Chrome、Firefox（SpiderMonkey 用 fdlibm 移植版）都没测。
- 只有一个 WebKit 构建：缓存的 `webkit-2359`，它和 playwright-core 1.64.1 期望的 2370 不匹配，但能正常运行。没有测正式的 Safari.app（隐藏窗口没有 rAF；本工具其实不需要 rAF，但没有去接 Safari 的自动化）。
- 合成语料里非整数指数的 `pow` 三家一致，这只是抽样结果，规范并不保证。
- 地图只测了 64 个种子；导航网格只校验了 golden 的两个种子（经过 `createWorld`），其余种子比对了地形、水、平台和道具。
- ~~§4.2 的多项式实现、精度和性能都没有实现和实测。~~ 已实现并实测，见 §6。

## 6. 已落地（2026-11-05）

按 §4.2 做了一次性替换，**golden 11 个用例和 63 个种子的地图在 Node / Chrome / WebKit 里逐位一致**。

### 6.1 改了什么

- `src/run/sim/math.ts`，只用 `+ - * /`、`Math.sqrt` / `round` / `trunc` / `abs`：
  - `sin` / `cos`：fdlibm 的 `__ieee754_rem_pio2` 中段规约（33 位三段 π/2，第 2、3 轮只在大幅抵消时进入）加 `__kernel_sin` / `__kernel_cos`。定义域 |x| ≤ 2^20·π/2，超出就抛 `RangeError`；golden 里实际最大约 2e4（`时间 × 频率 + 实体 id`，id 最大约 1.3 万）。
  - `atan` / `atan2`：fdlibm `s_atan.c` / `e_atan2.c`，有符号零的规则和 `Math.atan2` 一致。
  - `exp`：fdlibm `e_exp.c`，用精确的倍乘 / 折半缩放 2^k。定义域 |x| ≤ 708，超出就抛错。
  - `hypot(x, z) = sqrt(x² + z²)`，`hypot3` 同理，没有上溢保护（坐标在 ±100 量级）。
  - `powInt(b, n)`：从左到右连乘。
- 调用点：
  - `acos` 去掉了：`kit.ts` 的 `inSector` 改成比较 `dot / distance >= cos(angle)`（angle 在 [0, π] 时与原判定等价）。
  - `rampageFactor` 改成 `exp(分钟数 × 每分钟翻倍次数 × LN2)`，4 倍/分钟即 2 次翻倍。
  - `xpForLevel` 改为查表 `XP_TO_NEXT`，取值就是原来 V8 算出的 `round(6 + 3.4L + L^1.65)`，L = 0…100，超出就抛错。（2026-11-06 起改为整数公式 `12 × (L + 1)`，不再查表、没有上限，见 BALANCE「节奏」。）
  - 其余 `**` 换成 `powInt`；`x ** 2` 保留。
- golden 驱动的 `Math.cos/sin` 也换成了 `sim/math.ts`。
- 防回归：
  - `.oxlintrc.json` 对 `src/run/sim/**` 和 `src/run/lab.ts` 开了 `no-restricted-properties`，禁用 `Math.sin/cos/tan/asin/acos/atan/atan2/…/exp/expm1/log*/pow/hypot/cbrt`；
  - oxlint 没有 `no-restricted-syntax`，所以 `**` 由 `scripts/sim-math.test.mjs` 检查（只放行字面量 2），它也检查各函数与 `Math.*` 相差 ≤ 2 ULP。这个测试已加进 `bun run test:sim`。

### 6.2 精度与性能（Node，对照 60 位十进制参考值）

| 函数  | sim/math.ts 最大误差 | V8 最大误差 |
| ----- | -------------------- | ----------- |
| sin   | 0.750 ULP            | 0.750 ULP   |
| cos   | 0.711 ULP            | 0.720 ULP   |
| atan  | 0.705 ULP            | 0.705 ULP   |
| atan2 | 1.168 ULP            | 1.168 ULP   |
| exp   | 0.810 ULP            | 0.810 ULP   |
| hypot | 1.155 ULP            | 1.653 ULP   |

- 每个函数取 3000–4000 个输入。π/2 的倍数附近（n 最大到 2^20）的难例，sin/cos 都 ≤ 0.5 ULP。
- 单次调用：
  - `sin` / `cos` 约 14.5 ns，`Math.sin` 约 11 ns；
  - `hypot` 6.3 ns，`Math.hypot` 8.2 ns；
  - `atan2` / `exp` 与原生同量级。
- `pnpm golden`：原生 Math 的快照 33.8 / 34.2 s，现在 35.2 / 34.6 s，交替各跑两次，约慢 1–4%。这是上限，因为两边的对局轨迹已经不同。

### 6.3 三引擎结果（`run.mjs --engines node,chrome,webkit`）

| 用例                                | 三引擎相同的 `end`             |
| ----------------------------------- | ------------------------------ |
| solo/charmander/d0/s4242            | 16924 victory 4d200a4750b0ba5c |
| solo/bulbasaur/d1/s4242             | 15986 victory e947382026537a33 |
| solo/squirtle/d2/s4242              | 18600 playing 3b098b24fa0bc010 |
| solo/pikachu/d0/s4242               | 17864 victory 171330f5e55f1919 |
| solo/charmander/d1/s7               | 16065 victory 2fc4d9ae37324b8a |
| solo/bulbasaur/d2/s7                | 17128 victory a05b8a0ed2a0f0c9 |
| solo/squirtle/d0/s7                 | 18338 victory d6ee87c1df7e5d88 |
| solo/pikachu/d1/s7                  | 18600 playing c3b9474e1de5c3b4 |
| coop/charmander+squirtle/d1/s7      | 17440 victory 7079eb001757ebe7 |
| mortal/squirtle/d0/s4242            | 5966 defeat 58a7c9371eee1efd   |
| stations/bulbasaur+charmander/d1/s7 | 9000 playing bb50b9b467fd7533  |

- 每个用例的全部采样摘要都相同，不只是 `end`。
- 地图：63 个种子（4242、7 和 1–62）、共 380 个分阶段哈希三家相同，包括 Float64 的水洼形状和 `shoreDistance`，以及两个 golden 种子的导航网格。§2.4 里不同的那两行也已经一致。
- `sim/math.ts` 在 2 万个合成输入（冷 / 热各一次）上的输出三家相同。
- 探针显示 sim 只剩 `Math.pow` 一个原生调用，即打包时把 `x ** 2` 降级成了 `Math.pow`。它的调用次数各引擎不同（Node 177607932、Chrome 177607912、WebKit 177608724），因为 `archetypes/lob.ts` 和 `ultimates/index.ts` 的排序比较函数里有 `** 2`（每次比较 4 次调用），而比较函数被调用多少次由引擎决定；排序结果由稳定排序保证一致。`run.mjs` 现在只报告这一项，不判失败，探针包的 `end` 摘要三家相同。
- 原生 `Math` 在同一语料上的差异照旧（例如 WebKit 的 `tan` 41%、`hypot` 38%），`run.mjs` 只报告不判失败：sim 已经不调用它们。

### 6.4 golden 重录前后

- 用一份 `math.ts` 改回原生 `Math.*` 的快照跑 `pnpm golden`，与旧 `golden.json` 11/11 一致。说明调用点改写（包括扇形判定、rampage、经验表、`powInt`）不改变行为，变化只来自末位误差。
- `pnpm balance:model` 前后输出逐字相同（只有耗时那行不同）。
- 各用例的结局变化，与 §2.2 里引擎之间的分叉同一量级：

| 用例                                | 旧（tick 结局 等级 击杀） | 新                      |
| ----------------------------------- | ------------------------- | ----------------------- |
| solo/charmander/d0/s4242            | 16924 victory L24 k1591   | 相同                    |
| solo/bulbasaur/d1/s4242             | 16812 victory L34 k2170   | 15986 victory L34 k2038 |
| solo/squirtle/d2/s4242              | 17996 victory L28 k2337   | 18600 playing L18 k950  |
| solo/pikachu/d0/s4242               | 18600 playing L23 k1363   | 17864 victory L26 k1594 |
| solo/charmander/d1/s7               | 16065 victory L30 k2122   | 相同（摘要不同）        |
| solo/bulbasaur/d2/s7                | 16127 victory L35 k2769   | 17128 victory L37 k3020 |
| solo/squirtle/d0/s7                 | 16794 victory L26 k1568   | 18338 victory L31 k1914 |
| solo/pikachu/d1/s7                  | 18600 playing L24 k1415   | 18600 playing L28 k1944 |
| coop/charmander+squirtle/d1/s7      | 15546 victory L23+L19     | 17440 victory L24+L23   |
| mortal/squirtle/d0/s4242            | 5966 defeat L9 k215       | 相同                    |
| stations/bulbasaur+charmander/d1/s7 | 9000 playing L9+L14       | 9000 playing L9+L14     |

- 所有 `covers` 都还在。
- 变化最大的是 squirtle/d2/s4242：约 tick 2100 起升级卡选项不同，golden 驱动按序号选卡，于是走了一条更弱的构筑（泡沫 2 级拖到 tick 7200），之后滚雪球。
- 只把原生 `hypot` 换成 `sqrt` 版、其余不动，同样会让结局在胜利和未打完之间翻转（squirtle/d0/s7、coop、pikachu/d0），所以这是混沌，不是行为变化。

### 6.5 仍未覆盖

§5 里的平台范围不变：只测了这一台 Apple Silicon Mac，没有测 Firefox、iOS Safari、Intel，也没有测 Linux 的 Chrome / WebKit。理论上 sim 不再依赖平台数学库，结果应与平台无关，但没有实测。
