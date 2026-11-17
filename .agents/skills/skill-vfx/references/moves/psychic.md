# 精神强念 · psychic

- Source: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Psychic_(move)). Powerful telekinetic force; compression and release [familiar — check the GIF].
- Keep: tightening pink rings at the target, then an outward crystal wave. Avoid lightning, enemy purple and petals.
- Sim: `smite`, two target discs r1.6, .45 s delay then .25 s linger. A tick consuming delay returns before damage; the VFX impact waits for the actual attack tick.
- Recipe: `psychic.ts`; full pale ground boundary while inner ring compresses, impact exposes the complete damage radius immediately, ≤70 ms hot core, 280 ms shrinking crystal residue. No new resources. Count/area use separate live areas/radii.
- Reference game animation uninspected; timing tests do not establish visual acceptance.
