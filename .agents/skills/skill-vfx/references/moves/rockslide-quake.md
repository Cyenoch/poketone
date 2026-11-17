# 岩崩地震 · rockslide-quake

Project ultimate for the Geodude line, using the shared Pulse timeline in `content/ultimates.ts`.

- t0: full r2.8 quake. At .3 s intervals: 3/4/5 rounds of 2/3/4 target strikes, r1.6 each. Final r3.5/4/4.5 quake at 1.2/1.5/1.8 s.
- Each pulse arrives on its damage tick: rubble is already on the ground, with a short descending trail ending there. Do not start a delayed falling-rock animation after damage.
- `rock.ts`: faceted rocks, non-emissive earth fractures with a lit lip, low dust, tapered final pillars. Own cast/aura uses dust and fractures instead of a magic light column; shared local dimming stays in `ultimates.ts`.
- Full boundaries appear immediately; impacts last .28 s, fall trails .18 s, rimless cracks .65 s. Existing pools only; no new materials/textures. Count adds separate impacts, radius follows events and does not inflate pillar height.
- Reference animations are not claimed. Natural enemy targeting, device performance and danger overlap need real-game review in addition to pulse tests.
