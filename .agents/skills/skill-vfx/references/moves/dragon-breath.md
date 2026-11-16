# 龙息 (`dragon-breath`) — dragon · bolt · basic

52poke: <https://wiki.52poke.com/wiki/龙息> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Dragon_Breath_(move)>

参考身份与签名：细长龙息、贯穿、金色鳞光。*[familiar — check the GIF]*。未声称本轮查看过原作动画；不下载官方图片。

## 设计

- 意图 / 签名：细长龙息、贯穿、金色鳞光。
- 模拟几何与时序：r .24，speed 18，life 1.2 s，pierce 2。数值以 `src/run/sim/content/moves.ts` 与对应 archetype 为准，画面读取实例。
- 阶段：120 ms 口闪 → 不超过 1.25 u 尾束 → 240 ms 金鳞散片 → 短消隐。
- 保留与避让：靛蓝/青绿弹头，金鳞片小于 .1 u；不用糖果蓝大颗粒。
- 分层：新增 wind 漏斗体积（FUNNEL style 1）与 scale 鳞片精灵形；龙脉光束沿用既有 beam。
- 升级：area 按实例 radius/length；count 增加实例和连击数；dur 延长持续；speed 只拉长短尾。小碎片尺寸与数量有固定上限。
- 预算目标：basic 稳态 ≤1%、峰值 ≤2%；mid ≤3% / ≤5%；big ≤5% / ≤8%；强峰 ≤280ms。高形体 ≤1.2u，落星窄线除外；这是设计目标，非实测覆盖率。
- 危险可读：不使用 danger 层、虚线、红环或饱和紫填充；敌方预警由已有顶层绘制；不制造贴地糖果蓝多面球。
- 受击与结束：沿用通用闪白/伤害数字；离散命中只加 ≤.3u 小碎片；结束以收缩、蚀退和短寿命处理，池自动回收。
- 验证与评分：按 `template-and-rubric.md` 的 Truth / Readability / Phases / Hierarchy / Safety / Identity / Scaling / Tech 检查；日期截图与实际验收记录仅放临时证据目录，不在本参考笔记冒充通过。
