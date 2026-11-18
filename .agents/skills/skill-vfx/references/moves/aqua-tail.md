# 水流尾 (`aqua-tail`) — water · strike · mid

52poke: <https://wiki.52poke.com/wiki/水流尾> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Aqua_Tail_(move)>

参考身份与签名：尾扫水弧、鞭状弯曲、水滴。*[familiar — check the GIF]*。未声称本轮查看过原作动画；不下载官方图片。

## 设计

- 意图 / 签名：尾扫水弧、鞭状弯曲、水滴。
- 模拟几何与时序：长度 4.4，半角 1.2，life .22 s；追加 count 在 i×.12 s 交替前后。数值以 `src/run/sim/content/moves.ts` 与对应 archetype 为准，画面读取实例。
- 阶段：落地首帧起 360 ms 回声：扇形水面 + 两道水带 → 前 35% 粗水鞭横扫，外半段甩出泡沫 → 后段收束。
- 保留与避让：沿实际 direction 扫；不覆盖另一半身后，升级 count 才出现反向扇形。
- 分层：既有贴花 / ribbon / 精灵；水鞭在 strike 回声中绘制（sim active 仅 .22 s，live 太短看不到）。
- 升级：area 按实例 radius/length；count 增加实例和连击数；dur 延长持续；speed 只拉长短尾。小碎片尺寸与数量有固定上限。
- 预算目标：basic 稳态 ≤1%、峰值 ≤2%；mid ≤3% / ≤5%；big ≤5% / ≤8%；强峰 ≤280ms。高形体 ≤1.2u，落星窄线除外；这是设计目标，非实测覆盖率。
- 危险可读：不使用 danger 层、虚线、红环或饱和紫填充；敌方预警由已有顶层绘制；不制造贴地糖果蓝多面球。
- 受击与结束：沿用通用闪白/伤害数字；离散命中只加 ≤.3u 小碎片；结束以收缩、蚀退和短寿命处理，池自动回收。
- 验证与评分：按 `template-and-rubric.md` 的 Truth / Readability / Phases / Hierarchy / Safety / Identity / Scaling / Tech 检查；日期截图与实际验收记录仅放临时证据目录，不在本参考笔记冒充通过。
