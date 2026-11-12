# 种子炸弹 Seed Bomb (`seed-bomb`) — grass · lob · mid

- 52poke: <https://wiki.52poke.com/wiki/种子炸弹> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Seed_Bomb_(move)>

Signature traits
- Hard seeds rained down on the target from above, bursting on impact. *[familiar — check the GIF]*

Reference game: arc projectile (0.75 s flight, gravity 22) with `draw` / `trail` / `boom` hooks (source ranges not read); explodes at the landing point with the move's area.

Sim: shell radius 0.25, flight 0.75 s, burst radius 1.5 (`burst` area, 0.3 s).

Keep: a small green seed arcing high, a player-coloured landing telegraph at the burst radius that fills as it falls, soil clods and seeds at impact, short soil mark. Avoid: red/dashed-red landing markers (enemy), a shell bigger than ~0.5 m.
