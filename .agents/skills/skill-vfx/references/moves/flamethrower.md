# 喷射火焰 Flamethrower (`flamethrower`) — fire · cone · mid

- 52poke: <https://wiki.52poke.com/wiki/喷射火焰> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Flamethrower_(move)>
- Description: 向对手发射烈焰进行攻击。有时会让对手陷入灼伤状态。 *[52poke]*

Signature traits
- A **continuous stream** of flame from the mouth, widening slightly with distance. *[familiar — check the GIF]*
- In the anime often a thick orange stream with a twisting/spiral core. *[familiar]*

Reference game: flame particles along the cone, growing with √(area/7); occasional smoke and
small dark puffs near the end.

Sim: cone length 2.3, half-angle 0.55 rad, life 1.1 s, ticks 0.2 s, follows the player.

Keep: a stream that starts narrow at the mouth and fans to the hitbox edge. Avoid: particles
growing far past the fan (the old 3.6× grow overshot the far edge; now 2.6×), a bright ground fill.
