import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spyOn } from "bun:test";
import { createWorld } from "../src/run/sim/world.ts";
import { addCircleBlocker, createNav } from "../src/run/sim/nav/index.ts";
import { TERRAIN_HALF } from "../src/run/sim/terrain.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { spawnEnemy, updateDirector } from "../src/run/sim/director.ts";
import { updateEnemies } from "../src/run/sim/enemies.ts";
import { updateHazards } from "../src/run/sim/hazards.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { skills } from "../src/run/sim/skills/index.ts";
import { has, apply, targetable } from "../src/run/sim/status.ts";
import { addHazard } from "../src/run/sim/skills/kit.ts";
import { guardianBrains } from "../src/run/sim/bosses/index.ts";
import {
  boxHalf,
  orbitAngle,
  sweepHeading,
  warningCount,
} from "../src/run/sim/bosses/zone-hazards.ts";
import { settleEnemySurface } from "../src/run/sim/surface-effects.ts";
import { buildSurface } from "../src/run/sim/surface.ts";
import { onIce } from "../src/run/sim/skills/trail.ts";
import { movePlayer } from "../src/run/sim/player-movement.ts";
import { fireBeat } from "../src/run/sim/beats.ts";
import { throwBone } from "../src/run/sim/skills/boomerang.ts";
import { damageEnemy } from "../src/run/sim/combat.ts";
import { ZONE_GUARDIAN } from "../src/run/sim/content/params/late-zones.ts";
import { furyStep } from "../src/run/sim/bosses/fury.ts";
import { playerStats } from "../src/run/sim/stats.ts";
import { interactAtLandmark } from "../src/run/sim/zones.ts";
import * as currentZone from "../src/run/sim/currentZone.ts";
import { forest } from "../src/run/sim/content/stages/forest.ts";
import { desert } from "../src/run/sim/content/stages/desert.ts";
import { tower } from "../src/run/sim/content/stages/tower.ts";
import { glacier } from "../src/run/sim/content/stages/glacier.ts";
import { volcano } from "../src/run/sim/content/stages/volcano.ts";

const guardianConfigs = [forest, desert, tower, glacier, volcano].flatMap((stage) =>
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

function arena(stage = "tower", species) {
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
  if (species) {
    const config = guardianConfigs.find(({ guardian }) => guardian.species === species);
    assert.equal(config?.stage, stage, `guardian fixture registered: ${stage}/${species}`);
    fixtureGuardians.set(world, config.guardian);
  }
  const p = world.players[0];
  p.x = p.px = 0;
  p.z = p.pz = 0;
  p.moves = [];
  p.hp = 1e6;
  p.invulnerable = 0;
  return world;
}
function enemy(w, id, x = 5, z = 0) {
  const e = spawnEnemy(w, id, x, z);
  e.speed = 0.001;
  e.attackTimer = 0;
  e.hp = e.maxHp = 1e6;
  return e;
}

test("sleep cancels delayed fury circles before they become visible and waking cannot restore them", () => {
  const w = arena("glacier", "lapras"),
    e = boss(w, 0, true),
    p = w.players[0];
  e.phase = "chase";
  e.fury = { timer: 0, casts: 2 };
  furyStep(w, e, p, TICK);
  const delayed = w.hazards.filter((h) => h.delay > 0);
  assert.equal(delayed.length, 2, "pincer's side circles start delayed");
  apply(e, "sleep", 0.2, 0, -1);
  updateHazards(w, TICK);
  assert.equal(w.hazards.length, 0, "sleep cancels the whole committed cast during its delay");
  e.statuses = [];
  p.x = delayed[0].x;
  p.z = delayed[0].z;
  const hp = p.hp;
  for (let i = 0; i < 90; i++) updateHazards(w, TICK);
  assert.equal(p.hp, hp, "waking does not revive cancelled damage");
});

test("a full-size Blastoise can walk out of overlapping fury and Lapras attacks on nightmare", () => {
  for (const cast of [0, 1, 2]) {
    let escapes = 0;
    for (let direction = 0; direction < 16; direction++) {
      const w = arena("glacier", "lapras"),
        p = w.players[0];
      w.difficulty = 2;
      const e = spawnEnemy(w, "lapras", 8, 0);
      e.attackTimer = 2;
      e.hp = e.maxHp * 0.4;
      Object.assign(p, {
        starter: "squirtle",
        stage: 2,
        inputX: Math.cos((direction * Math.PI) / 8),
        inputZ: Math.sin((direction * Math.PI) / 8),
      });
      e.phase = "chase";
      e.phaseTime = 2; // A native attack becomes due during the extra cast's warning.
      e.fury = { timer: 0, casts: cast };
      furyStep(w, e, p, TICK);
      const hp = p.hp;
      const ctx = { world: w, grid: new EnemyGrid() };
      const speed = playerStats(p).speed;
      for (let tick = 0; tick < 90; tick++) {
        w.tick++;
        w.time += TICK;
        p.invulnerable = Math.max(0, p.invulnerable - TICK);
        movePlayer(w, p, speed, TICK);
        ctx.grid.rebuild(w.enemies);
        updateEnemies(ctx, TICK);
        updateHazards(w, TICK);
      }
      if (p.hp === hp) escapes++;
    }
    assert.ok(
      escapes > 0,
      `cast ${cast}: at least one ordinary walking escape, without dash or invulnerability`,
    );
  }
});
function boss(w, turn = 0, low = false) {
  const e = enemy(w, currentZone.zoneDef(w).guardian.species, 8);
  assert.ok(e.boss, `${e.species} uses its guardian brain`);
  w.bossId = e.id;
  e.attackTimer = turn;
  e.phaseTime = 10;
  if (low) e.hp = e.maxHp * 0.4;
  return e;
}
function run(w, seconds, each) {
  const ctx = { world: w, grid: new EnemyGrid() };
  for (let i = 0; i < Math.round(seconds / TICK); i++) {
    w.tick++;
    w.time += TICK;
    for (const p of w.players) p.invulnerable = 0;
    ctx.grid.rebuild(w.enemies);
    updateEnemies(ctx, TICK);
    updateHazards(w, TICK);
    each?.();
  }
}
const marks = (w, kind) => w.hazards.filter((h) => h.kind === kind && h.life > 0);
const begin = (w, e) =>
  guardianBrains[currentZone.zoneDef(w).guardian.brain](w, e, w.players[0], e.speed, TICK);

// This protects playable content: every promised species can spawn in the right stage, with a real skill.
test("guardian catalogue keeps 13 distinct brains and complete rosters; every map allows early summons and forces its guardian at 600 s", () => {
  const ids = new Set();
  for (const stage of [tower, glacier, volcano])
    for (const z of stage.zones) {
      assert(guardianBrains[z.guardian.brain]);
      ids.add(z.guardian.species);
      assert(!z.roster.some(([, s]) => s === z.guardian.species));
      for (const [, s] of z.roster) if (enemies[s].skill) assert(skills[enemies[s].skill.kind]);
    }
  assert.equal(ids.size, 13);
  assert(stageDefs.tower.zones[0].roster.some(([, s]) => s === "haunter"));
  assert(!stageDefs.tower.zones[0].roster.some(([, s]) => s === "haunter-guardian"));
  for (const stage of Object.values(stageDefs)) {
    assert.equal(stage.zones.length, 1, `${stage.id} has one field`);
    assert.equal(stage.duration, 600, `${stage.id} has a ten-minute normal phase`);
    const config = { stage: stage.id, seed: 3, difficulty: 0, players: [{ starter: "bulbasaur" }] };
    const w = createWorld(config);
    w.zone.tick = 600 / TICK - 2;
    updateDirector(w, TICK);
    assert.equal(w.bossId, null, `${stage.id}: not forced before 600 s`);
    updateDirector(w, TICK);
    const forced = w.enemies.find((e) => e.id === w.bossId);
    assert.equal(forced?.species, stage.zones[0].guardian.species, stage.id);
    assert.ok(forced.boss);
    const early = createWorld(config);
    const pad = currentZone.landmarkOf(early);
    Object.assign(early.players[0], { x: pad.x, z: pad.z });
    assert.equal(interactAtLandmark(early, early.players[0]), true);
    assert.ok(
      early.enemies.some((e) => e.id === early.bossId && e.boss),
      stage.id,
    );
    const id = early.bossId;
    assert.equal(interactAtLandmark(early, early.players[0]), false);
    assert.equal(early.bossId, id, `${stage.id}: an early summon is unique`);
  }
});

test("sludge trail stays bounded while moving; stationary and sleeping enemies stop laying pools", () => {
  const w = arena(),
    e = enemy(w, "grimer");
  e.speed = 1;
  run(w, 6, () => {
    e.x += 0.1;
  });
  assert(marks(w, "acid-pool").length <= 5);
  assert(marks(w, "acid-pool").length >= 4);
  e.speed = 0;
  const ids = marks(w, "acid-pool").map((h) => h.id);
  run(w, 0.7);
  assert(marks(w, "acid-pool").every((h) => ids.includes(h.id)));
  apply(e, "sleep", 2, 0, -1);
  run(w, 1);
  assert(marks(w, "acid-pool").every((h) => ids.includes(h.id)));
});

test("Kadabra's destination is legal and its beam has a full warning after the teleport", () => {
  const w = arena(),
    e = enemy(w, "kadabra", 3);
  run(w, TICK);
  assert.equal(e.phase, "under");
  assert(!targetable(e));
  assert.equal(marks(w, "teleport-mark").length, 1);
  run(w, 0.4 + TICK);
  assert.equal(e.phase, "windup");
  assert(targetable(e));
  assert(hypot2(e, w.players[0]) >= 7);
  const beam = marks(w, "psybeam")[0];
  assert(beam.life > 0.7);
  const hp = w.players[0].hp;
  run(w, 0.6);
  assert.equal(w.players[0].hp, hp);
  run(w, 0.4);
  assert(w.players[0].hp < hp);
});
function hypot2(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

test("sing and ice variants slow; Flareon's fire ring never poisons", () => {
  for (const id of ["jigglypuff", "wigglytuff", "jynx", "shellder"]) {
    const w = arena();
    enemy(w, id, 2);
    run(w, 2.5);
    assert(has(w.players[0], "slow"), id);
    assert(w.players[0].hp < 1e6, id);
  }
  const w = arena();
  enemy(w, "flareon", 1);
  run(w, 0.2);
  assert(w.players[0].hp < 1e6);
  assert(!has(w.players[0], "poison"));
});

test("triple burrow exposes three simultaneous landings and only one body", () => {
  const w = arena(),
    e = enemy(w, "dugtrio", 5);
  run(w, TICK);
  assert.equal(marks(w, "landing").length, 3);
  const p = w.players[0],
    side = marks(w, "landing")[0];
  p.x = side.x;
  p.z = side.z;
  run(w, 1);
  assert(p.hp < 1e6);
  assert.equal(e.phase, "recover");
  assert(hypot2(e, { x: 0, z: 0 }) < 0.1);
});

test("ice lakes ease only walking, temporary strips expire and fire enemies ignore lava", () => {
  const w = arena("glacier"),
    p = w.players[0],
    terrain = w.map.terrain;
  const grid = {
    origin: terrain.origin,
    resolution: terrain.resolution,
    samples: terrain.samples,
    values: new Float32Array(terrain.samples ** 2).fill(-1),
  };
  terrain.surface = buildSurface(terrain, grid, { ground: "ice", shallowSpeed: 1, liquids: [] }, [
    { kind: "ice-slick", x: 0, z: 0, radius: 4 },
  ]);
  p.x = 3;
  p.z = 0;
  assert(onIce(w, p), "the outward ice shore remains slippery");
  p.x = 0;
  p.z = 3;
  assert(!onIce(w, p), "a snowy inlet inside the enclosing radius is not slippery");
  p.x = p.z = 0;
  w.nav = createNav(terrain);
  p.inputX = 1;
  movePlayer(w, p, 5, TICK);
  assert(Math.abs(p.vx - 5 * 1.15 * 0.15) < 1e-6);
  p.inputX = 0;
  const old = p.vx;
  movePlayer(w, p, 5, TICK);
  assert(Math.abs(p.vx - old * 0.85) < 1e-6);
  for (let i = 0; i < 90; i++) movePlayer(w, p, 5, TICK);
  assert.equal(p.moving, false, "inertia eventually settles for standing-still effects");
  p.dashTime = 0.1;
  p.dashX = 1;
  movePlayer(w, p, 5, TICK);
  assert.equal(p.vx, 17);
  terrain.surface.patches = [];
  assert(!onIce(w, p));
  addHazard(w, {
    kind: "ice-trail",
    x: p.x - 1,
    y: 0,
    z: p.z,
    radius: 1.1,
    dirX: 1,
    dirZ: 0,
    length: 3,
    life: 8,
  });
  assert(onIce(w, p));
  updateHazards(w, 8.1);
  assert(!onIce(w, p));
  for (const species of ["vulpix", "magmar", "arcanine", "geodude"]) {
    const e = enemy(w, species);
    settleEnemySurface(e, { kind: "lava", speed: 1, waterDepth: 0, lavaDepth: 1, patch: null });
    assert.equal(has(e, "burn"), species === "geodude", species);
  }
});

test("all 13 guardians hold telegraphs, recover and refuse to start during paralysis", () => {
  for (const { stage, guardian } of guardianConfigs.filter(({ stage }) =>
    ["tower", "glacier", "volcano"].includes(stage),
  )) {
    const w = arena(stage, guardian.species),
      e = boss(w);
    apply(e, "paralysis", 2, 0, -1);
    begin(w, e);
    assert.equal(e.phase, "chase", e.species);
    e.statuses = [];
    begin(w, e);
    assert(e.phase !== "chase" || w.hazards.length > 0, e.species + " starts a distinctive attack");
    const first = e.action?.attack;
    const phases = new Set();
    run(w, 5, () => phases.add(e.phase));
    assert(!e.action || Number.isFinite(e.action.windup), e.species);
    if (first)
      assert(
        phases.has("recover") || first === "shadow-bones",
        e.species + " has an output window",
      );
  }
});

test("campaign guardians cast warned ground circles and chase faster after the forest; paralysis stops extra casts", () => {
  const circles = (stage, species, paralysed = false) => {
    const w = arena(stage, species);
    const e = boss(w);
    e.phaseTime = 0;
    // Out of native attack reach: every counted circle must come from fury.
    w.players[0].x = w.players[0].px = -30;
    if (paralysed) apply(e, "paralysis", 30, 0, -1);
    const seen = new Map();
    run(w, 14, () => {
      for (const h of w.hazards)
        if (h.kind === "boss-fall" && h.caster === e.id && !seen.has(h.id))
          seen.set(h.id, { ...h });
    });
    return Object.assign([...seen.values()], { fury: e.fury });
  };
  assert.equal(circles("forest", "scyther").fury, undefined, "forest keeps its rhythm");
  assert.equal(circles("desert", "marowak", true).length, 0, "a paralysed guardian casts nothing");
  const second = circles("desert", "marowak");
  const third = circles("glacier", "lapras");
  assert.ok(
    second.length > 0 && third.length > second.length,
    "later maps cast more often than the desert",
  );
  assert.ok(circles("tower", "haunter-guardian").length > 0, "the final map casts campaign fury");
  for (const circle of [...second, ...third])
    assert.ok(circle.duration - ZONE_GUARDIAN.fallResidue >= 1, "every circle is warned");

  const chased = (stage, species) => {
    const w = arena(stage, species);
    const e = enemy(w, species, 40);
    e.phaseTime = 0;
    run(w, 1);
    return e.phaseTime;
  };
  assert.ok(Math.abs(chased("desert", "marowak") - 1.4) < 0.1);
  assert.ok(Math.abs(chased("glacier", "lapras") - 2) < 0.1);
});

test("shadow chains re-lock each landing, remain bounded underground, then release the radial fan", () => {
  for (const [species, total, turn] of [
    ["haunter-guardian", 2, 0],
    ["gengar", 3, 1],
  ]) {
    const w = arena("tower", species),
      e = boss(w, turn, true);
    begin(w, e);
    let arrivals = 0,
      last = e.phase,
      shots = 0,
      recovered = false;
    run(w, 4, () => {
      if (last === "under" && e.phase === "dash") {
        arrivals++;
        w.players[0].x += 3;
      }
      last = e.phase;
      shots = Math.max(shots, marks(w, "boss-shot").length);
      recovered ||= e.phase === "recover";
    });
    assert.equal(arrivals, total);
    assert(shots >= 8);
    assert(recovered);
  }
});

test("Muk's slam leaves a pool and eight poison shots below half health", () => {
  const w = arena("tower", "muk"),
    e = boss(w, 1, true);
  begin(w, e);
  assert.equal(e.action.attack, "sludge-slam");
  run(w, 1.7);
  assert(marks(w, "acid-pool").some((h) => h.radius === 2.4));
  assert.equal(marks(w, "boss-shot").filter((h) => h.poison).length, 8);
  assert.equal(e.phase, "recover");
});

test("Mr Mime's closing walls have an escape gap and hit each player only once", () => {
  const w = arena("tower", "mr-mime"),
    e = boss(w);
  begin(w, e);
  const box = marks(w, "closing-box")[0];
  const p = w.players[0];
  p.x = 0;
  p.z = 0;
  const hp = p.hp;
  updateHazards(w, box.life - box.active - 0.01);
  assert.equal(p.hp, hp);
  const half = boxHalf(box),
    gap = box.gap;
  p.x = gap % 2 === 0 ? (gap < 2 ? half : -half) : 0;
  p.z = gap % 2 === 1 ? (gap < 2 ? half : -half) : 0;
  updateHazards(w, 0.02);
  assert.equal(p.hp, hp, "exit remains safe");
  const side = (gap + 1) % 4;
  const h = boxHalf(box);
  p.x = side % 2 === 0 ? (side < 2 ? h : -h) : 0;
  p.z = side % 2 === 1 ? (side < 2 ? h : -h) : 0;
  updateHazards(w, 0.01);
  assert(p.hp < hp);
  const after = p.hp;
  p.invulnerable = 0;
  updateHazards(w, 0.01);
  assert.equal(p.hp, after);
});

test("Alakazam records future sight over time; Gengar's curse follows then fixes the circle", () => {
  const w = arena("tower", "alakazam"),
    e = boss(w, 2, true);
  begin(w, e);
  run(w, 1.6, () => {
    w.players[0].x += 0.08;
  });
  const spots = marks(w, "boss-fall");
  assert.equal(spots.length, 4);
  assert(new Set(spots.map((h) => h.x)).size === 4);
  const c = arena("tower", "gengar"),
    g = boss(c, 2);
  begin(c, g);
  const mark = marks(c, "curse-mark")[0];
  c.players[0].x = 3;
  updateHazards(c, 1);
  assert.equal(mark.x, 3);
  updateHazards(c, 0.6);
  const locked = mark.x;
  c.players[0].x = 9;
  updateHazards(c, 0.2);
  assert.equal(mark.x, locked);
  const hp = c.players[0].hp;
  updateHazards(c, 0.5);
  assert.equal(c.players[0].hp, hp, "leaving after lock avoids the curse");
});

test("Dewgong's repeated slide lays finite eight-second ice; Cloyster's shell reduces hits and carries orbiting ice", () => {
  const w = arena("glacier", "dewgong"),
    e = boss(w, 1, true);
  begin(w, e);
  run(w, 3.8);
  assert(marks(w, "ice-trail").length >= 2);
  assert(marks(w, "ice-trail").every((h) => h.length > 5));
  assert(marks(w, "boss-fall").length === 5);
  const c = arena("glacier", "cloyster"),
    cl = boss(c, 1, true);
  begin(c, cl);
  assert.equal(cl.hardenDamage, 0.3);
  assert.equal(cl.hardened, 2.5);
  const orbit = marks(c, "orbit")[0],
    angle = orbitAngle(orbit);
  run(c, 0.5);
  assert(orbitAngle(orbit) > angle);
  assert.equal(marks(c, "boss-fall").length, 6);
});

test("volcano bosses retain distinct flame dive, triple dash and sweeping beam mechanics", () => {
  const m = arena("volcano", "magmar"),
    mag = boss(m, 1, true);
  begin(m, mag);
  run(m, 1.2);
  assert(marks(m, "burning-pool").some((h) => h.radius === 2.6));
  assert.equal(marks(m, "boss-shot").length, 6);
  const a = arena("volcano", "arcanine"),
    arc = boss(a, 0, true);
  begin(a, arc);
  run(a, 3);
  assert(marks(a, "burning-trail").length === 3);
  assert.equal(arc.action.attack, "fire-blast");
  const d = arena("volcano", "dragonite"),
    dragon = boss(d, 2, true);
  begin(d, dragon);
  const sweep = marks(d, "sweep")[0];
  updateHazards(d, sweep.life - sweep.active);
  const first = sweepHeading(sweep);
  updateHazards(d, 0.5);
  assert(sweepHeading(sweep) > first);
  assert.equal(sweep.angle, Math.PI / 4);
});

test("eruption warns before impact, leaves fire, serves each living player and respects warning budget", () => {
  const w = arena("volcano");
  fireBeat(w, { kind: "eruption" }, w.players[0]);
  updateHazards(w, TICK);
  const mark = marks(w, "boss-fall")[0];
  assert(mark);
  assert.equal(mark.element, "fire");
  assert(hypot2(mark, w.players[0]) >= 3);
  w.players[0].x = mark.x;
  w.players[0].z = mark.z;
  const hp = w.players[0].hp;
  updateHazards(w, 1);
  assert.equal(w.players[0].hp, hp);
  updateHazards(w, 0.2);
  assert(w.players[0].hp < hp);
  assert(marks(w, "burning-pool").some((h) => h.radius === 1.4));
  for (let i = 0; i < 7; i++)
    addHazard(w, { kind: "dash-warn", x: 0, y: 0, z: 0, radius: 1, life: 5, caster: -1 });
  const count = marks(w, "boss-fall").length;
  updateHazards(w, 0.8);
  assert(marks(w, "boss-fall").length <= count);
  assert(warningCount(w, w.players[0]) >= 6);
});

function wall(w, x) {
  const t = w.map.terrain,
    heights = new Float32Array(t.samples * t.samples);
  const column = Math.round((x - t.origin) * t.resolution);
  for (let row = 0; row < t.samples; row++) heights[row * t.samples + column] = 4;
  t.walls = { origin: t.origin, resolution: t.resolution, samples: t.samples, heights };
  w.nav = createNav(t);
}

test("tower walls stop normal bones, beams and shots while dark bones cross them", () => {
  for (const ghost of [false, true]) {
    const w = arena(),
      e = enemy(w, "cubone", -3);
    wall(w, 0);
    w.players[0].x = 3;
    throwBone(w, e, 1, 0, 8, 20, ghost ? true : undefined);
    for (let i = 0; i < 28; i++) updateHazards(w, TICK);
    assert.equal(
      w.players[0].hp < 1e6,
      ghost,
      "only the explicitly piercing bone reaches the far side",
    );
  }
  const w = arena();
  enemy(w, "jynx", -3);
  wall(w, 0);
  w.players[0].x = 3;
  run(w, 2);
  assert.equal(w.players[0].hp, 1e6);
  assert.equal(marks(w, "ice-beam").length, 0, "covered target does not start a beam");
  addHazard(w, { kind: "boss-shot", x: -3, y: 0.5, z: 0, vx: 6, life: 2, radius: 0.2, dmg: 20 });
  for (let i = 0; i < 30; i++) updateHazards(w, TICK);
  assert.equal(w.players[0].hp, 1e6);
});

test("guardian shields reduce real hits only while closed, and pre-release hazards cancel on death", () => {
  for (const [stage, species, multiplier] of [
    ["tower", "mr-mime", 0.4],
    ["glacier", "cloyster", 0.3],
  ]) {
    const w = arena(stage, species),
      e = boss(w, 1);
    begin(w, e);
    const strike = () =>
      damageEnemy({ world: w, grid: new EnemyGrid() }, e, {
        owner: w.players[0],
        move: null,
        type: "normal",
        dmg: 100,
        crit: -1,
      });
    let hp = e.hp;
    strike();
    const shielded = hp - e.hp;
    e.hardened = 0;
    hp = e.hp;
    strike();
    const open = hp - e.hp;
    assert(Math.abs(shielded / open - multiplier) < 0.01);
  }
  for (const [stage, species] of [
    ["tower", "mr-mime"],
    ["tower", "golbat"],
    ["glacier", "dewgong"],
    ["volcano", "dragonite"],
  ]) {
    const w = arena(stage, species),
      e = boss(w);
    begin(w, e);
    e.hp = 0;
    const hp = w.players[0].hp;
    for (let i = 0; i < 60; i++) updateHazards(w, TICK);
    assert.equal(w.players[0].hp, hp);
    assert(!w.hazards.some((h) => h.caster === e.id && h.dmg > 0));
  }
});

test("orbital ice and sweeping beams hit their moving geometry, not the entire warning region", () => {
  const w = arena("glacier", "cloyster"),
    e = boss(w, 1);
  begin(w, e);
  const orbit = marks(w, "orbit")[0],
    p = w.players[0];
  p.x = e.x;
  p.z = e.z;
  const hp = p.hp;
  updateHazards(w, 0.2);
  assert.equal(p.hp, hp, "inside orbit is safe");
  const angle = orbitAngle(orbit) + 2 * TICK;
  p.x = e.x + Math.cos(angle) * 3.2;
  p.z = e.z + Math.sin(angle) * 3.2;
  updateHazards(w, TICK);
  assert(p.hp < hp, "touching an icicle hurts");
  const d = arena("volcano", "dragonite"),
    dragon = boss(d, 2, true);
  begin(d, dragon);
  const sweep = marks(d, "sweep")[0],
    q = d.players[0];
  q.x = 3;
  q.z = 0;
  const before = q.hp;
  updateHazards(d, sweep.life - 1);
  assert.equal(q.hp, before, "sector telegraph does not itself hit");
  updateHazards(d, 0.5);
  assert(q.hp < before, "beam reaches the sector centre halfway through the sweep");
});

test("eruption covers each living player for ten seconds and never stacks more than two pending marks each", () => {
  const w = arena("volcano"),
    p = w.players[0];
  w.players.push({ ...p, id: p.id + 1, x: 22, px: 22, statuses: [] });
  fireBeat(w, { kind: "eruption" }, p);
  const seen = new Set();
  let maximum = 0;
  for (let i = 0; i < 301; i++) {
    w.tick++;
    updateHazards(w, TICK);
    for (const mark of marks(w, "boss-fall"))
      if (mark.target !== undefined) {
        seen.add(mark.target);
      }
    for (const player of w.players)
      maximum = Math.max(
        maximum,
        marks(w, "boss-fall").filter((h) => h.target === player.id && h.dmg > 0).length,
      );
  }
  assert.equal(seen.size, 2);
  assert(maximum <= 2);
  assert.equal(marks(w, "eruption").length, 0);
});

test("shadow bones keep the warned count when HP crosses half during windup", () => {
  const w = arena("tower", "marowak-ghost"),
    e = boss(w, 0);
  begin(w, e);
  assert.equal(marks(w, "bone-warn").length, 1);
  e.hp = e.maxHp * 0.4;
  e.phaseTime = e.action.windup;
  begin(w, e);
  assert.equal(marks(w, "bone").length, 1);
});

test("guardian fan shots use the exact locked warning lanes and stop at their range", () => {
  for (const [stage, species, turn] of [
    ["tower", "haunter-guardian", 1],
    ["tower", "gengar", 0],
    ["glacier", "cloyster", 0],
  ]) {
    const w = arena(stage, species),
      e = boss(w, turn);
    begin(w, e);
    const lanes = marks(w, "bone-warn").map((h) => ({ ...h }));
    assert(lanes.length > 0);
    assert.equal(begin(w, e)[2], 0, "windup holds its origin still");
    e.phaseTime = e.action.windup;
    begin(w, e);
    const shots = marks(w, "boss-shot");
    assert.equal(shots.length, lanes.length);
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i],
        l = lanes[i],
        speed = Math.hypot(s.vx, s.vz);
      assert(Math.abs(s.life * speed - l.length) < 1e-8);
      assert(Math.abs(s.vx / speed - l.dirX) < 1e-8);
      assert(Math.abs(s.vz / speed - l.dirZ) < 1e-8);
      assert.equal(s.x, l.x);
      assert.equal(s.z, l.z);
      assert.equal(s.y, l.y);
    }
  }
});

test("blocked guardian landing rotates to an available attack; dashes honor slowed speed", () => {
  const w = arena("tower", "muk"),
    e = boss(w, 1);
  wall(w, 4);
  addCircleBlocker(w.nav, 4, 0, 2);
  begin(w, e);
  assert.equal(e.attackTimer, 2);
  begin(w, e);
  assert(marks(w, "boss-fall").length > 0);
  const ice = arena("glacier", "dewgong"),
    slide = boss(ice, 1);
  begin(ice, slide);
  slide.phase = "dash";
  slide.phaseTime = 0;
  const direction = guardianBrains.dewgong(ice, slide, ice.players[0], slide.speed / 2, TICK);
  assert.equal(direction[2], 8);
});

test("eruption warning load on one screen does not starve distant teammates", () => {
  const w = arena("volcano"),
    base = w.players[0];
  w.players = [
    [-30, -30],
    [30, -30],
    [-30, 30],
    [30, 30],
  ].map(([x, z], id) => ({ ...structuredClone(base), id, x, z, px: x, pz: z }));
  for (let i = 0; i < 7; i++)
    addHazard(w, { kind: "dash-warn", x: -30, y: 0, z: -30, radius: 1, life: 5 });
  fireBeat(w, { kind: "eruption" }, w.players[0]);
  updateHazards(w, TICK);
  assert.deepEqual(
    marks(w, "boss-fall")
      .map((h) => h.target)
      .sort(),
    [1, 2, 3],
  );
});
