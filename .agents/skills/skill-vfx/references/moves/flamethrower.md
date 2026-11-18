# 喷射火焰 Flamethrower (`flamethrower`) — fire · cone · mid

- 52poke: <https://wiki.52poke.com/wiki/喷射火焰> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Flamethrower_(move)>
- Description: 向对手发射烈焰进行攻击。有时会让对手陷入灼伤状态。 *[52poke]*

Signature traits
- A **continuous stream** of flame from the mouth, widening slightly with distance. *[familiar — check the GIF]*
- In the anime often a thick orange stream with a twisting/spiral core. *[familiar]*

Reference game: flame particles along the cone, growing with √(area/7); occasional smoke and
small dark puffs near the end.

Sim: cone length 4.5, half-angle 0.55 rad, life 1.1 s, ticks 0.2 s, follows the player and turns each sim step toward the nearest aimable target; keep the last heading when none is in range.

Recipe (`fire.ts` `flamethrower.live`): one fire-jet beam volume (BEAM style 4: banded cartoon noise, white-hot core, orange body, dark-red ink edge) from the mouth (`Mouth` passed in by `vfx.ts`) to `area.length`, half-width `length·sin(CONE.angle)` so it fills the hitbox wedge; yaw is smoothed per area so the sim's per-tick re-aim doesn't snap. 0.09 s grow-in; over the last 0.2 s the jet detaches from the mouth and erodes (volume `erode` param) instead of fading to a pale sheet. Plus flame tongues across the wedge, tip smoke, embers, a faint sector ground light; `strike` adds a mouth bloom and spray. Hits get the fire-tinted shared hit flash.

Keep: a stream that starts narrow at the mouth and fans to the hitbox edge. Avoid: an opaque white fill (v1), a translucent gel sheet (v2), uniform alpha fade at the end.
