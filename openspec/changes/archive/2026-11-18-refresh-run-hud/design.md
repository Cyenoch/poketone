## 生命组

奖章 64px（紧凑 52）：经验环 + 属性渐变盘 + `/art/portraits/<form>.webp`；等级移到左下肩胶囊。名牌为新的 `RunHudSurface("plate")`：深海底、顶部偏 theme-deep、1.5px 冰蓝内框，右端按 0.3 斜率后倾；左端被奖章压住（`marginLeft = -medal/2`），所以保持方角。HP 铭牌移进名牌第二行，高 22（紧凑 18），其余 HP 行为（曲线、掉血段、回血、护盾、受击抖动与闪框）不变。属性标签在形态变化（进化）时重建并释放旧标签。

## 队友

快照每 100ms 带 `team`：除本机外、未离开（`departed`）的玩家，按槽位。HUD 预建三行，按快照显示/隐藏；颜色取 `playerColors[slot]`，与场上 P 标签和边缘指示一致。倒地：头像 40%、条为 0、行底酒红。不接收指针。

## 底排

`placeBar()` 按指针类型重排同一组节点：触屏 `slots = [moveRow, itemRow]`、`actions = [turnRow, thumbs]`（原有居中与避让逻辑只在触屏运行）；键鼠 `slots = [itemRow, skillRow[moveRow, thumbs]]` 贴左，actions 只剩隐藏的旋转对。招式名称签只在键鼠显示，空位隐藏。选卡时整组淡出（键鼠下终极技与冲刺随之淡出，世界此时冻结）。

## 不做

不加状态图标位、不改首领条与小地图、不改触屏布局。
