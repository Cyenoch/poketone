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
import { statuses } from "../src/run/sim/content/statuses.ts";
import { typeNames, typeMultiplier } from "../src/run/sim/content/elements.ts";
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
import { partnerSlots } from "../src/run/sim/partners.ts";
import { ULT_CHARGE, ULT_WINDUP } from "../src/run/sim/content/params/ultimates.ts";
import { ultChargeRate, ultCast, ultimateTiming } from "../src/run/balance/ultimate.ts";
import { chargeUltimate } from "../src/run/sim/ultimates/index.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { scheduleField } from "../src/run/sim/field-events.ts";
import { SITE } from "../src/run/sim/content/params/sites.ts";
import { SHINY } from "../src/run/sim/content/params/field-events.ts";
import { weatherDefs } from "../src/run/sim/content/weather.ts";
import {
  FIELD_MODEL_ASSUMPTIONS,
  modelFieldSchedule,
  newModelFieldEvents,
  stepModelSites,
} from "../src/run/balance/field-events.ts";
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
import { pickEffects } from "../src/run/sim/progression.ts";
import {
  applyCommand,
  collectRemainingPickups,
  createPlayer,
  createWorld,
} from "../src/run/sim/world.ts";

const SECONDS = 60;

test("model schedules use the real seeded scheduler and retain used events across fields", () => {
  const world = createWorld({
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: [{ starter: "charmander" }],
  });
  const rng = createRng(483);
  const used = [];
  world.rng = createRng(483);
  world.eventsUsed = [];
  for (const stage of Object.keys(stageDefs)) {
    world.stage = stage;
    const actual = modelFieldSchedule(stage, 0, rng, used);
    scheduleField(world);
    assert.deepEqual(actual, world.zone.schedule);
    assert.equal(rng.state, world.rng.state, "no midpoint schedule or extra scheduling draw");
  }
  assert.equal(new Set(used).size, used.length);
  const a = modelFieldSchedule("forest", 0, createRng(1), []);
  const b = modelFieldSchedule("forest", 0, createRng(2), []);
  assert.notDeepEqual(a, b, "different seeds draw real times inside the windows");
});

test("weather affects move derivation and enemy streams once, without changing neutral contact", () => {
  const player = createPlayer(0, "charmander", 0);
  const target = targetFor(fieldAt("forest", 300, 0, false), 30, average);
  const dry = moveOutput(newMoveState("ember"), playerStats(player), target);
  const sunny = moveOutput(newMoveState("ember"), playerStats(player), {
    ...target,
    weather: "sun",
  });
  assert.ok(Math.abs(sunny.single / dry.single - weatherDefs.sun.element.fire) < 1e-12);
  const beam = (weather) =>
    moveOutput(newMoveState("solar-beam"), playerStats(player), { ...target, weather });
  assert.ok(beam("sun").single > beam(null).single, "shared cooldown tweak increases beam output");
  const thunder = (weather) =>
    moveOutput(newMoveState("thunder"), playerStats(player), { ...target, weather });
  assert.ok(
    thunder("rain").useful > thunder(null).useful,
    "shared count tweak reaches more crowd targets",
  );
  assert.equal(
    thunder("rain").single,
    thunder(null).single,
    "distinct-target strikes do not duplicate a lone guardian",
  );
  const calm = bossHits("gyarados", 0, 1, 1, 0, false, 0.4);
  const rain = bossHits("gyarados", 0, 1, 1, 0, false, 0.4, undefined, null, Infinity, "rain");
  assert.ok(calm.some((stream) => stream.element === "water"));
  for (let i = 0; i < calm.length; i++) {
    const multiplier = weatherDefs.rain.element[calm[i].element] ?? 1;
    assert.ok(Math.abs(rain[i].dmg / calm[i].dmg - multiplier) < 1e-12);
    assert.equal(rain[i].rate, calm[i].rate);
  }
});

test("event encounters use ordinary encounter stats, pay one floor-bearing box, and timeouts pay nothing", () => {
  const skill = { ...expert };
  const run = (kind, species, dps = 1000) => {
    const rng = createRng(8);
    const state = newModelFieldEvents("forest", 0, rng, [], skill);
    state.sites.forEach((site) => {
      site.reachable = false;
    });
    const site = {
      kind,
      species,
      ready: true,
      reachable: true,
      at: 0,
      phase: "wait",
      left: 0,
      progress: 0,
      attempts: 0,
      encounter: null,
    };
    state.active = site;
    state.scope = true;
    const context = {
      time: 0,
      seconds: 1,
      rng,
      skill,
      hpScale: 1,
      xpScale: 1,
      dmgScale: 1,
      speed: 4,
      hitRate: 0,
      protected: false,
      weather: null,
      outbreak: null,
      berryMultiplier: 1,
      focusedDps: () => dps,
    };
    const player = { egg: null, x: 0, z: 0 };
    stepModelSites(state, context, player);
    site.encounter.retreatAt = Infinity;
    const reward = stepModelSites(
      state,
      {
        ...context,
        time: kind === "raid-den" && dps === 0 ? site.encounter.until : 1,
      },
      player,
    );
    assert.equal(
      stepModelSites(state, { ...context, time: 100 }, player).xp,
      0,
      "settled encounter cannot pay twice",
    );
    return reward;
  };
  const honey = run("honey-tree", "pinsir");
  assert.equal(
    honey.killed,
    1,
    "ordinary encounter durability is killable here; old guardian HP would not be",
  );
  assert.equal(honey.chests.length, 1);
  const fossil = run("fossil", "aerodactyl");
  assert.deepEqual(fossil.chests, [1], "the fossil grants one rare chest");
  const snorlax = run("snorlax", "snorlax", 10000);
  assert.equal(snorlax.chests.length, 0);
  assert.deepEqual(snorlax.items, ["leftovers"]);
  const timeout = run("raid-den", "rattata", 0);
  assert.equal(timeout.xp + timeout.stardust + timeout.chests.length, 0);
  assert.equal(timeout.unfinished, 1);
});

test("site items enter the progressing build and a zero-touch strategy earns no site rewards", () => {
  const zone = stageDefs.forest.zones[0];
  const saved = {
    sites: zone.sites,
    events: zone.events,
    beats: zone.beats,
    dormant: SITE.dormantChance,
    reach: FIELD_MODEL_ASSUMPTIONS.reach.expert,
    from: FIELD_MODEL_ASSUMPTIONS.visitFrom,
    margin: FIELD_MODEL_ASSUMPTIONS.leaveMargin,
    travel: FIELD_MODEL_ASSUMPTIONS.travelSeconds,
    shiny: SHINY.chance,
  };
  const options = {
    stage: "forest",
    starter: "bulbasaur",
    difficulty: 0,
    skill: expert,
    samples: 1,
  };
  try {
    zone.sites = ["glint", "spring", "item-ball", "egg"];
    zone.events = { windows: [], pool: [] };
    zone.beats = [];
    SITE.dormantChance = 0;
    SHINY.chance = 0;
    FIELD_MODEL_ASSUMPTIONS.reach.expert = 1;
    FIELD_MODEL_ASSUMPTIONS.visitFrom = 1;
    FIELD_MODEL_ASSUMPTIONS.leaveMargin = 1e4;
    FIELD_MODEL_ASSUMPTIONS.travelSeconds = 0;
    const before = runModel({ ...options, fieldEvents: false });
    const touched = runModel(options);
    assert.ok(touched.fieldEvents[0].income.items > 0);
    assert.ok(
      touched.minutes[0].items > before.minutes[0].items,
      "items are present during minute one, not added after the run",
    );
    FIELD_MODEL_ASSUMPTIONS.reach.expert = 0;
    const missed = runModel(options);
    assert.equal(missed.fieldEvents[0].income.occupiedSeconds, 0);
    assert.equal(missed.fieldEvents[0].income.items, 0);
    assert.deepEqual(
      missed.minutes,
      before.minutes,
      "unreached sites do not secretly grant build strength",
    );
  } finally {
    zone.sites = saved.sites;
    zone.events = saved.events;
    zone.beats = saved.beats;
    SITE.dormantChance = saved.dormant;
    SHINY.chance = saved.shiny;
    FIELD_MODEL_ASSUMPTIONS.reach.expert = saved.reach;
    FIELD_MODEL_ASSUMPTIONS.visitFrom = saved.from;
    FIELD_MODEL_ASSUMPTIONS.leaveMargin = saved.margin;
    FIELD_MODEL_ASSUMPTIONS.travelSeconds = saved.travel;
  }
});

test("outbreak replacement XP is consumed before later choices without an extra crowd beat", () => {
  const zone = stageDefs.forest.zones[0];
  const saved = {
    roster: zone.roster,
    beats: zone.beats,
    events: zone.events,
    reach: FIELD_MODEL_ASSUMPTIONS.reach.expert,
    shiny: SHINY.chance,
    xp: enemies.rattata.xp,
  };
  try {
    zone.roster = [[0, "rattata"]];
    zone.beats = [];
    zone.events = { windows: [[5, 5]], pool: ["outbreak"] };
    FIELD_MODEL_ASSUMPTIONS.reach.expert = 0;
    SHINY.chance = 0;
    enemies.rattata.xp = 3;
    const options = {
      stage: "forest",
      starter: "bulbasaur",
      difficulty: 0,
      skill: expert,
      samples: 1,
    };
    const before = runModel({ ...options, fieldEvents: false });
    const after = runModel(options);
    assert.ok(after.fieldEvents[0].income.xp > 0);
    assert.ok(
      after.levelAt[3] < before.levelAt[3],
      "outbreak XP changes upgrade timing while progressing",
    );
    assert.equal(
      after.beats.length,
      0,
      "outbreak changes weights/rewards, never adds a crowd batch",
    );
  } finally {
    zone.roster = saved.roster;
    zone.beats = saved.beats;
    zone.events = saved.events;
    FIELD_MODEL_ASSUMPTIONS.reach.expert = saved.reach;
    SHINY.chance = saved.shiny;
    enemies.rattata.xp = saved.xp;
  }
});

function withModelEgg(check) {
  const fields = Object.values(stageDefs);
  const saved = fields.map((stage) => ({
    duration: stage.duration,
    zone: { ...stage.zones[0] },
    guardian: { ...enemies[stage.zones[0].guardian.species] },
  }));
  const assumptions = { ...FIELD_MODEL_ASSUMPTIONS };
  const reach = FIELD_MODEL_ASSUMPTIONS.reach.expert;
  const siteParams = { ...SITE };
  const amount = difficulties[0].amount;
  const shiny = SHINY.chance;
  try {
    difficulties[0].amount = 0;
    SHINY.chance = 0;
    SITE.count = 1;
    SITE.dormantChance = 0;
    FIELD_MODEL_ASSUMPTIONS.reach.expert = 1;
    FIELD_MODEL_ASSUMPTIONS.visitFrom = 1;
    FIELD_MODEL_ASSUMPTIONS.leaveMargin = 1e4;
    FIELD_MODEL_ASSUMPTIONS.travelSeconds = 0;
    for (const stage of fields) {
      stage.duration = 180;
      const zone = stage.zones[0];
      zone.sites = stage.id === "forest" ? ["egg"] : ["spring"];
      zone.events = { windows: [], pool: [] };
      zone.beats = [];
      zone.roster = [[0, stage.id === "forest" ? "rattata" : "zubat"]];
      Object.assign(enemies[zone.guardian.species], { hp: 1e12, dmg: 0, xp: 0 });
    }
    check({
      stage: "forest",
      starter: "squirtle",
      difficulty: 0,
      skill: { ...expert, chests: 0.9 },
      samples: 1,
    });
  } finally {
    fields.forEach((stage, index) => {
      stage.duration = saved[index].duration;
      Object.assign(stage.zones[0], saved[index].zone);
      Object.assign(enemies[stage.zones[0].guardian.species], saved[index].guardian);
    });
    Object.assign(FIELD_MODEL_ASSUMPTIONS, assumptions);
    FIELD_MODEL_ASSUMPTIONS.reach.expert = reach;
    Object.assign(SITE, siteParams);
    difficulties[0].amount = amount;
    SHINY.chance = shiny;
  }
}

test("runModel always grants a full-party hatch card regardless of chest pickup skill", () => {
  withModelEgg((options) => {
    SITE.eggDistance = 1;
    const lab = {
      rules: { partners: -partnerSlots(createPlayer(0, "squirtle", 0)) },
      modifiers: [],
    };
    for (const chests of [0, 0.9]) {
      for (let seed = 1; seed <= 64; seed++) {
        const run = runModel({ ...options, lab, seed, skill: { ...options.skill, chests } });
        assert.equal(run.fieldEvents[0].earned.cards, 1, `seed ${seed}, chest pickup ${chests}`);
        assert.equal(run.fieldEvents[0].income.cards, 1);
        assert.equal(run.fieldEvents[0].income.partners, 0);
      }
    }
  });
});

test("runModel keeps walking a carried egg after exhausting the exploration budget", () => {
  withModelEgg((options) => {
    FIELD_MODEL_ASSUMPTIONS.explorationSeconds = 1;
    const run = runModel(options);
    assert.equal(run.fieldEvents[0].income.occupiedSeconds, 1);
    assert.equal(run.fieldEvents[0].income.unfinished, 0);
    assert.equal(run.fieldEvents[0].income.partners, 1);
    assert.equal(
      run.minutes[0].partners,
      1,
      "the carried egg hatches during later ordinary walking",
    );
    SITE.eggDistance = 1e6;
    assert.equal(
      runModel(options).minutes[0].partners,
      0,
      "pickup alone does not grant the partner",
    );
  });
});

test("runModel carries egg distance and species into the next map without replacing it", () => {
  withModelEgg((options) => {
    const forest = stageDefs.forest.zones[0];
    const desert = stageDefs.desert.zones[0];
    enemies[forest.guardian.species].hp = 1;
    // A second egg is available immediately, but must not replace the one from the forest.
    desert.sites = ["egg"];
    const speed = playerStats(createPlayer(0, "squirtle", 0)).speed;
    SITE.eggDistance = speed * FIELD_MODEL_ASSUMPTIONS.movingShare * 50;
    const route = { ...options, campaign: true, summonSeconds: [20, 180, 180, 180, 180, 180] };
    const run = runModel(route);
    assert.equal(run.zoneClears[0].t, 20);
    assert.equal(run.fieldEvents[0].income.partners, 0, "the egg has not hatched at the exit");
    assert.equal(
      run.fieldEvents[0].income.unfinished,
      0,
      "carrying across an exit is not abandonment",
    );
    assert.equal(
      run.minutes[0].partners,
      1,
      "the first 19 seconds of walking survive the transition",
    );
    assert.ok(
      Math.abs(run.fieldEvents[1].income.partners - 2) < 1e-6,
      "both eggs hatch in the desert, weighted by the surviving share",
    );
    // At minute one only the forest egg has hatched, exposing lost or replaced species.
    const damage = enemies.rattata.dmg;
    const zubat = { ...enemies.zubat };
    try {
      difficulties[0].amount = 0.1;
      Object.assign(enemies.zubat, { hp: 1e12, dmg: 0, xp: 0 });
      enemies.rattata.dmg = 0;
      const harmless = runModel({ ...route, skill: { ...route.skill, contact: 0 } });
      enemies.rattata.dmg = 100;
      const armed = runModel({ ...route, skill: { ...route.skill, contact: 0 } });
      assert.ok(
        armed.minutes[0].partnerDps > harmless.minutes[0].partnerDps,
        "the hatched partner retains the forest species rather than the new map's species",
      );
    } finally {
      enemies.rattata.dmg = damage;
      Object.assign(enemies.zubat, zubat);
    }
  });
});

test("ultimate preparation delays the original pulses instead of paying their damage at trigger", () => {
  const player = createPlayer(0, "charmander", 0);
  const target = targetFor(fieldAt("forest", 300, 0, false), 30, average);
  const timing = ultimateTiming();
  const preparing = ultCast(player, target, { from: 0, to: timing.windup });
  assert.equal(preparing.useful + preparing.single + preparing.heal, 0);
  const immediate = ultCast(player, target, { from: 0, to: 1 }, { ...timing, windup: 0 });
  const released = ultCast(player, target, { from: timing.windup, to: timing.windup + 1 });
  assert.ok(immediate.useful > 0);
  assert.equal(
    released.useful,
    immediate.useful,
    "preparation shifts the pulse; it does not rescale it",
  );
  const whole = ultCast(player, target);
  let total = 0;
  for (let at = 0; at <= whole.duration; at++)
    total += ultCast(player, target, { from: at, to: at + 1 }).useful;
  assert.ok(Math.abs(total - whole.useful) < 1e-9, "the original pulse sequence pays once");
});

test("item previews preserve the seeded immediate effect of a newly granted Loaded Dice", () => {
  const world = createWorld({
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: [{ starter: "charmander" }],
  });
  world.rng = createRng(391);
  const player = world.players[0];
  const choice = { kind: "item", item: "loaded-dice" };
  const target = targetFor(fieldAt("forest", 60, 0, false), 10, average);
  const state = world.rng.state;
  const preview = previewChoice(player, choice, world.rng, target, average);
  assert.equal(world.rng.state, state, "a preview does not consume the committed reward stream");
  applyChoice(player, choice);
  pickEffects(world, player, choice.item);
  assert.deepEqual(preview.fx, player.fx, "the preview and actual grant keep the same rolled face");
  assert.deepEqual(playerStats(preview), playerStats(player));
});

test("poison contributes persistent damage but extra applications refresh instead of stacking", () => {
  const player = createPlayer(0, "gastly", 0);
  player.moves = [newMoveState("sludge-bomb")];
  const target = targetFor(fieldAt("forest", 300, 0, false), 20, average);
  const one = buildOutput(player, target);
  assert.ok(one.useful > one.direct, "surviving poisoned enemies lose HP between hits");
  assert.ok(one.bossBurn > 0, "poison continues against a guardian");
  const max = statuses.poison.dotShare * playerStats(player).statusDamage * one.bossPoisonHit;
  player.moves[0].mods.cd = 0.5;
  const two = buildOutput(player, target);
  assert.ok(two.bossBurn > one.bossBurn, "more applications raise occupancy");
  assert.ok(two.bossBurn < max, "same-strength poison cannot exceed one full-uptime DoT");
  assert.ok(two.bossBurn < one.bossBurn * 2, "refreshing is not two independent poison stacks");
});

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

test("campaign pre-summon windows exclude the second when guardian combat begins", () => {
  const options = {
    stage: "forest",
    starter: "bulbasaur",
    difficulty: 0,
    skill: expert,
    samples: 1,
    campaign: true,
  };
  const immediate = runModel({ ...options, summonSeconds: Array(6).fill(1) });
  assert.ok(immediate.entryWindows.length > 0);
  assert.equal(immediate.entryWindows[0].preSummon, null, "no pre-combat second was observed");
  const delayed = runModel({ ...options, summonSeconds: Array(6).fill(10) });
  const before = delayed.entryWindows[0].preSummon;
  assert.ok(before);
  assert.equal(before.seconds, 9);
  assert.equal(before.guardianRaw, 0, "the swarm baseline excludes guardian damage");
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
    Object.keys(typeNames).map((t) => [t, typeMultiplier(t, enemies.rattata.types)]),
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
  const short = ["strike", "cone", "spin", "nova", "combo"].includes(moves[move].archetype);
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
    ["karate-chop", 1],
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

test("modelled swarm stats match spawned enemies through entry ramp, growth and rampage", () => {
  for (const stage of Object.values(stageDefs)) {
    const world = createWorld({
      stage: stage.id,
      seed: 3,
      difficulty: 0,
      players: [{ starter: "squirtle" }],
    });
    world.spawn.shinySpawned = true; // This fixture compares ordinary spawn stats, not shiny encounters.
    for (const [index, zone] of stage.zones.entries()) {
      const roster = zone.roster;
      // A single species isolates spawn HP from the model's hardening/healer estimates.
      zone.roster = [[0, "rattata"]];
      try {
        world.zone.index = index;
        for (const difficulty of [0, 1, 2]) {
          world.difficulty = difficulty;
          for (const time of [0, 1, 4, 8, 20, 60, 120, 480, stage.duration + 60]) {
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
    fieldEvents: false,
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
      { window: [57, 57], beat: { kind: "alpha" } },
      { window: [58, 58], beat: { kind: "elite-wave" } },
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
      { window: [30, 30], beat: { kind: "alpha" } },
      { window: [45, 45], beat: { kind: "elite-wave" } },
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
      { window: [60, 60], beat: { kind: "alpha" } },
      { window: [60, 60], beat: { kind: "elite-wave" } },
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
      { window: [180, 180], beat: { kind: "alpha" } },
      { window: [180, 180], beat: { kind: "elite-wave" } },
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
      { window: [59, 59], beat: { kind: "alpha" } },
      { window: [59, 59], beat: { kind: "elite-wave" } },
    ];
    enemies.rattata.xp = 0.01;
    const quiet = runModel(options);
    const row = quiet.minutes[0];
    const swarmRate = row.useful / fieldAt("forest", 60, 0, false).hp;
    const xpWorth = (row.kills - swarmRate + count * (ELITE.xp - 1)) * enemies.rattata.xp;
    const charge = 59 * ULT_CHARGE.time + xpWorth * ULT_CHARGE.perXp;
    const halfElite = (ELITE.xp * enemies.rattata.xp * ULT_CHARGE.perXp) / 2;
    options.lab.modifiers[1].value = 1 / (charge + halfElite);
    const below = runModel(options);
    assert.ok(
      below.ultimate.firstCast === null || below.ultimate.firstCast > 60,
      "alpha HP does not buy an early ultimate",
    );
    options.lab.modifiers[1].value = 1 / (charge - halfElite);
    const accepted = runModel(options);
    assert.equal(
      accepted.ultimate.firstCast,
      60,
      "earned credit accepts the trigger at the boundary",
    );
    assert.equal(
      accepted.minutes[0].useful,
      row.useful,
      "preparation grants no premature pulse damage",
    );
    assert.equal(
      accepted.ultimate.firstRelease,
      60 + ULT_WINDUP,
      "release follows the shared preparation interval",
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
  zone.beats = [...beats, { window: [55, 55], beat: { kind: "eruption" } }];
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
    fieldEvents: false,
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
