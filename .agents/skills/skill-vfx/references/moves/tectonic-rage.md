# 地裂岩崩 · tectonic-rage

- Source: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Tectonic_Rage_(move)). Ground Z-Move: earth breaks under overwhelming force [familiar — check the GIF]. This project's repeated rock/aftershock fusion is its own adaptation.
- Keep: heavy embedded boulder, branching ground fractures to actual targets, final stone pillars. **No lightning, hovering electric orb or sparks.**
- Sim: `ROD`: .35 s flight, 2.1 s active, .32 s target ticks; search r3.4, 3 targets + count. `chain` points list source then targets selected around that source, not target-to-target jumps. Final burst r2 × area scale. The sim's height3 is used for targeting visibility; this grounded visual does not change it.
- Recipe: `rock.ts`; arc from cast origin into embedded rock, event-driven 220 ms aftershocks (shorter than next tick), final full-radius 280 ms pillar quake. Never draw the search radius as a damaging disc. No new resources or guessed damage targets.
- Reference game animation uninspected. Final burst, source-to-target geometry and absence of damage-looking residue require visual checks.
