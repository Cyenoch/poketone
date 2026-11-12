# 喷烟 Lava Plume (`lava-plume`) — fire · nova · mid

- 52poke: <https://wiki.52poke.com/wiki/喷烟> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Lava_Plume_(move)>

Signature traits
- A burst of scarlet flame and smoke rolling out from the user to everything around it. *[familiar — check the GIF]*

Reference game: own `nova` hook (source range not read). The generic nova (read) draws a ring at the hit radius, a white inner ring at 0.7× and ~28 radial particles living 0.35 s.

Sim: `nova` area on the caster, radius 2.0 (contact 0.95 + ~1 m), one hit on the first tick, life 0.3 s, cd 1.3 s, burn 30%.

Keep: an orange ring that sweeps out to exactly the radius in the 0.3 s life, flames coasting to the rim, a short scorch. Avoid: red fills (enemy language), smoke columns taller than ~1 m.
