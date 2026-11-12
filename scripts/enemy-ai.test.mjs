import assert from "node:assert/strict";
import test from "node:test";
import { pack, unpack } from "../src/network/wire.ts";
import { aim, area, chestOf, projectile } from "../src/run/sim/archetypes/kit.ts";
import { moveParams, updateAreas, updateProjectiles } from "../src/run/sim/attacks.ts";
import { ENEMY_AIM } from "../src/run/sim/content/params/enemy-ai.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { mobilityClasses } from "../src/run/sim/content/mobility.ts";
import { moves } from "../src/run/sim/content/moves.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { updateEnemies } from "../src/run/sim/enemies.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { updateHazards } from "../src/run/sim/hazards.ts";
import {
  addCellBlocker,
  bodyFits,
  cellAt,
  createNav,
  hasWalkableLine,
} from "../src/run/sim/nav/index.ts";
import { applyMovementCommand, movePlayer } from "../src/run/sim/player-movement.ts";
import { restoreWorld, snapshotWorld } from "../src/run/sim/snapshot.ts";
import { warnOf } from "../src/run/sim/skills/shot.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { playerStats } from "../src/run/sim/stats.ts";
import { apply } from "../src/run/sim/status.ts";
import { TERRAIN_HALF } from "../src/run/sim/terrain.ts";
import { newMoveState } from "../src/run/sim/upgrades.ts";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";

// Same flat heightfield and real navigation setup as late-zones.test.mjs.
function arena(stage = "tower", local = 0) {
  const world = createWorld({ stage, seed: 3, difficulty: 0, players: [{ starter: "bulbasaur" }] });
  const samples = TERRAIN_HALF * 4 + 1;
  world.map.terrain = {
    origin: -TERRAIN_HALF,
    resolution: 2,
    samples,
    heights: new Float32Array(samples * samples),
    step: 1.5,
    levels: 3,
  };
  world.map.obstacles = [];
  world.nav = createNav(world.map.terrain);
  world.zone.index = 0;
  world.zone.tick = Math.round((local * stageDefs[stage].duration) / TICK);
  Object.assign(world.players[0], {
    x: 0,
    z: 0,
    px: 0,
    pz: 0,
    moves: [],
    choosing: false,
    hp: 1e6,
    invulnerable: 0,
  });
  return world;
}

function enemy(world, species = "meowth", x = 8, z = 0) {
  const e = spawnEnemy(world, species, x, z);
  e.attackTimer = 60;
  e.hp = e.maxHp = 1e6;
  return e;
}

function context(world) {
  return { world, grid: new EnemyGrid() };
}

function tick(ctx) {
  const { world } = ctx;
  world.tick++;
  world.time += TICK;
  ctx.grid.rebuild(world.enemies);
  updateEnemies(ctx, TICK);
  ctx.grid.rebuild(world.enemies);
  updateProjectiles(ctx, TICK);
  updateAreas(ctx, TICK);
  updateHazards(world, TICK);
}

const params = (world, id) => moveParams(newMoveState(id), playerStats(world.players[0]));
const dodging = (world, e) => (e.dodge?.until ?? 0) > world.time;

function incoming(world, e) {
  const p = world.players[0];
  const y = chestOf(world.map.terrain, p);
  const shot = projectile(
    world,
    p,
    moves.bubble,
    params(world, "bubble"),
    aim(world.map.terrain, p, y, e),
    y,
    0,
  );
  world.projectiles.push(shot);
  return shot;
}

function thunder(world, e) {
  const p = params(world, "thunder");
  return area(world, world.players[0], moves.thunder, p, "smite", {
    x: e.x,
    z: e.z,
    delay: p.dur,
    life: p.dur + 0.25,
  });
}

function lockShot(world, species = "seadra") {
  const e = enemy(world, species, -5);
  e.speed = 0;
  e.attackTimer = 0;
  const ctx = context(world);
  tick(ctx);
  assert.equal(e.phase, "windup", `${species} starts its own attack`);
  const lanes = world.hazards.filter((h) => h.kind === warnOf[enemies[species].skill.kind]);
  assert(lanes.length > 0, `${species} exposes its locked lane`);
  const lane = lanes[Math.floor(lanes.length / 2)];
  const p = world.players[0];
  const lead = lane.z + ((p.x - lane.x) * lane.dirZ) / lane.dirX - p.z;
  const tell = world.events.find((event) => event.t === "tell" && event.enemy === e.id);
  return { ctx, e, lane, lead, windup: tell.windup };
}

test("real shot lanes distinguish species and gain lead through the six single-field maps", () => {
  const progress = [
    ["forest", 0],
    ["forest", 0.5],
    ["desert", 0],
    ["coast", 0],
    ["glacier", 0],
    ["volcano", 0],
    ["tower", 0],
    ["tower", 1],
  ];
  const leads = {};
  for (const species of ["vulpix", "seadra"]) {
    let previous = 0;
    let windup;
    leads[species] = [];
    for (const [stage, local] of progress) {
      const w = arena(stage, local);
      w.players[0].vz = playerStats(w.players[0]).speed;
      const locked = lockShot(w, species);
      assert(locked.lead > previous, `${species}: lead grows at ${stage}/${local}`);
      assert(
        locked.lead <= ENEMY_AIM.maxDistance,
        "late prediction remains a short reachable lead",
      );
      if (windup !== undefined)
        assert.equal(locked.windup, windup, "progress preserves warning time");
      previous = locked.lead;
      windup = locked.windup;
      leads[species].push(locked.lead);
    }
  }
  for (let i = 0; i < progress.length; i++)
    assert(leads.seadra[i] > leads.vulpix[i], "Seadra anticipates farther than Vulpix");
});

test("a real player dash cannot amplify shot lead beyond walking; held input alone gives no lead", () => {
  const lead = (dash, moving) => {
    const w = arena();
    const p = w.players[0];
    applyMovementCommand(p, { t: "move", player: p.id, x: 0, z: 1 }, false);
    if (moving) {
      if (dash) applyMovementCommand(p, { t: "dash", player: p.id }, false);
      movePlayer(w, p, playerStats(p).speed, 0.2);
      assert.equal(
        p.vz > playerStats(p).speed,
        dash,
        "fixture uses actual dash or walking velocity",
      );
      p.x = p.px = p.z = p.pz = 0;
    }
    return lockShot(w, "jolteon").lead;
  };
  const walking = lead(false, true);
  const dashing = lead(true, true);
  assert(walking > 0);
  assert(Math.abs(dashing - walking) < 1e-8, "dash extrapolation is capped at ordinary walking");
  assert(dashing <= ENEMY_AIM.maxDistance);
  assert.equal(lead(false, false), 0, "prediction observes velocity rather than future input");
});

test("a predicted shot stops at an unclimbable cliff instead of aiming through it", () => {
  const w = arena();
  const p = w.players[0];
  p.vz = playerStats(p).speed;
  const { lead: open } = lockShot(w);
  const blocked = arena();
  blocked.players[0].vz = p.vz;
  const t = blocked.map.terrain;
  for (let row = 0; row < t.samples; row++)
    if (t.origin + row / t.resolution >= 1.5)
      t.heights.fill(4, row * t.samples, (row + 1) * t.samples);
  blocked.nav = createNav(t);
  const { lead } = lockShot(blocked);
  assert(open > 1.5, "the same unobstructed attack would lead past the cliff");
  assert(lead >= 0 && lead < 1.5, "the locked point stays below the cliff");
  assert(hasWalkableLine(blocked.nav, mobilityClasses.ground, 0, 0, 0, lead));
  const walker = blocked.players[0];
  applyMovementCommand(walker, { t: "move", player: walker.id, x: 0, z: 1 }, false);
  for (let i = 0; i < 30; i++) movePlayer(blocked, walker, playerStats(walker).speed, TICK);
  assert(Math.abs(lead - walker.z) < 1e-8, "prediction stops where the real player body stops");
});

test("turning after a shot warning cannot rotate its lane or its eventual projectile", () => {
  const w = arena();
  const p = w.players[0];
  p.vz = playerStats(p).speed;
  const { ctx, lane, windup } = lockShot(w);
  const direction = [lane.dirX, lane.dirZ, lane.rise];
  const started = w.time;
  applyMovementCommand(p, { t: "move", player: p.id, x: 0, z: -1 }, false);
  let shot;
  for (let i = 0; i < 60 && !shot; i++) {
    movePlayer(w, p, playerStats(p).speed, TICK);
    tick(ctx);
    const warning = w.hazards.find((h) => h.id === lane.id);
    if (warning) assert.deepEqual([warning.dirX, warning.dirZ, warning.rise], direction);
    shot = w.hazards.find((h) => h.kind === "water-gun");
    if (w.time - started < windup - TICK)
      assert.equal(shot, undefined, "the full warning must precede the shot");
  }
  assert(shot, "the warned attack actually fires");
  assert(p.z < 0 && shot.vz > 0, "the turned player leaves the originally predicted lane");
  const speed = Math.hypot(shot.vx, shot.vz);
  for (const [actual, expected] of [
    [shot.vx / speed, direction[0]],
    [shot.vz / speed, direction[1]],
    [shot.vy / speed, direction[2]],
  ])
    assert(Math.abs(actual - expected) < 1e-8, "release preserves the visible locked direction");
});

test("only a configured enemy sidesteps an incoming real projectile, and it remains damageable", () => {
  for (const [species, evades] of [
    ["meowth", true],
    ["caterpie", false],
  ]) {
    const w = arena();
    const e = enemy(w, species);
    const ctx = context(w);
    incoming(w, e);
    let movedSideways = false;
    for (let i = 0; i < 30; i++) {
      tick(ctx);
      if (dodging(w, e)) {
        movedSideways ||= Math.abs(e.z) > 0.05;
        // A second real attack lands on its present body during the sidestep.
        const mark = thunder(w, e);
        mark.delay = 0;
        const hp = e.hp;
        updateAreas(ctx, TICK);
        assert(e.hp < hp, "sidestepping grants no invulnerability to a colliding attack");
        break;
      }
    }
    assert.equal(movedSideways, evades, species);
    if (!evades) {
      assert.equal(e.z, 0, "an ordinary chaser does not gain active lateral movement");
      assert(e.hp < e.maxHp, "the incoming projectile really collides with the ordinary enemy");
    }
  }
});

test("projectile reactions take time, end after finite travel, and rearm only after cooldown", () => {
  const w = arena();
  const e = enemy(w);
  const ctx = context(w);
  incoming(w, e);
  for (let i = 0; i < 6; i++) {
    tick(ctx);
    assert.equal(e.z, 0, "a visible incoming shot does not cause an instant sidestep");
  }
  let start;
  for (let i = 0; i < 24 && start === undefined; i++) {
    tick(ctx);
    if (dodging(w, e)) start = { time: w.time, x: e.px, z: e.pz };
  }
  assert(start, "reaction completes while the projectile is approaching");
  while (dodging(w, e) && w.time - start.time < 1) tick(ctx);
  assert(!dodging(w, e), "one dodge cannot keep running indefinitely");
  assert(w.time - start.time <= 0.5, "the active movement is a brief sidestep");
  const distance = Math.hypot(e.x - start.x, e.z - start.z);
  assert(distance > 0.2 && distance < 1.6, "actual displacement stays local");

  const hp = e.hp;
  incoming(w, e);
  for (let i = 0; i < 40; i++) {
    tick(ctx);
    assert(!dodging(w, e), "a second real incoming shot cannot bypass cooldown");
  }
  assert(e.hp < hp, "the cooldown leaves a real punish window");
  const p = w.players[0];
  p.x = p.px = -25;
  p.z = p.pz = 0;
  while (w.time - start.time < 8) tick(ctx);
  p.x = p.px = e.x - 8;
  p.z = p.pz = e.z;
  incoming(w, e);
  let rearmed = false;
  for (let i = 0; i < 30 && !rearmed; i++) {
    tick(ctx);
    rearmed = dodging(w, e) && Math.abs(e.z - e.pz) > 0.01;
  }
  assert(rearmed, "elapsed world time eventually permits another finite sidestep");
});

test("a visible thunder warning can provoke a sidestep only through the open side of navigation", () => {
  const w = arena();
  const e = enemy(w, "meowth", 6);
  const cells = [];
  for (let x = -12; x <= 12; x += 0.5) cells.push(cellAt(w.nav.grid, x, 1));
  addCellBlocker(w.nav, cells);
  const mark = thunder(w, e);
  mark.z -= 0.8;
  const ctx = context(w);
  let moved = false;
  for (let i = 0; i < 15 && !moved; i++) {
    tick(ctx);
    if (dodging(w, e)) {
      assert(e.z < e.pz, "the blocked side is rejected before committing movement");
      assert(bodyFits(w.nav, mobilityClasses.ground, e.x, e.z, e.radius));
      assert(hasWalkableLine(w.nav, mobilityClasses.ground, e.px, e.pz, e.x, e.z));
      moved = true;
    }
  }
  assert(moved, "an already visible area warning is a real threat");
});

test("stopped, paralysed, charging and genuinely winding-up enemies cannot dodge an incoming hit", () => {
  for (const state of ["sleep", "freeze", "paralysis", "charge", "windup"]) {
    const w = arena();
    const e = enemy(w, "meowth", 5);
    const ctx = context(w);
    if (state === "windup") {
      e.attackTimer = 0;
      tick(ctx);
      assert.equal(e.phase, "windup", "the enemy's own skill commits its warning");
    } else if (state === "charge") {
      e.charge = true;
      e.dashX = -1;
    } else apply(e, state, 10, 0, -1);
    const start = [e.x, e.z];
    const lane = w.hazards.find((h) => h.kind === "pay-day-warn");
    const direction = lane && [lane.dirX, lane.dirZ];
    incoming(w, e);
    for (let i = 0; i < 15 && e.hp === e.maxHp; i++) {
      tick(ctx);
      assert(!dodging(w, e), `${state}: no active dodge`);
      if (state === "sleep" || state === "freeze")
        assert.deepEqual([e.x, e.z], start, `${state}: the body remains stopped until hit`);
      if (lane) assert.deepEqual([lane.dirX, lane.dirZ], direction, "the cast stays committed");
    }
    assert(
      e.hp < e.maxHp,
      `${state}: control or a committed attack cannot evade the real collision`,
    );
  }
});

test("encoded snapshots preserve both pending reactions and active sidesteps through identical continuation", () => {
  for (const boundary of ["reaction", "sidestep"]) {
    const w = arena();
    const e = enemy(w);
    const ctx = context(w);
    incoming(w, e);
    for (let i = 0; i < 30; i++) {
      tick(ctx);
      if (boundary === "reaction" ? e.dodge?.ready > w.time : dodging(w, e)) break;
    }
    if (boundary === "reaction") assert(e.dodge?.ready > w.time, "snapshot during reaction delay");
    else assert(dodging(w, e) && Math.abs(e.z) > 0.05, "snapshot during actual movement");
    const sent = unpack(pack({ map: w.map, snapshot: snapshotWorld(w) }));
    const restored = restoreWorld(sent.map, sent.snapshot);
    assert.deepEqual(snapshotWorld(restored), snapshotWorld(w), boundary);
    const hp = e.hp;
    for (let i = 0; i < 240; i++) {
      if (i === 30) {
        thunder(w, e);
        thunder(
          restored,
          restored.enemies.find((other) => other.id === e.id),
        );
      }
      const commands = [{ t: "move", player: 0, x: i < 120 ? -0.25 : 0.25, z: 0 }];
      stepWorld(w, commands);
      stepWorld(restored, commands);
      assert.deepEqual(restored.enemies, w.enemies, `${boundary}: tick ${i} movement and cooldown`);
      assert.deepEqual(restored.events, w.events, `${boundary}: tick ${i} damage and events`);
      if (i % 30 === 0) assert.deepEqual(snapshotWorld(restored), snapshotWorld(w), boundary);
    }
    assert(e.hp < hp, "continuation includes a real attack landing during cooldown");
    assert.deepEqual(
      snapshotWorld(restored),
      snapshotWorld(w),
      `${boundary}: final complete state`,
    );
  }
});
