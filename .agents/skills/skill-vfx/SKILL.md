---
name: skill-vfx
description: >
  Design, build, review and fix poketone's skill (move) effects and enemy telegraphs: phase
  structure (prepare → cast → travel → impact → hit reaction → residue → end), readability,
  element colour language, screen-coverage budgets, upgrade scaling, stylised low-poly cartoon
  shading, and how to implement them with the instanced sprites / decals / ribbons / volumes in
  `src/run/view/vfx*`. Use when adding or changing any move effect, hit/impact/death effect,
  enemy telegraph or hazard look; when an effect feels too big, weak, noisy, muddy, unreadable or
  "off-element"; and when auditing or grading effects.
---

# Skill VFX (poketone)

A move effect is **gameplay information first, spectacle second**. Every effect must tell the
player, at a glance and in a crowd of 200+ enemies: *what fired, where it hits, when it hits,
that it hit, and that it is over* — while never covering an enemy telegraph. Riot's VFX style
guide orders the goals the same way: clarity for gameplay, minimal clutter, theme, delight.

This skill covers the craft and this repo's pipeline. It does **not** cover screen shake,
hit-stop tiers or audio (use `game-feel`, `audio-design`, `docs/GAME-FEEL.md`), or general
shader maths (`shader-programming`).

## Non-negotiable rules

1. **The visual is the hitbox.** The primary shape (ring, fan, lane, ball) matches the sim
   shape and size (`Area.radius / length / angle`, `Projectile.radius`) and its timing
   (`delay`, first damaging frame, `life`). Spill outside the hitbox is secondary, faint and
   short. Never draw a bigger circle than the damage.
2. **Enemy danger wins.** Red / deep-red / saturated purple, dashed rims and chevrons belong to
   enemies (`fx.danger`, drawn last). Player effects never use them for fills or rings, never
   sit above them, and must leave a telegraph readable when overlapping it. Cyan-blue faceted
   blobs near the ground are XP candy (`#59c8ff`) — player effects don't make them.
3. **Size and loudness follow importance.** Cooldown < 1.5 s moves are quiet and small; big
   moves may be loud only for their impact beat (≤ 0.3 s). See the screen budget in
   `references/repo-pipeline.md` (≈ 55 px per metre at 720p; visible ground ≈ 23 × 18 m).
4. **Every effect has all its phases** — at least a cast beat, a readable active shape, an
   impact peak and a clean ending; preparation and residue when the sim has them. Peak value and
   saturation land in the first ~25 % of an impact; endings shrink/erode, not linear alpha fades.
5. **If it feels long, it is too long.** Lingering transparent layers hide enemies and cost
   fill-rate. Residue is darker, desaturated, rimless and short.
6. **Budget-neutral by default.** No new draw calls, materials or textures without a reason;
   no per-frame allocations; every GPU resource disposed in `Vfx.dispose`.

## Workflow

1. **Gather references** (moves not original to poketone — all 16 current moves). Read or
   create `references/moves/<move-id>.md`: what the move is, how the games/anime show it
   (52poke / Bulbapedia links, short descriptions only — never download copyrighted images into
   the repo), the 2–4 **signature traits** to keep (Fire Blast's 大, Rapid Spin's shell spin,
   Thunderbolt's zig-zag), and how the reference game draws it (shapes, sizes and lifetimes;
   describe them, don't copy code).
2. **Read the sim truth.** Archetype and numbers in `src/run/sim/content/moves.ts`; how the area or
   projectile is built (delay, life, radius, length, angle, follow, burst) in
   `src/run/sim/attacks.ts`; events in `src/run/sim/state/events.ts`. Write the hitbox and timeline down.
3. **Fill in the design template** (`references/template-and-rubric.md`): intent, archetype,
   phase timeline with durations, shapes, colours, layers, upgrade scaling, coverage budget,
   enemy-readability check, perf budget.
4. **Block in timing with plain shapes first** (one decal + one sprite), check it in the game,
   then add secondary layers. Retiming a block-in is cheap; retiming finished layers is not.
5. **Build with existing primitives** (`references/repo-pipeline.md`): a recipe in the
   element's file (`vfx/fire.ts` …) registered in `shotLooks` / `areaLooks` / `burstLooks`.
   Reuse shapes in `sprites.ts` / `decals.ts` / `ribbons.ts` / `volumes.ts` before adding one.
6. **Verify with your own eyes.** Screenshots in the real game at: single cast, upgraded
   (area/count/dur), 150+ enemies, overlapping an enemy telegraph (boss dash lane, spore,
   slash). Measure draw calls / frame time in a crowded boss scene.
7. **Grade with the rubric**, fix the lowest axis first, re-shoot. Report what you saw and what
   you did not check.

## Phase model (summary — detail in `references/craft.md`)

| Phase | 中文 | Must communicate | Typical length | Easing |
| --- | --- | --- | --- | --- |
| Preparation / charge | 准备 | where and when it will hit | = sim `delay` (0.25–0.55 s) | ease-in, converging |
| Cast / startup | 施放 | "I fired", from where | 50–120 ms | pop: fast out |
| Active / travel | 飞行 / 持续 | direction, extent, still dangerous | sim life | steady loop |
| Impact | 命中 | it connected, how big | peak in 1–3 frames, 150–300 ms | expo-out |
| Hit reaction | 受击 | which target, crit, status | 120 ms flash (exists) | — |
| Residue | 残留 | what happened here (harmless) | 0.5–3 s, ≤ 1.5 s if frequent | slow decay |
| End / dissipation | 消散 | it is over, area is safe | 100–250 ms | shrink/erode |

Hit reaction mostly already exists — enemy flash, jitter and status tint in
`createRunView.ts`, damage numbers and hit-stop in `createRun.ts`, generic sparks in
`vfx/common.ts` — so move effects add at most a small element-flavoured spark on discrete hits.

## Review checklist (quick)

- [ ] Primary shape = hitbox size/shape/timing; spill ≤ 15 % beyond it and secondary.
- [ ] Preparation (if any) reads as "player's", not as an enemy warning.
- [ ] Cast beat at the mouth/chest; impact peak early; clear end; residue darker and short.
- [ ] Silhouette readable in a greyscale screenshot; one focal point; hot core only at impact.
- [ ] Element colours dominant, accent desaturated and small; no red/purple danger language,
      no candy-like cyan blobs; boss dash lane / spores / slash still readable on top.
- [ ] Within the coverage budget at 1× and after +100 % area; height ≤ ~2 m unless it is a
      sky strike; count/dur upgrades read as more/longer, not bigger.
- [ ] 150+ enemies: no white-out, no wall of particles, pool load reasonable.
- [ ] No new draw calls/allocations without reason; resources disposed; typecheck, lint, oxfmt.

## References

- `references/craft.md` — phases, timing and easing per archetype, readability (shape, value,
  colour, hierarchy), layering, density, upgrade scaling, stylised cartoon techniques; sourced.
- `references/repo-pipeline.md` — primitives, recipe interfaces, reading sim state, hit
  reaction / residue integration, screen budget maths, perf budgets, disposal,
  measuring.
- `references/template-and-rubric.md` — per-effect design template, review checklist,
  critique rubric, audit procedure.
- `references/moves/` — one reference note per move (signature traits, sources, reference
  game, sim facts); `references/moves/README.md` explains how to write a new one.
- `references/sources.md` — bibliography and what each source contributed.

## Related skills

`game-feel` (shake, hit-stop, juice tiers) · `shader-programming` (GLSL fundamentals) ·
`performance-optimization` (profiling) · `threejs-materials-lighting` (three.js materials).
