# VFX craft: phases, readability, stylisation

Distilled from the sources in `sources.md`. Statements marked **[src]** come from a named source;
**[project]** marks a rule we derived for poketone's camera, art style and genre (survivor-like,
200+ enemies, bright meadow ground, top-down ~46° camera). Numbers marked [project] are
starting points to tune by eye, not laws.

## 1. Gameplay first: primary vs secondary elements

- **[src Riot style guide]** Every effect has *primary* elements — the focal point, the spell's
  purpose, communicating gameplay "clear and accurately" — and *secondary* elements that carry
  theme. Primary: high value range, strong contrast, clear silhouette, high opacity, strong
  shape, intense movement. Secondary: lower value, blurry silhouette, simple shape, small size,
  low opacity, subtle movement.
- **[src Riot]** Represent the area of effect accurately: Teemo's old mushroom explosion only
  covered half its real radius; Sona's old ultimate looked wider than its hitbox and "connected"
  with targets it missed. Show areas at ground level so the camera angle doesn't shift them.
- **[src Riot clarity post]** "The amount of attention an ability grabs should match its level of
  importance" — damage, hard CC, dodgeability, impact on play. A huge ground circle implies more
  dodgeability than is real. Projectiles convey direction "even without motion" (blurred tail).
  Noise is kept minimal; only spells with large gameplay effects may be noisy, "to a degree".
- **[src Riot VFX updates]** Fixing inaccurate hitbox indicators always outranks theme:
  "gameplay readability will always prevail over thematic resonance."
- **[project]** In a survivor-like nothing is dodged by the *enemy*, so player effects never need
  to warn; their job is to show **coverage and payoff** while the player reads *enemy* threats.
  That makes player effects secondary to enemy telegraphs at all times.

## 2. Scale of importance

**[src Riot]** Importance is controlled by size, shape, timing, value, saturation and opacity,
on a ladder: idle particle (low opacity, blurry, subtle) → basic attack (small, low opacity) →
defensive (low saturation, clear silhouette) → damage spell (high saturation, high opacity,
high value) → game changer → ultimate (highest saturation/opacity/value, large, impactful
animation). A basic attack as loud as an ultimate confuses players and makes the ultimate less
satisfying.

**[project] poketone tiers** (pair with `docs/GAME-FEEL.md` feedback tiers):

| Tier | Moves (cd) | Peak loudness | Sustain loudness |
| --- | --- | --- | --- |
| Basic (cd < 1.5 s) | Ember, Water Gun, Thunder Shock, Vine Whip, Razor Leaf, Bubble | small flash ≤ 0.6 m | flight only, no ground layer |
| Mid (1.5–3 s) | Electro Ball, Thunderbolt, Flamethrower | flash ≤ hitbox | modest, mid-value |
| Big (≥ 3 s) | Fire Blast, Fire Spin, Thunder, Solar Beam, Hydro Pump, Rapid Spin, Sleep Powder | full hitbox for ≤ 0.3 s | mid-value, fading |

## 3. Phase structure

Classic model **[src Riot timing guideline]**: "all effects should have anticipation and
dissipation"; outros are a *secondary* effect "with a lower value, saturation, and opacity";
fading energy is expressed by changing value, hue, saturation, opacity *or size*. Gangplank's
barrel shows anticipation → main explosion → dissipation. **[src VFX Apprentice / Keyser]**:
wind-up → climax ("pop") → fall-off, with *impulse* effects (instant, or crescendo with a
wind-up) and *rhythm* effects (looping/flowing, or disruptive). A fireball is
rhythm (build-up) → impulse (cast) → rhythm (travel) → impulse (hit). Peak value/saturation
inside the first quarter of the impact's life **[src VFX Apprentice summary of Riot guide]**.
Linear timing is "a less interesting moment" (Ekko R vs linear cast) **[src Riot]**.

poketone uses seven phases. Not every move has all of them, but each move must account for each.

### 3.1 Preparation / charge — 准备

- **Communicates**: where and when it will hit, and that it is *the player's* (not an enemy's).
- **Exists when** the sim has a delay: beams `delay 0.3`, Thunder `delay = dur (0.55)`, Fire Spin
  `delay 0.25`, Vine Whip's second lash `delay 0.12`. Projectiles have no charge (a `delay > 0`
  projectile is a stagger and is not drawn yet). The sim also emits a `cast` event (currently
  unused by `Vfx`) that could drive a caster-side gather.
- **Look**: energy converging inward (particles travel *to* the mouth/target; Hydro Pump's
  swirling gather, Solar Beam's light motes), a core that grows, value rising toward the release.
  Ease-in (accelerating). A thin *aim line* in element colour is fine; a filled lane or ring is
  not (that is enemy language).
- **Charge must finish exactly at the first damaging frame**; `charge` (0 → 1) in `AreaLook.live`
  is computed from the area's own delay for this reason.
- **[src Gamedeveloper telegraphing]** charge-up reads as: particles gather, a "reverse-vacuum"
  sound, a bright flash, then release.

### 3.2 Cast / startup — 施放

- **Communicates**: "fired", from the caster's mouth/chest, in which direction.
- 50–120 ms. A small star/flash ≤ 0.5–0.6 m, a few particles thrown *forward*. Pop easing.
- **[src Art of Screenshake]** muzzle flash "accentuates doing x with flourishes"; bigger,
  slightly exaggerated bullets read better than realistic ones.

### 3.3 Active / travel / sustain — 飞行 / 持续

- **Projectiles**: brightest, sharpest contrast at the **leading edge**; tail stretched along
  velocity (motion-blur shape) so direction reads in a still frame **[src Riot shapes]**. Fast
  particles without blur read as noise and frame drops **[src Riot]**. Head size ≈ hitbox.
- **Sustained areas** (cone, beam, vortex, spin): a steady *rhythm* loop at mid value. The rim or
  edge is the primary element (Leona's W: "the border … players must be able to easily identify
  the radius") **[src Riot]**; inner noise is secondary.
- Keep the body mid-value and partly transparent; reserve the hottest white for the impact.

### 3.4 Impact — 命中

- **Communicates**: it connected; how big the affected area is.
- Peak in 1–3 frames (16–50 ms at 60 fps), then expo-out over 150–300 ms. The shape of the
  impact *is* the area: a burst ring at the burst radius, not beyond.
- **[src Riot value]** push value to the centre of the effect (Ziggs' bomb): a visual centre
  shows where it hurts most. **[src Art of Screenshake]** impact effects: show what happens
  instead of letting things vanish; "bigger explosions" — but in a 200-enemy survivor-like,
  exaggerate *briefly*.
- Layer order of an impact: (1) 1–2 frame flash (star/glow) at the core, (2) shape (ring /
  decal / radial arcs) at the hitbox, (3) debris/sparks thrown out with drag, (4) smoke or mist
  that settles, (5) residue stamp.

### 3.5 Hit reaction on the target — 受击

Already a system in this repo; effects must cooperate, not duplicate:

| Feedback | Where | Rule for move effects |
| --- | --- | --- |
| White flash 0.12 s (`enemy.flash`), sideways jitter + squash (Sakurai) | `createRunView.ts` (`HIT_FLASH_SECONDS`, `HIT_JITTER`) | Don't add another per-target white flash for area ticks |
| Status tint (sleep blue, paralysis yellow, burn orange, wet blue) | `createRunView.ts` instance colour | Status is shown by tint, not per-enemy particles |
| Damage numbers (≤ 5 new per frame, crits exempt) | `createRun.ts` `createDamageNumbers` | Numbers pop with the hit event; impact peak should coincide |
| Hit-stop | `createRun.ts` `hitStop` (player hurt, elite deaths) | Effects keep animating with the slowed dt |
| Generic contact flash / crit star | `vfx/common.ts` `hit` (skips when sprite pool > 80 %) | Move `hit()` adds only a small element spark on discrete hits |
| Death poof | `vfx/common.ts` `death` | — |

- **[src Sakurai / Source Gaming]** both sides freeze for the same time; duration rises with
  damage; projectiles get less hit-stop; electric hits get more; the victim shakes, grounded
  side-to-side, and the shake starts large and shrinks; shake is larger when the camera is far.
- **[project]** a move's `hit()` spark is ≤ 0.3–0.4 m and ≤ 0.3 s; area ticks that hit dozens
  of enemies rely on the generic flash only.

### 3.6 Residue / lingering marks — 残留

- **Communicates**: what just happened here; *harmless now*.
- Scorch (fire), cracks (thunder), ripples/wet sheen (water), shredded leaves (grass), dust.
  **[src Riot]** outros are secondary: lower value, saturation and opacity. **[src Art of
  Screenshake]** permanence makes the world remember the action — but **[src Riot]** "if your FX
  feel long, they're way too long": lingering layers hide enemies and cost overdraw.
- **[project]** residue is dark/desaturated, rimless and never red/purple (must not look like an
  enemy zone or a still-active damage area). Frequent moves ≤ 1.5 s, big moves ≤ 3.5 s, fading
  with ease-in (slow start, faster end) or eroding. Stamps share one capped pool
  (`Decals.stamp`, half of capacity); under pressure the newest wins nothing — budget them.
- **Cleanup**: stamps age themselves out; live layers vanish when the sim object is gone (tracks
  are swept each frame). Nothing persists beyond its life — no manual cleanup code should exist.

### 3.7 End / dissipation — 消散

- **Communicates**: it is over; the area is safe.
- 100–250 ms. Shrink, erode (noise threshold eats the shape), drop value toward the residue
  colour, or break into a few particles. Avoid uniform linear alpha fade of a big shape (reads
  as "still there, fainter" and is the most overdraw-expensive way to end).
- Projectiles: `fade()` (ran out of range) is quieter than `hit()` — a puff, a falling leaf.

## 4. Timing by archetype

Frame counts at 60 fps; the sim ticks at 30 Hz (33 ms) so sim-driven moments land on 2-frame
boundaries.

| Archetype (moves) | Prep | Cast | Active | Impact | Residue | End |
| --- | --- | --- | --- | --- | --- | --- |
| bolt (Ember, Water Gun, Thunder Shock) | — | 3–6 f flash at mouth | flight ≤ dur (0.75–0.9 s) | 6–12 f per hit | ≤ 1 s, small | `fade` puff 6–10 f |
| barrage (Razor Leaf, Bubble) | — | per shot, tiny (staggered 70 ms) | flight | tiny, per hit | none or leaves falling | quiet |
| orb (Fire Blast, Electro Ball) | — | 6 f | flight, heavy head | burst `life 0.3`: flash 2 f, shape 0.3 s | scorch / glow ≤ 3.5 s | erode |
| cone (Flamethrower, Sleep Powder) | — | mouth flash | sustain = dur (1.1–1.4 s), follows player | per tick generic | thin wisps | 0.25–0.35 s tail-off |
| beam (Solar Beam, Hydro Pump) | 0.3 s gather + aim line | 2–4 f burst at mouth | dur 0.7–0.9 s | splash/flash at mouth and end | short ground mark | width collapses 0.15 s |
| vortex (Fire Spin) | 0.25 s swirl-in | — | dur 2.4 s, pulls | collapse burst 0.3 s | scorch | burst is the end |
| spin (Rapid Spin) | — | 6 f | dur 1.6 s around player | per tick generic | dust | 0.25 s |
| strike / melee arc (Vine Whip) | stagger 0.12 s | — | swing ≤ 0.22 s, smear | tip spark | leaves | ≤ 0.1 s |
| chain (Thunderbolt) | — | caster spark | instant links 0.3 s | per target | — | flicker out |
| smite / sky strike (Thunder) | delay 0.55 s ground telegraph | — | 2–4 f bolt | flash + cracks | cracks 2–2.5 s | bolt fades 0.2 s |
| buff / aura (future) | — | 0.2 s ring | low, rim only, no fill | — | — | 0.2 s |
| enemy telegraph (dash-warn, spore, slash) | whole wind-up, fill toward the release | — | hazard flight | — | — | instant on release |

**[src VFX Apprentice]** tempo faster than a heartbeat reads aggressive, slower reads calm:
attack pulses > 60 BPM, sleep/heal pulses < 60 BPM (Sleep Powder's drift should be slow).

**Easing per phase** (see `game-feel/references/feedback-recipes.md`): prep = ease-in /
accelerating; cast & impact = expo/quad-out ("pop"), optional overshoot on rings; sustain =
loop with no easing; residue = hold then ease-in fade; end = quad-in shrink. Never linear for
anything the eye follows.

## 5. Readability toolkit

### Shape (silhouette first)

- **[src Riot]** simple, well-defined silhouettes with a wide enough value range to make a focal
  point; mixed soft and sharp shapes; no photographic or "superfluous" detail.
- Test: greyscale screenshot at game distance — can you name the move and point at its hitbox?
- Shape language: circles/rings = area; fans = cone; lanes = beams/dashes; spikes/stars = impact;
  crescents = slashes; spirals = vortex/pull; zig-zags = electric. Enemy shapes: chevrons, dashed
  rims, pulses.

### Value and contrast

- **[src Riot]** higher value range draws more focus; avoid 0 %/100 % values (confused with UI
  and environment); push value to the centre; a dark backing can boost focus but overuse makes it
  fight other effects.
- **[project]** our ground is bright meadow green: additive white over it blows out and loses hue.
  Bodies are alpha-blended inked shapes (the premultiplied `add` mix in `gl.ts`); only small hot
  cores are additive. A thin ink rim (`INK` in `FX_GLSL`) gives value separation without size.

### Colour

- **[src Riot]** VFX get a wider/higher saturation range than characters and environment; prefer
  analogous colours; with complementary pairs one must be secondary — desaturated, low opacity
  (Bard's Q vs Lulu's noisy shield). Conventions: heal green, frost blue, gunpowder orange-red.
- **poketone element language [project]** (tokens in `vfx/palette.ts`):

| Element | Dominant | Accent | Avoid |
| --- | --- | --- | --- |
| Fire | orange → yellow core | deep-red ink rim (thin) | red fills/rings (enemy), purple |
| Water | mid/deep blue + white foam | light blue sheen | saturated cyan blobs near ground (candy) |
| Grass | leaf green, lime | sun gold, white | purple; red |
| Powder (sleep) | pale, desaturated pastel cloud | white sparkle | saturated purple (enemy spores) |
| Electric | yellow / white | gold; cyan only as a tiny accent | large cyan areas (candy) |
| Normal / wind | cream, white | dust beige | — |
| Enemy danger | red `#ff2b3d`, deep red, pale | chevrons, dashed rims, pulse | — |
| Enemy poison | saturated purple + dark ink | light lilac | — |
| XP candy | cyan-blue octahedron `#59c8ff` | — | anything else looking like it |

### Movement

- **[src Riot]** blur along the path, or make the leading edge the brightest/sharpest with dark
  low-frequency values behind it so the shape "pulls forward".
- **[src VFX Apprentice]** contrast fast elements with slow ones; one element grows while another
  shrinks; every element has a distinct role.

## 6. Layering

Typical stack, bottom to top (= our render order):

1. **Ground decal** (`fx.decals`): hitbox shape, light pool (fake light), residue.
2. **Volumes** (`fx.volumes`): 3D bodies — orb, funnel, beam, whirl.
3. **Ribbons**: lightning, vines, smears.
4. **Sprites**: heads, flashes, sparks, smoke (particles first, immediate sprites on top).
5. **Danger decals** (`fx.danger`): enemy telegraphs over everything.

Per effect: one **core** (hottest, smallest), one **body/glow**, one **secondary shape**
(ring/arcs), a few **sparks**, optional **smoke**, one **ground** element. More than ~5 layers is
usually muddy **[src Riot: don't over-layer alpha shapes]**.

## 7. Density and crowds

- 200+ enemies already fill the screen; player effects must be sparse. Per-instance emission
  rates should be low and capped; optional sparkle is dropped when `fx.sprites.load` is high.
- Area ticks that hit many enemies: rely on the generic hit flash; no per-target bursts.
- **[src community: Halls of Torment, PoE2, Grim Dawn threads]** the common survivor-like
  complaint is player effects hiding enemies and enemy projectiles; players ask for effect
  opacity sliders and outlines on hostile projectiles. Solve it in design first: small,
  short, mid-opacity player effects; inked, high-contrast enemy hazards.
- **[project]** vertical size matters with a ~46° camera: anything taller than ~2 m covers the
  enemies standing behind it. Keep tall bodies thin or short-lived.

## 8. Scaling with upgrades

Upgrades must change the look *proportionally to what changed*, not "everything bigger":

| Stat | Visual response |
| --- | --- |
| area | geometry in units of `radius`/`length` (decals, volumes); particle *size* ∝ √scale, particle *count* ∝ area but capped; spill stays a fixed fraction |
| count | more instances, each unchanged; stagger them; per-instance budgets must hold at count × 3 |
| dur | longer sustain; impact and end unchanged |
| speed | longer stretch/trail; head unchanged |
| pierce | a small hit spark per pierced target |
| crit | generic gold crit (common.ts) |
| status | nothing extra (tint shows it) |

Check every move at 1× and at +100 % area (and count 3 where possible).

## 9. Stylised low-poly cartoon look

- **Toon ramps**: two or three hard bands with narrow `smoothstep` edges (e.g. flame: rim / body /
  hot core). three.js `MeshToonMaterial` uses a `gradientMap` with `NearestFilter`
  **[src three.js docs]**; our effects do the same banding in their own shaders.
- **Ink outlines**: a dark navy rim (`INK`) on bodies and smoke, as in our puff/leaf/ball/drop
  shapes and orb fresnel rims. Ink makes small shapes read on bright grass.
- **Procedural vs flipbook**: this repo draws every shape procedurally in the fragment shader (no
  textures, no atlas). Keep it: no texture memory, shapes scale cleanly. Flipbooks would need an
  atlas and break the one-draw-per-primitive budget.
- **Noise scrolling**: `noise2/fbm2/noise3` in `FX_GLSL`; scroll along the motion direction;
  two layers at different speeds/directions give life **[src Shannon McSheehan, realtimevfx:
  same texture at half speed in the opposite direction]**.
- **Fresnel**: `fresnel()` in volumes for rims and soft beam edges.
- **Dissolve / alpha erosion**: threshold a noise field against age so the shape is *eaten*
  rather than faded; `smoothstep` for a feathered edge, `step` for crisp toon edges; remap the
  input range by the feather width so it fully erodes **[src vfxdoc alpha erosion]**. Our `puff`
  already erodes holes with age; prefer this for ends and residue.
- **Stepped / posterised animation**: re-roll lightning at a fixed rate (`flicker(fx, seed,
  rate)`, ~20–30 Hz), or step time `floor(t * 12.0) / 12.0` for anime-style "on twos" boil on big
  shapes **[src Guilty Gear Xrd: keyframed without inbetweens at 60 fps to emulate limited
  animation]**.
- **Smear frames**: stretch fast sprites along velocity (`stretch` in `SpriteSpec`), and draw a
  wide pale smear behind fast arcs for 1–3 frames (Vine Whip's `Ribbon.streak`) **[src smear
  frame]**.
- **Toon smoke**: a few big inked puffs with a lit side (our `puff`), not many soft ones.

## 10. Accessibility

- Avoid more than three large bright flashes per second **[src WCAG 2.3.1 Three Flashes]**;
  lightning flicker should modulate shape, not full-screen brightness.
