import assert from "node:assert/strict";
import test from "node:test";
import { starters } from "../src/run/sim/content/lines/index.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { evolve, evolveInWorld, formOf, stageFor } from "../src/run/sim/evolution.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { damagePlayer } from "../src/run/sim/hurt.ts";
import { DASH_COOLDOWN, DASH_TIME } from "../src/run/sim/content/params/player.ts";
import { playerStats } from "../src/run/sim/stats.ts";
import { TERRAIN_HALF } from "../src/run/sim/terrain.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { fireUltimate, timeline, updateUltimate } from "../src/run/sim/ultimates/index.ts";
import { ULT_WINDUP } from "../src/run/sim/content/params/ultimates.ts";
import { items } from "../src/run/sim/content/items.ts";
import { createRng } from "../src/run/sim/rng.ts";
import { snapshotWorld, restoreWorld } from "../src/run/sim/snapshot.ts";
import { gainXp } from "../src/run/sim/progression.ts";
import { collectRoutePickup } from "../src/run/sim/route-rewards.ts";
import { selectTestExit } from "./fixtures/route.mjs";
import { prepareZone, enterZone, tradeAction } from "../src/run/sim/zones.ts";
import {
  applyChoice,
  itemEligible,
  itemSlots,
  moveSlots,
  newMoveState,
  offerKey,
  rollChoices,
} from "../src/run/sim/upgrades.ts";
import { MAX_MOVE_LEVEL } from "../src/run/sim/content/params/cards.ts";
import {
  applyCommand,
  createPlayer,
  createWorld,
  stepSharedWorld,
  stepWorld,
} from "../src/run/sim/world.ts";

const world = (starter = "charmander") =>
  createWorld({
    mode: "expedition",
    rules: [],
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [{ trainer: "chengxi", starter }],
  });

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
  player.banished.push(offerKey.item("everstone"));
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

test("不变之石不妨碍皮卡丘成熟；成为雷丘仍需雷之石，进化后道具保留", () => {
  const w = world("pikachu");
  const player = w.players[0];
  const [, mature, raichu] = starters.pikachu.stages;
  applyChoice(player, { kind: "item", item: "everstone" });
  player.level = mature.at;
  evolveInWorld(w, player);
  assert.equal(player.stage, 1);
  assert.equal(formOf(player).id, "pikachu");
  assert.ok(w.events.some((e) => e.t === "evolve" && e.stage === 1 && e.form === "pikachu"));

  player.items = [];
  player.level = raichu.at;
  evolveInWorld(w, player, "trade");
  assert.equal(formOf(player).id, "pikachu");
  const id = w.nextId++;
  player.pending.push({ id, source: "level", options: [{ kind: "item", item: "thunder-stone" }] });
  applyCommand(w, { t: "pick", player: player.id, card: id, index: 0 });
  assert.ok(player.items.some((item) => item.id === "thunder-stone"));
  assert.equal(formOf(player).id, "raichu");
});

test("不变之石阻止等级进化，进化奇石仍提高最大生命和护甲", () => {
  const player = createPlayer(0, "charmander", 0);
  player.level = stage2.at;
  applyChoice(player, { kind: "item", item: "everstone" });
  const bare = playerStats(player);
  applyChoice(player, { kind: "item", item: "eviolite" });
  assert.equal(evolve(player), false);
  assert.equal(formOf(player).id, "charmander");
  const held = playerStats(player);
  assert.ok(held.maxHp > bare.maxHp && held.armor > bare.armor);
});

test("四条通信线不能预存低等级的交换；达标后本次交换立即进化", () => {
  for (const starter of ["machop", "gastly", "abra", "geodude"]) {
    const player = createPlayer(0, starter, 0);
    const [, middle, final] = starters[starter].stages;
    player.level = final.at - 1;
    evolve(player);
    assert.equal(formOf(player).id, middle.form.id);
    assert.equal(evolve(player, "trade"), false);

    player.level = final.at;
    assert.equal(evolve(player), false, starter);
    assert.ok(evolve(player, "trade"), starter);
    assert.equal(formOf(player).id, final.form.id);
  }
});

test("交换邀请跨快照保留，超时或分开后需要重新双向确认", () => {
  const w = createWorld({
    mode: "expedition",
    rules: [],
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [
      { trainer: "chengxi", starter: "machop" },
      { trainer: "chengxi", starter: "gastly" },
    ],
  });
  const interact = (world, player) => applyCommand(world, { t: "interact", player });
  for (const p of w.players) Object.assign(p, { x: 0, z: 0, level: 80, stage: 1 });
  assert.deepEqual(
    w.players.map((p) => tradeAction(w, p)),
    ["trade", "trade"],
  );
  interact(w, 0);
  assert.equal(w.players[0].tradeRequest.target, 1);
  assert.deepEqual(
    w.players.map((p) => tradeAction(w, p)),
    ["trade-wait", "trade-accept"],
  );
  const restored = restoreWorld(w.map, snapshotWorld(w));
  interact(restored, 1);
  assert.deepEqual(
    restored.players.map((p) => formOf(p).id),
    ["machamp", "gengar"],
  );
  w.players[1].x = 4;
  stepWorld(w, []);
  assert.equal(w.players[0].tradeRequest, null);
  w.players[1].x = 0;
  interact(w, 1);
  for (let i = 0; i <= 5 / TICK; i++) stepWorld(w, []);
  assert.equal(w.players[1].tradeRequest, null);
  assert.deepEqual(
    w.players.map((p) => formOf(p).id),
    ["machoke", "haunter"],
  );
});

test("联系绳只在通信进化时腾出栏位，只补一次新增生命并播放一次演出", () => {
  const w = world("machop");
  const player = w.players[0];
  const [, machoke, machamp] = starters.machop.stages;
  player.items = [
    { id: "linking-cord", level: 1 },
    { id: "hp-up", level: 2 },
  ];
  player.level = machoke.at;
  evolveInWorld(w, player);
  assert.equal(formOf(player).id, "machoke");

  applyChoice(player, { kind: "item", item: "everstone" });
  player.level = machamp.at;
  w.events.length = 0;
  player.invulnerable = player.cardHold = 0;
  evolveInWorld(w, player, "trade");
  assert.equal(formOf(player).id, "machoke");
  assert.ok(!w.events.some((e) => e.t === "evolve"));
  player.items = player.items.filter((item) => item.id !== "everstone");

  const before = playerStats(player).maxHp;
  player.hp = 10;
  assert.equal(stageFor(player), 2);
  evolveInWorld(w, player);
  evolveInWorld(w, player);
  assert.equal(formOf(player).id, "machamp");
  assert.deepEqual(player.items, [{ id: "hp-up", level: 2 }]);
  assert.equal(player.hp, 10 + (playerStats(player).maxHp - before));
  assert.ok(player.invulnerable > 0 && player.cardHold > 0);
  assert.equal(w.events.filter((e) => e.t === "evolve" && e.form === "machamp").length, 1);
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
      evolve(player, stage.needs === "trade" ? "trade" : undefined);
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
    evolve(player);
    expectMoves([...kit.slice(1), evolutionMoves[0]]);
    assert.ok(evolve(player, "trade"));
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
    assert.ok(evolve(player, stage.needs === "trade" ? "trade" : undefined));
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
  assert.ok(player.ult.protection > 0);
  const last = timeline(starters.squirtle.ultimate, 0).at(-1).at;
  let ticks = 0;
  while (player.ult.elapsed >= 0 && ticks++ < (ULT_WINDUP + last + 1) / TICK) {
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
  // Independent tier casts: the shared protection clock is covered by ultimate-windup.test.mjs.
  player.ult.protection = 0;
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
      mode: "expedition",
      rules: [],
      stage: "forest",
      seed: 21,
      difficulty: 0,
      players: [
        {
          trainer: "chengxi",
          starter: "pikachu",
          backpack: ["thunder-stone"],
          archive: ["everstone"],
        },
      ],
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

test("火恐龙先完成普通进化，连续升级不会截断演出；超级进化只补生命增量", () => {
  const w = createWorld({
    mode: "expedition",
    rules: [],
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [
      { trainer: "chengxi", starter: "squirtle" },
      { trainer: "chengxi", starter: "charmander" },
    ],
  });
  const p = w.players[1];
  Object.assign(p, { stage: 1, level: 54, hp: 15 });
  applyChoice(p, { kind: "item", item: "charizardite-x" });
  gainXp(w, p, p.xpNext);
  assert.equal(formOf(p).id, "charizard");
  const hold = p.cardHold;
  gainXp(w, p, p.xpNext);
  assert.ok(hold > 0 && p.cardHold === hold);
  const hp = p.hp,
    max = playerStats(p).maxHp;
  for (let i = 0; i < Math.ceil(hold / TICK) + 1 && !p.mega; i++) {
    const remaining = p.cardHold;
    stepSharedWorld(w, []);
    if (remaining > TICK) assert.equal(p.mega, null);
  }
  assert.equal(formOf(p).id, "charizard-x");
  assert.equal(p.hp - hp, playerStats(p).maxHp - max);
  assert.ok(p.cardHold > 0 && p.invulnerable > 0);
  assert.deepEqual(
    w.events.filter((e) => e.t === "evolve" || e.t === "mega").map((e) => e.form),
    ["charizard", "charizard-x"],
  );
});

test("不变之石阻止进化石；过期奖杯不提交，下一份合格奖杯仍提供两块石", () => {
  const w = world(),
    p = w.players[0];
  function trophy() {
    collectRoutePickup(w, { kind: "trophy", owner: p.id, x: p.x, z: p.z }, p);
    return p.pending[0];
  }
  const stones = (card) =>
    card.options.filter((c) => c.item?.startsWith("charizardite-")).map((c) => c.item);
  assert.deepEqual(stones(trophy()), []);
  p.pending = [];
  selectTestExit(w, "coast");
  enterZone(w, prepareZone(w));
  let card = trophy();
  assert.deepEqual(stones(card), ["charizardite-x", "charizardite-y"]);
  p.items.push({ id: "everstone", level: 1 });
  const token = card.id;
  applyCommand(w, {
    t: "pick",
    card: token,
    player: 0,
    index: card.options.findIndex((c) => c.item === "charizardite-x"),
  });
  assert.notEqual(card.id, token);
  assert.deepEqual(stones(card), []);
  assert.equal(p.items.length, 1);
  p.pending = [];
  p.items = [];
  card = trophy();
  assert.deepEqual(stones(card), ["charizardite-x", "charizardite-y"]);
});

test("满道具栏的奖杯标出最早获得的最低级道具，变更后需重新确认", () => {
  const w = world(),
    p = w.players[0];
  selectTestExit(w, "coast");
  enterZone(w, prepareZone(w));
  p.items = ["magnet", "hp-up", "quick-claw", "lucky-egg", "scope-lens"].map((id, i) => ({
    id,
    level: i === 0 ? 3 : 1,
  }));
  p.hp = playerStats(p).maxHp;
  collectRoutePickup(w, { kind: "trophy", owner: 0, x: p.x, z: p.z }, p);
  const card = p.pending[0];
  const options = () => card.options.filter((c) => c.item?.startsWith("charizardite-"));
  assert.deepEqual(
    options().map((c) => [c.item, c.drop]),
    [
      ["charizardite-x", "hp-up"],
      ["charizardite-y", "hp-up"],
    ],
  );
  p.items[1].level++;
  const old = card.id;
  const pick = () =>
    applyCommand(w, {
      t: "pick",
      card: card.id,
      player: 0,
      index: card.options.indexOf(options()[1]),
    });
  pick();
  assert.notEqual(card.id, old);
  assert.equal(p.items[2].id, "quick-claw");
  assert.deepEqual(
    options().map((c) => c.drop),
    ["quick-claw", "quick-claw"],
  );
  pick();
  assert.deepEqual(
    p.items.map((i) => i.id),
    ["magnet", "hp-up", "lucky-egg", "scope-lens", "charizardite-y"],
  );
});

function megaGuest(branch, known) {
  const w = createWorld({
    mode: "expedition",
    rules: [],
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [
      { trainer: "chengxi", starter: "squirtle" },
      { trainer: "chengxi", starter: "charmander" },
    ],
  });
  selectTestExit(w, "coast");
  enterZone(w, prepareZone(w));
  const p = w.players[1];
  Object.assign(p, { level: stage2.at, stage: 2, moves: known.map(newMoveState) });
  collectRoutePickup(w, { kind: "trophy", owner: p.id, x: p.x, z: p.z }, p);
  const card = p.pending[0];
  applyCommand(w, {
    t: "pick",
    card: card.id,
    player: p.id,
    index: card.options.findIndex((c) => c.item === `charizardite-${branch}`),
  });
  assert.equal(p.mega, `charizard-${branch}`);
  const ticks = Math.ceil(p.cardHold / TICK) + 1;
  for (let i = 0; i < ticks; i++) {
    if (p.cardHold > 0) assert.equal(p.pending.length, 0);
    stepSharedWorld(w, []);
  }
  return w;
}

test("超级喷火龙Ｘ满招后房主提供逐招替换；重连可拒学且不消耗跳过次数", () => {
  const known = ["ember", "fire-spin", "flamethrower"];
  const w = megaGuest("x", known);
  const p = w.players[1],
    card = p.pending[0];
  assert.equal(card.source, "mega-move");
  assert.deepEqual(card.options, [
    ...known.map((replace) => ({ kind: "move", move: "flare-blitz", replace })),
    { kind: "decline" },
  ]);
  const restored = restoreWorld(w.map, snapshotWorld(w));
  applyCommand(w, { t: "pick", player: 1, card: card.id, index: 1 });
  assert.deepEqual(
    p.moves.map((m) => m.id),
    ["ember", "flare-blitz", "flamethrower"],
  );
  assert.equal(p.moves[1].level, 1);
  assert.equal(p.pending.length, 0);
  const guest = restored.players[1],
    before = structuredClone(guest.moves),
    skips = guest.skips;
  applyCommand(restored, { t: "pick", player: 1, card: card.id, index: known.length });
  assert.deepEqual(guest.moves, before);
  assert.equal(guest.skips, skips);
  assert.equal(guest.pending.length, 0);
});

test("超级喷火龙Ｙ有空栏可直接学日光束；已经学会时没有学招卡", () => {
  const w = megaGuest("y", ["ember"]),
    p = w.players[1],
    card = p.pending[0];
  const index = card.options.findIndex(
    (c) => c.kind === "move" && c.move === "solar-beam" && !c.replace,
  );
  applyCommand(w, { t: "pick", player: 1, card: card.id, index });
  assert.deepEqual(
    p.moves.map((m) => m.id),
    ["ember", "solar-beam"],
  );
  assert.equal(megaGuest("y", ["ember", "solar-beam"]).players[1].pending.length, 0);
});

test("持有进化石不出现不变之石，联机进化为火恐龙后仍可立即打开升级卡", () => {
  const w = createWorld({
    mode: "expedition",
    rules: [],
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [
      { trainer: "chengxi", starter: "squirtle" },
      { trainer: "chengxi", starter: "charmander" },
    ],
  });
  const p = w.players[1];
  p.level = stage1.at - 1;
  assert.ok(itemEligible(p, "everstone", [], true));
  applyChoice(p, { kind: "item", item: "charizardite-x" });
  assert.ok(!itemEligible(p, "everstone", [], true));
  gainXp(w, p, p.xpNext);
  assert.equal(formOf(p).id, "charmeleon");
  assert.equal(p.cardHold, 0);
});

test("守卫奖杯的进化石不能从上局背包带入", () => {
  assert.throws(
    () =>
      createPlayer(0, "charmander", 0, undefined, {
        backpack: ["charizardite-x"],
        rng: createRng(5),
      }),
    /本局的守卫奖杯/,
  );
});
