import { unlockIds } from "../src/run/sim/content/unlocks.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { emptyProgress, recordRun } from "../src/run/progress.ts";
import { commitCombat, damageEnemy, killEnemy } from "../src/run/sim/combat.ts";
import { passedTowerFloors } from "../src/run/sim/content/campaign.ts";
import { difficulties } from "../src/run/sim/content/difficulties.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { fieldEventDefs } from "../src/run/sim/content/events.ts";
import { COOP, coopScaling } from "../src/run/sim/content/params/coop.ts";
import { ELITE, GUARDIAN_REFERENCE_SECONDS } from "../src/run/sim/content/params/pacing.ts";
import { TOWER, towerClock, towerFactorsFor } from "../src/run/sim/content/params/tower.ts";
import { zoneFactorsFor } from "../src/run/sim/content/params/zones.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { atExit, landmarkOf, zoneDef } from "../src/run/sim/currentZone.ts";
import {
  bossHp,
  enemyHealthScaling,
  enemyScaling,
  spawnRate,
  updateDirector,
} from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { weatherDamagePlayer } from "../src/run/sim/hurt.ts";
import { grantPartner, partnerHit } from "../src/run/sim/partners.ts";
import { mapDigest, restoreWorld, snapshotWorld } from "../src/run/sim/snapshot.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { currentStats } from "../src/run/sim/stats.ts";
import { viewClearance } from "../src/run/sim/viewFootprint.ts";
import { applyCommand, createWorld, stepSharedWorld, stepWorld } from "../src/run/sim/world.ts";
import { enterZone, prepareZone } from "../src/run/sim/zones.ts";

const players = (seats) =>
  ["charmander", "squirtle"]
    .slice(0, seats)
    .map((starter) => ({ trainer: "chengxi", starter, shiny: false }));
const tower = (seats, seed = 7) =>
  createWorld({
    unlocks: unlockIds,
    mode: "tower",
    stage: "forest",
    seed,
    rules: [],
    difficulty: 0,
    players: players(seats),
  });
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);
const stand = (player, { x, z }) => Object.assign(player, { x, z, px: x, pz: z });
const step = (world, commands = []) =>
  (world.players.length > 1 ? stepSharedWorld : stepWorld)(world, commands);

// Jump past uneventful combat; the tick on each side of the deadline still uses the host loop.
function seek(world, seconds) {
  const tick = Math.round(seconds / TICK);
  world.tick += tick - world.zone.tick;
  world.time = world.tick * TICK;
  world.zone.tick = tick;
}

function answerCards(world, player) {
  while (player.pending.length) {
    const card = player.pending[0];
    applyCommand(world, { t: "pick", player: player.id, card: card.id, index: 0 });
    assert.notEqual(player.pending[0]?.id, card.id);
  }
}

function expireFloor(world) {
  seek(world, TOWER.floorSeconds - TICK);
  step(world);
  const pad = landmarkOf(world);
  assert.equal(world.zone.phase, "cleared");
  assert.equal(atExit(world, pad), 0, "计时层的出口可在地标中央使用");
  assert.equal(world.bossId, null);
}

function takeExit(world) {
  const [exit] = world.zone.exits;
  for (const p of world.players) stand(p, exit);
  // The guest can lead the team through. The second command cannot accept another exit.
  step(
    world,
    world.players.toReversed().map(({ id }) => ({ t: "interact", player: id })),
  );
  assert.equal(world.zone.phase, "transitioning");
  assert.equal(passedTowerFloors(world), world.route.length);
}

function fellGuardian(world) {
  const guardian = world.enemies.find((e) => e.id === world.bossId);
  const owner = world.players.at(-1);
  const ctx = { world, grid: new EnemyGrid() };
  stand(guardian, { x: 0, z: 0 });
  const hit = {
    owner,
    move: null,
    type: "normal",
    dmg: 1e8,
    crit: 0,
    statusChance: 0,
    knock: 0,
    fromX: owner.x,
    fromZ: owner.z,
  };
  if (world.players.length === 1) {
    // An environmental KO isolates the guardian reward from life steal on the killing hit.
    guardian.hp = 0;
    killEnemy(ctx, guardian, null);
  } else {
    let effect;
    damageEnemy({ ...ctx, report: (value) => (effect = value) }, guardian, hit);
    assert.equal(world.zone.phase, "active", "客机报告碰撞不提交守卫奖励");
    commitCombat(ctx, owner, effect);
    commitCombat(ctx, owner, effect);
  }
  assert.equal(world.zone.phase, "cleared");
  assert.equal(atExit(world, guardian), 0, "可通行的倒下处直接开出口");
}

test("紫苑塔在对战塔是计时层，在远征是可召唤守卫的终点", () => {
  const seed = 601;
  const world = tower(1, seed);
  assert.equal(world.stage, "tower");
  const p = world.players[0];
  stand(p, landmarkOf(world));
  seek(world, TOWER.floorSeconds - 2 * TICK);
  step(world, [{ t: "interact", player: 0 }]);
  assert.equal(world.zone.phase, "active");
  assert.equal(world.bossId, null);
  step(world);
  assert.equal(atExit(world, p), 0);
  assert.equal(passedTowerFloors(world), 0, "只开出口不算通过");
  assert.ok(!world.pickups.some((drop) => drop.kind === "trophy"));
  takeExit(world);
  enterZone(world, prepareZone(world));
  assert.equal(passedTowerFloors(world), 1);
  assert.equal(world.outcome, "playing");

  const expedition = createWorld({
    mode: "expedition",
    stage: "tower",
    route: ["forest", "coast", "glacier", "tower"],
    difficulty: 0,
    rules: [],
    seed,
    players: players(1),
  });
  seek(expedition, TOWER.floorSeconds - TICK);
  step(expedition);
  assert.equal(expedition.zone.phase, "active");
  const trainer = expedition.players[0];
  stand(trainer, landmarkOf(expedition));
  applyCommand(expedition, { t: "interact", player: 0 });
  assert.ok(expedition.bossId !== null);
  trainer.hp = 5;
  fellGuardian(expedition);
  assert.equal(trainer.hp, 5, "远征守卫没有对战塔回复");
  stand(trainer, expedition.zone.exits[0]);
  applyCommand(expedition, { t: "interact", player: 0 });
  answerCards(expedition, trainer);
  applyCommand(expedition, { t: "interact", player: 0 });
  assert.equal(expedition.outcome, "victory");
});

function checkEvents(world, used) {
  const { beats, events } = zoneDef(world);
  const scale = world.bossId === null ? TOWER.floorSeconds / stageDefs[world.stage].duration : 1;
  const draws = world.zone.schedule.filter(({ beat }) => beat.kind === "event");
  const pool = events.pool.filter(
    (id) => !used.has(id) && fieldEventDefs[id].stages.includes(world.stage),
  );
  assert.equal(draws.length, Math.min(pool.length, events.windows.length));
  for (const { at, beat } of draws) {
    assert.ok(pool.includes(beat.id) && !used.has(beat.id));
    assert.ok(events.windows.some(([a, b]) => at >= a * scale && at <= b * scale));
    used.add(beat.id);
  }
  for (const { at, beat } of world.zone.schedule.filter(({ beat }) => beat.kind !== "event"))
    assert.ok(
      beats.some(
        ({ beat: b, window: [lo, hi] }) =>
          b.kind === beat.kind && at >= lo * scale && at <= hi * scale,
      ),
    );
}

function checkSwarm(world, time) {
  seek(world, time - TICK);
  const floor = world.route.length;
  const team = coopScaling(world.players.length);
  const clock = towerClock(floor, time);
  // One normal arrival should now be due on this floor's clock, even during entry warm-up.
  world.spawn.credit = 1 - TICK * spawnRate(clock, world.difficulty, false) * team.spawns * 0.9;
  updateDirector(world, TICK);
  const [enemy] = world.enemies;
  assert.ok(enemy && !enemy.elite && !enemy.boss && viewClearance(world, enemy.x, enemy.z) > 1);
  const factors = towerFactorsFor(floor, stageDefs[world.stage]);
  const base = enemies[enemy.species];
  near(
    enemy.hp,
    base.hp * enemyHealthScaling(clock, world.difficulty, null) * team.hp * factors.hp,
  );
  near(enemy.dmg, base.dmg * enemyScaling(clock, world.difficulty, null).dmg * factors.dmg);
  if (floor === 50) {
    const last = zoneFactorsFor(3, stageDefs[world.stage], 0).hp;
    const prior = zoneFactorsFor(2, stageDefs[world.stage], 0).hp;
    near(factors.hp, last + 4 * (last - prior) * TOWER.slope.hp);
  }
}

for (const seats of [1, 2]) {
  test(`${seats} 人逐层到达第 50 层，守卫、奖励和七层事件池各结算一次`, () => {
    let world = tower(seats);
    const used = new Set();
    grantPartner(world, world.players[0], "pidgey");
    for (let floor = 1; floor <= 50; floor++) {
      assert.equal(world.route.length, floor);
      assert.equal(passedTowerFloors(world), floor - 1);
      assert.equal(world.zone.tick, 0);
      assert.equal(world.outcome, "playing");
      const guard = floor % 7 === 0;
      assert.equal(world.bossId !== null, guard, `第 ${floor} 层开局`);
      if (floor % 7 === 1) used.clear();
      checkEvents(world, used);
      if (floor === 4 || floor === 50) checkSwarm(world, 4);
      if (floor === 50) break;
      if (guard) {
        const boss = world.enemies.find((e) => e.id === world.bossId);
        const factors = towerFactorsFor(floor, stageDefs[world.stage]);
        near(
          boss.hp,
          bossHp(boss.species, world.difficulty) * factors.guardianHp * coopScaling(seats).bossHp,
        );
        near(
          boss.dmg,
          enemies[boss.species].dmg *
            enemyScaling(GUARDIAN_REFERENCE_SECONDS, world.difficulty, null).dmg *
            factors.dmg *
            difficulties[world.difficulty].guardianDmg *
            factors.guardianDmg,
        );
        seek(world, stageDefs[world.stage].duration - TICK);
        step(world);
        assert.equal(world.zone.phase, "active");
        assert.equal(world.rampage, false, "守卫长战没有远征超时或自动出口");
        const expected = world.players.map((p) => {
          const hp = currentStats(p).maxHp;
          p.hp = hp * (p.id ? 0.8 : 0.2);
          return Math.min(hp, p.hp + hp / 2);
        });
        fellGuardian(world);
        world.players.forEach((p, i) => near(p.hp, expected[i]));
        assert.deepEqual(
          world.pickups.filter((drop) => drop.kind === "trophy").map((drop) => drop.owner),
          world.players.map((p) => p.id),
        );
      } else expireFloor(world);
      const [exit] = world.zone.exits;
      assert.ok(exit.to && exit.to !== world.stage);
      takeExit(world);
      const carried = () =>
        world.players.map(({ hp, level, xp, items, moves, pending }) => ({
          hp,
          level,
          xp,
          items,
          moves,
          pending,
        }));
      const before = structuredClone(carried());
      const time = world.time;
      if (floor === 7) world = restoreWorld(world.map, snapshotWorld(world));
      enterZone(world, prepareZone(world));
      assert.equal(world.time, time);
      assert.equal(world.stage, exit.to);
      assert.deepEqual(carried(), before);
      assert.equal(world.partners[0].owner, 0);
      if (guard)
        for (const p of world.players) {
          assert.equal(p.pending.filter((card) => card.offer?.kind === "trophy").length, 1);
          answerCards(world, p);
        }
    }
    // Drawn cards vary with the item table; drop lethal saves so the wipe is certain.
    for (const p of world.players) {
      p.items = [];
      weatherDamagePlayer(world, p, 1e8);
    }
    step(world);
    assert.equal(world.outcome, "defeat");
    assert.equal(passedTowerFloors(world), 49);
  });
}

test("同种子重复经过同张地图时，各层使用自己的地形；同一层的地形和节拍可重放", () => {
  const run = () => {
    const world = tower(1);
    const fields = [];
    for (let floor = 1; floor <= 4; floor++) {
      fields.push({ stage: world.stage, map: mapDigest(world.map), schedule: world.zone.schedule });
      if (floor === 4) break;
      expireFloor(world);
      takeExit(world);
      enterZone(world, prepareZone(world));
    }
    return fields;
  };
  const fields = run();
  assert.deepEqual(fields, run());
  assert.equal(fields[0].stage, fields[3].stage);
  assert.notEqual(fields[0].map, fields[3].map);
});

test("塔记录按伙伴保留最高通过层，同层才比较难度", () => {
  let progress = emptyProgress();
  const settle = (starter, floor, difficulty) => {
    progress = recordRun(progress, {
      starter,
      floor,
      zones: floor,
      difficulty,
      outcome: "defeat",
      danger: 0,
      time: 90,
      level: 3,
      kills: 10,
      dex: {},
      stardust: 7,
      moves: [],
      items: [],
    });
  };
  settle("squirtle", 0, 0);
  settle("charmander", 14, 1);
  settle("charmander", 7, 2);
  assert.deepEqual(progress.tower.charmander, { floor: 14, difficulty: 1 });
  settle("charmander", 14, 2);
  settle("charmander", 14, 0);
  assert.deepEqual(progress.tower.charmander, { floor: 14, difficulty: 2 });
  settle("charmander", 15, 0);
  assert.deepEqual(progress.tower, {
    squirtle: { floor: 0, difficulty: 0 },
    charmander: { floor: 15, difficulty: 0 },
  });
});

test("过层的同伴读取所在层的入图升温，保留队员自己的输出曲线", () => {
  const world = tower(2);
  grantPartner(world, world.players[1], "pidgey");
  expireFloor(world);
  takeExit(world);
  enterZone(world, prepareZone(world));
  seek(world, 4);
  const expected =
    enemies.pidgey.dmg * ELITE.dmg * enemyScaling(towerClock(2, 4), world.difficulty, null).hp;
  near(partnerHit(world, world.partners[0]), expected);
});

test("计时层不复活倒地队友；守卫层复活时补救援生命与守卫回复", () => {
  const world = tower(2);
  const [down] = world.players;
  down.revives = 0;
  down.invulnerable = 0;
  weatherDamagePlayer(world, down, 1e8);
  assert.equal(down.alive, false);
  for (let floor = 1; floor < 7; floor++) {
    expireFloor(world);
    step(world);
    assert.equal(down.alive, false, `第 ${floor} 层计时出口不复活`);
    // Away from the downed seat, so the interact leaves instead of starting a rescue.
    stand(world.players[1], world.zone.exits[0]);
    stand(down, { x: world.zone.exits[0].x + 6, z: world.zone.exits[0].z });
    step(world, [{ t: "interact", player: 1 }]);
    assert.equal(world.zone.phase, "transitioning");
    enterZone(world, prepareZone(world));
  }
  fellGuardian(world);
  step(world);
  assert.equal(down.alive, true);
  near(down.hp, currentStats(down).maxHp * (COOP.reviveHp + TOWER.guardianHeal));
});
