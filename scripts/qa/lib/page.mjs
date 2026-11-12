// One browser context per QA config: seeded storage, WebGL instrumentation, console capture, and
// input helpers that drive GPU controls by their visible label (touch on phones, mouse on desktop).
import { sleep } from "./env.mjs";

/** Progress with something in every lab section, the archive and the backpack. */
export const seededProgress = () => ({
  version: 4,
  runs: 3,
  clears: [1, 0, 0],
  best: { charmander: { difficulty: 0, victory: true, time: 601, kills: 1234 } },
  kills: 5000,
  research: 5000,
  stardust: 1234,
  lab: { dmg: 3, hp: 2, atkspd: 1, area: 2, gold: 1, magnet: 1, reroll: 1, skip: 1, archive: 2 },
  archive: ["leftovers"],
  backpack: ["magnet"],
});

/**
 * Runs before page scripts. Counts, per canvas: shader compiles, program links, draw calls and rAF
 * frames that drew; remembers every WebGL context ever created (identity checks) and the wall time
 * of every draw frame (first-screen timing). World renders come from the app's own dev probe,
 * `window.__poketoneRender` ({ presented, world, shadow }: world-pass draws and shadow-map renders),
 * read by `counters`; draw counts alone cannot tell the world from the UI on the one canvas.
 */
function instrument() {
  const st = (window.__qa = {
    compile: {},
    link: {},
    draw: {},
    frames: {},
    frame: 0,
    lastFrame: {},
    firstDraw: {},
    rafTimes: [],
    recordRaf: false,
  });
  const tick = (t) => {
    st.frame++;
    if (st.recordRaf) st.rafTimes.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const key = (gl) => {
    const c = gl.canvas;
    return (c.className || c.id || "canvas").split(" ")[0] + (c.isConnected ? "" : "(detached)");
  };
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const P = C.prototype;
    const wrap = (name, bucket) => {
      const original = P[name];
      if (!original) return;
      P[name] = function (...args) {
        const k = key(this);
        st[bucket][k] = (st[bucket][k] || 0) + 1;
        if (bucket === "draw") {
          st.firstDraw[k] ??= Date.now();
          if (st.lastFrame[k] !== st.frame) {
            st.lastFrame[k] = st.frame;
            st.frames[k] = (st.frames[k] || 0) + 1;
          }
        }
        return original.apply(this, args);
      };
    };
    wrap("compileShader", "compile");
    wrap("linkProgram", "link");
    for (const n of [
      "drawElements",
      "drawArrays",
      "drawElementsInstanced",
      "drawArraysInstanced",
      "drawRangeElements",
    ])
      wrap(n, "draw");
  }
  // oxlint-disable-next-line typescript/unbound-method -- re-bound with .call below
  const getContext = HTMLCanvasElement.prototype.getContext;
  window.__qaContexts = [];
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !window.__qaContexts.some((e) => e.ctx === ctx))
      window.__qaContexts.push({ canvas: this, ctx, cls: this.className });
    return ctx;
  };
}

export async function openConfig(browser, url, config, { prog = seededProgress() } = {}) {
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: config.dpr,
    hasTouch: config.touch,
    isMobile: config.touch,
  });
  await context.addInitScript(
    ({ prog, settings }) => {
      if (sessionStorage.getItem("__qaSeeded")) return;
      localStorage.setItem("poketone.progress.v4", JSON.stringify(prog));
      localStorage.setItem("poketone.settings.v3", JSON.stringify(settings));
      sessionStorage.setItem("__qaSeeded", "1");
    },
    { prog, settings: { sound: false, devMode: false, uiScale: config.uiScale } },
  );
  await context.addInitScript(instrument);
  const page = await context.newPage();
  const logs = [];
  page.on("console", (m) => {
    const type = m.type();
    if (type === "error" || type === "warning" || type === "assert")
      logs.push({ type, text: m.text(), at: Date.now() });
  });
  page.on("pageerror", (e) =>
    logs.push({
      type: "pageerror",
      text: `${e.message} @ ${(e.stack ?? "").split("\n").slice(1, 3).join(" / ")}`,
      at: Date.now(),
    }),
  );
  let loads = 0;
  page.on("load", () => loads++);
  // CDP exists only on Chromium; it is needed only for the safe-area override.
  if (config.safe)
    await (
      await context.newCDPSession(page)
    ).send("Emulation.setSafeAreaInsetsOverride", {
      insets: config.safe,
    });
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  return { context, page, logs, reloads: () => loads - 1 };
}

/** Waits for the GPU lobby with its text drawn (slow first dev compiles, cold atlases). */
export async function waitLobby(page, timeout = 90_000) {
  await page.waitForFunction(
    () => {
      const st = window.__poketoneUi?.lobby?.stage;
      if (!st) return false;
      let ready = false;
      st.root.traverse((o) => {
        if (ready || o.constructor.name !== "Text") return;
        if (o.properties?.peek?.().text === "出发" && o.fontSignal?.value) ready = true;
      });
      return ready;
    },
    null,
    { timeout, polling: 250 },
  );
  await sleep(1200);
}

export async function keys(page, ...list) {
  for (const k of list) {
    await page.keyboard.press(k);
    await sleep(140);
  }
}

/** Host CSS px centre of the panel holding visible text `label` on the stage `stageExpr`. */
export const locate = (page, stageExpr, label) =>
  page.evaluate(`(() => {
    const st = ${stageExpr}, label = ${JSON.stringify(label)};
    if (!st) return null;
    let found = null;
    st.root.traverse((o) => {
      if (found || o.constructor.name !== "Text") return;
      if (o.properties?.peek?.().text === label && o.isVisible?.value) found = o;
    });
    if (!found) return null;
    const target = found.parentContainer.value ?? found;
    const m = target.globalMatrix.value.elements, v = st.viewport;
    return [(m[12] - st.camera.left) * v.scale, (st.camera.top - m[13]) * v.scale];
  })()`);

/** Taps (touch configs) or moves + clicks (desktop) at a host point. */
export async function pointAt(page, config, [x, y]) {
  if (config.touch) await page.touchscreen.tap(x, y);
  else {
    await page.mouse.move(x, y);
    await sleep(100);
    await page.mouse.click(x, y);
  }
}

/** Presses the control labelled `label`; throws when it is not on screen. */
/**
 * When the control labelled `label` sits outside a scroll container's visible box (the pause list
 * at 80% on a 390-px-tall phone), returns where to scroll and by how much, in host px: the centre of
 * the scroller and the content offset needed. A tap on a clipped control lands on nothing.
 */
const scrollNeed = (page, stageExpr, label) =>
  page.evaluate(`(() => {
    const st = ${stageExpr}, label = ${JSON.stringify(label)};
    if (!st) return null;
    let found = null;
    st.root.traverse((o) => {
      if (found || o.constructor.name !== "Text") return;
      if (o.properties?.peek?.().text === label && o.isVisible?.value) found = o;
    });
    if (!found) return null;
    const target = found.parentContainer.value ?? found, v = st.viewport;
    const edges = (n) => { const m = n.globalMatrix.value.elements, z = n.size.value; return { x: m[12], y: m[13], top: m[13] + z[1] / 2, bottom: m[13] - z[1] / 2 }; };
    for (let a = target.parentContainer.value; a; a = a.parentContainer.value) {
      if (a.properties?.peek?.().overflow !== "scroll") continue;
      const box = edges(a), t = edges(target);
      // Units the content must move up (positive) or down (negative), with 4 units of room.
      const dy = t.bottom < box.bottom ? box.bottom - t.bottom + 4 : t.top > box.top ? box.top - t.top - 4 : 0;
      if (Math.abs(dy) < 0.5) continue;
      return { x: (box.x - st.camera.left) * v.scale, y: (st.camera.top - box.y) * v.scale, dy: dy * v.scale };
    }
    return null;
  })()`);

/** Scrolls as a player does: a touch drag on touch configs, the mouse wheel on desktop. */
async function scrollBy(page, config, { x, y, dy }) {
  if (!config.touch) {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, dy);
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, ty) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y: ty }],
    });
  const steps = 10;
  await touch("touchStart", y);
  for (let k = 1; k <= steps; k++) {
    await touch("touchMove", y - (dy * k) / steps);
    await sleep(16);
  }
  await touch("touchEnd");
  await cdp.detach();
}

export async function press(page, config, stageExpr, label) {
  for (let tries = 0; tries < 3; tries++) {
    const need = await scrollNeed(page, stageExpr, label);
    if (!need) break;
    await scrollBy(page, config, need);
    await sleep(350);
  }
  // A state change can precede Yoga/font layout; input targets are ready only once drawn.
  let at = await locate(page, stageExpr, label);
  const deadline = Date.now() + 5000;
  while (!at && Date.now() < deadline) {
    await page.evaluate(() => new Promise(requestAnimationFrame));
    at = await locate(page, stageExpr, label);
  }
  if (!at) throw new Error(`no visible control "${label}" on ${stageExpr}`);
  await pointAt(page, config, at);
}

export const evaluate = (page, fn, arg) => page.evaluate(fn, arg);

export const counters = (page) =>
  page.evaluate(() => {
    const q = window.__qa;
    return JSON.parse(
      JSON.stringify({
        compile: q.compile,
        link: q.link,
        draw: q.draw,
        frames: q.frames,
        frame: q.frame,
        render: { world: 0, shadow: 0, ...window.__poketoneRender },
      }),
    );
  });

export function delta(a, b) {
  const out = {
    raf: b.frame - a.frame,
    world: b.render.world - a.render.world,
    shadow: b.render.shadow - a.render.shadow,
  };
  for (const k of ["compile", "link", "draw", "frames"]) {
    out[k] = {};
    for (const c of new Set([...Object.keys(a[k]), ...Object.keys(b[k])])) {
      const d = (b[k][c] || 0) - (a[k][c] || 0);
      if (d) out[k][c] = d;
    }
  }
  return out;
}
