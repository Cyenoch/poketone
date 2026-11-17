# 落石 · rock-throw

- Source: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Rock_Throw_(move)). Throws a rock at the target [familiar — check the GIF].
- Keep: tumbling angular stone, ballistic arc, fragments and low dust on impact. No hot glow.
- Sim: `lob`, nominal flight .75 s, gravity 22, shell r .25, explosion r1.2. It does not hit bodies in flight; terrain/props may end it early. Draw actual XYZ, not a second predicted arc.
- Recipe: `rock.ts`; tiny cast dust, seeded faceted head, small shadow/trail, full explosion edge on burst event, 280 ms debris and .65 s rimless cracks. All resources reused. Count creates shells; area changes only the burst, not shell size.
- Reference game animation uninspected; impact and terrain clipping need actual sim captures.
