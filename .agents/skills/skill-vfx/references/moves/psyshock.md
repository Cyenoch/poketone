# 精神冲击 · psyshock

- Source: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Psyshock_(move)). Materialized psychic energy [familiar — check the GIF].
- Keep: sharp pink crystals and straight refracted links. Avoid electric zigzags and forked lightning.
- Sim: `chain` event only, first acquisition range 10; count 4 means up to five struck targets (`count + 1`), subsequent jumps use the move's 3.3 m centre-to-centre range plus normal upgrade scaling. No projectile/area exists to register.
- Recipe: `Vfx.handle` routes psychic chain events to `psychic.ts`; a cast flash, then one echo that walks the actual event points hop by hop (35 ms per hop, view-only; damage already landed): a glow + solid core ribbon grows to the moving head with a shard on it, each landing flashes, stamps a pink ring and throws 4 crystal gems; everything lingers 200 ms. No invented target. No new resources or per-frame arrays.
- Reference game animation uninspected; event geometry and cleanup tests are separate from visual review.
