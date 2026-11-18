import assert from "node:assert/strict";
import test from "node:test";
import { TRAINER } from "../src/run/sim/content/params/trainers.ts";
import { SHINY } from "../src/run/sim/content/params/field-events.ts";
import { trainerKits } from "../src/run/sim/content/trainers.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { recordEncounter, settlementDex } from "../src/run/sim/encounters.ts";
import { grantPartner, partnerHit } from "../src/run/sim/partners.ts";
import { createRng, next } from "../src/run/sim/rng.ts";
import { snapshotWorld, restoreWorld } from "../src/run/sim/snapshot.ts";
import { forget } from "../src/run/sim/stations.ts";
import { playerStats } from "../src/run/sim/stats.ts";
import { apply, sustain } from "../src/run/sim/status.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { applyCommand, createWorld, stepSharedWorld } from "../src/run/sim/world.ts";

function run(...trainers) {
  return createWorld({
    mode: "expedition",
    stage: "forest",
    seed: 7,
    difficulty: 0,
    rules: [],
    players: trainers.map((trainer) => ({ trainer, starter: "charmander", shiny: false })),
  });
}
const assist = (world, player = 0) => applyCommand(world, { t: "assist", player });

test("好伤药只回复自己和半径内存活队友，包括边界", () => {
  const world = run("shuoye", "yewei", "xiaqing", "chengxi");
  const [user, near, far, down] = world.players;
  for (const player of world.players) player.hp /= 2;
  near.x = user.x + TRAINER.radius;
  far.x = near.x + 0.01;
  Object.assign(down, { x: user.x, hp: 0, alive: false });
  const hp = user.hp;
  assist(world);
  assert.equal(near.hp, hp + playerStats(near).maxHp * TRAINER.superPotion.hp);
  assert.equal(user.hp, near.hp);
  assert.equal(far.hp, hp);
  assert.equal(down.hp, 0);
  assert.deepEqual(
    world.events.filter((e) => e.t === "assist"),
    [
      {
        t: "assist",
        player: user.id,
        item: "superPotion",
        x: user.x,
        z: user.z,
        to: [user.id, near.id],
      },
    ],
    "the event names where it was thrown and exactly who it reached",
  );
});

test("重连前后同一世界时刻才可再次使用，倒下不花冷却", () => {
  const w = run("shuoye", "chengxi");
  assist(w);
  w.time += 23;
  const restored = restoreWorld(w.map, JSON.parse(JSON.stringify(snapshotWorld(w))));
  for (const world of [w, restored]) {
    const [p] = world.players;
    world.events.length = 0;
    p.hp = 1;
    assert.equal(p.assistReady - world.time, TRAINER.cooldown - 23);
    world.time = TRAINER.cooldown - TICK;
    assist(world);
    assert.equal(p.hp, 1);
    // Use the actual accumulated world seconds, not an exact decimal wall clock.
    world.time = 0;
    for (let i = 0; i < Math.round(TRAINER.cooldown / TICK); i++) world.time += TICK;
    p.alive = false;
    assist(world);
    assert.equal(p.assistReady, TRAINER.cooldown);
    assert.equal(world.events.length, 0);
    p.alive = true;
    assist(world);
    assert.ok(p.hp > 1);
    assert.equal(p.assistReady, world.time + TRAINER.cooldown);
  }
});

test("四种支援都不直接伤敌；搭档的攻击、防御、生命不因训练师而变", () => {
  const w = run(...Object.keys(trainerKits));
  const enemy = spawnEnemy(w, "rattata", 0, 0);
  const hp = enemy.hp;
  const base = playerStats(w.players[0]);
  for (const p of w.players) {
    const stats = playerStats(p);
    assert.deepEqual(
      [stats.damage, stats.armor, stats.maxHp],
      [base.damage, base.armor, base.maxHp],
    );
    assist(w, p.id);
  }
  assert.equal(enemy.hp, hp);
  assert.deepEqual([w.projectiles.length, w.areas.length, w.hazards.length], [0, 0, 0]);
  assert.equal(w.events.filter((e) => e.t === "assist").length, 4);
});

test("共享强化按模拟时间失效，万灵药免疫重新施加的异常", () => {
  const w = run("chengxi", "xiaqing", "yewei");
  const [, ally] = w.players;
  const stats = playerStats(ally);
  apply(ally, "poison", 8, 0, -1);
  sustain(ally, "slow", 2, -1);
  for (const p of w.players) assist(w, p.id);
  assert.deepEqual(ally.statuses, []);
  apply(ally, "poison", 8, 0, -1);
  sustain(ally, "slow", 2, -1);
  assert.deepEqual(ally.statuses, []);
  const boosted = playerStats(ally);
  assert.equal(boosted.crit, 1);
  assert.equal(boosted.speed, stats.speed * TRAINER.xSpeed.movement);
  assert.equal(boosted.cooldown, stats.cooldown / TRAINER.xSpeed.attackRate);
  for (let i = 0; i < Math.round(TRAINER.fullHeal.seconds / TICK); i++) stepSharedWorld(w, []);
  apply(ally, "poison", 1, 0, -1);
  assert.ok(ally.statuses.some((s) => s.id === "poison"));
  for (let i = 0; i < Math.round((TRAINER.xSpeed.seconds - TRAINER.fullHeal.seconds) / TICK); i++)
    stepSharedWorld(w, []);
  const expired = playerStats(ally);
  assert.deepEqual(
    [expired.speed, expired.cooldown, expired.crit],
    [stats.speed, stats.cooldown, stats.crit],
  );
});

test("夜苇提升全队的一次异色判定，不叠加；只有本人结算遇见加成", () => {
  function seedIn(min, max) {
    for (let seed = 0; seed < 100000; seed++) {
      const draw = next(createRng(seed));
      if (draw >= min && draw < max) return seed;
    }
    throw new Error("没有找到指定区间内的测试种子");
  }
  const boosted = SHINY.chance * TRAINER.naturalist.shiny;
  const rolls = [
    seedIn(SHINY.chance, boosted),
    seedIn(boosted, boosted * TRAINER.naturalist.shiny),
  ];
  for (const trainers of [
    ["chengxi", "shuoye"],
    ["chengxi", "yewei"],
    ["yewei", "yewei"],
  ]) {
    const w = run(...trainers);
    const enemy = spawnEnemy(w, "rattata", 0, 0);
    for (const [i, seed] of rolls.entries()) {
      w.spawn.shinySpawned = enemy.shiny = false;
      w.rng = createRng(seed);
      recordEncounter(w, enemy);
      assert.equal(enemy.shiny, i === 0 && trainers.includes("yewei"));
    }
    for (const p of w.players) {
      const raw = { ...p.dex.rattata };
      const earned = settlementDex(p).rattata;
      assert.deepEqual(earned, {
        ...raw,
        seen: Math.round(raw.seen * (p.trainer === "yewei" ? TRAINER.naturalist.seen : 1)),
      });
      assert.deepEqual(p.dex.rattata, raw);
    }
  }
});

test("饲育员缩短本人同伴的攻击间隔并提高伤害", () => {
  const w = run("yewei", "xiaqing");
  for (const p of w.players) grantPartner(w, p, "rattata");
  const [ordinary, trained] = w.partners;
  assert.equal(partnerHit(w, trained), partnerHit(w, ordinary) * TRAINER.caretaker.damage);
  assert.equal(trained.cooldown, ordinary.cooldown * TRAINER.caretaker.interval);
});

test("夜苇的遇见加成四舍五入：只遇见一次也有收益", () => {
  const [yewei] = run("yewei").players;
  yewei.dex.rattata = { seen: 1, defeated: 0, shiny: 0 };
  assert.equal(settlementDex(yewei).rattata.seen, 2);
});

test("维修师在引梦貘人处遗忘返还更多星星沙子，其他训练师不变", () => {
  const earned = (trainer) => {
    const [player] = run(trainer).players;
    player.moves.push({ ...player.moves[0], id: "flamethrower", level: 3 });
    const before = player.stardust;
    assert.equal(forget(player, { kind: "move", id: "flamethrower" }), true);
    return player.stardust - before;
  };
  assert.equal(earned("shuoye"), earned("chengxi") * TRAINER.tinker.refund);
});
