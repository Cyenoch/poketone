# 地球上投 (`seismic-toss`) — fighting · nova · mid

52poke: <https://wiki.52poke.com/wiki/地球上投> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Seismic_Toss_(move)>

参考身份与签名：踏地上掀、地裂、碎石向上。*[familiar — check the GIF]*。未声称本轮查看过原作动画；不下载官方图片。

## 设计

- 意图 / 签名：踏地上掀、地裂、碎石向上。
- 模拟几何与时序：r 4.2，life .3 s，单次命中，无 delay。数值以 `src/run/sim/content/moves.ts` 与对应 archetype 为准，画面读取实例。
- 阶段：首帧全圆 + 220 ms 琥珀色短暂填充（半径 4.2 时只有边环会读成空圈）→ 280 ms 八向速度线 → 岩片 270 ms → 暗裂 700 ms。
- 保留与避让：不把受击敌人抛高：模拟不改敌人高度。
- 分层：既有贴花 / ribbon / 精灵；龙光束另用既有 beam volume。没有新材质、纹理或绘制批次。
- 升级：area 按实例 radius/length；count 增加实例和连击数；dur 延长持续；speed 只拉长短尾。小碎片尺寸与数量有固定上限。
- 预算目标：basic 稳态 ≤1%、峰值 ≤2%；mid ≤3% / ≤5%；big ≤5% / ≤8%；强峰 ≤280ms。高形体 ≤1.2u，落星窄线除外；这是设计目标，非实测覆盖率。
- 危险可读：不使用 danger 层、虚线、红环或饱和紫填充；敌方预警由已有顶层绘制；不制造贴地糖果蓝多面球。
- 受击与结束：沿用通用闪白/伤害数字；离散命中只加 ≤.3u 小碎片；结束以收缩、蚀退和短寿命处理，池自动回收。
- 验证与评分：按 `template-and-rubric.md` 的 Truth / Readability / Phases / Hierarchy / Safety / Identity / Scaling / Tech 检查；日期截图与实际验收记录仅放临时证据目录，不在本参考笔记冒充通过。
