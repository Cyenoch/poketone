import { unlockIds } from "../src/run/sim/content/unlocks.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from "three";
import { routeTo } from "./fixtures/route.mjs";
import { fireBeat } from "../src/run/sim/beats.ts";
import { challengePayout, seatOutcome } from "../src/run/sim/challenge-result.ts";
import { killEnemy } from "../src/run/sim/combat.ts";
import { difficulties } from "../src/run/sim/content/difficulties.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { mobilityClasses } from "../src/run/sim/content/mobility.ts";
import { FLYER_HOVER } from "../src/run/sim/content/params/combat.ts";
import { COOP } from "../src/run/sim/content/params/coop.ts";
import { ELITE_BODY, SPAWN_RING } from "../src/run/sim/content/params/pacing.ts";
import { CAPTURE_CHANCE } from "../src/run/sim/content/params/partners.ts";
import { CHALLENGE_ALPHA } from "../src/run/sim/content/params/rules.ts";
import { SITE } from "../src/run/sim/content/params/sites.ts";
import { landmarkOf, zoneDef } from "../src/run/sim/currentZone.ts";
import {
  primeEnemyNav,
  spawnEnemy,
  spawnOnRing,
  spawnReachable,
  updateDirector,
} from "../src/run/sim/director.ts";
import { scheduleField } from "../src/run/sim/field-events.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { damagePlayer } from "../src/run/sim/hurt.ts";
import { addCircleBlocker, bodyFits, removeBlocker } from "../src/run/sim/nav/index.ts";
import { capture } from "../src/run/sim/partners.ts";
import { rescueTarget } from "../src/run/sim/rescue.ts";
import { createRng, next } from "../src/run/sim/rng.ts";
import { interactSite, updateSites } from "../src/run/sim/sites/index.ts";
import { siteSpawnPoint } from "../src/run/sim/sites/shared.ts";
import { ARENA_HALF, TICK } from "../src/run/sim/state/world.ts";
import { refreshStats } from "../src/run/sim/stats.ts";
import { heightAt } from "../src/run/sim/terrain.ts";
import { viewClearance } from "../src/run/sim/viewFootprint.ts";
import { createWorld, stepSharedWorld } from "../src/run/sim/world.ts";

const player = { trainer: "chengxi", starter: "charmander", shiny: false };
function world(rules, { stage = "forest", players = [player, player], difficulty = 0 } = {}) {
  return createWorld({
    unlocks: unlockIds,
    mode: "expedition",
    stage,
    route: routeTo(stage),
    seed: 5,
    difficulty,
    rules,
    players,
  });
}

const interact = (player) => ({ t: "interact", player: player.id });
const context = (world) => ({ world, grid: new EnemyGrid() });
function knockOut(world, player) {
  player.invulnerable = 0;
  damagePlayer(world, player, 1e9);
}

function clearGuardian(world, host) {
  const { x, z } = landmarkOf(world);
  Object.assign(host, { x, z });
  stepSharedWorld(world, [interact(host)]);
  const guardian = world.enemies.find(({ id }) => id === world.bossId);
  assert.ok(guardian?.boss);
  guardian.hp = 0;
  killEnemy(context(world), guardian, host);
  stepSharedWorld(world, []);
  assert.equal(world.zone.phase, "cleared");
}

test("Nuzlocke blocks revive items and keeps the current prevent-KO items", () => {
  for (const rules of [[], ["nuzlocke"]]) {
    const w = world(rules);
    const guest = w.players[1];
    for (const item of ["revive", "max-revive", "rainbow-wing", "focus-sash", "focus-band"]) {
      Object.assign(guest, { alive: true, hp: 1, items: [{ id: item, level: 1 }], fx: {} });
      refreshStats();
      w.events.length = 0;
      w.rng = createRng(7); // The first draw succeeds even for a level-one Focus Band.
      knockOut(w, guest);
      const isRevive = ["revive", "max-revive", "rainbow-wing"].includes(item);
      assert.equal(guest.alive, rules.length === 0 || !isRevive, item);
      assert.equal(
        w.events.some((event) => event.t === "revive"),
        rules.length === 0 && isRevive,
        item,
      );
      if (!isRevive) assert.equal(guest.hp, 1, item);
    }
  }
});

test("host resolves personal revives, rescue channels, clear and total knockout under each rule set", () => {
  for (const rules of [[], ["nuzlocke"]]) {
    const challenged = rules.length > 0;
    const w = world(rules, {
      players: [player, { ...player, lab: { modifiers: [], rules: { revives: 1 } } }, player],
    });
    const [host, researched, guest] = w.players;
    guest.x = host.x;
    knockOut(w, researched);
    knockOut(w, guest);
    assert.equal(
      w.events.some((event) => event.t === "down" && event.player === researched.id),
      challenged,
    );
    assert.equal(rescueTarget(w, host), challenged ? undefined : guest);
    stepSharedWorld(w, [interact(host)]);
    assert.equal(researched.alive, !challenged);
    assert.equal(host.rescue?.target, challenged ? undefined : guest.id);
    for (let tick = 0; tick <= Math.ceil(COOP.rescueSeconds / TICK); tick++) stepSharedWorld(w, []);
    assert.equal(guest.alive, !challenged);
    if (guest.alive) knockOut(w, guest);
    clearGuardian(w, host);
    assert.equal(guest.alive, !challenged);
    assert.equal(w.outcome, "playing");
    for (const seat of w.players) knockOut(w, seat);
    stepSharedWorld(w, []);
    assert.equal(w.outcome, "defeat");
  }
});

test("a tower trophy belonging to a Nuzlocke spectator cannot block the host's win", () => {
  const w = world(["nuzlocke"], { stage: "tower" });
  const [host, guest] = w.players;
  // Co-op can carry an unclaimed trophy into the tower from an earlier area.
  w.pickups.push({
    kind: "trophy",
    owner: guest.id,
    id: w.nextId++,
    value: 1,
    x: guest.x,
    z: guest.z,
    magnet: true,
  });
  stepSharedWorld(w, []);
  assert.equal(guest.pending[0]?.offer?.kind, "trophy");
  knockOut(w, guest);
  clearGuardian(w, host);
  const { x, z } = w.zone.exits.find((exit) => exit.to === null);
  Object.assign(host, { x, z });
  stepSharedWorld(w, [interact(host)]);
  assert.equal(w.outcome, "playing", "living seats still need to choose their trophies");
  const picks = host.pending.map((card) => ({
    t: "pick",
    player: host.id,
    card: card.id,
    index: 0,
  }));
  stepSharedWorld(w, [...picks, interact(host)]);
  assert.equal(w.outcome, "victory");
  assert.equal(seatOutcome(w, host), "victory");
  assert.equal(seatOutcome(w, guest), "defeat");
  assert.ok(guest.stardust > 0);
  for (const seat of [host, guest])
    assert.equal(challengePayout(w, seat).stardust, Math.floor(seat.stardust * 1.3));
});

const close = (value, expected) =>
  assert.ok(Math.abs(value - expected) < 1e-8, `${value} != ${expected}`);

function stronger(ordinary, boosted, hpFactor) {
  close(boosted.maxHp, ordinary.maxHp * hpFactor);
  assert.equal(boosted.hp, boosted.maxHp);
  close(boosted.dmg, ordinary.dmg * CHALLENGE_ALPHA.damage);
  close(boosted.radius, ordinary.radius * CHALLENGE_ALPHA.body);
  close(boosted.scale, ordinary.scale * CHALLENGE_ALPHA.body);
  assert.equal(boosted.xp, ordinary.xp);
}

function phoneFrustum(w, viewer) {
  const camera = new PerspectiveCamera(42, 844 / 390, 0.5, 120);
  const { x, z, viewYaw } = viewer;
  const ground = heightAt(w.map.terrain, x, z);
  camera.position.set(x + Math.sin(viewYaw) * 13, ground + 16, z + Math.cos(viewYaw) * 13);
  camera.lookAt(x, ground + 0.6, z);
  camera.updateMatrixWorld();
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

function assertOffscreen(w, enemy) {
  const { species, x, z, radius, scale } = enemy;
  const { height, mobility } = enemies[species];
  const ground = heightAt(w.map.terrain, x, z);
  const hover = mobility.flying ? FLYER_HOVER * scale : 0;
  const body = new Box3(
    new Vector3(x - radius, ground + hover, z - radius),
    new Vector3(x + radius, ground + hover + height * scale, z + radius),
  );
  for (const viewer of w.players) {
    assert.ok(
      !phoneFrustum(w, viewer).intersectsBox(body),
      `${species} overlaps player ${viewer.id}'s view at (${x}, ${z})`,
    );
  }
}

test("random elite and elite-wave arrivals strengthen offscreen with unchanged capture odds", () => {
  const pair = [world([], { difficulty: 1 }), world(["alpha-elites"], { difficulty: 1 })];
  // Pick a seed where the director's second draw rolls a random elite on Hard.
  let seed = 0;
  for (; ; seed++) {
    const rng = createRng(seed);
    next(rng);
    if (next(rng) < difficulties[1].eliteChance) break;
  }
  for (const w of pair) {
    w.rng = createRng(seed);
    w.spawn.credit = 1;
    updateDirector(w, 0);
    assert.equal(w.enemies.length, 1);
    assert.equal(w.enemies[0].elite, true);
    fireBeat(w, { kind: "elite-wave" }, w.players[0]);
    assert.ok(w.enemies.length > 1);
    assert.ok(w.enemies.every((enemy) => viewClearance(w, enemy.x, enemy.z) > 1));
  }
  const [ordinary, boosted] = pair.map((w) => w.enemies);
  assert.equal(ordinary.length, boosted.length);
  ordinary.forEach((elite, index) => stronger(elite, boosted[index], CHALLENGE_ALPHA.hp));
  for (const [low, high, expected] of [
    [0, CAPTURE_CHANCE.elite, 1],
    [CAPTURE_CHANCE.elite, CAPTURE_CHANCE.alpha, 0],
  ]) {
    let seed = 0;
    while (true) {
      const roll = next(createRng(seed));
      if (roll >= low && roll < high) break;
      seed++;
    }
    for (const w of pair) {
      const elite = w.enemies[0];
      elite.hp = 0;
      w.rng = createRng(seed);
      capture(w, elite, w.players[0]);
      assert.equal(w.partners.length, expected);
      w.partners.length = 0;
    }
  }
});

test("a ground elite on the forest ring clears obstacles with its boosted radius", () => {
  const ordinary = world([], { players: [player], difficulty: 1 });
  const challenge = world(["alpha-elites"], { players: [player], difficulty: 1 });
  const [small, large] = [ordinary, challenge].map((w) => {
    w.rng = createRng(446);
    return spawnOnRing(w, "caterpie", w.players[0], SPAWN_RING.min, SPAWN_RING.max, true);
  });
  assert.ok(small && large);
  const { mobility } = enemies.caterpie;
  assert.ok(bodyFits(ordinary.nav, mobility, small.x, small.z, small.radius));
  assert.ok(!bodyFits(challenge.nav, mobility, small.x, small.z, large.radius));
  assert.ok(bodyFits(challenge.nav, mobility, large.x, large.z, large.radius));
  assertOffscreen(challenge, large);
});

test("an aimed flying elite leaves the downed teammate's viewport with its whole body", () => {
  const w = world(["alpha-elites"]);
  const [host, guest] = w.players;
  Object.assign(host, { x: 0, z: 40 });
  Object.assign(guest, { x: 0, z: 0, alive: false });
  const x = -7;
  const z = 8.75;
  const scale = ELITE_BODY * CHALLENGE_ALPHA.body;
  const ground = heightAt(w.map.terrain, x, z);
  // The centre line fits the old margin, but the lifted front edge is on the guest's screen.
  assert.ok(viewClearance(w, x, z) > 1);
  assert.ok(
    phoneFrustum(w, guest).containsPoint(
      new Vector3(x, ground + FLYER_HOVER * scale, z - enemies.zubat.radius * scale),
    ),
  );
  const enemy = spawnReachable(w, "zubat", host, x, z, true);
  assert.ok(enemy);
  assertOffscreen(w, enemy);
});

test("an elite aimed into the arena wall falls back to a hidden spot that fits", () => {
  const w = world(["alpha-elites"], { players: [player] });
  const host = w.players[0];
  Object.assign(host, { x: 0, z: 40 });
  primeEnemyNav(w);
  // The whole ray between the host and the wall is on screen.
  for (const species of ["caterpie", "zubat"]) {
    const enemy = spawnReachable(w, species, host, 0, 43, true);
    assert.ok(enemy, species);
    assert.ok(Math.max(Math.abs(enemy.x), Math.abs(enemy.z)) + enemy.radius <= ARENA_HALF, species);
    const { mobility } = enemies[species];
    if (!mobility.flying) assert.ok(bodyFits(w.nav, mobility, enemy.x, enemy.z, enemy.radius));
    assertOffscreen(w, enemy);
  }
});

test("the director defers a boosted reinforcement when no spot fits", () => {
  const w = world(["alpha-elites"], { players: [player], difficulty: 1 });
  w.rng = createRng(0); // The first director roll is a ground elite.
  w.spawn.credit = 1;
  const blocker = addCircleBlocker(w.nav, 0, 0, ARENA_HALF * 2);
  updateDirector(w, 0);
  assert.equal(w.enemies.length, 0);
  assert.equal(w.spawn.credit, 1);

  removeBlocker(w.nav, blocker);
  updateDirector(w, 0);
  assert.equal(w.enemies.length, 1, "the deferred credit can spawn without waiting for new credit");
});

test("timeline alphas and raid alphas keep their native HP while guardians and plain enemies stay unchanged", () => {
  const pair = [world([], { stage: "coast" }), world(["alpha-elites"], { stage: "coast" })];
  const output = pair.map((w) => {
    w.spawn.pool = ["rattata"];
    fireBeat(w, { kind: "alpha" }, w.players[0]);
    const alpha = w.enemies[0];
    assert.ok(alpha?.alpha);
    const raid = w.sites.find(({ kind }) => kind === "raid-den");
    assert.equal(raid?.state, "ready");
    Object.assign(w.players[0], { x: raid.x, z: raid.z });
    assert.equal(interactSite(w, w.players[0]), true);
    w.time = raid.until;
    updateSites(context(w), TICK);
    const giant = w.enemies.find(({ id }) => id === raid.data.enemy);
    assert.ok(giant?.alpha);
    const plain = spawnEnemy(w, "rattata", 15, 15);
    const guardian = spawnEnemy(w, zoneDef(w).guardian.species, 15, 15);
    const elite = spawnEnemy(w, alpha.species, 15, 15, true);
    const raidBase = spawnEnemy(w, giant.species, 15, 15, true, raid.id);
    return { alpha, giant, plain, guardian, elite, raidBase };
  });
  const [normal, challenge] = output;
  close(normal.alpha.maxHp, normal.elite.maxHp * CHALLENGE_ALPHA.hp);
  close(normal.giant.maxHp, normal.raidBase.maxHp * SITE.raid.hp);
  for (const kind of ["alpha", "giant"]) stronger(normal[kind], challenge[kind], 1);
  for (const kind of ["plain", "guardian"]) assert.deepEqual(challenge[kind], normal[kind]);
});

test("a raid elite spawns clear of obstacles at its challenge body size", () => {
  const normal = world([], { stage: "coast" });
  const challenge = world(["alpha-elites"], { stage: "coast" });
  const raid = challenge.sites.find(({ kind }) => kind === "raid-den");
  const species = raid.data.species;
  const first = siteSpawnPoint(normal, raid, species, true, SITE.raid.scale);
  const base = spawnEnemy(normal, species, first.x, first.z, true, raid.id);
  const radius = base.radius * SITE.raid.scale;
  const obstacleRadius = 0.1;
  addCircleBlocker(
    challenge.nav,
    first.x + obstacleRadius + (radius * (1 + CHALLENGE_ALPHA.body)) / 2,
    first.z,
    obstacleRadius,
  );
  Object.assign(challenge.players[0], { x: raid.x, z: raid.z });
  assert.ok(interactSite(challenge, challenge.players[0]));
  challenge.time = raid.until;
  updateSites(context(challenge), TICK);
  const giant = challenge.enemies.find(({ id }) => id === raid.data.enemy);
  assert.ok(giant);
  const mobility = enemies[species].mobility;
  assert.ok(
    bodyFits(
      challenge.nav,
      mobility.flying ? mobilityClasses.ground : mobility,
      giant.x,
      giant.z,
      giant.radius,
    ),
  );
});

test("Wild Weather doubles eligible weather's weight with the same draws and no repeat", () => {
  for (const { stage, prior, thresholds } of [
    { stage: "desert", prior: [], thresholds: [3 / 4, 3 / 5] },
    { stage: "desert", prior: ["sandstorm"], thresholds: [1, 1] },
    { stage: "forest", prior: [], thresholds: [1, 1] },
  ]) {
    const pair = [world([], { stage }), world(["wild-weather"], { stage })];
    const { beats, events } = zoneDef(pair[0]);
    const weatherCount = [0, 0];
    for (let seed = 0; seed < 64; seed++) {
      const rng = createRng(seed);
      for (const _ of beats) next(rng);
      const draw = next(rng);
      const timing = next(rng);
      for (const [index, w] of pair.entries()) {
        w.rng = createRng(seed);
        w.eventsUsed = [...prior];
        scheduleField(w);
        const scheduled = w.zone.schedule.find(({ beat }) => beat.kind === "event");
        assert.ok(scheduled);
        const [from, to] = events.windows[0];
        close(scheduled.at, from + timing * (to - from));
        assert.equal(w.rng.state, rng.state);
        const expectWeather = draw >= thresholds[index];
        assert.equal(scheduled.beat.id === "sandstorm", expectWeather, `${stage} seed ${seed}`);
        if (expectWeather) weatherCount[index]++;
        else assert.ok(["horde", "outbreak", "site-awaken"].includes(scheduled.beat.id));
      }
      if (thresholds[0] === thresholds[1])
        assert.deepEqual(pair[0].zone.schedule, pair[1].zone.schedule);
    }
    if (thresholds[0] !== thresholds[1]) assert.ok(weatherCount[1] > weatherCount[0]);
  }
});
