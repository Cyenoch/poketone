import assert from "node:assert/strict";
import test from "node:test";
import { labBonuses } from "../src/run/lab.ts";
import { codexEntry, formKey } from "../src/run/codex.ts";
import { updateAreas, updateMoves, updateProjectiles } from "../src/run/sim/attacks.ts";
import { damageEnemy } from "../src/run/sim/combat.ts";
import { statIds } from "../src/run/sim/content/effects.ts";
import { activeWeather } from "../src/run/sim/content/weather.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { evolve, tryMegaEvolution } from "../src/run/sim/evolution.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { updateHazards } from "../src/run/sim/hazards.ts";
import { damagePlayer } from "../src/run/sim/hurt.ts";
import { addHazard } from "../src/run/sim/skills/kit.ts";
import { landingHit } from "../src/run/sim/skills/landing.ts";
import { snapshotWorld, restoreWorld } from "../src/run/sim/snapshot.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import {
  areaGrowth,
  currentStats,
  currentAbility,
  playerStats,
  refreshStats,
  statBreakdown,
  xpForLevel,
} from "../src/run/sim/stats.ts";
import { apply, attacksBlocked, decay, has, stopped, sustain } from "../src/run/sim/status.ts";
import { heightAt } from "../src/run/sim/terrain.ts";
import { fire } from "../src/run/sim/triggers/index.ts";
import { ultRate } from "../src/run/sim/ultimates/index.ts";
import { applyChoice, newMoveState } from "../src/run/sim/upgrades.ts";
import { createPlayer, createWorld, stepSharedWorld } from "../src/run/sim/world.ts";

/** The panel's reading of a line: (base + Σadd) × (1 + Σpct) × Πmul ÷ Πdiv + Σextra, active sources only. */
function recombine(line) {
  const sum = (op) =>
    line.sources.filter((s) => s.active && s.op === op).reduce((t, s) => t + s.amount, 0);
  const product = (op) =>
    line.sources.filter((s) => s.active && s.op === op).reduce((t, s) => t * s.amount, 1);
  return (
    ((line.base + sum("add")) * (1 + sum("pct")) * product("mul")) / product("div") + sum("extra")
  );
}

test("the stats panel's sources add up to the numbers the sim plays with", () => {
  for (const starter of ["charmander", "squirtle", "bulbasaur", "pikachu"]) {
    const lab = labBonuses({
      dmg: 2,
      hp: 3,
      armor: 2,
      regen: 1,
      crit: 2,
      atkspd: 3,
      area: 2,
      ult: 2,
      spd: 2,
      xp: 1,
      gold: 2,
      magnet: 1,
      luck: 3,
    });
    const player = createPlayer(0, starter, 0, lab);
    player.level = 17;
    evolve(player);
    player.items = [
      { id: "hp-up", level: 2 },
      { id: "life-orb", level: 3 },
      { id: "quick-claw", level: 2 },
      { id: "choice-scarf", level: 1 },
      { id: "honey", level: 2 },
      { id: "rocky-helmet", level: 1 },
      { id: "shell-bell", level: 1 },
    ];
    player.training = { dmg: 2, hp: 1, speed: 1, area: 1, cd: 1 };
    for (const hp of [1, Infinity]) {
      player.hp = hp;
      const stats = playerStats(player);
      const sheet = statBreakdown(player);
      for (const key of statIds) {
        const value = stats[key];
        assert.ok(Math.abs(recombine(sheet[key]) - value) < 1e-9, `${starter} ${key} sources`);
      }
      assert.equal(sheet.area.effective, areaGrowth(stats.area));
      assert.equal(sheet.ultCharge.value, ultRate(player));
      // Blaze's fire bonus is listed but not counted, and is the factor combat applies to fire hits.
      if (starter === "charmander") {
        const [fire] = sheet.damage.sources.filter((s) => s.when === "fire");
        assert.equal(fire.active, false);
        assert.ok(stats.hit.fire > 1 && fire.amount === stats.hit.fire);
      }
    }
  }
});

test("XP steps grow 10 per level with no cap: L4, L8 and L16 cost 90, 350 and 1,350 in all", () => {
  const total = (level) =>
    Array.from({ length: level - 1 }, (_, i) => xpForLevel(i + 1)).reduce((a, b) => a + b, 0);
  assert.deepEqual([4, 8, 16].map(total), [90, 350, 1350]);
  assert.equal(xpForLevel(500) - xpForLevel(499), 10);
  assert.throws(() => xpForLevel(0));
});

function field(...starters) {
  return createWorld({
    mode: "expedition",
    stage: "forest",
    difficulty: 0,
    rules: [],
    seed: 5,
    players: starters.map((starter) => ({ trainer: "chengxi", starter })),
  });
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
}

function target(ctx) {
  const player = ctx.world.players[0];
  const enemy = spawnEnemy(ctx.world, "caterpie", player.x + 1, player.z);
  enemy.hp = enemy.maxHp = 1e5;
  ctx.grid.rebuild(ctx.world.enemies);
  return enemy;
}

/** Actual damage of a non-critical hit, excluding buildup and status effects. */
function hit(ctx, player, enemy, type, move = null) {
  const before = enemy.hp;
  damageEnemy(ctx, enemy, {
    owner: player,
    type,
    move,
    dmg: 10,
    crit: -1,
    statusChance: 0,
    knock: 0,
    fromX: player.x,
    fromZ: player.z,
  });
  return before - enemy.hp;
}

test("茂盛和激流只在低 HP 时强化对应属性；切换隐藏栏位立即停用", () => {
  for (const [line, type, move, item, lowHpMultiplier] of [
    ["bulbasaur", "grass", "razor-leaf", "miracle-seed", 1.5],
    ["squirtle", "water", "water-gun", "mystic-water", 2.4],
  ]) {
    const ctx = { world: field(line), grid: new EnemyGrid() };
    const player = ctx.world.players[0],
      enemy = target(ctx);
    applyChoice(player, { kind: "item", item });
    player.level = 28;
    evolve(player);
    const full = player.hp;
    const normal = hit(ctx, player, enemy, type, move);
    const other = hit(ctx, player, enemy, "fire", "ember");
    player.hp = full * 0.4;
    close(hit(ctx, player, enemy, type, move), normal);
    player.hp -= 1;
    close(hit(ctx, player, enemy, type, move), normal * lowHpMultiplier);
    close(hit(ctx, player, enemy, "fire", "ember"), other);
    player.abilitySlot = "hidden";
    close(hit(ctx, player, enemy, type, move), normal);
  }
});

test("通信进化后不再浮游；诅咒之躯只封住实际命中的攻击者", () => {
  const w = field("gastly");
  const player = w.players[0];
  player.level = 60;
  evolve(player);
  const ctx = { world: w, grid: new EnemyGrid() };
  const caster = target(ctx),
    bystander = target(ctx);
  const pool = {
    x: player.x,
    y: heightAt(w.map.terrain, player.x, player.z),
    z: player.z,
    radius: 2,
  };
  const land = () =>
    landingHit(w, addHazard(w, { ...pool, kind: "landing", life: 1, dmg: 4, caster: caster.id }));
  addHazard(w, { ...pool, kind: "acid-pool", life: 10 });
  player.invulnerable = 0;
  const before = player.hp;
  land();
  updateHazards(w, TICK);
  assert.equal(player.hp, before);
  assert.ok(!has(player, "poison"));
  assert.ok(evolve(player, "trade"));
  player.invulnerable = 0;
  const evolvedHp = player.hp;
  land();
  updateHazards(w, TICK);
  assert.ok(player.hp < evolvedHp && has(player, "poison"));
  for (let i = 0; i < 40 && !attacksBlocked(caster); i++) {
    player.invulnerable = 0;
    land();
  }
  assert.ok(attacksBlocked(caster) && !stopped(caster) && !attacksBlocked(bystander));
  decay(caster, 4);
  assert.ok(!attacksBlocked(caster));
});

test("哈克龙的隐藏栏位随进化改为多重鳞片；满血减伤在下一击重新判断", () => {
  const w = field("dratini"),
    p = w.players[0];
  p.abilitySlot = "hidden";
  p.level = 32;
  evolve(p);
  const healthy = currentStats(p).armor;
  apply(p, "poison", 10, 0, -1);
  assert.ok(currentStats(p).armor > healthy);
  p.level = 60;
  evolve(p);
  assert.equal(currentStats(p).armor, healthy);
  const takeHit = () => {
    const before = p.hp;
    p.invulnerable = 0;
    damagePlayer(w, p, 20);
    return before - p.hp;
  };
  close(takeHit(), 10);
  close(takeHit(), 20);
});

test("晴雨覆盖使整队当天气的移速、冷却、特攻和每秒 HP 收支立即切换", () => {
  const w = field("bulbasaur", "charmander", "squirtle");
  const [grass, fire, water] = w.players;
  for (const p of w.players) {
    p.abilitySlot = "hidden";
    p.hp = playerStats(p).maxHp / 2;
    p.moves = [];
  }
  const ctx = { world: w, grid: new EnemyGrid() },
    enemy = target(ctx);
  const clear = currentStats(grass);
  const baseline = hit(ctx, fire, enemy, "electric", "thunder-shock");
  const physical = hit(ctx, fire, enemy, "fighting", "karate-chop");
  // Forecast time is not sunny time, even though the weather is already in the snapshot.
  w.weather = { id: "sun", from: 1, until: 10 };
  const hp = w.players.map((p) => p.hp);
  stepSharedWorld(w, []);
  close(fire.hp, hp[1]);
  w.weather = { id: "sun", from: w.time, until: 10 };
  close(currentStats(grass, activeWeather(w)).speed, clear.speed * 1.3);
  close(currentStats(grass, activeWeather(w)).cooldown, clear.cooldown * 0.85);
  close(hit(ctx, fire, enemy, "electric", "thunder-shock"), baseline * 1.5);
  close(hit(ctx, fire, enemy, "fighting", "karate-chop"), physical);
  stepSharedWorld(w, []);
  const sunnyHp = fire.hp;
  close(sunnyHp, hp[1] - playerStats(fire).maxHp * 0.003 * TICK);
  close(water.hp, hp[2]);
  w.weather = { id: "rain", from: w.time, until: 10 };
  close(currentStats(grass, activeWeather(w)).speed, clear.speed);
  close(hit(ctx, fire, enemy, "electric", "thunder-shock"), baseline);
  stepSharedWorld(w, []);
  close(fire.hp, sunnyHp);
  close(water.hp, hp[2] + playerStats(water).maxHp * 0.02 * TICK);
});

test("沙隐只闪避沙暴中的攻击", () => {
  const w = field("geodude"),
    rock = w.players[0];
  rock.abilitySlot = "hidden";
  w.weather = { id: "sandstorm", from: 0, until: 10 };
  let evaded = 0;
  for (let i = 0; i < 50; i++) {
    rock.invulnerable = 0;
    if (!damagePlayer(w, rock, 1)) evaded++;
  }
  assert.ok(evaded > 0 && evaded < 50);
  w.weather.id = "rain";
  for (let i = 0; i < 50; i++) {
    rock.invulnerable = 0;
    assert.ok(damagePlayer(w, rock, 1));
  }
});

test("魔法防守不承受中毒和恶劣天气，仍会被直接击伤", () => {
  const w = field("abra"),
    psychic = w.players[0];
  psychic.abilitySlot = "hidden";
  apply(psychic, "poison", 5, 0, -1);
  w.weather = { id: "hail", from: 0, until: 5 };
  const before = psychic.hp;
  stepSharedWorld(w, []);
  close(psychic.hp, before);
  psychic.invulnerable = 0;
  assert.ok(damagePlayer(w, psychic, 10));
  close(psychic.hp, before - 10);
});

test("坚硬脑袋的图鉴描述显示各形态的接触减伤", () => {
  const reductions = ["geodude", "graveler", "golem"].map((form) => {
    const { entry } = codexEntry(formKey(form));
    const row = entry.blocks
      .find((block) => block.title === "特性")
      .rows.find(({ label }) => label.endsWith("坚硬脑袋"));
    const match = /^受到的敌人接触伤害 -(\d+)%$/.exec(row.value);
    assert.ok(match, `${form}: ${row.value}`);
    return Number(match[1]);
  });
  assert.ok(reductions[0] > 0 && reductions[0] < reductions[1] && reductions[1] < reductions[2]);
});

test("无防守能在本线招式原射程外即时命中；代价是本体承伤", () => {
  const w = field("machop"),
    p = w.players[0];
  p.level = 28;
  evolve(p);
  p.abilitySlot = 1;
  const ctx = { world: w, grid: new EnemyGrid() },
    enemy = target(ctx);
  enemy.x = p.x + 3.45;
  ctx.grid.rebuild(w.enemies);
  p.moves[0].cooldown = 0;
  updateMoves(ctx, p, TICK);
  updateAreas(ctx, TICK);
  assert.ok(enemy.hp < enemy.maxHp);
  assert.ok(w.events.some((e) => e.t === "cast" && e.move === "karate-chop" && e.windup === 0));
  p.invulnerable = 0;
  const before = p.hp;
  damagePlayer(w, p, 20);
  close(before - p.hp, 23);
});

test("避雷针改变电弹实际飞行方向，吸收后短时提高特殊招式伤害，静电不再触发", () => {
  const w = field("squirtle", "pikachu"),
    [ally, rod] = w.players;
  rod.abilitySlot = "hidden";
  for (const p of w.players) p.invulnerable = 0;
  const fx = (p) => currentStats(p).hit.special ?? 1;
  const baseline = fx(rod);
  const hp = w.players.map((p) => p.hp);
  // The bolt initially travels along -z toward the ally; the rod stands off to the side.
  Object.assign(rod, { x: ally.x + 2, z: ally.z + 2 });
  const bolt = addHazard(w, {
    kind: "thunder-shock",
    x: ally.x,
    z: ally.z + 4,
    y: heightAt(w.map.terrain, ally.x, ally.z + 4) + 0.5,
    vz: -7,
    radius: 0.18,
    dmg: 8,
    life: 1.3,
  });
  updateHazards(w, TICK);
  assert.ok(bolt.vx > 0 && fx(rod) === baseline);
  for (let i = 0; i < 30 && w.hazards.includes(bolt); i++) updateHazards(w, TICK);
  assert.ok(!w.hazards.includes(bolt));
  assert.deepEqual(
    w.players.map((p) => p.hp),
    hp,
  );
  close(fx(rod), baseline * 1.3);
  const ctx = { world: w, grid: new EnemyGrid() },
    enemy = target(ctx);
  const damage = enemy.hp;
  fire(ctx, rod, "tick", { dt: 5 });
  assert.equal(enemy.hp, damage);
  const restored = restoreWorld(w.map, snapshotWorld(w));
  const restoredRod = restored.players[1];
  close(fx(restoredRod), fx(rod));
  restoredRod.moves = [];
  for (let i = 0; i <= 6 / TICK; i++) stepSharedWorld(restored, []);
  close(fx(restoredRod), baseline);
});

test("电气球只强化皮卡丘的招式，不强化静电等额外伤害；携球成为雷丘后失效", () => {
  const ctx = { world: field("pikachu"), grid: new EnemyGrid() },
    p = ctx.world.players[0];
  const enemy = target(ctx);
  p.level = 54;
  evolve(p); // Mature Pikachu can still choose to keep its form.
  const strike = (move) => hit(ctx, p, enemy, "electric", move);
  const plain = strike("thunder-shock"),
    zap = strike(null);
  applyChoice(p, { kind: "item", item: "light-ball" });
  refreshStats();
  close(strike("thunder-shock"), plain * 1.5);
  close(strike(null), zap);
  applyChoice(p, { kind: "item", item: "thunder-stone" });
  evolve(p);
  assert.ok(p.items.some((item) => item.id === "light-ball"));
  close(strike("thunder-shock"), plain);
});

test("Inner Focus shrugs off a player's slow; Synchronize does not", () => {
  const world = createWorld({
    mode: "expedition",
    rules: [],
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [
      { trainer: "chengxi", starter: "abra" },
      { trainer: "chengxi", starter: "abra" },
    ],
  });
  const [focus, sync] = world.players;
  for (const p of world.players) p.stage = 1;
  focus.abilitySlot = 1;
  for (const p of world.players) {
    apply(p, "slow", 2, 0, -1);
    sustain(p, "slow", 2, -1);
  }
  assert.equal(
    focus.statuses.some((s) => s.id === "slow"),
    false,
  );
  assert.equal(
    sync.statuses.some((s) => s.id === "slow"),
    true,
  );
});

test("硬爪覆盖隐藏特性，只提高物理招式伤害；Ｙ的形态修正只提高特殊伤害", () => {
  for (const branch of ["x", "y"]) {
    const w = field("charmander"),
      p = w.players[0],
      ctx = { world: w, grid: new EnemyGrid() },
      e = target(ctx);
    Object.assign(p, { stage: 2, level: 55, abilitySlot: "hidden" });
    const physical = hit(ctx, p, e, "fire", "flare-blitz"),
      special = hit(ctx, p, e, "fire", "ember");
    const stone = `charizardite-${branch}`;
    applyChoice(p, { kind: "item", item: stone });
    tryMegaEvolution(w, p);
    assert.equal(currentAbility(p), branch === "x" ? "tough-claws" : "drought");

    close(hit(ctx, p, e, "fire", "flare-blitz"), physical * (branch === "x" ? 1.3 : 1));
    close(hit(ctx, p, e, "fire", "ember"), special * (branch === "y" ? 1.35 : 1));
  }
});

test("闪焰冲锋多条波同时命中多只目标，只支付一次非致死反作用", () => {
  const w = field("charmander"),
    p = w.players[0],
    ctx = { world: w, grid: new EnemyGrid() };
  const a = target(ctx),
    b = target(ctx);
  p.moves = [newMoveState("flare-blitz")];
  p.moves[0].mods.count = 1;
  for (const start of [100, 1.01]) {
    p.moves[0].cooldown = 0;
    p.hp = start;
    const before = a.hp + b.hp;
    updateMoves(ctx, p, TICK);
    assert.equal(w.projectiles.length, 2);
    assert.equal(p.hp, start);
    for (let i = 0; i < 35; i++) updateProjectiles(ctx, TICK);
    assert.ok(a.hp + b.hp < before);
    close(p.hp, Math.max(1, start - playerStats(p).maxHp * 0.002));
  }
});
