---
name: skill-model
description: >
  Create, repair, optimize and validate poketone's low-poly Pokémon GLBs: reuse preserved Tripo
  sources, apply the existing Blender pipeline, review topology/base colour and player motion,
  and verify game loading and instancing. Use for player, enemy, guardian or prop model defects,
  animation contact, asset optimization and new model production. New generation uses official
  artwork and a multiview sheet only when needed and within the user's spending authorization.
---

# Skill model (poketone)

## Choose the workflow first

For existing assets, default to preserved sources and free Blender post-processing. Read
[the repair and validation workflow](references/optimization-workflow.md) before changing geometry,
weights, clips or the preparation pipeline. Use it for new models' final preparation and acceptance too.
The generation instructions below apply only when a new source is needed; an optimization request
alone does not authorize paid generation or retargeting. Existing spending authorization remains valid.

Use `scenario-blender-expert` for Blender execution/review, plus retopology, uv-baking and
texturing-shading for static repairs, rigging and animation for player motion, and export for
round-trip checks. Keep poketone's contracts in this skill authoritative over generic budgets and
thresholds. Do not turn a general audit warning into an automatic art rejection.

Text-to-model lets Tripo invent the reference image itself, and that step is where colours go
wrong (Squirtle got a violet belly, Wartortle and Blastoise needed `recolour` fixes in
`assets/prepare-game-models.py`). Giving Tripo four views drawn from the official artwork fixes the
colours at the source for the same price. Measured on Squirtle, 2026-11-06: text-to-model 30
credits with wrong belly and shell; multiview 40 credits with every colour right.

## New source generation rules

1. **Multiview for new character sources.** `--dry-run` first, `TRIPO_CLIENT_APP=claude`,
   `--model tripo-v3.1 -p smart_low_poly=true -p face_limit=1000`. Single-image costs the same 40
   and gives less geometry control; text-to-model is not used for characters any more.
2. **Sheet from `openrouter/google/gemini-nano-banana-2.1`** through the magpie-image MCP, with the
   official artwork as `reference_images`. gpt-image is blocked by its safety filter on Pokémon
   about half the time and leaves smudges that need retouching; banana passes and draws clean.
3. **2×2 layout, side views with tails pointing outward.** In a single row the tail of one view
   touches the next view's hand and the sheet cannot be split. Banana ignores "leave a wide gap".
   "Outward" is the direction only: a tail that curls to one side of the body is on the near side in
   that side's view and behind the body in the other. Banana drew Squirtle's on the near side in both,
   and the mesh came back with a tail on each side (`docs/LESSONS.md`).
4. **Never ship an unsplit sheet.** `tripo make` with one image is image-to-model of the whole
   sheet. Run `scripts/split-sheet.py`; it refuses when the gaps are not clean.
5. **Judge from the game camera, not Tripo's preview.** Tripo's preview is one front view.
   `scripts/render-compare.py` is a historical close-up diagnostic helper, not an exact current-game
   camera. Check current `createRunView.ts` camera, look-at offset and framing before reusing it;
   compare the turnaround and actual game-size display as described in the repair workflow.
6. Playable forms are not decimated (`MODELS[...]` target `None`), so shape counts as much as
   colour; swarm enemies use per-model budgets in `MODELS`, with silhouette and base colour both essential.
7. Keep the Tripo output in `assets/<characters|enemies>/<name>/generation/` with its `task.json`
   and the sheet it was built from, then follow docs/DEVELOPMENT.md 「3D 模型与动画（Tripo + Blender）」 for rig,
   animation and `bun run assets:game`.

## New source generation workflow

1. **Reference.** Official artwork from PokeAPI:
   `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/<dex>.png`
   (475×475 RGBA). Save it next to the generation output.
2. **Sheet.** `generate_image` with the prompt below, `model: openrouter/google/gemini-nano-banana-2.1`,
   `size: 1:1`, `reference_images: [<artwork>]`. Look at it before going on: eye colour, shell /
   marking colours, tail present in the back view, same height in all four cells.
3. **Split.** `python3 .agents/skills/skill-model/scripts/split-sheet.py <sheet> <out-dir>` writes
   `v-front/left/back/right.png` (square, white, same scale) and `preview.png`. If it reports
   fewer than two column or row gaps, regenerate the sheet; do not cut by hand. A one-sided feature (tail,
   flame) must sit on the opposite image side in the back view from the front view; if it doesn't, flip
   `v-back.png` horizontally, or Tripo builds it on both sides. In the side views it is on the near side in
   only one of them; if both show it on the near side, regenerate the sheet.
4. **Dry-run, then submit.**
   ```sh
   TRIPO_CLIENT_APP=claude tripo make --dry-run --model tripo-v3.1 -p smart_low_poly=true -p face_limit=1000 \
     <out>/v-front.png <out>/v-left.png <out>/v-back.png <out>/v-right.png
   ```
   The plan must say `multiview_to_model` with inputs `front, left, back, right`; check its quoted cost.
   Submit with `--no-open --yes --name <name>-mv -o <out>/tripo-out` when the spend is
   authorized; do not ask again if the current session already authorizes it. Historical credit figures
   here are reference observations; the current dry-run quote controls the cost.
5. **Compare.**
   ```sh
   blender --background --factory-startup --python-exit-code 1 --python .agents/skills/skill-model/scripts/render-compare.py -- \
     <renders> current=public/models/<name>.glb new=<out>/tripo-out/.../model.glb
   ```
   Then build the contact sheet (the script prints the command). Check: belly / shell / marking
   colours, head roundness in the `top` view, tail present in `back`, arms clear of the belly.
6. **Facing.** Tripo exports face +X. Confirm in the `front` render before adding `facingYaw`.

## Playable form: rig, animation, wiring

Only after the model passed the comparison. Costs are from `public/models/game-models.provenance.json`
(rig 25, each preset animation 10). Run every Tripo step with `TRIPO_CLIENT_APP=claude`, keep each
step's `result.json` under `assets/characters/<name>/{rig,animations}/`, and add its task id to the
provenance file (rejected attempts are archived under `rejected/`, with the reason).

0. **Front symmetry.** The lobby shows the model front-on. Ask the sheet for a neutral symmetrical stance
   (both arms at the same height and angle, left and right halves equal) and check the raw mesh's front
   silhouette. Mirror overlap can help locate unintended asymmetry, but is not a numeric art gate;
   intentional tails and shells need separate judgment. Also check that the face has eyes.
1. **Rig check, free to read.** `tripo anim check <model.glb>`. The multiview mesh keeps the arms
   away from the belly; if the check fails, regenerate the sheet, do not rig a failing mesh.
2. **Pick the rig by body, not by line.** `tripo anim rig <model.glb> --rig-type <type> --out-format glb`
   with `biped`, `quadruped`, `avian`, `serpentine`, `aquatic`, `hexapod` or `others`. 25 credits. Known
   result: the Bulbasaur line's quadruped rig mislabelled the bulb as the head and folded the face under
   the body, so that line is rigged in Blender (`assets/characters/rig-quadrupeds.py`, 0 credits). Look at
   a posed frame before buying animations, and measure the L_/R_ bone heads mirrored about the root. A rig
   with the head below the hip or the feet above the knees is wrong for that mesh; re-rigging the same mesh
   returns the same rig, so regenerate the mesh instead.
3. **Animations.** `tripo anim retarget @<rig-task> --animation preset:idle preset:run --animate-in-place`
   (10 credits each, at most 5). The game plays clips named `idle` and `run` (`view/playerRig.ts`
   looks them up by name); every other preset is dead weight, so buy only those two.
4. **Run clip for short-legged bipeds.** Tripo's run barely moves the legs of Squirtle, Pikachu and
   the like: replace it with `blender --background --factory-startup --python-exit-code 1 --python assets/characters/run-bipeds.py`
   (leg IK, 0 credits), output in `assets/characters/<name>/blender/`.
5. **Register.** Add the model to `MODELS` in `assets/prepare-game-models.py` (target `None`, texture
   1024), plus `FIXES`: every Tripo biped gets `symmetrise(run_shift)` first (Tripo's idle leans to one
   side and its rigger fits the two arms differently, `docs/LESSONS.md`), then `open_arms` for arms
   clipped into the belly, `recolour` only for a wrong colour. The eight bipeds then bake `pin_idle_feet` on the final
   rest/weights; inspect actual skinned soles, mixed clips and turning, and remeasure lift (pinned idle is zero).
   Preserve +X forward and the runtime tail carrier/centreline weight contract. Run `bun run assets:game <name>` (with no name it rebuilds every model).
6. **Wire.** `formModels` in `src/run/view/assets.ts`: measure `runClipSpeed` / `lift` with
   `assets/measure-run-clip.py` (do not guess), set `runCycles` (1 for hand-keyed runs, 2 for Tripo's),
   and a `tail` centreline when the form has a visible tail (the tail is a procedural chain,
   `view/tail.ts`). Add `facingYaw` after checking the side render.
7. **Verify in the game**, from the run camera, with the clip actually playing: feet should not sink
   or slide, the tail should not poke through the legs.

## Enemy (non-player): cheaper, different

A swarm enemy is seen small, in the dozens, for seconds. It gets no rig and no clips: the view hops
it procedurally (`createRunView.ts`: a `hop` bounce from the move phase; flyers hover). So the model
is the whole asset and shape and silhouette matter more than the texture.

1. **Sheet and Tripo as above**, but a rough sheet is fine. If the species is not 4-legged or
   bipedal in a way that matters, still draw the same four views; the multiview cost is the same.
   Text-to-model (30 credits) remains acceptable for a swarm enemy whose colours are simple and
   whose belly or markings are not the identity, but check the colours against the artwork first.
2. **Place the output** at `assets/enemies/<id>/generation/` (`model.glb`, `task.json`).
3. **Register** in `MODELS` as `("enemies/<id>/generation/**/model.glb", "enemies/<id>.glb", 900, 512)`:
   900 triangles and 512 px are starting budgets, not requirements for every model. Follow the
   repair workflow before accepting simplification; keep the established per-model budget. Run `bun run assets:game <id>`. The decimation
   refuses skinned meshes, so never rig an enemy.
4. **Wire.** Add the id to the enemy table in the sim (`src/run/sim/content/enemies.ts`, see
   `src/run/sim/content/README.md` for the extensibility notes); the view loads
   `/models/enemies/<id>.glb` (`enemyModel`). Size comes from the sim definition, the model is
   scaled to it; check facing in the side render.
5. **Judge at swarm scale**: 30 of them on screen from the run camera, not one up close. If two
   species read the same at that size, change the silhouette (ears, tail, wings), not the texture.

## Guardian / boss and special enemies: rigged and animated

The swarm rule above (no rig, procedural hop) does **not** apply to a guardian or to any enemy whose
attack the player must read from the body. Their attacks are telegraphed phases in the sim
(`EnemyDef.phase`: `chase → windup → dash → recover`, plus casts such as Scyther's Air Slash,
`sim/bosses/*.ts`, `sim/skills/telegraph.ts`), and the body should perform them: crouch in the
wind-up, lunge on the dash, settle in the recover.

**Future work, not supported yet (user decision 2026-11-06; listed in `docs/ROADMAP.md`).** Every enemy, guardians included, is baked by
`toInstanceSource` (`view/assets.ts`) into one static geometry and drawn as an `InstancedMesh`
(`createRunView.ts`, 2 instances for the guardian). `toInstanceSource` throws on anything but a single
single-material mesh and the instance path has no skeleton, so a rigged boss cannot go through it. A
rigged boss needs its own render path: a skinned model with an `AnimationMixer` per boss, mounted and
driven like the player's (`view/playerRig.ts`: clips by name, blended by weight), with its clip
selected from `enemy.phase` and `phaseTime`. The view only reads sim state and must not write back.
Treat that as a code task, scoped with the user before buying any animation.

Workflow, same as a playable form (rig type by body, `tripo anim rig`, 25 credits), with these
differences:

1. **Clips follow the phases, not the player's two.** At most 5 per retarget call, 10 credits each:
   `idle`, `walk`/`run` (chase), a wind-up pose, the attack itself, `hurt` if it staggers. Tripo's
   biped presets include `idle walk run jump dive climb slash shoot hurt fall turn`; the only
   quadruped preset in the docs is `preset:quadruped:walk`. Pick the closest preset per phase
   (`slash` for a blade lunge, `dive` for a pounce, `shoot` for a ranged cast). A preset is a
   stand-in, not custom keyframes: a body that matches no preset (Scyther's wings and scythes) gets
   its signature move hand-keyed in Blender, like `run-bipeds.py` does for runs (0 credits).
2. **Timing is the sim's.** Stretch or hold each clip to the phase length (`BOSS_WINDUP × tele`,
   `BOSS_DASH_TIME`, `BOSS_RECOVER × tele`); the telegraph line already shows the reach, so the clip
   must hit its contact frame when the sim's phase flips to `dash`. Do not retime the sim for a clip.
3. **Keep the face count honest.** One boss on screen at a time: no decimation, up to
   `face_limit` 1500, texture 1024, like a playable form. `prepare-game-models.py` already refuses
   to decimate skinned meshes, so register it with target `None`.
4. **Special enemies** (an elite with a unique tell, a mid-boss, an enemy that is the stage's
   gimmick) get this treatment only when the player must read its body; a spore cloud or a
   stationary caster is told by the VFX telegraph (`skill-vfx`), and a hop is enough.
   Rig-and-animate them one at a time, never as a batch: each rigged enemy is a skinned draw call
   outside the instancing that makes the swarm cheap.
5. **Verify in the game** at the guardian's real size and camera: the wind-up pose must be
   readable from the run camera 1 s before the dash, the contact frame must match the damage,
   and the clip must not slide against the movement the sim applies.

## Prompt (banana, 2×2)

> Character turnaround model sheet of the character in the reference image, keeping its exact
> design, proportions and colors, laid out as a 2 by 2 grid on a plain pure white background with
> wide empty white margins between the four cells. Top-left cell: front view. Top-right cell: back
> view (show the tail curling out from below the shell). Bottom-left cell: right side view,
> character facing right, tail on the left. Bottom-right cell: left side view, character facing
> left, tail on the right. The tail curls out on the character's own left side, so it is in full
> view in the left side view and mostly hidden behind the body in the right side view. Same scale
> and same height in all four cells, each character centered in its cell. Neutral standing pose
> with arms held slightly away from the belly, identical in all views. Flat even lighting, no
> shadows, no ground line, no grid lines, no text, no labels. Clean shapes and flat color regions
> suitable as reference for a low-poly 3D model.

Adapt the back-view parenthesis to the species (what is only visible from behind: tail, bulb,
shell, wings), and the tail sentence to the side the tail curls to; drop that sentence for a tail
centred behind the body. Keep "arms held slightly away from the belly": Tripo's bipeds otherwise
press the hands into the belly and need `open_arms`.

## Known limits

- Banana draws eyes browner than the artwork's maroon; Tripo keeps whatever the sheet says.
- When the front view is wide and the side view round, Tripo splits the difference and the head
  comes out flat front-to-back (visible in the `top` render). Regenerate the sheet rather than
  accepting it.
- Side views sometimes extend the belly plate over the thigh; Tripo copies it.
- Tripo's multiview docs only require a front view, consistent lighting and ≥256 px; centring,
  equal scale and the flat style are this project's choices, measured to work on Squirtle only.
