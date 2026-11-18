# 念力 · confusion

- Source: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Confusion_(move)). Psychic force; pink light and a trembling target silhouette [familiar — check the GIF]. No source animation was captured.
- Keep: small thought-light flakes, directional tails, a quick crystal contact. Avoid enemy violet and large glowing spheres.
- Sim: `barrage`, two r .22 shots, speed 16, life 1.1, pierce 1; fan and stagger from `BARRAGE`. Follow interpolated projectile XYZ, including slope pitch.
- Recipe: `psychic.ts` confusion; 120 ms cast star, sharp gem head, ≤ .65 m faint trail, 180 ms contact motes, shrinking expiry. No ground fill or new GPU resources. Upgrades use actual shot radius/velocity/count.
- Reference game animation has not been inspected; the project's shared barrage lifecycle is the implementation reference. Screen/crowd budgets require real-game inspection, not these notes.
