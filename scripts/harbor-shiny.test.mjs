import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "bun:test";
import { startHarbor } from "../services/harbor/server.ts";
import { MultiplayerSession } from "../src/network/session.ts";
import { emptyProgress, setShinyLook } from "../src/run/progress.ts";

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
    assert(Date.now() < deadline, "等待异色席位同步超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

function room(t) {
  const server = startHarbor({ port: 0, hostname: "127.0.0.1" });
  const url = `ws://127.0.0.1:${server.port}/multiplayer`;
  const lifetime = new AbortController();
  t.after(async () => {
    lifetime.abort();
    await server.shutdown();
  });
  const connection = {
    signal: lifetime.signal,
    directPeer() {
      throw new Error("Use Harbor relay.");
    },
  };
  const host = new MultiplayerSession(
    url,
    "",
    { starter: "gastly", trainer: "chengxi", shiny: false },
    connection,
  );
  return { host, url, connection };
}

test("本机按伙伴穿戴异色，房主只能改自己的席位，开局和重返保留两人的选择", async (t) => {
  const { host, url, connection } = room(t);
  const progress = setShinyLook(
    { ...emptyProgress(), looks: { owned: ["gastly", "squirtle"], worn: [] } },
    "gastly",
    true,
  );
  const initial = { starter: "gastly", trainer: "yewei", stage: "forest", difficulty: 0 };
  let ticket = null;
  const storage = {
    loadRejoin: () => ticket,
    saveRejoin: (value) => (ticket = value),
  };
  let screen, guestRun, hostConfig;
  const mountGuest = (pick) =>
    mountMultiplayer(
      {
        fonts: {},
        registerScreen(registered) {
          screen = registered;
          return () => {};
        },
      },
      url,
      progress,
      pick,
      {
        close() {},
        settings() {},
        copy() {},
        pick() {},
        start(run) {
          guestRun = run;
        },
      },
      storage,
      connection,
      (message) => assert.fail(message),
    );
  let unmount = mountGuest(initial);
  t.after(() => unmount());
  await until(() => host.state.room);
  screen.actions.join(host.state.room.code);
  await until(() => host.state.canStart && screen.state?.room?.players.length === 2);
  assert.deepEqual(
    host.state.room.players.map(({ shiny }) => shiny),
    [false, true],
  );

  host.signal({ t: "setup", player: 1, starter: "gastly", trainer: "shuoye", shiny: false });
  await until(() => screen.state.room.players[0].trainer === "shuoye");
  assert.equal(screen.state.room.players[1].shiny, true, "房主不能取消客机的异色");

  screen.actions.pick({ ...initial, starter: "squirtle" });
  await until(() => host.state.room.players[1].starter === "squirtle");
  assert.equal(host.state.room.players[1].shiny, false, "已拥有但未穿戴的伙伴仍为普通");
  screen.actions.pick(initial);
  await until(() => host.state.room.players[1].starter === "gastly");
  assert.equal(host.state.room.players[1].shiny, true);

  host.onStart = (config) => {
    hostConfig = config;
  };
  host.start();
  await until(() => hostConfig && guestRun);
  assert.deepEqual(
    hostConfig.players.map(({ starter, shiny }) => [starter, shiny]),
    [
      ["gastly", false],
      ["gastly", true],
    ],
  );
  assert.deepEqual(guestRun.config, hostConfig);

  guestRun.session.close(false);
  guestRun = undefined;
  unmount();
  await until(() => !host.state.room.online.includes(1));
  unmount = mountGuest({ ...initial, starter: "squirtle" });
  screen.actions.rejoin.action();
  await until(() => guestRun);
  assert.equal(guestRun.player, 1);
  assert.deepEqual(guestRun.config, hostConfig, "重返采用原席位选择");
  assert.deepEqual(screen.state.room.players, hostConfig.players);
});

test("Harbor 拒绝入座和更新选择中的非布尔异色值", async (t) => {
  const { host, url, connection } = room(t);
  await until(() => host.state.room);
  const player = { starter: "gastly", trainer: "yewei", shiny: true };
  const invalid = new MultiplayerSession(
    url,
    host.state.room.code,
    { ...player, shiny: "true" },
    connection,
  );
  await until(() => invalid.state.error);
  assert.match(invalid.state.error, /异色外观选择无效/);
  assert.equal(host.state.room.players.length, 1);

  const guest = new MultiplayerSession(url, host.state.room.code, player, connection);
  await until(() => host.state.canStart);
  const observed = [];
  host.onChange = () => observed.push(host.state.room.players[1]?.shiny);
  guest.signal({ t: "setup", ...player, shiny: 0 });
  await until(() => guest.state.error && host.state.room.players.length === 1);
  assert.match(guest.state.error, /异色外观选择无效/);
  assert(observed.every((shiny) => shiny === undefined || shiny === true));
});
