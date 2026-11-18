import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceDeepForm,
  castWindow,
  deepStats,
  equipDeepBuild,
  pledgePair,
} from "../src/run/balance/deep-builds.ts";
import { buildOutput, fieldAt, runModel, targetFor } from "../src/run/balance/model.ts";
import { average } from "../src/run/balance/skill.ts";
import { formOf } from "../src/run/sim/evolution.ts";
import { canEvolve, currentAbility } from "../src/run/sim/stats.ts";
import { itemSlots, learnable, moveSlots } from "../src/run/sim/upgrades.ts";
import { createPlayer } from "../src/run/sim/world.ts";

function build(starter, options) {
  const player = createPlayer(0, starter, 0);
  equipDeepBuild(player, options);
  return player;
}
const target = targetFor(fieldAt(0, "forest", 300, 0, false), 20, average);

test("留形继续使用进化奇石，进化招式仍随形态开放", () => {
  const held = build("bulbasaur", { form: "everstone-eviolite" });
  const normal = build("bulbasaur", {});
  for (const player of [normal, held]) {
    player.level = 60;
    advanceDeepForm(player);
  }
  assert.equal(formOf(normal).id, "venusaur");
  assert.equal(formOf(held).id, "bulbasaur");
  assert.ok(canEvolve(held));
  const stone = deepStats(held, null);
  const freeSlots = itemSlots(held) - held.items.length;
  assert.equal(freeSlots, itemSlots(normal) - 2);
  assert.ok(learnable(normal).length > learnable(held).length);
  held.items = [];
  const bare = deepStats(held, null);
  assert.ok(stone.maxHp > bare.maxHp && stone.armor > bare.armor);
});

test("电气球只加皮卡丘招式；雷之石触发效果在进化后保留", () => {
  const ball = build("pikachu", { form: "light-ball" });
  const bare = build("pikachu", { form: "pikachu" });
  for (const player of [ball, bare]) {
    player.level = 60;
    advanceDeepForm(player);
  }
  const moveDps = (p) => buildOutput(p, target).perMove[0].out.single;
  assert.equal(formOf(ball).id, "pikachu");
  assert.ok(moveDps(ball) > moveDps(bare));
  for (const player of [ball, bare]) {
    player.items.push({ id: "thunder-stone", level: 1 });
    advanceDeepForm(player);
  }
  assert.equal(formOf(ball).id, "raichu");
  assert.equal(moveDps(ball), moveDps(bare));
  assert.ok(deepStats(ball, null).triggers.some((t) => t.key.startsWith("item:thunder-stone")));
});

test("通信延迟从达标秒开始；未获经验也能换形并切换当前特性", () => {
  const player = build("gastly", { tradeDelay: 120 });
  player.level = 80;
  player.projection.time = 800;
  advanceDeepForm(player);
  assert.equal(formOf(player).id, "haunter");
  assert.equal(currentAbility(player), "levitate");
  player.projection.time = 919;
  advanceDeepForm(player);
  assert.equal(formOf(player).id, "haunter");
  player.hp = 10;
  player.projection.time = 920;
  advanceDeepForm(player);
  assert.equal(formOf(player).id, "gengar");
  assert.equal(currentAbility(player), "cursed-body");
  assert.ok(player.hp > 10 && player.hp < deepStats(player, null).maxHp);
});

test("联系绳在达标进化时消费；没有联系绳不能靠到达等级换形", () => {
  const player = build("gastly", {});
  player.level = 80;
  advanceDeepForm(player);
  assert.equal(formOf(player).id, "haunter");
  const before = player.items.length;
  player.items.push({ id: "linking-cord", level: 1 });
  advanceDeepForm(player);
  assert.equal(formOf(player).id, "gengar");
  assert.equal(player.items.length, before);
});

test("单人通信线达标后可用守卫奖杯进化，再带最终形态进入下一图", () => {
  const run = runModel({
    starter: "geodude",
    difficulty: 0,
    route: ["forest", "desert", "glacier", "tower"],
    fieldEvents: false,
    skill: average,
    samples: 1,
    seed: 0x5eed + 7919,
    summonSeconds: [510, 510, 510, 510],
    deepBuild: { slot: 0 },
  });
  const [trade] = run.tradeWait;
  const [evolution] = run.evolutions.at(-1).points;
  assert.ok(trade?.eligibleAt < run.zoneClears[2].t);
  assert.equal(trade.evolvedAt, run.zoneClears[2].t);
  assert.equal(evolution.step, 2);
  assert.ok(run.zoneClears[3].reach > 0);
});

test("普通第二特性从首次换形开放，替换原特性的修正和触发", () => {
  const fighter = build("machop", { slot: 1 });
  assert.equal(currentAbility(fighter), "guts");
  fighter.level = 40;
  advanceDeepForm(fighter);
  const normal = build("machop", {});
  normal.level = 40;
  advanceDeepForm(normal);
  assert.ok(deepStats(fighter, null).damageTaken > deepStats(normal, null).damageTaken);
  assert.ok(deepStats(fighter, null).armor < deepStats(normal, null).armor);
  assert.throws(() => build("gastly", { slot: "hidden" }), /特性栏位/);
  assert.ok(
    deepStats(build("pikachu", { slot: "hidden" }), null).triggers.every(
      (t) => !t.key.startsWith("ability:static"),
    ),
  );
});

test("中途学得天气不能回溯覆盖；岩石只延长装备后的施放", () => {
  const rain = { weather: "rain" };
  assert.equal(castWindow(rain, 11, 24, 12), null);
  assert.ok(castWindow(rain, 48, 24, 12).until <= 48);
  assert.ok(castWindow(rain, 88, 24, 12).until > 88);
});

test("天气招式占用招式栏，岩石延长本席施放，隐藏特性读取当前天气", () => {
  const dry = build("bulbasaur", {});
  const sun = build("bulbasaur", { slot: "hidden", weather: "sun", weatherUptime: 0.5 });
  const rock = build("bulbasaur", { ...sun.projection.build, weatherRock: true });
  assert.equal(moveSlots(sun) - sun.moves.length, moveSlots(dry) - dry.moves.length - 1);
  assert.equal(itemSlots(rock) - rock.items.length, itemSlots(sun) - sun.items.length - 1);
  assert.equal(deepStats(sun, null).speed, deepStats(sun, "rain").speed);
  assert.ok(deepStats(sun, "sun").speed > deepStats(sun, "rain").speed);
  const during = (p, t) => t < castWindow(p.projection.build, t).until;
  assert.equal(during(sun, 25), false);
  assert.equal(during(rock, 25), true);
  assert.throws(() => build("abra", { weather: "rain" }), /天气配置/);
});

test("单人誓约提供柱伤和状态；第二席的组合预算不进入单人逐图结果", () => {
  const solo = build("charmander", { pledge: true });
  const plain = build("charmander", {});
  const out = buildOutput(solo, target);
  assert.equal(out.perMove.filter((entry) => entry.move === "fire-pledge").length, 1);
  assert.ok(out.single > buildOutput(plain, target).single);
  assert.ok(out.bossBurnRate > buildOutput(plain, target).bossBurnRate);
  assert.equal(moveSlots(solo) - solo.moves.length, moveSlots(plain) - plain.moves.length - 1);
  const options = {
    starter: "charmander",
    difficulty: 0,
    stage: "forest",
    step: 0,
    skill: average,
    samples: 1,
  };
  const one = runModel({ ...options, deepBuild: { pledge: true } });
  const pair = runModel({ ...options, deepBuild: { pledge: true, pledgePartner: "bulbasaur" } });
  assert.equal(one.pledgePair, null);
  assert.deepEqual(pair.outcome, one.outcome);
  assert.deepEqual(pair.buildFields, one.buildFields);
  assert.ok(pair.pledgePair.burnDpsPerTarget > 0);
  assert.ok(pledgePair(["charmander", "squirtle"]).statusChanceFactor > 1);
  assert.ok(pledgePair(["bulbasaur", "squirtle"]).enemySpeedFactor < 1);
  assert.equal(pledgePair(["squirtle", "squirtle"]), null);
  assert.equal(pledgePair(["charmander", "bulbasaur"], 0).uptime, 0);
});

test("四图结果使用实际换形秒，延迟期间维持中间形态并计入通关概率", () => {
  const options = {
    starter: "abra",
    difficulty: 0,
    route: ["forest", "desert", "glacier", "tower"],
    skill: average,
    samples: 1,
    // Bring the gate inside the observed run independently of late-map card luck.
    lab: { modifiers: [{ stat: "xp", op: "mul", value: 4, source: { kind: "lab" } }], rules: {} },
  };
  const immediate = runModel({ ...options, deepBuild: { tradeDelay: 0 } });
  const delayed = runModel({ ...options, deepBuild: { tradeDelay: 120 } });
  const [now] = immediate.tradeWait;
  const [later] = delayed.tradeWait;
  assert.ok(now && later, "sample must reach the level gate in both runs");
  assert.equal(later.eligibleAt, now.eligibleAt);
  assert.equal(later.evolvedAt, now.evolvedAt + 120);
  assert.equal(delayed.evolutions.at(-1).points[0].t, later.evolvedAt);
  assert.deepEqual(
    delayed.buildFields.map((f) => f.stage),
    options.route,
  );
  assert.equal(delayed.outcome.clear, delayed.zoneClears.at(-1).clear);
  assert.ok(delayed.buildFields[0].survivalSeconds > 0);
});

test("太阳之力的晴天耗血进入本席生存估算，与野外天气收支独立", () => {
  const options = {
    starter: "charmander",
    difficulty: 0,
    stage: "forest",
    step: 0,
    skill: average,
    samples: 1,
    fieldEvents: false,
  };
  const sun = { slot: "hidden", weather: "sun", weatherRock: true };
  const paid = runModel({ ...options, deepBuild: sun });
  const free = runModel({ ...options, deepBuild: { ...sun, solarCost: 0 } });
  assert.ok(paid.buildFields[0].solarHpCost > 0);
  assert.equal(paid.fieldEvents[0].income.weatherHpCost, 0);
  assert.ok(paid.outcome.meanSurvival < free.outcome.meanSurvival);
  assert.ok(paid.outcome.clear > 0, "持续大晴天下仍能到达并击败森林守卫");
});
