import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHarbor } from "../services/harbor/server.ts";
import { MultiplayerSession } from "../src/network/session.ts";
import { MultiplayerRun } from "../src/network/run.ts";
import { nativeAppStorage } from "../src/platform/native/app-storage.ts";

// Only drawing is replaced: the window lifecycle, storage, sessions and Harbor are real.
mock.module(new URL("../src/ui/gpu/multiplayer.ts", import.meta.url).pathname, () => ({
  GpuMultiplayer: class {
    constructor(_fonts, actions) {
      this.actions = actions;
    }
    update(state) {
      this.state = state;
    }
    dispose() {}
  },
}));
const { mountMultiplayer } = await import("../src/ui/gpu/multiplayer-session.ts");
globalThis.__GAME_BUILD__ = "network-test";
const until = async (condition) => {
  const deadline = Date.now() + 8000;
  while (!condition()) {
    assert(Date.now() < deadline, "等待联机窗口超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test("凭据读取、开局写入和关闭删除的真实 I/O 失败会通知，窗口、开局与连接清理继续", async () => {
  const dir = mkdtempSync(join(tmpdir(), "poketone-network-storage-"));
  const path = join(dir, "save");
  const credential = `${path}.rejoin.json`;
  const server = startHarbor({ port: 0, hostname: "127.0.0.1" });
  const url = `ws://127.0.0.1:${server.port}/multiplayer`;
  const abort = new AbortController();
  const connection = {
    signal: abort.signal,
    directPeer() {
      throw new Error("Use Harbor relay.");
    },
  };
  const host = new MultiplayerSession(url, "", { starter: "charmander" }, connection);
  let screen, guest, hostRun, unmount;
  const notifications = [];
  const logged = [];
  const report = console.error;
  console.error = (error) => logged.push(error);
  try {
    const storage = nativeAppStorage(path);
    writeFileSync(credential, "{}");
    chmodSync(credential, 0);
    await until(() => host.state.room);
    host.onStart = (config) => {
      hostRun = new MultiplayerRun(host, config);
    };
    unmount = mountMultiplayer(
      {
        fonts: {},
        registerScreen(value) {
          screen = value;
          return () => {};
        },
      },
      url,
      { starter: "squirtle", stage: "forest", difficulty: 0 },
      { starter: "squirtle" },
      () => {},
      (run) => {
        guest = run;
      },
      storage,
      connection,
      (message) => notifications.push(message),
    );
    assert(screen, "凭据读失败不阻止窗口挂载");
    assert.equal(screen.actions.rejoin, undefined);
    assert.match(notifications[0], /读取失败/);
    screen.actions.join(host.state.room.code);
    await until(() => host.state.canStart);
    host.start("forest", 0);
    await until(() => guest && hostRun);
    assert.match(notifications[1], /保存失败/);
    assert.equal(guest.session.state.error, "");
    unmount();
    unmount = undefined;
    chmodSync(dir, 0o500);
    guest.dispose();
    assert.equal(guest.session.closed, true, "删除失败也完成核心清理");
    await until(() => guest.session.socket.readyState === WebSocket.CLOSED);
    assert.match(notifications[2], /清除失败/);
    assert.equal(logged.length, 3);
    assert(logged.every((error) => error.cause.code === "EACCES"));
  } finally {
    console.error = report;
    abort.abort();
    unmount?.();
    host.close(false);
    guest?.dispose(false);
    chmodSync(dir, 0o700);
    chmodSync(credential, 0o600);
    rmSync(dir, { recursive: true, force: true });
    await server.shutdown();
  }
});
