// Contact sheets (rendered in the suite's own Chrome: no image library needed) and the summary.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

async function sheet(browser, title, shots, file, cols) {
  const cells = shots
    .map(
      (s) =>
        `<figure><img src="data:image/png;base64,${readFileSync(s.file).toString("base64")}"><figcaption>${escape(s.label)}</figcaption></figure>`,
    )
    .join("");
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:12px;background:#1b2433;color:#e8eef7;font:13px -apple-system,sans-serif}
    h1{font-size:16px;margin:0 0 10px}
    main{display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px}
    figure{margin:0;background:#0d1520;padding:4px;border-radius:4px}
    img{width:100%;display:block}
    figcaption{padding:4px 2px 0;font-size:12px}
  </style><h1>${escape(title)}</h1><main>${cells}</main>`;
  const page = await browser.newPage({
    viewport: { width: 1800, height: 900 },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: file, fullPage: true });
  } finally {
    await page.close();
  }
  return file;
}

/** One sheet per config (all its screens) and one per screen (all configs). */
export async function contactSheets(browser, runs, outDir) {
  const files = [];
  const shots = runs.flatMap((r) =>
    r.visits
      .filter((v) => v.file)
      .map((v) => ({ config: r.config.name, screen: v.screen, file: v.file })),
  );
  for (const r of runs) {
    const mine = shots
      .filter((s) => s.config === r.config.name)
      .map((s) => ({ ...s, label: s.screen }));
    if (mine.length)
      files.push(
        await sheet(
          browser,
          r.config.name,
          mine,
          join(outDir, `sheet-config-${r.config.name}.png`),
          4,
        ),
      );
  }
  for (const screen of new Set(shots.map((s) => s.screen))) {
    const mine = shots.filter((s) => s.screen === screen).map((s) => ({ ...s, label: s.config }));
    files.push(await sheet(browser, screen, mine, join(outDir, `sheet-screen-${screen}.png`), 3));
  }
  return files;
}

const mark = (pass) => (pass === null ? "SKIP" : pass ? "PASS" : "FAIL");
/** Blocking checks: PASS / FAIL / SKIP. Diagnostics: OK / OUTLIERS / SKIP (never fail the run). */
export const label = (c) =>
  c.blocking ? mark(c.pass) : c.pass === null ? "SKIP" : c.pass ? "OK" : "OUTLIERS";

export function writeReport(outDir, report) {
  const json = join(outDir, "results.json");
  writeFileSync(json, JSON.stringify(report, null, 1));
  const lines = [
    `# poketone visual QA — ${report.startedAt}`,
    "",
    `Tree: ${report.tree}  ·  Chrome ${report.chrome}  ·  runtime ${(report.runtimeMs / 60000).toFixed(1)} min  ·  verdict **${report.pass ? "PASS" : "FAIL"}**`,
    "",
    "## Effective UI scale per config",
    "",
    "| config | requested | lobby stage scale | pixel grid |",
    "| --- | --- | --- | --- |",
    ...report.configs.map(
      (c) =>
        `| ${c.name} | ${c.uiScale} | ${c.effective?.scale ?? "?"} | ${c.effective?.grid ?? "?"} |`,
    ),
    "",
    ...[
      ["## Blocking checks", "FAIL = a behavioural defect; any FAIL fails the run.", true],
      ["## Diagnostics", "Measured and reported, outliers flagged; never fail the run.", false],
    ].flatMap(([heading, note, blocking]) => [
      heading,
      "",
      note,
      "",
      ...report.checks
        .filter((c) => c.blocking === blocking)
        .flatMap((c) => [
          `### ${label(c)} ${c.title}`,
          ...(c.skipped ? [`skipped: ${c.skipped}`] : []),
          ...["note", "textsChecked", "ringsChecked", "reachSource"]
            .filter((k) => c[k] !== undefined)
            .map((k) => `${k}: ${c[k]}`),
          ...(c.results ?? []).map((r) => `- ${r.config}: ${JSON.stringify(brief(r.result))}`),
          ...(c.measurements ?? []).map((m) => `- ${m}`),
          ...(c.details.length ? ["", blocking ? "Defects:" : "Outliers:"] : []),
          ...c.details.slice(0, 40).map((d) => `- ${d}`),
          ...(c.details.length > 40 ? [`- … ${c.details.length - 40} more in results.json`] : []),
          "",
        ]),
    ]),
    "## Files",
    "",
    `- results.json, summary.md, screenshots \`<config>--<screen>.png\``,
    ...report.sheets.map((f) => `- ${basename(f)}`),
    "",
  ];
  const md = join(outDir, "summary.md");
  writeFileSync(md, lines.join("\n"));
  return { json, md };
}

function brief(r) {
  const keep = [
    "firstScreenMs",
    "firstDrawMs",
    "targetMs",
    "medianMs",
    "p95Ms",
    "maxMs",
    "enemies",
    "advancedTicksIn1s",
    "error",
  ];
  const out = Object.fromEntries(keep.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
  if (r.identity) out.identity = r.identity;
  if (r.target) out.target = r.target;
  if (r.webglErrors) out.webglErrors = r.webglErrors.length;
  return out;
}
