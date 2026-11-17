# 幻象光线 · psybeam

- Source: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Psybeam_(move)). A peculiar ray; prismatic/rainbow spiral [familiar — check the GIF].
- Keep: dominant pink core with thin pale mint/lemon helical strands; avoid cyan blobs and saturated purple fills.
- Sim: `beam`, .3 s delay + .8 s active; full width .6, reach 17 clipped by cover, tick .15. Reads `rise`, direction and interpolated owner position.
- Recipe: `psychic.ts`; narrow aim ray and converging crystal during charge, 120 ms muzzle peak, full clipped lane when active, 150 ms collapse. Three ribbons in the existing batch; no new materials/textures. Area widens the lane, duration holds it, count creates independent lanes.
- Reference game animation uninspected; crowd/readability checks remain separate from geometry tests.
