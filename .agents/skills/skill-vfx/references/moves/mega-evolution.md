# 超级进化（`mega` 事件）— 喷火龙 → 超级喷火龙Ｘ / Ｙ

52poke: <https://wiki.52poke.com/wiki/超级进化> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Mega_Evolution>

参考身份与签名：彩虹色光丝缠绕全身、光茧包裹、光茧碎裂后新形态现身，背后浮现超级进化标志。*[familiar — check the GIF]*。不画官方标志，不下载官方图片。

## 设计（`src/run/view/vfx/mega.ts`）

- 模型在事件帧立即换成新形态；光茧遮住换模。
- 光茧阶段（`MEGA_SHATTER` = .3 s 效果时间）：金白光晕 + 泡泡壳，四股粉/金/薄荷/天蓝彩虹光丝从外向内螺旋收紧。
- 碎裂（关键帧，声音命中点）：白星闪、20 片彩虹碎片向外飞散并受重力落地、彩虹火星、地面白金环与光斑、形态自身火焰的径向喷发（Ｘ蓝、Ｙ橙）；残光 .18 s 收进新形态。总长 1.1 s。
- 彩虹部分不随蓝焰改色；只有火焰喷发在 `flame.blue` 下绘制。
- 只有本机玩家：0.3 s 顿帧（×0.05）、镜头震动、横幅「超级进化！超级喷火龙Ｘ/Ｙ」、训练家进化台词、`mega-evolve` 音效。队友只看到画面，不顿帧、不震、不出声。
- 声音：`MEGA_KEY_MS` = 300 ms 顿帧 + (300 − 15) ms 效果时间 = 585 ms；take hitMs 220/231，所以声音在约 355–365 ms 起播，上扬前奏落在光茧收紧中。

## Ｘ的蓝焰

- 机制：`gl.ts` 的模块标志 `flame.blue`；sprites/decals/volumes/ribbons 写入时记下它（sprite shape +32、decal iX.z、volume iB.a、ribbon style +8），echo 记录并在绘制时恢复。着色器对最终颜色调用 `blueFlame`：r > b 时交换红蓝并把绿色压低最多 18%——橙变天蓝、焦黑变深蓝，白、墨线、冷色不变，硬编码的红色墨也一起变。
- 范围：超级喷火龙Ｘ的火属性弹道（含闪焰冲锋）、火属性区域（誓言火场除外）、爆炸烈焰的脉冲 / 起手 / 光环，以及超级进化的火焰喷发。天气（日照）不改色。Ｙ保持橙色。
- 回归：`scripts/ultimate-fire-vfx.test.mjs` 断言Ｘ的爆炸烈焰环带蓝标记、Ｙ的不带。
