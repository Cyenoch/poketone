# 龙之俯冲 (`dragon-rush`) — dragon · wave · mid

52poke: <https://wiki.52poke.com/wiki/龙之俯冲> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Dragon_Rush_(move)>

参考身份与签名：龙首冲击波、双角金鳞、宽带前缘。*[familiar — check the GIF]*。未声称本轮查看过原作动画；不下载官方图片。

## 设计

- 意图 / 签名：羽化宽带（无硬边）、拱形双层龙冠（青光 + 金实线）、体积龙首、流鳞。
- 模拟几何与时序：横半宽 1.3，纵半深 .5，speed 10，life 1 s。数值以 `src/run/sim/content/moves.ts` 与对应 archetype 为准，画面读取实例。
- 阶段：口闪 → 羽化宽带、龙冠与龙首随 sim 矩形推进，鳞片向后流 → 末尾 120 ms 收缩。
- 保留与避让：玩家不突进；宽带用 glow 贴花羽化，不画暗色三角箭头；龙首只占中心。
- 分层：新增 wind 漏斗体积（FUNNEL style 1）与 scale 鳞片精灵形；龙脉光束沿用既有 beam。
- 升级：area 按实例 radius/length；count 增加实例和连击数；dur 延长持续；speed 只拉长短尾。小碎片尺寸与数量有固定上限。
- 预算目标：basic 稳态 ≤1%、峰值 ≤2%；mid ≤3% / ≤5%；big ≤5% / ≤8%；强峰 ≤280ms。高形体 ≤1.2u，落星窄线除外；这是设计目标，非实测覆盖率。
- 危险可读：不使用 danger 层、虚线、红环或饱和紫填充；敌方预警由已有顶层绘制；不制造贴地糖果蓝多面球。
- 受击与结束：沿用通用闪白/伤害数字；离散命中只加 ≤.3u 小碎片；结束以收缩、蚀退和短寿命处理，池自动回收。
- 验证与评分：按 `template-and-rubric.md` 的 Truth / Readability / Phases / Hierarchy / Safety / Identity / Scaling / Tech 检查；日期截图与实际验收记录仅放临时证据目录，不在本参考笔记冒充通过。
