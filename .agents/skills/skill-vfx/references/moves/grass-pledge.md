# 草之誓约 Grass Pledge (`grass-pledge`) — grass · smite · medium

- 52poke: <https://wiki.52poke.com/wiki/草之誓约（招式）> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Grass_Pledge_(move)>
- Description: 用草柱进行攻击；和另一种誓约组合，威力提高并留下场地效果。 *[familiar — check the page]*

Signature traits
- A **pillar bursts up out of the ground** under the target (Thunder, the other smite, comes down
  from the sky). *[familiar — check the GIF]*
- Two different pledges meeting make a field: 火海 (grass + fire), 彩虹 (fire + water),
  湿地 (grass + water). *[familiar — check the page]*

Sim (deepen-builds design §4; the move is not in the tree yet): `smite` — telegraph `delay`, one
hit on a disc of `area.radius`, 0.25 s linger; applies 减速. In co-op, another kind of pledge
landing within 1.5 s and 2.5 m makes the combination at the midpoint: `RunEvent` `pledge`, plus
an `Area` with `pledgeField` (火海, 湿地, 8 s) or `World.rainbowUntil` (彩虹, 10 s).

Ours (`vfx/pledge.ts` `grassPledge`): the telegraph disc fills while the ground stirs; the pillar
snaps up to 2 m in 0.05 s, holds and narrows away within 0.5 s（两根藤蔓绕着一柱淡光升起，叶片旋上去）. The ring
on the ground is the hitbox; the pillar is under half its width.

Combination looks (same file): 火海 and 湿地 are drawn every frame from the area's own `radius`,
`life` and `maxLife`, so a restored field looks the same; only a field younger than 0.3 s plays
its forming burst. 彩虹 is a 1.8 m arc at the meeting point from the `pledge` event, and three
pastel bands (amber, mint, sky; 1.08–1.3 m, outside the 0.87 m seat ring) with rising glints round
each standing player while `rainbowUntil` lasts.

Keep: pillar ≤ 2 m and thin; pastel rainbow bands. Avoid: saturated red or purple (enemy danger),
a field wider than `area.radius`, replaying a burst for something restored.
