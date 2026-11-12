# poketone

![海岸关卡的载入画面](public/art/loading-coast.webp)

一款免费的低多边形 3D 宝可梦幸存者类游戏。没有训练师，你直接操控宝可梦，在一波波野生宝可梦里活下来、升级、进化，一路打到紫苑塔。可以单人玩，也可以和朋友 2–4 人联机。

> **English**: poketone is a free, non-commercial, low-poly 3D Pokémon survivor-like fan game. You play as the Pokémon itself, solo or in 2–4 player co-op, in the browser or as a native macOS app. Built with TypeScript, React and Three.js on Bun. Docs are in Chinese. This is an unofficial fan project, not affiliated with Nintendo, Game Freak, Creatures or The Pokémon Company; see [License and rights](#许可与权利).

**在线游玩：** <https://poketone.bingzi.dev>（桌面浏览器或横屏手机，需要 WebGL 2）

没有商城、广告和账号，以后也不会有。

## 玩法

- **六张地图连成一次冒险**：森林 → 沙漠 → 海岸 → 冰川 → 火山 → 紫苑塔。每张地图有自己的敌群和守卫，打倒守卫打开出口，成长和构筑一路带着走。
- **招式自动释放**：你负责走位和冲刺闪避。升级时从卡牌里挑新招式、强化或道具，可以重抽、跳过和放逐。
- **进化与终极技**：伙伴随等级进化，终极技靠造成伤害和时间充能。
- **局外成长**：冒险中收集的星星沙子可以在大厅的研究所换永久强化。难度分普通、困难、噩梦，逐档解锁。
- **伙伴**：一开始可选小火龙、妙蛙种子、杰尼龟，皮卡丘随研究进度解锁。大厅里的图鉴收录角色、招式、道具、敌人和状态。
- **联机**：在大厅创建或加入房间，2–4 人合作，掉线后可以回到原来的位置。
- **存档**保存在本机，可以在设置里导出和导入。

## 操作

| 操作         | 键鼠                    | 触屏（横屏）         |
| ------------ | ----------------------- | -------------------- |
| 移动         | WASD / 方向键           | 在画面任意处按住拖动 |
| 冲刺（无敌） | Space / Shift           | 右下角按钮           |
| 终极技       | F                       | 冲刺键左侧按钮       |
| 旋转视角     | Q / E                   | 视角旋转按钮         |
| 选卡 / 重抽  | 1–4 / R，或点击         | 点击                 |
| 跳过 / 放逐  | X / Z                   | 点击                 |
| 暂停         | Esc / P（失焦自动暂停） | 右上角按钮           |
| 大地图       | M                       | 点小地图             |

也支持手柄，见 [手柄说明](docs/GAMEPAD.md)。

## 本地运行

需要 [Bun](https://bun.com) 1.4.4（版本由 `package.json` 的 `packageManager` 固定，不需要 Node.js）。

```sh
bun install
bun run dev
```

这会同时启动游戏（<http://localhost:5173>）和联机服务 Harbor（`ws://localhost:8787/multiplayer`）。两个端口是固定的，被占用时直接报错。

在 Apple 芯片的 Mac 上还可以用 `bun run native` 以原生窗口运行，详见 [Native 运行](docs/NATIVE-RUNTIME.md)。

常用命令：

| 命令                  | 用途                                    |
| --------------------- | --------------------------------------- |
| `bun run check`       | 格式检查、lint、类型检查和生产构建      |
| `bun run test:sim`    | 无头模拟测试                            |
| `bun run test:ui`     | GPU 界面测试                            |
| `bun run golden`      | 固定种子回放，确认玩法行为没有意外变化  |
| `bun run build`       | 生成 `dist/` 生产构建                   |
| `bun run assets:game` | 用 Blender 5.2 从源模型生成游戏用的 GLB |

## 项目结构

```text
src/
  app/            Web 与原生共用的应用流程（导航、进度、音频）
  ui/gpu/         大厅、窗口、HUD、图鉴，全部用 Three.js 画在同一张画布上
  run/
    sim/          纯模拟：固定 30 Hz、种子随机，可确定性回放
    view/         Three.js 画面，只读模拟状态
  network/        联机房间、动作所有权与重连
  platform/       Web / SDL 的输入、存储、窗口等平台服务
services/harbor/  联机信令与中转服务
assets/           模型、音频等源文件与制作脚本
docs/             设计与开发文档
openspec/         行为规范
```

模拟和画面严格分开：画面每帧读取模拟状态，从不反向修改，所以联机和回放都能保持一致。更多架构说明见 [CLAUDE.md](CLAUDE.md)。

## 文档

- [文档目录](docs/README.md)：所有设计文档和行为规范的入口
- [开发手册](docs/DEVELOPMENT.md)：工具链、依赖策略、模型与音频制作流程
- [产品定位](PRODUCT.md) 和 [视觉设计](DESIGN.md)
- [联机](docs/MULTIPLAYER.md)、[平衡](docs/BALANCE.md)、[手感](docs/GAME-FEEL.md)、[音频](docs/AUDIO.md)
- [部署](deploy/README.md)：CI 和自托管

## 开发方式

项目的大部分代码由 AI 编程助手（Claude Code、Codex）在人工指导下编写。模型由 Tripo 生成后用 Blender 脚本处理，音效和音乐由 ElevenLabs 生成。给 AI 助手的协作约定在 [AGENTS.md](AGENTS.md) 和 [CLAUDE.md](CLAUDE.md)，新功能和行为变化走 [OpenSpec](docs/OPENSPEC.md) 流程。

欢迎提 issue 和 PR。提交前请跑一遍 `bun run check`；改了玩法相关的代码，再跑 `bun run test:sim` 和 `bun run golden`。

## 许可与权利

- **代码**：源代码、脚本和文档按 [MIT 许可](LICENSE) 发布。
- **宝可梦相关内容不在 MIT 许可范围内。** Pokémon 及其名称、角色形象和商标归 Nintendo、Game Freak、Creatures 与 The Pokémon Company 所有。本项目是非官方、免费、非商业的同人作品，与上述公司无关，也未获其认可。仓库里的宝可梦模型、贴图和图标由 AI 工具参照原作形象生成，不作为开源素材授权，请勿商用。如果权利方有异议，请提 issue，我们会处理。
- **音频**由 ElevenLabs 生成，复用受其服务条款约束。**字体**按各自许可分发（见 `public/fonts/`）。`.agents/skills/` 里的第三方技能保留各自的许可文件。
