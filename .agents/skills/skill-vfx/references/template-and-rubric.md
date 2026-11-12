# Design template, review checklist, rubric, audit

## 1. Per-effect design template

Copy into the PR / task notes (not into code). Keep each line short.

```md
### <Move> (<move-id>) — <archetype>, tier basic | mid | big
Intent: <one sentence: what the player should feel/know>
Signature traits (from references/moves/<id>.md): <2–4 traits kept>
Sim truth: hitbox <shape, radius/length/angle>, delay <s>, life <s>, ticks <s>, follow <y/n>,
  burst <radius, 0.3 s>, count <n>, from attacks.ts/content/moves.ts
Timeline (ms):  准备 0–300 | 施放 300–360 | 持续 360–1200 | 命中 … | 残留 … | 消散 …
Shapes: primary <ring/fan/lane/ball…> = hitbox; secondary <…>
Colours: dominant <tokens>, accent <tokens>; checked vs danger red/purple and candy cyan
Layers: ground <decal> · body <volume/sprite> · core <sprite> · sparks <spec> · smoke <spec>
Upgrade scaling: area <…> · count <…> · dur <…> · speed <…>
Coverage budget: steady <%>, peak <%> for <ms>, height <m>; measured <%> at 1× and 2× area
Enemy readability: boss dash lane / spore / slash visible through it? <y/n + screenshot>
Perf: new draw calls 0; peak particles <n> per instance × <max instances>; allocations none
Hit reaction: relies on generic flash/tint/numbers; move spark <size, life> on <discrete hits>
Residue: <decal, life, colour>; cleanup automatic
```

## 2. Review checklist

**Gameplay truth**
- [ ] Primary shape matches the hitbox (size within ~10 %, same shape, same direction/pitch).
- [ ] Damaging moment = visual impact peak; charge ends exactly at the first damaging frame.
- [ ] Follow areas stay attached to the player; beams end where the terrain clips them.

**Phases**
- [ ] 准备 present when the sim has a delay, converging, reads as the player's.
- [ ] 施放 beat at the mouth/chest (≤ 120 ms).
- [ ] 持续 has a steady loop with the rim/edge as focal element.
- [ ] 命中 peaks in the first quarter of its life, then expo-out.
- [ ] 受击 relies on existing flash/tint/numbers; no duplicated per-target flash on area ticks.
- [ ] 残留 darker, desaturated, rimless, ≤ 1.5 s (frequent) / ≤ 3.5 s (big).
- [ ] 消散 shrinks/erodes in 100–250 ms; no long linear fade.

**Readability**
- [ ] Greyscale screenshot: silhouette and hitbox identifiable; one focal point.
- [ ] Hot white core only at impact; body mid-value; no blown-out white on grass.
- [ ] Direction readable in a still frame (stretched tail, bright leading edge).

**Colour and safety**
- [ ] Element palette dominant; complementary accent desaturated and small.
- [ ] No red/deep-red/saturated-purple fills, rings, chevrons or dashed rims.
- [ ] No candy-like cyan faceted blobs near the ground.
- [ ] Boss dash lane, spore and slash hazards readable when overlapping the effect.

**Budget and scaling**
- [ ] Coverage within the tier budget at 1× and +100 % area; spill ≤ 15 % of radius.
- [ ] Height ≤ tier limit; tall bodies thin or brief.
- [ ] count/dur/speed upgrades change count/length/stretch, not overall size.
- [ ] 150+ enemies: still readable; pool load acceptable; no white-out.

**Tech**
- [ ] No new draw calls or materials without a written reason; no per-frame allocations.
- [ ] New GPU resources disposed in `Vfx.dispose`.
- [ ] `bun run typecheck`, `bun run lint`, `bunx oxfmt --check <files>` pass.

## 3. Critique rubric

Score each axis 0 / 1 / 2. **Ship at ≥ 12 / 16 with no 0 on Truth or Safety.**

| Axis | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Truth (shape & timing = sim) | visual misleads about area or moment | roughly right, edges off | exact; reads as the hitbox |
| Readability (silhouette, value) | mush; no focal point | readable alone, lost in a crowd | instantly readable in a crowd |
| Phases (prep, cast, impact, residue, end) | pops in/out, no impact | most phases, weak impact or end | complete, peak early, clean end |
| Hierarchy & budget | louder/bigger than its tier | slightly over budget or too long | on budget; loud only at impact |
| Safety (enemy danger, candy) | hides or mimics telegraphs/candy | borderline colour or overlap | never competes |
| Identity (element, signature) | generic or wrong element | element right, signature weak | recognisable move at a glance |
| Scaling (upgrades) | breaks or balloons | only scales size | each stat reads proportionally |
| Tech (perf, cleanup) | new cost, leaks or strobes | minor waste | free, clean, accessible |

## 4. Audit procedure (whole game)

1. List all moves and enemy telegraphs with tier, archetype, sim numbers.
2. For each, capture in the real game: single cast close-up (several frames covering each
   phase), +100 % area, in a crowd (`time` ≥ 470), overlapping the boss dash lane. Note
   anything you could not capture.
3. Score with the rubric; write an audit table: move | score | worst axes | top issue.
4. Fix the lowest scores and the most oversized first; re-shoot the same views; re-score.
5. Measure draw calls and frame time in the same crowded boss scene before and after.
6. Report: what you saw, what you measured (with variance), and what you didn't verify.
