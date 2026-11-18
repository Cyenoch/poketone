import assert from "node:assert/strict";
import test from "node:test";
import { routeTo, selectTestExit } from "./fixtures/route.mjs";
import { prepareZone, enterZone } from "../src/run/sim/zones.ts";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";
import { snapshotWorld, restoreWorld } from "../src/run/sim/snapshot.ts";
import { scheduleField, fireFieldEvent } from "../src/run/sim/field-events.ts";
import { startWeather, updateWeather } from "../src/run/sim/weather.ts";
import { activeWeather } from "../src/run/sim/content/weather.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { SHINY } from "../src/run/sim/content/params/field-events.ts";
import { spawnEnemy, updateDirector } from "../src/run/sim/director.ts";
import { updateEnemies } from "../src/run/sim/enemies.ts";
import { encounterSpecies, updateEncounters } from "../src/run/sim/encounters.ts";
import { damageEnemy, inflictBy } from "../src/run/sim/combat.ts";
import { damagePlayer, weatherDamagePlayer } from "../src/run/sim/hurt.ts";
import { moveParams } from "../src/run/sim/attacks.ts";
import { playerStats, refreshStats } from "../src/run/sim/stats.ts";
import { newMoveState } from "../src/run/sim/upgrades.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { ARENA_HALF, TICK } from "../src/run/sim/state/world.ts";
import { createRng, next } from "../src/run/sim/rng.ts";
import { apply, find } from "../src/run/sim/status.ts";
import { addHazard } from "../src/run/sim/skills/kit.ts";
import { updateHazards } from "../src/run/sim/hazards.ts";
import { heightAt } from "../src/run/sim/terrain.ts";
import { viewClearance } from "../src/run/sim/viewFootprint.ts";
import { addCircleBlocker, createNav } from "../src/run/sim/nav/index.ts";

const world = (starters = ["charmander"], stage = "forest") =>
  createWorld({
    mode: "expedition",
    rules: [],
    stage,
    route: routeTo(stage),
    seed: 3,
    difficulty: 0,
    players: starters.map((starter) => ({ trainer: "chengxi", starter })),
  });
const context = (w) => {
  const grid = new EnemyGrid();
  grid.rebuild(w.enemies);
  return { world: w, grid };
};
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const hit = (w, type = "normal", dmg = 10) => ({
  owner: w.players[0],
  move: null,
  type,
  dmg,
  crit: -100,
  statusChance: 0,
  knock: 0,
  fromX: 0,
  fromZ: 0,
});
function forceShiny(w) {
  let seed = 0;
  while (next(createRng(seed)) >= SHINY.chance) seed++;
  w.rng = createRng(seed);
  w.spawn.shinySpawned = false;
  return spawnEnemy(w, "caterpie", 10, 10);
}

function escapeArena() {
  const w = world();
  const terrain = { ...w.map.terrain, heights: new Float32Array(w.map.terrain.heights.length) };
  delete terrain.surface;
  w.map = { ...w.map, terrain };
  w.nav = createNav(terrain);
  w.sites = [];
  w.stations = [];
  return w;
}

test("field schedule is deterministic, bounded and never repeats events across maps", () => {
  for (const path of [
    ["forest", "desert", "glacier", "tower"],
    ["forest", "coast", "volcano", "tower"],
  ]) {
    const team = ["charmander", "squirtle"];
    const a = world(team),
      b = world(team);
    const seen = new Set();
    for (const stage of path) {
      if (stage !== "forest")
        for (const w of [a, b]) {
          selectTestExit(w, stage);
          enterZone(w, prepareZone(w));
        }
      assert.deepEqual(a.zone.schedule, b.zone.schedule);
      const def = stageDefs[stage].zones[0];
      for (const entry of a.zone.schedule) {
        const windows =
          entry.beat.kind === "event"
            ? def.events.windows
            : def.beats.filter((row) => row.beat === entry.beat).map((row) => row.window);
        assert.ok(windows.some(([from, to]) => entry.at >= from && entry.at <= to));
        if (entry.beat.kind === "event") {
          assert.ok(!seen.has(entry.beat.id), `${stage} repeated ${entry.beat.id}`);
          seen.add(entry.beat.id);
        }
      }
      assert.deepEqual(a.eventsUsed, [...seen]);
    }
  }
  const a = world();
  a.eventsUsed = [...stageDefs.forest.zones[0].events.pool];
  scheduleField(a);
  assert.equal(a.zone.schedule.filter((entry) => entry.beat.kind === "event").length, 0);
  const tower = stageDefs.tower.zones[0].beats[0].window;
  close(tower[1] - tower[0], 40);
});

test("scheduled events survive snapshot restore without consuming another random draw", () => {
  const a = world();
  a.zone.schedule = [{ at: 0.01, beat: { kind: "event", id: "outbreak" } }];
  a.eventsUsed = ["outbreak"];
  a.players[0].moves = [];
  const b = restoreWorld(a.map, snapshotWorld(a));
  assert.deepEqual(b.zone.schedule, a.zone.schedule);
  assert.deepEqual(b.rng, a.rng);
  for (let i = 0; i < 4; i++) {
    stepWorld(a, []);
    stepWorld(b, []);
  }
  assert.deepEqual(snapshotWorld(b), snapshotWorld(a));
  assert.deepEqual(a.spawn.fired, [0]);
});

test("schedule indices allow identical beats at the same time to each fire once", () => {
  const w = world();
  w.zone.schedule = [0, 1].map(() => ({ at: 0, beat: { kind: "outbreak", species: "caterpie" } }));
  w.spawn.fired = [];
  updateDirector(w, 0);
  updateDirector(w, 0);
  assert.deepEqual(w.spawn.fired, [0, 1]);
  assert.equal(w.events.filter((e) => e.t === "banner" && e.kind === "outbreak").length, 2);
});

test("weather forecast is harmless and emits one start and one end", () => {
  const w = world(["charmander"], "desert");
  const p = w.players[0],
    hp = p.hp;
  startWeather(w, "sandstorm");
  const ctx = context(w);
  w.time = 4;
  updateWeather(ctx, 4);
  assert.equal(p.hp, hp);
  assert.equal(activeWeather(w), null);
  w.time = 5;
  updateWeather(ctx, 1);
  assert.equal(p.hp, hp);
  w.time = 6;
  updateWeather(ctx, 1);
  close(hp - p.hp, playerStats(p).maxHp * 0.015);
  w.time = 80;
  updateWeather(ctx, 74);
  updateWeather(ctx, TICK);
  assert.equal(w.weather, null);
  assert.deepEqual(
    w.events.filter((e) => e.t === "weather").map((e) => e.phase),
    ["forecast", "start", "end"],
  );
});

test("sandstorm ignores type-immune bodies, chips guardians by half and never interrupts casts", () => {
  const w = world(["charmander", "geodude"]);
  const p = w.players[0],
    immune = w.players[1];
  w.weather = { id: "sandstorm", from: 0, until: 75 };
  w.time = 1;
  p.shield = 100;
  p.invulnerable = 20;
  p.dashTime = 1;
  p.lastHurt = -10;
  p.ult.elapsed = 2;
  const normal = spawnEnemy(w, "caterpie", 12, 12);
  const boss = spawnEnemy(w, "scyther", 15, 15);
  const types = ["geodude", "diglett", "magnemite"].map((id) => spawnEnemy(w, id, 20, 20));
  const hp = p.hp,
    ihp = immune.hp;
  for (const enemy of [normal, boss, ...types]) enemy.hp = enemy.maxHp = 1000;
  boss.phase = "windup";
  boss.phaseTime = 0.3;
  updateWeather(context(w), 1);
  close(hp - p.hp, playerStats(p).maxHp * 0.015);
  assert.equal(immune.hp, ihp);
  close(normal.hp, 985);
  close(boss.hp, 992.5);
  for (const enemy of types) assert.equal(enemy.hp, 1000);
  assert.equal(p.shield, 100);
  assert.equal(p.lastHurt, -10);
  assert.equal(p.ult.elapsed, 2);
  assert.equal(boss.phase, "windup");
  assert.equal(boss.phaseTime, 0.3);
});

test("weather lethal damage uses the same down and lethal-save path", () => {
  const w = world(["charmander", "squirtle"]),
    p = w.players[0];
  p.hp = 1;
  p.ult.elapsed = 2;
  weatherDamagePlayer(w, p, 2);
  assert.equal(p.alive, false);
  assert.equal(p.hp, 0);
  assert.equal(p.ult.elapsed, -1);
  const saved = w.players[1];
  saved.items = [{ id: "focus-sash", level: 1 }];
  refreshStats();
  saved.hp = 1;
  weatherDamagePlayer(w, saved, 2);
  assert.equal(saved.alive, true);
  assert.ok(saved.hp > 0);
});

test("weather applies once to enemy and player damage and move changes are explicit", () => {
  const run = (id) => {
    const w = world();
    if (id) w.weather = { id, from: 0, until: 75 };
    const enemy = spawnEnemy(w, "rattata", 12, 12);
    enemy.hp = enemy.maxHp = 1000;
    damageEnemy(context(w), enemy, hit(w, "water"));
    const p = w.players[0];
    p.invulnerable = 0;
    const hp = p.hp;
    damagePlayer(w, p, 10, "water");
    return [1000 - enemy.hp, hp - p.hp];
  };
  const neutral = run(null),
    rain = run("rain");
  close(rain[0], neutral[0] * 1.3);
  close(rain[1], neutral[1] * 1.3);
  const w = world(),
    stats = playerStats(w.players[0]);
  const solar = newMoveState("solar-beam");
  close(moveParams(solar, stats, "sun").cd, moveParams(solar, stats, null).cd * 0.6);
  for (const id of ["thunder", "hurricane"]) {
    const state = newMoveState(id);
    assert.equal(moveParams(state, stats, "rain").count, moveParams(state, stats, null).count + 1);
  }
});

test("rain does not multiply a water reaction's inherited damage a second time", () => {
  const splash = (rain) => {
    const w = world();
    if (rain) w.weather = { id: "rain", from: 0, until: 75 };
    const a = spawnEnemy(w, "rattata", 10, 10),
      b = spawnEnemy(w, "rattata", 11, 10);
    a.hp = a.maxHp = b.hp = b.maxHp = 1000;
    apply(a, "burn", 3, 0, 0);
    damageEnemy(context(w), a, hit(w, "water"));
    return 1000 - b.hp;
  };
  close(splash(true), splash(false) * 1.3);
});

test("hail extends freeze built through chill without extending other statuses", () => {
  const w = world(),
    p = w.players[0],
    enemy = spawnEnemy(w, "rattata", 15, 15);
  inflictBy(w, enemy, "freeze", 1, p);
  const base = find(enemy, "freeze").time;
  enemy.statuses = [];
  w.weather = { id: "hail", from: 0, until: 75 };
  for (let i = 0; i < 10 && !find(enemy, "freeze"); i++) inflictBy(w, enemy, "chill", 1, p);
  close(find(enemy, "freeze").time, base * 1.3);
});

test("enemy fire projectiles carry their own element to the shared damage path", () => {
  const damage = (rain) => {
    const w = world(),
      p = w.players[0];
    p.invulnerable = 0;
    if (rain) w.weather = { id: "rain", from: 0, until: 75 };
    const before = p.hp;
    addHazard(w, {
      kind: "ember",
      x: p.x,
      y: heightAt(w.map.terrain, p.x, p.z) + 0.4,
      z: p.z,
      radius: 0.3,
      life: 1,
      dmg: 10,
    });
    updateHazards(w, TICK);
    return before - p.hp;
  };
  assert.ok(damage(false) > 0);
  close(damage(true), damage(false) * 0.7);
});

test("hordes spawn offscreen and outbreaks weight only the chosen species for 60 seconds", () => {
  const w = world();
  w.spawn.pool = ["caterpie", "rattata"];
  fireFieldEvent(w, "horde", w.players[0]);
  assert.equal(w.enemies.length, 5);
  assert.equal(new Set(w.enemies.map((enemy) => enemy.species)).size, 1);
  for (const enemy of w.enemies) assert.ok(viewClearance(w, enemy.x, enemy.z) > 1);
  w.spawn.outbreak = { species: "caterpie", until: 60 };
  let boosted = 0;
  for (let i = 0; i < 10000; i++) if (encounterSpecies(w) === "caterpie") boosted++;
  assert.ok(boosted > 7800 && boosted < 8200);
  const before = spawnEnemy(w, "caterpie", 12, 12).xp;
  w.time = 60;
  updateEncounters(context(w), TICK);
  assert.equal(w.spawn.outbreak, null);
  close(before, spawnEnemy(w, "caterpie", 12, 12).xp * 1.5);
});

test("one shiny birth per map, personal defeat credit and team dust settle only once", () => {
  const w = world(["charmander", "squirtle"]);
  const enemy = forceShiny(w);
  assert.equal(enemy.shiny, true);
  assert.equal(enemy.shinyUntil, 25);
  const normal = spawnEnemy(w, "caterpie", 12, 12);
  close(enemy.maxHp, normal.maxHp * 3);
  assert.equal(normal.shiny, false);
  for (const p of w.players) assert.equal(p.dex.caterpie.seen, 2);
  const ctx = context(w);
  damageEnemy(ctx, enemy, hit(w, "normal", 1e9));
  damageEnemy(ctx, enemy, hit(w, "normal", 1e9));
  assert.equal(w.players[0].dex.caterpie.defeated, 1);
  assert.equal(w.players[0].dex.caterpie.shiny, 1);
  assert.equal(w.players[1].dex.caterpie.defeated, 0);
  for (const p of w.players) close(p.stardust, SHINY.stardust);
  assert.equal(w.events.filter((e) => e.t === "shiny-caught").length, 1);
});

test("outbreak shiny bonus only applies to its species and never to elites", () => {
  let seed = 0;
  while (true) {
    const draw = next(createRng(seed));
    if (draw >= SHINY.chance && draw < SHINY.chance * 4) break;
    seed++;
  }
  const w = world();
  w.rng = createRng(seed);
  assert.equal(spawnEnemy(w, "caterpie", 10, 10).shiny, false);
  w.spawn.outbreak = { species: "rattata", until: 60 };
  w.rng = createRng(seed);
  assert.equal(spawnEnemy(w, "caterpie", 10, 10).shiny, false);
  w.spawn.outbreak.species = "caterpie";
  w.rng = createRng(seed);
  assert.equal(spawnEnemy(w, "caterpie", 10, 10, true).shiny, false);
  w.rng = createRng(seed);
  assert.equal(spawnEnemy(w, "caterpie", 10, 10).shiny, true);
});

test("hail leaves ice-type enemies unharmed while damaging other types", () => {
  const w = world();
  const ice = spawnEnemy(w, "dewgong", 20, 20),
    other = spawnEnemy(w, "caterpie", 25, 25);
  ice.hp = ice.maxHp = other.hp = other.maxHp = 1000;
  w.weather = { id: "hail", from: 0, until: 75 };
  w.time = 1;
  updateWeather(context(w), 1);
  assert.equal(ice.hp, 1000);
  close(other.hp, 985);
});

test("shiny escape moves toward the nearest edge, skips AI and leaves without rewards", () => {
  const w = world(),
    enemy = forceShiny(w),
    ctx = context(w);
  enemy.x = ARENA_HALF - 0.1;
  enemy.z = 0;
  w.time = 25;
  const hp = enemy.hp;
  damageEnemy(ctx, enemy, hit(w, "normal", 1e9));
  assert.equal(enemy.hp, hp, "the encounter has already escaped its defeat window");
  updateEncounters(ctx, 1);
  updateEnemies(ctx, TICK);
  assert.equal(w.enemies.includes(enemy), false);
  assert.equal(w.pickups.length, 0);
  assert.equal(w.players[0].kills, 0);
  assert.equal(w.players[0].dex.caterpie.defeated, 0);
  assert.equal(w.spawn.shinySpawned, true);
});

test("environmental shiny death gives no personal defeat, shiny or bonus dust", () => {
  const w = world(),
    enemy = forceShiny(w);
  enemy.hp = 0.001;
  w.weather = { id: "sandstorm", from: 0, until: 75 };
  w.time = 1;
  updateWeather(context(w), 1);
  assert.equal(w.players[0].kills, 0);
  assert.equal(w.players[0].stardust, 0);
  assert.deepEqual(w.players[0].dex.caterpie, { seen: 1, defeated: 0, shiny: 0 });
  assert.ok(w.pickups.some((p) => p.kind === "xp"));
});

test("shiny escape follows a cached path around obstacles and resumes identically from snapshot", () => {
  const w = escapeArena();
  const enemy = forceShiny(w);
  enemy.x = enemy.px = 20;
  enemy.z = enemy.pz = 0;
  addCircleBlocker(w.nav, 31, 0, 3);
  w.time = 25;
  updateEncounters(context(w), TICK);
  assert.ok(enemy.escape);
  assert.equal(enemy.escape.x, ARENA_HALF);
  assert.equal(enemy.escape.z, 0);
  assert.ok(enemy.escape.path.length >= 4, "the straight blocked segment needs a waypoint");
  const restored = restoreWorld(w.map, snapshotWorld(w));
  const copy = restored.enemies[0];
  let maxSide = 0;
  for (let i = 0; i < 3000 && enemy.hp > 0; i++) {
    const route = enemy.escape;
    updateEncounters(context(w), TICK);
    updateEncounters(context(restored), TICK);
    assert.equal(enemy.escape, route, "the stored route is not searched again every tick");
    assert.ok(
      Math.hypot(enemy.x - 31, enemy.z) >= 3 + enemy.radius - 1e-6,
      "escape cannot cross the solid circle",
    );
    maxSide = Math.max(maxSide, Math.abs(enemy.z));
    assert.deepEqual(copy, enemy);
  }
  assert.equal(enemy.hp, 0);
  assert.ok(maxSide > 3);
  assert.ok(Math.abs(enemy.x - ARENA_HALF) < 0.02, "the route reaches the selected edge");
  assert.equal(w.players[0].kills, 0);
  assert.equal(w.pickups.length, 0);
  assert.deepEqual(snapshotWorld(restored), snapshotWorld(w));
});

test("an escape with no accessible edge retires without traversing blockers or rewarding a kill", () => {
  const w = escapeArena(),
    enemy = forceShiny(w);
  for (let at = -ARENA_HALF; at <= ARENA_HALF + 4; at += 4) {
    addCircleBlocker(w.nav, -ARENA_HALF, at, 3);
    addCircleBlocker(w.nav, ARENA_HALF, at, 3);
    addCircleBlocker(w.nav, at, -ARENA_HALF, 3);
    addCircleBlocker(w.nav, at, ARENA_HALF, 3);
  }
  const before = { x: enemy.x, z: enemy.z };
  w.time = 25;
  updateEncounters(context(w), TICK);
  assert.equal(enemy.hp, 0);
  assert.equal(enemy.escape, null);
  assert.deepEqual({ x: enemy.x, z: enemy.z }, before);
  assert.equal(w.players[0].kills, 0);
  assert.equal(w.pickups.length, 0);
});

test("flying shinies use their flight profile while leaving the field", () => {
  const w = escapeArena();
  const enemy = spawnEnemy(w, "zubat", 20, 0);
  enemy.shiny = true;
  enemy.shinyUntil = 25;
  addCircleBlocker(w.nav, 31, 0, 3);
  w.time = 25;
  updateEncounters(context(w), TICK);
  assert.deepEqual(enemy.escape.path, [ARENA_HALF, 0]);
  for (let i = 0; i < 1000 && enemy.hp > 0; i++) updateEncounters(context(w), TICK);
  assert.equal(enemy.hp, 0);
  close(enemy.z, 0);
  assert.ok(Math.abs(enemy.x - ARENA_HALF) < 0.02);
  assert.equal(w.pickups.length, 0);
});

test("unidentified ghosts ignore hits and DoT; identification yields one legendary chest", () => {
  const w = world();
  const enemy = spawnEnemy(w, "marowak", 20, 20, true, 900);
  const site = {
    id: 900,
    kind: "ghost",
    x: 20,
    z: 20,
    radius: 1,
    state: "busy",
    until: 0,
    owner: 0,
    data: { progress: 0, uses: 0, enemy: enemy.id, lastHurt: 0 },
  };
  w.sites = [site];
  const ctx = context(w),
    hp = enemy.hp;
  damageEnemy(ctx, enemy, hit(w, "normal", 1e9));
  apply(enemy, "burn", 10, 10000, 0);
  updateEnemies(ctx, TICK);
  assert.equal(enemy.hp, hp);
  assert.equal(w.pickups.length, 0);
  w.silphScope = true;
  damageEnemy(ctx, enemy, hit(w, "normal", 1e9));
  const chests = w.pickups.filter((p) => p.kind === "chest");
  assert.equal(chests.length, 1);
  assert.equal(chests[0].minRarity, 3);
});

test("site species matching the map guardian remains an encounter", () => {
  const w = world(["charmander"], "desert");
  const siteEnemy = spawnEnemy(w, "aerodactyl", 20, 20, true, 901);
  const boss = spawnEnemy(w, "aerodactyl", 20, 20);
  assert.equal(siteEnemy.boss, false);
  assert.equal(siteEnemy.shiny, false);
  assert.equal(boss.boss, true);
  damageEnemy(context(w), siteEnemy, hit(w, "normal", 1e9));
  assert.equal(w.zone.phase, "active");
});
