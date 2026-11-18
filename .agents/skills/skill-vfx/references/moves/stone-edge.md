# 尖石攻击 · stone-edge

- Source: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Stone_Edge_(move)). Sharp stones stab the opponent [familiar — check the GIF].
- Keep: angular upward rock points in a fan, two shaded faces and abrupt settling. Avoid slicing light or sparks.
- Sim: `strike`, length 3.5, half-angle 1.2, .22 s swing; extra count alternates front/back at .12 s staggers. Read each area's direction/delay rather than facing the current player heading.
- Recipe: `rock.ts`; outer fan arc and two rows of solid tapered pillars, .85/1.4 m tall and up to .34 m wide so they read at the 3.5 m reach, final 120 ms shrink. Uses existing ribbon batch; no geometry/material allocation. Count/duration do not inflate the pillars.
- Reference game animation uninspected; alternating direction and stagger need visual playback.
