# 闪焰冲锋 (`flare-blitz`) — fire · wave · mid

52poke: <https://wiki.52poke.com/wiki/闪焰冲锋> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Flare_Blitz_(move)>

参考身份与签名：全身裹火的冲撞、向前的火焰楔形前缘、冲过后留下焦痕。*[familiar — check the GIF]*。未声称本轮查看过原作动画；不下载官方图片。仅超级喷火龙Ｘ学会，因此实际画面总是蓝焰（见 `mega-evolution.md`）。

## 设计

- 意图 / 签名：沿宽带推进的燃烧人字形火冠（尖端在前沿中心，两翼拖到后角）、尖端一颗火球、后缘火舌与火星。
- 模拟几何与时序：横半宽 = area 1.3，纵半深 `WAVE.depth` .5，speed 10，life 1 s（推进 10 m），pierce 99，10% 灼伤。数值以 `src/run/sim/content/moves.ts` 与 `WAVE` 为准，画面读取实例。
- 阶段：起手星闪 + 光晕 + 脚下环 → 带状日光贴花（strip style 0）填满判定矩形、人字火冠与火球随 sim 推进 → 头 80 ms 升起、末 150 ms 收缩 → 结束烟、火星与焦痕。
- 保留与避让：玩家本体不突进（与 sim 一致）；火冠 ≤1.3 m，尖端最高；不画暗色三角箭头或红色危险环。
- 分层：复用 fire 调色与既有 sprite/ribbon/orb/strip，未新增 shader 形。
- 升级：area 按实例 radius；count 增加实例；dur 延长；speed 只改变推进速度。粒子速率有固定上限（每帧 perFrame）。
- 声音：`flare-blitz` 在起手帧（cast，windup 0）以 keyMs 0 播放，直接跳到各 take 的命中点。
- 预算目标：mid 稳态 ≤3%、峰值 ≤5%；设计目标，非实测覆盖率。
- 验证与评分：按 `template-and-rubric.md` 检查；截图只放临时证据目录。
