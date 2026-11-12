# Building effects in poketone

How move effects are made in `src/run/view/vfx.ts` and `src/run/view/vfx/**`. Re-read the files
before editing; this describes the structure as of 2026-11-04.

## Architecture

`Vfx` (`vfx.ts`) **reads world state and never writes it**. `createRunView.ts` calls
`vfx.handle(event)` for each `RunEvent` and `vfx.update(world, alpha, dt)` once per rendered
frame; `alpha` interpolates sim positions (`px → x`, `py → y`), `dt` is the (hit-stop scaled)
frame time, 0 while frozen.

Recipes are plain objects per move, kept in one file per element (`fire.ts`, `water.ts`,
`grass.ts`, `electric.ts`; shared hit/death/hazard looks in `common.ts`), registered in maps in
`vfx.ts`:

```ts
// fx.ts
interface ShotLook {            // projectiles (bolt, barrage, orb heads)
  launch?(fx, x, y, z): void;   // first frame, at the caster's chest — the cast beat
  fly(fx, shot, x, y, z): void; // every frame while the projectile lives
  hit?(fx, x, y, z): void;      // each pierced target, a stopping target, or the terrain
  fade?(fx, x, y, z): void;     // ran out of range
}
interface AreaLook {            // areas (cone, beam, vortex, spin, strike, smite, burst)
  live?(fx, area, x, z, charge): void; // every frame; charge 0 → 1 over area.delay, then 1
  strike?(fx, area, x, z): void;        // first damaging frame
}
const shotLooks: Partial<Record<MoveId, ShotLook>>;
const areaLooks: Partial<Record<MoveId, AreaLook>>;
const burstLooks: Partial<Record<MoveId, AreaLook>>; // `burst` areas left by orbs / vortices
```

A move missing from these tables falls back to `vfx/defaults.ts`: a default per archetype (shots)
or area kind (areas), tinted by the move's element. It keeps new content visible; it is not a
finished look.

Effects with no sim object behind them (chains, lashes, sky bolts, crackles) are **echoes**:
`fx.echoes.add(draw, life, x, y, z, a, b, c, points)` — `draw(fx, echo, t)` runs every frame
with `t` 0 → 1. Use the numeric slots `a/b/c` for direction/reach/etc.; no closures per event.

## Primitives (one draw call each)

| Primitive | File | Use for | API |
| --- | --- | --- | --- |
| `fx.sprites` | `sprites.ts` | billboards: heads, flashes, sparks, smoke, leaves, bubbles | `emit(spec, x,y,z, vx,vy,vz, size, floor)` simulated particle; `draw(spec, x,y,z, size, alpha, vx, vz, spin, seed)` one-frame sprite |
| `fx.decals` | `decals.ts` | ground shapes that hug terrain: hitbox fills, rings, light pools, residue | `put(shape, x, z, radius, yaw, seed).rect().tint(a, alpha, b, add).args(t, p2, p3)` per frame; `stamp(...)` self-ageing |
| `fx.danger` | `decals.ts` | **enemy** telegraphs only; drawn over every player effect | same as decals |
| `fx.ribbons` | `ribbons.ts` | camera-facing strips: lightning (`bolt`), vines, smears, halos | `point(...)` × n then `flush(style, add)`; `bolt(a, b, seed, width, colour, alpha, forks)` |
| `fx.volumes.*` | `volumes.ts` | 3D shader bodies: `orbs` (24), `funnels` (16), `beams` (24), `whirls` (4) | `add(place(x,y,z,yaw,sx,sy,sz,pitch), a, fade, b, style, seed)`; `beamBody(area, …)` for pitched beams |

Shapes are procedural in the fragment shaders (no textures):

- Sprite `Shape`: glow, flame, spark, star, puff (inked smoke), drop, bubble, leaf, ring, shard,
  ball, crescent, cloud (soft). `SpriteSpec` = shape, life (±25 %), grow, from → to colour,
  accent, alpha, add (0 alpha … 1 additive), gravity, drag, stretch (velocity smear; negative =
  align only), spin. Build with `sprite({...})` at module scope — never per frame.
- `Decal`: ring, glow, scorch, sector (fan; style 0 heat, 1 powder), telegraph (player strike
  warning), danger (enemy lane), swirl, cracks, blast (Fire Blast 大), strip (beam lane; style 0
  sun, 1 water, 2 aim line), ripple, whirl. Shapes work in units of `radius` so they scale with
  upgrades. `t` is progress 0..1 (stamps compute it from age/life).
- Ground shapes never orient from the camera or the player per frame: a stamp's yaw is fixed when it
  lands (`stamp(..., yaw)`; random by default). Shapes meant to read upright (the 大) take
  `fx.viewYaw + π` once, at impact — re-facing the camera every frame made the scorch turn as the
  player walked.
- `Ribbon`: bolt, vine, streak (smear), solid (ink backing), glow.
- Volume shaders: `ORB` (style 0 fire boil, 1 electric crackle), `FUNNEL` (fire tornado),
  `BEAM` (0 sun core, 1 sun halo, 2 water torrent, 3 spray shell), `WHIRL` (wind wall).

Colour: premultiplied output via `layer(c, a, add)` and `over(top, base)` (`gl.ts`); colours are
display-space sRGB tokens from `palette.ts` (`rgb("#…")`). `add` lets hot cores and inked smoke
share one draw call.

Render order (set in `Vfx` constructor): decals → volumes → ribbons → sprites → danger.

## Reading sim state

| Sim | Fields worth knowing | View hooks |
| --- | --- | --- |
| `Projectile` | `x/y/z` + `px/py/pz` (3D, interpolate), `vx/vy/vz`, `radius` (orb head 0.6; else `area`), `area` (burst radius for orbs), `life`, `hit[]`, `delay` (>0 = staggered, not drawn), `pierce` | `launch` on first sight; `hit` when `hit.length` grows; on disappearance `endShot` guesses hit vs fade; `impact` event when it meets terrain |
| `Area` | `kind`, `move`, `x/z` (follow areas ride the owner — use the passed `x, z`), `dirX/dirZ`, `radius`, `length`, `rise` (beam pitch), `angle` (half-angle), `life/maxLife`, `delay`, `follow` | `live` every frame with `charge`; `strike` once |
| `Hazard` | `kind` spore / slash / dash-warn, `x/y/z`, `vx/vy/vz`, `radius`, `dirX/dirZ`, `length`, `life` | `updateHazards` → `common.*Hazard` into `fx.danger` |
| Events | `hit` (x, z, crit), `death`, `reaction` (感电 / 蒸汽 / 蔓延燃烧), `chain` (points), `impact` (shot/hazard into terrain), `dash`, `level`, `player-hit`, `cast` (unused by Vfx today) | `Vfx.handle` |

Move numbers (after the 2026-11 size reductions) live in `src/run/sim/content/moves.ts`; how each archetype
builds its areas (delays, lives, half-angles, beam reach 17 m clipped by terrain, burst lives
0.3 s, vortex pull 2 × radius and collapse ×1.8 damage) is in the archetype modules `src/run/sim/archetypes/<archetype>.ts` (constants such as `VORTEX`, `BEAM`, `LOB`; area shapes and terrain rules in `areaRules`, `archetypes/index.ts`).

Heights: `fx.ground.heightAt(x, z)` on the CPU; `terrainHeight(xz)` in shaders via
`TERRAIN_GLSL` (`terrain.ts`). Decals and conformed volumes hug the terrain automatically.
`CHEST` (`sim/sight.ts`, 0.7) is the cast height above the ground.

## Recipe pattern

```ts
// vfx/<element>.ts — specs at module scope, reused every frame.
const puff = sprite({ shape: Shape.puff, life: 0.5, grow: 1.6, from: fire.ash, to: fire.smoke,
  accent: fire.smoke, gravity: -1.5, drag: 2 });

export const myMove: AreaLook = {
  live(fx, area, x, z, charge) {
    if (area.delay > 0) {          // 准备: aim line + converging motes, charge 0 → 1
      fx.decals.put(Decal.strip, x, z, area.length, yaw).rect(-0.3, 0, 0.3, area.length)
        .tint(colour, 0.7 * charge, white, 1).args(0, 0.3, 2);
      return;
    }
    const fade = Math.min(1, area.life / 0.2);   // 消散 over the last 0.2 s
    // 持续: primary shape at the hitbox, secondary particles via perFrame(fx, rate * fade)
  },
  strike(fx, area, x, z) {          // 命中: flash + ring at area.radius + debris; 残留 stamp
    fx.decals.stamp(Decal.scorch, x, z, area.radius * 0.8, 1.5, fire.soot, 0.7, fire.orange, 0);
  },
};
// vfx.ts: register in areaLooks / shotLooks / burstLooks.
```

Helpers in `fx.ts`: `perFrame(fx, perSecond)` (rate → count this frame),
`spray(fx, spec, x,y,z, n, speed, lift, size)` (radial burst, stops at ground),
`reach(distance, life, drag)` (launch speed to coast a distance), `flicker(fx, seed, rate)`
(stepped re-roll), `seedOf(id)` (stable per-object seed), `rand`.

## Hit reaction and residue integration

- Enemy flash (0.12 s), jitter and squash: `createRunView.ts` (`HIT_FLASH_SECONDS`, `HIT_JITTER`),
  driven by `enemy.flash` set in `sim/combat.ts`. Status tints are instance colours there too.
- Damage numbers and hit-stop: `createRun.ts` (`createDamageNumbers`, `hitStop`).
- Generic contact flash / crit: `common.hit` (on every `hit` event; thins out above 80 % pool).
- Move-specific contact: `ShotLook.hit` / `AreaLook.strike` / burst looks.
- Residue: `fx.decals.stamp(...)` — capped at half the decal capacity (80 of 160); `fx.danger`
  is a separate 64-slot layer. Particles that settle use `emit(..., floor)` so they rest on the
  ground and die with their life.
- Cleanup is structural: tracks are swept when sim objects vanish; stamps and particles age out.

## Screen budget

Camera (`createRunView.ts`): vertical FOV 42°, 12.5 m up and 11.5 m back (≈ 17 m to the
player, ≈ 46° pitch). At the player's distance the view is ≈ 13 m tall × 23 m wide (16:9),
so **≈ 55 px per metre at 720p** (≈ 83 px/m at 1080p), and the visible ground is roughly
23 m × 18 m (perspective makes the far half larger). Pokémon are ≈ 1 m tall.

[project] budgets per instance, measured as the effect's screen footprint excluding the ground
decal's faint fill:

| Tier | Steady state | Peak (≤ 0.3 s) | Height |
| --- | --- | --- | --- |
| Basic | ≤ 1 % of screen (≈ 0.3 m head + short trail) | ≤ 2 % | ≤ 1.2 m |
| Mid | ≤ 3 % | ≤ 5 % | ≤ 1.6 m |
| Big | ≤ 5 % | ≤ 8 % | ≤ 2 m (sky strikes excepted, thin) |

Spill beyond the hitbox ≤ 15 % of its radius. Reference: Fire Spin at radius 1.2 m is a 2.4 m
disc ≈ 10 % of the screen width; at 2.4 m its 2.9 m tall opaque funnel covered ≈ 4–5 % of the
screen and hid every enemy behind it (now ≈ 0.7 m and see-through; hit areas and visuals were
both halved again on 2026-11-04 after「至少减少 50%」feedback). Ground decals cost less attention than tall bodies but still
count when bright or opaque.

## Performance budget

- **Draw calls**: VFX is a fixed set — decals, danger, 4 volume meshes, ribbons, sprites, 3 pickup
  meshes; each hides itself when empty. Adding a recipe must not add a draw call; adding a new
  *primitive* needs a reason in the design template.
- **Capacities**: sprites 2800 particles + 600 immediate; decals 160
  (stamps ≤ 80); danger 64; ribbons 6000 vertices (`MAX_POINTS` 96 per strip); orbs 24,
  funnels 16, beams 24, whirls 4; echoes 64. When full, new items are dropped silently — so
  budget per instance: rate × life × max simultaneous instances (count upgrades!) must fit.
- **Fill-rate**: big transparent quads are the real cost (each sprite is a quad; additive layers
  overlap). Prefer a few small shapes over many large soft ones; short lives.
- **No per-frame allocations**: specs at module scope; no closures/arrays/objects in `fly`/`live`
  /echo draws (`stamp` allocates one small object per event — acceptable). Use the scratch
  matrices in `volumes.ts` via `place`.
- **Uploads**: buffers upload only the used range (`uploadRange`).
- **Measure** in a crowded boss scene (`time = 520`, many enemies, the moves under test at a few
  levels): `renderer.info.render.calls/triangles` (the debug overlay in `createRun.ts` prints
  `draw … tris …`), frame time under 6× CPU throttle in DevTools, and sprite pool load
  (`fx.sprites.load`). Compare before/after on the same seed; report variance.

## Disposal

Everything GPU-side is created in the `Vfx` constructor or a primitive's constructor and freed in
`Vfx.dispose` (geometries, materials, instanced meshes). A new primitive or material adds its
`dispose()` and a call in `Vfx.dispose`. Recipes own no GPU resources.

## Verification in the browser

`npx vite --port 5187 --strictPort` (background) → 「开始冒险」→「出发」. In the console:
`const w = window.__poketoneWorld; w.players[0].hp = 99999; w.players[0].xpNext = 1e9;` give
moves by pushing `{ id, level: 1, cooldown: 0, damage: 0, mods: { dmg: 0, cd: 1, count: 0,
area: 0, speed: 0, dur: 0, pierce: 0, crit: 0, status: 0 } }` into `w.players[0].moves`
(`mods.area: 1` doubles the area); `w.time = 520` brings the boss. Use your own browser tab;
effects are fast, so take bursts of screenshots or a screencast and look at each phase.
