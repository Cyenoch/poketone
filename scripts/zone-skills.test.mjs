// Forest, desert and coast skills and guardian catalogue (docs/state-machines/simulation.md): each kind's
// telegraph lands its hit only after the full warning, can be left, and dies with its caster; the
// guardians run their phases in order; the desert's quicksand and burning ground act on who stands
// there; the coast's swimmers stay in the sea.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spyOn } from "bun:test";
import { spawnEnemy, spawnOnRing, updateDirector } from "../src/run/sim/director.ts";
import { updateEnemies } from "../src/run/sim/enemies.ts";
import { updateHazards } from "../src/run/sim/hazards.ts";
import { damageEnemy } from "../src/run/sim/combat.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { apply, has, targetable } from "../src/run/sim/status.ts";
import {
  AURA,
  EGG,
  HEAL_PULSE,
  LANDING,
  BUBBLE,
  VINE,
  BONEMERANG,
  FLAME_TRAIL,
  LUNGE,
  PECK,
  ROCKFALL,
} from "../src/run/sim/content/params/enemy-skills.ts";
import {
  PINSIR,
  NIDOKING,
  FISSURE,
  SHARD,
  BOSS_CHASE_MIN,
  furyOf,
  SANDSLASH,
  MAROWAK,
  AERODACTYL,
  QUICKSAND_PIT,
  KINGLER,
  GYARADOS,
  STARMIE,
  HYDRO_PUMP,
  TWISTER,
} from "../src/run/sim/content/params/guardian.ts";
import { TERRAIN_HALF } from "../src/run/sim/terrain.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { createWorld } from "../src/run/sim/world.ts";
import { buildSurface, sampleSurface } from "../src/run/sim/surface.ts";
import { QUICKSAND } from "../src/run/sim/content/params/environment.ts";
import { EMBERS, HURT_TICKS } from "../src/run/sim/content/params/environment.ts";
import { SWIM_DEPTH } from "../src/run/sim/content/params/environment.ts";
import { STRAFE } from "../src/run/sim/content/params/enemy-motion.ts";
import { enemies as enemyDefs } from "../src/run/sim/content/enemies.ts";
import { skills } from "../src/run/sim/skills/index.ts";
import { bodyFits, createNav } from "../src/run/sim/nav/index.ts";
import { mobilityClasses } from "../src/run/sim/content/mobility.ts";
import { SPAWN_RING } from "../src/run/sim/content/params/pacing.ts";
import * as currentZone from "../src/run/sim/currentZone.ts";
import { forest } from "../src/run/sim/content/stages/forest.ts";
import { desert } from "../src/run/sim/content/stages/desert.ts";
import { coast } from "../src/run/sim/content/stages/coast.ts";

const guardianConfigs = [forest, desert, coast].flatMap((stage) =>
  stage.zones.map(({ guardian }) => ({ stage: stage.id, guardian })),
);
const fixtureGuardians = new WeakMap();
const zoneDef = currentZone.zoneDef;
// Inject only this world's guardian; the campaign table and real combat runners stay intact.
const fixtureZone = spyOn(currentZone, "zoneDef").mockImplementation((world) => {
  const zone = zoneDef(world);
  return fixtureGuardians.has(world) ? { ...zone, guardian: fixtureGuardians.get(world) } : zone;
});
after(() => fixtureZone.mockRestore());

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

/** A flat world, the player at the origin with no moves and an optional explicit guardian. */
function arena(stage = "forest", species) {
  const world = createWorld({
    stage,
    seed: 3,
    difficulty: 0,
    players: [{ starter: "bulbasaur" }],
  });
  world.map.terrain = flatTerrain();
  world.map.obstacles = [];
  world.nav = createNav(world.map.terrain);
  if (species) {
    const config = guardianConfigs.find(({ guardian }) => guardian.species === species);
    assert.equal(config?.stage, stage, `guardian fixture registered: ${stage}/${species}`);
    fixtureGuardians.set(world, config.guardian);
  }
  const player = world.players[0];
  assert.deepEqual([player.x, player.z], [0, 0], "the player starts at the origin");
  player.invulnerable = 0;
  player.moves = [];
  return world;
}

/** An attacker placed exactly, ready to attack, that never dies and barely walks. */
function attacker(world, species, x, z) {
  const enemy = spawnEnemy(world, species, x, z);
  enemy.x = enemy.px = x;
  enemy.z = enemy.pz = z;
  enemy.hp = enemy.maxHp = 1e6;
  enemy.attackTimer = 0;
  enemy.speed = 1e-3;
  return enemy;
}

/** Steps enemies and hazards only; the player takes every hit (no i-frames between them). */
function run(world, seconds, each) {
  const ctx = { world, grid: new EnemyGrid() };
  for (let tick = 0; tick < Math.round(seconds / TICK); tick++) {
    world.tick += 1;
    world.time += TICK;
    world.players[0].invulnerable = 0;
    ctx.grid.rebuild(world.enemies);
    updateEnemies(ctx, TICK);
    updateHazards(world, TICK);
    each?.();
  }
}

const hazardsOf = (world, kind) => world.hazards.filter((h) => h.kind === kind);
const hit = (world, enemy) =>
  damageEnemy({ world, grid: new EnemyGrid() }, enemy, {
    owner: world.players[0],
    move: null,
    type: "normal",
    dmg: 10,
    crit: -1,
  });

test("burrow: untargetable underground, then breaks out of the locked circle once", () => {
  const w = arena();
  const enemy = attacker(w, "diglett", 4, 0);
  const player = w.players[0];
  const hp = player.hp;
  run(w, TICK);
  assert.equal(enemy.phase, "under");
  assert.equal(targetable(enemy), false);
  const circle = hazardsOf(w, "landing")[0];
  assert.deepEqual([circle.x, circle.z], [0, 0], "locked on the target's spot");
  const before = enemy.hp;
  hit(w, enemy);
  assert.equal(enemy.hp, before, "no hit reaches it underground");
  run(w, LANDING.burrow.windup - 2 * TICK);
  assert.equal(player.hp, hp, "full warning first");
  run(w, 3 * TICK);
  assert.ok(player.hp < hp, "breaks out under the player");
  assert.deepEqual([enemy.x, enemy.z], [0, 0]);
  assert.equal(enemy.phase, "recover");
  assert.ok(targetable(enemy));
  // Out of contact reach, still inside the spent circle.
  player.x = 1.2;
  const struck = player.hp;
  run(w, LANDING.burrow.recover - TICK);
  assert.equal(player.hp, struck, "the residue never hits twice");

  const dodge = arena();
  attacker(dodge, "diglett", 4, 0);
  run(dodge, TICK);
  dodge.players[0].x = 3;
  const safe = dodge.players[0].hp;
  run(dodge, LANDING.burrow.windup + 0.2);
  assert.equal(dodge.players[0].hp, safe, "leaving the circle dodges it");
});

test("burrow and leap: sleep or death before the hit cancels it", () => {
  for (const species of ["diglett", "mankey"]) {
    for (const interrupt of ["sleep", "kill"]) {
      const w = arena();
      const enemy = attacker(w, species, 4, 0);
      run(w, 0.2);
      assert.equal(hazardsOf(w, "landing").length, 1, species);
      if (interrupt === "sleep") apply(enemy, "sleep", 3, 0, -1);
      else enemy.hp = 0;
      const hp = w.players[0].hp;
      run(w, 2);
      assert.equal(w.players[0].hp, hp, `${species} ${interrupt}`);
      assert.equal(hazardsOf(w, "landing").length, 0, `${species} ${interrupt}`);
      if (interrupt === "sleep") assert.ok(targetable(enemy), "a sleeper comes back up");
    }
  }
});

test("leap: holds still through the warning, jumps to the circle, hits once", () => {
  const w = arena();
  const enemy = attacker(w, "mankey", 4, 0);
  const player = w.players[0];
  const hp = player.hp;
  run(w, LANDING.leap.windup);
  assert.equal(player.hp, hp);
  assert.ok(Math.abs(enemy.x - 4) < 0.01, "no step during the wind-up");
  // Out of contact reach on landing, still inside the circle.
  player.z = 1.5;
  run(w, LANDING.leap.travel + 3 * TICK);
  assert.ok(player.hp < hp, "the landing hits");
  assert.ok(Math.hypot(enemy.x, enemy.z) < 0.5, "it landed on the locked spot");
  assert.equal(enemy.phase, "recover");
});

test("aura: hurts and poisons inside the ring every tick of its gas, nothing outside or asleep", () => {
  const w = arena();
  const koffing = attacker(w, "koffing", 1, 0);
  const player = w.players[0];
  const hp = player.hp;
  run(w, 1);
  assert.ok(player.hp < hp);
  assert.ok(has(player, "poison"));

  const far = arena();
  attacker(far, "koffing", AURA.reach * 0.5 + 2, 0);
  const safe = far.players[0].hp;
  run(far, 1);
  assert.equal(far.players[0].hp, safe);

  const asleep = arena();
  const sleeper = attacker(asleep, "koffing", 1, 0);
  apply(sleeper, "sleep", 3, 0, -1);
  const rested = asleep.players[0].hp;
  run(asleep, 1);
  assert.equal(asleep.players[0].hp, rested);
  assert.ok(koffing);
});

test("heal pulse: mends other enemies in reach once per pulse, never guardians or itself", () => {
  const w = arena("forest", "pinsir");
  const healer = attacker(w, "clefairy", 10, 10);
  const second = attacker(w, "clefairy", 10.5, 10);
  const near = attacker(w, "rattata", 11, 10);
  const far = attacker(w, "rattata", 10 + HEAL_PULSE.radius + 3, 10);
  const guardian = attacker(w, "pinsir", 9, 10);
  for (const enemy of [healer, second, near, far, guardian]) enemy.hp = enemy.maxHp * 0.5;
  // Both healers pulse on the same tick; the one in both rings is mended once.
  const period = Math.round(6 / TICK);
  w.tick = period - 1;
  run(w, TICK);
  const events = w.events.filter((e) => e.t === "heal-pulse");
  assert.equal(events.length, 2);
  assert.equal(near.hp, near.maxHp * (0.5 + HEAL_PULSE.share));
  assert.equal(far.hp, far.maxHp * 0.5);
  assert.equal(guardian.hp, guardian.maxHp * 0.5);
  assert.equal(healer.hp, healer.maxHp * (0.5 + HEAL_PULSE.share), "the other healer mends it");
});

test("egg bomb: blasts its ring once on landing and leaves no pool", () => {
  const w = arena();
  attacker(w, "exeggcute", 5, 0);
  const player = w.players[0];
  const hp = player.hp;
  run(w, EGG.windup + EGG.flight - 2 * TICK);
  assert.equal(player.hp, hp);
  run(w, 4 * TICK);
  assert.ok(player.hp < hp);
  assert.equal(hazardsOf(w, "acid-pool").length, 0);
  const barrage = arena();
  attacker(barrage, "exeggutor", 5, 0);
  run(barrage, EGG.windup + 2 * TICK);
  assert.equal(hazardsOf(barrage, "egg").length, 3);
});

test("bubble burst fires its volleys a gap apart; the fan fires three lanes", () => {
  const w = arena();
  attacker(w, "poliwhirl", 5, 0);
  run(w, TICK);
  assert.equal(hazardsOf(w, "bubble").length, 1);
  run(w, (BUBBLE.burst - 1) * BUBBLE.gap + TICK);
  assert.equal(hazardsOf(w, "bubble").length, BUBBLE.burst);

  const fan = arena();
  attacker(fan, "nidorina", 5, 0);
  run(fan, TICK);
  assert.equal(hazardsOf(fan, "poison-fan-warn").length, 3);
});

test("vine lash slows the player it catches", () => {
  const w = arena();
  attacker(w, "tangela", 5, 0);
  run(w, VINE.windup + VINE.active);
  assert.ok(has(w.players[0], "slow"));
});

/** Seconds of chase before an attack: a raised guardian's chase clock runs faster (params/guardian.ts). */
const chase = (world) => BOSS_CHASE_MIN / (furyOf(world.stage, world.zone.index)?.chaseRate ?? 1);

/** The guardian's phases, collapsed to the order they change in. */
function phases(world, boss, seconds, track) {
  const seen = [boss.phase];
  run(world, seconds, () => {
    if (seen.at(-1) !== boss.phase) seen.push(boss.phase);
    track?.();
  });
  return seen;
}

function guardian(species) {
  const config = guardianConfigs.find(({ guardian }) => guardian.species === species);
  assert.ok(config, `guardian fixture registered: ${species}`);
  const w = arena(config.stage, species);
  const boss = spawnEnemy(w, species, 6, 0);
  assert.ok(boss.boss, `${species} uses its guardian brain`);
  boss.x = boss.px = 6;
  boss.z = boss.pz = 0;
  boss.speed = 1e-3;
  w.bossId = boss.id;
  // The harness drops i-frames every tick; the player must outlive the guardian's contact.
  w.players[0].hp = w.players[0].maxHp = 1e9;
  return { w, boss };
}

test("Pinsir: chase → windup → jump → recover; below half HP a chain of three with shards", () => {
  const { w, boss } = guardian("pinsir");
  assert.ok(boss.boss);
  const seconds = BOSS_CHASE_MIN + PINSIR.windup + PINSIR.travel + PINSIR.recover + 0.3;
  assert.deepEqual(phases(w, boss, seconds), ["chase", "windup", "dash", "recover", "chase"]);

  const low = guardian("pinsir");
  low.boss.hp = low.boss.maxHp * 0.4;
  let shards = 0;
  const seen = phases(low.w, low.boss, BOSS_CHASE_MIN + 5, () => {
    shards = Math.max(shards, hazardsOf(low.w, "rock-shard").length);
  });
  assert.deepEqual(seen.slice(0, 8), [
    "chase",
    "windup",
    "dash",
    "windup",
    "dash",
    "windup",
    "dash",
    "recover",
  ]);
  assert.ok(shards >= SHARD.count);
});

test("Nidoking: fissure, then Toxic Spikes on the run; below half five lines and a stomp", () => {
  const { w, boss } = guardian("nidoking");
  let lines = 0;
  const first = phases(
    w,
    boss,
    chase(w) + NIDOKING.windup + FISSURE.active + NIDOKING.recover + 0.2,
    () => {
      lines = Math.max(lines, hazardsOf(w, "fissure").length);
    },
  );
  assert.deepEqual(first, ["chase", "windup", "dash", "recover", "chase"]);
  assert.equal(lines, NIDOKING.lines);
  const spikes = phases(w, boss, chase(w) + 0.5);
  assert.deepEqual(spikes, ["chase"], "it keeps walking through Toxic Spikes");
  assert.ok(hazardsOf(w, "acid").length + hazardsOf(w, "acid-pool").length >= NIDOKING.spikes);

  const low = guardian("nidoking");
  low.boss.hp = low.boss.maxHp * 0.4;
  let wide = 0;
  let stomped = false;
  phases(low.w, low.boss, chase(low.w) + 3.5, () => {
    wide = Math.max(wide, hazardsOf(low.w, "fissure").length);
    stomped ||= hazardsOf(low.w, "stomp").length > 0;
  });
  assert.equal(wide, NIDOKING.linesBelow);
  assert.ok(stomped);
});

// ── Desert (docs/state-machines/simulation.md) ─────────────────────────────────────────────────────────

test("pecks: one full warning, then each follow-up re-aims with its own lane", () => {
  const w = arena();
  const doduo = attacker(w, "dodrio", 3, 0);
  // Every peck lands (the harness drops i-frames): the player must outlive them.
  w.players[0].hp = w.players[0].maxHp = 1e9;
  const lanes = new Map();
  const seen = [doduo.phase];
  run(w, LUNGE["triple-peck"].windup + 3 * 0.6 + 1, () => {
    for (const h of hazardsOf(w, "dash-warn")) if (!lanes.has(h.id)) lanes.set(h.id, h.life);
    if (seen.at(-1) !== doduo.phase) seen.push(doduo.phase);
  });
  assert.deepEqual(seen.slice(0, 8), [
    "chase",
    "windup",
    "dash",
    "windup",
    "dash",
    "windup",
    "dash",
    "recover",
  ]);
  const lives = [...lanes.values()];
  assert.equal(lives.length, PECK["triple-peck"].count, "a lane for every peck");
  assert.ok(lives[0] > LUNGE["triple-peck"].windup - TICK, "the first shows for the full wind-up");
  for (const life of lives.slice(1)) assert.ok(life < PECK["triple-peck"].gap + 2 * TICK);
});

test("bonemerang: the bone flies out along its lane and back to the thrower, hurting both ways", () => {
  const w = arena();
  const cubone = attacker(w, "cubone", 4, 0);
  const player = w.players[0];
  // Beside the lane's far end: the bone passes it on the way out and again on the way back.
  player.x = 4 - BONEMERANG.length + 1;
  const hits = [];
  let turned = false;
  run(w, BONEMERANG.windup + (2 * BONEMERANG.length) / BONEMERANG.speed + 0.5, () => {
    const bone = hazardsOf(w, "bone")[0];
    if (bone && bone.length <= 0) turned = true;
    if (w.events.some((e) => e.t === "player-hit")) hits.push(turned ? "back" : "out");
    w.events.length = 0;
  });
  assert.equal(hazardsOf(w, "bone-warn").length, 0);
  assert.ok(hits.includes("out") && hits.includes("back"), hits.join());
  assert.equal(hazardsOf(w, "bone").length, 0, "caught by its thrower");
  assert.ok(cubone.hp > 0);
});

test("rockfall: circles on and around the target fall once after the full warning", () => {
  const w = arena();
  attacker(w, "rhydon", 5, 0);
  const player = w.players[0];
  const hp = player.hp;
  run(w, TICK);
  const circles = hazardsOf(w, "rockfall");
  assert.equal(circles.length, ROCKFALL.spots);
  assert.deepEqual([circles[0].x, circles[0].z], [0, 0]);
  run(w, ROCKFALL.windup - 2 * TICK);
  assert.equal(player.hp, hp, "full warning first");
  run(w, 3 * TICK);
  assert.ok(player.hp < hp);
  const struck = player.hp;
  run(w, ROCKFALL.residue);
  assert.equal(player.hp, struck, "each rock lands once");

  const slept = arena();
  const sleeper = attacker(slept, "rhydon", 5, 0);
  run(slept, 0.3);
  apply(sleeper, "sleep", 3, 0, -1);
  const rested = slept.players[0].hp;
  run(slept, 1);
  assert.equal(slept.players[0].hp, rested, "sleep calls the rocks off");
});

test("flame trail: the charge leaves burning ground that hurts on its cadence, without a burn", () => {
  const w = arena();
  const rapidash = attacker(w, "rapidash", 6, 0);
  const player = w.players[0];
  player.hp = player.maxHp = 1e9;
  run(w, LUNGE["flame-trail"].windup + LUNGE["flame-trail"].time + 0.1);
  const trail = hazardsOf(w, "burning-trail")[0];
  assert.ok(trail, "it burns once the charge is over");
  assert.ok(trail.length > 3, "along the ground it crossed");
  assert.equal(rapidash.phase, "recover");
  player.x = trail.x + trail.dirX * 2;
  player.z = trail.z + trail.dirZ * 2;
  rapidash.hp = 0;
  w.events.length = 0;
  const hp = player.hp;
  let hurtTicks = 0;
  run(w, 1, () => {
    if (w.events.some((e) => e.t === "player-hit")) hurtTicks += 1;
    w.events.length = 0;
  });
  assert.ok(player.hp < hp);
  assert.equal(hurtTicks, Math.round(1 / (HURT_TICKS * TICK)), "every half second");
  assert.equal(player.statuses.length, 0, "no burn status");
  run(w, FLAME_TRAIL.life);
  assert.equal(hazardsOf(w, "burning-trail").length, 0, "it burns out");
});

/** A flat world whose surface (and the nav's) carries `patches`. */
function patched(patches) {
  const w = arena();
  const { origin, resolution, samples } = w.map.terrain;
  const water = {
    origin,
    resolution,
    samples,
    values: new Float32Array(samples * samples).fill(-1),
  };
  const surface = buildSurface(
    w.map.terrain,
    water,
    { ground: "sand", shallowSpeed: 1, liquids: [] },
    patches,
  );
  w.map.terrain.surface = surface;
  w.nav.grid.surface = surface;
  return w;
}

test("quicksand: ground bodies slow and drift to its centre; flyers and the guardian are not dragged", () => {
  const w = patched([{ kind: "quicksand", x: 0, z: 0, radius: 4 }]);
  assert.equal(sampleSurface(w.map.terrain.surface, 1, 1).speed, QUICKSAND.speed);
  const player = w.players[0];
  player.x = -2;
  run(w, 0.5);
  const drift = player.x + 2;
  assert.ok(Math.abs(drift - QUICKSAND.pull * QUICKSAND.speed * 0.5) < 0.05, `drift ${drift}`);

  const enemies = patched([{ kind: "quicksand", x: 0, z: 0, radius: 6 }]);
  enemies.players[0].x = 30;
  const rattata = attacker(enemies, "rattata", -3, 2);
  const zubat = attacker(enemies, "zubat", -3, -2);
  run(enemies, 0.5);
  assert.ok(rattata.z < 1.8 && rattata.x > -2.9, "a walker is dragged in");
  assert.ok(Math.abs(zubat.z + 2) < 0.01, "a flyer is not");
});

test("burning ground hurts a player on it every half second, nobody beside it", () => {
  const w = patched([{ kind: "embers", x: 0, z: 0, radius: 2 }]);
  const player = w.players[0];
  w.events.length = 0;
  const hp = player.hp;
  let hurtTicks = 0;
  run(w, 1, () => {
    if (w.events.some((e) => e.t === "player-hit")) hurtTicks += 1;
    w.events.length = 0;
  });
  assert.equal(hurtTicks, Math.round(1 / (HURT_TICKS * TICK)));
  assert.ok(hp - player.hp <= hurtTicks * EMBERS.dmg + 1e-9);
  assert.equal(player.statuses.length, 0, "no burn status");
  player.x = 3;
  const beside = player.hp;
  run(w, 1);
  assert.equal(player.hp, beside);
});

test("desert maps stamp their patches, and no pad stands on one", () => {
  for (const seed of [1, 2, 3]) {
    const w = createWorld({
      stage: "desert",
      seed,
      difficulty: 0,
      players: [{ starter: "bulbasaur" }],
    });
    const kinds = w.map.terrain.surface.patches.map((patch) => patch.kind).sort();
    assert.deepEqual(kinds, ["embers", "embers", "quicksand", "quicksand"]);
    for (const pad of w.map.pads)
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i === 8 ? 0 : pad.radius;
        const at = sampleSurface(
          w.map.terrain.surface,
          pad.x + Math.cos(a) * r,
          pad.z + Math.sin(a) * r,
        );
        assert.equal(at.patch, null, `seed ${seed} ${pad.tag}`);
      }
  }
});

test("Sandslash: digs (untargetable) and breaks out of the circle, then rolls; below half spikes and a pit", () => {
  const { w, boss } = guardian("sandslash");
  assert.ok(boss.boss);
  let hidden = false;
  const seconds =
    BOSS_CHASE_MIN +
    SANDSLASH.digWindup +
    SANDSLASH.digRecover +
    0.3 +
    BOSS_CHASE_MIN +
    1.2 +
    SANDSLASH.rollWindup +
    SANDSLASH.rollTime +
    SANDSLASH.rollRecover;
  const seen = phases(w, boss, seconds, () => {
    if (boss.phase === "under") hidden ||= !targetable(boss);
    // It broke out on the player's spot; step away so the roll has a lane.
    if (boss.phase === "recover") w.players[0].x = 6;
  });
  assert.deepEqual(seen.slice(0, 7), [
    "chase",
    "under",
    "recover",
    "chase",
    "windup",
    "dash",
    "recover",
  ]);
  assert.ok(hidden);

  const low = guardian("sandslash");
  low.boss.hp = low.boss.maxHp * 0.4;
  let shards = 0;
  let pit = false;
  phases(low.w, low.boss, BOSS_CHASE_MIN + SANDSLASH.digWindup + 0.2, () => {
    shards = Math.max(shards, hazardsOf(low.w, "rock-shard").length);
    pit ||= hazardsOf(low.w, "quicksand-pit").length > 0;
  });
  assert.equal(shards, SANDSLASH.spikes);
  assert.ok(pit);
  // The pit holds the player in a slow and drags them in.
  const p = low.w.players[0];
  const pitHazard = hazardsOf(low.w, "quicksand-pit")[0];
  p.x = pitHazard.x + QUICKSAND_PIT.radius * 0.5;
  p.z = pitHazard.z;
  run(low.w, 0.3);
  assert.ok(has(p, "slow"));
  assert.ok(p.x < pitHazard.x + QUICKSAND_PIT.radius * 0.5);
});

test("Marowak: throws, walks while its bone is out, and clubs up close; below half two bones and a ring", () => {
  const { w, boss } = guardian("marowak");
  let walked = false;
  const seen = phases(w, boss, BOSS_CHASE_MIN + MAROWAK.windup + 2.5, () => {
    if (boss.phase === "dash") walked ||= hazardsOf(w, "bone").length > 0;
  });
  assert.deepEqual(seen.slice(0, 4), ["chase", "windup", "dash", "chase"]);
  assert.ok(walked, "it throws nothing new while its bone is out");

  const low = guardian("marowak");
  low.boss.hp = low.boss.maxHp * 0.4;
  let bones = 0;
  phases(low.w, low.boss, BOSS_CHASE_MIN + MAROWAK.windup + 0.2, () => {
    bones = Math.max(bones, hazardsOf(low.w, "bone").length);
  });
  assert.equal(bones, 2);

  const near = guardian("marowak");
  near.boss.x = near.boss.px = 2;
  near.boss.hp = near.boss.maxHp * 0.4;
  let club = false;
  let ring = 0;
  const close = phases(near.w, near.boss, BOSS_CHASE_MIN + MAROWAK.clubWindup + 0.5, () => {
    club ||= hazardsOf(near.w, "stomp").length > 0;
    ring = Math.max(ring, hazardsOf(near.w, "bone").length);
  });
  assert.deepEqual(close.slice(0, 3), ["chase", "windup", "recover"]);
  assert.ok(club);
  assert.equal(ring, MAROWAK.ringBones);
});

test("Aerodactyl flies: dive band → dive → lands, then Rock Slide on the wing; below half two dives and a slide", () => {
  const { w, boss } = guardian("aerodactyl");
  const first = phases(
    w,
    boss,
    chase(w) + AERODACTYL.windup + AERODACTYL.time + AERODACTYL.recover + 0.2,
  );
  assert.deepEqual(first, ["chase", "windup", "dash", "recover", "chase"]);
  let rocks = 0;
  const slide = phases(w, boss, chase(w) + 0.5, () => {
    rocks = Math.max(rocks, hazardsOf(w, "rockfall").length);
  });
  assert.deepEqual(slide, ["chase"], "it keeps flying through Rock Slide");
  assert.equal(rocks, AERODACTYL.rocks);

  const low = guardian("aerodactyl");
  low.boss.hp = low.boss.maxHp * 0.4;
  let slid = false;
  const chain = phases(low.w, low.boss, chase(low.w) + 4, () => {
    slid ||= hazardsOf(low.w, "rockfall").length > 0;
  });
  assert.deepEqual(chain.slice(0, 6), ["chase", "windup", "dash", "windup", "dash", "recover"]);
  assert.ok(slid);
});

test("strafe: Krabby closes in at a slant, to its own side", () => {
  const w = arena();
  const crabs = [spawnEnemy(w, "krabby", 4, 0), spawnEnemy(w, "krabby", -4, 0)];
  const sides = crabs.map((crab) => {
    const [x0, z0] = [crab.x, crab.z];
    run(w, TICK);
    const moved = Math.atan2(crab.z - z0, crab.x - x0);
    const direct = Math.atan2(-z0, -x0);
    let off = moved - direct;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    assert.ok(Math.abs(Math.abs(off) - STRAFE.angle) < 0.15, `heading ${off}`);
    assert.ok(Math.hypot(crab.x, crab.z) < Math.hypot(x0, z0), "it still closes in");
    return Math.sign(off);
  });
  assert.notEqual(sides[0], sides[1], "neighbouring crabs flank from both sides");
});

test("coast variants: each holds its full warning, then lands", () => {
  for (const [species, distance] of [
    ["kabuto", 3],
    ["golduck", 6],
    ["jolteon", 4],
    ["magneton", 3],
    ["electabuzz", 2],
    ["dragonair", 3],
  ]) {
    const w = arena("coast");
    const player = w.players[0];
    player.hp = player.maxHp = 1e9;
    attacker(w, species, distance, 0);
    const windup = skills[enemyDefs[species].skill.kind].windup;
    let first = null;
    let elapsed = 0;
    run(w, windup + 1, () => {
      elapsed += TICK;
      if (first === null && player.hp < player.maxHp) first = elapsed;
    });
    assert.ok(first !== null, `${species} lands`);
    assert.ok(
      first >= windup - TICK,
      `${species} hit at ${String(first)}, before its ${windup} s warning`,
    );
  }
});

/** The coast's seed-1 field: the player moved to `ashore` metres from the sea along +z (its open water). */
function shore(ashore) {
  const w = createWorld({
    stage: "coast",
    seed: 1,
    difficulty: 0,
    players: [{ starter: "bulbasaur" }],
  });
  const player = w.players[0];
  player.invulnerable = 0;
  player.moves = [];
  player.hp = player.maxHp = 1e9;
  w.enemies = [];
  let edge = 0;
  while (sampleSurface(w.map.terrain.surface, 0, edge).waterDepth < SWIM_DEPTH) edge += 0.25;
  assert.ok(edge < 40, "the coast has open water along +z");
  player.x = player.px = 0;
  player.z = player.pz = edge - ashore;
  return { w, player, edge };
}

test("swimmers: spawn only in the sea, fight from the waterline, and swim off when left behind", () => {
  const { w, player, edge } = shore(0.6);
  for (let i = 0; i < 12; i++) {
    const tentacool = spawnOnRing(w, "tentacool", player, SPAWN_RING.min, SPAWN_RING.max);
    assert.ok(tentacool, "a swimmer finds water around a player at the shore");
    const depth = sampleSurface(w.map.terrain.surface, tentacool.x, tentacool.z).waterDepth;
    // Cells are judged at their centres; a spot inside one may sit a little shallower.
    assert.ok(depth >= SWIM_DEPTH - 0.1, `spawned in ${depth.toFixed(2)} m of water`);
  }
  w.enemies = [];
  // Seaking charges at the player on the beach: the waterline stops it, the charge still lands.
  const seaking = spawnEnemy(w, "seaking", 0, edge + 4);
  seaking.attackTimer = 0;
  let shallowest = Infinity;
  run(w, 4, () => {
    shallowest = Math.min(
      shallowest,
      sampleSurface(w.map.terrain.surface, seaking.x, seaking.z).waterDepth,
    );
  });
  assert.ok(
    shallowest >= SWIM_DEPTH * 0.5,
    `Seaking reached ${shallowest.toFixed(2)} m deep water`,
  );
  assert.ok(player.hp < player.maxHp, "the charge at the shore reaches a player at the waterline");

  // Amphibians cross both; deep water still walls in ground walkers.
  const deep = edge + 10;
  assert.ok(sampleSurface(w.map.terrain.surface, 0, deep).waterDepth > 1);
  assert.ok(bodyFits(w.nav, mobilityClasses.amphibious, 0, deep, 0.5));
  assert.ok(bodyFits(w.nav, mobilityClasses.amphibious, player.x, player.z, 0.5));
  assert.ok(!bodyFits(w.nav, mobilityClasses.ground, 0, deep, 0.5));
  assert.ok(!bodyFits(w.nav, mobilityClasses.swim, player.x, player.z, 0.5));

  // Left behind: the player walks far inland, the swimmer goes once it is off every screen.
  const left = shore(2);
  const jelly = spawnEnemy(left.w, "tentacool", 0, left.edge + 4);
  left.player.z = left.player.pz = left.edge - SPAWN_RING.max - 6;
  updateDirector(left.w, TICK);
  assert.equal(jelly.hp, 0);
});

test("Kingler: Bubble Beam on the move at range, Crabhammer up close; below half two rushes into the hammer", () => {
  const far = guardian("kingler");
  let bubbles = 0;
  const shooting = phases(far.w, far.boss, BOSS_CHASE_MIN + KINGLER.bubbleWindup + 0.3, () => {
    bubbles = Math.max(bubbles, hazardsOf(far.w, "bubble").length);
  });
  assert.deepEqual(shooting.slice(0, 3), ["chase", "windup", "chase"]);
  assert.equal(bubbles, KINGLER.bubbles);

  const near = guardian("kingler");
  near.boss.x = near.boss.px = 2;
  let hammer = null;
  const close = phases(near.w, near.boss, BOSS_CHASE_MIN + KINGLER.hammerWindup + 0.5, () => {
    hammer ??= hazardsOf(near.w, "crabhammer")[0] ?? null;
  });
  assert.deepEqual(close.slice(0, 3), ["chase", "windup", "recover"]);
  assert.ok(
    Math.abs(hammer.x - (2 - KINGLER.hammerOffset)) < 0.05,
    "the circle sits in front of it",
  );
  assert.ok(
    near.w.players[0].hp < near.w.players[0].maxHp,
    "the hammer lands on a player inside it",
  );

  const low = guardian("kingler");
  low.boss.hp = low.boss.maxHp * 0.4;
  const lanes = new Set();
  let struck = false;
  const rush = phases(
    low.w,
    low.boss,
    BOSS_CHASE_MIN + 2 * (KINGLER.sideWindup + KINGLER.sideTime) + KINGLER.hammerWindup + 0.2,
    () => {
      for (const h of hazardsOf(low.w, "dash-warn")) lanes.add(h.id);
      struck ||= hazardsOf(low.w, "crabhammer").length > 0;
    },
  );
  assert.deepEqual(rush.slice(0, 7), [
    "chase",
    "windup",
    "dash",
    "windup",
    "dash",
    "windup",
    "recover",
  ]);
  assert.equal(lanes.size, KINGLER.sideDashes);
  assert.ok(struck);
});

test("Gyarados: Hydro Pump band → beam → recover, then twisters on the run; below half three pumps", () => {
  const { w, boss } = guardian("gyarados");
  const player = w.players[0];
  let pumped = false;
  const first = phases(
    w,
    boss,
    chase(w) + GYARADOS.windup + HYDRO_PUMP.active + GYARADOS.recover + 0.2,
    () => {
      pumped ||= hazardsOf(w, "hydro-pump").length > 0;
    },
  );
  assert.deepEqual(first, ["chase", "windup", "dash", "recover", "chase"]);
  assert.ok(pumped && player.hp < player.maxHp, "the beam hits a player in its band");

  const hp = player.hp;
  let twisters = 0;
  const second = phases(w, boss, chase(w) + 0.5, () => {
    twisters = Math.max(twisters, hazardsOf(w, "twister").length);
  });
  assert.deepEqual(second, ["chase"], "it keeps chasing while the twisters rise");
  assert.equal(twisters, GYARADOS.twisters);
  // They glide in and break on the player they reach.
  const risen = hazardsOf(w, "twister");
  run(w, TWISTER.life);
  assert.ok(player.hp < hp);
  assert.ok(risen.every((t) => t.dmg === 0 || t.life <= 0));

  const low = guardian("gyarados");
  low.boss.hp = low.boss.maxHp * 0.4;
  const pumps = new Set();
  const chain = phases(
    low.w,
    low.boss,
    chase(low.w) + GYARADOS.windup + 3 * HYDRO_PUMP.active + 2 * GYARADOS.chainWindup + 0.3,
    () => {
      for (const h of hazardsOf(low.w, "hydro-pump")) pumps.add(h.id);
    },
  );
  assert.deepEqual(chain.slice(0, 8), [
    "chase",
    "windup",
    "dash",
    "windup",
    "dash",
    "windup",
    "dash",
    "recover",
  ]);
  assert.equal(pumps.size, GYARADOS.chain);
});

test("Starmie: a zigzag spin then dizzy; Thunderbolt circles fall on the player while it moves; below half more of both", () => {
  const { w, boss } = guardian("starmie");
  const lanes = new Set();
  const spin = phases(
    w,
    boss,
    chase(w) +
      STARMIE.spinWindup +
      (STARMIE.segments * STARMIE.segment) / STARMIE.spinSpeed +
      STARMIE.spinRecover +
      0.2,
    () => {
      for (const h of hazardsOf(w, "dash-warn")) lanes.add(h.id);
    },
  );
  assert.deepEqual(spin, ["chase", "windup", "dash", "recover", "chase"]);
  assert.equal(lanes.size, STARMIE.segments);

  const bolts = new Set();
  const volley = phases(w, boss, chase(w) + STARMIE.bolts * STARMIE.boltGap + 0.3, () => {
    for (const h of hazardsOf(w, "thunder-bolt")) bolts.add(h.id);
  });
  assert.deepEqual(volley.slice(0, 3), ["chase", "dash", "chase"]);
  assert.equal(bolts.size, STARMIE.bolts);

  const low = guardian("starmie");
  low.boss.hp = low.boss.maxHp * 0.4;
  const lowLanes = new Set();
  phases(low.w, low.boss, chase(low.w) + STARMIE.spinWindup / 2, () => {
    for (const h of hazardsOf(low.w, "dash-warn")) lowLanes.add(h.id);
  });
  assert.equal(lowLanes.size, STARMIE.lowSegments);
});
