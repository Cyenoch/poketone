// Servers and browser for the visual QA suite: a frozen source snapshot, a Bun dev server and a
// production preview on free ports, and one headless Chrome with its own temp profile. Everything
// started here is registered for cleanup, which also runs on SIGINT / SIGTERM / uncaught errors.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const cleanups = [];
/** Runs `fn` at exit (last registered first). */
export const onCleanup = (fn) => cleanups.push(fn);
let cleaning;
export function cleanup() {
  cleaning ??= (async () => {
    for (const fn of cleanups.reverse()) {
      try {
        await fn();
      } catch (error) {
        console.error("qa: cleanup step failed:", error?.message ?? error);
      }
    }
  })();
  return cleaning;
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, () => {
    console.error(`qa: ${signal}, cleaning up`);
    void cleanup().then(() => process.exit(130));
  });

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Removes `<prefix><pid>` work dirs left by runs that were killed before their cleanup finished. */
export function removeStaleWork(dir, prefix) {
  for (const name of readdirSync(dir)) {
    const pid = Number(name.startsWith(prefix) ? name.slice(prefix.length) : NaN);
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    try {
      process.kill(pid, 0);
    } catch {
      rmSync(join(dir, name), { recursive: true, force: true });
    }
  }
}

/**
 * Copies what the Web server serves (src, public, index.html, configs) into `dir` and links node_modules, so a
 * run measures one consistent tree even while other agents edit src/ (the dev server reloads the page
 * on any src/ui/gpu, src/run or src/rendering change: docs/LESSONS.md, 开发服务器热更新).
 */
export function snapshot(root, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(root)) {
    const keep =
      ["src", "public", "patches", "index.html", "package.json"].includes(name) ||
      /^tsconfig.*\.json$/.test(name);
    if (keep) cpSync(join(root, name), join(dir, name), { recursive: true });
  }
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  mkdirSync(join(dir, "scripts"), { recursive: true });
  for (const file of ["game-build.ts", "web-build.mjs", "web.mjs"])
    cpSync(join(root, "scripts", file), join(dir, "scripts", file));
  return dir;
}

export async function startDev(appRoot, harbor = "ws://127.0.0.1:8787/multiplayer") {
  const { serveWeb } = await import(pathToFileURL(join(appRoot, "scripts/web.mjs")).href);
  const server = await serveWeb({
    root: appRoot,
    port: 0,
    hostname: "127.0.0.1",
    development: true,
    harbor,
  });
  onCleanup(() => server.stop());
  return String(server.url);
}

export async function buildAndPreview(appRoot, outDir) {
  const { buildWeb } = await import(pathToFileURL(join(appRoot, "scripts/web-build.mjs")).href);
  const { serveWeb } = await import(pathToFileURL(join(appRoot, "scripts/web.mjs")).href);
  const started = Date.now();
  await buildWeb(appRoot, outDir);
  const buildMs = Date.now() - started;
  const server = await serveWeb({
    root: appRoot,
    directory: outDir,
    port: 0,
    hostname: "127.0.0.1",
    development: false,
    harbor: "ws://127.0.0.1:8787/multiplayer",
  });
  onCleanup(() => server.stop());
  return { url: String(server.url), buildMs };
}

/** Polls until `url` answers 200 (slow first compiles, cold caches). */
export async function waitHttp(url, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error.message;
    }
    await sleep(500);
  }
  throw new Error(`qa: ${url} not ready after ${timeoutMs} ms (${last})`);
}

function playwrightCore() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
  const npx = join(homedir(), ".npm/_npx");
  const found = existsSync(npx)
    ? readdirSync(npx)
        .map((d) => join(npx, d, "node_modules/playwright-core"))
        .filter((d) => existsSync(d))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  if (!found[0])
    throw new Error(
      "qa: no playwright-core in the npx cache; run `npx playwright-core --version` once or set PLAYWRIGHT_CORE",
    );
  return found[0];
}

/**
 * One headless Chrome on the real GPU (Metal through ANGLE). Playwright gives it a fresh temp
 * profile and talks to it over a pipe, so it never attaches to, or opens a port shared with, any
 * other Chrome on the machine.
 */
export async function launchChrome() {
  const pw = await import(pathToFileURL(join(playwrightCore(), "index.mjs")).href);
  const executablePath =
    process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await pw.chromium.launch({
    executablePath,
    headless: true,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  onCleanup(() => browser.close());
  return { browser, version: browser.version() };
}
