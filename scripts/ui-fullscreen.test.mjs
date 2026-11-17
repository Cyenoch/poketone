import assert from "node:assert/strict";
import test from "node:test";

test("fullscreen exit cancels the initial gesture path; only restore re-enters and locks again", async () => {
  const saved = new Map(
    ["window", "document", "navigator", "screen", "matchMedia"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const page = new EventTarget();
  const win = new EventTarget();
  let requests = 0,
    locks = 0,
    changes = 0;
  const root = {};
  Object.assign(page, {
    fullscreenEnabled: true,
    fullscreenElement: null,
    async exitFullscreen() {
      page.fullscreenElement = null;
      page.dispatchEvent(new Event("fullscreenchange"));
    },
    documentElement: {
      async requestFullscreen() {
        requests++;
        page.fullscreenElement = root;
        page.dispatchEvent(new Event("fullscreenchange"));
      },
    },
  });
  const globals = {
    window: win,
    document: page,
    navigator: {},
    screen: {
      orientation: {
        async lock(value) {
          assert.equal(value, "landscape");
          locks++;
        },
      },
    },
    matchMedia: (query) => ({ matches: query === "(pointer: coarse)" }),
  };
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  let stop;
  const { info, warn } = console;
  try {
    const landscape = await import("../src/platform/landscape.ts");
    landscape.requestLandscapeOnFirstTap();
    stop = landscape.onFullscreenChange(() => changes++);
    win.dispatchEvent(new Event("touchend"));
    await Promise.resolve();
    assert.equal(landscape.needsFullscreen(), false);
    assert.equal(requests, 1);
    assert.equal(locks, 1);
    await landscape.toggleFullscreen();
    assert.equal(landscape.needsFullscreen(), true);
    win.dispatchEvent(new Event("touchend"));
    assert.equal(requests, 1, "gameplay must not trap the player back in fullscreen");
    await landscape.toggleFullscreen();
    assert.equal(requests, 2);
    assert.equal(locks, 2);
    assert.equal(changes, 3);
    const notices = [];
    console.info = (...args) => notices.push(["info", ...args]);
    console.warn = (...args) => notices.push(["warn", ...args]);
    for (const name of [null, "NotSupportedError", "NotAllowedError"]) {
      await landscape.toggleFullscreen();
      globals.screen.orientation.lock = name
        ? async () => {
            throw new DOMException("orientation lock unavailable", name);
          }
        : undefined;
      await landscape.restoreFullscreen();
      assert.equal(page.fullscreenElement, root, "orientation failure must not exit fullscreen");
      assert.equal(landscape.needsFullscreen(), false);
      const notice = notices.at(-1);
      assert.equal(notice[0], name === "NotAllowedError" ? "warn" : "info");
      assert.match(notice[1], name === "NotAllowedError" ? /锁定失败/ : /不支持横屏锁定/);
    }
    assert.equal(notices.length, 3, "each unsupported or denied lock remains observable");
  } finally {
    console.info = info;
    console.warn = warn;
    stop?.();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
