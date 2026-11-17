## ADDED Requirements

### Requirement: 未解锁伙伴不可选

大厅 SHALL 列出全部伙伴；未解锁伙伴 SHALL 以灰色球上的墨色剪影显示，可获得焦点，焦点或悬停时 SHALL 以锁签提示解锁条件。激活未解锁伙伴 MUST NOT 写入伙伴选择，也 MUST NOT 改变舞台模型或主题；‹ › 与手柄切换 SHALL 跳过未解锁伙伴。舞台 MUST NOT 渲染未解锁伙伴的模型。

#### Scenario: 激活未解锁伙伴

- **WHEN** 玩家激活一个未解锁伙伴
- **THEN** 伙伴选择、舞台模型和主题都不变

#### Scenario: 聚焦未解锁伙伴

- **WHEN** 焦点停在一个未解锁伙伴上
- **THEN** 锁签显示其解锁条件

#### Scenario: 切换伙伴

- **WHEN** 玩家用 ‹ › 或手柄切换伙伴
- **THEN** 选择只在已解锁伙伴之间循环
