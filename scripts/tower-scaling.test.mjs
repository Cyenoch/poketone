import assert from "node:assert/strict";
import test from "node:test";
import { WEAVE } from "../src/run/sim/content/params/enemy-motion.ts";
import {
  PHASE_FOLD,
  TOWER,
  towerClock,
  towerFactorsFor,
} from "../src/run/sim/content/params/tower.ts";
import { zoneClock, zoneFactorsFor } from "../src/run/sim/content/params/zones.ts";
import { statuses } from "../src/run/sim/content/statuses.ts";
import { cos, sin } from "../src/run/sim/math.ts";
import { enemyMoves } from "../src/run/sim/movement.ts";
import { apply, slowed } from "../src/run/sim/status.ts";

const stage = { id: "forest" };
const near = (actual, expected, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `预期 ${actual} 接近 ${expected}`);

test("第 50 层继续增长，深层敌人的倍率保持有限且不倒扣经验", () => {
  const prior = zoneFactorsFor(2, stage, 0);
  const last = zoneFactorsFor(3, stage, 0);
  const floor50 = towerFactorsFor(50, stage);
  for (const key of ["hp", "dmg", "guardianHp"])
    near(floor50[key], last[key] + 4 * (last[key] - prior[key]) * TOWER.slope[key]);
  assert.equal(floor50.xp, last.xp);

  for (const floor of [100, Number.MAX_SAFE_INTEGER]) {
    const factors = towerFactorsFor(floor, stage);
    assert.ok(Object.values(factors).every(Number.isFinite), `第 ${floor} 层倍率不再有限`);
    assert.ok(factors.hp > floor50.hp && factors.dmg > floor50.dmg);
    const clock = towerClock(floor, TOWER.floorSeconds);
    assert.ok(Number.isFinite(clock) && clock > 0, `第 ${floor} 层成长时钟无效`);
    assert.equal(factors.xp, last.xp);
  }
});

test("第 50 层的入图时钟沿用升温与末段斜率", () => {
  for (const time of [0, 4, TOWER.floorSeconds]) {
    const last = zoneClock(3, time);
    near(towerClock(50, time), last + 4 * (last - zoneClock(2, time)) * TOWER.slope.clock);
  }
});

function weaveAt(time, id) {
  const heading = { x: 1, z: 0 };
  enemyMoves.weave({ time }, { id }, heading);
  return heading;
}

const id = 400_000;
const paralysis = statuses.paralysis.move;
const paralyzed = { statuses: [] };
apply(paralyzed, "paralysis", 1, 0, 0);

test("周期输入在安全阈值及以下保留原有走位结果", () => {
  for (const phase of [PHASE_FOLD - 1, PHASE_FOLD]) {
    const time = (phase - id * WEAVE.phasePerId) / WEAVE.rate;
    const angle = WEAVE.amplitude * sin(phase);
    assert.deepEqual(weaveAt(time, id), { x: cos(angle), z: sin(angle) });
    assert.equal(
      slowed(paralyzed, 1, (phase - id) / paralysis.rate, id),
      sin(phase) > paralysis.above ? 0 : paralysis.factor,
    );
  }
});

test("超长对局的麻痹停顿与蛇形追踪仍按周期运行", () => {
  const turns = 1_048_576 * (2 * Math.PI);
  for (const remainder of [0.1, 0.9]) {
    const phase = turns + remainder;
    const heading = weaveAt((phase - id * WEAVE.phasePerId) / WEAVE.rate, id);
    const expected = weaveAt(remainder / WEAVE.rate, 0);
    near(heading.x, expected.x, 1e-8);
    near(heading.z, expected.z, 1e-8);
    assert.equal(
      slowed(paralyzed, 1, (phase - id) / paralysis.rate, id),
      slowed(paralyzed, 1, remainder / paralysis.rate, 0),
    );
  }
});
