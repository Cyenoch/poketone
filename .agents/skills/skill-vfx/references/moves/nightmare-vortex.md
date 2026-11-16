# 噩梦漩涡 (`nightmare-vortex`) — ghost · firestorm · big

本项目原创融合招式，无同名原作动画。参考父招式的本地说明以及 OpenSpec 交接表。

## 设计

- 意图 / 签名：雾穹底座、幽灵环绕、品红喷流、旋臂咒爆处升幽灵。
- 模拟几何与时序：delay .3，life 2.3，base r1.1 动态增长；FIRESTORM jetWidth/spiralReach/spiralRadius 与最终 burst 实例。数值以 `src/run/sim/content/moves.ts` 与对应 archetype 为准，画面读取实例。
- 阶段：喷流从 t0 伤害开始即画 → .3 s 涡成形 → .9 s 后按 .2 s 离散三旋臂 → 260 ms 终爆。
- 保留与避让：必须显露三处实际伤害圆；禁止火焰橙色与连续转动假命中位置。
- 分层：新增 shadow 球体积（ORB style 2）与 spirit 精灵形；其余为既有贴花 / ribbon / 精灵。
- 升级：area 按实例 radius/length；count 增加实例和连击数；dur 延长持续；speed 只拉长短尾。小碎片尺寸与数量有固定上限。
- 预算目标：basic 稳态 ≤1%、峰值 ≤2%；mid ≤3% / ≤5%；big ≤5% / ≤8%；强峰 ≤280ms。高形体 ≤1.2u，落星窄线除外；这是设计目标，非实测覆盖率。
- 危险可读：不使用 danger 层、虚线、红环或饱和紫填充；敌方预警由已有顶层绘制；不制造贴地糖果蓝多面球。
- 受击与结束：沿用通用闪白/伤害数字；离散命中只加 ≤.3u 小碎片；结束以收缩、蚀退和短寿命处理，池自动回收。
- 验证与评分：按 `template-and-rubric.md` 的 Truth / Readability / Phases / Hierarchy / Safety / Identity / Scaling / Tech 检查；日期截图与实际验收记录仅放临时证据目录，不在本参考笔记冒充通过。
