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
import { ULT_INVULNERABLE, ULT_WINDUP } from "../src/run/sim/content/params/ultimates.ts";
import { starters } from "../src/run/sim/content/lines/index.ts";
import { damagePlayer } from "../src/run/sim/hurt.ts";
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

function fixture(ids = ["bulbasaur"]) {
  const world = createWorld({
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: ids.map((starter) => ({ starter })),
  });
  world.spawn.credit = -1e6;
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
  assert.equal(p.hp, hp);
  stepWorld(w, []);
  assert.equal(p.ult.protection, 0);
  assert.equal(p.invulnerable, 0);
  assert.equal(damagePlayer(w, p, 1), true);
});

test("existing slow clears and new controls fail while poison cannot damage", () => {
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
  w.zone.phase = "transitioning";
  enterZone(w, prepareZone(w));
  assert.equal(p.ult.elapsed, -1);
  assert.equal(p.ult.protection, 0);
  assert.equal(p.ult.charge, 0);
  w.spawn.credit = -1e6;
  ticks(w, 90);
  assert.equal(count(w, "ult-release"), 0);
  assert.equal(count(w, "ult-pulse"), 0);
});
