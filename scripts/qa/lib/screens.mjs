// Drives one config through every screen with real input (labels pressed by touch or mouse, keys
// where the game binds them) plus dev hooks for game state (XP, station position, clock). At each
// screen it takes a screenshot and runs the in-page probes; the checks module judges the results.
import { join } from "node:path";
import { IDLE } from "../config.mjs";
import { sleep } from "./env.mjs";
import { counters, delta, keys, locate, pointAt, press, waitLobby } from "./page.mjs";
import * as probe from "./probes.mjs";

const UI = "window.__poketoneUi";
const OV = "window.__poketoneUi.run?.overlays";
const HUD = "window.__poketoneUi.run?.hud";
const LAB = `${UI}.screens.find((s) => typeof s.showSection === "function")`;
const TOP = `${UI}.screens.at(-1)`;
const LOBBY = `${UI}.lobby`;
const LS = `${LOBBY}.stage`;
const lobbyControl = (kind) => `${LOBBY}.controls.find((c) => c.kind === ${JSON.stringify(kind)})`;

export const LAB_TABS = [
  ["combat", "战斗"],
  ["output", "输出"],
  ["economy", "机动与经济"],
  ["system", "系统"],
];
export const CODEX_TABS = [
  ["pokemon", "宝可梦", true],
  ["moves", "招式", false],
  ["items", "道具", false],
  ["stations", "站点", true],
  ["enemies", "敌人", true],
  ["statuses", "状态", false],
];

async function until(page, expr, what, timeout = 15_000) {
  try {
    await page.waitForFunction(expr, null, { timeout, polling: 100 });
  } catch {
    throw new Error(`timed out (${timeout} ms) waiting for ${what}: ${expr}`);
  }
}

/** Escape until no window is open over the lobby (settings, save, lab, 图鉴); the lobby is the root. */
async function toLobby(page) {
  for (let i = 0; i < 6; i++) {
    const open = await page.evaluate(
      `!!(${UI}.dialog || ${UI}.codex || ${UI}.screens.some((s) => s !== ${LOBBY}))`,
    );
    if (!open) return;
    await keys(page, "Escape");
    await sleep(900);
  }
  throw new Error("could not return to the lobby with Escape");
}

/** Presses a lobby control by kind (the 设置 key is icon-only, so it has no label to find). */
async function pressLobby(page, config, kind) {
  const at = await centre(page, `${lobbyControl(kind)}.panel`, LS);
  await pointAt(page, config, at);
}

export function createVisitor({ page, config, logs, outDir, idleMs, shotScale }) {
  const visits = [];
  let logMark = 0;
  /**
   * Records screen `name`: screenshot, probes on `stage` / `owner`, idle redraws against `idleKey`.
   * `stageName` names scroll areas (`codex.listPane`).
   */
  async function visit(name, { stage, owner, stageName, idleKey, settle = 1200, extra } = {}) {
    await sleep(settle);
    const file = join(outDir, `${config.name}--${name}.png`);
    await page.screenshot({ path: file, scale: shotScale });
    const row = { screen: name, file };
    row.scale = await page.evaluate(probe.scaleInfo(stage));
    row.scroll = await page.evaluate(probe.scrollAreas(stage, owner, stageName));
    row.rings = await page.evaluate(probe.rings(stage));
    row.glyphs = await page.evaluate(probe.glyphs(stage));
    row.targets = await page.evaluate(probe.targets(stage, owner));
    if (extra) row.extra = await extra();
    if (idleKey && idleMs > 0) {
      const a = await counters(page);
      await sleep(idleMs);
      const d = delta(a, await counters(page));
      const perSec = (n) => +(((n ?? 0) * 1000) / idleMs).toFixed(1);
      // One canvas (app-canvas) draws the world, then the UI: any frame with draws is a UI frame;
      // world-pass draws and shadow-map renders come from window.__poketoneRender.
      const ui = Object.entries(d.frames).find(([k]) => k.startsWith("app-canvas"))?.[1];
      const { world, shadow } = d;
      row.idle = {
        key: idleKey,
        expect: IDLE[idleKey],
        raf: perSec(d.raf),
        ui: perSec(ui),
        world: perSec(world),
        shadow: perSec(shadow),
        canvases: Object.fromEntries(Object.entries(d.frames).map(([k, v]) => [k, perSec(v)])),
        compiles: Object.values(d.compile).reduce((s, v) => s + v, 0),
      };
    }
    row.logs = logs.slice(logMark);
    logMark = logs.length;
    visits.push(row);
    return row;
  }
  /** A step that failed to reach its screen; logged as a drive failure, the walk goes on. */
  function failed(name, error) {
    visits.push({
      screen: name,
      error: String(error?.message ?? error),
      logs: logs.slice(logMark),
    });
    logMark = logs.length;
  }
  return { visit, failed, visits };
}

/** Each step is attempted in turn; a step that throws is recorded and the walk continues where it can. */
async function step(v, name, fn) {
  try {
    await fn();
    return true;
  } catch (error) {
    v.failed(name, error);
    return false;
  }
}

export async function walk(ctx) {
  const { page, config, screens } = ctx;
  const v = createVisitor(ctx);
  const want = (s) => screens.includes(s);
  const runWanted = ["partner", "hud", "pause", "stats", "cards", "station", "result"].some(want);

  await waitLobby(page);
  ctx.effectiveScale = await page.evaluate(probe.scaleInfo(LS));
  const lobby = { stage: LS, owner: LOBBY, stageName: "lobby", idleKey: "lobby" };

  if (want("lobby")) await step(v, "lobby", () => v.visit("lobby", lobby));

  if (want("settings") || want("save")) {
    await step(v, "settings", async () => {
      await pressLobby(page, config, "settings");
      await until(page, `!!${UI}.dialog`, "settings dialog");
      if (want("settings"))
        await v.visit("settings", {
          stage: `${UI}.dialog.stage`,
          owner: `${UI}.dialog`,
          stageName: "settings",
          idleKey: "settings",
        });
    });
    if (want("save"))
      await step(v, "save", async () => {
        if (!(await page.evaluate(`!!${UI}.dialog`))) {
          await pressLobby(page, config, "settings");
          await until(page, `!!${UI}.dialog`, "settings dialog");
        }
        await press(page, config, `${UI}.dialog.stage`, "存档");
        await until(
          page,
          `${UI}.screens.some((s) => s.constructor.name === "GpuSaveDialog")`,
          "save dialog",
        );
        await v.visit("save", {
          stage: `${TOP}.stage`,
          owner: TOP,
          stageName: "save",
          idleKey: "save",
        });
      });
    await step(v, "settings-close", () => toLobby(page));
  }

  if (want("lab")) {
    const opened = await step(v, "lab", async () => {
      await press(page, config, LS, "研究所");
      await until(page, `!!${LAB}`, "lab screen", 20_000);
    });
    if (opened)
      for (const [id, label] of LAB_TABS)
        await step(v, `lab-${id}`, async () => {
          await sleep(600);
          await press(page, config, `${LAB}.stage`, label);
          await until(page, `${LAB}.section === ${JSON.stringify(id)}`, `lab tab ${id}`);
          await v.visit(`lab-${id}`, {
            stage: `${LAB}.stage`,
            owner: LAB,
            stageName: "lab",
            idleKey: "lab",
          });
        });
    await step(v, "lab-close", () => toLobby(page));
  }

  if (want("codex")) {
    const C = `${UI}.codex`;
    const opened = await step(v, "codex", async () => {
      await press(page, config, LS, "图鉴");
      await until(page, `!!${C}`, "图鉴", 30_000);
      await sleep(1500);
    });
    if (opened) {
      for (const [index, [id, label, model]] of CODEX_TABS.entries()) {
        await step(v, `codex-${id}`, async () => {
          await press(page, config, `${C}.stage`, label);
          await until(page, `${C}.section === ${index}`, `图鉴 tab ${id}`);
          await v.visit(`codex-${id}`, {
            stage: `${C}.stage`,
            owner: C,
            stageName: "codex",
            idleKey: model ? "codex-model" : "codex",
            settle: 1500,
          });
        });
        await step(v, `codex-${id}-page`, async () => {
          // A direct pick of another row: scrolled into view by focus, then pressed.
          const row = await page.evaluate(`(() => { const c = ${C};
            const r = c.entries.find((e) => e.key !== c.selectedKey && e.panel.isVisible.value);
            return r ? c.controls.indexOf(r) : -1; })()`);
          if (row < 0) throw new Error(`no second row on 图鉴 tab ${id}`);
          await page.evaluate(`${C}.focus(${row}, false)`);
          await sleep(500);
          const key = await page.evaluate(`${C}.controls[${row}].key`);
          await pointAt(
            page,
            config,
            await centre(page, `${C}.controls[${row}].panel`, `${C}.stage`),
          );
          await until(page, `${C}.selectedKey === ${JSON.stringify(key)}`, `图鉴 row ${key}`);
          await v.visit(`codex-${id}-page`, {
            stage: `${C}.stage`,
            owner: C,
            stageName: "codex",
            settle: 1500,
          });
        });
      }
      await step(v, "codex-back", () => codexBack(page, config, v));
      await step(v, "codex-focus-walk", () => codexFocusWalk(page, v));
    }
    await step(v, "codex-close", () => toLobby(page));
  }

  if (runWanted) {
    const started = await step(v, "partner", async () => {
      if (want("partner")) {
        // Switch partner with › and back: the stage, name card and roster rebuild in place.
        const before = await page.evaluate(`${LOBBY}.selected`);
        await pressLobby(page, config, "next");
        await until(page, `${LOBBY}.selected !== ${JSON.stringify(before)}`, "partner switched");
        await v.visit("partner", { ...lobby, settle: 2500 });
        await pressLobby(page, config, "prev");
        await until(
          page,
          `${LOBBY}.selected === ${JSON.stringify(before)}`,
          "partner switched back",
        );
      }
      await press(page, config, LS, "出发");
      await until(page, `window.__poketoneWorld?.tick > 30 && !!${HUD}`, "run start", 60_000);
      // Keep the walk alive however long it takes; the HUD clock reads 2:05.
      await page.evaluate(() => {
        const w = window.__poketoneWorld;
        w.players[0].invulnerable = 1e6;
        w.time = 125;
      });
    });
    if (started) await runScreens(page, config, v, want);
  }
  return v.visits;
}

const centre = (page, panelExpr, stageExpr) =>
  page.evaluate(`(() => { const st = ${stageExpr}, v = st.viewport, m = (${panelExpr}).globalMatrix.value.elements;
    return [(m[12] - st.camera.left) * v.scale, (st.camera.top - m[13]) * v.scale]; })()`);

/** 图鉴 back trail: follow a link to another tab, go back, the tab, row and both scrolls come back. */
async function codexBack(page, config, v) {
  const C = `${UI}.codex`;
  const state = () =>
    page.evaluate(`(() => { const c = ${C}; return { section: c.section, key: c.selectedKey, trail: c.trail.length,
      list: +c.listPane.scrollPosition.value[1].toFixed(1), detail: +c.detailPane.scrollPosition.value[1].toFixed(1) }; })()`);
  await press(page, config, `${C}.stage`, "宝可梦");
  await until(page, `${C}.section === 0`, "图鉴 宝可梦 tab");
  await sleep(800);
  const link = await page.evaluate(`(() => { const c = ${C}, here = c.section;
    return c.controls.findIndex((k) => k.region === "ref" && k.key &&
      c.sections.findIndex((s) => s.groups.some((g) => g.entries.some((e) => e.key === k.key))) !== here); })()`);
  if (link < 0) throw new Error("no cross-tab link on the 宝可梦 page");
  await page.evaluate(`${C}.focus(${link}, false)`);
  await sleep(600);
  const before = await state();
  if (config.touch)
    await pointAt(page, config, await centre(page, `${C}.controls[${link}].panel`, `${C}.stage`));
  else await keys(page, "Enter");
  await until(page, `${C}.trail.length === 1`, "图鉴 link followed");
  await v.visit("codex-link", { stage: `${C}.stage`, owner: C, stageName: "codex", settle: 1200 });
  if (config.touch)
    await pointAt(page, config, await centre(page, `${C}.backKey.panel`, `${C}.stage`));
  else await keys(page, "Escape");
  await until(page, `${C}.trail.length === 0`, "图鉴 back");
  await sleep(1200);
  const after = await state();
  const restored = ["section", "key", "list", "detail"].every((k) => before[k] === after[k]);
  await v.visit("codex-back", {
    stage: `${C}.stage`,
    owner: C,
    stageName: "codex",
    settle: 300,
    extra: async () => ({
      backRestored: restored,
      before,
      after,
      open: await page.evaluate(`!!${C}`),
    }),
  });
  if (!restored) throw new Error(`图鉴 back did not restore ${JSON.stringify({ before, after })}`);
}

/** Keyboard walk down the 图鉴 list: each focused row's ring must show whole once scrolled to. */
async function codexFocusWalk(page, v) {
  const C = `${UI}.codex`;
  await keys(page, "Tab");
  const clipped = [];
  let count = 0;
  for (let i = 0; i < 14; i++) {
    await keys(page, "ArrowDown");
    await sleep(250);
    const r = await page.evaluate(
      probe.rings(`${C}.stage`, `${C}.controls[${C}.focusIndex].panel`),
    );
    count += r.count ?? 0;
    clipped.push(...(r.clipped ?? []));
  }
  v.visits.push({ screen: "codex-focus-walk", rings: { count, clipped }, logs: [] });
}

/** Page position of a HUD control's centre. */
async function hudControl(page, action) {
  const at = await page.evaluate(`(() => { const h = ${HUD}, st = h.stage, v = st.viewport;
    const c = h.controls.find((k) => k.action === ${JSON.stringify(action)}); if (!c) return null;
    const m = c.panel.globalMatrix.value.elements;
    return [(m[12] - st.camera.left) * v.scale, (st.camera.top - m[13]) * v.scale]; })()`);
  if (!at) throw new Error(`HUD has no ${action} control`);
  return at;
}

/** Page position of the open run window's close key. */
async function closeKey(page) {
  const at = await page.evaluate(`(() => { const o = ${OV}, st = o.stage, v = st.viewport;
    const c = o.controls[o.window.closeIndex]; if (!c) return null;
    const m = c.panel.globalMatrix.value.elements;
    return [(m[12] - st.camera.left) * v.scale, (st.camera.top - m[13]) * v.scale]; })()`);
  if (!at) throw new Error("run window has no close key");
  return at;
}

async function runScreens(page, config, v, want) {
  const ov = { stage: `${OV}.stage`, owner: OV, stageName: "overlays" };
  const kind = (k) => `${OV}?.state?.kind === ${JSON.stringify(k)}`;
  const openPause = async () => {
    if (config.touch) await pointAt(page, config, await hudControl(page, "pause"));
    else await keys(page, "KeyP");
    await until(page, kind("pause"), "pause window");
  };

  if (want("hud"))
    await step(v, "hud", () =>
      v.visit("hud", {
        stage: `${HUD}.stage`,
        owner: HUD,
        stageName: "hud",
        idleKey: "hud",
        settle: 1500,
        extra: () => page.evaluate(probe.hudCentring),
      }),
    );

  if (want("hud"))
    await step(v, "hud-team", async () => {
      // Three teammates under the vitals: one hurt, one low, one down.
      await page.evaluate(() => {
        const w = window.__poketoneWorld,
          me = w.players[0];
        [0.8, 0.2, 0].forEach((share, i) => {
          const mate = structuredClone(me);
          // No moves: they fire nothing, so nothing of theirs outlives them in the world.
          Object.assign(mate, {
            id: i + 1,
            x: me.x + 3 + i,
            level: 4 + i * 5,
            moves: [],
            items: [],
          });
          mate.alive = share > 0;
          mate.hp = share * me.hp;
          w.players.push(mate);
        });
      });
      await sleep(400);
      await v.visit("hud-team", {
        stage: `${HUD}.stage`,
        owner: HUD,
        stageName: "hud",
        settle: 800,
      });
      await page.evaluate(() => {
        for (const mate of window.__poketoneWorld.players.slice(1)) mate.departed = true;
      });
      await sleep(300);
    });

  if (want("stats"))
    await step(v, "stats", async () => {
      // A mid-run build, so both pages carry real rows: four moves with damage, four items.
      await page.evaluate(() => {
        const w = window.__poketoneWorld,
          pl = w.players[0],
          base = pl.moves[0];
        const extra = ["fire-spin", "flamethrower", "fire-blast"].filter(
          (id) => !pl.moves.some((m) => m.id === id),
        );
        for (const id of extra.slice(0, 4 - pl.moves.length))
          pl.moves.push({ ...structuredClone(base), id, level: 3 });
        pl.moves.forEach((m, i) => (m.damage = [18420, 9310, 4120, 860][i] ?? 0));
        pl.items = [
          { id: "life-orb", level: 2 },
          { id: "leftovers", level: 3 },
          { id: "scope-lens", level: 1 },
          { id: "rocky-helmet", level: 1 },
        ];
        pl.kills = 312;
      });
      // The build panel opens from the HUD button on touch, C elsewhere; 战况 first, then 属性.
      if (config.touch) await pointAt(page, config, await hudControl(page, "stats"));
      else await keys(page, "KeyC");
      await until(page, kind("stats"), "build panel");
      await v.visit("stats", { ...ov, idleKey: "stats" });
      if (config.touch) await press(page, config, `${OV}.stage`, "属性");
      else await keys(page, "PageDown");
      await until(page, `${OV}.content?.page === 1`, "属性 page shown");
      await v.visit("stats-attributes", { ...ov, idleKey: "stats", settle: 600 });
      // Touch closes with the close key: a key press would hand the next tap to the mode switch.
      if (config.touch) await pointAt(page, config, await closeKey(page));
      else await keys(page, "Escape");
      await until(page, `!${OV}.isModal`, "build panel closed");
      await sleep(400);
    });

  if (want("pause"))
    await step(v, "pause", async () => {
      await openPause();
      await v.visit("pause", { ...ov, idleKey: "pause" });
      {
        // 放弃冒险 asks first; 取消 returns to the pause list.
        await press(page, config, `${OV}.stage`, "放弃冒险");
        await until(page, `${OV}.state?.quitting === true`, "放弃 question");
        await v.visit("pause-quit", { ...ov, settle: 900 });
        await press(page, config, `${OV}.stage`, "取消");
        await until(
          page,
          `${OV}.state?.kind === "pause" && !${OV}.state.quitting`,
          "back from 放弃 question",
        );
      }
      await sleep(400);
      await press(page, config, `${OV}.stage`, "继续");
      await until(page, `!${OV}.isModal`, "pause closed");
    });

  if (want("cards"))
    await step(v, "cards", async () => {
      await page.evaluate(() => {
        const w = window.__poketoneWorld,
          pl = w.players[0];
        w.pickups.push({ id: w.nextId++, kind: "xp", x: pl.x, z: pl.z, value: 30, magnet: true });
      });
      await until(page, kind("choice"), "level-up cards");
      await v.visit("cards", { ...ov, idleKey: "cards", settle: 3000 });
      for (let n = 0; n < 20; n++) {
        if (!(await page.evaluate(() => window.__poketoneWorld.players[0].pending.length))) break;
        await keys(page, "Enter");
        await sleep(700);
      }
      await until(page, `!${OV}.isModal`, "cards closed");
    });

  if (want("station"))
    await step(v, "station", async () => {
      await page.evaluate(() => {
        const w = window.__poketoneWorld,
          pl = w.players[0],
          s = w.stations.find((x) => x.kind === "hypno");
        const a = Math.atan2(pl.z - s.z, pl.x - s.x),
          r = s.radius + 0.9;
        pl.x = pl.px = s.x + Math.cos(a) * r;
        pl.z = pl.pz = s.z + Math.sin(a) * r;
      });
      await sleep(900);
      await keys(page, "KeyR");
      await until(page, kind("station"), "station window");
      await v.visit("station", { ...ov, idleKey: "station" });
      await keys(page, "Escape");
      await until(page, `!${OV}.isModal`, "station closed");
    });

  if (want("result"))
    await step(v, "result", async () => {
      // 放弃 now returns straight to the lobby; the result screen follows a run that ends.
      await page.evaluate(() => {
        window.__poketoneWorld.outcome = "defeat";
      });
      await until(page, kind("result"), "result after the run ends", 20_000);
      await v.visit("result", { ...ov, idleKey: "result", settle: 3000 });
      for (const label of ["再来一局", "返回大厅"])
        if (!(await locate(page, `${OV}.stage`, label))) throw new Error(`result has no ${label}`);
      await press(page, config, `${OV}.stage`, "返回大厅");
      await until(page, `!window.__poketoneWorld && !!${LOBBY}`, "lobby after 返回大厅", 20_000);
      await v.visit("result-to-lobby", {
        stage: LS,
        owner: LOBBY,
        stageName: "lobby",
        settle: 1500,
      });
    });
}
