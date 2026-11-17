import assert from "node:assert/strict";
import test from "node:test";
import { starters } from "../src/run/sim/content/lines/index.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { evolve, formOf } from "../src/run/sim/evolution.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { damagePlayer } from "../src/run/sim/hurt.ts";
import { DASH_COOLDOWN, DASH_TIME } from "../src/run/sim/content/params/player.ts";
import { playerStats } from "../src/run/sim/stats.ts";
import { TERRAIN_HALF } from "../src/run/sim/terrain.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { fireUltimate, timeline, updateUltimate } from "../src/run/sim/ultimates/index.ts";
import { items } from "../src/run/sim/content/items.ts";
import { createRng } from "../src/run/sim/rng.ts";
import {
  applyChoice,
  itemSlots,
  moveSlots,
  newMoveState,
  rollChoices,
} from "../src/run/sim/upgrades.ts";
import { MAX_MOVE_LEVEL } from "../src/run/sim/content/params/cards.ts";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";

const world = (starter = "charmander") =>
  createWorld({ stage: "forest", seed: 5, difficulty: 0, players: [{ starter }] });

/** Feeds enough XP to reach `level`, answering every card with its first option. */
function levelTo(w, level) {
  const player = w.players[0];
  while (player.level < level) {
    w.pickups.push({
      id: w.nextId++,
      kind: "xp",
      x: player.x,
      z: player.z,
      value: player.xpNext,
      magnet: true,
    });
    stepWorld(w, []);
    while (player.pending[0])
      stepWorld(w, [{ t: "pick", player: 0, card: player.pending[0].id, index: 0 }]);
  }
}

const [, stage1, stage2] = starters.charmander.stages;

test("evolving at the level threshold keeps moves and levels and changes stats and types", () => {
  const w = world("charmander");
  const player = w.players[0];
  player.moves[0].level = 3;
  player.moves[0].damage = 1234;
  player.moves[0].mods.dmg = 0.4;
  const keep = () =>
    player.moves.map(({ id, level, mods, damage }) => ({ id, level, mods, damage }));
  levelTo(w, stage1.at - 1);
  const before = { moves: keep(), stats: playerStats(player), stage: player.stage };
  assert.equal(before.stage, 0);
  w.events.length = 0;
  levelTo(w, stage1.at);
  assert.equal(player.stage, 1);
  assert.equal(formOf(player).id, "charmeleon");
  assert.ok(w.events.some((e) => e.t === "evolve" && e.form === "charmeleon"));
  // Cards picked on the way up may add moves; what was there before stays exactly as it was.
  assert.deepEqual(keep().slice(0, before.moves.length), before.moves);
  const after = playerStats(player);
  assert.ok(after.maxHp > before.stats.maxHp && after.speed > before.stats.speed);
  levelTo(w, stage2.at);
  assert.equal(formOf(player).id, "charizard");
  assert.deepEqual(formOf(player).types, ["fire", "flying"]);
});

test("maturity raises the stage but keeps the form; the next stage evolves", () => {
  const w = world("pikachu");
  const player = w.players[0];
  const [, mature, raichu] = starters.pikachu.stages;
  assert.equal(mature.kind, "mature");
  levelTo(w, mature.at);
  assert.equal(player.stage, 1);
  assert.equal(formOf(player).id, "pikachu");
  assert.ok(w.events.some((e) => e.t === "evolve" && e.stage === 1 && e.form === "pikachu"));
  levelTo(w, raichu.at);
  assert.equal(player.stage, 2);
  assert.equal(formOf(player).id, "raichu");
});

test("new player lines keep their build through both evolutions and can finish each ultimate tier", () => {
  for (const starter of ["gastly", "dratini", "machop", "abra", "geodude"]) {
    const w = world(starter);
    w.map.terrain = flatTerrain();
    w.map.obstacles = [];
    const player = w.players[0];
    player.x = player.z = 0;
    const target = dummy(w, 1.5, 0);
    player.moves[0].level = 3;
    player.moves[0].mods.dmg = 0.4;
    const build = structuredClone(player.moves);
    for (const stage of starters[starter].stages) {
      player.level = stage.at;
      evolve(player);
      assert.equal(formOf(player).id, stage.form.id);
      assert.deepEqual(player.moves, build, `${starter} keeps learned upgrades`);
      const hp = target.hp;
      cast(w);
      assert.ok(target.hp < hp, `${stage.form.id} deals ultimate damage`);
      assert.equal(player.ult.elapsed, -1, "the pulse sequence completes");
      assert.equal(player.ult.charge, 0, "the sequence never recharges itself");
    }
  }
});

test("an evolution move is offered only once its stage is reached", () => {
  const w = world("charmander");
  const player = w.players[0];
  player.level = starters.charmander.stages[1].at;
  const [first, second] = starters.charmander.evolutionMoves;
  const offered = (move, rolls) => {
    const rng = createRng(9);
    for (let i = 0; i < rolls; i++)
      if (rollChoices(rng, player, "level").some((c) => c.kind === "move" && c.move === move))
        return true;
    return false;
  };
  assert.ok(!offered(first, 300), "not before evolving");
  assert.ok(evolve(player));
  assert.ok(offered(first, 50), "stage 1 adds the first evolution move at high weight");
  assert.ok(!offered(second, 300), "the second waits for stage 2");
});

test("psychic and rock cards respect kit levels and both evolution stages", () => {
  for (const starter of ["abra", "geodude"]) {
    const player = world(starter).players[0];
    const { kit, evolutionMoves, stages } = starters[starter];
    const offered = () => {
      const rng = createRng(9);
      const seen = new Set();
      for (let i = 0; i < 300; i++)
        for (const choice of rollChoices(rng, player, "level"))
          if (choice.kind === "move") seen.add(choice.move);
      return seen;
    };
    const expectMoves = (expected) =>
      assert.deepEqual(
        offered(),
        new Set(expected),
        `${starter} L${player.level} stage ${player.stage}`,
      );
    expectMoves([]);
    player.level = 2;
    expectMoves([kit[1]]);
    player.level = stages[1].at - 1;
    expectMoves([kit[1]]);
    player.level = stages[1].at;
    expectMoves([kit[1], kit[2]]);
    assert.ok(evolve(player));
    expectMoves([kit[1], kit[2], evolutionMoves[0]]);
    player.level = 39;
    expectMoves([kit[1], kit[2], evolutionMoves[0]]);
    player.level = 40;
    expectMoves([...kit.slice(1), evolutionMoves[0]]);
    player.level = stages[2].at;
    expectMoves([...kit.slice(1), evolutionMoves[0]]);
    assert.ok(evolve(player));
    expectMoves([...kit.slice(1), ...evolutionMoves]);
    applyChoice(player, { kind: "move", move: evolutionMoves[1] });
    expectMoves([...kit.slice(1), evolutionMoves[0]]);
  }
});

test("Abra chains two protective dashes and recharges each spent charge separately", () => {
  const w = world("abra");
  const player = w.players[0];
  player.invulnerable = 0;
  const dash = { t: "dash", player: 0 };
  const casts = () => w.events.filter((event) => event.t === "dash").length;
  const hp = player.hp;
  for (let i = 0; i < 3; i++) {
    stepWorld(w, [dash]);
    assert.equal(damagePlayer(w, player, 10), false, "the dash protects against hits");
  }
  assert.equal(casts(), 2, "the third press cannot extend an exhausted chain");
  assert.equal(player.dashes, 0);
  assert.equal(player.hp, hp);
  for (let i = 0; i < Math.ceil(DASH_TIME / TICK); i++) stepWorld(w, []);
  assert.equal(damagePlayer(w, player, 10), true, "protection ends with the dash");
  assert.ok(player.hp < hp);
  while (w.time < DASH_COOLDOWN - TICK) {
    stepWorld(w, [dash]);
    assert.equal(casts(), 2, "spent charges remain unavailable before recharge");
  }
  for (let i = 0; i < 2; i++) stepWorld(w, []);
  assert.equal(player.dashes, 1, "one cooldown restores only one charge");
  assert.ok(player.dashCooldown > DASH_COOLDOWN - 3 * TICK);
  stepWorld(w, [dash]);
  assert.equal(casts(), 3, "the returned charge is immediately usable");
  assert.equal(player.dashes, 0);
  for (let i = 0; i < Math.ceil((2 * DASH_COOLDOWN) / TICK) + 2; i++) stepWorld(w, []);
  assert.equal(player.dashes, 2, "all charges eventually recover");
  assert.equal(player.dashCooldown, 0);
});

test("Abra evolutions preserve spent dashes and Alakazam's extra charge joins the recharge queue", () => {
  const w = world("abra");
  const player = w.players[0];
  const dash = { t: "dash", player: 0 };
  for (const stage of starters.abra.stages.slice(1)) {
    while (player.dashes > 0) stepWorld(w, [dash]);
    const cooldown = player.dashCooldown;
    player.level = stage.at;
    assert.ok(evolve(player));
    assert.equal(player.dashes, 0, "evolving does not refund spent charges");
    assert.equal(player.dashCooldown, cooldown, "the running recharge is preserved");
    const capacity = player.stage === 1 ? 2 : 3;
    for (let i = 0; i < Math.ceil((capacity * DASH_COOLDOWN) / TICK) + 2; i++) stepWorld(w, []);
    assert.equal(player.dashes, capacity, `${stage.form.id} restores its full chain`);
    assert.equal(player.dashCooldown, 0);
    const before = w.events.filter((event) => event.t === "dash").length;
    for (let i = 0; i <= capacity; i++) stepWorld(w, [dash]);
    assert.equal(w.events.filter((event) => event.t === "dash").length - before, capacity);
  }
});

test("a move never goes past level 8", () => {
  const w = world("squirtle");
  const player = w.players[0];
  player.level = 20;
  const rng = createRng(4);
  for (let i = 0; i < 300; i++) {
    const options = rollChoices(rng, player, i % 4 === 0 ? "chest" : "level");
    applyChoice(player, options.find((c) => c.kind === "upgrade") ?? options[0]);
  }
  assert.ok(player.moves.every((move) => move.level <= MAX_MOVE_LEVEL));
  assert.ok(player.moves.some((move) => move.level === MAX_MOVE_LEVEL));
  const capped = player.moves.find((move) => move.level === MAX_MOVE_LEVEL);
  assert.throws(() =>
    applyChoice(player, { kind: "upgrade", move: capped.id, rarity: 0, rolls: [] }),
  );
});

test("训练 cards appear only when nothing else is left to offer", () => {
  const w = world("pikachu");
  const player = w.players[0];
  player.level = 12;
  const rng = createRng(2);
  for (let i = 0; i < 500; i++)
    assert.ok(rollChoices(rng, player, "level").every((c) => c.kind !== "train"));

  const kit = starters.pikachu.kit.slice(0, moveSlots(player));
  player.moves = kit.map((id) => ({ ...newMoveState(id), level: MAX_MOVE_LEVEL }));
  player.items = Object.values(items)
    .slice(0, itemSlots(player))
    .map((item) => ({ id: item.id, level: item.max }));
  for (const source of ["level", "chest"]) {
    const options = rollChoices(rng, player, source);
    assert.ok(options.length > 0 && options.every((c) => c.kind === "train"), source);
    assert.equal(new Set(options.map((c) => c.stat)).size, options.length);
  }
  const before = playerStats(player).maxHp;
  applyChoice(player, { kind: "train", stat: "hp" });
  assert.ok(playerStats(player).maxHp > before);
});

test("the ultimate charges, can't fire early, fires once per charge and charges nothing meanwhile", () => {
  const w = world("squirtle");
  const player = w.players[0];
  const casts = () => w.events.filter((e) => e.t === "ult").length;
  stepWorld(w, []);
  assert.ok(player.ult.charge > 0, "time alone charges it");
  player.ult.charge = 0.99;
  stepWorld(w, [{ t: "ult", player: 0 }]);
  assert.equal(casts(), 0);
  player.ult.charge = 1;
  stepWorld(w, [{ t: "ult", player: 0 }]);
  assert.equal(casts(), 1);
  assert.equal(player.ult.charge, 0);
  assert.ok(player.invulnerable > 0);
  const last = timeline(starters.squirtle.ultimate, 0).at(-1).at;
  let ticks = 0;
  while (player.ult.elapsed >= 0 && ticks++ < (last + 1) / TICK) {
    assert.equal(player.ult.charge, 0, "no charge while it plays out");
    stepWorld(w, [{ t: "ult", player: 0 }]);
  }
  assert.equal(casts(), 1, "a second press during the cast does nothing");
  assert.equal(player.ult.elapsed, -1, "the cast ends after its last pulse");
  stepWorld(w, []);
  assert.ok(player.ult.charge > 0);
});

function flatTerrain(height = () => 0) {
  const resolution = 2;
  const samples = TERRAIN_HALF * 2 * resolution + 1;
  const heights = new Float32Array(samples * samples);
  for (let j = 0; j < samples; j++)
    for (let i = 0; i < samples; i++)
      heights[j * samples + i] = height(
        -TERRAIN_HALF + i / resolution,
        -TERRAIN_HALF + j / resolution,
      );
  return { origin: -TERRAIN_HALF, resolution, samples, heights, step: 1.5, levels: 3 };
}

function dummy(w, x, z) {
  const enemy = spawnEnemy(w, "caterpie", x, z);
  enemy.x = enemy.px = x;
  enemy.z = enemy.pz = z;
  enemy.hp = enemy.maxHp = 1e6;
  return enemy;
}

/** Plays a whole cast of the player's ultimate with nothing else running (enemies hold still). */
function cast(w) {
  const player = w.players[0];
  player.ult.charge = 1;
  assert.ok(fireUltimate(w, player));
  const ctx = { world: w, grid: new EnemyGrid() };
  while (player.ult.elapsed >= 0) {
    ctx.grid.rebuild(w.enemies);
    updateUltimate(ctx, player, TICK);
  }
}

test("ultimates obey cover: a rock shelters an enemy from a root lane, a cliff from a fire ring", () => {
  const roots = world("bulbasaur");
  roots.map.terrain = flatTerrain();
  roots.enemies = [];
  const player = roots.players[0];
  player.x = player.z = 0;
  // The roots aim at the nearest visible enemy (+z) and fan out every 60°.
  const aimed = dummy(roots, 0, 3);
  const angle = Math.PI / 2 + Math.PI / 3;
  const [dx, dz] = [Math.cos(angle), Math.sin(angle)];
  roots.map.obstacles = [
    { kind: "rock", x: dx * 1.8, z: dz * 1.8, radius: 0.6, scale: 1, rotation: 0, solid: true },
  ];
  const sheltered = dummy(roots, dx * 3.6, dz * 3.6);
  const [ex, ez] = [Math.cos(angle + Math.PI / 3), Math.sin(angle + Math.PI / 3)];
  const open = dummy(roots, ex * 3.6, ez * 3.6);
  cast(roots);
  assert.ok(aimed.hp < aimed.maxHp && open.hp < open.maxHp, "lanes in the open hit");
  assert.equal(sheltered.hp, sheltered.maxHp, "the rock cuts that lane short");

  const fire = world("charmander");
  // A terrace 2.5 up from x = 1.5: out of a burst's step and out of sight from below.
  fire.map.terrain = flatTerrain((x) => (x >= 1.5 ? 2.5 : 0));
  fire.enemies = [];
  fire.map.obstacles = [];
  const caster = fire.players[0];
  caster.x = caster.z = 0;
  const behind = dummy(fire, 3, 0);
  const inSight = dummy(fire, -3, 0);
  cast(fire);
  assert.ok(inSight.hp < inSight.maxHp);
  assert.equal(behind.hp, behind.maxHp, "the ring doesn't reach up the cliff");
});

test("a run with evolutions and ultimates is deterministic", () => {
  const run = () => {
    const w = createWorld({
      stage: "forest",
      seed: 21,
      difficulty: 0,
      players: [{ starter: "pikachu" }],
    });
    const player = w.players[0];
    let ults = 0;
    for (let tick = 0; tick < 2400; tick++) {
      const angle = tick / 80;
      const commands = [
        { t: "move", player: 0, x: Math.cos(angle), z: Math.sin(angle) },
        { t: "ult", player: 0 },
      ];
      const card = player.pending[0];
      if (card) commands.push({ t: "pick", player: 0, card: card.id, index: 0 });
      // Charge it outright twice; time alone would take ~3 minutes.
      if (tick === 300 || tick === 1500) player.ult.charge = 1;
      if (tick % 40 === 0 && player.level < starters.pikachu.stages[2].at + 4)
        w.pickups.push({
          id: w.nextId++,
          kind: "xp",
          x: player.x,
          z: player.z,
          value: player.xpNext,
          magnet: true,
        });
      player.hp = playerStats(player).maxHp;
      stepWorld(w, commands);
      ults += w.events.filter((e) => e.t === "ult").length;
      w.events.length = 0;
    }
    assert.equal(player.stage, 2);
    assert.equal(ults, 2);
    return JSON.stringify({ players: w.players, enemies: w.enemies, kills: w.kills, ults });
  };
  assert.equal(run(), run());
});
