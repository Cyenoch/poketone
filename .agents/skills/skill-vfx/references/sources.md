# Sources

What each source contributed. Read 2026-11-04 unless noted. "Secondary" means a summary or
community write-up, not the original talk.

## Readability, hierarchy, colour, timing

- **League of Legends VFX Style Guide** (Riot, 2017, public PDF) —
  <https://nexus.leagueoflegends.com/wp-content/uploads/2017/10/VFX_Styleguide_final_public_hidpjqwx7lqyx0pjj3ss.pdf>
  (the Nexus host now redirects; an archived copy was read via the Wayback Machine). Goals order;
  primary vs secondary element rules; accurate AoE/hitbox representation (Teemo, Sona); scale
  of importance ladder; value range (avoid 0/100 %, push value to the centre, illumination,
  dark backing with caution); saturation range; complementary colours as secondary; hand-painted
  mixed soft/sharp shapes; motion blur for direction; timing guideline (anticipation and
  dissipation on all effects, outros secondary); minimise linger (Snow Day vs Justicar Syndra W).
- **Riot announcement post** — <https://nexus.leagueoflegends.com/en-us/2017/10/dev-leagues-vfx-style-guide/>
- **"/dev: Clarity in League"** (Riot) —
  <https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/>. Attention matches
  importance; projectiles show direction without motion; minimal noise; skins at clarity parity.
- **"/dev: Behind the scenes of VFX updates"** (Riot) —
  <https://leagueoflegends.com/en-au/news/dev/dev-behind-the-scenes-of-vfx-updates>. Hitbox
  accuracy first; readability over theme; cut busy texture detail; balanced brightness.
- **"10 Design Tips from the League of Legends VFX Style Guide"** (VFX Apprentice, secondary) —
  <https://www.vfxapprentice.com/blog/10-league-of-legends-vfx-design-tips>. Peak within the
  first quarter of the lifespan; "if your FX feel long, they're way too long"; overdraw cost.
- **"The Soul of Effects: What is Timing in VFX?"** (VFX Apprentice, Jason Keyser's lessons) —
  <https://www.vfxapprentice.com/blog/the-soul-of-effects-what-is-timing-in-vfx>. Wind-up /
  climax / fall-off; impulse vs rhythm; block-in timing before polish; heartbeat tempo rule.
- **"Visual Effects Bootcamp: Artistic Principles of VFX"** (Jason Keyser, Riot & Hadidjah
  Chamberlain, Blizzard; GDC 2017) — <https://www.gdcvault.com/play/1024439/Visual-Effects-Bootcamp-Artistic-Principles>.
  Outline only (gameplay is king; shape & area of effect; contrast & focal point; colour &
  identity; timing & threat level); the talk itself was not watched. Keyser's video series:
  <https://realtimevfx.com/t/artistic-principles-of-vfx/4081>.
- **"Attention Overload: Creating Readable VFX"** (Rocksteady, GDC) —
  <https://gdcvault.com/play/1034360/Attention-Overload-Creating-Readable-VFX>. Listing only.
- **Rachel Day (Blizzard, Overwatch) interview** — <https://vfxvoice.com/rachel-day-the-game-changing-gamemaker-behind-overwatch/>.
  "VFX is the visual telling of gameplay"; works hand in hand with designers.
- **Shannon McSheehan — LoL FX knowledge share** (realtimevfx) —
  <https://realtimevfx.com/t/shannon-mcsheehan-lol-fx-knowledge-share/1133>. "Gameplay is king …
  nothing is too flashy"; panning textures; second layer at half speed in the opposite direction.

## Game feel, impact, telegraphs

- **Jan Willem Nijman, "The Art of Screenshake"** (Vlambeer, INDIGO 2013). Talk not watched; the
  30-step list from a summary: <https://rpgplayground.com/research-making-a-juicy-game/>, context
  <https://gamedeveloper.com/design/vlambeer-co-founder-shares-advice-on-building-better-action-games>.
  Bigger bullets, muzzle flash, impact effects, hit animation, permanence, sleep, bigger explosions.
- **Martin Jonasson & Petri Purho, "Juice It or Lose It"** (2012) —
  <https://gdcvault.com/play/1016487/Juice-It-or-Lose>. Tweening, squash & stretch, particles
  ("but not too many"), shake, flash.
- **Masahiro Sakurai on hitstop** (Famitsu column via Source Gaming) —
  <https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/>;
  his YouTube series "Masahiro Sakurai on Creating Games" has a "Hit-Stops" episode and an
  "[Effects]" category ("Flash, Blast, and Smoke") — not watched here. Both freeze equally;
  scales with damage; projectiles less, electric more; victim shake grounded = horizontal,
  decays; bigger shake when the camera is far.
- **"Enemy attacks and telegraphing"** (Game Developer) —
  <https://gamedeveloper.com/design/enemy-attacks-and-telegraphing>. Charge-up = gather, sound,
  flash, release; telegraphs make damage feel fair.
- Repo: `docs/GAME-FEEL.md`, `.agents/skills/game-feel` (shake, hit-stop, feedback tiers).

## Stylised techniques

- **Alpha erosion** — <https://vfxdoc.readthedocs.io/en/latest/shaders/alpha-erosion/>. step vs
  smoothstep threshold; remap by feather; dithered erosion.
- **Stylised fire with stepped noise** — <https://papaya-games.itch.io/duck-in-town/devlog/95149/how-to-make-an-stylized-fire-shader>,
  <https://godotshaders.com/shader/stylized-3d-fire-and-smoke/>,
  <https://realtimevfx.com/t/simple-fire-shader-breakdown/11213>.
- **Smear frames** — <https://en.wikipedia.org/wiki/Smear_frame>.
- **Guilty Gear Xrd limited animation** — <https://www.blendernation.com/2015/07/26/junya-c-motomura-behind-the-scenes-of-guilty-gear-xrd/>
  (and community notes that keys are held without inbetweens at 60 fps).
- **three.js MeshToonMaterial `gradientMap` + `NearestFilter`** —
  <https://threejs.org/docs/#api/en/materials/MeshToonMaterial>.
- **Wind Waker cel style for readability** (Takizawa, via Wikipedia "Cel shading") —
  <https://en.wikipedia.org/wiki/Cel_shading>.

## Survivor-like clutter (community evidence, not authoritative)

- Halls of Torment, Vampire Survivors, Soulstone Survivors Steam threads; PoE2 "Skill Opacity
  Option"; Grim Dawn "reduce visual clutter": players lose enemies and enemy projectiles under
  player effects and ask for opacity sliders / hostile outlines.
  <https://steamcommunity.com/app/2218750/discussions/0/3801652929323026410>,
  <https://www.pathofexile.com/forum/view-thread/3868713>.

## Accessibility

- **WCAG 2.3.1 Three Flashes or Below Threshold** — <https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html>.

## Move depiction

- 52poke 神奇宝贝百科 move pages (text read; GIFs not viewable by the fetch tool) and Bulbapedia
  (blocked the fetch tool; links kept for humans). Per-move links in `moves/*.md`.
- The reference game (0.8.83) move effects (read to learn shapes, sizes and lifetimes;
  summarised in words, no code copied).

Not found / not verified: a primary Supergiant (Hades) VFX talk, a Diablo IV VFX readability talk
(only Blizzard's 2021 quarterly update mentions it), Genshin colour-language material.
