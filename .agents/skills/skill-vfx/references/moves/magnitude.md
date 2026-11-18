# 震级 · magnitude

- Source: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Magnitude_(move)). Shakes the ground with variable intensity in the original games; concentric earth pulses [familiar — check the GIF]. The project has fixed move damage, not a random magnitude roll.
- Keep: low ground fractures and repeated dust rings. Avoid electric arcs, glowing lava and tall walls.
- Sim: `spin`, follow disc r4.1, .9 s life, .3 s ticks. Phase reads the actual `tickTimer`.
- Recipe: `rock.ts`; full boundary with dark fractures, interior dust ripple on the simulated pulse, 150 ms ending. Cast dust is brief; no duplicate per-target flash. Radius/duration follow the live area; no new resources.
- Reference game animation uninspected; timing and crowd checks are separate.
