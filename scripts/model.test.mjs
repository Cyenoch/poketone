import assert from "node:assert/strict";
import test from "node:test";
import { itemValues, moveBudgets } from "../src/run/balance/budget.ts";
import { coopBudget } from "../src/run/balance/coop.ts";
import {
  bossHits,
  buildOutput,
  fieldAt,
  previewChoice,
  runModel,
  targetFor,
} from "../src/run/balance/model.ts";
import { zoneGuardianBrain } from "../src/run/sim/bosses/zone-guardians.ts";
import { kinglerBrain } from "../src/run/sim/bosses/kingler.ts";
import { ZONE_ATTACK } from "../src/run/sim/content/params/late-zones.ts";
import { KINGLER, furyOf } from "../src/run/sim/content/params/guardian.ts";
import { MELEE_STEP, moveOutput, TERRAIN_SIGHT } from "../src/run/balance/output.ts";
import { average, expert, novice } from "../src/run/balance/skill.ts";
import { updateAreas, updateMoves, updateProjectiles } from "../src/run/sim/attacks.ts";
import { difficulties } from "../src/run/sim/content/difficulties.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { items } from "../src/run/sim/content/items.ts";
import { moves } from "../src/run/sim/content/moves.ts";
import { LOOT } from "../src/run/sim/content/params/economy.ts";
import { STARDUST } from "../src/run/sim/content/params/economy.ts";
import {
  ALPHA_HP,
  ELITE,
  ELITE_WAVE_SIZE,
  ENEMY_HEALTH,
  GUARDIAN_REFERENCE_SECONDS,
} from "../src/run/sim/content/params/pacing.ts";
import { CAPTURE_CHANCE } from "../src/run/sim/content/params/partners.ts";
import { ULT_CHARGE } from "../src/run/sim/content/params/ultimates.ts";
import { ultChargeRate } from "../src/run/balance/ultimate.ts";
import { chargeUltimate } from "../src/run/sim/ultimates/index.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { killEnemy } from "../src/run/sim/combat.ts";
import { evolve } from "../src/run/sim/evolution.ts";
import { createRng, next } from "../src/run/sim/rng.ts";
import { playerStats, refreshStats, xpForLevel } from "../src/run/sim/stats.ts";
import { decay, dotRate } from "../src/run/sim/status.ts";
import { TERRAIN_HALF } from "../src/run/sim/terrain.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { applyChoice, newMoveState } from "../src/run/sim/upgrades.ts";
import {
  applyCommand,
  collectRemainingPickups,
  createPlayer,
  createWorld,
} from "../src/run/sim/world.ts";

const SECONDS = 20;

test("guardian exposure excludes unfinished fights instead of scoring early death as a cheap kill", () => {
  const options = {
    stage: "forest",
    starter: "bulbasaur",
    difficulty: 0,
    skill: expert,
    samples: 1,
  };
  assert.equal(
    runModel(options).fights[0].completed,
    1,
    "the build reaches and wins the baseline fight",
  );
  const dmg = enemies.scyther.dmg;
  const hp = enemies.scyther.hp;
  try {
    enemies.scyther.dmg = 1e6;
    enemies.scyther.hp = 1e9;
    const fight = runModel(options).fights[0];
    assert.equal(fight.attempted, 1);
    assert.equal(fight.completed, 0);
    assert.equal(fight.cost, null, "an unfinished fight has no full-fight cost");
    assert.equal(fight.seconds, null);
  } finally {
    enemies.scyther.dmg = dmg;
    enemies.scyther.hp = hp;
  }
});

test("extra guardian exposure waits for the first cast and slows with phase and paralysis delays", () => {
  const fury = furyOf("desert", 2);
  const extra = (status, seconds = 60) =>
    bossHits("aerodactyl", 2, 1, 1, 0, true, 0.43, status, fury, seconds).at(-1).rate;
  const clear = { stopped: 0, delay: 0, interrupts: 0 };
  assert.equal(extra(clear, 0), 0);
  assert.ok(extra(clear) > 0);
  assert.ok(extra({ ...clear, delay: 2 }) < extra(clear));
  assert.ok(
    extra(clear) < 1 / (fury.every * fury.lowEvery),
    "native chains postpone some due casts",
  );
});

test("guardian tuning changes both actual hazards and their modelled exposure", () => {
  const world = createWorld({
    stage: "tower",
    seed: 11,
    difficulty: 0,
    players: [{ starter: "squirtle" }],
  });
  const player = world.players[0];
  for (const [species, params, kind, turn, stream] of [
    ["mr-mime", ZONE_ATTACK.cage, "closing-box", 0, 0],
    ["gengar", ZONE_ATTACK.curse, "curse-mark", 2, 3],
  ]) {
    const saved = params.lowCount;
    const sample = (count) => {
      params.lowCount = count;
      world.enemies = [];
      world.hazards = [];
      const boss = spawnEnemy(world, species, player.x, player.z + 5);
      boss.hp = boss.maxHp / 4;
      boss.phaseTime = 10;
      boss.attackTimer = turn;
      zoneGuardianBrain(world, boss, player, boss.speed, TICK);
      return {
        hazards: world.hazards.filter((h) => h.kind === kind).length,
        rate: bossHits(species, 0, 1, 1, 0, true, 0.4)[stream].rate,
      };
    };
    try {
      const single = sample(1);
      const double = sample(2);
      assert.equal(double.hazards, single.hazards * 2);
      assert.equal(double.rate, single.rate * 2);
      assert.ok(single.hazards > 0 && single.rate > 0);
    } finally {
      params.lowCount = saved;
    }
  }
  const radius = KINGLER.bubbleRadius;
  const sampleBubble = (scale) => {
    KINGLER.bubbleRadius = scale;
    world.hazards = [];
    world.map.terrain = flatTerrain();
    const boss = spawnEnemy(world, "kingler", player.x, player.z + 5);
    boss.phase = "windup";
    boss.attackTimer = 2;
    boss.phaseTime = 10;
    kinglerBrain(world, boss, player, boss.speed, TICK);
    return {
      radius: world.hazards.find((h) => h.kind === "bubble").radius,
      rate: bossHits("kingler", 0, 1, 1, 0, false, 0.4)[0].rate,
    };
  };
  try {
    const before = sampleBubble(radius);
    const larger = sampleBubble(radius * 2);
    assert.equal(larger.radius, before.radius * 2);
    assert.ok(larger.rate > before.rate);
  } finally {
    KINGLER.bubbleRadius = radius;
  }
});

function flatTerrain() {
  const resolution = 2;
  const samples = TERRAIN_HALF * 2 * resolution + 1;
  return {
    origin: -TERRAIN_HALF,
    resolution,
    samples,
    heights: new Float32Array(samples * samples),
    step: 1.5,
    levels: 3,
  };
}

/** Damage the real sim deals with one level-1 move to an unkillable rattata `distance` ahead. */
function simDamage(move, distance) {
  const world = createWorld({
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: [{ starter: "bulbasaur" }],
  });
  world.map.terrain = flatTerrain();
  const player = world.players[0];
  player.moves = [newMoveState(move)];
  const dummy = spawnEnemy(world, "rattata", distance, 0);
  dummy.x = dummy.px = distance;
  dummy.z = dummy.pz = 0;
  dummy.hp = dummy.maxHp = 1e9;
  const ctx = { world, grid: new EnemyGrid() };
  for (let tick = 0; tick < SECONDS / TICK; tick++) {
    ctx.grid.rebuild(world.enemies);
    updateMoves(ctx, player, TICK);
    updateProjectiles(ctx, TICK);
    updateAreas(ctx, TICK);
  }
  return dummy.maxHp - dummy.hp;
}

/** The model's damage on the same lone target, with the terrain availability factors removed. */
function modelDamage(move) {
  const player = createWorld({
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: [{ starter: "bulbasaur" }],
  }).players[0];
  const neutral = Object.fromEntries(
    ["normal", "fire", "water", "grass", "electric", "bug", "flying", "poison"].map((t) => [t, 1]),
  );
  const target = {
    density: 0,
    living: 1,
    hp: 1e9,
    radius: enemies.rattata.radius,
    typeVs: neutral,
    boss: { radius: 1.3, speed: 0, typeVs: neutral },
    melee: 1,
    speed: 0,
    give: [{ share: 1, give: 1 }],
  };
  const out = moveOutput(newMoveState(move), playerStats(player), target);
  const short = ["strike", "cone", "spin", "nova"].includes(moves[move].archetype);
  return (out.raw * SECONDS) / (TERRAIN_SIGHT * (short ? MELEE_STEP : 1));
}

test("modelled move damage on a lone target matches the sim's cast timing, ticks and fan", () => {
  // Strike (one swing per cast), barrage (half the fan misses a small target at 6 m), beam and
  // spin (lingering ticks); grass/normal vs a normal-type target so type and statuses stay out.
  for (const [move, distance] of [
    ["vine-whip", 1],
    ["razor-leaf", 6],
    ["solar-beam", 5],
    ["rapid-spin", 0.75],
    // Steered shots (both of a pair connect), a lobbed burst, a wave and a nova, one hit each.
    ["shock-wave", 6],
    ["giga-drain", 6],
    ["seed-bomb", 6],
    ["surf", 3],
    ["discharge", 1],
  ]) {
    const sim = simDamage(move, distance);
    const model = modelDamage(move);
    assert.ok(
      Math.abs(model / sim - 1) < 0.1,
      `${move}: model ${model.toFixed(0)} vs sim ${sim.toFixed(0)} over ${SECONDS} s`,
    );
  }
});

test("guardian conditional damage follows applied control and statuses in both model and combat", () => {
  const world = createWorld({
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: [{ starter: "squirtle" }],
  });
  world.map.terrain = flatTerrain();
  const player = world.players[0];
  const dummy = spawnEnemy(world, "scyther", 6, 0);
  world.bossId = dummy.id;
  const ctx = { world, grid: new EnemyGrid() };
  const target = targetFor(fieldAt("forest", 30, 0, false), 1, average);
  target.boss.speed = 0;
  const measure = (move, item, sourceItem) => {
    world.rng = createRng(3);
    world.projectiles = [];
    world.areas = [];
    player.moves = [newMoveState(move)];
    player.items = [sourceItem, item].filter(Boolean).map((id) => ({ id, level: 3 }));
    dummy.hp = dummy.maxHp = 1e8;
    dummy.statuses = [];
    const output = buildOutput(player, target);
    let simDot = 0;
    for (let tick = 0; tick < 120 / TICK; tick++) {
      refreshStats();
      ctx.grid.rebuild(world.enemies);
      updateMoves(ctx, player, TICK);
      const dot = dotRate(dummy) * TICK;
      simDot += dot;
      dummy.hp -= dot;
      decay(dummy, TICK);
      updateProjectiles(ctx, TICK);
      updateAreas(ctx, TICK);
    }
    return {
      model: output.single,
      modelDot: output.bossBurn,
      sim: dummy.maxHp - dummy.hp - simDot,
      simDot,
    };
  };
  for (const [move, item, active, sourceItem] of [
    ["thunder-shock", "binding-band", true],
    ["water-gun", "full-heal", true],
    ["water-gun", "binding-band", false],
    ["razor-leaf", "full-heal", false],
    ["ember", "full-heal", true],
    ["water-gun", "full-heal", true, "toxic-orb"],
  ]) {
    const base = measure(move, undefined, sourceItem);
    const boosted = measure(move, item, sourceItem);
    if (active) {
      assert.ok(boosted.sim > base.sim, `${item}: actual guardian hits gain damage`);
      assert.ok(boosted.model > base.model, `${item}: guardian forecast includes that gain`);
      assert.ok(
        Math.abs(boosted.sim / base.sim - boosted.model / base.model) < 0.1,
        `${item}: estimated occupancy stays near the controlled combat sample`,
      );
      if (base.simDot > 0) {
        assert.ok(boosted.simDot > base.simDot, `${move}: real DoT inherits the stronger hit`);
        assert.ok(boosted.modelDot > base.modelDot, `${move}: forecast DoT includes that gain`);
        assert.ok(
          Math.abs(boosted.simDot / base.simDot - boosted.modelDot / base.modelDot) < 0.1,
          `${move}: forecast DoT applies the conditional gain once`,
        );
      }
    } else assert.deepEqual(boosted, base, `${item}: unmet condition grants no damage`);
  }
});

test("a stronger move gets a bigger budget, tougher enemies a lower pressure and survival", () => {
  const budget = () => moveBudgets("forest", 0, average).find((b) => b.move === "ember");
  const before = budget();
  const dmg = moves.ember.dmg;
  moves.ember.dmg = dmg * 1.5;
  try {
    const after = budget();
    assert.ok(after.aoe > before.aoe && after.single > before.single);
  } finally {
    moves.ember.dmg = dmg;
  }

  const run = () =>
    runModel({ stage: "forest", starter: "bulbasaur", difficulty: 0, skill: novice, samples: 8 });
  const easy = run();
  const hp = difficulties[0].hp;
  difficulties[0].hp = hp * 1.5;
  try {
    const hard = run();
    const at5 = (r) => r.minutes.find((m) => m.t === 300).pressure;
    assert.ok(at5(hard) < at5(easy), "pressure at 5:00 should fall");
    // Not run length: a run that clears the guardian ends early, so a harder clear can run longer.
    assert.ok(hard.outcome.reachBoss < easy.outcome.reachBoss, "fewer should reach the guardian");
    assert.ok(hard.outcome.clear < easy.outcome.clear, "fewer should clear");
  } finally {
    difficulties[0].hp = hp;
  }
});

test("the model and the sim give each zone of every stage the same guardian HP", () => {
  // Field time changes the swarm, while every guardian keeps its fixed map challenge.
  for (const stage of Object.keys(stageDefs)) {
    const world = createWorld({
      stage,
      seed: 3,
      difficulty: 0,
      players: [{ starter: "bulbasaur" }],
    });
    stageDefs[stage].zones.forEach((zone, index) => {
      world.zone.index = index;
      for (const at of [30, GUARDIAN_REFERENCE_SECONDS, 660]) {
        world.zone.tick = at / TICK;
        world.rampage = at >= stageDefs[stage].duration;
        const sim = spawnEnemy(world, zone.guardian.species, 0, 10);
        const model = coopBudget(stage, 0, at, world.players, average, index).guardianHp;
        const target = targetFor(fieldAt(stage, at, 0, world.rampage, index), 1, average);
        assert.ok(
          Math.abs(sim.maxHp / model - 1) < 1e-9,
          `${stage} at ${at}: ${sim.maxHp} vs ${model}`,
        );
        assert.equal(target.boss.speed, sim.speed, `${stage} at ${at}: same guardian speed`);
      }
    });
  }
});

test("field HP matches spawned enemies at entry, growth and rampage without changing damage or speed", () => {
  for (const stage of Object.values(stageDefs)) {
    const world = createWorld({
      stage: stage.id,
      seed: 3,
      difficulty: 0,
      players: [{ starter: "squirtle" }],
    });
    for (const [index, zone] of stage.zones.entries()) {
      const roster = zone.roster;
      // A single species isolates spawn HP from the model's hardening/healer estimates.
      zone.roster = [[0, "rattata"]];
      try {
        world.zone.index = index;
        for (const difficulty of [0, 1, 2]) {
          world.difficulty = difficulty;
          for (const time of [0, 60, 120, 480, stage.duration + 60]) {
            world.zone.tick = time / TICK;
            world.rampage = time > stage.duration;
            const field = fieldAt(stage.id, time, difficulty, world.rampage, index);
            const enemy = spawnEnemy(world, "rattata", 0, 10);
            const elite = spawnEnemy(world, "rattata", 0, 10, true);
            const label = `${stage.id}/${index}/${difficulty}/${time}`;
            assert.equal(field.hp, enemy.maxHp, `${label}: HP`);
            assert.equal(field.hp * ELITE.hp, elite.maxHp, `${label}: elite HP`);
            assert.equal(field.dmg, enemy.dmg, `${label}: damage`);
            assert.equal(field.speed, enemy.speed, `${label}: speed`);
            assert.equal(field.xp, enemy.xp, `${label}: XP`);
          }
        }
      } finally {
        zone.roster = roster;
      }
    }
  }
});

/** A dense single-species field, fixed one-target output and no random elites or growth. */
function withEliteField(check) {
  const stage = stageDefs.forest;
  const zone = stage.zones[0];
  const saved = {
    duration: stage.duration,
    roster: zone.roster,
    beats: zone.beats,
    amount: difficulties[0].amount,
    enemy: { ...enemies.rattata },
    move: { ...moves["water-gun"] },
    capture: { ...CAPTURE_CHANCE },
    health: { ...ENEMY_HEALTH },
  };
  const options = {
    stage: "forest",
    starter: "squirtle",
    difficulty: 0,
    skill: { ...expert, contact: 0, pickup: 1, chests: 0 },
    lab: {
      modifiers: [
        { stat: "damage", op: "mul", value: 2 },
        { stat: "ultCharge", op: "mul", value: 0 },
      ],
      rules: { partners: 10 },
    },
    samples: 1,
  };
  try {
    stage.duration = 60;
    zone.roster = [[0, "rattata"]];
    zone.beats = [];
    difficulties[0].amount = 100;
    Object.assign(enemies.rattata, { hp: 1, xp: 0, dmg: 0 });
    Object.assign(moves["water-gun"], { pierce: 0, stats: [] });
    Object.assign(CAPTURE_CHANCE, { alpha: 0, elite: 0 });
    check(options, zone);
  } finally {
    stage.duration = saved.duration;
    zone.roster = saved.roster;
    zone.beats = saved.beats;
    difficulties[0].amount = saved.amount;
    Object.assign(enemies.rattata, saved.enemy);
    Object.assign(moves["water-gun"], saved.move);
    Object.assign(CAPTURE_CHANCE, saved.capture);
    Object.assign(ENEMY_HEALTH, saved.health);
  }
}

test("mixed alpha and elite batches spend crossing damage at their own birth costs", () => {
  withEliteField((options, zone) => {
    const empty = runModel(options);
    const player = createPlayer(0, options.starter, 0, options.lab);
    zone.beats = [
      [57, { kind: "alpha" }],
      [58, { kind: "elite-wave" }],
    ];
    const run = runModel(options);
    const alphaHp = fieldAt("forest", 57, 0, false).hp * ELITE.hp * ALPHA_HP;
    const eliteHp = fieldAt("forest", 58, 0, false).hp * ELITE.hp;
    const raw = buildOutput(
      player,
      targetFor(fieldAt("forest", 57, 0, false), 10, options.skill),
    ).raw;
    const damage = raw * 0.3; // The model allocates 30% to elites while any remain.
    assert.ok(Math.abs(run.beats[0].clear - alphaHp / damage) < 1e-9);
    assert.ok(Math.abs(run.beats[1].clear - (ELITE_WAVE_SIZE * eliteHp) / damage) < 1e-9);
    const crossingSeconds = Math.ceil(alphaHp / damage);
    assert.ok(crossingSeconds * damage > alphaHp && (crossingSeconds - 1) * damage < alphaHp);
    const eliteKills = 1 + (4 * damage - alphaHp) / eliteHp;
    assert.ok(
      eliteKills > 1 && eliteKills < 1 + ELITE_WAVE_SIZE,
      "the sampled interval clears alpha and partially spends the next batch",
    );
    const swarmRate = empty.minutes[0].useful / fieldAt("forest", 60, 0, false).hp;
    const swarmKills = empty.minutes[0].kills - 4 * swarmRate * 0.3;
    assert.ok(Math.abs(run.minutes[0].kills - swarmKills - eliteKills) < 1e-9);
    assert.ok(Math.abs(run.kills.elites - (1 + ELITE_WAVE_SIZE)) < 1e-9);
    assert.ok(
      Math.abs(
        run.stardust -
          run.kills.swarm * STARDUST.ordinary.chance * STARDUST.ordinary.value -
          (1 + ELITE_WAVE_SIZE) * STARDUST.elite,
      ) < 1e-8,
      "cleared batches never pay for the same health twice",
    );
    options.skill.chests = 1;
    const rewarded = runModel(options);
    for (let i = 0; i < 1 + ELITE_WAVE_SIZE; i++)
      applyChoice(player, { kind: "upgrade", move: "water-gun", rarity: 1, rolls: [] });
    const expected =
      buildOutput(player, targetFor(fieldAt("forest", 120, 0, false), 10, options.skill)).single *
      options.skill.bossFocus;
    assert.ok(
      Math.abs(rewarded.minutes[1].single - expected) < 1e-9,
      "fractional kills across seconds still settle the final whole chest",
    );
  });
});

test("elite contact pressure uses remaining count even when enemy HP tuning changes", () => {
  withEliteField((options, zone) => {
    options.lab.modifiers.push({ stat: "damage", op: "mul", value: 0 });
    options.skill.contact = expert.contact;
    enemies.rattata.dmg = 1;
    zone.beats = [
      [30, { kind: "alpha" }],
      [45, { kind: "elite-wave" }],
    ];
    const before = runModel(options);
    ENEMY_HEALTH.earlyGain += 1;
    ENEMY_HEALTH.lateGain += 2;
    const after = runModel(options);
    assert.ok(after.beats[0].clear > before.beats[0].clear);
    assert.equal(before.kills.elites, 0);
    assert.equal(after.kills.elites, 0);
    assert.deepEqual(
      after.minutes.map((row) => row.inDps),
      before.minutes.map((row) => row.inDps),
      "undamaged alpha/elite bodies keep the same contact pressure as the clock advances",
    );
  });
});

test("cleared mixed batches grant one chest and capture chance each; fixed partners ignore enemy HP tuning", () => {
  withEliteField((options, zone) => {
    moves["water-gun"].dmg *= 100;
    enemies.rattata.dmg = 1;
    CAPTURE_CHANCE.alpha = 1;
    options.skill.chests = 1;
    zone.beats = [
      [60, { kind: "alpha" }],
      [60, { kind: "elite-wave" }],
    ];
    const before = runModel(options);
    ENEMY_HEALTH.earlyGain += 1;
    ENEMY_HEALTH.lateGain += 2;
    const after = runModel(options);
    const player = createPlayer(0, options.starter, 0, options.lab);
    for (let i = 0; i < 1 + ELITE_WAVE_SIZE; i++)
      applyChoice(player, { kind: "upgrade", move: "water-gun", rarity: 1, rolls: [] });
    for (const run of [before, after]) {
      assert.equal(run.kills.elites, 1 + ELITE_WAVE_SIZE);
      const row = run.minutes[1];
      const expected = buildOutput(
        player,
        targetFor(fieldAt("forest", row.t, 0, false), 10, options.skill),
      );
      assert.ok(
        Math.abs(row.single - expected.single * options.skill.bossFocus) < 1e-9,
        "exactly one upgrade per elite, including the alpha",
      );
      assert.equal(row.partners, 1, "only the alpha is captured, once, with free slots remaining");
      assert.ok(row.partnerDps > 0);
    }
    assert.deepEqual(
      after.minutes.map((row) => row.partnerDps),
      before.minutes.map((row) => row.partnerDps),
      "a fixed partner species, build and clock keep the same output",
    );
  });
});

test("mixed batches pay XP and ultimate charge for their count, not their extra HP", () => {
  withEliteField((options, zone) => {
    moves["water-gun"].dmg *= 100;
    const count = 1 + ELITE_WAVE_SIZE;
    // Clear everything on the final second: XP cannot change the preceding build or kill rate.
    zone.beats = [
      [180, { kind: "alpha" }],
      [180, { kind: "elite-wave" }],
    ];
    enemies.rattata.xp = 0.00001;
    const rounded = runModel(options);
    assert.equal(
      rounded.levelAt[2],
      180,
      "four elites drop six individually rounded XP portions each",
    );
    assert.equal(rounded.levelAt.length, 3, "24 XP buys level two, not phantom alpha kills");
    const actual = createWorld({
      stage: "forest",
      seed: 3,
      difficulty: 0,
      players: [{ starter: "squirtle" }],
    });
    for (let i = 0; i < count; i++) {
      const elite = spawnEnemy(actual, "rattata", 0, 5, true);
      killEnemy({ world: actual, grid: new EnemyGrid() }, elite, actual.players[0]);
    }
    collectRemainingPickups(actual);
    assert.equal(actual.players[0].level, rounded.levelAt.length - 1);
    assert.equal(fieldAt("forest", 180, 0, false).eliteXp, LOOT.eliteXpCount);

    // Put the full charge boundary between four and five kills; a phantom alpha kill would cast at 60.
    zone.beats = [
      [59, { kind: "alpha" }],
      [59, { kind: "elite-wave" }],
    ];
    enemies.rattata.xp = 0.01;
    const quiet = runModel(options);
    const row = quiet.minutes[0];
    const swarmRate = row.useful / fieldAt("forest", 60, 0, false).hp;
    const xpWorth = (row.kills - swarmRate + count * (ELITE.xp - 1)) * enemies.rattata.xp;
    const charge = 59 * ULT_CHARGE.time + xpWorth * ULT_CHARGE.perXp;
    const halfElite = (ELITE.xp * enemies.rattata.xp * ULT_CHARGE.perXp) / 2;
    options.lab.modifiers[1].value = 1 / (charge + halfElite);
    assert.equal(
      runModel(options).minutes[0].useful,
      row.useful,
      "alpha HP does not buy an early ultimate",
    );
    options.lab.modifiers[1].value = 1 / (charge - halfElite);
    assert.ok(
      runModel(options).minutes[0].useful > row.useful,
      "the earned damage credit still fires the ultimate at the correct boundary",
    );
  });
});

test("the continuous model reaches the tower after five maps and carries its evolved build", () => {
  const run = runModel({
    stage: "forest",
    campaign: true,
    starter: "bulbasaur",
    difficulty: 0,
    skill: expert,
    samples: 4,
  });
  assert.equal(run.zoneClears.length, 6);
  assert.deepEqual(
    run.zoneClears.map((c) => c.stage),
    Object.keys(stageDefs),
  );
  assert.ok(run.bossWindow > 0);
  for (const field of run.zoneClears) assert.ok(field.clear > 0, `${field.stage} reachable`);
  assert.ok(run.zoneClears[5].level > run.zoneClears[0].level);
  assert.ok(run.levelAt[55] < run.zoneClears[5].t);
});

test("per-field summon times shorten the continuous route and retain its earned growth", () => {
  const options = {
    stage: "forest",
    campaign: true,
    starter: "bulbasaur",
    difficulty: 0,
    skill: expert,
    samples: 1,
  };
  const fixed = runModel(options);
  const summonSeconds = [GUARDIAN_REFERENCE_SECONDS, 30, 30, 30, 30, 30];
  const early = runModel({ ...options, summonSeconds });
  assert.deepEqual(
    early.zoneClears[0],
    fixed.zoneClears[0],
    "first field has the identical history",
  );
  assert.deepEqual(early.summonSeconds, summonSeconds);
  assert.equal(early.bossWindow, stageDefs.tower.duration - summonSeconds.at(-1));
  assert.ok(early.outcome.clearAt !== null && fixed.outcome.clearAt !== null);
  assert.ok(early.outcome.clearAt < fixed.outcome.clearAt, "early summons skip field waiting");
  assert.ok(
    early.zoneClears.at(-1).level > early.zoneClears[0].level,
    "route rewards still grow the build",
  );
  assert.ok(
    early.zoneClears.at(-1).level < fixed.zoneClears.at(-1).level,
    "skipped farming cannot grant its XP",
  );
  for (const times of [[30], [0, 30, 30, 30, 30, 30], [601, 30, 30, 30, 30, 30]])
    assert.throws(() => runModel({ ...options, summonSeconds: times }), /summonSeconds/);
});

test("an eruption hurts the player without adding enemies", () => {
  // An eruption spanning the 1:00 sample of the volcano's first zone, against the same run without.
  const zone = stageDefs.volcano.zones[0];
  const run = () =>
    runModel({ stage: "volcano", starter: "squirtle", difficulty: 0, skill: average, samples: 4 });
  const calm = run();
  const beats = zone.beats;
  zone.beats = [...beats, [55, { kind: "eruption" }]];
  try {
    const erupting = run();
    assert.ok(erupting.minutes[0].inDps > calm.minutes[0].inDps + 0.1, "bombs land on the kiter");
    assert.ok(
      erupting.beats.every((spike) => spike.beat !== "eruption"),
      "no enemies join",
    );
  } finally {
    zone.beats = beats;
  }
});

test("guardian chests and rounded XP carry real build strength into later zones", () => {
  // Only guardians grant rewards. Zero pickup/chest skill must not discount automatic exit loot.
  const fields = Object.values(stageDefs);
  const zones = fields.map((stage) => stage.zones[0]);
  const saved = zones.map((zone) => ({
    beats: zone.beats,
    hp: enemies[zone.guardian.species].hp,
    xp: enemies[zone.guardian.species].xp,
  }));
  const amount = difficulties[0].amount;
  const rolls = moves["vine-whip"].stats;
  const skill = { ...expert, pickup: 0, chests: 0, picks: { prefer: "move", greedy: 0 } };
  const options = {
    stage: "forest",
    starter: "bulbasaur",
    difficulty: 0,
    skill,
    samples: 1,
    campaign: true,
  };
  try {
    difficulties[0].amount = 0;
    // Every chest upgrade has only its base damage gain, so its count is visible in later DPS.
    moves["vine-whip"].stats = [];
    for (const zone of zones) {
      zone.beats = [];
      Object.assign(enemies[zone.guardian.species], { hp: 1, xp: 0 });
    }
    const chestsOnly = runModel(options);
    const world = createWorld({
      stage: "forest",
      seed: 3,
      difficulty: 0,
      players: [{ starter: "bulbasaur" }],
    });
    const player = world.players[0];
    for (let zone = 0; zone < zones.length; zone++) {
      world.stage = fields[zone].id;
      const boss = spawnEnemy(world, zones[zone].guardian.species, 0, 10);
      killEnemy({ world, grid: new EnemyGrid() }, boss, player);
      collectRemainingPickups(world);
      assert.deepEqual(
        player.pending.map((card) => card.source),
        ["chest"],
      );
      applyCommand(world, { t: "pick", player: 0, card: player.pending[0].id, index: 0 });
      if (zone === zones.length - 1) continue;
      const clear = chestsOnly.zoneClears[zone].t;
      assert.notEqual(clear, null);
      const row = chestsOnly.minutes.find((minute) => minute.t > clear);
      const target = targetFor(fieldAt(fields[zone + 1].id, row.t - clear, 0, false, 0), 0, skill);
      const expected = buildOutput(player, target);
      assert.ok(
        Math.abs(row.single - (expected.single * skill.bossFocus + expected.bossBurn)) < 1e-9,
        `zone ${zone + 2} damage includes exactly one upgrade per prior guardian`,
      );
    }

    // 19 XP becomes 24, 30 and 36 after each zone's scale and six per-drop ceilings.
    // Unrounded rewards miss level 2 in zone 1 and level 4 at the final exit.
    for (const zone of zones) enemies[zone.guardian.species].xp = 19;
    const rewarded = runModel(options);
    const xpWorld = createWorld({
      stage: "forest",
      seed: 3,
      difficulty: 0,
      players: [{ starter: "bulbasaur" }],
    });
    for (let zone = 0; zone < zones.length; zone++) {
      xpWorld.stage = fields[zone].id;
      const boss = spawnEnemy(xpWorld, zones[zone].guardian.species, 0, 10);
      killEnemy({ world: xpWorld, grid: new EnemyGrid() }, boss, xpWorld.players[0]);
      collectRemainingPickups(xpWorld);
      const sim = xpWorld.players[0];
      const modelLevel = rewarded.zoneClears[zone].level;
      assert.equal(modelLevel, sim.level, `same rounded XP at ${fields[zone].id} exit`);
      // Leave selections pending: they cannot add an XP modifier to this rounding reference.
    }
    assert.equal(rewarded.levelAt.length - 1, xpWorld.players[0].level);
    const afterFirst = rewarded.minutes.find((row) => row.t > rewarded.zoneClears[0].t);
    const chestRow = chestsOnly.minutes.find((row) => row.t === afterFirst.t);
    assert.ok(afterFirst.level > chestRow.level);
    assert.ok(
      afterFirst.moves + afterFirst.items > chestRow.moves + chestRow.items ||
        afterFirst.single > chestRow.single ||
        afterFirst.capacity > chestRow.capacity,
      "additional choices change the carried build rather than being discarded",
    );
  } finally {
    difficulties[0].amount = amount;
    moves["vine-whip"].stats = rolls;
    zones.forEach((zone, index) => {
      zone.beats = saved[index].beats;
      Object.assign(enemies[zone.guardian.species], { hp: saved[index].hp, xp: saved[index].xp });
    });
  }
});

test("candy previews match real picks, including partial XP, evolution and all additional cards", () => {
  const skill = { ...expert, picks: { prefer: "move", greedy: 0 } };
  const target = targetFor(fieldAt("forest", 300, 0, false), 40, skill);
  for (const [level, owned] of [
    [1, 0],
    [15, 0],
    [34, 1],
  ]) {
    const world = createWorld({
      stage: "forest",
      seed: 3,
      difficulty: 0,
      players: [{ starter: "charmander" }],
    });
    const player = world.players[0];
    player.level = level;
    player.xpNext = xpForLevel(level);
    player.xp = player.xpNext / 2;
    evolve(player);
    player.hp = playerStats(player).maxHp / 2;
    if (owned) player.items.push({ id: "rare-candy", level: owned });
    player.banished = Object.keys(items)
      .filter((id) => id !== "rare-candy")
      .map((id) => `item:${id}`);
    const choice = { kind: "item", item: "rare-candy" };
    const rng = createRng(17);
    const before = structuredClone(player);
    const preview = previewChoice(player, choice, rng, target, skill);
    assert.deepEqual(player, before, "valuing a candidate leaves the actual build untouched");
    assert.deepEqual(rng, createRng(17), "valuing a candidate leaves actual draws untouched");

    world.rng = { ...rng };
    player.pending = [{ id: world.nextId++, source: "level", options: [choice] }];
    applyCommand(world, { t: "pick", player: 0, card: player.pending[0].id, index: 0 });
    assert.equal(player.level, level + 2);
    assert.equal(player.xp, 0, "candy fills the partial bar, it does not preserve its remainder");
    assert.equal(player.pending.length, 2);
    while (player.pending.length) {
      const front = player.pending[0];
      const preferred = front.options.findIndex((card) => card.kind === skill.picks.prefer);
      next(world.rng); // The model's non-greedy policy decision, separate from the sim's card draws.
      const index = preferred >= 0 ? preferred : Math.floor(next(world.rng) * front.options.length);
      applyCommand(world, { t: "pick", player: 0, card: front.id, index });
    }
    for (const key of ["level", "xp", "xpNext", "stage", "hp", "moves", "items", "training"])
      assert.deepEqual(preview[key], player[key], `level ${level}: ${key}`);
    assert.ok(
      buildOutput(preview, target).single > buildOutput(before, target).single,
      "the projected rewards produce actual extra damage",
    );
  }
});

test("candy's immediate cards affect run growth and its published item value", () => {
  // Controlled exposure, not the shipped drop rate: make candy available at the first item pick.
  const rarities = Object.values(items).map((item) => [item, item.rarity]);
  const candy = items["rare-candy"];
  const levels = candy.onPick.levels;
  const options = {
    stage: "forest",
    starter: "charmander",
    difficulty: 0,
    skill: average,
    picks: { prefer: "item", greedy: 0 },
    samples: 1,
  };
  try {
    for (const [item] of rarities) item.rarity = item === candy ? 0 : 3;
    candy.onPick.levels = 0;
    const passive = runModel(options);
    const passiveValue = itemValues("forest", 0, average).find((row) => row.item === "rare-candy");
    candy.onPick.levels = levels;
    const active = runModel(options);
    const activeValue = itemValues("forest", 0, average).find((row) => row.item === "rare-candy");
    const acquired = active.exposure.get("item:rare-candy");
    assert.equal(acquired.acquired, 1);
    assert.equal(acquired.at, passive.exposure.get("item:rare-candy").at);
    assert.equal(active.levelAt[3], acquired.at);
    assert.equal(active.levelAt[4], acquired.at);
    const after = active.minutes.find((row) => row.t > acquired.at);
    const before = passive.minutes.find((row) => row.t === after.t);
    assert.ok(after.level >= before.level + levels);
    assert.ok(after.items > before.items, "additional cards were actually chosen");
    assert.ok(after.capacity > before.capacity, "those choices improve public clearing output");
    assert.ok(activeValue.value.charmander > passiveValue.value.charmander);
  } finally {
    candy.onPick.levels = levels;
    for (const [item, rarity] of rarities) item.rarity = rarity;
  }
});

test("guardian damage charges the ultimate from the same route- and difficulty-scaled XP in model and sim", () => {
  for (const stage of ["forest", "tower"])
    for (const difficulty of [0, 1, 2]) {
      const world = createWorld({ stage, difficulty, seed: 3, players: [{ starter: "squirtle" }] });
      const player = world.players[0];
      const boss = spawnEnemy(world, stageDefs[stage].zones[0].guardian.species, 0, 5);
      player.ult.room = ULT_CHARGE.room;
      const before = player.ult.charge;
      chargeUltimate(player, boss, boss.maxHp * 0.01);
      const model = ultChargeRate(player, 0, 0.01, boss.xp);
      assert.ok(
        Math.abs(
          player.ult.charge - before - (model - ULT_CHARGE.time * playerStats(player).ultCharge),
        ) < 1e-12,
      );
      assert.equal(
        fieldAt(stage, 0, difficulty, false).xp,
        fieldAt(stage, 0, 0, false).xp * difficulties[difficulty].xp,
      );
    }
});
