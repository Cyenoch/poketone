// Zones (openspec/specs/world-progression/spec.md): summoning at the landmark, clearing, leaving, and the next zone's field
// under players who keep everything they earned.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { killEnemy } from "../src/run/sim/combat.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { enterZone, prepareZone } from "../src/run/sim/zones.ts";
import { createWorld, isFrozen, stepWorld } from "../src/run/sim/world.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { STAGE_ROUTE } from "../src/run/sim/content/campaign.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { difficulties, SWARM_HP } from "../src/run/sim/content/difficulties.ts";
import { coopScaling } from "../src/run/sim/content/params/coop.ts";
import { zoneClock, zoneFactorsFor, zoneHealthClock } from "../src/run/sim/content/params/zones.ts";
import { ALPHA_HP } from "../src/run/sim/content/params/pacing.ts";
import {
  spawnEnemy,
  enemyScaling,
  enemyHealthScaling,
  updateDirector,
} from "../src/run/sim/director.ts";
import { damagePlayer } from "../src/run/sim/hurt.ts";
import { fireBeat } from "../src/run/sim/beats.ts";
import { TICK } from "../src/run/sim/state/world.ts";

const landmark = (world) => world.map.pads.find((pad) => pad.tag === "landmark");

test("ordinary reinforcements respond to nearby pressure without changing bodies or authored encounters", () => {
  function run(near, start, injured = false, guardian = false) {
    const world = createWorld({
      stage: "forest",
      seed: 11,
      difficulty: 0,
      players: [{ starter: "squirtle" }],
    });
    world.time = start;
    world.zone.tick = start / TICK;
    world.spawn.fired = stageDefs.forest.zones[0].beats.map(([at, beat]) => `${beat.kind}@${at}`);
    for (let i = 0; i < 24; i++) spawnEnemy(world, "pidgey", near ? 0 : 35, near ? 1 : 35);
    if (guardian) {
      const boss = spawnEnemy(world, "scyther", 0, 10);
      world.bossId = boss.id;
    }
    const bodies = world.enemies.map(({ hp, maxHp, dmg }) => ({ hp, maxHp, dmg }));
    const initial = world.enemies.length;
    for (let tick = 0; tick < 300; tick++) {
      world.time += TICK;
      if (injured && tick % 30 === 0) {
        world.players[0].hp = 30;
        world.players[0].invulnerable = 0;
        damagePlayer(world, world.players[0], 1);
      }
      updateDirector(world, TICK);
    }
    assert.deepEqual(
      world.enemies.slice(0, initial).map(({ hp, maxHp, dmg }) => ({ hp, maxHp, dmg })),
      bodies,
      "the director only changes reinforcements, never existing enemies",
    );
    return world.enemies.length - initial;
  }
  assert.equal(run(false, 0), run(true, 0), "opening supply is unchanged");
  const calm = run(false, 200);
  assert.ok(run(true, 200) < calm, "nearby crowd gives breathing room");
  assert.ok(run(false, 200, true) < calm, "repeated injuries matter even without a nearby body");
  assert.equal(
    run(false, 200, false, true),
    run(true, 200, true, true),
    "guardian supply stays authored",
  );
});

test("co-op pressure protects a downed teammate and resumes deterministically after pause and restore", async () => {
  const { snapshotWorld, restoreWorld } = await import("../src/run/sim/snapshot.ts");
  const world = createWorld({
    stage: "forest",
    seed: 11,
    difficulty: 0,
    players: [{ starter: "squirtle" }, { starter: "charmander" }],
  });
  world.time = 200;
  world.zone.tick = world.time / TICK;
  world.spawn.fired = stageDefs.forest.zones[0].beats.map(([at, beat]) => `${beat.kind}@${at}`);
  world.players[1].alive = false;
  world.players[1].hp = 0;
  for (let tick = 0; tick < 90; tick++) updateDirector(world, TICK);
  assert.ok(world.spawn.pressure > 0.5, "one downed teammate increases shared pressure");
  world.paused = true;
  const paused = snapshotWorld(world);
  stepWorld(world, []);
  assert.deepEqual(snapshotWorld(world), paused);
  const restored = restoreWorld(world.map, paused);
  for (const state of [world, restored]) stepWorld(state, [{ t: "pause", paused: false }]);
  for (let tick = 0; tick < 30; tick++) {
    stepWorld(world, []);
    stepWorld(restored, []);
  }
  assert.deepEqual(snapshotWorld(restored), snapshotWorld(world));
});

test("enemy durability ramps after the unchanged opening without changing its damage or loot", () => {
  for (const [difficulty, seats] of [
    [0, 1],
    [2, 4],
  ]) {
    const world = createWorld({
      stage: "forest",
      seed: 11,
      difficulty,
      players: Array.from({ length: seats }, () => ({ starter: "squirtle" })),
    });
    const def = enemies.pidgey;
    const stage = stageDefs[world.stage];
    const zone = zoneFactorsFor(stage, 0);
    let previousDurability = 1;
    for (const time of [0, 60, 120, 480]) {
      world.time = time;
      world.zone.tick = Math.round(time / TICK);
      const enemy = spawnEnemy(world, "pidgey", 0, 0);
      const base = enemyScaling(zoneClock(stage, 0, time), difficulty, null);
      const health = enemyScaling(zoneHealthClock(stage, 0, time), difficulty, null);
      const before = def.hp * health.hp * SWARM_HP * zone.hp * coopScaling(seats).hp;
      const durability = enemy.hp / before;
      if (time === 0) assert.ok(Math.abs(durability - 1) < 1e-12, "opening is unchanged");
      else assert.ok(durability > previousDurability, "extra durability grows through the field");
      previousDurability = durability;
      assert.equal(enemy.maxHp, enemy.hp);
      assert.ok(Math.abs(enemy.dmg - def.dmg * base.dmg * zone.dmg) < 1e-12);
      assert.ok(Math.abs(enemy.speed - def.speed * base.speed * zone.speed) < 1e-12);
      assert.equal(enemy.xp, def.xp * zone.xp * difficulties[difficulty].xp);
    }
  }
});

test("alpha durability changes without multiplying its damage or rewards", () => {
  const world = createWorld({
    stage: "forest",
    seed: 11,
    difficulty: 1,
    players: [{ starter: "squirtle" }, { starter: "charmander" }],
  });
  world.time = 480;
  world.zone.tick = Math.round(world.time / TICK);
  world.spawn.pool = ["pidgey"];
  fireBeat(world, { kind: "alpha" }, world.players[0]);
  const alpha = world.enemies.find((enemy) => enemy.alpha);
  assert.ok(alpha, "the real alpha beat spawns its headliner");
  const elite = spawnEnemy(world, alpha.species, 0, 0, true);
  assert.equal(alpha.hp, elite.hp * ALPHA_HP);
  assert.equal(alpha.maxHp, elite.maxHp * ALPHA_HP);
  assert.equal(alpha.dmg, elite.dmg);
  assert.equal(alpha.xp, elite.xp);
});

test("each map's guardian keeps its challenge across summon times and player growth", () => {
  const world = createWorld({
    stage: "forest",
    seed: 11,
    difficulty: 0,
    players: [{ starter: "squirtle" }],
  });
  const player = world.players[0];
  const attributes = (enemy) => ({ hp: enemy.maxHp, dmg: enemy.dmg, speed: enemy.speed });
  for (const stage of STAGE_ROUTE) {
    world.stage = stage;
    const species = stageDefs[stage].zones[0].guardian.species;
    for (const difficulty of [0, 1, 2]) {
      world.difficulty = difficulty;
      world.players = [player];
      world.zone.tick = 0;
      world.rampage = false;
      player.level = 1;
      player.items = [];
      const baseline = attributes(spawnEnemy(world, species, 0, 0));
      for (const time of [30, 300, 510, 600, 660]) {
        world.time = time;
        world.zone.tick = Math.round(time / TICK);
        world.rampage = time >= 600;
        player.level = 60;
        player.items = [{ id: "life-orb", level: 3 }];
        assert.deepEqual(
          attributes(spawnEnemy(world, species, 0, 0)),
          baseline,
          `${stage}/${difficulty}: summon at ${time}s with a stronger player`,
        );
      }
      for (const seats of [2, 4]) {
        world.players = Array.from({ length: seats }, (_, id) => ({ ...player, id }));
        const group = attributes(spawnEnemy(world, species, 0, 0));
        assert.ok(Math.abs(group.hp / baseline.hp - coopScaling(seats).bossHp) < 1e-12);
        assert.equal(group.dmg, baseline.dmg, "seats change endurance, not damage");
        assert.equal(group.speed, baseline.speed);
      }
      world.enemies = [];
    }
  }
});

test("later maps keep a durable enemy baseline while restarting their local pacing", () => {
  const world = createWorld({
    stage: "forest",
    seed: 11,
    difficulty: 0,
    players: [{ starter: "squirtle" }],
  });
  let previousHp = spawnEnemy(world, "pidgey", 0, 0).hp;
  for (const stageId of STAGE_ROUTE.slice(1)) {
    world.time += 600;
    world.zone.phase = "transitioning";
    const player = world.players[0];
    const level = player.level;
    const moves = structuredClone(player.moves);
    enterZone(world, prepareZone(world));
    assert.equal(world.stage, stageId);
    assert.equal(player.level, level);
    assert.deepEqual(player.moves, moves);
    const stage = stageDefs[stageId];
    const enemy = spawnEnemy(world, "pidgey", 0, 0);
    const base = enemyScaling(zoneClock(stage, 0, 0), 0, null);
    const factors = zoneFactorsFor(stage, 0);
    const healthClock = zoneHealthClock(stage, 0, 0);
    assert.ok(healthClock > zoneClock(stage, 0, 0), "later maps retain a durable HP-clock floor");
    const expectedHp = enemies.pidgey.hp * enemyHealthScaling(healthClock, 0, null) * factors.hp;
    assert.ok(Math.abs(enemy.hp / expectedHp - 1) < 1e-12);
    assert.ok(
      enemy.hp > previousHp,
      `${stageId} does not reset durability to the previous opening`,
    );
    assert.ok(Math.abs(enemy.dmg - enemies.pidgey.dmg * base.dmg * factors.dmg) < 1e-12);
    assert.ok(Math.abs(enemy.speed - enemies.pidgey.speed * base.speed * factors.speed) < 1e-12);
    previousHp = enemy.hp;
  }
});

/** Two players on the forest with a few ticks of fighting behind them. */
function fought(seed) {
  const world = createWorld({
    stage: "forest",
    seed,
    difficulty: 1,
    players: [{ starter: "charmander" }, { starter: "squirtle" }],
  });
  for (let tick = 0; tick < 300; tick++)
    stepWorld(world, [
      { t: "move", player: 0, x: Math.cos(tick / 40), z: Math.sin(tick / 40) },
      { t: "move", player: 1, x: -Math.cos(tick / 50), z: Math.sin(tick / 50) },
    ]);
  return world;
}

/** Answers every queued card with its first option until none is left. */
function answerAll(world) {
  for (let i = 0; i < 400 && world.players.some((player) => player.pending.length); i++)
    stepWorld(
      world,
      world.players.flatMap((player) =>
        player.pending[0]
          ? [{ t: "pick", player: player.id, card: player.pending[0].id, index: 0 }]
          : [],
      ),
    );
}

/** Summons at the landmark (player 0 walks onto it), kills the guardian and answers what it dropped. */
function clearZone(world) {
  const pad = landmark(world);
  const player = world.players[0];
  player.x = pad.x;
  player.z = pad.z;
  stepWorld(world, [{ t: "interact", player: 0 }]);
  const boss = world.enemies.find((enemy) => enemy.id === world.bossId);
  assert.ok(boss, "the interact summoned the guardian");
  killEnemy({ world, grid: new EnemyGrid() }, boss, player);
  stepWorld(world, []);
  answerAll(world);
}

test("the guardian is summoned once at the landmark; its fall clears the field and the co-op exit carries queued cards", () => {
  const world = fought(5);
  const pad = landmark(world);
  const player = world.players[0];
  // Off the landmark the interact does nothing.
  player.x = pad.x + pad.radius + 2;
  player.z = pad.z;
  stepWorld(world, [{ t: "interact", player: 0 }]);
  assert.equal(world.bossId, null);
  player.x = pad.x;
  player.z = pad.z;
  stepWorld(world, [
    { t: "interact", player: 0 },
    { t: "interact", player: 0 },
  ]);
  stepWorld(world, [{ t: "interact", player: 0 }]);
  assert.equal(world.enemies.filter((enemy) => enemy.boss).length, 1);

  world.pickups.push({ id: world.nextId++, kind: "xp", value: 1, x: 40, z: 40, magnet: false });
  killEnemy(
    { world, grid: new EnemyGrid() },
    world.enemies.find((e) => e.boss),
    player,
  );
  stepWorld(world, []);
  assert.equal(world.zone.phase, "cleared");
  assert.equal(world.enemies.length + world.projectiles.length + world.hazards.length, 0);
  assert.ok(
    world.pickups.some((pickup) => pickup.x === 40 && pickup.magnet),
    "distant pickups begin flying instead of being silently credited",
  );
  answerAll(world);
  // Optional co-op choices travel to the next zone instead of holding the team hostage.
  player.x = pad.x;
  player.z = pad.z;
  const pendingId = world.nextId++;
  world.players[1].pending.push({ id: pendingId, source: "level", options: [] });
  stepWorld(world, [{ t: "interact", player: 0 }]);
  assert.equal(world.zone.phase, "transitioning");
  assert(world.players[1].pending.some((card) => card.id === pendingId));
  assert.equal(world.pickups.length, 0, "departure settles remaining drops");
  assert.ok(isFrozen(world));
  assert.equal(world.outcome, "playing");
});

test("a guardian nobody summoned comes on its own with the final swarm", () => {
  const world = fought(9);
  world.zone.tick = 600 * 30 - 1;
  stepWorld(world, []);
  assert.ok(world.rampage);
  assert.equal(world.enemies.filter((enemy) => enemy.boss).length, 1);
});

/** What a player carries from zone to zone. */
const growth = (world) =>
  JSON.stringify(
    world.players.map(
      ({ level, xp, moves, items, hp, shield, stardust, kills, ult, revives, fx }) => ({
        level,
        xp,
        moves,
        items,
        hp,
        shield,
        stardust,
        kills,
        charge: ult.charge,
        revives,
        fx,
      }),
    ),
  );

test("the next map keeps every player's growth and resets the field, clock and guardian", () => {
  const world = fought(13);
  const [a, b] = world.players;
  a.level = 18;
  a.ult.charge = 0.7;
  b.stardust = 123;
  world.partners.push({
    id: world.nextId++,
    owner: 1,
    species: "pidgey",
    x: 20,
    z: 20,
    px: 20,
    pz: 20,
    faceX: 0,
    faceZ: 1,
    cooldown: 1,
    guard: 0,
  });
  world.stations.find((station) => station.kind === "bill").used = [0];
  const stations = world.stations.map(({ id, kind, used }) => [id, kind, used]);
  const terrain = Array.from(world.map.terrain.heights.slice(0, 64));
  clearZone(world);
  a.hp = 31;
  stepWorld(world, [{ t: "interact", player: 0 }]);
  assert.equal(world.zone.phase, "transitioning");
  const carried = growth(world);
  const { nextId, time } = world;
  enterZone(world, prepareZone(world));

  assert.equal(world.stage, "desert");
  assert.deepEqual(world.zone, { index: 0, tick: 0, phase: "active" });
  assert.equal(world.time, time, "the run clock carries on");
  assert.equal(world.nextId, nextId, "ids keep counting from where they were");
  assert.notDeepEqual(Array.from(world.map.terrain.heights.slice(0, 64)), terrain, "a new map");
  assert.equal(growth(world), carried);
  const [partner] = world.partners;
  assert.equal(partner?.owner, 1);
  assert.ok(Math.hypot(partner.x - b.x, partner.z - b.z) < 3, "the partner arrives with its owner");
  assert.deepEqual(
    world.stations.map(({ id, kind, used }) => [id, kind, used]),
    stations,
    "stations keep their identity and Bill stays used",
  );
  assert.equal(
    world.enemies.length + world.pickups.length + world.projectiles.length + world.areas.length,
    0,
  );
  assert.equal(world.bossId, null);
  assert.equal(world.rampage, false);
  assert.deepEqual(world.spawn, { credit: 0, pressure: 0.5, pool: [], fired: [], anchor: -1 });
  for (const player of world.players) assert.equal(player.z, 0, "players stand at the spawn");
  // The new zone plays from its own first tick.
  for (let tick = 0; tick < 90; tick++) stepWorld(world, []);
  assert.equal(world.zone.tick, 90);
  assert.ok(world.spawn.pool.length > 0);
});

test("the same seed and commands give the same state after entering the desert", () => {
  const digest = () => {
    const world = fought(21);
    clearZone(world);
    stepWorld(world, [{ t: "interact", player: 0 }]);
    enterZone(world, prepareZone(world));
    assert.equal(world.stage, "desert");
    for (let tick = 0; tick < 240; tick++)
      stepWorld(world, [{ t: "move", player: 0, x: Math.sin(tick / 30), z: 1 }]);
    // The nav is rebuilt from the map; events are per-tick output.
    const state = JSON.stringify(world, (key, value) =>
      key === "nav" || key === "events" || key === "terrain" ? undefined : value,
    );
    return createHash("sha256")
      .update(state)
      .update(new Uint8Array(world.map.terrain.heights.buffer))
      .digest("hex");
  };
  assert.equal(digest(), digest());
});

test("entering the tower carries growth, installs its walls and ends only at its exit deterministically", () => {
  // Location, input, afflictions and the cast in flight belong to the discarded field.
  const carriedPlayers = (world) =>
    world.players.map((player) => {
      const kept = structuredClone(player);
      for (const key of [
        "x",
        "z",
        "px",
        "pz",
        "vx",
        "vz",
        "inputX",
        "inputZ",
        "moving",
        "dashTime",
        "dialog",
        "statuses",
      ])
        delete kept[key];
      delete kept.ult.elapsed;
      delete kept.ult.crossed;
      return kept;
    });
  const wallCells = (nav) =>
    new Set(nav.blockers.flatMap((blocker) => (blocker.kind === "cells" ? blocker.cells : [])));
  const partnerState = ({ id, owner, species, faceX, faceZ, cooldown, guard }) => ({
    id,
    owner,
    species,
    faceX,
    faceZ,
    cooldown,
    guard,
  });
  const play = () => {
    const world = createWorld({
      stage: "volcano",
      seed: 7919,
      difficulty: 1,
      players: [{ starter: "charmander" }, { starter: "squirtle" }],
    });
    const [a, b] = world.players;
    a.level = 18;
    a.stage = 1;
    a.moves[0].level = 3;
    a.moves[0].damage = 321;
    a.items.push({ id: "leftovers", level: 1 });
    a.fx["tower-counter"] = 7;
    a.ult.charge = 0.7;
    b.stardust = 123;
    world.partners.push({
      id: world.nextId++,
      owner: 1,
      species: "pidgey",
      x: 20,
      z: 20,
      px: 20,
      pz: 20,
      faceX: 0,
      faceZ: 1,
      cooldown: 1,
      guard: 2,
    });
    world.stations.find((station) => station.kind === "bill").used = [0];
    const digests = [];
    for (const stage of ["volcano", "tower"]) {
      assert.equal(world.stage, stage);
      stepWorld(world, []);
      clearZone(world);
      a.hp = 31;
      a.dashCooldown = 0.8;
      a.statuses = [{ id: "poison", time: 5, power: 2, source: -1 }];
      a.ult.elapsed = 0.2;
      a.ult.crossed = [1];
      world.pickups.push({
        id: world.nextId++,
        kind: "xp",
        value: 1,
        x: 40,
        z: 40,
        magnet: false,
      });
      world.hazards.push({
        id: world.nextId++,
        kind: "slash",
        x: 0,
        y: 0,
        z: 0,
        px: 0,
        py: 0,
        pz: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 10,
        radius: 2,
        dmg: 5,
        dirX: 1,
        dirZ: 0,
        length: 0,
        rise: 0,
        caster: -1,
      });
      stepWorld(world, [{ t: "interact", player: 0 }]);
      if (stage === "tower") {
        assert.equal(world.outcome, "victory", "only leaving the cleared tower wins");
        break;
      }
      assert.equal(world.outcome, "playing");
      assert.equal(world.zone.phase, "transitioning");
      const carried = carriedPlayers(world);
      const partners = world.partners.map(partnerState);
      const stations = world.stations.map(({ id, kind, used }) => [id, kind, used]);
      const identity = [world.seed, world.tick, world.time, world.nextId];
      const rng = world.rng.state;
      const oldMap = world.map;
      const oldNav = world.nav;
      const prepared = prepareZone(world);
      assert.deepEqual([world.seed, world.tick, world.time, world.nextId], identity);
      assert.equal(world.rng.state, rng, "preparation never consumes the live fight RNG");
      assert.equal(world.map, oldMap, "preparation leaves the old map installed");
      assert.equal(world.nav, oldNav);
      enterZone(world, prepared);
      assert.equal(world.stage, "tower");
      assert.deepEqual(world.zone, { index: 0, tick: 0, phase: "active" });
      assert.equal(
        world.map.terrain.walls.template,
        stageDefs.tower.zones[0].map.templates[0].id,
        "the tower installs its authored template",
      );
      assert.deepEqual([world.seed, world.tick, world.time, world.nextId], identity);
      assert.notEqual(world.rng.state, rng, "a new map starts its own fight stream");
      assert.deepEqual(carriedPlayers(world), carried);
      assert.deepEqual(world.partners.map(partnerState), partners);
      assert.deepEqual(
        world.stations.map(({ id, kind, used }) => [id, kind, used]),
        stations,
      );
      assert.equal(
        world.pickups.length +
          world.hazards.length +
          world.projectiles.length +
          world.enemies.length +
          world.areas.length,
        0,
      );
      assert.equal(a.statuses.length, 0);
      assert.equal(a.ult.elapsed, -1);
      assert.deepEqual(a.ult.crossed, []);
      for (const player of world.players) assert.equal(player.z, player.pz);
      for (const partner of world.partners) {
        const owner = world.players.find((player) => player.id === partner.owner);
        assert.ok(Math.hypot(partner.x - owner.x, partner.z - owner.z) < 3);
        assert.equal(partner.x, partner.px);
        assert.equal(partner.z, partner.pz);
      }
      const walls = wallCells(world.nav);
      assert.notEqual(world.nav, oldNav, "navigation belongs to the installed map");
      assert.ok(walls.size > 0, "the tower has real wall occupancy");
      for (const cell of walls) assert.ok(world.nav.grid.hard[cell] > 0, "tower walls block");
      const state = JSON.stringify(world, (key, value) =>
        key === "nav" || key === "events" || key === "terrain" ? undefined : value,
      );
      digests.push(
        createHash("sha256")
          .update(state)
          .update(new Uint8Array(world.map.terrain.walls.heights.buffer))
          .update(world.map.terrain.walls.kinds)
          .digest("hex"),
      );
    }
    return { digests, result: world.outcome, stage: world.stage };
  };
  assert.deepEqual(play(), play());
});

test("guardian clear attracts field drops visibly and shares each reward once for one to four players", async () => {
  const { clearZone } = await import("../src/run/sim/currentZone.ts");
  const { sweepClearedField } = await import("../src/run/sim/zones.ts");
  for (const count of [1, 2, 4]) {
    const world = createWorld({
      stage: "forest",
      seed: 7,
      difficulty: 0,
      players: Array.from({ length: count }, () => ({ starter: "charmander" })),
    });
    for (const p of world.players) {
      p.moves = [];
      p.hp = 10;
    }
    world.pickups = ["xp", "stardust", "chest", "berry"].map((kind) => ({
      id: world.nextId++,
      kind,
      value: kind === "berry" ? 20 : 1,
      x: 40,
      z: 40,
      magnet: false,
    }));
    clearZone(world);
    sweepClearedField(world);
    assert.equal(world.pickups.length, 4, "clear starts flight, not instant credit");
    assert(world.pickups.every((p) => p.magnet));
    stepWorld(world, []);
    assert(world.pickups.every((p) => p.x < 40 && p.x > 5));
    assert(world.players.every((p) => p.xp === 0 && p.stardust === 0 && p.pending.length === 0));
    for (let n = 0; n < 120 && world.pickups.length; n++) stepWorld(world, []);
    assert.equal(world.pickups.length, 0);
    const earned = world.players.map((p) => ({
      xp: p.xp,
      dust: p.stardust,
      cards: p.pending.length,
    }));
    assert(earned.every((p) => p.xp > 0 && p.dust === 1 && p.cards === 1));
    assert.equal(
      world.players.filter((p) => p.hp > 10).length,
      1,
      "a berry heals its nearest recipient only",
    );
    for (let n = 0; n < 5; n++) stepWorld(world, []);
    assert.deepEqual(
      world.players.map((p) => ({ xp: p.xp, dust: p.stardust, cards: p.pending.length })),
      earned,
    );
  }
});

test("leaving during absorption settles remaining rewards without waiting and carries queued choices", async () => {
  const { clearZone } = await import("../src/run/sim/currentZone.ts");
  const { canLeave, interactAtLandmark, sweepClearedField } =
    await import("../src/run/sim/zones.ts");
  for (const count of [1, 4]) {
    const world = createWorld({
      stage: "forest",
      seed: 7,
      difficulty: 0,
      players: Array.from({ length: count }, () => ({ starter: "charmander" })),
    });
    const p = world.players[0],
      pad = landmark(world);
    p.x = pad.x;
    p.z = pad.z;
    world.pickups = [
      { id: world.nextId++, kind: "chest", value: 1, x: 40, z: 40, magnet: false },
      { id: world.nextId++, kind: "stardust", value: 7, x: 40, z: 40, magnet: false },
    ];
    clearZone(world);
    sweepClearedField(world);
    assert(canLeave(world), "in-flight drops do not gate departure");
    assert(interactAtLandmark(world, p));
    assert.equal(world.zone.phase, "transitioning");
    assert.equal(world.pickups.length, 0);
    assert(world.players.every((p) => p.stardust === 7 && p.pending.length === 1));
    enterZone(world, prepareZone(world));
    assert(world.players.every((p) => p.stardust === 7 && p.pending.length === 1));
  }
});
