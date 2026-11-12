# 潮旋 Whirlpool (`whirlpool`) — water · vortex · mid

- 52poke: <https://wiki.52poke.com/wiki/潮旋> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Whirlpool_(move)>

Signature traits
- A whirling vortex of water trapping the target. *[familiar — check the GIF]*

Reference game: `draw` / `trail` / `boom` hooks (source ranges not read); vortex = pull, then explode.

Sim: vortex rules (fire-spin): delay 0.25 s, radius 1.5, pull 2 × radius, ticks 0.3 s, dur 1.8 s, collapse `burst` ×1.8.

Keep: dark water disc + foam whirl at the radius, a low see-through spinning wall, droplets drawn in from the rim, splash ring on collapse. Avoid: drawing the pull range as a second ring (it reads as a bigger hitbox).
