// First diverging tick and function for one golden case, bun vs a browser.
//   bun scripts/determinism/bisect.mjs <case> [--engine webkit|chrome] [--ticks 18600] [--out dir]
// Reuses the bundles from the last `run.mjs` in the same --out dir (run that first).
// Tick N's Math hashes cover the calls made while stepping from N-1 to N (before the command loop of
// N+1). Only native Math calls are probed; sim/math.ts is plain arithmetic and not wrapped.
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const name = process.argv[2];
const OUT = resolve(arg("out", join(tmpdir(), "poketone-determinism")));
const engine = arg("engine", "webkit");
const maxTick = Number(arg("ticks", "18600"));
const probeFile = join(OUT, "harness-pow.js");
if (!name || !existsSync(probeFile)) throw new Error("usage: bisect.mjs <case>, after run.mjs");

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const { pathname } = new URL(req.url);
    const path = join(OUT, pathname === "/" ? "index.html" : pathname.slice(1));
    return existsSync(path) ? new Response(Bun.file(path)) : new Response(null, { status: 404 });
  },
});
const core = process.env.PLAYWRIGHT_CORE;
if (!core) throw new Error("bisect: set PLAYWRIGHT_CORE to a playwright-core directory");
const pw = await import(pathToFileURL(join(core, "index.mjs")).href);
const browser = await (engine === "webkit" ? pw.webkit : pw.chromium).launch({
  headless: true,
  executablePath:
    engine === "webkit"
      ? (process.env.WEBKIT_PATH ??
        join(homedir(), "Library/Caches/ms-playwright/webkit-2359/pw_run.sh"))
      : (process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
});
const page = await browser.newPage();
await page.goto(server.url.href);
await page.waitForFunction(() => window.probeHarness);
const run = (dumpTick) =>
  Promise.all([
    import(pathToFileURL(probeFile).href).then((p) => p.probeTicks(name, maxTick, dumpTick)),
    page.evaluate(
      ([n, t, d]) => window.probeHarness.probeTicks(n, t, d),
      [name, maxTick, dumpTick],
    ),
  ]);

const [a, b] = await run(-1);
const stateTick = a.ticks.findIndex((t, i) => t.state !== b.ticks[i]?.state);
/** First tick (from index `from`) where a function's output differs on equal inputs, or inputs differ. */
function firstMath(from) {
  for (let i = from; i < a.ticks.length; i++)
    for (const [fn, [inA, outA]] of Object.entries(a.ticks[i].math)) {
      const [inB, outB] = b.ticks[i].math[fn] ?? [];
      if (inA !== inB || outA !== outB)
        return { index: i, tick: a.ticks[i].tick, fn, inputsDiffer: inA !== inB };
    }
  return null;
}
// Index 0 also holds createWorld's mapgen calls; report the first sim-step difference separately.
const culprits = [firstMath(0), firstMath(1)].filter(Boolean);
console.log(`${name}: bun vs ${engine}, ${a.ticks.length} ticks`);
console.log(
  stateTick < 0
    ? "  state identical at full precision on every tick"
    : `  first full-precision state difference: tick ${a.ticks[stateTick].tick}`,
);
for (const culprit of culprits) {
  console.log(
    `  first Math difference${culprit.index === 0 ? " (createWorld, incl. mapgen)" : " in a step"}: tick ${culprit.tick}${culprit.inputsDiffer ? ` (Math.${culprit.fn} inputs already differ)` : ""}`,
  );
  if (culprit.inputsDiffer) continue;
  const [da, db] = await run(culprit.index === 0 ? 0 : a.ticks[culprit.index - 1].tick);
  // The first differing call per caller (up to 6 callers), in call order.
  const callers = new Map();
  da.dump.forEach((entry, i) => {
    const key = entry.at?.replace(/:\d+\)?$/, "");
    if (entry.call !== db.dump[i]?.call && !callers.has(key) && callers.size < 6)
      callers.set(key, { i, a: entry, b: db.dump[i] });
  });
  for (const { i, a: x, b: y } of callers.values())
    console.log(
      `    call #${i} from ${x.at}\n      bun    ${x.call}\n      ${engine.padEnd(6)} ${y.call}`,
    );
}
if (culprits.length === 0) console.log("  no Math difference");
await browser.close();
await server.stop();
