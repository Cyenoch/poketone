import { test } from "node:test";
import assert from "node:assert/strict";
import { startHarbor } from "../services/harbor/server.ts";
import { MultiplayerRun } from "../src/network/run.ts";
import { MultiplayerSession } from "../src/network/session.ts";
import { killEnemy } from "../src/run/sim/combat.ts";
import { ALL_ROUTES } from "../src/run/sim/content/campaign.ts";
import { clearZone } from "../src/run/sim/currentZone.ts";
import { summonGuardian } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { collectRemainingPickups, createWorld } from "../src/run/sim/world.ts";
import { enterZone, prepareZone } from "../src/run/sim/zones.ts";

globalThis.__GAME_BUILD__ = "network-test";
const config = {
  stage: "forest",
  seed: 7,
  difficulty: 0,
  players: [
    { starter: "charmander", trainer: "chengxi", shiny: false },
    { starter: "squirtle", trainer: "yewei", shiny: false },
  ],
};

async function until(condition) {
  const end = Date.now() + 8000;
  for (;;) {
    const result = condition();
    if (result) return result;
    if (Date.now() > end) throw new Error("等待路线联机状态超时");
    await Bun.sleep(5);
  }
}

async function forestRun(t) {
  const server = startHarbor({ port: 0, hostname: "127.0.0.1" });
  const url = `ws://127.0.0.1:${server.port}/multiplayer`;
  const connect = (code, player) =>
    new MultiplayerSession(url, code, player, {
      directPeer() {
        throw new Error("路线联机测试使用 Harbor 转发");
      },
      signal: new AbortController().signal,
    });
  const hostSession = connect("", config.players[0]);
  let host, guest, guestSession;
  t.after(() => {
    hostSession.close(false);
    guestSession?.close(false);
    server.stop(true);
  });
  await until(() => hostSession.state.room);
  guestSession = connect(hostSession.state.room.code, config.players[1]);
  await until(() => guestSession.state.mode === "relay" && hostSession.state.canStart);
  hostSession.onStart = (settings) => {
    host = new MultiplayerRun(hostSession, settings);
  };
  guestSession.onStart = (settings) => {
    guest = new MultiplayerRun(guestSession, settings);
  };
  hostSession.start();
  await until(() => host && guest);
  const world = createWorld(config);
  world.players[1].ult.charge = 1;
  host.loading(world);
  host.publishMap(world);
  const remote = await until(() => guest.takeMap());
  guest.loading(remote);
  await guest.ready();
  await host.ready();
  await until(() => !guest.suspended);
  return { host, guest, world, remote, hostSession, guestSession };
}

function killGuardian(world) {
  summonGuardian(world, world.players[0]);
  const guardian = world.enemies.find((enemy) => enemy.id === world.bossId);
  guardian.hp = 0;
  killEnemy({ world, grid: new EnemyGrid() }, guardian, null);
}

function chooseExit({ host, world }, to) {
  const player = world.players[0];
  const exit = world.zone.exits.find((entry) => entry.to === to);
  Object.assign(player, { x: exit.x, z: exit.z, px: exit.x, pz: exit.z });
  host.step(world, host.submit([{ t: "interact", player: player.id }]));
}

function publishCoast({ host, world }) {
  enterZone(world, prepareZone(world));
  host.loading(world);
  host.publishMap(world);
}

async function loadCoast({ host, guest, world, remote }) {
  const incoming = await until(() => guest.takeMap());
  assert.equal(incoming.stage, "coast");
  guest.loading(incoming);
  Object.assign(remote, incoming);
  await guest.ready();
  await host.ready();
  await until(() => !guest.suspended);
  host.publish(world, world.events.splice(0), TICK, true);
  await until(() => guest.apply(remote, 0));
  for (let frame = 0; frame < 10; frame++) guest.apply(remote, TICK);
  return remote.events.splice(0);
}

function routeCues(events) {
  return events.filter((event) => event.t === "route").map(({ kind, player }) => [kind, player]);
}

for (const { scenario, expectedAfter } of [
  { scenario: "旧帧先播放", expectedAfter: [] },
  {
    scenario: "出口后结算",
    expectedAfter: [
      ["exit", 0],
      ["trophy", 1],
    ],
  },
  {
    scenario: "出口前结算",
    expectedAfter: [
      ["trophy", 1],
      ["exit", 0],
    ],
  },
]) {
  test(`森林离图确认和个人奖杯只交付一次（${scenario}）`, async (t) => {
    const run = await forestRun(t);
    const { host, guest, world, remote } = run;
    killGuardian(world);
    if (scenario === "出口前结算") {
      collectRemainingPickups(world);
      host.publish(world, world.events.splice(0), TICK, true);
      await until(() => guest.apply(remote, 0));
    }
    chooseExit(run, "coast");
    const departing = world.events.splice(0);
    const trophyIndex = departing.findIndex(
      (event) => event.t === "route" && event.kind === "trophy",
    );
    const later = scenario === "出口后结算" ? departing.splice(trophyIndex) : [];
    host.publish(world, departing, TICK, true);
    await until(() => guest.apply(remote, 0));
    assert.equal(remote.zone.phase, "transitioning");
    if (later.length) {
      host.publish(world, later, TICK, true);
      await until(() => guest.apply(remote, 0));
    }
    assert.deepEqual(routeCues(remote.events), [], "稳定播放延迟下旧帧已到，提示还没到播放时刻");

    const oldFramePlayed = scenario === "旧帧先播放";
    if (oldFramePlayed) for (let frame = 0; frame < 10; frame++) guest.apply(remote, TICK);
    const before = routeCues(remote.events.splice(0));
    assert.deepEqual(
      before,
      oldFramePlayed
        ? [
            ["exit", 0],
            ["trophy", 0],
            ["trophy", 1],
          ]
        : [],
    );
    publishCoast(run);
    const after = await loadCoast(run);
    assert.deepEqual(routeCues(after), expectedAfter, "跨图顺序补上待播放的出口确认与本机奖杯");
    assert.ok(!after.some((event) => event.t === "death"), "新图不重放旧图守卫死亡");
    assert.equal(
      remote.players[1].pending.filter((choice) => choice.offer?.kind === "trophy").length,
      1,
    );
  });
}

test("断线时跨图的重连快照恢复奖杯选项，不补播历史出口和奖杯声音", async (t) => {
  const run = await forestRun(t);
  killGuardian(run.world);
  chooseExit(run, "coast");
  run.host.publish(run.world, run.world.events.splice(0), TICK, true);
  await until(() => run.guest.apply(run.remote, 0));
  assert.deepEqual(routeCues(run.remote.events), []);
  run.guestSession.socket.close();
  await until(() => run.guest.reconnecting && !run.hostSession.isReachable(1));
  publishCoast(run);
  const after = await loadCoast(run);
  assert.deepEqual(routeCues(after), []);
  assert.equal(
    run.remote.players[1].pending.some((choice) => choice.offer?.kind === "trophy"),
    true,
  );
});

test("跨图终局只呈现本图出口一次，丢弃旧图已收到和待发送的演出", async (t) => {
  const run = await forestRun(t);
  const { host, guest, world, remote, guestSession } = run;
  const trophy = { t: "route", kind: "trophy", player: 1, x: 0, z: 0 };
  host.publish(world, [trophy], TICK, true);
  await until(() => guest.apply(remote, 0));
  assert.deepEqual(routeCues(remote.events), []);
  host.publish(world, [{ ...trophy, kind: "exit", player: 0 }], 0);

  const tower = createWorld({ ...config, stage: "tower", route: ALL_ROUTES[0] });
  clearZone(tower, 0, 0);
  chooseExit({ host, world: tower }, null);
  assert.equal(tower.outcome, "victory");
  host.publish(tower, tower.events.splice(0), TICK, true);
  await until(() => guestSession.ended);
  assert.equal(guest.apply(remote, 0), false, "旧场景等待终局地图载入");
  assert.equal(remote.stage, "forest");

  const incoming = guest.takeMap();
  assert.equal(incoming.stage, "tower");
  guest.loading(incoming);
  Object.assign(remote, incoming);
  await guest.ready();
  assert.equal(guest.apply(remote, 0), true);
  assert.equal(remote.outcome, "victory");
  assert.deepEqual(routeCues(remote.events.splice(0)), [["exit", 0]]);
  assert.equal(guest.apply(remote, TICK), false);
  assert.deepEqual(remote.events, []);
});

test("房主跳过 owner 包中的路线演出，保留移动、必杀和必杀演出年龄", async (t) => {
  const { host, guest, world, remote, hostSession, guestSession } = await forestRun(t);
  const send = guestSession.send.bind(guestSession);
  guestSession.send = (packet, ...args) => {
    if (packet.t === "owner" && packet.events.some((event) => event.t === "ult")) {
      packet = {
        ...packet,
        events: [{ t: "route", kind: "trophy", player: 0, x: 0, z: 0 }, ...packet.events],
        eventAges: [NaN, ...packet.eventAges.map((age) => age + 600)],
      };
    }
    return send(packet, ...args);
  };
  const player = world.players[1];
  const before = player.x;
  guest.submit([
    { t: "move", player: 1, x: 1, z: 0 },
    { t: "ult", player: 1 },
  ]);
  guest.apply(remote, TICK);
  await until(() => player.ult.cast > 0 || hostSession.state.error);
  assert.equal(hostSession.state.error, "");
  assert.ok(player.x > before);
  host.publish(world, [], 0.2, true);
  const cues = host.takeEvents();
  assert.deepEqual(routeCues(cues), []);
  const ult = cues.find((event) => event.t === "ult");
  assert.equal(ult?.player, 1);
  assert.ok(host.eventAgeMs(ult) >= 600);
});
