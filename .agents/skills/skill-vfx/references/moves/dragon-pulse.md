# 龙之波动 (`dragon-pulse`) — dragon · beam · big

52poke: <https://wiki.52poke.com/wiki/龙之波动> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Dragon_Pulse_(move)>

参考身份与签名：长贯穿龙脉、青黛双螺旋、金鳞光。*[familiar — check the GIF]*。未声称本轮查看过原作动画；不下载官方图片。

## 设计

- 意图 / 签名：长贯穿龙脉、青黛双螺旋、金鳞光。
- 模拟几何与时序：delay .3 s，life 1.05 s，完整宽度 .65（实例 radius .325），length ≤ 17 被地形裁切，每 .15 s tick。数值以 `src/run/sim/content/moves.ts` 与对应 archetype 为准，画面读取实例。
- 阶段：300 ms 口部聚光与细引导线 → 活体 beam 按 rise 倾斜 → 最后 140 ms 收宽。
- 保留与避让：实体只有一个既有 beam volume；双螺旋完全在其宽度内，禁止绿叶与火柱。
- 分层：既有贴花 / ribbon / 精灵；龙光束另用既有 beam volume。没有新材质、纹理或绘制批次。
- 升级：area 按实例 radius/length；count 增加实例和连击数；dur 延长持续；speed 只拉长短尾。小碎片尺寸与数量有固定上限。
- 预算目标：basic 稳态 ≤1%、峰值 ≤2%；mid ≤3% / ≤5%；big ≤5% / ≤8%；强峰 ≤280ms。高形体 ≤1.2u，落星窄线除外；这是设计目标，非实测覆盖率。
- 危险可读：不使用 danger 层、虚线、红环或饱和紫填充；敌方预警由已有顶层绘制；不制造贴地糖果蓝多面球。
- 受击与结束：沿用通用闪白/伤害数字；离散命中只加 ≤.3u 小碎片；结束以收缩、蚀退和短寿命处理，池自动回收。
- 验证与评分：按 `template-and-rubric.md` 的 Truth / Readability / Phases / Hierarchy / Safety / Identity / Scaling / Tech 检查；日期截图与实际验收记录仅放临时证据目录，不在本参考笔记冒充通过。
