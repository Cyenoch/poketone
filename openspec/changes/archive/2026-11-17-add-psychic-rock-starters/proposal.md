# Proposal

## Why

用户要求再加两条可操控进化线。现有七条线缺少超能力与岩石/地面属性；凯西线（远程控场、睡眠后爆发、多段冲刺）和小拳石线（低速重装、落石与地震）与已有玩法区别最大。同时用户要求大厅（首页）继续打磨并重新生成背景。

## What Changes

- 追加凯西→勇基拉→胡地、小拳石→隆隆石→隆隆岩两条线：六个形态、各四招招牌技能、两招进化技能、特性、三档终极技与融合配方。全部复用现有原型、状态和融合设施，不新增原型。
- Tripo 模型、ElevenLabs 施放/命中音效、立绘、招式/终极技图标、属性卡面与徽记、招式与终极技 VFX 接入。
- 大厅名册容纳九枚徽章；大厅视觉打磨并重新生成背景图。
- 补充平衡模型对比、确定性回放与针对性测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `combat-builds`: 增加超能力与岩石地面两条可控进化线。

## Impact

影响 `src/run/sim/content`、`src/run/view`（模型映射、VFX）、`src/audio`、`src/ui/gpu`（大厅）、`public/`资产与 golden。不修改敌人 ID，不新增存档迁移或依赖。
