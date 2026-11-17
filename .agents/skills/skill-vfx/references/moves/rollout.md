# 滚动 · rollout

- Source: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Rollout_(move)). Repeated rolling body attacks [familiar — check the GIF]. The project deliberately rolls rocks without moving the avatar.
- Keep: tumbling grey-brown stone, low dust, clear forward travel. Avoid a giant sphere implying a deeper circular hitbox.
- Sim: `wave`, half-width 1.2, half-depth `WAVE.depth` .5, speed 8, life 1.1. Ground riding and occlusion remain simulated.
- Recipe: `rock.ts`; 3–9 small boulders span the full moving band, velocity controls spin, terrain controls height, final 120 ms shrinks. Ground lane and low dust share existing pools; no resources added. Width controls row coverage; count creates separate waves.
- Reference game animation uninspected; frame images must show both band edges and unchanged player position.
