# Proposal

## Why

大版本「野外与路线」（用户 2026-11-17 确认）。异色是宝可梦玩家最熟悉的收藏目标。`add-field-events` 已经让异色个体出现在野外，但击败后只有星星沙子和图鉴计数，没有能长期展示的成果。本 change 把异色做成伙伴的外观收藏：只换配色，不做新模型。

## What Changes

- 每个伙伴系列有一套异色外观，覆盖该系列所有形态，按官方异色配色调色。
- 获得方式（写入进度 v5 的 `looks.owned`）：
  - 击败该系列任一形态的异色个体（目前适用于小拳石、鬼斯、腕力、迷你龙、凯西几条系列，它们的形态会作为敌人出现）。
  - 达到羁绊里程碑（`add-partner-bond`），所有系列都能用这种方式获得。
- 大厅里选中已拥有异色外观的伙伴时，可以切换异色外观（`looks.worn`），整局所有形态都用异色。
- 合作中，队友在房间、局内和地图标记上都能看到这名玩家的异色外观。
- 技术方案：模型用着色器调色板替换，和 `add-field-events` 的异色敌人共用每个形态的调色参数；头像用同一组参数离线生成异色版本。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `progress-save`：新增「异色外观获得」。
- `gpu-presentation`：新增「异色外观切换」。
- `multiplayer`：新增「队友的异色外观」。
- `asset-pipeline`：新增「异色调色资产」。

## Impact

- 依赖：`extend-progress-v5`（`looks`、`dex`）；`add-field-events`（异色个体、调色参数登记）。羁绊 Lv5 的授予由后面的 `add-partner-bond` 直接写入 `looks.owned`，本 change 不依赖它，只负责读取与显示。
- 代码：`run/view/assets.ts`（每形态调色参数）、`run/view/materials.ts`（`shinyLook`），`createRunView.ts` 与 `ui/gpu/lobby-scene.ts` 的模型材质，`RunConfig.players[].shiny`，大厅、房间座位、HUD 与屏外标记头像。
- 资产：`public/art/portraits/<form>-shiny.webp`，由脚本离线生成并记录来源。
