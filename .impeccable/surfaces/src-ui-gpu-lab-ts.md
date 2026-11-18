---
version: 1
slug: "src-ui-gpu-lab-ts"
primary_target: "src/ui/gpu/lab.ts"
related_targets: ["src/ui/gpu/lab-scene.ts","src/ui/gpu/lab-shelf.ts","src/ui/gpu/codex.ts","src/ui/gpu/codex-model.ts","src/ui/gpu/challenge-rules.ts","src/ui/gpu/segment-face.ts","src/ui/gpu/inner-screen.ts","src/run/research.ts","src/run/unlocks.ts"]
---

# 研究所 (lab scene)

Mode: Operate. Scope: the lobby's 研究所 page (`openspec/changes/redesign-lab`, tasks 3.x). Behavior lives in the `gpu-presentation` spec ("研究所场景"); tokens and controls in `DESIGN.md`. This brief keeps the direction only.

Design-stage note (2026-11-18): written by a design sub-agent with no direct user channel. The direction below comes from the change's design, `DESIGN.md` and the lobby brief, and still needs the owner's visual acceptance from real screenshots.

## Direction contract

THESIS: the player stands in a seaside research lab. The room is the menu: the binder shelf, the instrument bench and the badge case are the three places, and the lab art is the stage. Opening a place pulls its content forward as one ice window over the dimmed room. No card wall on paper, no web tabs.

OWN-WORLD: DESIGN.md's established world: navy / ice / warm yellow, raised plates with hard bases, deep segment trays, ink slanted title plate, Poké Ball marks. New in this surface:
- `public/art/lab/backdrop.webp` (Magpie Image, same painting style as the lobby backdrop; provenance in `public/art/lab/lab.provenance.json`), cover-fit, replacing the paper ground on this screen only.
- Place hotspots: on the scene, each place gets a type-free warm outline glow over its object and a slanted name plate standing on the floor in front of it (icon + name + one progress figure). Hover / focus lights the glow warm yellow; press sinks the plate.
- Owned badges are drawn into the case's real holes on the scene (the art's eight velvet holes), so progress is visible before opening anything.

STORY: lobby → lab scene (three places) → a place → (shelf) a binder → (research binder) a species → its 图鉴 page. Back retraces exactly one level: species page → lab shelf, place → scene, scene → lobby.

PLACES:
- 书架 (shelf): binders as standing spines on the left (icon, name, completion figure); the open binder fills the right. 图鉴研究 is a species grid grouped by map (map name over each group; a species appears under the first map it is met in). A cell shows the model still (ink silhouette until seen), the name (？？？ until seen) and a 10-cell research gauge; a completed species carries the ball-red done stamp. 解锁 lists every unlock: content icon + name; a met one in success colour with a check, an unmet one dim with its condition as icon + number chips (species still, badge, difficulty crest, research count). 羁绊 (heart spine) holds one bench-style instrument per partner (`bond-<starter>`, two to a row): the partner's portrait in the well, its effect name, the 3-tick scale, now → next and the price chip, bought like any node. Below bond Lv.3 the node is sealed: grey portrait, a mist price chip with a lock and `Lv.3`, the denied sound; the tip says `羁绊 Lv.3`. No sentence explains the bond on the shelf.
- 实验台 (bench): the existing nodes in their existing four groups (group names as small headings), each node an instrument plate: its lab icon in a deep well, name, a tick-scale gauge (one tick per level, filled ticks ink, the next tick warm-yellow while it can be bought), `now → next`, and the price chip unchanged. 档案库 and 背包 nodes, plus the archive toggles, sit in a drawer at the bench's end: a drawer handle row that pulls the drawer open in place.
- 徽章盒 (badges): a navy velvet case, eight slots in 2×4 (4×2 on compact). Owned: the badge medal in its colour. Not owned: a dim medal with its score threshold under it.

FIRST VIEWPORT: desktop 1280×800 shows the full room with three floor plates and the top line (back, 研究所 plate, balance, settings). Phone 844×390 (and any logical height ≤ 480): the scene collapses into a horizontal strip of three place plates (art behind, dimmed); an open place shows the same three places as a segment tray in the top line and its window fills the rest. Minimum 760×320, UI scale floor 80%, every target ≥ 44 host px.

INPUT: arrows walk the hotspots / grid; LB/RB and PageUp/PageDown step place to place (from the scene they open the next place); confirm opens; cancel and the back key step back one level. Touch taps a plate directly; long-press on a locked thing shows its tip. Details (node terms, unlock condition names, species research tasks) show only on focus or hover, never as standing copy.

FEEL: opening a place: the room dims (240ms) and the window rises 14px with a fade; spines and cells stagger in (45ms) like the existing tile entrance. The hotspot glow breathes slowly only while focused. Buying keeps the existing lift/press and balance pop; a bought tick fills with a short pop.

FORM: no explanatory sentences, no white info box, no gradient buttons, no one-side accent borders. Research task rows are icon + number only (见 / 败 / 异 glyph icons with `count/target` and the points). Status words that are labels (名称、地图名) are fine.

FINISH: real screenshots at 1280×800 and 844×390: scene, each place, the research binder with all three research states, the drawer open; keyboard+mouse, touch and synthetic gamepad walks. Layout boxes are not acceptance. Record unverified devices.
