// Cross-engine determinism check (docs/research/DETERMINISM.md).
//   bun scripts/determinism/run.mjs [--engines bun,chrome,webkit] [--cases a,b|none] [--out dir]
//     [--allow-golden-mismatch]
// An engine listed twice with a suffix (`webkit,webkit#2`) runs in a fresh browser, to check that an
// engine agrees with itself.
//
// Freezes src/ into a snapshot, builds harness.mjs from it once with Bun into one ES module, then runs that same file in bun (the CLI
// runtime, JavaScriptCore), headless Chrome (V8) and Playwright WebKit (JavaScriptCore), and compares:
//   1. golden v2 digests per case (bun's must also equal scripts/golden.json),
//   2. bit-exact map-stage hashes for MAP_SEEDS,
//   3. sim/math.ts on a synthetic corpus, and the end digests of a probe build where `**` is lowered
//      to Math.pow (it also counts and hashes every native Math call the sim still makes).
// Exit 1 on any of those differences. Native Math outputs on the same corpus (plus the inputs the sim
// fed it, captured in bun) and the probe's call hashes are compared too, but only reported: engines
// differ there by design, which is why the sim uses sim/math.ts.
// No rAF anywhere: browsers run it from page.evaluate.
//
// Playwright is not a project dependency. Set PLAYWRIGHT_CORE to a playwright-core directory, or
// leave it unset to use the newest one in the npx cache. WEBKIT_PATH / CHROME_PATH override the
// browser binaries (defaults: the cached webkit-2359 build and the installed Google Chrome).
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { lowerPowers } from "./pow-probe.mjs";

const here = import.meta.dir;
const root = resolve(here, "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const OUT = resolve(arg("out", join(tmpdir(), "poketone-determinism")));
const ENGINES = arg("engines", "bun,chrome,webkit").split(",");
/** Frozen copy of src/ + golden, so every engine runs the same code even while src/ is being edited. */
const SNAP = join(OUT, "snapshot");
const MAP_SEEDS = [4242, 7, ...Array.from({ length: 62 }, (_, i) => i + 1)];
/** Cases run through the probe build to collect real sim inputs (one per starter + co-op + mortal). */
const PROBE_PREFIXES = [
  "solo/charmander/",
  "solo/bulbasaur/",
  "solo/squirtle/",
  "solo/pikachu/",
  "coop/",
  "mortal/",
  "stations/",
];

// ---------------------------------------------------------------------------------------------------
// Build: one natural bundle (what ships: `**` kept) and one probe bundle (`**` lowered to Math.pow).

async function bundle(name, probe) {
  const result = await Bun.build({
    entrypoints: [join(SNAP, "scripts/determinism/harness.mjs")],
    target: "browser",
    minify: false,
  });
  const code = await result.outputs[0].text();
  const output = join(OUT, `${name}.js`);
  await Bun.write(output, probe ? lowerPowers(code) : code);
  return output;
}

// ---------------------------------------------------------------------------------------------------
// Synthetic corpus: wide and edge-case inputs on top of the captured ones.

function synthetic() {
  let s = 0x9e3779b9;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = 20000;
  const many = (f) => Array.from({ length: n }, f);
  const angle = () => [(r() * 2 - 1) * (r() < 0.8 ? 7 : 1e4)];
  return {
    sin: many(angle),
    cos: many(angle),
    tan: many(angle),
    atan: many(() => [(r() * 2 - 1) * 50]),
    atan2: many(() => [(r() * 2 - 1) * 100, (r() * 2 - 1) * 100]),
    asin: many(() => [r() * 2 - 1]),
    acos: many(() => [r() * 2 - 1]),
    exp: many(() => [(r() * 2 - 1) * 30]),
    log: many(() => [r() * 1000]),
    hypot: many(() => [(r() * 2 - 1) * 100, (r() * 2 - 1) * 100]),
    cbrt: many(() => [(r() * 2 - 1) * 1000]),
    pow: many(() =>
      r() < 0.5 ? [r() * 3, Math.floor(r() * 12)] : [r() * 3, Math.round(r() * 400) / 100],
    ),
  };
}

// ---------------------------------------------------------------------------------------------------
// Engines. Each returns { cases, maps, corpus: { captured, synthetic, capturedHot, syntheticHot } }.

async function runAll(h, cases, corpora, log) {
  const out = { cases: {}, maps: null, corpus: {}, probe: null };
  const started = Date.now();
  out.probe = await h.probeRun(PROBE_CASES, MAP_SEEDS, 0);
  log(`  probe run (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  for (const name of cases) {
    const r = await h.runCase(name);
    out.cases[name] = r;
    log(`  ${name}  ${r.end}  (${(r.ms / 1000).toFixed(1)} s)`);
  }
  out.maps = await h.mapDigest(MAP_SEEDS);
  for (const [key, corpus] of Object.entries(corpora)) {
    out.corpus[key] = await h.evalCorpus(corpus);
    out.corpus[`${key}Hot`] = await h.evalCorpusHot(corpus);
  }
  return out;
}

async function bunEngine(natural, probe, cases, corpora) {
  const h = { ...(await import(pathToFileURL(natural).href)) };
  h.probeRun = (await import(pathToFileURL(probe).href)).probeRun;
  return runAll(h, cases, corpora, console.log);
}

function serve(dir) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      const path = join(dir, pathname === "/" ? "index.html" : pathname.slice(1));
      return existsSync(path) ? new Response(Bun.file(path)) : new Response(null, { status: 404 });
    },
  });
}

function playwrightCore() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
  const npx = join(homedir(), ".npm/_npx");
  const found = readdirSync(npx)
    .map((d) => join(npx, d, "node_modules/playwright-core"))
    .filter((d) => existsSync(d))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!found[0])
    throw new Error("determinism: set PLAYWRIGHT_CORE (no playwright-core in npx cache)");
  return found[0];
}

async function browserEngine(kind, url, cases, corpora) {
  const core = playwrightCore();
  const pw = await import(pathToFileURL(join(core, "index.mjs")).href);
  const executablePath =
    kind === "webkit"
      ? (process.env.WEBKIT_PATH ??
        join(homedir(), "Library/Caches/ms-playwright/webkit-2359/pw_run.sh"))
      : (process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  const browser = await (kind === "webkit" ? pw.webkit : pw.chromium).launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.harness || window.harnessError, null, {
      timeout: 30000,
    });
    const loadError = await page.evaluate(() => window.harnessError);
    if (loadError) throw new Error(`${kind}: harness failed to load: ${loadError}`);
    const version = await page.evaluate(() => navigator.userAgent);
    console.log(`  ${kind}: ${browser.version()} — ${version}`);
    const proxy = {
      runCase: (name) => page.evaluate((n) => window.harness.runCase(n), name),
      mapDigest: (seeds) => page.evaluate((s) => window.harness.mapDigest(s), seeds),
      evalCorpus: (c) => page.evaluate((x) => window.harness.evalCorpus(x), c),
      evalCorpusHot: (c) => page.evaluate((x) => window.harness.evalCorpusHot(x), c),
      probeRun: (names, seeds) =>
        page.evaluate(([n, s]) => window.probeHarness.probeRun(n, s), [names, seeds]),
    };
    const result = await runAll(proxy, cases, corpora, console.log);
    result.version = `${browser.version()} | ${version}`;
    if (errors.length) result.pageErrors = errors;
    return result;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------------
// Compare.

/** Native-Math corpus differences: engine facts, reported but not failures. */
const notes = {};

function compare(ref, other, label) {
  const diffs = [];
  for (const [name, r] of Object.entries(ref.cases)) {
    const o = other.cases[name];
    if (!o) continue;
    if (r.end !== o.end || r.samples !== o.samples) {
      const a = r.samples.split(" ");
      const b = o.samples.split(" ");
      const i = a.findIndex((d, k) => d !== b[k]);
      diffs.push(`case ${name}: ${label} differs (first sample ${i + 1}, tick ${(i + 1) * 300})`);
    }
  }
  for (const [seed, stages] of Object.entries(ref.maps))
    for (const [stage, digest] of Object.entries(stages))
      if (other.maps[seed]?.[stage] !== digest)
        diffs.push(`map seed ${seed} stage ${stage}: ${digest} vs ${other.maps[seed]?.[stage]}`);
  // Reported only: `**` lowered to Math.pow runs inside sort comparators, and how often an engine
  // calls a comparator is implementation-defined (the stable result is not). The probe build's end
  // digests below are the check.
  for (const [fn, r] of Object.entries(ref.probe.math)) {
    const o = other.probe.math[fn];
    if (!o || o.calls !== r.calls || o.hash !== r.hash)
      (notes[label] ??= []).push(
        `probe Math.${fn}: ${r.calls} calls ${r.hash} vs ${o?.calls} calls ${o?.hash}`,
      );
  }
  for (const [name, end] of Object.entries(ref.probe.ends))
    if (other.probe.ends[name] !== end)
      diffs.push(`probe build case ${name}: ${end} vs ${other.probe.ends[name]}`);
  for (const [set, fns] of Object.entries(ref.corpus))
    for (const [fn, outs] of Object.entries(fns)) {
      const theirs = other.corpus[set][fn];
      const bad = outs.flatMap((v, i) => (v === theirs[i] ? [] : [i]));
      if (!bad.length) continue;
      const line = `math ${set}/${fn}: ${bad.length}/${outs.length} outputs differ`;
      if (fn.startsWith("sim.") || fn.endsWith("#in")) diffs.push(line);
      else (notes[label] ??= []).push(line);
    }
  return diffs;
}

// ---------------------------------------------------------------------------------------------------

/**
 * Copies src/, golden.mjs/.json and this harness into SNAP and derives `scripts/golden-replay.mjs`
 * from the snapshot's golden.mjs: node:crypto swapped for the pure-JS SHA-256, `replay` and `CASES`
 * exported, the CLI tail dropped. Then checks the snapshot against golden.json in bun.
 */
function snapshot() {
  rmSync(SNAP, { recursive: true, force: true });
  cpSync(join(root, "src"), join(SNAP, "src"), { recursive: true });
  for (const file of ["golden.mjs", "golden.json"])
    cpSync(join(root, "scripts", file), join(SNAP, "scripts", file));
  for (const file of ["harness.mjs", "sha256.mjs"])
    cpSync(join(here, file), join(SNAP, "scripts/determinism", file));
  let golden = readFileSync(join(SNAP, "scripts/golden.mjs"), "utf8");
  const edit = (from, to) => {
    if (!golden.includes(from)) throw new Error(`determinism: golden.mjs no longer has ${from}`);
    golden = golden.replace(from, to);
  };
  edit('import { createHash } from "node:crypto";\n', "");
  edit('import { readFileSync, writeFileSync } from "node:fs";\n', "");
  edit(
    'const FILE = new URL("./golden.json", import.meta.url);',
    'import { createHash as sha256 } from "./determinism/sha256.mjs";\nconst createHash = () => sha256();',
  );
  edit("function replay(spec) {", "export function replay(spec, onTick) {");
  edit(
    "    world.events.length = 0;",
    "    if (onTick) onTick(world);\n    world.events.length = 0;",
  );
  golden = `${golden.slice(0, golden.indexOf("const clock = "))}export { CASES };\n`;
  writeFileSync(join(SNAP, "scripts/golden-replay.mjs"), golden);
  console.log("snapshot: bun run golden on the frozen copy");
  const run = Bun.spawnSync([process.execPath, "scripts/golden.mjs"], { cwd: SNAP });
  if (run.success) console.log(`  ${run.stdout.toString().trim().split("\n").at(-1)}`);
  else {
    console.log(
      `  ${(run.stdout.toString() || run.stderr.toString())
        .trim()
        .split("\n")
        .slice(-6)
        .join("\n  ")}`,
    );
    if (!process.argv.includes("--allow-golden-mismatch"))
      throw new Error(
        "determinism: the src/ snapshot does not pass golden; retry when src/ is consistent",
      );
  }
}

mkdirSync(OUT, { recursive: true });
snapshot();
console.log(`building into ${OUT}`);
const natural = await bundle("harness", false);
const probeFile = await bundle("harness-pow", true);
const lowered = !readFileSync(probeFile, "utf8")
  .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
  .replace("(a, b) => a ** b", "")
  .includes(" ** ");
writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>determinism</title><pre id="out">loading…</pre>
<script type="module">
Promise.all([import("./harness.js"), import("./harness-pow.js")]).then(
  ([h, p]) => { window.harness = h; window.probeHarness = p; out.textContent = "ready"; },
  (e) => { window.harnessError = String(e); out.textContent = String(e); });
</script>`,
);

const h = await import(pathToFileURL(natural).href);
const all = h.caseNames();
const PROBE_CASES = PROBE_PREFIXES.map((prefix) => {
  const name = all.find((candidate) => candidate.startsWith(prefix));
  if (!name) throw new Error(`determinism: no golden case for ${prefix}`);
  return name;
});
const casesArg = arg("cases", all.join(","));
const cases = casesArg === "none" ? [] : casesArg.split(",");
if (cases.length === 0) PROBE_CASES.length = 0;

// Capture the inputs the sim feeds the Math functions (bun, probe bundle).
console.log(`probing Math inputs (\`**\` lowered to Math.pow: ${lowered})`);
const p = await import(pathToFileURL(probeFile).href);
const captureRun = p.probeRun(PROBE_CASES, MAP_SEEDS, 40000);
const probeDigests = captureRun.ends;
const probed = captureRun.math;
for (const [fn, r] of Object.entries(probed))
  console.log(`  Math.${fn}: ${r.calls} calls, ${r.inputs.length} sampled inputs`);
const captured = Object.fromEntries(Object.entries(probed).map(([fn, r]) => [fn, r.inputs]));
const corpora = { captured: p.encodeCorpus(captured), synthetic: p.encodeCorpus(synthetic()) };

const results = {};
const server = serve(OUT);
const url = server.url.href;
try {
  for (const engine of ENGINES) {
    console.log(`${engine}:`);
    results[engine] =
      engine === "bun"
        ? await bunEngine(natural, probeFile, cases, corpora)
        : await browserEngine(engine.split("#")[0], url, cases, corpora);
  }
} finally {
  await server.stop();
}

let failed = false;
const golden = JSON.parse(readFileSync(join(SNAP, "scripts/golden.json"), "utf8"));
if (results.bun) {
  for (const [name, r] of Object.entries(results.bun.cases)) {
    const g = golden[name];
    if (!g || g.end !== r.end || g.samples !== r.samples) {
      console.log(`golden.json mismatch on bun for ${name} (stale copy or src changed)`);
      failed = true;
    }
    if (probeDigests[name] && probeDigests[name] !== r.end)
      console.log(`note: probe build (** → Math.pow) gives a different end digest for ${name}`);
  }
}
const ref = results[ENGINES[0]];
const allDiffs = {};
for (const engine of ENGINES.slice(1)) {
  const diffs = compare(ref, results[engine], engine);
  allDiffs[engine] = diffs;
  console.log(
    `${ENGINES[0]} vs ${engine}: ${diffs.length ? `${diffs.length} differences` : "identical"}`,
  );
  for (const d of diffs.slice(0, 40)) console.log(`  ${d}`);
  for (const n of notes[engine] ?? []) console.log(`  note (native Math, not a sim result): ${n}`);
  failed ||= diffs.length > 0;
}
const summary = Object.fromEntries(
  Object.entries(results).map(([engine, r]) => [
    engine,
    {
      version: r.version ?? `bun ${process.versions.bun}`,
      cases: Object.fromEntries(Object.entries(r.cases).map(([n, c]) => [n, c.end])),
      maps: r.maps,
      probe: r.probe,
    },
  ]),
);
writeFileSync(join(OUT, "results.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(OUT, "diffs.json"), `${JSON.stringify(allDiffs, null, 2)}\n`);
console.log(`results: ${join(OUT, "results.json")}, ${join(OUT, "diffs.json")}`);
process.exit(failed ? 1 : 0);
