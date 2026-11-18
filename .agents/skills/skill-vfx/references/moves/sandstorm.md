# 沙暴 Sandstorm (`sandstorm`) — rock · weather · cast beat only

- 52poke: <https://wiki.52poke.com/wiki/沙暴（招式）> · Bulbapedia: <https://bulbapedia.bulbagarden.net/wiki/Sandstorm_(move)>
- Description: 在 5 回合内扬起沙暴，除岩石、地面和钢属性以外的宝可梦，都会受到伤害。 *[familiar — check the page]*

Signature traits
- **Sand whips round the user** and is carried off sideways by the wind. *[familiar — check the GIF]*

Sim (deepen-builds design §3; not in the tree yet): archetype `weather`, sets `world.weather` to
`sandstorm` for 30 s, cooldown 40 s. Event: `cast` with `move: "sandstorm"`.

Ours (`sandstorm`): a whirl decal 1.1–1.8 body radii wide under the caster and grit climbing in a
spin for 0.9 s; six dust puffs thrown along the spin. The field's streaks and haze follow from
`world.weather`.

Keep: dark clay edges so the sand reads on the desert's own sand. Avoid: a wide ring (no hitbox).
