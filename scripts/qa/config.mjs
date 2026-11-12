// What the visual QA suite runs and what it holds the result to.

const SAFE = { top: 0, left: 47, bottom: 21, right: 47 };

/** Phones: touch, DPR 3, a notch-and-home-bar safe area. Desktops: mouse, DPR 1 (the crisp-edge worst case). */
export const CONFIGS = [
  ...[
    [844, 390],
    [932, 430],
    [667, 375],
  ].flatMap(([width, height]) =>
    [0.8, 1, 1.5].map((uiScale) => ({
      name: `phone-${width}x${height}@${Math.round(uiScale * 100)}`,
      kind: "phone",
      width,
      height,
      uiScale,
      dpr: 3,
      touch: true,
      safe: SAFE,
    })),
  ),
  ...[
    [1280, 800],
    [1440, 900],
  ].flatMap(([width, height]) =>
    [1, 1.5].map((uiScale) => ({
      name: `desktop-${width}x${height}@${Math.round(uiScale * 100)}`,
      kind: "desktop",
      width,
      height,
      uiScale,
      dpr: 1,
      touch: false,
      safe: null,
    })),
  ),
];

/** Default configs, and the ones the special checks use: one desktop, one phone. */
export const PROBE_CONFIGS = ["desktop-1280x800@100", "phone-844x390@100"];
/** `--preset final` adds the phone at 80%, where the touch-target contract is measured. */
export const FINAL_CONFIGS = [...PROBE_CONFIGS, "phone-844x390@80"];

/** With no --screens (and no preset) only these run: a smoke test, not a review. */
export const SMOKE_SCREENS = ["lobby"];
/** Opt-in special checks (--with): lifecycle with context loss, perf (frame time), first-screen (production build). */
export const SPECIALS = ["lifecycle", "perf", "first-screen"];

export const SCREENS = [
  "lobby",
  "settings",
  "save",
  "lab",
  "codex",
  "partner",
  "hud",
  "pause",
  "stats",
  "cards",
  "station",
  "result",
];

/**
 * DESIGN.md 空闲循环 table: the most UI-canvas frames per second a settled screen may draw with no
 * input ("raf" = every frame, the run's own loop). `world` is world-pass renders a second while that
 * screen is up (a frozen world skips render: docs/LESSONS.md, 暂停、选卡时什么都不动); shadow-map
 * renders are held to the same rate.
 */
export const IDLE = {
  // The lobby carries the partner stage (light motes, idle sway) at 30 Hz.
  lobby: { ui: 30 },
  settings: { ui: 15 },
  save: { ui: 15 },
  lab: { ui: 15 },
  // Model tabs turn their GLB at 30 Hz; the other tabs only have the header band at 15 Hz.
  "codex-model": { ui: 30 },
  codex: { ui: 15 },
  hud: { ui: "raf", world: "raf" },
  pause: { ui: 15, world: 0 },
  stats: { ui: 15, world: 0 },
  cards: { ui: 15, world: 0 },
  station: { ui: 15, world: 0 },
  result: { ui: 15, world: 0 },
};
/** Measured rate may exceed the table by this much (sampling jitter of a 2 s window): above it is a diagnostic outlier. */
export const IDLE_SLACK = (hz) => hz * 0.1 + 1;
/**
 * "Far off the documented loops" (a blocking failure): more than IDLE_FAR × the table's rate plus
 * slack, or a frozen world canvas drawing more than IDLE_FROZEN_MAX frames a second.
 */
export const IDLE_FAR = 2;
export const IDLE_FROZEN_MAX = 5;

/**
 * Designed scroll areas: they may scroll when their content is longer than the box. Anything else
 * that can scroll fails, and so does a designed area that overflows by less than SLIVER units (the
 * sub-pixel fake scroll bars of docs/LESSONS.md, 亚像素滚动条).
 */
export const SCROLL_ALLOW = [
  /^codex\.(listPane|detailPane)$/,
  /^lab\.content$/,
  /^settings\.body$/,
  /^overlays\.(body|content)$/,
];
export const SLIVER = 2;

export const TOUCH_MIN_PX = 44;
/** The touch-target check runs at the smallest UI scale, where targets are smallest. */
export const TOUCH_SCALE = 0.8;

/**
 * Acceptance is visual quality, not pixel matching: centring offsets are diagnostics, and only an
 * offset a player would see (more than this many host px) is highlighted.
 */
export const CENTRE_VISIBLE_PX = 2;

/**
 * First screen on the production build, cold cache, 10 Mbps down / 40 ms. The 6 s is a reference
 * target ("quality beats load time"): measured and reported, never blocking.
 */
export const FIRST_SCREEN = { targetMs: 6000, downBps: 10e6, upBps: 5e6, latencyMs: 40 };

/** In-run frame time, dense late run: reference rAF intervals (ms), diagnostic only. */
export const FRAME = { medianMs: 17.5, p95Ms: 33.4, lateTime: 470, warmupMs: 8000, sampleMs: 5000 };

/** Console lines that are not defects: Chrome's own favicon probe. */
export const CONSOLE_IGNORE = [/favicon\.ico/];
/** Expected during the lifecycle check only (three logs these on purpose). */
export const LIFECYCLE_EXPECTED = [/Context Lost/i, /Context Restored/i];
export const WEBGL_ERROR =
  /WebGL|GL_INVALID|INVALID_|too many errors|does not belong to this context/i;
