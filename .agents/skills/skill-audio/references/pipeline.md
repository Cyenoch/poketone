# Audio pipeline in poketone

Re-read the files before editing; this describes the structure as of 2026-11-05.

## Files

| Path | Role |
| --- | --- |
| `assets/audio/elevenlabs/manifest.json` | source of truth: per asset `kind` (sfx / loop / jingle), `tier`, `frequent`, `maxMs`, `params`, `prompt`, `takes[]`, `pick[]`, `ship` (in-game name), loop `bpm` / `startSec` / `loopBars`, `note` |
| `assets/audio/elevenlabs/raw/` | downloaded takes (`sfx-<id>-<n>.mp3`, `music-…`) |
| `assets/audio/elevenlabs/master/` | mastered output (`<id>.flac` or `<id>-<n>.flac` in pick order; music `.m4a`) and `timing.json` (`lenMs`, `hitMs`, `peakMs`) |
| `scripts/audio-master.mjs` | `--report [id…]` QC, `[id…]` master, `--publish` copy `ship` assets to `public/audio/` and write `bank.json` |
| `public/audio/bank.json` | what the game loads: `sfx[name] = {files, hitMs}`, `music[name] = {file, bpm}` |
| `src/audio/engine.ts` | the one Web Audio engine: `SFX_NAMES`, `RULES`, buses, voices, music |
| `src/audio/schedule.ts` | pure `soundStart(hitMs, keyMs)` and `untilNextBeat`, tested in `scripts/audio.test.mjs` |
| `src/audio/useAppAudio.ts` | menu music, UI clicks / back / denied / start / move, transition sound |
| `src/run/createRun.ts` `drain` | run events → sounds; run music by `snapshot.boss`; end stings |

## Engine

- `getAudio()` singleton: `load()`, `setEnabled()`, `sfx(name, {pitch, keyMs})`, `music.play(track | null)`,
  `music.preload()`, `music.setPaused()`, `onError()`. Context is created on the first gesture.
- `RULES[name]`: `cooldown` (s), `always` (ignores the 14-voice cap), `jitter` (±6% pitch), `duck`
  (dB dip of the music while it plays; overlapping dips keep the deepest), `fallback` (sound played
  instead while inside the cooldown, e.g. `crit → hit`), `bed` (high-rate bed sound on its own bus;
  it dips by half the dB of any ducking cue). Jittered sounds also vary ±1.5 dB in level.
- Buses: music 0.5 → duck → pause, sfx 0.9, bed 0.9 → bed duck, ui 0.8 → master compressor (−14 dB, 6:1).
- Dev handle `window.__poketoneAudio()` → `{context, enabled, voices, effects, music, wanted, recent}`.
  Drive it through the UI; a dynamic `import()` of the engine in the dev server can give a second
  instance (`docs/LESSONS.md`).

## Mastering

| Tier | RMS target | Peak ceiling | Default max length |
| --- | --- | --- | --- |
| small | −26 dBFS | −6 | 220 ms |
| medium | −22 | −3 | 600 ms |
| large | −18 | −1 | 3000 ms |
| ui | −24 | −6 | 500 ms |

Music loops −20 LUFS, jingles −18 LUFS. Energy above 4 kHz capped at 15% (`frequent`) / 40% with a
high shelf (logged as `tamed`). `frequent` also turns on report checks: attack ≤ 40 ms, decay
≤ 160 ms, centroid ≤ 5 kHz, tonal share ≤ 70%. SFX ship as mono FLAC, music as AAC.

Report columns: `peak`, `onset`, `attack`, `decay-30dB`, `centroid`, `>4k`, `tonal` (energy within
±6% of the strongest bin above 100 Hz, Hann window). Flags are advice: `SILENT`, `SLOW-ATTACK`,
`LONG-DECAY`, `BRIGHT`, `HARSH`, `TONAL`, `LOW`.

## 数次数 (how often a cue fires)

Real runs are the truth; when they cannot start, use the bot. A scratch copy of
`scripts/balance-bot.ts` that records `world.events` per tick (instead of clearing them), then a
replay that applies `RULES` cooldowns, gives per-second mean / max / busiest-30-s for each cue over
120–300 s. Re-roll `crit` with higher crit chances (25%, 50%) because builds reach them. Report
counts as "bot + rule replay", not as recorded audio.

## Checks before handing back

- every `pick` exists in `raw/`; master count = pick count; `public/audio` files byte-identical to
  masters; `bank.json` `hitMs` = `timing.json`; no file in `public/audio` outside `bank.json`;
- `audio.test.mjs`, `oxlint`, `tsc -b`, `oxfmt --check` on touched files;
- headless Chrome: `effects` = number of `SFX_NAMES`, bursts give the expected `recent` sequence.
