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
  } finally {
    stop?.();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
