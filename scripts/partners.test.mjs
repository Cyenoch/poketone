import assert from "node:assert/strict";
import test from "node:test";
import { labBonuses } from "../src/run/lab.ts";
import { killEnemy } from "../src/run/sim/combat.ts";
import { PLAYER_IFRAMES } from "../src/run/sim/content/params/player.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { formOf } from "../src/run/sim/evolution.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { updatePartners, partnersOf } from "../src/run/sim/partners.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { createNav } from "../src/run/sim/nav/index.ts";
import {
  BASE_PARTNER_SLOTS,
  CAPTURE_CHANCE,
  GUARD,
} from "../src/run/sim/content/params/partners.ts";
import { TERRAIN_HALF } from "../src/run/sim/terrain.ts";
import { apply } from "../src/run/sim/status.ts";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";

const world = (lab, seed = 7) =>
  createWorld({ stage: "forest", seed, difficulty: 0, players: [{ starter: "charmander", lab }] });

function spawnAlpha(w, species, x, z) {
  const enemy = spawnEnemy(w, species, x, z, true);
  enemy.alpha = true;
  return enemy;
}

/** Kills alphas at the player's side until `count` partners joined (or `tries` alphas died). */
function capture(w, species, count, tries = 60) {
  const player = w.players[0];
  for (let i = 0; i < tries && partnersOf(w, player).length < count; i++) {
    const alpha = spawnAlpha(w, species, player.x + 2, player.z);
    alpha.hp = 0;
    killEnemy({ world: w, grid: new EnemyGrid() }, alpha, player);
  }
  w.enemies = [];
  w.pickups = [];
  return partnersOf(w, player);
}

/** A quiet arena: no spawns, the player can't be hurt, no moves of its own. */
function quiet(w) {
  const player = w.players[0];
  player.moves = [];
  player.hp = 1e6;
  player.xpNext = 1e9;
  w.spawn.credit = -1e9;
  return player;
}

test("alphas join most often, other elites less, plain enemies never", () => {
  const joined = (kind) => {
    const w = world();
    let partners = 0;
    for (let i = 0; i < 400; i++) {
      const enemy = spawnEnemy(w, "rattata", 3, 0, kind !== "plain");
      enemy.alpha = kind === "alpha";
      enemy.hp = 0;
      killEnemy({ world: w, grid: new EnemyGrid() }, enemy, w.players[0]);
      partners += w.partners.length;
      w.partners = [];
    }
    return partners / 400;
  };
  const alpha = joined("alpha");
  const elite = joined("elite");
  assert.ok(Math.abs(alpha - CAPTURE_CHANCE.alpha) < 0.08, `alpha ${alpha}`);
  assert.ok(Math.abs(elite - CAPTURE_CHANCE.elite) < 0.08, `elite ${elite}`);
  assert.equal(joined("plain"), 0);
});

test("captures never pass the partner slots (2, 3 with 支援队伍)", () => {
  for (const [lab, slots] of [
    [undefined, BASE_PARTNER_SLOTS],
    [labBonuses({ party: 1 }), BASE_PARTNER_SLOTS + 1],
  ]) {
    const w = world(lab);
    w.events = [];
    const partners = capture(w, "rattata", 99, 40);
    assert.equal(partners.length, slots);
    assert.equal(w.events.filter((e) => e.t === "capture").length, slots);
    assert.deepEqual(
      w.events.filter((e) => e.t === "capture").map((e) => [e.player, e.partner, e.species]),
      partners.map((partner) => [partner.owner, partner.id, partner.species]),
    );
  }
});

test("a partner damages enemies, never the player, and doesn't block the player", () => {
  for (const species of [
    "rattata",
    "oddish",
    "paras",
    "vulpix",
    "nidoran-f",
    "voltorb",
    "electrode",
  ]) {
    const w = world();
    const player = quiet(w);
    const [partner] = capture(w, species, 1);
    assert.ok(partner, `${species} captured`);
    // Rooted (the first hit would wake a sleeper), out of the player's contact reach.
    const target = spawnEnemy(w, "caterpie", player.x + 4, player.z + 1);
    target.hp = target.maxHp = 1e6;
    target.speed = 0;
    const hp = player.hp;
    w.events = [];
    for (let tick = 0; tick < 30 * 6; tick++) stepWorld(w, []);
    assert.ok(target.hp < target.maxHp, `${species} hit the enemy`);
    assert.ok(w.events.some((e) => e.t === "partner-attack" && e.partner === partner.id));
    assert.equal(player.hp, hp);
    assert.ok(!w.events.some((e) => e.t === "player-hit"));
  }

  // Walking straight through the partner: the player covers the same ground as with none there.
  const walk = (withPartner) => {
    const w = world();
    const player = quiet(w);
    if (withPartner) {
      const [partner] = capture(w, "geodude", 1);
      partner.x = player.x + 1;
      partner.z = player.z;
    }
    for (let tick = 0; tick < 30; tick++) stepWorld(w, [{ t: "move", player: 0, x: 1, z: 0 }]);
    return player.x;
  };
  assert.equal(walk(true), walk(false));
});

test("a partner's shot needs a clear line: a wall between it and the enemy stops it", () => {
  const resolution = 2;
  const samples = TERRAIN_HALF * 2 * resolution + 1;
  const heights = new Float32Array(samples * samples);
  for (let j = 0; j < samples; j++)
    for (let i = 0; i < samples; i++) {
      const x = -TERRAIN_HALF + i / resolution;
      heights[j * samples + i] = x >= 2.5 && x <= 3.5 ? 4 : 0;
    }
  const hits = (walled) => {
    const w = world();
    const player = quiet(w);
    player.x = player.px = 0;
    player.z = player.pz = 0;
    if (walled)
      w.map.terrain = { ...w.map.terrain, resolution, samples, heights, origin: -TERRAIN_HALF };
    else
      w.map.terrain = {
        ...w.map.terrain,
        resolution,
        samples,
        heights: new Float32Array(samples * samples),
        origin: -TERRAIN_HALF,
      };
    const [partner] = capture(w, "oddish", 1);
    const target = spawnEnemy(w, "caterpie", 6, 0);
    target.hp = target.maxHp = 1e6;
    apply(target, "sleep", 1e6, 0, -1);
    for (let tick = 0; tick < 30 * 4; tick++) {
      // Hold the shooter at the player's side of the wall, facing the target.
      partner.x = partner.px = 1;
      partner.z = partner.pz = 0;
      stepWorld(w, []);
    }
    return target.maxHp - target.hp;
  };
  assert.ok(hits(false) > 0);
  assert.equal(hits(true), 0);
});

test("runs with partners fighting stay deterministic", () => {
  const play = () => {
    const w = createWorld({
      stage: "forest",
      seed: 33,
      difficulty: 1,
      players: [{ starter: "bulbasaur" }],
    });
    const player = w.players[0];
    player.hp = 1e6;
    player.xpNext = 1e9;
    capture(w, "spearow", 1);
    capture(w, "venonat", 2);
    w.time = 200;
    for (let tick = 0; tick < 30 * 45; tick++) {
      const angle = tick / 80;
      stepWorld(w, [{ t: "move", player: 0, x: Math.cos(angle), z: Math.sin(angle) }]);
    }
    assert.equal(w.partners.length, 2);
    return JSON.stringify({
      partners: w.partners,
      enemies: w.enemies.map((e) => [e.id, e.x, e.z, e.hp]),
      kills: player.kills,
    });
  };
  assert.equal(play(), play());
});

/** Rooted, unkillable caterpies touching a still player all round; returns the hits it took in `seconds`. */
function cornered(w, seconds) {
  const player = quiet(w);
  const reach = (formOf(player).radius + enemies.caterpie.radius) * 0.95;
  // Four bodies can keep touching without the swarm's separation pushing them off a small owner.
  for (let k = 0; k < 4; k++) {
    const angle = (k / 4) * Math.PI * 2;
    const enemy = spawnEnemy(
      w,
      "caterpie",
      player.x + Math.cos(angle) * reach,
      player.z + Math.sin(angle) * reach,
    );
    enemy.hp = enemy.maxHp = 1e6;
    enemy.speed = 0;
  }
  w.events = [];
  for (let tick = 0; tick < 30 * seconds; tick++) stepWorld(w, []);
  return w.events.filter((e) => e.t === "player-hit").length;
}

test("护主: partners shield a cornered owner in turns, once per rest, and only if they can reach", () => {
  const withParty = (count) => {
    const w = world();
    if (count > 0) capture(w, "rattata", count);
    const hits = cornered(w, GUARD.every);
    return { hits, guards: w.events.filter((e) => e.t === "partner-guard").length };
  };
  const alone = withParty(0);
  const one = withParty(1);
  const two = withParty(2);
  assert.equal(one.guards, 1);
  assert.equal(two.guards, 2, "the second partner takes over when the first shield ends");
  // Each shield covers what the catch would have landed meanwhile, and nothing past it.
  const perShield = Math.ceil((GUARD.shield - PLAYER_IFRAMES) / PLAYER_IFRAMES);
  assert.ok(
    one.hits < alone.hits && alone.hits - one.hits <= perShield,
    `${one.hits} / ${alone.hits}`,
  );
  assert.ok(two.hits < one.hits, `${two.hits} < ${one.hits}`);

  // A walking partner with a wall between it and its owner can't get there, so it can't shield.
  const resolution = 2;
  const samples = TERRAIN_HALF * 2 * resolution + 1;
  const heights = new Float32Array(samples * samples);
  for (let j = 0; j < samples; j++)
    for (let i = 0; i < samples; i++) {
      const x = -TERRAIN_HALF + i / resolution;
      heights[j * samples + i] = x >= 1.5 && x <= 2.5 ? 4 : 0;
    }
  const walled = world();
  walled.map.terrain = {
    ...walled.map.terrain,
    resolution,
    samples,
    heights,
    origin: -TERRAIN_HALF,
  };
  walled.nav = createNav(walled.map.terrain);
  const player = walled.players[0];
  player.x = player.px = 0;
  player.z = player.pz = 0;
  const [partner] = capture(walled, "rattata", 1);
  partner.x = partner.px = 4;
  partner.z = partner.pz = 0;
  assert.ok(cornered(walled, 3) > 0);
  assert.equal(walled.events.filter((e) => e.t === "partner-guard").length, 0);
});

test("a partner pulse hits a visible enemy but cannot pass through a rock", () => {
  const w = world();
  quiet(w);
  const resolution = 2;
  const samples = TERRAIN_HALF * 2 * resolution + 1;
  w.map.terrain = {
    origin: -TERRAIN_HALF,
    resolution,
    samples,
    heights: new Float32Array(samples * samples),
    step: 1.5,
    levels: 3,
  };
  w.nav = createNav(w.map.terrain);
  const [partner] = capture(w, "voltorb", 1);
  partner.x = partner.px = 0;
  partner.z = partner.pz = 0;
  partner.cooldown = 0;
  const player = w.players[0];
  player.x = player.px = 0;
  player.z = player.pz = 0;
  const open = spawnEnemy(w, "caterpie", 0, 1.5);
  const hidden = spawnEnemy(w, "caterpie", 2.2, 0);
  w.map.obstacles = [
    { kind: "rock", x: 1.1, z: 0, radius: 0.6, scale: 1, rotation: 0, solid: true },
  ];
  const hp = hidden.hp;
  const grid = new EnemyGrid();
  grid.rebuild(w.enemies);
  updatePartners({ world: w, grid }, 1 / 30);
  assert.ok(open.hp < open.maxHp);
  assert.equal(hidden.hp, hp);
});
