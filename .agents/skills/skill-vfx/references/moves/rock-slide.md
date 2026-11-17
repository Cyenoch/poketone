# 岩崩 · rock-slide

- Source: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Rock_Slide_(move)). Large boulders fall onto targets [familiar — check the GIF].
- Keep: multiple irregular falling rocks, weight at contact, ground debris. No electric sky bolt.
- Sim: `smite`, three r1.2 target discs, .55 s delay + .25 s linger. The last .22 s of the windup accelerates the stones downward; impact waits for the actual damage tick.
- Recipe: `rock.ts`; solid pale footprint, three rocks inside each target radius, 280 ms fragment shock, .65 s rimless residue. Stone size capped independently of upgrades; radius/count use the sim areas. No new resources.
- Reference game animation uninspected; still frames alone cannot certify falling timing.
