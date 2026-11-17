## ADDED Requirements

### Requirement: 对战塔入口与楼层显示

大厅 SHALL 提供对战塔模式入口，未通关任何难度时显示为锁定且不能以对战塔出发；选中对战塔时 SHALL 显示所选伙伴的最高层。对局中 HUD SHALL 在路线进度位置显示当前层数。

#### Scenario: 未解锁

- **WHEN** 玩家从未通关任何难度时查看对战塔入口
- **THEN** 入口显示锁定状态，确认不会出发

#### Scenario: 楼层显示

- **WHEN** 队伍进入第 15 层
- **THEN** HUD 路线进度位置显示第 15 层
