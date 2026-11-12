# 冲浪 Surf (`surf`) — water · wave · mid

- 52poke: <https://wiki.52poke.com/wiki/冲浪> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Surf_(move)>

Signature traits
- A big wave the user rides into the foe. *[familiar — check the GIF]*

Reference game: a row of wave projectiles across the aim (count ≈ area × 1.4) (read in the cast code), `draw` / `trail` hooks (source ranges not read); knock 2.5.

Sim: one band per count, half-width 1.4 (2.8 m wide), depth 1 m, speed 8, dur 0.9 s (7.2 m), each enemy once, knock 2 along travel.

Keep: a low blue crest wall across exactly the band (≤ ~1 m tall), foam lip, spray forward, ripple at the end. Avoid: tall opaque walls that hide enemies, cyan blobs near the ground (candy).
