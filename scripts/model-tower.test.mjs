import assert from "node:assert/strict";
import test from "node:test";
import { runTowerModel } from "../src/run/balance/model.ts";
import { expert } from "../src/run/balance/skill.ts";
import { towerFields, towerRoute } from "../src/run/balance/tower.ts";
import { TOWER } from "../src/run/sim/content/params/tower.ts";
import { zoneClock, zoneFactorsFor } from "../src/run/sim/content/params/zones.ts";

const full = { hp: 1, dmg: 1, xp: 1, guardianHp: 1, clock: 1 };
const stage = "forest";
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10);

test("tower fields keep their seeded stages across pressure candidates and never repeat neighbors", () => {
  const stages = (seed, slope) => towerFields(seed, slope).map((floor) => floor.stage);
  const first = stages(42, full);
  assert.deepEqual(stages(42, { ...full, hp: 0 }), first);
  assert.notDeepEqual(stages(43, full), first);
  assert.equal(new Set(first).size, 6);
  assert.ok(first.every((id, index) => id !== first[index - 1]));
});

test("tower route interpolates swarm, guardian and entry-clock factors at fractional positions", () => {
  const start = zoneFactorsFor(0, { id: stage }, 0);
  const next = zoneFactorsFor(1, { id: stage }, 0);
  const floor = towerRoute(4, stage, full);
  for (const key of ["hp", "dmg", "xp", "guardianHp"])
    near(floor.factors[key], start[key] + ((next[key] - start[key]) * 3) / 7);
  for (const time of [0, 4, 12])
    near(
      floor.clock(time),
      zoneClock(0, time) + ((zoneClock(1, time) - zoneClock(0, time)) * 3) / 7,
    );
  assert.deepEqual(towerRoute(22, stage, full).factors, zoneFactorsFor(3, { id: stage }, 0));
});

test("tower checkpoints add only guardian bonuses and carry the last route slope through floor 50", () => {
  const factors = (floor, slope = full) => towerRoute(floor, stage, slope).factors;
  const fields = towerFields(42, full);
  assert.equal(fields.length, 50);
  assert.deepEqual(
    fields.flatMap((field, index) => (field.guardian ? [index + 1] : [])),
    [7, 14, 21, 28, 35, 42, 49],
  );
  const final = factors(50, { ...full, hp: 0.5, xp: 0 });
  const last = zoneFactorsFor(3, { id: stage }, 0);
  const prior = zoneFactorsFor(2, { id: stage }, 0);
  near(final.hp, last.hp + (last.hp - prior.hp) * 2);
  near(final.dmg, last.dmg + (last.dmg - prior.dmg) * 4);
  near(final.xp, last.xp);
  near(
    factors(49).guardianHp,
    (last.guardianHp + (last.guardianHp - prior.guardianHp) * (27 / 7)) *
      TOWER.guardianBonus *
      TOWER.guardianHealthBonus,
  );
  near(factors(49).guardianDmg, last.guardianDmg * TOWER.guardianBonus);
  near(factors(49).dmg, last.dmg + (last.dmg - prior.dmg) * (27 / 7));
  assert.ok(Object.values(final).every(Number.isFinite));
  assert.ok(factors(50).hp > factors(49).hp);
});

test("对战塔分析从计时层带着构筑打过守卫，紫苑塔地图不会结束整局", () => {
  const options = {
    starter: "bulbasaur",
    difficulty: 0,
    skill: expert,
    seed: 0x5eed,
    samples: 1,
    slope: TOWER.slope,
  };
  const floors = runTowerModel(options);
  const [first] = floors;
  const guardian = floors[TOWER.guardianInterval - 1];
  const next = floors[TOWER.guardianInterval];
  assert.equal(floors.length, 50);
  near(first.clearSeconds, TOWER.floorSeconds);
  assert.equal(first.fight, null);
  assert.ok(guardian.fight?.completed > 0);
  near(guardian.clearSeconds, guardian.fight.seconds);
  near(next.reach, guardian.clear);
  assert.ok(next.level > first.level);
  const shion = floors.findIndex((floor) => floor.stage === "tower" && floor.clear > 0);
  assert.ok(shion >= 0 && floors[shion + 1]?.reach > 0);
  assert.deepEqual(runTowerModel(options), floors);
});

test("含糊的 tower CLI 参数明确指向对战塔入口", () => {
  const result = Bun.spawnSync(
    [process.execPath, "scripts/balance-model.ts", "0", "none", "tower", "--json"],
    {
      cwd: new URL("..", import.meta.url).pathname,
    },
  );
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr.toString(), /balance:tower.*tower 3/u);
  assert.equal(result.stdout.toString(), "");
});
