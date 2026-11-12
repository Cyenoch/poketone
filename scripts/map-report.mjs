// Headless map seed report (docs/MAPGEN.md 种子报告): builds worlds through the real generator and
// world assembly (final acceptance included) and summarises failures per stage and reason.
//   bun scripts/map-report.mjs [count=200] [stages=forest,desert] [players=2]
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { MapGenError } from "../src/run/sim/mapgen/index.ts";
import { createWorld } from "../src/run/sim/world.ts";
import { createHash } from "node:crypto";

const count = Number(process.argv[2] ?? 200);
const stages = (process.argv[3] ?? Object.keys(stageDefs).join(",")).split(",");
const players = Array.from({ length: Number(process.argv[4] ?? 2) }, () => ({
  starter: "pikachu",
}));

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

for (const stage of stages) {
  const failures = new Map();
  const times = [];
  const templates = new Map();
  const digest = createHash("sha256");
  for (let k = 1; k <= count; k++) {
    const seed = k * 7919;
    const start = performance.now();
    try {
      const world = createWorld({ stage, seed, difficulty: 0, players });
      digest.update(Buffer.from(world.map.terrain.heights.buffer));
      digest.update(Buffer.from(world.map.water.depth.values.buffer));
      digest.update(JSON.stringify([world.map.pads, world.map.water.puddles, world.map.obstacles]));
      const walls = world.map.terrain.walls;
      if (walls) {
        digest.update(walls.template);
        digest.update(Buffer.from(walls.heights.buffer));
        digest.update(Buffer.from(walls.kinds.buffer));
        templates.set(walls.template, (templates.get(walls.template) ?? 0) + 1);
      }
      times.push(performance.now() - start);
    } catch (error) {
      if (!(error instanceof MapGenError)) throw error;
      // Group by the broken requirement: the message without its numbers.
      const reason = error.message.replace(/-?\d+(\.\d+)?/g, "#");
      const seeds = failures.get(reason) ?? [];
      seeds.push(seed);
      failures.set(reason, seeds);
    }
  }
  times.sort((a, b) => a - b);
  const failed = count - times.length;
  console.log(
    `${stage}: ${times.length}/${count} accepted, ${failed} rejected; createWorld ` +
      `p50 ${percentile(times, 0.5)?.toFixed(1)} ms, p95 ${percentile(times, 0.95)?.toFixed(1)} ms`,
  );
  for (const [reason, seeds] of failures)
    console.log(`  ${seeds.length} × ${reason}  e.g. ${seeds.slice(0, 5).join(", ")}`);
  if (templates.size) console.log(`  templates: ${JSON.stringify(Object.fromEntries(templates))}`);
  console.log(
    `  terrain/water/pads/props${templates.size ? "/walls" : ""} sha256 ${digest.digest("hex")}`,
  );
}
