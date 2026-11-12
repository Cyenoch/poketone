# 日光束 Solar Beam (`solar-beam`) — grass · beam · big

- 52poke: <https://wiki.52poke.com/wiki/日光束> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Solar_Beam_(move)>
- Description: 第１回合收集满满的日光，第２回合发射光束进行攻击。 *[52poke]*

Signature traits
- A **charge**: the user absorbs sunlight first ("…吸收了光！"). *[52poke]*
- Then a single straight **beam** of bright yellow-white / golden light. *[familiar — check the GIF]*

Reference game: beam in lime green with a sun-yellow core at 1.2× width; twinkles and the odd
leaf along the beam; cast = ten sun twinkles burst above the caster.

Sim: beam, half-width 0.275 (area 0.55 / 2), reach 17 m clipped by terrain, pitched by `rise`,
delay 0.3 s, life dur + 0.3 = 1.2 s, ticks 0.15 s, follows the player.

Keep: visible light gathering during the 0.3 s charge, straight hot core, gold halo. Avoid: halo
and ground strip far wider than the half-width, and a mouth glow bigger than the caster (both
fixed 2026-11-04: strip 1.3× radius, glow ≈ 0.75 m).
