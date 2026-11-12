# encyclopedia Specification

## Purpose

为玩家提供与当前玩法内容一致的图鉴，覆盖角色形态、招式、道具、站点、敌人和状态说明，并支持关联跳转与模型浏览，避免手写内容副本随数值修改漂移。

## Requirements

### Requirement: 图鉴与内容一致

图鉴 SHALL 提供宝可梦、招式、道具、站点、敌人、状态六类内容；展示名称、数值和说明 SHALL 来自当前领域内容及其描述规则。

#### Scenario: 已登记道具数值改变

- **WHEN** 当前道具数据改变而玩家打开对应图鉴条目
- **THEN** 展示当前数据对应的说明，不继续使用独立手抄的旧数值

### Requirement: 关联浏览可返回

图鉴 SHALL 支持有关联的条目间跳转与返回；有模型的条目 SHALL 可查看和旋转其模型，浏览不得改变对局或局外进度。

#### Scenario: 从角色跳到招牌招式

- **WHEN** 玩家沿角色条目进入关联招式后执行返回
- **THEN** 回到来源条目，不丢失浏览路径，也不修改角色构筑

## References

- [src/run/codex.ts](../../../src/run/codex.ts)
- [src/ui/gpu/codex.ts](../../../src/ui/gpu/codex.ts)
- [docs/state-machines/application-ui.md](../../../docs/state-machines/application-ui.md)

规范定义行为契约；文档导航见 [文档入口](../../../docs/README.md)。规范同步和格式校验不表示所有场景已经通过验收。
