import assert from "node:assert/strict";
import test from "node:test";
import { routeTo, selectTestExit } from "./fixtures/route.mjs";
import { damageEnemy, killEnemy } from "../src/run/sim/combat.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { items } from "../src/run/sim/content/items.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { SITE } from "../src/run/sim/content/params/sites.ts";
import { SITE_POOLS } from "../src/run/sim/content/sites.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { damagePlayer } from "../src/run/sim/hurt.ts";
import { checkPlayable, MapGenError, stageBodies } from "../src/run/sim/mapgen/index.ts";
import { addCircleBlocker, createNav } from "../src/run/sim/nav/index.ts";
import { grantPartner } from "../src/run/sim/partners.ts";
import { createRng } from "../src/run/sim/rng.ts";
import { queueCard } from "../src/run/sim/progression.ts";
import {
  interactSite,
  placeSites,
  settleSiteKill,
  siteHere,
  updateSites,
} from "../src/run/sim/sites/index.ts";
import { currentStats, refreshStats } from "../src/run/sim/stats.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import {
  collectRemainingPickups,
  createWorld,
  createWorldFromSeeds,
  stepWorld,
} from "../src/run/sim/world.ts";
import { enterZone, prepareZone } from "../src/run/sim/zones.ts";
import { itemCap, itemSlots, newMoveState, rollChoices } from "../src/run/sim/upgrades.ts";

function arena(players = 2, stage = "forest") {
  const w = createWorld({
    stage,
    route: routeTo(stage),
    seed: 5,
    difficulty: 0,
    players: Array.from({ length: players }, () => ({ starter: "charmander" })),
  });
  const terrain = {
    ...w.map.terrain,
    heights: new Float32Array(w.map.terrain.heights.length),
    surface: undefined,
    walls: undefined,
  };
  w.map = { ...w.map, terrain, obstacles: [] };
  w.nav = createNav(terrain);
  w.stations = [];
  w.sites = [];
  w.zone.schedule = [];
  w.spawn.credit = -1e9;
  w.time = 1;
  w.events = [];
  for (const p of w.players) {
    Object.assign(p, {
      x: 0,
      z: 0,
      px: 0,
      pz: 0,
      moves: [],
      choosing: false,
      invulnerable: 0,
      xpNext: 1e9,
    });
  }
  return w;
}

function site(w, kind, data = {}, x = 0, z = 0) {
  const s = {
    id: w.nextId++,
    kind,
    x,
    z,
    radius: SITE.radius[kind],
    state: "ready",
    until: 0,
    owner: null,
    data: { progress: 0, uses: 0, enemy: null, lastHurt: 0, ...data },
  };
  w.sites.push(s);
  return s;
}

const ctx = (w) => ({ world: w, grid: new EnemyGrid() });

function advance(w, seconds) {
  for (let i = 0; i < Math.ceil(seconds / TICK); i++) {
    w.time += TICK;
    refreshStats();
    updateSites(ctx(w), TICK);
  }
}

function defeat(w, enemy, killer = w.players[0]) {
  enemy.hp = 0;
  killEnemy(ctx(w), enemy, killer);
  w.enemies = w.enemies.filter((entry) => entry.hp > 0);
}

test("real maps allocate four site pads, approved kinds, separate buildings and paired tower scope", () => {
  for (const stage of Object.keys(stageDefs)) {
    for (const seed of [5, 11, 4242]) {
      let attempt = seed;
      const w = createWorldFromSeeds(
        { stage, route: routeTo(stage), difficulty: 0, players: [{ starter: "charmander" }] },
        () => attempt++,
      );
      const pads = w.map.pads.filter((pad) => pad.tag === "site");
      assert.equal(pads.length, 4, `${stage}/${seed}`);
      const balls = w.sites.filter((s) => s.kind === "item-ball");
      if (balls.length) {
        assert.ok(balls.length >= 6 && balls.length <= 8);
        const traps = balls.filter((s) => s.data.trap).length;
        assert.ok(traps >= 1 && traps <= 2);
      }
      for (const s of w.sites) {
        assert.ok(SITE_POOLS[stage].includes(s.kind));
        assert.ok(
          pads.some((pad) => Math.hypot(s.x - pad.x, s.z - pad.z) + s.radius <= pad.radius),
        );
        for (const station of w.stations)
          assert.ok(
            Math.hypot(s.x - station.x, s.z - station.z) >
              s.radius + station.radius + 2 * SITE.reach,
          );
        for (const pad of w.map.pads.filter((pad) => pad.tag === "landmark"))
          assert.ok(Math.hypot(s.x - pad.x, s.z - pad.z) > s.radius + pad.radius);
      }
      if (stage === "tower") {
        assert.equal(w.sites.filter((s) => s.kind === "ghost").length, 1);
        assert.equal(w.sites.filter((s) => s.kind === "silph-scope").length, 1);
        assert.ok(
          w.sites
            .filter((s) => s.kind === "ghost" || s.kind === "silph-scope")
            .every((s) => s.state === "ready"),
        );
      }
      const again = createWorld({
        stage,
        route: routeTo(stage),
        seed: w.seed,
        difficulty: 0,
        players: [{ starter: "charmander" }],
      });
      assert.deepEqual(w.sites, again.sites);
      assert.deepEqual(w.rng, again.rng);
    }
  }
});

test("site placement rejects missing real platforms instead of inventing positions", () => {
  const w = arena();
  w.map.pads = w.map.pads.filter((pad) => pad.tag !== "site");
  assert.throws(() => placeSites(w), MapGenError);
});

test("site approaches must fit the largest player and allow return to spawn", () => {
  const w = arena();
  const s = site(w, "spring", {}, 5, 0);
  const spots = {
    spawns: [{ x: 0, z: 0 }],
    landmarks: [],
    stations: [],
    sites: [{ ...s, reach: SITE.reach }],
    passages: [],
  };
  const bodies = stageBodies(stageDefs.forest);
  checkPlayable(w.nav, spots, bodies, "open site");
  // Leave its centre point unchanged while filling the entire approach zone.
  addCircleBlocker(w.nav, s.x, s.z, s.radius + bodies.playerMin + SITE.reach + bodies.playerMax);
  assert.throws(() => checkPlayable(w.nav, spots, bodies, "blocked site"), MapGenError);
});

test("two players interacting on one tick trigger one spring and one honey encounter", () => {
  const w = arena();
  const spring = site(w, "spring");
  for (const p of w.players) p.hp = 1;
  stepWorld(w, [
    { t: "interact", player: 0 },
    { t: "interact", player: 1 },
  ]);
  assert.equal(spring.state, "spent");
  for (const p of w.players) assert.equal(p.hp, currentStats(p).maxHp);
  assert.equal(
    w.events.filter(
      (event) => event.t === "site" && event.site === spring.id && event.phase === "complete",
    ).length,
    1,
  );
  w.sites = [];
  const honey = site(w, "honey-tree", { species: "heracross" });
  stepWorld(w, [
    { t: "interact", player: 0 },
    { t: "interact", player: 1 },
  ]);
  assert.equal(
    w.events.filter(
      (event) => event.t === "site" && event.site === honey.id && event.phase === "start",
    ).length,
    1,
  );
  advance(w, 7.8);
  assert.equal(w.enemies.length, 0);
  advance(w, 0.3);
  assert.equal(w.enemies.length, 1);
  assert.equal(w.enemies[0].species, "heracross");
  assert.equal(w.enemies[0].site, honey.id);
  assert.ok(w.enemies[0].elite && !w.enemies[0].boss);
});

test("fishing damage cancels the result; fossils retain excavation progress", () => {
  for (const kind of ["fishing", "fossil"]) {
    const w = arena();
    const s = site(w, kind);
    const player = w.players[0];
    assert.equal(interactSite(w, player), true);
    advance(w, 1);
    const completed = s.data.progress;
    assert.ok(completed > 0.9);
    assert.equal(damagePlayer(w, player, 1), true);
    advance(w, TICK);
    assert.equal(s.state, "ready");
    assert.equal(w.enemies.length, 0);
    assert.equal(w.pickups.length, 0);
    assert.equal(s.data.uses, 0);
    assert.equal(
      w.events.some((event) => event.t === "site" && event.phase === "reveal"),
      false,
      "an interrupted channel never produces completion feedback",
    );
    assert.equal(s.data.progress, kind === "fossil" ? completed : 0);
    assert.equal(interactSite(w, player), true);
    if (kind === "fossil") {
      advance(w, 3.1);
      assert.equal(w.enemies[0]?.species, "aerodactyl");
      const reveals = () =>
        w.events.filter(
          (event) => event.t === "site" && event.site === s.id && event.phase === "reveal",
        ).length;
      assert.equal(reveals(), 1, "excavation feedback lands when the living encounter emerges");
      defeat(w, w.enemies[0]);
      assert.equal(reveals(), 1, "defeating the encounter cannot replay excavation");
    } else {
      advance(w, 1);
      assert.equal(s.data.uses, 0);
    }
  }
});

test("moving, dashing, owner knockout and explicit repeat interrupt a channel", () => {
  for (const cancel of ["move", "dash", "knockout", "repeat"]) {
    const w = arena();
    const s = site(w, "fossil");
    const p = w.players[0];
    interactSite(w, p);
    advance(w, 0.5);
    const progress = s.data.progress;
    if (cancel === "move") p.moving = true;
    if (cancel === "dash") p.dashTime = 0.1;
    if (cancel === "knockout") p.alive = false;
    if (cancel === "repeat") assert.equal(interactSite(w, p), true);
    advance(w, TICK);
    assert.equal(s.state, "ready", cancel);
    assert.equal(s.data.progress, progress);
  }
});

test("fishing consumes exactly three completed attempts and its seeded outcomes follow 60/30/10", () => {
  const w = arena();
  const p = w.players[0];
  const observed = { magikarp: 0, item: 0, gyarados: 0 };
  for (let i = 0; i < 150; i++) {
    w.sites = [];
    const s = site(w, "fishing");
    w.rng = createRng(i);
    for (let use = 0; use < 3; use++) {
      p.pending = [];
      assert.equal(interactSite(w, p), true);
      advance(w, 2.1);
      const reveals = () =>
        w.events.filter(
          (event) => event.t === "site" && event.site === s.id && event.phase === "reveal",
        ).length;
      assert.equal(
        reveals(),
        use + 1,
        "every fishing result is cued before any spawned enemy dies",
      );
      const enemy = w.enemies.find((entry) => entry.site === s.id);
      if (enemy) {
        observed[enemy.species]++;
        defeat(w, enemy);
      } else observed.item++;
      assert.equal(reveals(), use + 1, "settlement does not replay the fishing cue");
    }
    assert.equal(s.state, "spent");
    assert.equal(interactSite(w, p), false);
  }
  const n = Object.values(observed).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(observed.magikarp / n - 0.6) < 0.08, JSON.stringify(observed));
  assert.ok(Math.abs(observed.item / n - 0.3) < 0.08, JSON.stringify(observed));
  assert.ok(Math.abs(observed.gyarados / n - 0.1) < 0.05, JSON.stringify(observed));
});

test("raid warns first, becomes a giant alpha and expires without loot, kill or capture", () => {
  const w = arena();
  const s = site(w, "raid-den", { species: "rattata" });
  const ordinary = spawnEnemy(w, "rattata", 10, 0, true, -1);
  w.enemies = [];
  assert.equal(interactSite(w, w.players[0]), true);
  advance(w, 0.7);
  assert.equal(w.enemies.length, 0);
  advance(w, 0.2);
  const enemy = w.enemies[0];
  assert.ok(enemy.alpha && !enemy.boss);
  assert.equal(enemy.radius, ordinary.radius * SITE.raid.scale);
  assert.ok(enemy.maxHp > ordinary.maxHp);
  assert.ok(w.events.some((event) => event.t === "site" && event.phase === "start"));
  advance(w, 60);
  assert.equal(s.state, "spent");
  assert.equal(w.enemies.length, 0);
  assert.equal(w.pickups.length, 0);
  assert.equal(w.players[0].kills, 0);
  assert.equal(w.partners.length, 0);
});

test("event guardians use ordinary encounter budgets and never clear the zone", () => {
  const w = arena();
  for (const species of ["pinsir", "gyarados", "aerodactyl", "marowak"]) {
    const enemy = spawnEnemy(w, species, 8, 0, true, 123);
    assert.equal(enemy.boss, false);
    assert.ok(enemy.maxHp < enemies[species].hp, `${species}: ${enemy.maxHp}`);
    defeat(w, enemy);
    assert.equal(w.zone.phase, "active");
  }
});

test("event kill overrides one chest only, retaining shared XP and individual direct items", () => {
  for (const [kind, species, floor] of [
    ["honey-tree", "heracross", 1],
    ["fossil", "aerodactyl", 1],
    ["raid-den", "rattata", 3],
    ["ghost", "marowak", 3],
    ["snorlax", "snorlax", null],
  ]) {
    const w = arena();
    const s = site(w, kind, { species });
    s.state = "busy";
    s.owner = 0;
    const enemy = spawnEnemy(w, species, 5, 0, true, s.id);
    s.data.enemy = enemy.id;
    defeat(w, enemy);
    const boxes = w.pickups.filter((pickup) => pickup.kind === "chest");
    assert.equal(boxes.length, floor === null ? 0 : 1, kind);
    if (boxes.length) assert.equal(boxes[0].minRarity, floor);
    assert.equal(w.pickups.filter((pickup) => pickup.kind === "xp").length, 6);
    assert.deepEqual(settleSiteKill(ctx(w), enemy, w.players[0]), { chest: null });
    if (kind === "snorlax") {
      assert.equal(w.players[0].items.find((item) => item.id === "leftovers")?.level, 1);
      assert.equal(w.players[1].items.length, 0);
    }
  }
});

test("queued event chest floors survive rerolls and stale picks do not consume the next chest", () => {
  const w = arena();
  for (const p of w.players) p.moves = [newMoveState("ember")];
  const s = site(w, "fossil", { species: "aerodactyl" });
  s.state = "busy";
  const enemy = spawnEnemy(w, "aerodactyl", 6, 0, true, s.id);
  s.data.enemy = enemy.id;
  defeat(w, enemy);
  collectRemainingPickups(w);
  for (const p of w.players) {
    const card = p.pending[0];
    assert.equal(p.pending.length, 1);
    assert.equal(card.minRarity, 1);
    assert.ok(
      card.options
        .filter((choice) => choice.kind === "upgrade")
        .every((choice) => choice.rarity >= 1),
    );
    stepWorld(w, [{ t: "reroll", player: p.id, card: card.id }]);
    assert.ok(
      p.pending[0].options
        .filter((choice) => choice.kind === "upgrade")
        .every((choice) => choice.rarity >= 1),
    );
    queueCard(w, p, "chest", 3);
    stepWorld(w, [{ t: "pick", player: p.id, card: card.id, index: 0 }]);
    const next = p.pending[0];
    assert.equal(next.minRarity, 3);
    assert.ok(
      next.options
        .filter((choice) => choice.kind === "upgrade")
        .every((choice) => choice.rarity === 3),
    );
    stepWorld(w, [{ t: "pick", player: p.id, card: card.id, index: 0 }]);
    assert.equal(p.pending[0].id, next.id);
  }
  for (let seed = 0; seed < 30; seed++)
    assert.ok(
      rollChoices(createRng(seed), w.players[0], "chest", [], 3)
        .filter((choice) => choice.kind === "upgrade")
        .every((choice) => choice.rarity === 3),
    );
});

test("walking auto-picks one glint, but cannot activate a manual spring", () => {
  const w = arena();
  const glint = site(w, "glint");
  const spring = site(w, "spring");
  assert.equal(siteHere(w, w.players[0]), spring);
  updateSites(ctx(w), TICK);
  assert.equal(glint.state, "spent");
  assert.equal(spring.state, "ready");
  const levels = w.players.map((p) => p.items.reduce((sum, item) => sum + item.level, 0));
  assert.equal(levels[0], 1);
  assert.equal(levels[1], 0);
  updateSites(ctx(w), TICK);
  assert.deepEqual(
    w.players.map((p) => p.items.reduce((sum, item) => sum + item.level, 0)),
    levels,
  );
});

test("direct item rewards respect banishes, item caps and capacity; blocked leftovers become berries", () => {
  const w = arena();
  const p = w.players[0];
  p.items = Object.keys(items)
    .slice(0, itemSlots(p))
    .map((id) => ({ id, level: itemCap(p, id) }));
  for (const id of Object.keys(items)) p.banished.push(`item:${id}`);
  const glint = site(w, "glint");
  updateSites(ctx(w), TICK);
  assert.equal(glint.state, "spent");
  assert.ok(p.items.every((item) => item.level === itemCap(p, item.id)));
  assert.equal(w.pickups.filter((pickup) => pickup.kind === "berry").length, 5);
  const s = site(w, "snorlax");
  s.state = "busy";
  const enemy = spawnEnemy(w, "snorlax", 6, 0, true, s.id);
  s.data.enemy = enemy.id;
  defeat(w, enemy);
  assert.equal(p.items.length, itemSlots(p));
  assert.equal(w.pickups.filter((pickup) => pickup.kind === "chest").length, 0);
  assert.ok(w.pickups.filter((pickup) => pickup.kind === "berry").length >= 10);
});

test("direct field items run their on-pick effects before the refreshed stats are observed", () => {
  for (const id of ["rare-candy", "loaded-dice"]) {
    const w = arena();
    const p = w.players[0];
    p.level = 16;
    p.xpNext = 10;
    p.banished = Object.keys(items)
      .filter((item) => item !== id)
      .map((item) => `item:${item}`);
    const before = p.level;
    site(w, "glint");
    updateSites(ctx(w), TICK);
    assert.equal(p.items.find((item) => item.id === id)?.level, 1);
    if (id === "rare-candy") {
      assert.ok(p.level > before);
      assert.ok(p.pending.length > 0);
    } else {
      assert.ok(Object.keys(p.fx).some((key) => key.includes("dice")));
      assert.ok(currentStats(p).maxHp > 0);
    }
  }
});

test("awakened snorlax receives four elite HP budgets and removes its sleeping blocker", () => {
  const w = arena();
  const p = w.players[0];
  const s = site(w, "snorlax");
  addCircleBlocker(w.nav, s.x, s.z, s.radius);
  const ordinary = spawnEnemy(w, "snorlax", 8, 0, true, -1);
  w.enemies = [];
  interactSite(w, p);
  advance(w, 0.9);
  const enemy = w.enemies[0];
  assert.equal(enemy.maxHp, ordinary.maxHp * 4);
  assert.ok(
    !w.nav.blockers.some(
      (blocker) => blocker.kind === "circle" && blocker.x === s.x && blocker.z === s.z,
    ),
  );
  defeat(w, enemy);
  assert.equal(p.items.find((item) => item.id === "leftovers")?.level, 1);
});

test("trap balls warn for 0.8s, can be dashed through and never grant self-destruct loot", () => {
  for (const dodge of [false, true]) {
    const w = arena();
    const s = site(w, "item-ball", { trap: true, species: "voltorb" });
    const p = w.players[0];
    w.players[1].x = 10;
    const hp = p.hp;
    updateSites(ctx(w), TICK);
    assert.equal(s.state, "busy");
    advance(w, 0.7);
    assert.equal(p.hp, hp);
    if (dodge) p.dashTime = 0.1;
    advance(w, 0.2);
    assert.equal(s.state, "spent");
    assert.equal(p.hp < hp, !dodge);
    assert.equal(w.pickups.length, 0);
    assert.equal(p.kills, 0);
  }
});

test("unidentified ghost ignores damage until the other player auto-picks the shared scope", () => {
  const w = arena();
  const s = site(w, "ghost", { species: "marowak" });
  const scope = site(w, "silph-scope", {}, 12, 0);
  assert.equal(interactSite(w, w.players[0]), true);
  advance(w, 0.9);
  const enemy = w.enemies[0];
  assert.ok(enemy);
  const hit = {
    owner: w.players[0],
    move: null,
    type: "normal",
    dmg: 10,
    crit: 0,
    statusChance: 0,
    knock: 0,
    fromX: 0,
    fromZ: 0,
  };
  damageEnemy(ctx(w), enemy, hit);
  assert.equal(enemy.hp, enemy.maxHp);
  w.players[1].x = scope.x;
  updateSites(ctx(w), TICK);
  assert.equal(w.silphScope, true);
  assert.equal(scope.state, "spent");
  damageEnemy(ctx(w), enemy, hit);
  assert.ok(enemy.hp < enemy.maxHp);
  defeat(w, enemy);
  assert.equal(w.pickups.filter((pickup) => pickup.kind === "chest").length, 1);
  assert.equal(w.pickups.find((pickup) => pickup.kind === "chest").minRarity, 3);
  assert.equal(s.state, "spent");
});

test("egg preserves walking distance through knockout, handoff and a real field transition", () => {
  const w = arena();
  const [a, b] = w.players;
  site(w, "egg", { species: "rattata" });
  assert.equal(interactSite(w, a), true);
  a.moving = true;
  a.x = 40;
  updateSites(ctx(w), TICK);
  assert.equal(a.egg.distance, 40);
  // A remote owner sends no new position on this shared tick; it cannot count twice.
  updateSites(ctx(w), TICK);
  assert.equal(a.egg.distance, 40);
  a.alive = false;
  updateSites(ctx(w), TICK);
  assert.equal(a.egg, null);
  const dropped = w.sites.find((s) => s.state === "ready" && s.data.egg);
  assert.equal(dropped.data.egg.distance, 40);
  b.x = dropped.x;
  b.z = dropped.z;
  assert.equal(interactSite(w, b), true);
  assert.equal(b.egg.distance, 40);
  selectTestExit(w, "desert");
  const before = b.egg.distance;
  const prepared = prepareZone(w);
  enterZone(w, prepared);
  // Movement runs before updateSites on the first real tick of the next field.
  b.moving = true;
  b.x += 0.5;
  updateSites(ctx(w), TICK);
  assert.equal(b.egg.distance, before + 0.5, "field teleport is not walking");
  b.x += 78.5;
  updateSites(ctx(w), TICK);
  assert.equal(b.egg.distance, 119);
  assert.equal(w.partners.length, 0);
  b.x += 1;
  updateSites(ctx(w), TICK);
  assert.equal(b.egg, null);
  assert.equal(w.partners.length, 1);
  assert.equal(w.partners[0].owner, b.id);
  assert.equal(w.partners[0].species, "rattata");
});

test("hatching with full partner slots grants one personal rare chest without a capture roll", () => {
  const w = arena();
  const p = w.players[0];
  while (grantPartner(w, p, "rattata")) {
    /* fill actual slots */
  }
  const count = w.partners.length;
  p.moves = [newMoveState("ember")];
  site(w, "egg", { species: "heracross" });
  interactSite(w, p);
  p.egg.distance = 120;
  const rng = w.rng.state;
  updateSites(ctx(w), TICK);
  assert.equal(p.egg, null);
  assert.equal(w.partners.length, count);
  assert.equal(p.pending.length, 1);
  assert.ok(
    p.pending[0].options
      .filter((choice) => choice.kind === "upgrade")
      .every((choice) => choice.rarity >= 1),
  );
  assert.equal(w.players[1].pending.length, 0);
  const after = w.rng.state;
  updateSites(ctx(w), TICK);
  assert.equal(w.rng.state, after);
  assert.notEqual(after, rng, "only the reward card draws randomness");
  // Direct partner grants with room never draw capture odds.
  const other = w.players[1];
  const state = w.rng.state;
  assert.equal(grantPartner(w, other, "heracross"), true);
  assert.equal(w.rng.state, state);
});

test("egg walking excludes dash displacement, including the final dash step", () => {
  const w = arena();
  const p = w.players[0];
  site(w, "egg", { species: "rattata" });
  interactSite(w, p);
  p.moving = true;
  p.dashTime = -0.02;
  p.vx = currentStats(p).speed * 3.4;
  p.x += 1;
  updateSites(ctx(w), TICK);
  assert.equal(p.egg.distance, 0);
  p.vx = currentStats(p).speed;
  p.x += 1;
  updateSites(ctx(w), TICK);
  assert.equal(p.egg.distance, 1);
});
