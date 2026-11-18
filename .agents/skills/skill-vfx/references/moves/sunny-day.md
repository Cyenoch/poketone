# 大晴天 Sunny Day (`sunny-day`) — fire · weather · cast beat only

- 52poke: <https://wiki.52poke.com/wiki/大晴天（招式）> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Sunny_Day_(move)>
- Description: 在 5 回合内让阳光变得强烈，从而提高火属性的招式威力，水属性的招式威力则降低。 *[familiar — check the page]*

Signature traits
- A small bright **sun rises over the user** and flares. *[familiar — check the GIF]*
- The whole field brightens and warms afterwards. *[familiar]*

Sim (deepen-builds design §3; the move is not in the tree yet): archetype `weather`, sets
`world.weather` to `sun` for 30 s, cooldown 40 s, hits nothing. The view hears it as
`cast` with `move: "sunny-day"`.

Ours (`vfx/weatherMoves.ts` `sunnyDay`, sky in `view/weather.ts`): a gold sun climbs off the caster
to `height + 0.8` in 0.22 s, flares and shrinks away within 1.1 s (longer than the 1.0 s take); a
glow and one thin ring hug the feet. Then the sky, light and motes come from `world.weather`: a
warm gold light (sun ×1.4), twinkling 0.16 m motes, and one particle in ten drawn as a faint leaning
shaft of sunlight (0.8 × 5.2 m) that reads as dappled light on the ground. The layer is additive
with premultiplied colour, so a particle's alpha counts twice; it draws before every other
transparent effect, under the enemy danger layer.

Keep: the beat on the caster only; gold, never orange-red. Avoid: any ring at a radius that could
read as a hitbox; replaying the beat for a weather that was restored rather than cast.
