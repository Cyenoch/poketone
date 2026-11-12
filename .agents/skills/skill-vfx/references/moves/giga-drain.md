# 终极吸取 Giga Drain (`giga-drain`) — grass · drain · basic

- 52poke: <https://wiki.52poke.com/wiki/终极吸取> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Giga_Drain_(move)>

Signature traits
- Green energy drawn out of the target and streaming back to the user. *[familiar — check the GIF]*

Reference game: own `draw` / `trail` / `hit` hooks (source ranges not read); the drain archetype fires homing shots that carry the drain share.

Sim: homing shot, radius 0.22, speed 11, dur 1.4 s; heals 10% of the HP the hit removed and emits a `drain` event.

Keep: a small inked green orb; on hit a pale streak and motes running back to the caster (pale sun-white → lime: pure green motes vanish on the meadow). Avoid: big heal bursts on the player every hit.
