# Repair, prepare and accept poketone models

Use `assets/prepare-game-models.py` as the publishing pipeline. Reuse its `MODELS`, `FIXES`,
source selection and staged-output support; do not build a parallel asset framework.
Paths below are repository-relative. Results of the 2026-11-07 optimization pass describe that
revision, not automatic approval of future outputs.

## Establish the input and scope

- Read the current project instructions and relevant model configuration. Record the shipping
  file, source file and hashes before editing. Keep raw Tripo sources and generation provenance.
- For a whole-library request, inventory every formal GLB and record both modified and retained
  models with individual reasons. Do not require every model to change.
- Keep all writes in the assigned workspace. Another worktree's uncommitted source is not a
  baseline to copy wholesale; compare read-only and integrate only task-relevant changes.
- Use headless Blender with `--background --factory-startup --python-exit-code 1`, one process
  at a time. Use the installed executable; do not open a foreground window for batch work.

## Static geometry and colour

1. Compare shipping and preserved source before deciding whether damage comes from generation
   or preparation. Inspect front/back, affected close-ups and the game viewing angle. Exclude
   importer-created hidden bone-display meshes (such as Icosphere) from geometry measurements.
2. For damaged static decimation candidates, try the existing `weld_decimation_seams` before
   Decimate at the existing budget. Its 1e-6 open-boundary weld is calibrated to current source
   scale. Check UV corners, thin sheets, nearby independent parts and silhouette. Never apply this
   static operation to a skinned mesh or add every asset to `SEAM_REPAIRS`.
3. Add only visually accepted candidates to `SEAM_REPAIRS`. Keep the original when welding or
   decimation harms curls, crests, eyes, antennae or other identifying features. A healthy model
   can be retained without rebuilding. Do not increase triangles merely to conceal a pipeline defect.
4. Repair source gaps locally: reconnect the intended limb/fin/tail, preserve its texture and
   shape, and remove debris only after locating it visually. Preserve intentional ghost parts,
   segmented bodies, separate machines and two-sided leaves. Inspect reverse-face flags with
   the actual material; double-sided geometry is not automatically a visible hole.
5. Work on base colour and silhouette. Preparation discards non-base-colour maps, and the
   runtime Lambert material does not carry normal/AO/emissive detail. Do not spend effort on
   PBR channels that will never display.

Stage candidates with `GAME_MODELS_OUT` before replacing shipping files. `GAME_MODELS_SOURCE`
can select a source root when needed. Keep the staged tree's paths parallel to `public/models`.
Compare each before/after pair using identical camera, light, material treatment and scale.
Do not independently fit each variant so tightly that changed proportions disappear.

## Player motion and lifecycle

- Preserve +X forward and the configured runtime yaw (currently −90° by default). Preserve bone
  names, clips, timing and the loading-time `rigTail` contract: carrier, centreline and radius
  determine rewritten tail weights. Raichu's prepared tail binds to Pelvis before runtime splitting.
- Keep static welding away from skin. In the eight existing bipeds, run `pin_idle_feet` after
  `symmetrise`, `open_arms`, and applicable geometry/tail fixes. It solves using final rest and
  evaluated skinned soles; adapting it to a new skeleton requires checking its actual anatomy.
  Do not apply the biped solver to the three quadrupeds.
- Diagnose float over the whole idle cycle. A fixed lift cannot fix legs whose contact height
  changes; constrain feet and solve reachable hip/leg motion first, then remeasure lift.
  Pinned current biped idle uses zero. Preserve upper-body motion and check knees, shell,
  wings, tail and full-body intersections as well as the lowest foot.
- Measure the exported clip's actual duration and gait count. For hand-authored runs, follow
  `assets/measure-run-clip.py`'s planted-speed convention; do not substitute median vertex speed.
  The three repaired Tripo runs have local seam interpolation in `close_run_loop`.
  Equal endpoint positions alone do not establish continuous velocity: inspect both sides of
  the loop and subframes after export. The 2026-11-07 repair still has a documented velocity kink.
- Sample idle/run blends, start/stop and turning, including breathing and dash scale.
  `PlayerRig.footFloor` measures Foot/Toe-dominant skinned vertices after mixing; the view only
  raises additional penetration and preserves run flight. This is not slope-aware per-foot IK
  and is not a replacement for authored idle contact.
- For CPU skin measurement, refresh attached-skin `bindMatrixInverse` through
  `updateMatrixWorld`; `updateWorldMatrix` alone does not do that. Measure in avatar space
  and verify invariance to avatar position, yaw and scale. Do not use a tail or shell minimum as a foot.
- Keep `TailSpring.dispose()` in the rig's unmount path. Reuse the same loaded model across
  repeated mounts after moving its tail; verify restored rest and identical subsequent motion.

## Export and acceptance

- Static enemies, including guardians, still require one mesh and one material for instancing.
  Independent guardian skin rendering remains deferred unless explicitly scoped. No UI or
  simulation changes are implied by asset work.
- Deliver self-contained GLB compatible with `src/game/models/loadGlb.ts`. Do not introduce
  Draco, Meshopt or KTX2 requirements. Preserve axes, sizes, animation names and texture channels.
- Reimport final outputs and run the relevant Scenario audit, but interpret flags in context.
  Validate the loader/instancing contract separately from aesthetic decisions.
- Inspect actual saved images. Blender diagnostics do not prove official App appearance.
  For authorized browser acceptance, read the GPU UI handoff/migration docs and follow the
  host's preview tools. Check the existing app at gameplay size; do not redesign its UI.
- Run checks proportional to changes. The existing `scripts/view.test.mjs` protects real
  mount/unmount, mixed skin contact and transform behavior. Reuse it rather than duplicating tests.
- Write a new dated result or explicit alternate output; preserve historical baseline evidence.
  A discrete CPU sample grid does not prove every frame, terrain contact or GPU behavior.
- After the last asset/code change, refresh affected QA and verify its input/output hashes.
  Never cite pre-change results as final approval. If simulation behavior is unchanged, do not
  rerecord golden fixtures.

Deliver an itemized record of modified/retained status, reason, source/output hashes, triangles,
bytes and actual validation scope; matched comparison images; relevant test results; and remaining
defects or unverified areas. Independent review is useful for concrete visual or lifecycle risks.
Commit when requested, keeping merge and deployment within the user's authorization.
