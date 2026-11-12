---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/app/session.ts","src/ui/gpu/app-host.ts","src/ui/gpu/lobby.ts","src/ui/gpu/lobby-scene.ts","src/ui/gpu/lab.ts","src/ui/gpu/codex.ts","src/ui/gpu/run-hud.ts","src/ui/gpu/run-overlays.ts","src/ui/gpu/settings-dialog.ts","src/ui/gpu/save-dialog.ts","src/ui/gpu/game-button.ts","src/ui/scene-transition.ts","src/platform/web/ui-surface.ts","src/platform/native/ui-surface.ts","src/styles.css"]
---

# Game UI

Mode: Operate. Scope: 两端共享的大厅、研究所、图鉴、冒险 HUD（选卡、暂停、站点、结算）、设置、存档、通知与场景过场。组件工坊、独立模型预览与旧伙伴选择页已删除，不恢复。Web 支持桌面及手机横屏，SDL 使用同一页面；竖屏仅提示旋转。当前实现与验收入口见 `docs/README.md`。

技能分工：Impeccable 负责视觉层级、排版、配色、布局与动效；`game-ui-ux` 负责菜单/HUD、焦点、缩放和安全区；动作反馈再使用 `game-feel`。保留已确认视觉，不把游戏改成网站，不引入未确定玩法。

## Direction contract

THESIS: 海岸场景中的启程大厅；伙伴是舞台主体，决定位于右侧，拒绝网页导航、介绍段落、卡片墙与顶层页面滚动。

OWN-WORLD: 当前大厅采用海岸背景、真实低模伙伴、右侧决定列和暖黄启程板，见 `DESIGN.md`。共享海蓝/冰蓝/暖黄配色、实体底板、精灵球纹与属性主题。保留透明小火龙品牌图与字标，不恢复旧三角山形标记、罗盘或旧斜切主菜单。功能窗口沿用深蓝窗框、冰蓝正文；不能用通用窗口外框包住整个大厅。

STORY: 载入后直接进大厅，选择已解锁伙伴、地图与难度后出发；研究所、图鉴、联机与设置由大厅进入。图鉴承接模型浏览。更详细的数值、能力和进化说明留在图鉴，首页不重复。

ADVENTURE: 全屏3D世界，HUD占四角与底边，保留已有生命/经验/技能/道具/交互/多人身份设计。候选数量和栏位读当前游戏数据，不把早期“三卡/四槽”样例当硬编码契约。对局窗口按当前模拟与输入规则运行，三输入共享焦点和操作归属。结算保存失败窗口仅提供重试，无退出；沿用 DESIGN 的错误窗口，不另做一套视觉。

FIRST VIEWPORT: 桌面与手机横屏共用伙伴舞台和右下决定列，地图位于出发组托盘，启程板显示地图名。短横屏在决定列内部滚动，必要操作和法律声明可达且可读，避开安全区。大厅专属规则见 `src-ui-gpu-lobby-ts.md`，通用规则见 DESIGN。

FORM: 保真迁移，不能因库未内置而删减样式或时序。云幕遮盖→提交→揭幕；退场树保留绘制但不抢新窗口输入。用户已取消 reduced-motion：不监听、不保留控件或分支。设置仅声音、开发者模式、UI 缩放三项；无手柄震动设置/反馈，无旧字段或旧存档迁移。

FINISH: 正式页面截图和动态对照、实际操作与有范围的QA证据；布局盒或隔离探针不代表文字墨迹居中。记录已发现回归与未验设备，不把历史批次确认外推为当前全量通过。发布栅格资产保留 provenance。
