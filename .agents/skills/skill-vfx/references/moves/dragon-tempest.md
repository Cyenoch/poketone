# 苍龙风暴 (`dragon-tempest`) — dragon · bloom · big

本项目原创融合招式，无同名原作动画。参考父招式的本地说明以及 OpenSpec 交接表。

## 设计

- 意图 / 签名：龙脉束、侧飞金鳞、龙星终爆。
- 模拟几何与时序：delay .45，active .9×dur，完整宽 .9（实例 radius .45），length≤10；真实侧弹 r.3，终爆r2.6。数值以 `src/run/sim/content/moves.ts` 与对应 archetype 为准，画面读取实例。
- 阶段：450 ms 聚光 → 双螺旋束和真实侧弹 → 280 ms 同半径金鳞终爆。
- 保留与避让：侧弹用金鳞片 + 青色流线，不用暗色三角或 shard；无草叶，实体体积复用既有 beam。
- 分层：新增 wind 漏斗体积（FUNNEL style 1）与 scale 鳞片精灵形；龙脉光束沿用既有 beam。
- 升级：area 按实例 radius/length；count 增加实例和连击数；dur 延长持续；speed 只拉长短尾。小碎片尺寸与数量有固定上限。
- 预算目标：basic 稳态 ≤1%、峰值 ≤2%；mid ≤3% / ≤5%；big ≤5% / ≤8%；强峰 ≤280ms。高形体 ≤1.2u，落星窄线除外；这是设计目标，非实测覆盖率。
- 危险可读：不使用 danger 层、虚线、红环或饱和紫填充；敌方预警由已有顶层绘制；不制造贴地糖果蓝多面球。
- 受击与结束：沿用通用闪白/伤害数字；离散命中只加 ≤.3u 小碎片；结束以收缩、蚀退和短寿命处理，池自动回收。
- 验证与评分：按 `template-and-rubric.md` 的 Truth / Readability / Phases / Hierarchy / Safety / Identity / Scaling / Tech 检查；日期截图与实际验收记录仅放临时证据目录，不在本参考笔记冒充通过。
