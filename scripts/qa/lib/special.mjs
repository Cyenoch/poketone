// One-off checks that need their own page: the run lifecycle with context loss, first-screen time
// on the throttled production build, and frame time in a dense late run.
import { join } from "node:path";
import { FIRST_SCREEN, FRAME, LIFECYCLE_EXPECTED, WEBGL_ERROR } from "../config.mjs";
import { sleep } from "./env.mjs";
import { keys, locate, openConfig, pointAt, press, waitLobby } from "./page.mjs";

const OV = "window.__poketoneUi.run?.overlays";
const UI = "window.__poketoneUi";
const until = (page, expr, timeout = 20_000) =>
  page.waitForFunction(expr, null, { timeout, polling: 100 });

async function startRun(page, config) {
  await press(page, config, `${UI}.lobby.stage`, "出发");
  await until(page, "window.__poketoneWorld?.tick > 60 && !!window.__poketoneUi.run?.hud", 60_000);
}

/** Waits for a run other than `old` (a handle to the previous world) to be playing. */
const newRun = (page, old) =>
  page.waitForFunction(
    (old) =>
      window.__poketoneWorld && window.__poketoneWorld !== old && window.__poketoneWorld.tick > 60,
    old,
    { timeout: 60_000, polling: 100 },
  );

/**
 * run → pause → lose and restore every WebGL context → continue (the sim advances) → pause → 放弃 →
 * 再来一局 → the new run plays. 0 WebGL errors; the canvases and contexts present at run start are
 * the same objects at the end, not lost, and still drawing.
 */
export async function lifecycle(browser, url, config, outDir) {
  const { context, page, logs } = await openConfig(browser, url, config);
  const steps = [];
  const note = async (name) =>
    steps.push([
      name,
      await page.evaluate(() => ({
        tick: window.__poketoneWorld?.tick ?? null,
        contexts: window.__qaContexts.map(
          (e) => `${e.cls}:${e.ctx.isContextLost() ? "lost" : "ok"}`,
        ),
      })),
    ]);
  try {
    await waitLobby(page);
    await startRun(page, config);
    await page.evaluate(() => {
      window.__poketoneWorld.players[0].invulnerable = 1e6;
      window.__qaCanvases = [...document.querySelectorAll("canvas")];
      window.__qaCtxAtStart = window.__qaContexts
        .filter((e) => e.canvas.isConnected)
        .map((e) => e.ctx);
    });
    await note("run");
    await keys(page, "KeyP");
    await until(page, `${OV}?.state?.kind === "pause"`);
    await page.evaluate(() => {
      window.__qaLosers = window.__qaCtxAtStart.map((c) => c.getExtension("WEBGL_lose_context"));
      for (const l of window.__qaLosers) l?.loseContext();
    });
    await sleep(800);
    await note("lost");
    await page.evaluate(() => {
      for (const l of window.__qaLosers) l?.restoreContext();
    });
    await sleep(2000);
    await note("restored");
    await page.screenshot({ path: join(outDir, `${config.name}--lifecycle-restored.png`) });
    await press(page, config, `${OV}.stage`, "继续");
    await until(page, `!${OV}.isModal`);
    const t1 = await page.evaluate(() => window.__poketoneWorld.tick);
    await sleep(1000);
    const advanced = (await page.evaluate(() => window.__poketoneWorld.tick)) - t1;
    await note("continued");
    // The run ends (放弃 no longer shows a result): result → 再来一局.
    await page.evaluate(() => {
      window.__poketoneWorld.outcome = "defeat";
    });
    await until(page, `${OV}?.state?.kind === "result"`);
    await sleep(2500);
    await page.screenshot({ path: join(outDir, `${config.name}--lifecycle-result.png`) });
    await note("result");
    const retry = await locate(page, `${OV}.stage`, "再来一局");
    if (!retry) throw new Error("result has no 再来一局");
    const firstWorld = await page.evaluateHandle(() => window.__poketoneWorld);
    await pointAt(page, config, retry);
    await newRun(page, firstWorld);
    await note("second run");
    // 放弃冒险 → 返回大厅 → lobby → 出发: the run is torn down and a third one starts.
    await page.evaluate(() => {
      window.__poketoneWorld.players[0].invulnerable = 1e6;
    });
    await keys(page, "KeyP");
    await until(page, `${OV}?.state?.kind === "pause"`);
    await sleep(300);
    await press(page, config, `${OV}.stage`, "放弃冒险");
    await until(page, `${OV}?.state?.quitting === true`);
    await press(page, config, `${OV}.stage`, "返回大厅");
    await until(page, `!window.__poketoneWorld && !!${UI}.lobby`, 20_000);
    await sleep(1500);
    await note("lobby");
    await startRun(page, config);
    const f0 = await page.evaluate(() => ({ ...window.__qa.frames }));
    await sleep(1500);
    const f1 = await page.evaluate(() => ({ ...window.__qa.frames }));
    await note("third run");
    await page.screenshot({ path: join(outDir, `${config.name}--lifecycle-third-run.png`) });
    const identity = await page.evaluate(() => ({
      sameCanvases:
        window.__qaCanvases.every((c) => c.isConnected) &&
        [...document.querySelectorAll("canvas")].every((c) => window.__qaCanvases.includes(c)),
      sameContexts: window.__qaContexts
        .filter((e) => e.canvas.isConnected)
        .every((e) => window.__qaCtxAtStart.includes(e.ctx)),
      lostNow: window.__qaContexts.filter((e) => e.canvas.isConnected && e.ctx.isContextLost())
        .length,
      canvases: window.__qaCanvases.map((c) => c.className),
    }));
    const drawing = Object.fromEntries(
      Object.keys(f1)
        .filter((k) => !k.includes("detached"))
        .map((k) => [k, (f1[k] ?? 0) - (f0[k] ?? 0)]),
    );
    const webgl = logs
      .filter((l) => !LIFECYCLE_EXPECTED.some((re) => re.test(l.text)))
      .filter((l) => WEBGL_ERROR.test(l.text));
    const other = logs.filter(
      (l) => !LIFECYCLE_EXPECTED.some((re) => re.test(l.text)) && !webgl.includes(l),
    );
    const allDrawing = identity.canvases.every((cls) => (drawing[cls.split(" ")[0]] ?? 0) > 0);
    const pass =
      webgl.length === 0 &&
      identity.sameCanvases &&
      identity.sameContexts &&
      identity.lostNow === 0 &&
      advanced > 0 &&
      allDrawing;
    return {
      pass,
      advancedTicksIn1s: advanced,
      identity,
      drawingIn1500ms: drawing,
      webglErrors: webgl,
      otherLogs: other,
      steps,
    };
  } catch (error) {
    return { pass: false, error: String(error?.message ?? error), steps, logs };
  } finally {
    await context.close();
  }
}

/**
 * Production build, cold cache, throttled network. "First screen" = the first UI-canvas draw after
 * every first-screen atlas (the fonts requested before the first atlas finished) has arrived: the
 * host shows the lobby's text only once those are in.
 */
export async function firstScreen(browser, url, config) {
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: config.dpr,
    hasTouch: config.touch,
    isMobile: config.touch,
  });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__qaDraws = [];
      const P = WebGL2RenderingContext.prototype;
      for (const n of [
        "drawElements",
        "drawArrays",
        "drawElementsInstanced",
        "drawArraysInstanced",
      ]) {
        const o = P[n];
        P[n] = function (...a) {
          const last = window.__qaDraws.at(-1);
          const now = Date.now();
          if (!last || now - last > 4) window.__qaDraws.push(now);
          return o.apply(this, a);
        };
      }
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: FIRST_SCREEN.latencyMs,
      downloadThroughput: FIRST_SCREEN.downBps / 8,
      uploadThroughput: FIRST_SCREEN.upBps / 8,
    });
    const req = new Map();
    let offset = null;
    cdp.on("Network.requestWillBeSent", (e) => {
      offset ??= e.wallTime * 1000 - e.timestamp * 1000;
      req.set(e.requestId, { url: e.request.url, start: e.timestamp * 1000 });
    });
    cdp.on("Network.loadingFinished", (e) => {
      const r = req.get(e.requestId);
      if (r) Object.assign(r, { end: e.timestamp * 1000, bytes: e.encodedDataLength });
    });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
    const deadline = t0 + 30_000;
    let result = null;
    while (Date.now() < deadline && !result) {
      await sleep(250);
      const atlases = [...req.values()].filter((r) =>
        /\/fonts\/gpu\/[^/]+\.(webp|png)$/.test(r.url),
      );
      const firstEnd = Math.min(...atlases.filter((r) => r.end).map((r) => r.end));
      if (!Number.isFinite(firstEnd)) continue;
      const firstScreenAtlases = atlases.filter((r) => r.start < firstEnd);
      if (!firstScreenAtlases.every((r) => r.end)) continue;
      const atlasesWall = Math.max(...firstScreenAtlases.map((r) => r.end)) + offset;
      const draws = await page.evaluate(() => window.__qaDraws);
      const after = draws.find((t) => t >= atlasesWall);
      if (after)
        result = {
          firstScreenMs: after - t0,
          firstDrawMs: draws[0] ? draws[0] - t0 : null,
          atlases: firstScreenAtlases.map((r) => ({
            file: r.url.split("/").pop(),
            kB: Math.round((r.bytes ?? 0) / 1024),
            endMs: Math.round(r.end + offset - t0),
          })),
        };
    }
    const all = [...req.values()].filter((r) => r.end);
    const totalMB = +(all.reduce((s, r) => s + (r.bytes ?? 0), 0) / 1e6).toFixed(2);
    if (!result) return { pass: false, error: "lobby text never drew within 30 s", totalMB };
    return {
      pass: result.firstScreenMs <= FIRST_SCREEN.targetMs,
      targetMs: FIRST_SCREEN.targetMs,
      ...result,
      totalMBIn: totalMB,
    };
  } finally {
    await context.close();
  }
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/**
 * Dense late run: the clock jumps to FRAME.lateTime, the director fills the field while the player
 * is invulnerable, then rAF intervals are sampled over windows with no run window open.
 */
export async function frameTime(browser, url, config) {
  const { context, page, logs } = await openConfig(browser, url, config);
  try {
    await waitLobby(page);
    await startRun(page, config);
    await page.evaluate((late) => {
      const w = window.__poketoneWorld;
      w.players[0].invulnerable = 1e6;
      w.time = late;
    }, FRAME.lateTime);
    const deadline = Date.now() + FRAME.warmupMs;
    while (Date.now() < deadline) {
      if (await page.evaluate(`${OV}?.isModal`)) await keys(page, "Enter");
      await sleep(300);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      while (await page.evaluate(`${OV}?.isModal`)) {
        await keys(page, "Enter");
        await sleep(600);
      }
      await page.evaluate(() => {
        window.__qa.rafTimes = [];
        window.__qa.recordRaf = true;
      });
      await sleep(FRAME.sampleMs);
      const s = await page.evaluate(`(() => { window.__qa.recordRaf = false;
        return { times: window.__qa.rafTimes, modal: !!${OV}?.isModal, enemies: window.__poketoneWorld.enemies.length,
          time: window.__poketoneWorld.time, outcome: window.__poketoneWorld.outcome }; })()`);
      if (s.modal) continue;
      const gaps = s.times
        .slice(1)
        .map((t, i) => t - s.times[i])
        .sort((a, b) => a - b);
      if (gaps.length < 20) continue;
      const median = +quantile(gaps, 0.5).toFixed(2);
      const p95 = +quantile(gaps, 0.95).toFixed(2);
      return {
        pass: median <= FRAME.medianMs && p95 <= FRAME.p95Ms,
        medianMs: median,
        p95Ms: p95,
        maxMs: +gaps.at(-1).toFixed(2),
        frames: gaps.length,
        enemies: s.enemies,
        simTime: Math.round(s.time),
        target: { medianMs: FRAME.medianMs, p95Ms: FRAME.p95Ms },
        errors: logs.filter((l) => l.type !== "warning"),
      };
    }
    return { pass: false, error: "no 5 s window without a run window open" };
  } catch (error) {
    return { pass: false, error: String(error?.message ?? error) };
  } finally {
    await context.close();
  }
}
