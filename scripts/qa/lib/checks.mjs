// Verdicts: each defect class becomes { id, title, blocking, pass, details[] } over every config's
// visits. Blocking checks are behavioural defects (FAIL fails the run). Diagnostics (centring, idle
// fps, first screen, frame time) report measurements, with outliers in `details`, and never fail it.
import {
  CENTRE_VISIBLE_PX,
  CONSOLE_IGNORE,
  IDLE_SLACK,
  SCROLL_ALLOW,
  SLIVER,
  TOUCH_MIN_PX,
  TOUCH_SCALE,
} from "../config.mjs";

const verdict = (id, title, details, extra = {}) => ({
  id,
  title,
  blocking: true,
  pass: extra.skipped ? null : details.length === 0,
  details,
  ...extra,
});

export function judge(runs, specials) {
  const visits = runs.flatMap((r) =>
    r.visits.map((v) => ({ ...v, config: r.config.name, cfg: r.config })),
  );
  const at = (v) => `${v.config} ${v.screen}`;
  const out = [];

  out.push(
    verdict("drive", "Every screen reached through input", [
      ...runs.filter((r) => r.error).map((r) => `${r.config.name}: ${r.error}`),
      ...runs
        .filter((r) => r.reloads > 0)
        .map((r) => `${r.config.name}: page reloaded ${r.reloads}× mid-walk`),
      ...visits.filter((v) => v.error).map((v) => `${at(v)}: ${v.error}`),
    ]),
  );

  const logLines = [
    ...visits.flatMap((v) => (v.logs ?? []).map((l) => [at(v), l])),
    ...runs.flatMap((r) => (r.tailLogs ?? []).map((l) => [`${r.config.name} (after walk)`, l])),
  ].filter(([, l]) => !CONSOLE_IGNORE.some((re) => re.test(l.text)));
  out.push(
    verdict(
      "a-console",
      "(a) No console errors, warnings or page errors",
      logLines.map(([where, l]) => `${where}: [${l.type}] ${l.text.slice(0, 300)}`),
    ),
  );

  out.push(
    verdict(
      "b-glyphs",
      "(b) No missing glyphs",
      [
        ...logLines
          .filter(([, l]) => /missing glyph/i.test(l.text))
          .map(([w, l]) => `${w}: ${l.text}`),
        ...visits.flatMap((v) => (v.glyphs?.missing ?? []).map((m) => `${at(v)}: ${m}`)),
        ...visits.filter((v) => v.glyphs?.error).map((v) => `${at(v)}: probe ${v.glyphs.error}`),
      ],
      { textsChecked: visits.reduce((s, v) => s + (v.glyphs?.texts ?? 0), 0) },
    ),
  );

  const scroll = [];
  for (const v of visits)
    for (const a of v.scroll?.areas ?? []) {
      const allowed = SCROLL_ALLOW.some((re) => re.test(a.name));
      const most = Math.max(...a.max);
      const why = !allowed
        ? "not a designed scroll area"
        : most < SLIVER
          ? `sliver (< ${SLIVER} units)`
          : null;
      if (why)
        scroll.push(
          `${at(v)}: ${a.name} max=${JSON.stringify(a.max)} size=${JSON.stringify(a.size)} — ${why}${a.over.length ? "; past edge: " + a.over.join(" | ") : ""}`,
        );
    }
  out.push(verdict("c-scroll", "(c) No unintended scroll overflow", scroll));

  const published = visits.reduce((s, v) => s + (v.rings?.published ?? 0), 0);
  out.push(
    verdict(
      "d-rings",
      "(d) Focus rings not clipped by clipping ancestors",
      visits.flatMap((v) => [
        ...(v.rings?.clipped ?? []).map((c) => `${at(v)}: ${c}`),
        ...(v.rings?.error ? [`${at(v)}: probe ${v.rings.error}`] : []),
      ]),
      {
        ringsChecked: visits.reduce((s, v) => s + (v.rings?.count ?? 0), 0),
        reachSource: published
          ? "userData.ringReach (UI)"
          : "computed from userData.ring {offset,width}; no ringReach hook published",
      },
    ),
  );

  // Every touch config is checked; the contract scale (80%, smallest targets) is the decisive one.
  const small = [];
  const touchRuns = runs.filter((r) => r.config.touch);
  for (const v of visits.filter((v) => v.cfg.touch)) {
    const seen = new Set();
    for (const t of v.targets?.rows ?? []) {
      const side = Math.min(t.w, t.h);
      const key = `${t.label} ${t.w}×${t.h}`;
      if (side < TOUCH_MIN_PX && !seen.has(key)) {
        seen.add(key);
        small.push(`${at(v)}: "${t.label}" ${t.w}×${t.h} px at (${t.x}, ${t.y})`);
      }
    }
  }
  const atContract = touchRuns.some((r) => r.config.uiScale === TOUCH_SCALE);
  out.push(
    verdict(
      "e-touch",
      `(e) Touch targets ≥ ${TOUCH_MIN_PX} host px (contract at ${TOUCH_SCALE * 100}%)`,
      small,
      {
        skipped: touchRuns.length ? undefined : "no touch config selected",
        note:
          touchRuns.length && !atContract
            ? `measured at ${[...new Set(touchRuns.map((r) => r.config.uiScale * 100))].join("/")}% only; the ${TOUCH_SCALE * 100}% contract needs --configs phone-844x390@80 (in --preset final)`
            : undefined,
      },
    ),
  );

  const centring = [];
  const offsets = [];
  const hudVisits = visits.filter((v) => v.screen === "hud" && v.extra);
  for (const v of hudVisits) {
    const e = v.extra;
    if (e.error) {
      centring.push(`${at(v)}: ${e.error}`);
      continue;
    }
    const row = [];
    for (const k of ["clock", "meta", "compass"]) {
      if (e[k] == null) {
        centring.push(`${at(v)}: ${k} not found`);
        continue;
      }
      const off = e[k] - e.rowMid;
      row.push(`${k} ${off >= 0 ? "+" : ""}${off.toFixed(2)}`);
      if (Math.abs(off) > CENTRE_VISIBLE_PX)
        centring.push(
          `${at(v)}: ${k} off centre by ${off.toFixed(2)} px (visible above ${CENTRE_VISIBLE_PX})`,
        );
    }
    offsets.push(`${v.config}: ${row.join(", ")} px (device px ${(1 / v.cfg.dpr).toFixed(2)})`);
  }
  out.push(
    verdict("f-centring", "(f) HUD clock, meta line and compass centring", centring, {
      blocking: false,
      measurements: offsets,
      skipped: hudVisits.length ? undefined : "HUD not visited",
    }),
  );

  const idle = [];
  const rates = new Map();
  const idleRows = visits.filter((v) => v.idle);
  for (const v of idleRows) {
    const { expect, raf } = v.idle;
    for (const canvas of ["ui", "world", "shadow"]) {
      // Shadow maps render only with the world pass: they share its expected rate.
      const want = canvas === "shadow" ? expect.world : expect[canvas];
      if (want === undefined) continue;
      const hz = want === "raf" ? raf : want;
      const limit = want === 0 ? 1 : hz + IDLE_SLACK(hz);
      const key = `${v.screen} ${canvas} (table ${want})`;
      rates.set(key, [...(rates.get(key) ?? []), v.idle[canvas]]);
      if (v.idle[canvas] > limit)
        idle.push(
          `${at(v)}: ${canvas} ${v.idle[canvas]}/s vs table ${want === "raf" ? "rAF " + raf : hz}`,
        );
    }
  }
  out.push(
    verdict("g-idle", "(g) Idle redraw rate vs DESIGN's 空闲循环 table", idle, {
      blocking: false,
      measurements: [...rates].map(([k, v]) => `${k}: ${Math.min(...v)}–${Math.max(...v)} fps`),
      skipped: idleRows.length ? undefined : "idle sampling off",
    }),
  );

  const special = (id, title, rows, blocking = true) =>
    verdict(
      id,
      title,
      rows
        .filter((r) => !r.result.pass)
        .map((r) => `${r.config}: ${r.result.error ?? JSON.stringify(summarise(r.result))}`),
      { blocking, skipped: rows.length ? undefined : "not run", results: rows },
    );
  out.push(
    special(
      "h-lifecycle",
      "(h) Lifecycle with context loss: 0 WebGL errors, same canvases and contexts",
      specials.lifecycle,
    ),
  );
  out.push(
    special(
      "i-first-screen",
      "(i) First screen at 10 Mbps, production build (reference target 6 s)",
      specials.firstScreen,
      false,
    ),
  );
  out.push(
    special("j-frame-time", "(j) In-run frame time, dense late run", specials.frameTime, false),
  );
  return out;
}

function summarise(r) {
  const { steps: _steps, otherLogs: _o, ...rest } = r;
  return rest;
}
