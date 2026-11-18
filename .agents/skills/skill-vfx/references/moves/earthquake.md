# 地震 · earthquake

- Source: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Earthquake_(move)). Powerful ground shaking [familiar — check the GIF].
- Keep: wide earth fractures, small raised stones and low dust. No travelling damage ring: damage is instantaneous across the disc.
- Sim: `nova`, r5, one instant hit, .3 s visual life. Geometry follows actual area, not the base number.
- Recipe: `rock.ts`; complete boundary on the first frame, stones in two staggered rings (≈ 3.6 × radius, ≤ .36 m) for radius > 3 (move quakes only; ultimate quakes keep 9), fragments move inside it, 280 ms impact and .65 s desaturated rimless cracks. Generic hit reactions provide hitstop/knockback; no new camera effect. No new resources.
- Reference game animation uninspected; +area and danger-overlap inspection remain necessary.
