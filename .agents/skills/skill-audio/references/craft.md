# Sound craft for poketone

## 优先级阶梯 (priority ladder)

Write down who may lead before adding a sound. When the screen gets busy the mix rebalances who
leads; it does not get louder overall (Riot, Sandy Zhou).

| Rung | Cues | Treatment |
| --- | --- | --- |
| Lead — danger to me | `hurt`, `tell-danger`, `tell` (within 14 m) | `always`; distinct rhythm (red = double, blue = single); never tonal |
| Lead — big moment | `boss`, `danger`, `evolve`, `ult`, `elite-kill`, `revive`, `level`, `chest`, stings | `always`, may `duck` the music; one per batch; wait out hit-stops |
| Feedback | `reaction`, `capture`, `cast-*`, `berry` | medium tier, cooldowns 0.12–0.3 s |
| Bed (`bed` rule) | `hit`, `hit-*`, `crit`, `kill`, `candy`, `dash` | small tier, ≤ 160 ms tails, cooldowns 35–100 ms, yields at the voice cap, dips under ducking cues; `crit` is mastered at hit level, merges crits within 0.35 s and falls back to the element hit |
| UI | `ui-*` | its own bus, no jitter, one take |

## Prompt patterns

Worked:
- Hits / crits: `Single heavy dull thump with a short rounded snap on top, one firm impact, mid-range,
  damped with no ring, no bell and no metallic tone, audible on a small speaker`.
- Blue tell: `Short soft airy swish with a dull wooden tick at the very start, muted and rounded, no
  ring, no bell, no pitched tone`.
- Red tell: `Two quick urgent taps on a hollow wooden barrel, dull and punchy, the second slightly
  harder than the first`.
- Danger banner: `Two short muted brass stabs, tense and ominous like a warning in a fantasy adventure
  game, rounded and mid-range, no siren, no beep, no alarm`.
- Anything with structure: say it (`rising … for about one second and ending in …`).
- Always end with `dry close-mic, no reverb, no music, no voice`.

Failed (do not repeat):
- `bell ping`, `clean tone`, `alarm beeps`, `kalimba plink` on combat cues → pure tones, "ding-ding".
- `bright / sharp / sparkle / metallic / zap` → 50–100% energy above 4 kHz.
- Drums / timpani / "felt thump" even with "mid-range" → 100–300 Hz, silent on phones.
- `ostinato`, `steady constant energy`, mallet palettes in music → "叮咚" repetition.

## Industry practice and where we stand

| Practice | Who | Status here |
| --- | --- | --- |
| Importance system: emphasise the biggest threat, dim the rest | Blizzard, Overwatch (GDC 2016) | tells gated at 14 m; one tell per batch, red over blue |
| Frequency-band ducking (side-chain / dynamic EQ) instead of volume-only ducking | Baldur's Gate 3 (Audiokinetic) | music ducked by volume; bed ducked under leads |
| Content variation + pitch **and volume** randomisation + layering | Force Unleashed / Conan | takes rotate, ±6% pitch, ±1.5 dB volume |
| Light / heavy hit categories | Conan | `hit` / `crit`; hits follow the move's element (`hit-fire/water/grass/electric`) |
| Impact = transient + body + tail; short tails for repeated impacts | sound-design tutorials | one take per sound; tails trimmed by `maxMs` |
| Warning before the fast attack; warnings may be abstract | Paragon, Fang Tango | blue / red tells at wind-up start |
| Reward cues may be tonal; frequent cues short; "hero" sounds only for big moments | Material sound guidelines | candy / level / chest chimes; combat non-tonal |
| Loudness by platform: console −24 LUFS, phone speaker about −16 to −18 | Sony ASWG-R001, IESD, Bridgett | whole-mix loudness not measured yet |

Sources and dates: `docs/AUDIO.md` 「调研来源」.
