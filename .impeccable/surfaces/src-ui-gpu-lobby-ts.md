---
version: 1
slug: "src-ui-gpu-lobby-ts"
primary_target: "src/ui/gpu/lobby.ts"
related_targets: ["src/ui/gpu/starter-stage-art.ts","src/ui/gpu/codex-model.ts","src/ui/gpu/game-button.ts","src/ui/gpu/segment-face.ts","src/ui/gpu/tag.ts","src/ui/gpu/icons.ts","src/app/session.ts","src/ui/gpu/lobby-scene.ts"]
---

# Lobby (大厅)

Mode: Operate. Scope: the root screen after loading, where the player picks a partner and difficulty, views the fixed six-map route and presses 出发. Behavior is in `openspec/specs/gpu-presentation/spec.md`; visual parameters are in `DESIGN.md`. This brief keeps the direction only.

## Direction contract

THESIS: the partner stands on a stone podium on a Pokémon-world route above the sea, and the scene is the stage. All decisions sit in one column at the bottom right and read top to bottom: name → roster → backpack → difficulty + 出发. 出发 is the largest control and the only warm-yellow one on screen.

OWN-WORLD: DESIGN.md's established world: the coastal backdrop, navy / ice / warm-yellow, raised plates with hard bases, deep trays, Poké Ball marks and patterns, and type theme tokens. The lobby adds no new palette or type voice. New in this surface:
- a slanted (−10°) type ribbon for the name;
- the slanted 启程板 for 出发;
- the lead tag size (28);
- the Magpie podium raster;
- a Pokémon-world backdrop (`public/art/lobby/backdrop.webp`, nano banana 2.1 from a hand-made layout guide). Its landmarks (Pokémon Center, Mart, Lapras) sit in the band left visible between the partner and the column at both sizes;
- 研究所 / 图鉴 as two stylised cards with Magpie object art breaking the top edge. They sit under Settings above the column, or in the top bar row when there is no height (phone).

STORY: picking a partner rebuilds the scene's type light: the podium ring, the aura, the rising crests, the ribbon and the crest on 出发. The partner is the live low-poly GLB, never an upscaled portrait.

FIRST VIEWPORT: desktop 1280×800 and phone 844×390 use one structure. The hero zone is on the left and the decision column on the right, anchored bottom-right. The legal notice is centered along the bottom on wide screens and right-aligned below the decision column on compact screens. Nothing interactive goes in the phone's bottom-left. A short screen (logical height ≤ 600) uses the lobby's compact sizes.

FORM: no framed card around the stage, no white info box, no gradient buttons, no one-side accent borders, no explanatory copy. Roster medals stand loose on the scene. Only the 出发 group has a tray. Tooltips for column controls open to the column's left.

## Historical design comps

Historical design-stage note (2026-11-06): the brief was run by a design sub-agent with no direct user channel, so I picked the direction from the brief, PRODUCT.md and DESIGN.md. It still needs the owner's look.
- Exploration: one comp put all decisions in one column (A), another was character-select style with 出发 bottom-right (B). Taken forward: B's open stage and type ribbon, combined with A's single decision column, so that phone controls stay under the right thumb.
- Measured comps (historical design studies, not kept in the repository) covered desktop default/locked/electric, phone grass/locked-difficulty, launch states and zoom levels.
- Do not literalize: the comp's HTML/CSS stand-ins (CSS skew, CSS hatch, SVG icons) show intent only. Build with uikit, shader surfaces and the shared `hover-pattern.ts`. The hero in the comps is a still render of the GLB.

FINISH: 当前落地范围见 `docs/README.md`。旧待接线清单不代表当前缺口；逐批截图/用户确认不能外推为所有设备已验收。
