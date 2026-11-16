# 祸不单行 (`hex`) — ghost · smite · mid

52poke: <https://wiki.52poke.com/wiki/祸不单行> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Hex_(move)>

参考身份与签名：四枚钩状咒纹、淡紫圆界、向内刺爆。*[familiar — check the GIF]*。未声称本轮查看过原作动画；不下载官方图片。

## 设计

- 意图 / 签名：咒印暗盘、低穹、四段收紧咒弧，命中时幽灵升起。
- 模拟几何与时序：delay .4 s，life .65 s，r 1.5；count 2。数值以 `src/run/sim/content/moves.ts` 与对应 archetype 为准，画面读取实例。
- 阶段：400 ms 咒印（暗盘 + 薄穹 + 收紧弧）→ 命中首帧影爆（暗盘、穹、环、月牙）+ 幽灵上浮 → 600 ms 暗残留。
- 保留与避让：咒圈是淡紫实线；不用虚线瞄准环，不把蓄力画成正在伤害的实心盘。
- 分层：新增 shadow 球体积（ORB style 2）与 spirit 精灵形；其余为既有贴花 / ribbon / 精灵。
- 升级：area 按实例 radius/length；count 增加实例和连击数；dur 延长持续；speed 只拉长短尾。小碎片尺寸与数量有固定上限。
- 预算目标：basic 稳态 ≤1%、峰值 ≤2%；mid ≤3% / ≤5%；big ≤5% / ≤8%；强峰 ≤280ms。高形体 ≤1.2u，落星窄线除外；这是设计目标，非实测覆盖率。
- 危险可读：不使用 danger 层、虚线、红环或饱和紫填充；敌方预警由已有顶层绘制；不制造贴地糖果蓝多面球。
- 受击与结束：沿用通用闪白/伤害数字；离散命中只加 ≤.3u 小碎片；结束以收缩、蚀退和短寿命处理，池自动回收。
- 验证与评分：按 `template-and-rubric.md` 的 Truth / Readability / Phases / Hierarchy / Safety / Identity / Scaling / Tech 检查；日期截图与实际验收记录仅放临时证据目录，不在本参考笔记冒充通过。
