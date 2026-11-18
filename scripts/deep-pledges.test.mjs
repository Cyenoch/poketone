import assert from "node:assert/strict";
import test from "node:test";
import { OwnerSimulation } from "../src/network/owner.ts";
import { validateOwner } from "../src/network/owner-protocol.ts";
import { MultiplayerRun } from "../src/network/run.ts";
import { pack, unpack } from "../src/network/wire.ts";
import { updateAreas, updateMoves } from "../src/run/sim/attacks.ts";
import { commitCombat } from "../src/run/sim/combat.ts";
import { activeWeather } from "../src/run/sim/content/weather.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { updateEnemies } from "../src/run/sim/enemies.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { createRng } from "../src/run/sim/rng.ts";
import { restoreWorld, snapshotWorld } from "../src/run/sim/snapshot.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { learnable, newMoveState } from "../src/run/sim/upgrades.ts";
import { castWeather, startWeather, updateWeather } from "../src/run/sim/weather.ts";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";
import { routeTo } from "./fixtures/route.mjs";

function arena(starters, stage = "forest") {
  const w = createWorld({
    mode: "expedition",
    rules: [],
    seed: 3,
    stage,
    route: routeTo(stage),
    difficulty: 0,
    players: starters.map((starter) => ({ trainer: "chengxi", starter })),
  });
  w.zone.schedule = [];
  w.spawn.credit = -10000;
  w.events = [];
  for (const p of w.players) p.moves = [];
  return w;
}
function context(world) {
  const grid = new EnemyGrid();
  grid.rebuild(world.enemies);
  return { world, grid };
}
function ready(player, ...ids) {
  player.moves = ids.map((id) => ({ ...newMoveState(id), cooldown: 0 }));
}
function target(w, x = 0, z = 2) {
  const e = spawnEnemy(w, "rattata", x, z);
  e.hp = e.maxHp = 10000;
  e.speed = 0;
  return e;
}
const restored = (w) => restoreWorld(w.map, unpack(pack(snapshotWorld(w))));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const combinations = (w) => w.events.filter((e) => e.t === "pledge");
const starts = (w) =>
  w.events.filter((e) => e.t === "weather" && e.phase === "start").map((e) => e.id);

test("三种天气招式在森林即时覆盖，只有施放者的对应岩石能延长", () => {
  const w = arena(["charmander", "squirtle", "geodude"]);
  const [fire, water, rock] = w.players;
  fire.items.push({ id: "heat-rock", level: 1 }, { id: "damp-rock", level: 1 });
  water.items.push({ id: "heat-rock", level: 1 });
  rock.items.push({ id: "smooth-rock", level: 3 });
  for (const [player, move, weather, duration] of [
    [fire, "sunny-day", "sun", 48],
    [water, "rain-dance", "rain", 30],
    [rock, "sandstorm", "sandstorm", 48],
  ]) {
    w.time++;
    ready(player, move);
    updateMoves(context(w), player, TICK);
    assert.equal(activeWeather(w), weather);
    assert.equal(w.weather.until - w.time, duration);
    assert.equal(player.moves[0].cooldown, 40);
    updateWeather(context(w), TICK);
  }
  assert.deepEqual(starts(w), ["sun", "rain", "sandstorm"]);
  assert.equal(w.events.filter((e) => e.t === "banner" && e.kind === "weather").length, 3);
});

test("野外预报只起效一次；同一施法步的求雨让后发打雷与野外雨同样立即多落一柱", () => {
  const sample = (source) => {
    const w = arena(["pikachu"], "coast");
    if (source === "field") {
      startWeather(w, "rain");
      assert.equal(activeWeather(w), null);
      w.time = w.weather.from;
      updateWeather(context(w), TICK);
      updateWeather(context(w), TICK);
    }
    for (const x of [-1.5, 0, 1.5, 3]) target(w, x, 2);
    const p = w.players[0];
    ready(p, ...(source === "move" ? ["rain-dance", "thunder"] : ["thunder"]));
    updateMoves(context(w), p, TICK);
    updateAreas(context(w), TICK);
    if (source !== "clear") assert.deepEqual(starts(w), ["rain"]);
    return {
      count: w.areas.filter((a) => a.move === "thunder").length,
      hurt: w.enemies.some((e) => e.hp < e.maxHp),
    };
  };
  assert.deepEqual(sample("clear"), { count: 2, hurt: false });
  assert.deepEqual(sample("field"), { count: 3, hurt: true });
  assert.deepEqual(sample("move"), { count: 3, hurt: true });
});

test("客机天气按施放时刻到期，较新天气结束并恢复快照后也不回滚", () => {
  const w = arena(["charmander", "squirtle"]);
  const [host, guest] = w.players;
  guest.items.push({ id: "damp-rock", level: 1 });
  ready(guest, "rain-dance");
  const owner = new OwnerSimulation(w, 1, -2e12);
  owner.advance(w, [], TICK, false);
  const f = owner.frame();
  validateOwner(f, guest);
  const cast = f.effects.find((e) => e.t === "weather-cast");
  assert.ok(cast);
  assert.equal(w.weather, null);
  w.time = 3;
  commitCombat(context(w), guest, cast);
  close(w.weather.until, TICK + 48);
  w.time = 5;
  castWeather(w, host, "sunny-day", w.time);
  commitCombat(context(w), guest, cast);
  assert.equal(activeWeather(w), "sun");
  w.time = 35;
  updateWeather(context(w), TICK);
  const back = restored(w);
  commitCombat(context(back), back.players[1], cast);
  assert.equal(back.weather, null);
  assert.deepEqual(starts(back), ["rain", "sun"]);
});

// Host-bound collision facts name target IDs; geometry is the column centre, not a victim's feet.
function land(w, seat, move, x = 0, { at = w.time, z = 2 } = {}) {
  commitCombat(context(w), w.players[seat], {
    t: "pledge-hit",
    move,
    x,
    z,
    at,
    enemies: w.enemies.map((e) => e.id),
  });
}

test("单人只能学本线誓约，柱子照常造成伤害并附带相应状态", () => {
  for (const [starter, move, status] of [
    ["charmander", "fire-pledge", "burn"],
    ["squirtle", "water-pledge", "wet"],
    ["bulbasaur", "grass-pledge", "root"],
  ]) {
    const w = arena([starter]);
    const p = w.players[0];
    p.level = 40;
    assert.deepEqual(
      learnable(p)
        .map((offer) => offer.move)
        .filter((id) => id.endsWith("-pledge")),
      [move],
    );
    const enemy = target(w);
    ready(p, move);
    updateMoves(context(w), p, TICK);
    w.rng = createRng(1);
    for (let i = 0; i < 30; i++) updateAreas(context(w), TICK);
    assert.ok(enemy.hp < enemy.maxHp && enemy.statuses.some((s) => s.id === status));
    assert.deepEqual(combinations(w), []);
  }
});

test("誓约要求两个席位、两种柱及有效时空窗口；踩线可配，两根各参与一次", () => {
  for (const [n, seat, move, distance, seconds, result] of [
    [1, 0, "fire-pledge", 0, 0, false],
    [2, 0, "fire-pledge", 0, 0, false],
    [2, 1, "grass-pledge", 0, 0, false],
    [2, 1, "fire-pledge", 2.51, 1, false],
    [2, 1, "fire-pledge", 2, 1.5 + TICK, false],
    [2, 1, "fire-pledge", 2.5, 1.5, true],
  ]) {
    const w = arena(["bulbasaur", "charmander"].slice(0, n));
    target(w);
    w.time = 5;
    land(w, 0, "grass-pledge");
    w.time += seconds;
    land(w, seat, move, distance);
    assert.equal(combinations(w).length, Number(result));
    if (result) {
      assert.deepEqual(combinations(w)[0], { t: "pledge", result: "sea-of-fire", x: 1.25, z: 2 });
      land(w, 0, "grass-pledge", distance);
      assert.equal(combinations(w).length, 1);
    }
  }
});

test("落空、目标潜地与过期的客机誓约不能形成组合", () => {
  const w = arena(["bulbasaur", "charmander"]);
  const e = target(w);
  ready(w.players[0], "grass-pledge");
  updateMoves(context(w), w.players[0], TICK);
  e.z += 6;
  for (let i = 0; i < 30; i++) updateAreas(context(w), TICK);
  assert.equal(e.hp, e.maxHp);
  assert.deepEqual(w.pledgeHits, []);
  w.time = 4;
  land(w, 0, "grass-pledge");
  land(w, 1, "fire-pledge", 0, { at: 2 });
  e.phase = "under";
  land(w, 1, "fire-pledge");
  assert.equal(combinations(w).length, 0);
});

test("火海按真实火柱归属持续 8 秒；第一柱和半程场地恢复后同帧续跑", () => {
  const a = arena(["charmander", "bulbasaur"]);
  const e = target(a);
  land(a, 0, "fire-pledge");
  const b = restored(a);
  for (const w of [a, b]) {
    land(w, 1, "grass-pledge");
    assert.equal(w.areas[0].owner, 0);
    const weak = target(w, 1.5, 2);
    weak.hp = 0.1;
    for (let i = 0; i < 90; i++) stepWorld(w, []);
    assert.equal(w.players[0].kills, 1);
    assert.equal(w.players[1].kills, 0);
    close(w.enemies.find((enemy) => enemy.id === e.id).hp, 10000 - 24);
  }
  const c = restored(b);
  for (const w of [a, b, c]) {
    for (let i = 0; i < 150; i++) stepWorld(w, []);
    close(w.enemies.find((enemy) => enemy.id === e.id).hp, 10000 - 64);
    assert.equal(w.areas.length, 0);
  }
  assert.deepEqual(snapshotWorld(a), snapshotWorld(b));
  assert.deepEqual(snapshotWorld(a), snapshotWorld(c));
});

test("湿地内敌人步幅减半，离开场地立即恢复", () => {
  const w = arena(["bulbasaur", "squirtle"]);
  target(w).speed = 2;
  land(w, 0, "grass-pledge");
  land(w, 1, "water-pledge");
  assert.equal(combinations(w)[0].result, "swamp");
  const control = restored(w);
  control.areas = [];
  const travel = (world) => {
    const e = world.enemies[0];
    const { x, z } = e;
    updateEnemies(context(world), TICK);
    return Math.hypot(e.x - x, e.z - z);
  };
  const full = travel(control);
  assert.ok(full > 0);
  close(travel(w), full / 2);
  for (const state of [w, control]) Object.assign(state.enemies[0], { x: 6, z: 2 });
  close(travel(w), travel(control));
});

test("彩虹在房主命中时覆盖第三席在途招式，十秒后命中回到普通概率", () => {
  const w = arena(["charmander", "squirtle", "pikachu"]);
  target(w, 0, 4);
  const third = w.players[2];
  third.items.push({ id: "flame-orb", level: 1 });
  ready(third, "thunder-shock");
  const owner = new OwnerSimulation(w, 2, -3e12);
  owner.advance(w, [], TICK, false);
  assert.ok(owner.frame().projectiles.length && !owner.frame().effects.length);
  const clear = restored(w);
  land(w, 0, "fire-pledge");
  land(w, 1, "water-pledge");
  assert.equal(combinations(w)[0].result, "rainbow");
  owner.advance(w, [], 12 * TICK, false);
  const f = owner.frame();
  validateOwner(f, third);
  const hit = f.effects.find((e) => e.t === "hit");
  assert.ok(hit);
  const statusLands = (world, seed) => {
    world.rng = createRng(seed);
    const enemy = world.enemies[0];
    enemy.statuses = [];
    commitCombat(context(world), world.players[2], hit);
    return enemy.statuses.map((s) => s.id);
  };
  // These rolls fall between the ordinary and doubled chances for both the move and Flame Orb.
  assert.deepEqual(statusLands(clear, 13), []);
  const rainbow = restored(w);
  rainbow.time = 10 - TICK;
  assert.deepEqual(statusLands(rainbow, 13), ["paralysis", "burn"]);
  assert.ok(!statusLands(rainbow, 5).includes("paralysis"), "不能在客机和房主各翻倍一次");
  rainbow.time += TICK;
  assert.deepEqual(statusLands(rainbow, 13), []);
});

test("客机实跑的一根柱命中两只怪，房主接包结算一次，重传不追加场地或伤害", () => {
  const w = arena(["bulbasaur", "charmander"]);
  const victims = [target(w), target(w, 0.5, 2)];
  const [first, guest] = w.players;
  ready(first, "grass-pledge");
  ready(guest, "fire-pledge");
  let receive, map;
  const host = new MultiplayerRun(
    {
      state: { self: 0 },
      isReachable: () => true,
      receive(fn) {
        receive = fn;
        return () => {};
      },
      send(packet) {
        if (packet.t === "map") map = packet;
        return true;
      },
      fail(error) {
        throw error;
      },
    },
    { players: w.players },
  );
  host.publishMap(w);
  receive({ t: "ready", revision: map.revision }, 1);
  const remote = restoreWorld(map.map, map.snapshot);
  const owner = new OwnerSimulation(remote, 1, map.nextId);
  updateMoves(context(w), first, TICK);
  for (let i = 0; i < 25; i++) {
    w.time += TICK;
    updateAreas(context(w), TICK);
    owner.advance(remote, [], TICK, false);
  }
  const frame = owner.frame();
  assert.equal(combinations(remote).length, 0);
  assert.deepEqual(remote.pledgeHits, []);
  assert.ok(remote.enemies.every((e) => e.hp === e.maxHp));
  assert.equal(combinations(w).length, 0);
  const health = victims.map((e) => e.hp);
  const packet = {
    ...frame,
    t: "owner",
    revision: map.revision,
    sequence: 1,
    grantAck: 0,
    eventAck: -1,
    life: 0,
  };
  receive(unpack(pack(packet)), 1);
  assert.deepEqual(
    combinations(w).map((e) => e.result),
    ["sea-of-fire"],
  );
  assert.deepEqual(w.pledgeHits, [], "一个命中多目标的柱不能留下额外的配对机会");
  assert.equal(w.areas.find((a) => a.pledgeField).owner, guest.id);
  assert.ok(victims.every((e, i) => e.hp < health[i] && health[i] < e.maxHp));
  const once = snapshotWorld(w);
  receive(unpack(pack(packet)), 1);
  assert.deepEqual(snapshotWorld(w), once);
  assert.throws(
    () =>
      validateOwner(
        {
          ...frame,
          areas: [{ ...w.areas.find((a) => a.pledgeField), owner: guest.id, id: -2e12 }],
        },
        guest,
      ),
    /范围攻击/,
  );
  for (const event of [...combinations(w), { t: "mega", player: guest.id, form: "charizard-x" }])
    assert.throws(
      () => validateOwner({ ...frame, events: [event], eventAges: [0] }, guest),
      /共享/,
    );
});
