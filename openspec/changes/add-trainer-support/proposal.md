# Proposal

## Why

`add-trainer-presentation` 让玩家选择训练师，但训练师只决定立绘、对白和演出（`src/trainers.ts`：“Cosmetic identity only”）。用户 2026-11-17 提出：训练师给局内一些加成，并有一个提供辅助的主动技能；同时希望有磨合度或羁绊一类的设计。

正作里训练师不直接攻击，而是在对战中使用道具：伤药、万灵药、攻击强化、要害攻击等。本 change 按这个设定做：宝可梦负责战斗，训练师用道具支援。

## What Changes

- **主动技能「训练师道具」**：每位训练师一种道具，冷却较长（约 90 秒），作用于自己和附近队友，不造成伤害。新增一个操作：键盘 G、手柄 RB、触屏一个小按钮。
  - 澄汐：速度强化，短时间提高移动与攻击速度。
  - 朔野：好伤药，回复自己和附近队友一部分生命。
  - 夜苇：要害攻击，短时间内攻击必定击中要害。
  - 夏晴：万灵药，解除自己和附近队友的异常状态，并短时间免疫。
- **被动加成**：小幅、偏向角色身份，不做纯数值碾压，避免出现“唯一正确的训练师”：
  - 澄汐（海岸领航员）：交互点、出口和奖励标记在小地图上显示得更早、更远。
  - 朔野（野外维修师）：在催眠貘处遗忘招式或道具时，返还的宝可梦币 +50%。
  - 夜苇（夜行生态记录员）：异色出现率略高，图鉴研究进度加快。
  - 夏晴（海岸饲育员）：本局收服的同伴伤害与攻击频率略高。
- **羁绊**：不另做“训练师 × 宝可梦”的磨合度。羁绊沿用 `add-partner-bond`，每只伙伴一份；训练师对白按当前伙伴的羁绊等级变化，作为两者之间的联系。理由见 design.md。
- 训练师进入开局配置和模拟（`RunConfig.players[].trainer`），世界快照版本加一；种子码成绩记录训练师。

## Capabilities

### Modified Capabilities

- `combat-builds`：新增「训练师道具」「训练师被动」。
- `gpu-presentation`：新增「训练师道具按钮与冷却显示」。
- `multiplayer`：新增「训练师道具的联机结算」。

## Impact

- 依赖：`add-trainer-presentation`（训练师选择与切入）、`add-partner-bond`（羁绊等级）、`add-field-events`（交互点与异色，用于两项被动）、`redesign-lab`（图鉴研究）。
- 代码：`src/trainers.ts` 拆出模拟可读的 `sim/content/trainers.ts`（道具、被动数据），`RunConfig`、`Player.trainer`、`state/commands.ts` 新增 `assist` 指令，`sim/trainers.ts` 结算，`stats.ts`（短时强化）、`stations.ts`（遗忘返还）、`partners.ts`（同伴加成），`platform/input.ts`（G / RB），`ui/gpu/run-hud.ts`（按钮与冷却），`run/trainer-cues.ts`（切入与按羁绊的对白）。
- 资产：四个道具使用音效（ElevenLabs）；道具投掷与生效特效走 `skill-vfx`。
- 平衡：`balance:model` 加入道具与被动；golden 有意重录（训练师进入配置）。
