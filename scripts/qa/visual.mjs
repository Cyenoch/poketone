// Visual QA suite for the GPU UI (docs/README.md, 可视QA). Drives the named screens in a real-GPU
// headless Chrome, judges the known defect classes, writes screenshots, contact sheets,
// results.json and summary.md, and exits 1 when a blocking check fails.
//
//   bun run qa:visual --screens pause,stats            # daily: the screens your change touches
//   bun run qa:visual                                  # smoke: the lobby only
//   bun run qa:visual --preset final                   # lead, final integration: every screen + specials
//
//   [--screens <list>|all] [--with lifecycle,perf,first-screen] [--matrix full | --configs <list>]
//   [--out dir] [--url http://…/] [--prod-url http://…/] [--live] [--idle-ms 2000] [--full-res]
//
// Configs default to two (desktop 1280×800 @100, phone 844×390 @100); `--matrix full` runs all 13.
// The special checks (lifecycle, perf = frame time, first-screen = production build) run only when
// asked for with --with. Lists may be comma- or space-separated, quoted or not (zsh-safe).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIGS,
  FINAL_CONFIGS,
  PROBE_CONFIGS,
  SCREENS,
  SMOKE_SCREENS,
  SPECIALS,
} from "./config.mjs";
import { judge } from "./lib/checks.mjs";
import {
  buildAndPreview,
  cleanup,
  launchChrome,
  onCleanup,
  removeStaleWork,
  snapshot,
  startDev,
  waitHttp,
} from "./lib/env.mjs";
import { openConfig, waitLobby } from "./lib/page.mjs";
import { contactSheets, label, writeReport } from "./lib/report.mjs";
import { walk } from "./lib/screens.mjs";
import { firstScreen, frameTime, lifecycle } from "./lib/special.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const opts = {};
  let key = null;
  for (const raw of argv) {
    if (raw.startsWith("--")) {
      const [k, v] = raw.slice(2).split(/=(.*)/s);
      key = k;
      opts[key] ??= [];
      if (v !== undefined) opts[key].push(v);
      continue;
    }
    if (!key) throw new Error(`qa: unexpected argument "${raw}"`);
    opts[key].push(raw);
  }
  const list = (k) => (opts[k] ?? []).flatMap((s) => s.split(/[\s,]+/)).filter(Boolean);
  const one = (k) => list(k)[0];
  const flag = (k) => k in opts;
  return { list, one, flag, keys: Object.keys(opts) };
}

const KNOWN = [
  "matrix",
  "configs",
  "screens",
  "out",
  "url",
  "prod-url",
  "live",
  "with",
  "preset",
  "idle-ms",
  "full-res",
  "help",
];

function resolveConfigs(names, matrix, preset) {
  if (matrix && matrix !== "full")
    throw new Error(`qa: unknown --matrix "${matrix}" (only "full")`);
  if (matrix === "full" || names.includes("all")) return CONFIGS;
  if (!names.length)
    return CONFIGS.filter((c) => (preset ? FINAL_CONFIGS : PROBE_CONFIGS).includes(c.name));
  const picked = new Set();
  for (const n of names) {
    const hit = CONFIGS.filter((c) => c.name === n || c.kind === n || c.name.includes(n));
    if (!hit.length)
      throw new Error(`qa: unknown config "${n}"; known: ${CONFIGS.map((c) => c.name).join(", ")}`);
    for (const c of hit) picked.add(c);
  }
  return CONFIGS.filter((c) => picked.has(c));
}

function resolveScreens(names, preset) {
  if (names.includes("all") || (!names.length && preset)) return SCREENS;
  if (!names.length) {
    console.log(
      `qa: no --screens given: smoke run (${SMOKE_SCREENS.join(", ")}). Name the screens your change touches:\n` +
        `qa:   --screens ${SCREENS.join(",")}  (or all)`,
    );
    return SMOKE_SCREENS;
  }
  for (const n of names)
    if (!SCREENS.includes(n))
      throw new Error(`qa: unknown screen "${n}"; known: ${SCREENS.join(", ")}`);
  return names;
}

function resolveSpecials(names, preset) {
  if (names.includes("all") || (!names.length && preset)) return new Set(SPECIALS);
  for (const n of names)
    if (!SPECIALS.includes(n))
      throw new Error(`qa: unknown --with "${n}"; known: ${SPECIALS.join(", ")}`);
  return new Set(names);
}

function treeId() {
  try {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root })
      .toString()
      .trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root })
      .toString()
      .split("\n")
      .filter(Boolean).length;
    return `${head}${dirty ? ` + ${dirty} uncommitted paths` : ""}`;
  } catch {
    return "unknown";
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flag("help")) {
    console.log(readmeHint);
    return 0;
  }
  for (const k of args.keys) if (!KNOWN.includes(k)) throw new Error(`qa: unknown option --${k}`);
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const preset = args.one("preset");
  if (preset && preset !== "final")
    throw new Error(`qa: unknown --preset "${preset}" (only "final")`);
  const configs = resolveConfigs(args.list("configs"), args.one("matrix"), preset);
  const screens = resolveScreens(args.list("screens"), preset);
  const specialsOn = resolveSpecials(args.list("with"), preset);
  const idleMs = Number(args.one("idle-ms") ?? 2000);
  const outDir = resolve(
    args.one("out") ?? join(tmpdir(), "poketone-qa", startedAt.replace(/[:.]/g, "-")),
  );
  mkdirSync(outDir, { recursive: true });
  const tree = treeId();
  console.log(`qa: tree ${tree}`);
  console.log(`qa: ${configs.length} configs × ${screens.length} screens → ${outDir}`);
  for (const c of configs)
    console.log(
      `qa:   ${c.name.padEnd(24)} ${c.width}×${c.height} DPR ${c.dpr} ui ${c.uiScale} ${c.touch ? "touch, safe 47/21" : "mouse"}`,
    );

  // Sources: a frozen snapshot unless --live or an external --url.
  removeStaleWork(tmpdir(), "poketone-qa-work-");
  const work = join(tmpdir(), `poketone-qa-work-${process.pid}`);
  onCleanup(() => rmSync(work, { recursive: true, force: true }));
  const appRoot = args.flag("live") || args.one("url") ? root : snapshot(root, join(work, "app"));
  let devUrl = args.one("url");
  if (!devUrl) {
    devUrl = await startDev(appRoot);
    console.log(`qa: dev server ${devUrl} (${appRoot === root ? "live tree" : "snapshot"})`);
  }
  await waitHttp(devUrl);
  const { browser, version } = await launchChrome();
  console.log(`qa: Chrome ${version} (headless, ANGLE Metal, temp profile)`);

  // Warm-up: the first dev load compiles every module; not measured.
  {
    const t = Date.now();
    const { context, page } = await openConfig(browser, devUrl, configs[0]);
    await waitLobby(page, 180_000);
    await context.close();
    console.log(`qa: warm-up ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }

  const runs = [];
  for (const config of configs) {
    const t = Date.now();
    const run = { config, visits: [] };
    const { context, page, logs, reloads } = await openConfig(browser, devUrl, config);
    try {
      const ctx = {
        page,
        config,
        logs,
        outDir,
        idleMs,
        screens,
        shotScale: args.flag("full-res") ? "device" : "css",
      };
      run.visits = await walk(ctx);
      run.effective = ctx.effectiveScale;
      const counted = new Set(run.visits.flatMap((v) => v.logs ?? []));
      run.tailLogs = logs.filter((l) => !counted.has(l));
    } catch (error) {
      run.error = String(error?.message ?? error);
      run.tailLogs = logs;
    } finally {
      run.reloads = reloads();
      await context.close();
    }
    runs.push(run);
    const failedSteps = run.visits.filter((v) => v.error).length;
    console.log(
      `qa: ${config.name.padEnd(24)} effective scale ${run.effective?.scale ?? "?"} grid ${run.effective?.grid ?? "?"}  ` +
        `${run.visits.length} steps, ${failedSteps} failed, ${logs.length} console  (${((Date.now() - t) / 1000).toFixed(0)} s)` +
        (run.error ? `  ERROR ${run.error}` : ""),
    );
  }

  // One-off checks on one desktop and one phone config (the selection's own when it has no default).
  const probeConfigs = ["desktop", "phone"]
    .map((k) => {
      const mine = configs.filter((c) => c.kind === k);
      return mine.find((c) => PROBE_CONFIGS.includes(c.name)) ?? mine[0];
    })
    .filter(Boolean);
  const specials = { lifecycle: [], firstScreen: [], frameTime: [] };
  if (specialsOn.has("lifecycle"))
    for (const c of probeConfigs) {
      specials.lifecycle.push({
        config: c.name,
        result: await lifecycle(browser, devUrl, c, outDir),
      });
      console.log(
        `qa: lifecycle ${c.name}: ${specials.lifecycle.at(-1).result.pass ? "pass" : "FAIL"}`,
      );
    }
  if (specialsOn.has("perf"))
    for (const c of probeConfigs) {
      const r = await frameTime(browser, devUrl, c);
      specials.frameTime.push({ config: c.name, result: r });
      console.log(
        `qa: frame time ${c.name}: median ${r.medianMs} p95 ${r.p95Ms} ms, ${r.enemies} enemies ${r.error ?? ""}`,
      );
    }
  if (specialsOn.has("first-screen")) {
    let prodUrl = args.one("prod-url");
    if (!prodUrl) {
      const built = await buildAndPreview(appRoot, join(work, "dist"));
      prodUrl = built.url;
      console.log(
        `qa: production build ${(built.buildMs / 1000).toFixed(1)} s, preview ${prodUrl}`,
      );
    }
    await waitHttp(prodUrl);
    for (const c of probeConfigs) {
      const r = await firstScreen(browser, prodUrl, c);
      specials.firstScreen.push({ config: c.name, result: r });
      console.log(`qa: first screen ${c.name}: ${r.firstScreenMs ?? "?"} ms ${r.error ?? ""}`);
    }
  }

  const checks = judge(runs, specials);
  const sheets = await contactSheets(browser, runs, outDir);
  const pass = checks.every((c) => !c.blocking || c.pass !== false);
  const report = {
    startedAt,
    tree,
    chrome: version,
    runtimeMs: Date.now() - started,
    pass,
    configs: runs.map((r) => ({
      ...r.config,
      effective: r.effective,
      reloads: r.reloads,
      error: r.error,
    })),
    screens,
    checks,
    sheets,
    runs: runs.map((r) => ({ config: r.config.name, visits: r.visits, tailLogs: r.tailLogs })),
  };
  const files = writeReport(outDir, report);
  console.log("");
  for (const blocking of [true, false]) {
    console.log(
      blocking
        ? "Blocking checks (FAIL = behavioural defect):"
        : "\nDiagnostics (reported, never fail the run):",
    );
    for (const c of checks.filter((c) => c.blocking === blocking))
      console.log(`  ${label(c)}  ${c.title}${c.details.length ? `  (${c.details.length})` : ""}`);
  }
  console.log(
    `\nqa: ${pass ? "PASS" : "FAIL"} in ${((Date.now() - started) / 60000).toFixed(1)} min`,
  );
  console.log(`qa: summary ${files.md}\nqa: json    ${files.json}`);
  return pass ? 0 : 1;
}

const readmeHint = "See docs/README.md (可视QA) for options.";

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(error?.stack ?? error);
  code = 2;
} finally {
  await cleanup();
}
process.exit(code);
