# 求雨 Rain Dance (`rain-dance`) — water · weather · cast beat only

- 52poke: <https://wiki.52poke.com/wiki/求雨（招式）> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Rain_Dance_(move)>
- Description: 在 5 回合内一直降雨，从而提高水属性的招式威力，火属性的招式威力则降低。 *[familiar — check the page]*

Signature traits
- **Dark clouds gather overhead**, then rain falls over the whole field. *[familiar — check the GIF]*

Sim (deepen-builds design §3; not in the tree yet): archetype `weather`, sets `world.weather` to
`rain` for 30 s, cooldown 40 s. Event: `cast` with `move: "rain-dance"`.

Ours (`rainDance`): drops leave the ground for a three-lobe cloud that pops open over the head in
0.18 s, sheds its first drops and shrinks away by 0.95 s; one ripple at the feet. The field's rain,
grey haze and dimmer sun follow from `world.weather`.

Keep: cloud small (about the body's width) and above the head, so it never covers an enemy.
Avoid: lightning (that is 打雷), candy-like cyan blobs near the ground.
