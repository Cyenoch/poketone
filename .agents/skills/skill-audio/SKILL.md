---
name: skill-audio
description: >
  Design, generate, master, wire, review and fix poketone's sound effects and music: what deserves
  its own sound and how many variants, where each cue sits on the mix's priority ladder, ElevenLabs
  MCP prompting, picking takes by measured metrics, `bun run audio:master`, the shared Web Audio engine
  in `src/audio/`, and landing each sound on its effect's key frame. Use when adding or changing any
  sound or music, when a sound feels too loud, shrill, "ding-ding", weak, late, early, repetitive or
  "doesn't match my attack", and when auditing the in-run mix.
---

# Skill audio (poketone)

A sound in a run is **information first, flavour second**. In a crowd of 200 enemies the player
must still hear, without looking: *I got hurt, something is winding up next to me, a big moment
happened, my hits connect.* Everything else is a bed that yields. Riot's rule fits: readability
has a ceiling; when the mix loses its hierarchy, the player loses information.

The full style and asset record is `docs/AUDIO.md` (read it first); pitfalls are in
`docs/LESSONS.md` 「音频」; tiers and hit-stops in `docs/GAME-FEEL.md`. This skill is the working
method. For generic bus / adaptive-music theory see `audio-design`.

## Non-negotiable rules

1. **ElevenLabs MCP only** (`eleven_text_to_sound_v2` for SFX, `eleven_music_v2_5` for music),
   mastered by `bun run audio:master`, shipped by `--publish`. Never hand-synthesise or pull audio
   from elsewhere. Every take is recorded in `assets/audio/elevenlabs/manifest.json`.
2. **Know the cue's rung before generating it** (`references/craft.md` 「优先级阶梯」): a *lead*
   (hurt, tells, danger, boss, level, evolve) must survive a swarm; a *bed* (hit, kill, candy,
   dash) is short, soft, and yields. Rung decides tier, length, cooldown, `always`, `duck`.
3. **Combat feedback is never a bell.** Crit, tells, danger and hits are knocks, thumps, ticks,
   slaps, swishes or muted brass — `no ring, no bell, no pitched tone`. Pure tones repeated a few
   times a second are heard as "ding-ding-ding" and no level check catches them. Chimes are for
   rewards only (candy, level, chest) — the user confirmed the candy chime is fine.
4. **No sudden shrill or very loud sound.** Cut sharpness, not size: big moments stay big but
   round. Avoid `bright / sharp / sparkle / metallic / zap / shimmer / beep / alarm`.
5. **Phone speakers play nothing under ~300 Hz.** A thump whose `centroid` is under 300 Hz is
   silent on a phone; drums prompted as "mid-range" still come out as bass. Pick instruments that
   are mid-range by nature (wood, brass, slaps) and check the report.
6. **The hit lands on the key frame.** `startAt = event + keyMs − hitMs`; a sound must never start
   before its effect or after it ends. Hit-stop freezes VFX (sim time) but not audio (real time).
   For every sound with a lead-in, keep the release selection in the asset manifest and its measured hit in generated `master/timing.json`; record non-derived integration decisions in the relevant change.
7. **Variety by regeneration, not pitch.** Frequent sounds 3–4 takes, rare ones 1–2; pitch jitter
   only ±6%. Never cut existing variety when replacing a sound.
8. **Same event, one loud sound.** When an event already brings its own big sound, generic cues
   (`boss` banner, `level`) stay silent in that batch; stings wait out hit-stops.
9. **Pick by numbers, report honestly.** You cannot listen. Choose takes with
   `bun run audio:master --report <id>` plus measurements; say plainly that nobody heard them.
10. **Unused takes are deleted** (raw, manifest `takes`, masters) once a pick is made; git keeps
    the history. Music candidates are kept unless the user says otherwise.

## Workflow

1. **Locate the cue**: which `RunEvent` / UI action, how often it fires (count it — see
   `references/pipeline.md` 「数次数」), its rung, its visual key frame and length.
2. **Prompt** with the template in `docs/AUDIO.md` 「提示词模板」 and the patterns in
   `references/craft.md`. 4 takes per prompt, usually two prompts; `duration_seconds` ≥ 0.5.
3. **Download immediately** (signed URLs expire in ~2 h), name `raw/sfx-<id>-<n>.mp3`, append each
   take with `generationId` and its `prompt` to the manifest.
4. **QC**: `--report <id>` — reject `SILENT`, `LOW` (unless it is a felt-only layer), `HARSH`,
   `TONAL` on combat cues, slow attack on tells; then set `pick`, `tier`, `maxMs`, `frequent`.
5. **Master and publish**: `bun run audio:master <id>` then `bun run audio:master --publish`.
6. **Wire**: name in `SFX_NAMES` + `RULES` (`src/audio/engine.ts`), call `audio.sfx(name, { keyMs })`
   from `drain` in `src/run/createRun.ts` or from `useAppAudio.ts`. The view never writes the sim.
7. **Verify**: `bun test --timeout=0 ./scripts/audio.test.mjs`, lint,
   typecheck, and a headless-Chrome check through `window.__poketoneAudio()` (`recent` shows name,
   take, delay, offset). `bun run golden` must not move unless the sim changed on purpose.
8. **Record**: the asset manifest / generated timing data and the relevant change, a lesson in `docs/LESSONS.md` when
   something surprised you, and what is still unverified.

## When something sounds wrong

| Complaint | First suspects |
| --- | --- |
| "ding-ding-ding", too prominent | tonal share of frequent / combat cues (`tonal` column), cooldowns, count per second |
| shrill, tiring | `>4k` share, prompt words, crit / electric / revive takes |
| startlingly loud | tier too high, several large cues in one batch, missing hit-stop wait |
| weak on phone | `centroid` < 300 Hz, `LOW` flag |
| late / early | `hitMs` vs the effect's key frame, `keyMs` missing, hit-stop |
| repetitive | too few takes, no volume variation, cooldown too short |
| "doesn't match my attack" | one generic hit for every move — hits should follow the move's element |

## References

- `references/pipeline.md` — files, engine API, mastering tiers, manifest fields, counting cue rates.
- `references/craft.md` — priority ladder, prompt patterns that worked and failed, industry practice.
