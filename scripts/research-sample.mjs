// Reproducible sample over every expedition route (ALL_ROUTES) × seeds, averaged per run. Refill HP and
// finish each guardian after 9:30 so each route samples the late rosters too. All encounters and kills are simulated.
import { createWorld, stepWorld } from "../src/run/sim/world.ts";
import { enterZone, prepareZone } from "../src/run/sim/zones.ts";
import { killEnemy } from "../src/run/sim/combat.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { playerStats } from "../src/run/sim/stats.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { researchOf } from "../src/run/research.ts";
import { ALL_ROUTES } from "../src/run/sim/content/campaign.ts";
import { researchClass } from "../src/run/sim/content/dex-research.ts";

const seeds = [5, 11, 23];
const starters = ["pikachu", "charmander", "squirtle"];
const total = {};
let runs = 0;
function sample(route, seed, starter) {
  const w = createWorld({
    mode: "expedition",
    stage: route[0],
    difficulty: 0,
    rules: [],
    unlocks: [],
    seed,
    players: [{ trainer: "chengxi", starter, shiny: false, unlocks: [] }],
  });
  const p = w.players[0];
  for (let frame = 0; w.outcome === "playing"; frame++) {
    if (frame > 100000) throw new Error(`采样未结束：${w.stage} tick ${w.tick}`);
    p.hp = playerStats(p).maxHp;
    const cmds = [{ t: "move", player: 0, x: Math.cos(w.tick / 120), z: Math.sin(w.tick / 170) }];
    if (p.pending.length) {
      const { id, options } = p.pending[0];
      const index = options.findIndex((c) => c.kind === "move" || c.kind === "upgrade");
      cmds.push({ t: "pick", player: 0, card: id, index: Math.max(0, index) });
    } else if (w.zone.phase === "cleared" || (w.zone.tick >= 510 * 30 && w.bossId === null)) {
      const spot =
        w.zone.phase === "cleared"
          ? w.zone.exits.find((e) => e.to === (route[w.route.length] ?? null))
          : w.map.pads.find((p) => p.tag === "landmark");
      p.x = p.px = spot.x;
      p.z = p.pz = spot.z;
      cmds.push({ t: "interact", player: 0 });
    } else if (w.zone.tick >= 570 * 30 && w.bossId !== null) {
      killEnemy(
        { world: w, grid: new EnemyGrid() },
        w.enemies.find((e) => e.id === w.bossId),
        p,
      );
    }
    if (w.tick % 30 === 0) cmds.push({ t: "ult", player: 0 });
    stepWorld(w, cmds);
    if (w.zone.phase === "transitioning") enterZone(w, prepareZone(w));
    w.events.length = 0;
  }
  console.error(
    `${starter} seed=${seed} ${w.route.join("/")} ${w.outcome} time=${w.time.toFixed(1)}s`,
  );
  for (const [id, c] of Object.entries(p.dex)) {
    const t = (total[id] ??= { seen: 0, defeated: 0, shiny: 0 });
    t.seen += c.seen;
    t.defeated += c.defeated;
    t.shiny += c.shiny;
  }
  runs++;
}
seeds.forEach((seed, i) => {
  for (const route of ALL_ROUTES) sample(route, seed, starters[i % starters.length]);
});

function projectedRuns(id, perRun) {
  if (!perRun.defeated || !perRun.seen) return 0;
  let n = 0;
  do n++;
  while (
    n < 1000 &&
    !researchOf({ [id]: { seen: perRun.seen * n, defeated: perRun.defeated * n, shiny: 0 } }, id)
      .done
  );
  return n;
}
console.log(
  `difficulty=0 ${runs} runs (${ALL_ROUTES.length} routes × seeds ${seeds.join("/")}), per-run averages`,
);
console.log("species,class,seen,defeated,projectedRunsWithoutShiny");
const byClass = {};
let ordinary = 0,
  seenOrdinary = 0,
  inTarget = 0,
  maxOrdinary = 0,
  minOrdinary = Infinity;
for (const id of Object.keys(enemies)) {
  const t = total[id] ?? { seen: 0, defeated: 0 };
  const perRun = { seen: t.seen / runs, defeated: t.defeated / runs };
  const n = projectedRuns(id, perRun);
  const category = researchClass(id);
  (byClass[category] ??= []).push(n);
  if (category === "ordinary") {
    ordinary++;
    if (n) {
      seenOrdinary++;
      if (n >= 5 && n <= 10) inTarget++;
      maxOrdinary = Math.max(maxOrdinary, n);
      minOrdinary = Math.min(minOrdinary, n);
    }
  }
  console.log(
    [id, category, perRun.seen.toFixed(2), perRun.defeated.toFixed(2), n || "-"].join(","),
  );
}
for (const [category, list] of Object.entries(byClass)) {
  const seen = list.filter(Boolean);
  console.log(
    `${category}: 遇见 ${seen.length}/${list.length}，局数 ${Math.min(...seen)}–${Math.max(...seen)}`,
  );
}
console.log(
  `普通物种 ${ordinary}；遇见 ${seenOrdinary}；5–10 局完成 ${inTarget}（${((inTarget / seenOrdinary) * 100).toFixed(1)}%）；最少 ${minOrdinary} 最多 ${maxOrdinary}`,
);
