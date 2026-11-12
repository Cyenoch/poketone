import assert from "node:assert/strict";
import test from "node:test";
import { labBonuses } from "../src/run/lab.ts";
import { statIds } from "../src/run/sim/content/effects.ts";
import { evolve } from "../src/run/sim/evolution.ts";
import { areaGrowth, playerStats, statBreakdown, xpForLevel } from "../src/run/sim/stats.ts";
import { ultRate } from "../src/run/sim/ultimates/index.ts";
import { createPlayer } from "../src/run/sim/world.ts";

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
