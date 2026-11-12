// Decisive checks of the analytical model's survival, healing, guardian, AoE and trigger rules
// (docs/BALANCE.md「模型修正（2026-11-06）」): each pins one contract the review found broken.
import assert from "node:assert/strict";
import test from "node:test";
import {
  bossCycle,
  bossHits,
  buildOutput,
  damageEvents,
  defenceOf,
  healPerSecond,
  occupancy,
} from "../src/run/balance/model.ts";
import { castPeriod, moveOutput, TERRAIN_SIGHT } from "../src/run/balance/output.ts";
import { moveParams } from "../src/run/sim/attacks.ts";
import { moves } from "../src/run/sim/content/moves.ts";
import {
  aliveOf,
  catchPmf,
  createHp,
  growHp,
  hitPmf,
  hpShare,
  stepHp,
} from "../src/run/balance/survival.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { updateEnemies } from "../src/run/sim/enemies.ts";
import { apply } from "../src/run/sim/status.ts";
import { playerStats } from "../src/run/sim/stats.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { newMoveState } from "../src/run/sim/upgrades.ts";
import { createPlayer, createWorld } from "../src/run/sim/world.ts";

const neutral = Object.fromEntries(
  ["normal", "fire", "water", "grass", "electric", "bug", "flying", "poison", "rock", "ground"].map(
    (t) => [t, 1],
  ),
);
const target = (over = {}) => ({
  density: 0,
  living: 1,
  hp: 1,
  radius: 0.5,
  typeVs: neutral,
  boss: { radius: 1.3, speed: 0, typeVs: neutral },
  melee: 1,
  speed: 0,
  give: [{ share: 1, give: 1 }],
  ...over,
});
const quiet = { heal: 0, poison: 0, floor: 0, charges: [], fallback: null };

test("evolution fills only the gained max HP and preserves deaths and spent saves", () => {
  const hp = createHp();
  // Half have died; survivors have spent a save and are missing 60 of their former 120 HP.
  hp.layers[0].fill(0);
  hp.layers[0][0] = 0.5;
  hp.layers.push(new Float64Array(hp.layers[0].length));
  hp.layers[1][30] = 0.5;
  growHp(hp, 120, 180);
  assert.equal(aliveOf(hp), 0.5);
  assert.ok(Math.abs(hpShare(hp) * 180 - 120) < 1e-9, "the same 60 HP is still missing");
  // A second lethal hit still kills them: growing the HP bar cannot return a spent run save.
  stepHp(hp, {
    ...quiet,
    events: [{ rate: 50, pmf: hitPmf(1) }],
    charges: [{ hp: 1, chance: 1, rescue: 1 }],
  });
  assert.ok(aliveOf(hp) < 1e-6);
});

test("a deterministic drain kills on its depletion second, not before", () => {
  // 1 HP/s off 100 HP: everyone alive through 99 s, nobody after 100 s (a 1/E[T] hazard gave 50% at 50 s).
  const hp = createHp();
  for (let t = 1; t <= 101; t++) {
    stepHp(hp, { ...quiet, events: [], heal: -0.01 });
    if (t === 50 || t === 99) assert.equal(aliveOf(hp), 1, `alive at ${t} s`);
  }
  assert.equal(aliveOf(hp), 0);
});

test("random hits and catches kill as often as a Monte Carlo of the same process", () => {
  // 0.4 hits/s of 12% HP, 0.05 catches/s of geometric(mean 6) runs of 8% hits, 1.5% HP/s regen, 90 s.
  const events = [
    { rate: 0.4, pmf: hitPmf(0.12) },
    { rate: 0.05, pmf: catchPmf(0.08, 6, [{ share: 1, hits: 0 }], 0), catch: true },
  ];
  const hp = createHp();
  for (let t = 0; t < 90; t++) stepHp(hp, { ...quiet, events, heal: 0.015 });
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const poisson = (rate) => {
    let n = 0;
    for (let p = Math.exp(-rate), u = rand(); u > p; u -= p, n++, p *= rate / n);
    return n;
  };
  let alive = 0;
  const RUNS = 20000;
  for (let r = 0; r < RUNS; r++) {
    let h = 1;
    let dead = false;
    for (let t = 0; t < 90 && !dead; t++) {
      h = Math.min(1, h + 0.0075);
      for (let n = poisson(0.4); n > 0; n--) h -= 0.12;
      for (let n = poisson(0.05); n > 0; n--) {
        let hits = 1;
        while (rand() < 5 / 6) hits++;
        h -= hits * 0.08;
      }
      if (h <= 1e-9) dead = true;
      h = Math.min(1, h + 0.0075);
    }
    if (!dead) alive++;
  }
  const mc = alive / RUNS;
  assert.ok(
    Math.abs(aliveOf(hp) - mc) < 0.04,
    `process ${aliveOf(hp).toFixed(3)} vs MC ${mc.toFixed(3)}`,
  );
});

test("a limited save holds once; evasion thins hits instead of shrinking them", () => {
  // A certain kill every second: one revive charge buys exactly one more second.
  const hp = createHp();
  const lethal = [{ rate: 50, pmf: hitPmf(1) }];
  const charges = [{ hp: 0.35, chance: 1, rescue: 1 }];
  stepHp(hp, { ...quiet, events: lethal, charges });
  assert.ok(aliveOf(hp) > 0.99, "the revive holds the first death");
  stepHp(hp, { ...quiet, events: lethal, charges });
  assert.ok(aliveOf(hp) < 1e-6, "no charge is left for the second");

  const stats = playerStats(createPlayer(0, "charmander", 0));
  const hits = [{ rate: 1, dmg: 10 }];
  const plain = damageEvents(hits, 100, 6, defenceOf(stats), { partners: 0, ready: 0 }, 0, 0);
  const evasive = damageEvents(
    hits,
    100,
    6,
    { ...defenceOf(stats), evasion: 0.3 },
    { partners: 0, ready: 0 },
    0,
    0,
  );
  assert.ok(Math.abs(evasive.events[0].rate - 0.7 * plain.events[0].rate) < 1e-9);
  assert.deepEqual(evasive.events[0].pmf, plain.events[0].pmf);
});

test("a shield soaks fights spaced past its recharge, not a steady stream", () => {
  const stats = playerStats(createPlayer(0, "charmander", 0));
  const defence = { ...defenceOf(stats), shield: 10 };
  const soaked = (rate) => {
    const { meanDps } = damageEvents(
      [{ rate, dmg: 10 }],
      100,
      6,
      defence,
      { partners: 0, ready: 0 },
      0,
      0,
    );
    return 1 - meanDps / (rate * 10);
  };
  assert.ok(soaked(1 / 8) > 0.4, `hits 8 s apart: ${soaked(1 / 8).toFixed(2)} soaked`);
  assert.ok(soaked(2) < 0.01, `2 hits/s: ${soaked(2).toFixed(3)} soaked`);
});

test("heals read the HP removed after the split: the guardian heals, overkill does not", () => {
  // A guardian-only dummy: Shell Bell, Giga Drain and Photosynthesis all heal off the guardian.
  const player = createPlayer(0, "bulbasaur", 0);
  player.moves = [newMoveState("giga-drain")];
  player.items.push({ id: "shell-bell", level: 1 });
  const out = buildOutput(player, target({ living: 0 }));
  const { stats } = out;
  const hp = { below: () => 0, full: 0 };
  const none = { swarm: 1, boss: 0, eliteRemoved: 0, partners: 0 };
  const idle = healPerSecond(out, none, 0, hp);
  assert.ok(Math.abs(idle - stats.regen * stats.healing) < 1e-9, "no target: regen only");
  const onBoss = healPerSecond(out, { ...none, boss: 1 }, 0, hp);
  const photo = stats.triggers.find((t) => t.def.kind === "healOnHit").def;
  const expected =
    (stats.regen + (stats.lifesteal + moves["giga-drain"].drain) * out.single) * stats.healing +
    Math.min(photo.perSecond, out.bossHits) * photo.heal * stats.maxHp * stats.healing;
  assert.ok(out.single > 0 && Math.abs(onBoss - expected) < 1e-9, `${onBoss} vs ${expected}`);

  // One 1-HP enemy per cast: lifesteal heals off 1 HP per kill, however big the hit.
  const swarm = buildOutput(player, target({ hp: 1 }));
  const kills = swarm.direct;
  const healed = healPerSecond(swarm, none, kills, hp) - idle;
  assert.ok(
    healed <=
      (stats.lifesteal + moves["giga-drain"].drain) * kills * stats.healing +
        5 * photo.heal * stats.maxHp * stats.healing +
        1e-9,
  );
  assert.ok(swarm.direct <= swarm.hits + 1e-9, "at most the target's HP per kill");
});

test("the guardian's rhythm and its paralysis match Scyther's brain", () => {
  /** Dash wind-ups the real brain starts on a still target 4 m away over `seconds`. */
  function simDashes(seconds, paralyse) {
    const world = createWorld({
      stage: "forest",
      seed: 5,
      difficulty: 0,
      players: [{ starter: "squirtle" }],
    });
    const player = world.players[0];
    player.hp = 1e9;
    const boss = spawnEnemy(
      world,
      stageDefs.forest.zones[0].guardian.species,
      player.x + 4,
      player.z,
    );
    world.enemies = [boss];
    const ctx = { world, grid: new EnemyGrid() };
    let dashes = 0;
    let last = boss.phase;
    for (let tick = 0; tick < seconds / TICK; tick++) {
      world.time += TICK;
      player.x = boss.x - 4;
      player.z = boss.z;
      player.invulnerable = 1;
      if (paralyse && tick % 30 === 0) apply(boss, "paralysis", 1e9, 1, player.id);
      ctx.grid.rebuild(world.enemies);
      updateEnemies(ctx, TICK);
      if (boss.phase === "windup" && last !== "windup") dashes++;
      last = boss.phase;
    }
    return dashes;
  }
  const seconds = 120;
  const sim = simDashes(seconds, false);
  const model = seconds / bossCycle(0);
  assert.ok(Math.abs(model / sim - 1) < 0.1, `model ${model.toFixed(1)} vs sim ${sim} cycles`);
  assert.equal(simDashes(30, true), 0, "a paralysed guardian starts no attack");
});

test("one cast's volleys share each victim's HP, and procs need a live neighbour", () => {
  // Whirlpool's ticks and its burst on one 1-HP target: at most 1 HP per cast (each phase had its own cap).
  const player = createPlayer(0, "squirtle", 0);
  player.moves = [newMoveState("whirlpool")];
  const stats = playerStats(player);
  const lone = target({ hp: 1 });
  const out = moveOutput(player.moves[0], stats, lone);
  const casts = TERRAIN_SIGHT / castPeriod(moveParams(player.moves[0], stats).cd);
  assert.ok(
    Math.abs(out.useful / casts - 1) < 1e-9,
    `${(out.useful / casts).toFixed(3)} HP per cast`,
  );
  assert.ok(out.targets <= 1, "never more distinct targets than are engaged");

  // An isolated 1-HP victim: Flame Orb cannot burn the dead, Leaf Stone has no one to burst on.
  const kit = createPlayer(0, "bulbasaur", 0);
  kit.moves = [newMoveState("vine-whip")];
  const base = buildOutput(kit, lone).useful;
  for (const item of ["flame-orb", "leaf-stone"]) {
    const withItem = structuredClone(kit);
    withItem.items.push({ id: item, level: 1 });
    const value = buildOutput(withItem, lone).useful;
    assert.ok(Math.abs(value - base) < 1e-9, `${item}: ${value} vs ${base}`);
  }
});

test("a sleeper wakes at the next hit", () => {
  const stats = playerStats(createPlayer(0, "bulbasaur", 0));
  const out = (hits) => ({
    ...moveOutput(newMoveState("vine-whip"), stats, target()),
    hits,
    apply: [{ status: "sleep", swarm: 1, boss: 0 }],
    knocks: [],
  });
  const calm = occupancy(out(0), stats, target({ living: 4 })).held;
  const busy = occupancy(out(40), stats, target({ living: 4 })).held;
  assert.ok(
    busy < calm / 2,
    `sleep under fire ${busy.toFixed(2)} vs undisturbed ${calm.toFixed(2)}`,
  );
});

test("paralysis on the guardian delays its attacks, as the brain's running chase clock does", () => {
  /** Dash wind-ups the real brain starts on a still target with random 1.05 s paralyses at `rate`. */
  function simDashes(seconds, rate) {
    const world = createWorld({
      stage: "forest",
      seed: 5,
      difficulty: 0,
      players: [{ starter: "squirtle" }],
    });
    const player = world.players[0];
    player.hp = 1e9;
    const boss = spawnEnemy(
      world,
      stageDefs.forest.zones[0].guardian.species,
      player.x + 4,
      player.z,
    );
    world.enemies = [boss];
    const ctx = { world, grid: new EnemyGrid() };
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let dashes = 0;
    let last = boss.phase;
    for (let tick = 0; tick < seconds / TICK; tick++) {
      world.time += TICK;
      player.x = boss.x - 4;
      player.z = boss.z;
      player.invulnerable = 1;
      if (rand() < rate * TICK) apply(boss, "paralysis", 1.05, 1, player.id);
      ctx.grid.rebuild(world.enemies);
      updateEnemies(ctx, TICK);
      if (boss.phase === "windup" && last !== "windup") dashes++;
      last = boss.phase;
    }
    return dashes;
  }
  const stats = playerStats(createPlayer(0, "pikachu", 0));
  const guardian = stageDefs.forest.zones[0].guardian.species;
  const dashRate = (rate) => {
    const out = { ...moveOutput(newMoveState("thunder-shock"), stats, target()), bossHits: 0 };
    out.apply = [{ status: "paralysis", swarm: 0, boss: rate }];
    const occ = occupancy(out, stats, target());
    return bossHits(guardian, 0, 1, 1, 0, false, 0.5, {
      stopped: occ.bossStopped,
      delay: occ.bossDelay,
      interrupts: occ.bossInterrupts,
    })[0].rate;
  };
  const seconds = 600;
  const base = simDashes(seconds, 0);
  for (const rate of [0.7, 1.5]) {
    const sim = simDashes(seconds, rate) / base;
    const model = dashRate(rate) / dashRate(0);
    assert.ok(
      Math.abs(model - sim) < 0.06,
      `rate ${rate}: model ×${model.toFixed(2)} vs sim ×${sim.toFixed(2)}`,
    );
  }
});

test("Bonk! and Razor Fang never kill more than the hits that land", () => {
  const player = createPlayer(0, "charmander", 0);
  player.moves = [newMoveState("ember")];
  player.items.push({ id: "stick", level: 4 }, { id: "razor-fang", level: 4 });
  const out = buildOutput(player, target({ hp: 1, living: 20, density: 0.05 }));
  // Each kill removes the 1 HP of one target; no more kills than hits land.
  assert.ok(
    out.useful <= out.primary.hits + 1e-9,
    `${out.useful.toFixed(3)} kills vs ${out.primary.hits.toFixed(3)} hits`,
  );
});
