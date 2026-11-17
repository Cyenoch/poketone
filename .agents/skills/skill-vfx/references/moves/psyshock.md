# 精神冲击 · psyshock

- Source: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Psyshock_(move)). Materialized psychic energy [familiar — check the GIF].
- Keep: sharp pink crystals and straight refracted links. Avoid electric zigzags and forked lightning.
- Sim: `chain` event only, first acquisition range 10; count 4 means up to five struck targets (`count + 1`), subsequent jumps use the move's .3 area plus normal upgrade scaling. No projectile/area exists to register.
- Recipe: `Vfx.handle` routes psychic chain events to `psychic.ts`; all actual event points are linked at once, gems at hit targets, 220 ms shrink/decay. No travel delay or invented target. No new resources or per-frame arrays.
- Reference game animation uninspected; event geometry and cleanup tests are separate from visual review.
