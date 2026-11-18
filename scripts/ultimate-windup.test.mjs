import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCommand,
  createWorld,
  stepOwnedPlayer,
  stepSharedWorld,
  stepWorld,
} from "../src/run/sim/world.ts";
import {
  fireUltimate,
  chargeUltimate,
  timeline,
  updateUltimate,
} from "../src/run/sim/ultimates/index.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { chargeSurrounded } from "../src/run/sim/ultimates/crisis.ts";
import { damageEnemy, heal } from "../src/run/sim/combat.ts";
import { OwnerSimulation, ownerGrant, ownerState } from "../src/network/owner.ts";
import {
  ULT_CHARGE,
  ULT_CRISIS as C,
  ULT_INVULNERABLE,
  ULT_WINDUP,
} from "../src/run/sim/content/params/ultimates.ts";
import { starters } from "../src/run/sim/content/lines/index.ts";
import { damagePlayer, weatherDamagePlayer } from "../src/run/sim/hurt.ts";
import { apply, find, slowed, sustain } from "../src/run/sim/status.ts";
import { addHazard } from "../src/run/sim/skills/kit.ts";
import { updateHazards } from "../src/run/sim/hazards.ts";
import { pullPlayerSurface } from "../src/run/sim/surface-effects.ts";
import { onIce } from "../src/run/sim/skills/trail.ts";
import { heightAt } from "../src/run/sim/terrain.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { snapshotWorld, restoreWorld } from "../src/run/sim/snapshot.ts";
import { enterZone, prepareZone } from "../src/run/sim/zones.ts";
import { selectTestExit } from "./fixtures/route.mjs";

function fixture(ids = ["bulbasaur"]) {
  const world = createWorld({
    mode: "expedition",
    rules: [],
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: ids.map((starter) => ({ trainer: "chengxi", starter })),
  });
  world.zone.schedule = [];
  world.spawn.credit = -1e6;
  world.sites = [];
  for (const player of world.players) {
    player.moves = [];
    player.invulnerable = 0;
  }
  return world;
}
const ctx = (world) => ({ world, grid: new EnemyGrid() });
const count = (w, type, player) =>
  w.events.filter((e) => e.t === type && (player === undefined || e.player === player)).length;
const ticks = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w, []);
};
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
function start(w, player = w.players[0]) {
  player.ult.charge = 1;
  assert.equal(fireUltimate(w, player), true);
}

test("F rejects insufficient charge, consumes once and starts protection immediately", () => {
  const w = fixture(),
    p = w.players[0];
  p.ult.charge = 0.99;
  assert.equal(fireUltimate(w, p), false);
  assert.equal(p.ult.protection, 0);
  assert.equal(count(w, "ult"), 0);
  start(w);
  assert.equal(p.ult.charge, 0);
  assert.equal(p.ult.elapsed, 0);
  assert.equal(p.ult.protection, ULT_INVULNERABLE);
  const hp = p.hp;
  assert.equal(damagePlayer(w, p, 1000), false);
  assert.equal(p.hp, hp);
  assert.equal(fireUltimate(w, p), false);
  assert.equal(count(w, "ult"), 1);
  chargeUltimate(p, { maxHp: 10, xp: 1e6 }, 10);
  assert.equal(p.ult.charge, 0, "windup is still casting for charge suppression");
});

test("the first pulse waits exactly two seconds and release is emitted once", () => {
  const w = fixture(),
    p = w.players[0];
  start(w);
  ticks(w, 59);
  assert.equal(count(w, "ult-release"), 0);
  assert.equal(count(w, "ult-pulse"), 0);
  stepWorld(w, [
    { t: "ult", player: p.id },
    { t: "ult", player: p.id },
  ]);
  close(w.time, ULT_WINDUP);
  assert.equal(count(w, "ult-release"), 1);
  assert.ok(count(w, "ult-pulse") > 0);
  assert.equal(count(w, "ult"), 1);
  assert.equal(p.ult.elapsed, -1, "short pulse ends independently of protection");
  ticks(w, 30);
  assert.equal(count(w, "ult-release"), 1);
  assert.ok(p.ult.protection > 0, "a short ultimate cannot end the five-second protection early");
});

test("every ultimate preserves original pulse offsets after the two-second preparation", () => {
  for (const starter of ["charmander", "squirtle", "abra", "geodude"]) {
    const w = fixture([starter]),
      p = w.players[0];
    start(w);
    const pulses = timeline(starters[starter].ultimate, 0);
    const context = ctx(w);
    updateUltimate(context, p, ULT_WINDUP - TICK);
    assert.equal(p.ult.next, 0);
    updateUltimate(context, p, TICK);
    assert.equal(count(w, "ult-release"), 1);
    assert.equal(p.ult.next, pulses.filter((pulse) => pulse.at <= 1e-9).length);
    updateUltimate(context, p, pulses.at(-1).at + TICK);
    assert.equal(p.ult.next, pulses.length);
    assert.equal(p.ult.elapsed, -1);
    assert.equal(count(w, "ult-release"), 1);
  }
});

test("protection expires on tick 150 with no extra i-frame or floating-point tick", () => {
  const w = fixture(),
    p = w.players[0];
  start(w);
  p.shield = 100;
  const hp = p.hp;
  ticks(w, 149);
  assert.ok(p.ult.protection > 0);
  assert.equal(damagePlayer(w, p, 10), false);
  weatherDamagePlayer(w, p, 10);
  assert.equal(p.hp, hp);
  stepWorld(w, []);
  assert.equal(p.ult.protection, 0);
  assert.equal(p.invulnerable, 0);
  weatherDamagePlayer(w, p, 1);
  close(p.hp, hp - 1);
  assert.equal(damagePlayer(w, p, 1), true);
});

test("existing slow clears and new controls fail while poison and weather cannot damage", () => {
  const w = fixture(),
    p = w.players[0];
  apply(p, "slow", 8, 0, -1);
  apply(p, "poison", 10, 0, -1);
  start(w);
  assert.equal(find(p, "slow"), undefined);
  assert.ok(find(p, "poison"));
  apply(p, "slow", 8, 0, -1);
  sustain(p, "slow", 8, -1);
  assert.equal(find(p, "slow"), undefined);
  assert.equal(slowed(p, 10, 0, 0), 10);
  const hp = p.hp;
  w.weather = { id: "hail", from: 0, until: 75 };
  ticks(w, 149);
  assert.equal(p.hp, hp);
  stepWorld(w, []);
  sustain(p, "slow", 1, -1);
  assert.ok(find(p, "slow"));
  assert.ok(slowed(p, 10, 0, 0) < 10);
  stepWorld(w, []);
  assert.ok(p.hp < hp);
});

test("protection blocks hostile quicksand displacement and ice control but keeps movement and dash", () => {
  const w = fixture(),
    p = w.players[0];
  const x = p.x,
    z = p.z;
  const y = heightAt(w.map.terrain, x, z);
  const pit = addHazard(w, { kind: "quicksand-pit", x: x + 1, y, z, radius: 4, life: 10 });
  start(w);
  updateHazards(w, TICK);
  assert.equal(p.x, x);
  assert.equal(p.z, z);
  assert.equal(find(p, "slow"), undefined);
  addHazard(w, { kind: "ice-trail", x, y, z, radius: 4, life: 10, length: 3, dirX: 1 });
  assert.equal(onIce(w, p), false);
  stepWorld(w, [{ t: "move", player: p.id, x: 1, z: 0 }]);
  assert.ok(p.x > x);
  const beforeDash = p.x;
  stepWorld(w, [{ t: "dash", player: p.id }]);
  assert.ok(p.x > beforeDash);
  assert.ok(p.dashTime > 0);
  p.ult.protection = 0;
  p.x = x;
  p.z = z;
  p.dashTime = 0;
  w.hazards = [pit];
  updateHazards(w, TICK);
  assert.ok(p.x > x);
  assert.ok(find(p, "slow"));
});

test("hazard terrain cannot pull a protected player", () => {
  const w = fixture(),
    p = w.players[0];
  // Exercise the real terrain-surface lookup with a patch on the existing walkable spawn.
  const surface = w.map.terrain.surface;
  surface.patches.push({ kind: "quicksand", x: p.x + 1, z: p.z, radius: 4 });
  const x = p.x;
  start(w);
  pullPlayerSurface(w, p, TICK);
  assert.equal(p.x, x);
  p.ult.protection = 0;
  pullPlayerSurface(w, p, TICK);
  assert.ok(p.x > x);
});

test("pause and snapshot restore retain preparation and protection without replaying release", () => {
  const w = fixture();
  start(w);
  ticks(w, 30);
  applyCommand(w, { t: "pause", paused: true });
  const frozen = snapshotWorld(w);
  ticks(w, 90);
  assert.deepEqual(snapshotWorld(w), frozen);
  const restored = restoreWorld(w.map, frozen);
  for (const run of [w, restored]) {
    applyCommand(run, { t: "pause", paused: false });
    ticks(run, 120);
  }
  assert.deepEqual(snapshotWorld(restored), snapshotWorld(w));
  assert.equal(count(w, "ult-release"), 1);
  assert.equal(w.players[0].ult.protection, 0);
});

test("remote owner steps never double-decrement the shared protection clock", () => {
  const w = fixture(["bulbasaur", "bulbasaur"]),
    remote = w.players[1];
  start(w, remote);
  const context = { ...ctx(w), attackOwner: remote.id, report() {} };
  for (let i = 0; i < 150; i++) {
    const before = remote.ult.protection;
    stepOwnedPlayer(context, remote);
    assert.equal(remote.ult.protection, before);
    stepSharedWorld(w, []);
  }
  assert.equal(remote.ult.protection, 0);
  assert.equal(count(w, "ult-release", remote.id), 1);
});

test("entering the next field cancels preparation and protection without refund", () => {
  const w = fixture(),
    p = w.players[0];
  start(w);
  ticks(w, 10);
  selectTestExit(w, "desert");
  enterZone(w, prepareZone(w));
  assert.equal(p.ult.elapsed, -1);
  assert.equal(p.ult.protection, 0);
  assert.equal(p.ult.charge, 0);
  w.zone.schedule = [];
  w.spawn.credit = -1e6;
  w.sites = [];
  ticks(w, 90);
  assert.equal(count(w, "ult-release"), 0);
  assert.equal(count(w, "ult-pulse"), 0);
});

test("a safe or threshold crowd gives only base charge; a visible elite tips the balance", () => {
  const w = fixture(),
    p = w.players[0];
  ticks(w, 30);
  close(p.ult.charge, ULT_CHARGE.time);
  assert.equal(p.crisis.lastTick, null);
  const context = ctx(w);
  const enemies = Array.from({ length: C.threshold }, () => spawnEnemy(w, "rattata", p.x, p.z));
  spawnEnemy(w, "rattata", p.x + C.radius + 1, p.z, true);
  context.grid.rebuild(w.enemies);
  chargeSurrounded(context, p);
  close(p.ult.charge, ULT_CHARGE.time);
  enemies[0].elite = true;
  chargeSurrounded(context, p);
  close(p.ult.charge, ULT_CHARGE.time + C.perBody * (C.eliteWeight - 1));
  assert.equal(p.crisis.lastTick, w.tick);
});

test("crisis credits only HP actually lost after a shield, without spending damage credit", () => {
  const w = fixture(),
    p = w.players[0],
    maxHp = p.hp;
  p.shield = 12;
  damagePlayer(w, p, 5);
  assert.equal(p.ult.charge, 0);
  p.invulnerable = 0;
  const room = p.ult.room;
  damagePlayer(w, p, 20);
  assert.ok(p.hp < maxHp);
  close(p.ult.charge, (C.perHpBar * (maxHp - p.hp)) / maxHp);
  assert.equal(p.ult.room, room);
  const before = p.hp,
    charge = p.ult.charge;
  apply(p, "poison", 5, 0, -1);
  stepWorld(w, []);
  assert.ok(p.hp < before);
  close(p.ult.charge - charge, (C.perHpBar * (before - p.hp)) / maxHp + TICK * ULT_CHARGE.time);
});

test("weather and Flare Blitz recoil remove real HP without awarding crisis charge", () => {
  const w = fixture(),
    p = w.players[0];
  const hp = p.hp;
  weatherDamagePlayer(w, p, 5);
  close(p.hp, hp - 5);
  const enemy = spawnEnemy(w, "rattata", p.x, p.z);
  p.ult.room = 0;
  damageEnemy(ctx(w), enemy, {
    owner: p,
    move: "flare-blitz",
    type: "fire",
    dmg: 1,
    crit: 0,
    knock: 0,
    statusChance: 0,
    fromX: p.x,
    fromZ: p.z,
    recoil: true,
  });
  assert.ok(p.hp < hp - 5);
  assert.equal(p.ult.charge, 0);
  assert.equal(p.crisis.lastTick, null);
});

test("restored healing and encirclement share the same finite crisis window", () => {
  const w = fixture(),
    p = w.players[0],
    maxHp = p.hp;
  w.tick = 30;
  for (let n = 0; n < 8; n++) spawnEnemy(w, "rattata", p.x, p.z);
  const crowd = ctx(w);
  crowd.grid.rebuild(w.enemies);
  chargeSurrounded(crowd, p);
  assert.ok(p.ult.charge > 0);
  damagePlayer(w, p, maxHp / 2);
  const copy = restoreWorld(w.map, JSON.parse(JSON.stringify(snapshotWorld(w))));
  for (const run of [w, copy]) {
    const seat = run.players[0];
    for (let i = 0; i < 3; i++) {
      heal(seat, maxHp);
      seat.invulnerable = 0;
      damagePlayer(run, seat, maxHp / 2);
    }
    close(seat.ult.charge, C.cap);
    const stamped = seat.crisis.lastTick;
    run.tick += Math.round(C.windowSeconds / TICK) - 1;
    seat.invulnerable = 0;
    damagePlayer(run, seat, 1);
    close(seat.ult.charge, C.cap);
    assert.equal(seat.crisis.lastTick, stamped);
    run.tick++;
    seat.invulnerable = 0;
    damagePlayer(run, seat, 1);
    assert.ok(seat.ult.charge > C.cap);
    assert.equal(seat.crisis.lastTick, run.tick);
  }
  assert.deepEqual(snapshotWorld(copy), snapshotWorld(w));
});

test("a remote player's crowd is settled once by the host and reaches its owner", () => {
  const w = fixture(["bulbasaur", "bulbasaur"]),
    [host, remote] = w.players;
  host.x = remote.x + C.radius + 4;
  for (let n = 0; n < 4; n++) spawnEnemy(w, "rattata", remote.x, remote.z);
  remote.invulnerable = 5;
  w.tick = 29;
  const owner = new OwnerSimulation(w, remote.id, -2e12),
    before = ownerState(remote);
  owner.advance(w, [], 1, false);
  const predicted = owner.player.ult.charge;
  close(predicted, ULT_CHARGE.time);
  stepSharedWorld(w, []);
  assert.equal(host.crisis.lastTick, null);
  close(remote.ult.charge, C.perBody);
  owner.sync(remote, [ownerGrant(before, remote, 1)], false, w.time);
  close(owner.player.ult.charge, predicted + C.perBody);
  assert.equal(owner.player.crisis.lastTick, w.tick);
});

test("a hit that fills the crisis window keeps a restorable snapshot", () => {
  const w = fixture(),
    p = w.players[0],
    maxHp = p.hp;
  w.tick = 30;
  let spent = 0;
  for (let i = 0; i < 18; i++) spent += 0.01;
  p.crisis = { startTick: w.tick, spent, lastTick: w.tick };
  damagePlayer(w, p, maxHp * 0.9);
  assert.ok(p.crisis.spent <= C.cap);
  restoreWorld(w.map, JSON.parse(JSON.stringify(snapshotWorld(w))));
});

test("a crowd put to sleep does not count as encirclement", () => {
  const w = fixture(),
    p = w.players[0];
  w.tick = 30;
  const crowd = Array.from({ length: 8 }, () => spawnEnemy(w, "rattata", p.x, p.z));
  for (const enemy of crowd) apply(enemy, "sleep", 5, 0, -1);
  const context = ctx(w);
  context.grid.rebuild(w.enemies);
  chargeSurrounded(context, p);
  assert.equal(p.ult.charge, 0);
  assert.equal(p.crisis.lastTick, null);
});
