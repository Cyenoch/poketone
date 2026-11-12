// UI centring audit: enters screens from the GPU lobby (its dev hook). GPU lobby/settings produce screenshots
// for manual ink-vs-box review; DOM screens still find every short label sitting in its own box
// (badges, chips, tags, key hints, buttons), renders it at 4× and compares the label's ink centre with the
// box centre. Reports labels more than MAX_OFFSET CSS px off vertically for visual review. Ink is found by shooting the
// label with and without its text (see inkOffset); labels covered by another element are skipped.
//
//   Needs a running dev server and a Chrome with remote debugging:
//     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9461 \
//       --user-data-dir=/tmp/poketone-chrome about:blank &
//   bun run check:centering [appUrl] [cdpPort] [screenshotDirectory]
import { inflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const APP = process.argv[2] ?? "http://localhost:5173/";
const PORT = Number(process.argv[3] ?? 9461);
const MAX_OFFSET = 0.5;
const SCALE = 4;
const SHOTS = resolve(process.argv[4] ?? "/tmp/poketone-ui-centering");
const VIEWPORTS = [
  { width: 1280, height: 720, mobile: false },
  { width: 844, height: 390, mobile: true },
];

/** Remaining DOM labels; GPU run windows are reviewed from formal journey screenshots. */
const SCREENS = [
  { name: "lobby", go: "" },
  { name: "lab", go: "" },
  { name: "settings", go: "" },
];

// Leaf labels whose nearest painted box contains nothing but that label (plus icons), at most 64px tall.
// Labels with descenders are skipped: their ink legitimately hangs below the cap line.
const FIND = `(() => {
  const painted = (s) => (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent") ||
    s.backgroundImage !== "none" || parseFloat(s.borderTopWidth) > 0;
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (!own || /[gjpqy,;()]/.test(own) || own.length > 12) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
    let box = el;
    while (box && box !== document.body && !painted(getComputedStyle(box))) box = box.parentElement;
    if (!box || box === document.body) continue;
    const b = box.getBoundingClientRect();
    if (b.height > 64 || b.height < 10 || box.textContent.trim() !== own) continue;
    if (b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue;
    // Covered labels (HUD under a modal's dim, a panel behind a dialog) are not what the player sees.
    const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    if (!top || !(box === top || box.contains(top) || top.contains(box))) continue;
    el.dataset.centringProbe = String(out.length);
    out.push({ text: own, cls: String(box.className).slice(0, 60), x: b.x, y: b.y, w: b.width, h: b.height });
  }
  return out;
})()`;

const tab = await (
  await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })
).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result ?? message);
    pending.delete(message.id);
  }
};
await new Promise((resolve) => (ws.onopen = resolve));
const run = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 400));
  return result.result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Decodes an RGBA/RGB 8-bit non-interlaced PNG (what Chrome's captureScreenshot returns). */
function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") chunks.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = (value + predicted) & 255;
    }
  }
  return { width, height, channels, pixels };
}

/**
 * Vertical ink centre minus box centre, in CSS px. Ink is every pixel the label's own text paints:
 * the box is shot with the text and again with only that label's text made transparent, and the
 * rows that change are the glyphs, anti-aliased edges included (a colour match alone drops the thin,
 * lighter strokes at the bottom of CJK glyphs and reads them ~0.6 px high), while rings, fills and
 * neighbours stay out because they do not change.
 */
function inkOffset(withText, withoutText) {
  const { width, height, channels, pixels } = withText;
  const other = withoutText.pixels;
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    let hits = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const difference =
        Math.abs(pixels[i] - other[i]) +
        Math.abs(pixels[i + 1] - other[i + 1]) +
        Math.abs(pixels[i + 2] - other[i + 2]);
      if (difference > 40) hits++;
    }
    if (hits >= 2) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  if (top < 0) return null;
  return ((top + bottom) / 2 - height / 2) / SCALE;
}

const pressKey = async (key) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key });
};
/** Waits for the lobby (the root screen), then activates its control of `kind` (lab, settings, start). */
const enterFromLobby = async (kind) => {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await run(`!!window.__poketoneUi?.lobby`);
    if (!ready) await sleep(500);
  }
  if (!ready)
    throw new Error("GPU lobby is not ready (needs a dev build: window.__poketoneUi.lobby)");
  if (kind === "lobby") return;
  const found =
    await run(`(() => { const c = window.__poketoneUi.lobby.controls.find((c) => c.kind === ${JSON.stringify(kind)});
    if (!c) return false; c.activate(); return true; })()`);
  if (!found) throw new Error(`lobby has no ${kind} control`);
  await sleep(1200);
};
await mkdir(SHOTS, { recursive: true });
const manualShots = [];
const saveGpuShot = async (viewport, state) => {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = `${viewport.width}x${viewport.height}-${state}.png`;
  await writeFile(resolve(SHOTS, file), Buffer.from(shot.data, "base64"));
  manualShots.push(file);
};
const failures = [];
let checked = 0;
for (const viewport of VIEWPORTS) {
  await send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  for (const screen of SCREENS) {
    await send("Page.navigate", { url: APP });
    await sleep(2500);
    await enterFromLobby(screen.name);
    await run(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      ${screen.go}
      await sleep(1200);
    })()`);
    if (screen.name === "lobby" || screen.name === "settings") {
      await saveGpuShot(viewport, screen.name);
      if (screen.name === "settings") {
        await pressKey("End");
        await pressKey("ArrowUp");
        await sleep(300);
        await saveGpuShot(viewport, "settings-actions");
      }
      continue;
    }
    // Freeze motion so both shots of a label see the same frame.
    await run(`(() => { const s = document.createElement("style"); s.id = "centring-freeze";
      s.textContent = "*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }";
      document.head.append(s); })()`);
    const labels = await run(FIND);
    for (const [index, label] of labels.entries()) {
      const clip = { x: label.x, y: label.y, width: label.w, height: label.h, scale: SCALE };
      const shot = await send("Page.captureScreenshot", { format: "png", clip });
      await run(`(() => { const e = document.querySelector('[data-centring-probe="${index}"]');
        e.style.setProperty("color", "transparent", "important");
        e.style.setProperty("-webkit-text-stroke-color", "transparent", "important");
        e.style.setProperty("text-shadow", "none", "important"); })()`);
      const bare = await send("Page.captureScreenshot", { format: "png", clip });
      await run(`(() => { const e = document.querySelector('[data-centring-probe="${index}"]');
        e.style.removeProperty("color"); e.style.removeProperty("-webkit-text-stroke-color");
        e.style.removeProperty("text-shadow"); })()`);
      const offset = inkOffset(
        decodePng(Buffer.from(shot.data, "base64")),
        decodePng(Buffer.from(bare.data, "base64")),
      );
      if (offset === null) continue;
      checked++;
      if (Math.abs(offset) > MAX_OFFSET)
        failures.push(
          `${viewport.width}×${viewport.height} ${screen.name}: "${label.text}" (${label.cls}) ${offset > 0 ? "low" : "high"} by ${Math.abs(offset).toFixed(2)}px`,
        );
    }
  }
}
// HUD top bar (GPU): the clock, its meta line and the compass sit on the row's centre, at 100% and
// 150% UI scale. Measured from the dev build's layout (window.__poketoneUi.run?.hud), in CSS px.
const HUD_CENTRE = `(() => {
  const hud = window.__poketoneUi.run?.hud;
  if (!hud) return null;
  const cam = hud.stage.camera, scale = hud.stage.viewport.scale;
  const centre = (node) => node?.globalMatrix.value && node.size.value?.[0] ? (node.globalMatrix.value.elements[12] - cam.left) * scale : null;
  return {
    row: centre(hud.top),
    // The outlined clock's own box. Its fill text box can overhang it by up to a device pixel: Yoga
    // ceils a text node's right edge onto the pixel grid; the left-aligned ink does not move.
    clock: centre(hud.clock.root),
    meta: centre(hud.meta),
    compass: centre(hud.compassSlot.children.find((child) => child.size)),
  };
})()`;
for (const viewport of VIEWPORTS)
  for (const uiScale of [1, 1.5]) {
    await send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
    await send("Page.navigate", { url: APP });
    await sleep(1500);
    await run(
      `localStorage.setItem("poketone.settings.v3", JSON.stringify({ sound: false, devMode: false, uiScale: ${uiScale} }))`,
    );
    await send("Page.navigate", { url: APP });
    await sleep(2500);
    await enterFromLobby("start");
    let centres = null;
    // The compass joins the HUD once the run's assets are in.
    for (let i = 0; i < 40 && !(centres?.clock && centres.compass); i++) {
      await sleep(500);
      centres = await run(HUD_CENTRE);
    }
    await sleep(600);
    centres = await run(HUD_CENTRE);
    if (!centres?.clock) {
      failures.push(
        `${viewport.width}×${viewport.height} @${uiScale * 100}% HUD: run did not start`,
      );
      continue;
    }
    for (const part of ["clock", "meta", "compass"]) {
      checked++;
      const off = centres[part] - centres.row;
      if (Math.abs(off) > MAX_OFFSET)
        failures.push(
          `${viewport.width}×${viewport.height} @${uiScale * 100}% HUD ${part}: ${off > 0 ? "right" : "left"} of the top row's centre by ${Math.abs(off).toFixed(2)}px`,
        );
    }
  }
await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`);
await writeFile(
  resolve(SHOTS, "README.md"),
  `# GPU text review\n\nFormal application screenshots, entered from the lobby.\n\n${manualShots.map((file) => `- ${file}`).join("\n")}\n\nReview the settings title against the header band and the 100%/save labels against their controls.\nGPU glyphs and their boxes are not exposed as DOM nodes. The DOM text-removal difference method cannot isolate this ink, so no automatic GPU ink-centering result is reported. These screenshots require manual review at native pixel size.\n`,
);
console.log(`GPU ink centering: manual review required; screenshots in ${SHOTS}`);
for (const failure of failures) console.log(failure);
console.log(
  `centering: ${checked} labels checked, ${failures.length} off by more than ${MAX_OFFSET}px`,
);
// Visual measurements inform review; they are not a numerical release gate.
process.exit(0);
